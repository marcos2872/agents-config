import { Cdp } from "./cdp"
import { idleStatus, labelFor, moveCursor, showStatus } from "./overlay"
import { Permissions } from "./permissions"
import { Recording } from "./recording"
import { RelayClient } from "./relay"
import { TabGroups } from "./tabGroups"
import { computerTools } from "./tools/computer"
import { gifTools } from "./tools/gif"
import { pageTools } from "./tools/page"
import { planTools } from "./tools/plan"
import { uploadTools } from "./tools/upload"
import { ToolRegistry } from "./tools/registry"
import { tabsTools } from "./tools/tabs"
import type { ToolContext } from "./tools/types"
import { RELAY_URL, type RelayInbound } from "../shared/protocol"
import type { RelayState } from "../shared/types"

/**
 * Orquestrador da extensão "browser-use" (sem UI).
 *
 * Só existe para manter a ponte com o plugin do Pi vivo e despachar as
 * `browser_*` tools para o núcleo de automação (CDP, grupos de abas, content
 * script). O documento offscreen mantém o service worker acordado.
 */

const cdp = new Cdp()
const tabs = new TabGroups()
const recording = new Recording(cdp)
const registry = new ToolRegistry([
  tabsTools,
  pageTools,
  computerTools,
  planTools,
  uploadTools,
  gifTools(recording),
])

const toolAborts = new Map<string, { sessionID: string; controller: AbortController }>()
let relayState: RelayState = { connected: false, url: RELAY_URL }

const permissions = new Permissions()

const relay = new RelayClient({
  onTool: (request) => {
    void executeRelayTool(request)
  },
  onCancel: (id) => {
    toolAborts.get(id)?.controller.abort()
  },
  onState: (state) => {
    relayState = state
  },
})

async function executeRelayTool(
  request: Extract<RelayInbound, { type: "tool_request" }>,
): Promise<void> {
  const sessionID = request.sessionID || "pi"
  const controller = new AbortController()
  toolAborts.set(request.id, { sessionID, controller })

  const context: ToolContext = {
    sessionID,
    signal: controller.signal,
    cdp,
    permissions,
    tabs,
    progress: (phase, detail) => {
      relay.send({ type: "progress", id: request.id, phase, detail })
    },
    // Sem indicador visual nesta versão sem UI; o mouse virtual segue ativo.
    indicator: async () => {},
    hideIndicator: async () => {},
    cursor: (tabId, x, y, options) => moveCursor(tabId, x, y, options?.click === true),
    ask: async (input) => (await permissions.check(input, sessionID)).allowed,
  }

  try {
    relay.send({
      type: "progress",
      id: request.id,
      phase: "starting",
      detail: request.tool,
    })
    // Sinaliza a aba antes de agir: borda + pílula dizem qual aba o agente usa e
    // o que ele está fazendo, inclusive em leitura, console, rede e navegação.
    const args = (request.args ?? {}) as { tabId?: unknown }
    const explicitTab = typeof args.tabId === "number" ? args.tabId : undefined
    const targetTab = explicitTab ?? (await tabs.currentTabId(sessionID).catch(() => null))
    const label = labelFor(request.tool, request.args ?? {})
    const hasTab = targetTab !== null && targetTab !== undefined
    if (hasTab) await showStatus(targetTab, label)
    const result = await registry.run(request.tool, request.args ?? {}, context)
    if (hasTab) void idleStatus(targetTab, label)
    relay.send({
      type: "tool_result",
      id: request.id,
      ok: true,
      content: result.content,
      images: result.images,
      metadata: result.metadata,
    })
    if (recording.active && request.tool !== "gif_creator") {
      const target = await tabs.resolveTab(sessionID).catch(() => null)
      if (target) await recording.capture(target.tabId, request.tool)
    }
  } catch (error) {
    relay.send({
      type: "tool_result",
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    toolAborts.delete(request.id)
  }
}

async function ensureOffscreen(): Promise<void> {
  try {
    if (await chrome.offscreen.hasDocument()) return
  } catch {
    // fall through
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"] as chrome.offscreen.Reason[],
      justification: "Manter a conexão com o plugin local do Pi ativa.",
    })
  } catch {
    // Already created or unsupported.
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "keepalive") return
  void ensureOffscreen()
  void relay.connect()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SW_KEEPALIVE") {
    sendResponse({ ok: true })
    return
  }
  if (message?.type === "pi:stop") {
    // Botão "Parar" da pílula: aborta o que está rodando. O erro volta para o
    // Pi como resultado da tool, então a chamada não fica pendurada.
    for (const entry of toolAborts.values()) entry.controller.abort()
    sendResponse({ ok: true })
    return
  }
})

chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreen()
  void relay.connect()
})

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreen()
  void relay.connect()
})

async function init(): Promise<void> {
  await permissions.init()
  // Limpeza mexe em abas: nunca durante uma execução do agente.
  if (toolAborts.size === 0) {
    await tabs.cleanup().catch(() => undefined)
  }
  chrome.alarms.create("keepalive", { periodInMinutes: 0.5 })
  await ensureOffscreen()
  void relay.connect()
}

void init().catch(() => undefined)
