import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { Socket as TcpSocket } from "node:net"
import { Type } from "typebox"
import { StringEnum } from "@earendil-works/pi-ai"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

/**
 * Ponte entre o Pi e a extensão browser-use (extensão Chrome MV3).
 *
 * A extensão conecta em ws://127.0.0.1:8799. Quando o modelo chama uma tool
 * `browser_*`, este plugin envia um `tool_request` e espera o `tool_result`.
 *
 * Variáveis de ambiente:
 * - PI_BROWSER_RELAY_PORT        porta base (padrão 8809)
 * - PI_BROWSER_EXTENSION_ID      id da extensão autorizada
 * - PI_BROWSER_ALLOW_ANY_EXTENSION=1  aceita qualquer chrome-extension://
 * - PI_BROWSER_REQUIRE_HELLO=0   desliga a exigência de `hello` (padrão: exige)
 * - PI_BROWSER_WS_SECRET         segredo opcional que o `hello` deve conter
 */

const PORT = Number(process.env.PI_BROWSER_RELAY_PORT ?? 8809)
const PORT_CANDIDATES = [PORT, PORT + 1, PORT + 2, PORT + 3]
const EXPECTED_EXTENSION_ID =
  process.env.PI_BROWSER_EXTENSION_ID ?? "bkpalidcolmdagdnaangpikcnablphej"
const ALLOW_ANY_EXTENSION = process.env.PI_BROWSER_ALLOW_ANY_EXTENSION === "1"
const REQUIRE_HELLO = process.env.PI_BROWSER_REQUIRE_HELLO !== "0"
const WS_SECRET = process.env.PI_BROWSER_WS_SECRET ?? ""
const CALL_TIMEOUT_MS = 180_000
const HELLO_TIMEOUT_MS = 5_000
/** O service worker (MV3) da extensão pode dormir e reconectar. */
const EXTENSION_GRACE_MS = 8_000
const MAX_HTTP_BODY = 1_000_000
const MAX_WS_PAYLOAD = 24 * 1024 * 1024
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

type ImagePayload = { name: string; mime: string; data: string }

type ToolResponse = {
  ok: boolean
  content?: string
  images?: ImagePayload[]
  error?: string
  metadata?: Record<string, unknown>
}

type Progress = (update: Record<string, unknown>) => Promise<void>

type SocketData = {
  origin: string
  id: string
  lastPong: number
  authed: boolean
  pingTimer?: ReturnType<typeof setInterval>
  helloTimer?: ReturnType<typeof setTimeout>
}

/** API mínima do socket WebSocket usada pelo resto do plugin (o `WsSocket` a implementa). */
type Socket = {
  data: SocketData
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: "message", listener: (data: string) => void): void
  on(event: "close", listener: () => void): void
}

type Pending = {
  socket: Socket
  resolve: (value: ToolResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  progress?: Progress
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function expandHome(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2))
  }
  return value
}

// ---------------------------------------------------------------------------
// Estado compartilhado do relay
// ---------------------------------------------------------------------------

interface RelayGlobal {
  active: Socket | null
  pending: Map<string, Pending>
  server: { stop(force?: boolean): void } | null
  serverVersion: number
  port: number
  /** Token do servidor que roda NESTE processo. */
  token?: string
  /** Porta de um relay que roda em OUTRO processo (modo cliente HTTP). */
  remotePort?: number
  starting?: Promise<void>
  /** Chamadas aguardando a extensão (re)conectar. */
  waiters: Array<() => void>
}

/**
 * Incrementar quando o servidor do relay mudar de forma incompatível.
 *
 * `/reload` reimporta a extensão, mas o servidor (e os handlers dos sockets) da
 * instância anterior continua vivo no `process`; subir a versão é o que faz o
 * `ensureServer` derrubar a instância velha e subir uma com o código novo.
 */
const SERVER_VERSION = 7

type Carrier = typeof globalThis & { __piBrowserRelay?: Partial<RelayGlobal> }

// `process` é compartilhado pelo processo; guardamos o estado do relay nele.
const carrier = ((globalThis as unknown as { process?: Carrier }).process ?? globalThis) as Carrier

function relay(): RelayGlobal {
  const existing = carrier.__piBrowserRelay
  if (existing && existing.pending instanceof Map) {
    existing.waiters ??= []
    return existing as RelayGlobal
  }
  const created: RelayGlobal = {
    active: existing?.active ?? null,
    pending: new Map<string, Pending>(),
    server: existing?.server ?? null,
    serverVersion: existing?.serverVersion ?? 0,
    port: existing?.port ?? PORT,
    token: existing?.token,
    remotePort: existing?.remotePort,
    starting: existing?.starting,
    waiters: existing?.waiters ?? [],
  }
  carrier.__piBrowserRelay = created
  return created
}

/**
 * Diagnóstico do relay: silencioso por padrão. `console.error` de extensão vira
 * notificação no chat do Pi, e o relay reconectando (reload da extensão no
 * Chrome) poluía a tela. Para ver: `PI_BROWSER_DEBUG=1 pi`.
 */
function log(message: string, error?: unknown): void {
  if (!process.env.PI_BROWSER_DEBUG) return
  const suffix = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : ""
  console.error(`[pi-browser] ${message}${suffix}`)
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin.startsWith("chrome-extension://")) return false
  if (ALLOW_ANY_EXTENSION) return true
  return origin === `chrome-extension://${EXPECTED_EXTENSION_ID}`
}

/** Defesa contra DNS rebinding: só aceita Host loopback com a porta do servidor. */
function isAllowedHost(host: string | undefined, port: number): boolean {
  const value = (host ?? "").toLowerCase()
  return value === `127.0.0.1:${port}` || value === `localhost:${port}` || value === `[::1]:${port}`
}

function send(socket: Socket | null, payload: unknown): boolean {
  if (!socket) return false
  try {
    socket.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function failPending(socket: Socket, reason: string): void {
  for (const [id, item] of relay().pending) {
    if (item.socket !== socket) continue
    clearTimeout(item.timer)
    relay().pending.delete(id)
    item.reject(new Error(reason))
  }
}

function cancelPending(id: string, reason: string): void {
  const item = relay().pending.get(id)
  if (!item) return
  relay().pending.delete(id)
  clearTimeout(item.timer)
  send(item.socket, { type: "cancel", id })
  item.reject(new Error(reason))
}

/** Pasta onde ficam as conversas criadas pela extensão. */
const WORKSPACE = join(homedir(), ".pi-browser")

// ---------------------------------------------------------------------------
// Token/porta do relay (arquivo privado, só do usuário atual)
// ---------------------------------------------------------------------------

interface RelayInfo {
  token: string
  port: number
}

function relayDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR?.trim()
  if (runtime) return join(runtime, "pi-browser")
  const cache = process.env.XDG_CACHE_HOME?.trim()
  return join(cache ? expandHome(cache) : join(homedir(), ".cache"), "pi-browser")
}

function relayFile(): string {
  return join(relayDir(), "relay.json")
}

/** Arquivo/pasta regular (não symlink), do usuário atual e sem acesso a grupo/outros. */
function isTrusted(path: string): boolean {
  if (process.platform === "win32") return true
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() && !stat.isDirectory()) return false
    const uid = process.getuid?.()
    if (uid !== undefined && stat.uid !== uid) return false
    return (stat.mode & 0o077) === 0
  } catch {
    return false
  }
}

function readRelayInfo(): RelayInfo | null {
  try {
    if (!isTrusted(relayDir()) || !isTrusted(relayFile())) return null
    const parsed = JSON.parse(readFileSync(relayFile(), "utf8")) as Partial<RelayInfo>
    if (typeof parsed.token === "string" && parsed.token && typeof parsed.port === "number") {
      return { token: parsed.token, port: parsed.port }
    }
  } catch {
    // arquivo ausente ou inválido
  }
  return null
}

function writeRelayInfo(info: RelayInfo): boolean {
  const dir = relayDir()
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
      chmodSync(dir, 0o700)
    } catch {
      // se não somos donos, isTrusted() recusa abaixo
    }
    if (!isTrusted(dir)) {
      log(`pasta ${dir} não é confiável (dono/permissões); token não gravado`)
      return false
    }
    const tmp = join(dir, `relay.${process.pid}.${randomUUID()}.tmp`)
    try {
      writeFileSync(tmp, JSON.stringify(info), { mode: 0o600, flag: "wx" })
      renameSync(tmp, relayFile())
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
    return true
  } catch (error) {
    log("não foi possível gravar o token do relay", error)
    return false
  }
}

function removeRelayInfoIfOwned(token: string | undefined): void {
  if (!token) return
  const info = readRelayInfo()
  if (info?.token === token) rmSync(relayFile(), { force: true })
}

function tokenMatches(provided: string): boolean {
  const expected = relay().token
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

/** Pasta onde as capturas do agente ficam: `~/.cache/pi-browser/capturas` (ou em `$XDG_CACHE_HOME`). */
function captureDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
  return join(base, "pi-browser", "capturas")
}

const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }

/**
 * Grava as imagens da resposta em disco e devolve os caminhos. Falha de escrita
 * não derruba a tool: o texto da resposta apenas sai sem o caminho.
 */
function saveImages(images: ImagePayload[]): string[] {
  if (images.length === 0) return []
  const carimbo = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")
  const caminhos: string[] = []
  try {
    mkdirSync(captureDir(), { recursive: true, mode: 0o700 })
    images.forEach((image, index) => {
      const extensao = IMAGE_EXT[image.mime] ?? "bin"
      const caminho = join(captureDir(), `captura-${carimbo}-${index + 1}.${extensao}`)
      writeFileSync(caminho, Buffer.from(image.data, "base64"), { mode: 0o600 })
      caminhos.push(caminho)
    })
  } catch (error) {
    log("não foi possível gravar a captura em disco", error)
  }
  return caminhos
}

function sanitizeImages(value: unknown): { images?: ImagePayload[]; dropped: number } {
  if (!Array.isArray(value)) return { dropped: 0 }
  const images: ImagePayload[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const { name, mime, data } = item
    if (typeof data !== "string" || typeof mime !== "string") continue
    if (!IMAGE_MIMES.has(mime) || data.length > MAX_IMAGE_BASE64) continue
    images.push({ name: typeof name === "string" ? name : "imagem", mime, data })
    if (images.length >= 3) break
  }
  return { images: images.length ? images : undefined, dropped: Math.max(0, value.length - images.length) }
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }

function buildContent(result: ToolResponse): ContentPart[] {
  const text = result.content?.trim() || "(no output)"
  // As capturas também vão para o disco, e o caminho volta no texto: o agente
  // precisa do arquivo para montar páginas que embutem a tela.
  const arquivos = saveImages(result.images ?? [])
  const resposta = arquivos.length ? `${text}\nArquivo: ${arquivos.join(" ")}` : text
  const parts: ContentPart[] = [{ type: "text", text: resposta }]
  for (const image of (result.images ?? []).slice(0, 3)) {
    parts.push({ type: "image", data: image.data, mimeType: image.mime })
  }
  return parts
}

// ---------------------------------------------------------------------------
// Despacho de chamadas para a extensão
// ---------------------------------------------------------------------------

/** `browser_batch`: remove o prefixo `browser_` dos nomes internos. Idempotente. */
function normalizeArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  if (tool !== "browser_batch" || !Array.isArray(args.actions)) return args
  return {
    ...args,
    actions: args.actions.map((action) => {
      if (isRecord(action) && typeof action.name === "string") {
        return { ...action, name: action.name.replace(/^browser_/, "") }
      }
      return action
    }),
  }
}

function dispatch(
  socket: Socket,
  id: string,
  tool: string,
  args: Record<string, unknown>,
  sessionID: string | undefined,
  progress?: Progress,
): Promise<ToolResponse> {
  return new Promise<ToolResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      relay().pending.delete(id)
      send(socket, { type: "cancel", id })
      reject(new Error(`A extensão não respondeu em ${CALL_TIMEOUT_MS / 1000}s.`))
    }, CALL_TIMEOUT_MS)

    relay().pending.set(id, { socket, resolve, reject, timer, progress })

    const sent = send(socket, {
      type: "tool_request",
      id,
      tool,
      args: normalizeArgs(tool, args),
      sessionID,
    })
    if (!sent) {
      relay().pending.delete(id)
      clearTimeout(timer)
      reject(new Error("Failed to send the request to the extension."))
    }
  })
}

function waitForActive(ms: number): Promise<Socket | null> {
  const state = relay()
  if (state.active) return Promise.resolve(state.active)
  return new Promise<Socket | null>((resolve) => {
    const wake = () => {
      clearTimeout(timer)
      resolve(relay().active)
    }
    const timer = setTimeout(() => {
      const list = relay().waiters
      const index = list.indexOf(wake)
      if (index >= 0) list.splice(index, 1)
      resolve(null)
    }, ms)
    state.waiters.push(wake)
  })
}

const NOT_CONNECTED =
  "The browser-use extension is not connected. Check that Chrome is open with the extension active and try again."

async function callToolOverHttp(
  tool: string,
  args: Record<string, unknown>,
  context: { sessionID: string; signal: AbortSignal },
): Promise<ToolResponse> {
  const info = readRelayInfo()
  if (!info) {
    throw new Error("browser-use relay not found. Restart Pi.")
  }
  const headers = { "content-type": "application/json", "x-relay-token": info.token }
  const base = `http://127.0.0.1:${info.port}`
  const id = `http_${randomUUID()}`
  const controller = new AbortController()
  const onAbort = () => {
    controller.abort()
    void fetch(`${base}/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id }),
    }).catch(() => undefined)
  }
  context.signal.addEventListener("abort", onAbort, { once: true })
  try {
    const response = await fetch(`${base}/tool`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id, tool, args, sessionID: context.sessionID }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CALL_TIMEOUT_MS + 5_000)]),
    })
    const data = (await response.json().catch(() => ({}))) as ToolResponse
    if (!response.ok) {
      throw new Error(data.error ?? `Relay HTTP ${response.status}.`)
    }
    return data
  } catch (error) {
    if (context.signal.aborted) throw new Error("Run cancelled.", { cause: error })
    if (error instanceof TypeError) {
      relay().remotePort = undefined
      void ensureServer()
      throw new Error(
        "browser-use relay unavailable. Wait for the extension to reconnect and try again.",
        { cause: error },
      )
    }
    throw error instanceof Error ? error : new Error(String(error), { cause: error })
  } finally {
    context.signal.removeEventListener("abort", onAbort)
  }
}

async function callTool(
  tool: string,
  args: Record<string, unknown>,
  context: { sessionID: string; signal: AbortSignal; progress: Progress },
): Promise<ToolResponse> {
  // Sempre passa por aqui: é o `ensureServer` que derruba a instância antiga do
  // relay (versão anterior do servidor) depois de um `/reload`.
  await ensureServer()

  let socket = relay().active
  // Este processo é o dono do relay: a extensão só pode estar reconectando.
  if (!socket && relay().server) {
    socket = await waitForActive(EXTENSION_GRACE_MS)
    if (!socket) throw new Error(NOT_CONNECTED)
  }
  if (!socket) {
    return callToolOverHttp(tool, args, context)
  }
  const id = `call_${randomUUID()}`
  const onAbort = () => cancelPending(id, "Run cancelled.")
  const promise = dispatch(socket, id, tool, args, context.sessionID, context.progress)
  if (context.signal.aborted) onAbort()
  else context.signal.addEventListener("abort", onAbort, { once: true })
  return promise.finally(() => context.signal.removeEventListener("abort", onAbort))
}

// ---------------------------------------------------------------------------
// Especificações das tools (TypeBox)
// ---------------------------------------------------------------------------

type ToolSpec = {
  /** Nome exposto ao modelo (vira `browser_<name>`). */
  name: string
  /** Nome enviado à extensão, se diferente de `name` (compatibilidade). */
  wire: string
  description: string
  parameters: ReturnType<typeof Type.Object>
}

const optTabId = Type.Optional(Type.Number({ description: "Tab ID inside this session's group." }))
const reqTabId = Type.Number({ description: "Tab ID inside this session's group." })
const frames = Type.Optional(StringEnum(["main", "all"] as const))

const tools: ToolSpec[] = [
  {
    name: "tabs_context",
    wire: "tabs_context",
    description:
      "Lists the tabs in this session's group. Use it before any tool that requires a tabId. If there is no group yet, use createIfEmpty.",
    parameters: Type.Object(
      {
        createIfEmpty: Type.Optional(Type.Boolean({ description: "Creates a group/tab if it does not exist yet." })),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "tabs_create",
    wire: "tabs_create",
    description:
      "Opens a URL in this session's group and returns the tabId. With the same origin (or a blank main tab) it reuses the main tab; with a different origin it opens a new tab.",
    parameters: Type.Object(
      {
        url: Type.Optional(Type.String()),
        active: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "tabs_attach",
    wire: "tabs_attach",
    description:
      "Moves an existing tab (given by tabId or the browser's active tab) into this session's group, giving the agent access to what is already open. Asks for permission. The tab leaves the user's current group.",
    parameters: Type.Object({ tabId: optTabId }, { additionalProperties: false }),
  },
  {
    // `browser_tabs_close` é reservado pelo plugin nativo do OpenCode; mantemos
    // `tabs_close_tab` exposto e `tabs_close` no protocolo.
    name: "tabs_close_tab",
    wire: "tabs_close",
    description: "Closes a tab in this session's group.",
    parameters: Type.Object({ tabId: reqTabId }, { additionalProperties: false }),
  },
  {
    name: "navigate",
    wire: "navigate",
    description:
      "Navigates to a URL or goes back/forward in history. Asks for permission on new domains.",
    parameters: Type.Object(
      {
        url: Type.Optional(Type.String({ description: "Absolute URL or domain; https:// is added when missing." })),
        direction: Type.Optional(StringEnum(["back", "forward"] as const)),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "read_page",
    wire: "read_page",
    description:
      "Returns the page accessibility tree with refs (ref_1, ref_2...). Use the refs in computer/form_input/find. With frames=all, iframe refs are prefixed as f<frameId>_ref_N. On large pages use filter=interactive and max_chars.",
    parameters: Type.Object(
      {
        filter: Type.Optional(StringEnum(["interactive", "all"] as const)),
        depth: Type.Optional(Type.Number()),
        ref_id: Type.Optional(Type.String()),
        max_chars: Type.Optional(Type.Number()),
        include_hidden: Type.Optional(Type.Boolean()),
        frames,
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "find",
    wire: "find",
    description:
      "Heuristic element search using text/role/name. Returns up to 20 refs. Prefer read_page filter=interactive for large pages.",
    parameters: Type.Object(
      {
        query: Type.String(),
        max_results: Type.Optional(Type.Number()),
        frames,
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "get_page_text",
    wire: "get_page_text",
    description:
      "Extracts the page main text (article/main/body) without HTML. With frames=all, also concatenates the iframe texts.",
    parameters: Type.Object(
      {
        max_chars: Type.Optional(Type.Number()),
        frames,
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "form_input",
    wire: "form_input",
    description: "Fills a field identified by ref (input, textarea, select or contenteditable).",
    parameters: Type.Object(
      {
        ref: Type.String(),
        value: Type.String(),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "computer",
    wire: "computer",
    description:
      "Interacts with the page through trusted events: click, type, key, scroll, hover, screenshot, zoom and wait. Use a ref from read_page/find or coordinate [x,y]. Screenshots are also written to disk and the file path comes back in the result (use it to build pages that embed the screen). Iframe refs (f<id>_ref_N) work for click/hover/scroll/type via DOM events.",
    parameters: Type.Object(
      {
        action: StringEnum(["click", "type", "key", "scroll", "hover", "screenshot", "zoom", "wait"] as const),
        ref: Type.Optional(Type.String()),
        coordinate: Type.Optional(Type.Array(Type.Number(), { minItems: 2, maxItems: 2 })),
        text: Type.Optional(Type.String()),
        keys: Type.Optional(
          Type.String({
            description:
              'Sends keyDown/keyUp events; it does not insert text. Use action="type" to enter text, including symbols. For layout-dependent key events, pass the symbol literally (e.g. "!") instead of inferring it from a chord like Shift+1. Examples: Enter, Tab, Ctrl+A.',
          }),
        ),
        submit: Type.Optional(Type.Boolean()),
        click_count: Type.Optional(Type.Number()),
        button: Type.Optional(StringEnum(["left", "right", "middle"] as const)),
        scroll_direction: Type.Optional(StringEnum(["up", "down", "left", "right"] as const)),
        scroll_amount: Type.Optional(Type.Number()),
        duration: Type.Optional(Type.Number({ description: "Seconds for action=wait (max 10)." })),
        region: Type.Optional(Type.Array(Type.Number(), { minItems: 4, maxItems: 4 })),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "javascript_tool",
    wire: "javascript_tool",
    description:
      "Runs JavaScript in the page context. Returns the value of the last expression. Last resort, only to READ data the other tools cannot reach: never read cookies/storage/tokens nor make requests to other domains. Asks for permission and truncates the output at 50 KB.",
    parameters: Type.Object(
      {
        action: Type.Optional(StringEnum(["javascript_exec"] as const)),
        text: Type.String({ description: "JavaScript code." }),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "read_console_messages",
    wire: "read_console_messages",
    description:
      "Reads the tab console messages/errors. Monitoring starts when the tool is used; reload the page to capture the loading phase.",
    parameters: Type.Object(
      {
        pattern: Type.Optional(Type.String()),
        onlyErrors: Type.Optional(Type.Boolean()),
        limit: Type.Optional(Type.Number()),
        clear: Type.Optional(Type.Boolean()),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "read_network_requests",
    wire: "read_network_requests",
    description:
      "Reads the tab network requests (XHR/fetch/documents). Monitoring starts when the tool is used.",
    parameters: Type.Object(
      {
        urlPattern: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number()),
        clear: Type.Optional(Type.Boolean()),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "resize_window",
    wire: "resize_window",
    description: "Resizes the tab window to test responsive layouts.",
    parameters: Type.Object(
      {
        width: Type.Number(),
        height: Type.Number(),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "update_plan",
    wire: "update_plan",
    description:
      "Presents a browsing plan (domains + steps) for approval. Approved domains are allowed for this session.",
    parameters: Type.Object(
      {
        domains: Type.Array(Type.String()),
        approach: Type.Array(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "upload_image",
    wire: "upload_image",
    description:
      "Uploads files (base64 bytes) to an input[type=file] or drag & drop area identified by ref. Asks for permission. At most 3 files, ~5 MB each.",
    parameters: Type.Object(
      {
        ref: Type.String({ description: "Ref of the file input or drop target." }),
        files: Type.Array(
          Type.Object(
            {
              data: Type.String({ description: "File bytes in base64." }),
              name: Type.String(),
              mimeType: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 3 },
        ),
        tabId: optTabId,
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "gif_creator",
    wire: "gif_creator",
    description:
      "Records the agent actions as frames (one screenshot per action) and exports an animated GIF. Use action=start before navigating/interacting, action=stop when finished and action=export to generate the file.",
    parameters: Type.Object(
      {
        action: StringEnum(["start", "stop", "export"] as const),
      },
      { additionalProperties: false },
    ),
  },
  {
    name: "batch",
    wire: "browser_batch",
    description:
      "Runs up to 20 independent browser actions in sequence to reduce round trips. Each item is {name, input}, with the name of a browser tool (e.g. read_page); code tools (read, glob, grep) do not belong in this batch. Do not use it when an action depends on the previous result.",
    parameters: Type.Object(
      {
        actions: Type.Array(
          Type.Object(
            {
              name: Type.String(),
              input: Type.Object({}),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 20 },
        ),
      },
      { additionalProperties: false },
    ),
  },
]

/** Nomes aceitos pelo relay no protocolo com a extensão (inclusive via HTTP). */
const KNOWN_TOOLS = new Set(tools.map((tool) => tool.wire))

// ---------------------------------------------------------------------------
// Servidor (WebSocket da extensão + HTTP entre processos)
// ---------------------------------------------------------------------------

/** Marca o socket como autenticado e o torna a conexão ativa. */
function activate(socket: Socket): void {
  const state = relay()
  socket.data.authed = true
  if (socket.data.helloTimer) {
    clearTimeout(socket.data.helloTimer)
    socket.data.helloTimer = undefined
  }
  const current = state.active
  if (current && current !== socket) {
    try {
      current.close(1000, "New extension connection")
    } catch {
      // ignore
    }
  }
  state.active = socket
  // Conectar/desconectar a extensão é rotina (a cada reload do Chrome) e vira
  // notificação no chat: só as falhas valem log.
  send(socket, { type: "ready", v: 1, home: homedir(), workspace: WORKSPACE })
  for (const wake of state.waiters.splice(0)) wake()
}

function handleMessage(socket: Socket, text: string): void {
  let message: Record<string, unknown>
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed)) return
    message = parsed
  } catch {
    return
  }

  if (message.type === "hello") {
    const idOk = ALLOW_ANY_EXTENSION || message.extensionId === EXPECTED_EXTENSION_ID
    const secretOk = !WS_SECRET || message.secret === WS_SECRET
    if (!idOk || !secretOk) {
      socket.close(1008, "Extension not authorized")
      return
    }
    if (!socket.data.authed) activate(socket)
    return
  }
  if (message.type === "pong") {
    socket.data.lastPong = Date.now()
    return
  }
  // Nada além de hello/pong é aceito de sockets não autenticados.
  if (!socket.data.authed) return

  if (message.type === "ensure_agent") {
    // O Pi não usa o arquivo de agente do OpenCode; respondemos só para a
    // extensão não esperar o timeout de 5s (o resultado é ignorado por ela).
    const id = typeof message.id === "string" ? message.id : ""
    if (id) send(socket, { type: "ensure_agent_result", id, ok: true, path: "" })
    return
  }

  if (message.type === "progress" && typeof message.id === "string") {
    const item = relay().pending.get(message.id)
    if (item && item.socket === socket && item.progress) {
      void item.progress({
        phase: message.phase ?? "running",
        detail: message.detail,
      })
    }
    return
  }
  if (message.type === "tool_result" && typeof message.id === "string") {
    const item = relay().pending.get(message.id)
    // Só o socket que recebeu o pedido pode respondê-lo.
    if (!item || item.socket !== socket) return
    relay().pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.ok === false) {
      item.reject(
        new Error(typeof message.error === "string" ? message.error : "The extension returned an error."),
      )
      return
    }
    const { images, dropped } = sanitizeImages(message.images)
    let content = typeof message.content === "string" ? message.content : undefined
    if (dropped > 0) {
      const note = `(${dropped} imagem(ns) descartada(s): tipo não permitido ou tamanho acima do limite)`
      content = content ? `${content}\n${note}` : note
    }
    item.resolve({
      ok: true,
      content,
      images,
      metadata: isRecord(message.metadata) ? message.metadata : undefined,
    })
  }
}

// ---------------------------------------------------------------------------
// Servidor WebSocket mínimo (RFC 6455 sobre node:http). O pacote `ws` não é
// resolvido a partir de extensões do Pi (só os pacotes hospedeiros o são), então
// implementamos aqui o handshake e o enquadramento necessários à extensão.
// ---------------------------------------------------------------------------

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function acceptKey(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64")
}

/** Codifica um frame servidor→cliente (nunca mascarado). */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const head: Buffer[] = [Buffer.from([0x80 | opcode])]
  if (payload.length <= 0x7d) {
    head.push(Buffer.from([payload.length]))
  } else if (payload.length <= 0xffff) {
    const b = Buffer.alloc(3)
    b[0] = 126
    b.writeUInt16BE(payload.length, 1)
    head.push(b)
  } else {
    const b = Buffer.alloc(9)
    b[0] = 127
    b.writeBigUInt64BE(BigInt(payload.length), 1)
    head.push(b)
  }
  return Buffer.concat([...head, payload])
}

type Frame =
  | { opcode: number; fin: boolean; payload: Buffer; consumed: number; error?: false }
  | { opcode: number; fin: boolean; payload: Buffer; consumed: number; error: true }

/** Lê um frame (cliente→servidor, mascarado) do buffer acumulado. */
function readFrame(buffer: Buffer, maxPayload: number): Frame | null {
  if (buffer.length < 2) return null
  const fin = (buffer[0] & 0x80) !== 0
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let len = buffer[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buffer.length < offset + 2) return null
    len = buffer.readUInt16BE(offset)
    offset += 2
  } else if (len === 127) {
    if (buffer.length < offset + 8) return null
    const big = buffer.readBigUInt64BE(offset)
    offset += 8
    if (big > BigInt(maxPayload)) {
      return { opcode, fin, payload: Buffer.alloc(0), consumed: offset, error: true }
    }
    len = Number(big)
  }
  if (len > maxPayload) {
    return { opcode, fin, payload: Buffer.alloc(0), consumed: offset, error: true }
  }
  let maskKey: Buffer | null = null
  if (masked) {
    if (buffer.length < offset + 4) return null
    maskKey = buffer.slice(offset, offset + 4)
    offset += 4
  }
  if (buffer.length < offset + len) return null
  let payload = buffer.slice(offset, offset + len)
  if (masked && maskKey) {
    const unmasked = Buffer.allocUnsafe(payload.length)
    for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ maskKey[i & 3]
    payload = unmasked
  }
  return { opcode, fin, payload, consumed: offset + len, error: false }
}

/** Socket WebSocket mínimo que expõe a API esperada pelo resto do plugin. */
class WsSocket {
  data: SocketData
  private net: TcpSocket
  private buffer: Buffer = Buffer.alloc(0)
  private fragmentedOpcode: number | null = null
  private fragments: Buffer[] = []
  private closed = false
  private closeNotified = false
  private onMessage: ((data: string) => void) | null = null
  private onClose: (() => void) | null = null

  constructor(net: TcpSocket, data: SocketData) {
    this.net = net
    this.data = data
    net.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      this.buffer = this.buffer.length === 0 ? buf : Buffer.concat([this.buffer, buf])
      this.parse()
    })
    net.on("error", () => this.teardown())
    net.on("end", () => this.teardown())
    net.on("close", () => this.teardown())
  }

  on(event: "message" | "close", listener: (data: string) => void): void {
    if (event === "message") this.onMessage = listener
    else this.onClose = listener as unknown as () => void
  }

  send(data: string): void {
    if (this.closed) return
    try {
      this.net.write(encodeFrame(0x1, Buffer.from(data, "utf8")))
    } catch {
      this.teardown()
    }
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return
    this.closed = true
    try {
      if (code !== undefined) {
        const reasonBuf = reason ? Buffer.from(reason, "utf8") : Buffer.alloc(0)
        const payload = Buffer.alloc(2 + reasonBuf.length)
        payload.writeUInt16BE(code, 0)
        if (reasonBuf.length) reasonBuf.copy(payload, 2)
        this.net.write(encodeFrame(0x8, payload))
      }
    } catch {
      // ignore
    }
    this.net.end()
    this.teardown()
  }

  private teardown(): void {
    if (this.closeNotified) return
    this.closeNotified = true
    this.closed = true
    this.onClose?.()
  }

  private parse(): void {
    while (!this.closed) {
      const frame = readFrame(this.buffer, MAX_WS_PAYLOAD)
      if (!frame) break
      if (frame.error) {
        this.close(1009, "Payload too large")
        break
      }
      this.buffer = this.buffer.slice(frame.consumed)
      this.handleFrame(frame.opcode, frame.fin, frame.payload)
    }
  }

  private handleFrame(opcode: number, fin: boolean, payload: Buffer): void {
    switch (opcode) {
      case 0x8: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000
        this.close(code)
        break
      }
      case 0x9:
        this.net.write(encodeFrame(0xa, payload))
        break
      case 0xa:
        break
      case 0x1:
      case 0x2:
      case 0x0: {
        if (opcode === 0x0) {
          if (this.fragmentedOpcode === null) {
            this.close(1002, "unexpected continuation")
            break
          }
          this.fragments.push(payload)
          if (fin) {
            const full = Buffer.concat(this.fragments)
            this.fragments = []
            this.fragmentedOpcode = null
            this.onMessage?.(full.toString("utf8"))
          }
        } else if (fin) {
          this.onMessage?.(payload.toString("utf8"))
        } else {
          this.fragmentedOpcode = opcode
          this.fragments = [payload]
        }
        break
      }
      default:
        this.close(1002, "unknown opcode")
    }
  }
}

function setupConnection(socket: Socket): void {
  socket.data.pingTimer = setInterval(() => {
    if (Date.now() - socket.data.lastPong > 60_000) {
      try {
        socket.close(4001, "extension not responding")
      } catch {
        // ignore
      }
      return
    }
    send(socket, { type: "ping" })
  }, 20_000)

  socket.on("message", (text) => handleMessage(socket, text))
  socket.on("close", () => {
    if (socket.data.pingTimer) clearInterval(socket.data.pingTimer)
    if (socket.data.helloTimer) clearTimeout(socket.data.helloTimer)
    if (relay().active === socket) relay().active = null
    failPending(socket, "The extension disconnected during the run.")
  })

  if (REQUIRE_HELLO) {
    // Não vira `active` (nem recebe `ready`) até um `hello` válido.
    socket.data.helloTimer = setTimeout(() => {
      if (!socket.data.authed) {
        try {
          socket.close(1008, "hello ausente")
        } catch {
          // ignore
        }
      }
    }, HELLO_TIMEOUT_MS)
  } else {
    activate(socket)
  }
}

function startServer(port: number): Promise<{ stop(force?: boolean): void }> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer((request, response) => {
      void handleHttpRequest(request, response, port)
    })
    const clients = new Set<WsSocket>()

    httpServer.on("upgrade", (request, socket, head) => {
      const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host
      if (!isAllowedHost(host, port)) {
        socket.destroy()
        return
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== "/" && url.pathname !== "/ws") {
        socket.destroy()
        return
      }
      const origin = request.headers.origin ?? ""
      if (!isAllowedOrigin(origin)) {
        socket.destroy()
        return
      }
      const key = request.headers["sec-websocket-key"]
      if (typeof key !== "string") {
        socket.destroy()
        return
      }
      if (head.length) socket.unshift(head)
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
      )
      const ws = new WsSocket(socket, {
        origin,
        id: randomUUID(),
        lastPong: Date.now(),
        authed: false,
      })
      clients.add(ws)
      setupConnection(ws as unknown as Socket)
    })

    httpServer.once("error", reject)
    httpServer.listen(port, "127.0.0.1", () => {
      resolve({
        stop(force) {
          for (const client of clients) client.close(1001, "Server shutting down")
          httpServer.close()
          if (force) httpServer.closeAllConnections?.()
        },
      })
    })
  })
}

function respond(response: ServerResponse, status: number, text: string): void {
  if (!response.headersSent) {
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" })
  }
  response.end(text)
}

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  if (!response.headersSent) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  }
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error("Corpo grande demais.")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

async function handleHttpTool(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (Number(request.headers["content-length"] ?? 0) > MAX_HTTP_BODY) {
    respondJson(response, 413, { ok: false, error: "Corpo grande demais." })
    return
  }
  let body: unknown
  try {
    body = await readJson(request, MAX_HTTP_BODY)
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Corpo grande demais."
    respondJson(response, tooLarge ? 413 : 400, {
      ok: false,
      error: tooLarge ? "Corpo grande demais." : "Invalid JSON.",
    })
    return
  }
  if (!isRecord(body) || typeof body.tool !== "string" || !KNOWN_TOOLS.has(body.tool)) {
    respondJson(response, 400, { ok: false, error: "Parâmetro tool ausente ou desconhecido." })
    return
  }
  if (body.args !== undefined && !isRecord(body.args)) {
    respondJson(response, 400, { ok: false, error: "Invalid args parameter." })
    return
  }
  const socket = relay().active ?? (await waitForActive(EXTENSION_GRACE_MS))
  if (!socket) {
    respondJson(response, 503, { ok: false, error: NOT_CONNECTED })
    return
  }
  const id =
    typeof body.id === "string" && body.id.length > 0 && body.id.length <= 100
      ? body.id
      : `http_${randomUUID()}`
  if (relay().pending.has(id)) {
    respondJson(response, 409, { ok: false, error: "call id already in use." })
    return
  }
  try {
    const result = await dispatch(
      socket,
      id,
      body.tool,
      (body.args as Record<string, unknown> | undefined) ?? {},
      typeof body.sessionID === "string" ? body.sessionID : undefined,
    )
    respondJson(response, 200, result)
  } catch (error) {
    respondJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleHttpCancel(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const body = await readJson(request, MAX_HTTP_BODY)
    if (isRecord(body) && typeof body.id === "string") {
      cancelPending(body.id, "Run cancelled.")
    }
  } catch {
    // corpo inválido: nada a cancelar
  }
  respondJson(response, 200, { ok: true })
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
): Promise<void> {
  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host
  if (!isAllowedHost(host, port)) {
    respond(response, 403, "Forbidden host")
    return
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  if (request.method === "POST" && (url.pathname === "/tool" || url.pathname === "/cancel")) {
    if (!tokenMatches(request.headers["x-relay-token"] ?? "")) {
      respond(response, 403, "Forbidden")
      return
    }
    if (url.pathname === "/cancel") {
      await handleHttpCancel(request, response)
    } else {
      await handleHttpTool(request, response)
    }
    return
  }
  if (url.pathname === "/health") {
    // Sem caminhos locais: só o necessário para detectar um relay existente.
    respondJson(response, 200, { connected: Boolean(relay().active), version: SERVER_VERSION })
    return
  }
  respond(response, 404, "Not found")
}

/** Há um relay do browser-use respondendo nessa porta (outro processo)? */
async function probeRelay(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return false
    const data = (await response.json()) as unknown
    return isRecord(data) && typeof data.version === "number" && typeof data.connected === "boolean"
  } catch {
    return false
  }
}

async function doEnsureServer(): Promise<void> {
  const state = relay()
  if (state.server && state.serverVersion !== SERVER_VERSION) {
    try {
      state.server.stop(true)
    } catch {
      // ignore
    }
    removeRelayInfoIfOwned(state.token)
    state.server = null
    state.active = null
    state.token = undefined
  }
  if (state.server) return
  if (state.remotePort && (await probeRelay(state.remotePort))) return
  state.remotePort = undefined

  for (const candidate of PORT_CANDIDATES) {
    try {
      const server = await startServer(candidate)
      state.server = server
      state.serverVersion = SERVER_VERSION
      state.port = candidate
      state.token = randomUUID()
      writeRelayInfo({ token: state.token, port: candidate })
      log(`relay ouvindo em ws://127.0.0.1:${candidate}`)
      return
    } catch (error) {
      // Porta ocupada por OUTRO processo (ex.: plugin do OpenCode)? Este
      // processo vira cliente HTTP dele em vez de subir um segundo relay.
      if (await probeRelay(candidate)) {
        state.remotePort = candidate
        log(`reutilizando relay existente em 127.0.0.1:${candidate}`)
        return
      }
      log(`porta ${candidate} indisponível`, error)
    }
  }
  log("não foi possível abrir o relay em nenhuma porta candidata")
}

/** Serializa a inicialização para que várias chamadas não disputem portas. */
function ensureServer(): Promise<void> {
  const state = relay()
  state.starting ??= doEnsureServer().finally(() => {
    relay().starting = undefined
  })
  return state.starting
}

// ---------------------------------------------------------------------------
// Plugin do Pi
// ---------------------------------------------------------------------------

function makeExecute(wire: string) {
  return async (
    _toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: { content: ContentPart[]; details: Record<string, unknown> }) => void) | undefined,
    ctx: { sessionManager: { getSessionId(): string } },
  ) => {
    const args = isRecord(params) ? params : {}
    const abort = signal ?? new AbortController().signal
    const result = await callTool(wire, args, {
      sessionID: ctx.sessionManager.getSessionId(),
      signal: abort,
      progress: async (update) => {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `${update.phase ?? "running"}${update.detail ? `: ${String(update.detail)}` : ""}`,
            },
          ],
          details: {},
        })
      },
    })
    return {
      content: buildContent(result),
      details: result.metadata ?? {},
    }
  }
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    void ensureServer()
  })

  for (const spec of tools) {
    pi.registerTool({
      name: `browser_${spec.name}`,
      label: `Browser: ${spec.name}`,
      description: spec.description,
      parameters: spec.parameters,
      execute: makeExecute(spec.wire),
    })
  }
}
