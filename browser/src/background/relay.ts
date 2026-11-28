import { RELAY_PORT, RELAY_PROTOCOL, RELAY_URL, type RelayInbound, type RelayOutbound } from "../shared/protocol"
import type { RelayState } from "../shared/types"
import { t } from "../shared/i18n/runtime"

const CANDIDATE_PORTS = [RELAY_PORT, RELAY_PORT + 1, RELAY_PORT + 2, RELAY_PORT + 3]
/** Silêncio máximo do plugin antes de considerá-lo morto (só com plugins novos). */
const LIVENESS_MS = 45_000
const WATCHDOG_MS = 10_000

interface RelayEndpoint {
  url: string
  workspace?: string
}

/**
 * O plugin pode precisar de outra porta quando um servidor antigo ainda ocupa
 * 8799. Preferimos a versão mais alta (servidor mais novo) e, em empate, a
 * porta mais alta; assim um servidor órfão de código antigo não sequestra a
 * extensão.
 */
async function resolveRelayEndpoint(): Promise<RelayEndpoint> {
  let best: { url: string; version: number; port: number; workspace?: string } | null = null
  for (const port of CANDIDATE_PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(700),
        cache: "no-store",
      })
      if (!response.ok) continue
      const data = (await response.json()) as {
        connected?: boolean
        version?: number
        workspace?: string
      }
      if (!data || typeof data !== "object" || !("connected" in data)) continue
      const version = typeof data.version === "number" ? data.version : 0
      if (
        !best ||
        version > best.version ||
        (version === best.version && port > best.port)
      ) {
        best = {
          url: `ws://127.0.0.1:${port}`,
          version,
          port,
          workspace: typeof data.workspace === "string" ? data.workspace : undefined,
        }
      }
    } catch {
      // porta sem o relay novo; tenta a próxima
    }
  }
  return best ? { url: best.url, workspace: best.workspace } : { url: RELAY_URL }
}

interface RelayHandlers {
  onTool: (request: Extract<RelayInbound, { type: "tool_request" }>) => void
  onCancel: (id: string) => void
  onState: (state: RelayState) => void
  onReady?: (info: { home?: string; workspace?: string }) => void
}

export class RelayClient {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private attempts = 0
  /** Só checa silêncio depois que o plugin novo prova que sabe pingar. */
  private livenessArmed = false
  private agentPending = new Map<
    string,
    {
      resolve: (value: { path?: string }) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private state: RelayState = { connected: false, url: RELAY_URL }

  constructor(private readonly handlers: RelayHandlers) {}

  get current(): RelayState {
    return this.state
  }

  async connect(force = false): Promise<void> {
    if (!force && this.socket && this.socket.readyState <= WebSocket.OPEN) return
    if (force) this.close()
    const endpoint = await resolveRelayEndpoint()
    const url = endpoint.url
    if (this.socket) return
    this.setState({ ...this.state, connected: false, url, lastError: undefined })
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
      return
    }
    this.socket = socket

    socket.addEventListener("open", () => {
      this.attempts = 0
      const hello: RelayOutbound = {
        type: "hello",
        v: RELAY_PROTOCOL,
        extensionId: chrome.runtime.id,
      }
      socket.send(JSON.stringify(hello))
      if (endpoint.workspace) this.handlers.onReady?.({ workspace: endpoint.workspace })
      this.startWatchdog(socket)
    })

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      let message: RelayInbound
      try {
        message = JSON.parse(event.data) as RelayInbound
      } catch {
        return
      }
      this.touch(socket)
      if (message.type === "ready") {
        this.setState({
          connected: true,
          url,
          lastSeenAt: Date.now(),
        })
        this.handlers.onReady?.({ home: message.home, workspace: message.workspace })
        return
      }
      if (message.type === "ping") {
        this.livenessArmed = true
        this.send({ type: "pong" })
        return
      }
      if (message.type === "cancel") {
        this.handlers.onCancel(message.id)
        return
      }
      if (message.type === "ensure_agent_result") {
        const pending = this.agentPending.get(message.id)
        if (!pending) return
        this.agentPending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.ok) pending.resolve({ path: message.path })
        else pending.reject(new Error(message.error ?? t("relayError.noAgent")))
        return
      }
      if (message.type === "tool_request") {
        this.handlers.onTool(message)
      }
    })

    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopWatchdog()
      this.rejectAgentPending(t("relayError.disconnectedBeforeAgent"))
      const silent = event.code === 4000
      this.setState({
        connected: false,
        url,
        lastError: silent
          ? t("relayError.noResponse")
          : event.reason || t("relayError.closedCode", { code: event.code }),
        reason: silent
          ? "silent"
          : event.code === 1008
            ? "rejected"
            : "closed",
      })
      this.schedule()
    })

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return
      this.setState({
        connected: false,
        url,
        lastError: t("relayError.pluginMissing"),
        reason: "missing_plugin",
      })
    })
  }

  reconnect(): void {
    this.attempts = 0
    void this.connect(true)
  }

  send(message: RelayOutbound): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    try {
      this.socket.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  /** Pede ao plugin para gravar o agente do navegador na configuração global. */
  ensureAgent(): Promise<{ path?: string }> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(t("relayError.pluginNotConnected")))
    }
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.agentPending.delete(id)
        reject(new Error(t("relayError.agentInstallSilent")))
      }, 5_000)
      this.agentPending.set(id, { resolve, reject, timer })
      if (!this.send({ type: "ensure_agent", id })) {
        clearTimeout(timer)
        this.agentPending.delete(id)
        reject(new Error("Falha ao enviar o pedido ao plugin."))
      }
    })
  }

  private touch(socket: WebSocket): void {
    if (this.socket !== socket) return
    this.state = { ...this.state, lastSeenAt: Date.now() }
  }

  private startWatchdog(socket: WebSocket): void {
    this.stopWatchdog()
    this.watchdogTimer = setInterval(() => {
      if (this.socket !== socket) return
      if (!this.livenessArmed) return
      const lastSeen = this.state.lastSeenAt ?? 0
      if (Date.now() - lastSeen <= LIVENESS_MS) return
      this.setState({
        connected: false,
        url: this.state.url,
        reason: "silent",
        lastError: t("relayError.noResponse"),
      })
      try {
        socket.close(4000, "sem pong")
      } catch {
        // ignore
      }
      this.stopWatchdog()
    }, WATCHDOG_MS)
  }

  private schedule(): void {
    if (this.reconnectTimer) return
    this.attempts += 1
    const delay = Math.min(1000 * 1.6 ** Math.min(this.attempts, 5), 15_000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private fail(reason: string): void {
    this.setState({
      connected: false,
      url: this.state.url,
      lastError: reason,
      reason: "missing_plugin",
    })
    this.schedule()
  }

  private close(): void {
    this.stopWatchdog()
    this.rejectAgentPending(t("relayError.closedBeforeAgent"))
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
  }

  private stopWatchdog(): void {
    this.livenessArmed = false
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private rejectAgentPending(message: string): void {
    for (const [id, pending] of this.agentPending) {
      clearTimeout(pending.timer)
      this.agentPending.delete(id)
      pending.reject(new Error(message))
    }
  }

  private setState(state: RelayState): void {
    this.state = state
    this.handlers.onState(state)
  }
}
