import { t } from "../shared/i18n/runtime"

export interface ConsoleEntry {
  type: string
  text: string
  timestamp: number
  url?: string
  lineNumber?: number
  columnNumber?: number
  stackTrace?: string
  domain: string
}

export interface NetworkEntry {
  requestId: string
  url: string
  method: string
  status?: number
  domain: string
  timestamp: number
}

interface TabState {
  attached: boolean
  attaching?: Promise<void>
  runtime: boolean
  network: boolean
  page: boolean
  /** Emulação de foco ativa (aba em segundo plano recebendo input). */
  focusEmulated: boolean
  domain: string
  console: ConsoleEntry[]
  networkEntries: NetworkEntry[]
}

const MAX_CONSOLE = 500
const MAX_NETWORK = 500

function domainOf(url: string | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

export class Cdp {
  private tabs = new Map<number, TabState>()

  private state(tabId: number): TabState {
    let state = this.tabs.get(tabId)
    if (!state) {
      state = {
        attached: false,
        runtime: false,
        network: false,
        page: false,
        focusEmulated: false,
        domain: "",
        console: [],
        networkEntries: [],
      }
      this.tabs.set(tabId, state)
    }
    return state
  }

  constructor() {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId === undefined) return
      this.onEvent(source.tabId, method, params as Record<string, unknown>)
    })
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId === undefined) return
      const state = this.tabs.get(source.tabId)
      if (state) {
        state.attached = false
        state.runtime = false
        state.network = false
        state.page = false
        state.focusEmulated = false
      }
    })
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.tabs.delete(tabId)
    })
  }

  async attach(tabId: number): Promise<void> {
    const state = this.state(tabId)
    if (state.attached) return
    if (state.attaching) return state.attaching
    state.attaching = new Promise<void>((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        const error = chrome.runtime.lastError?.message
        if (error) {
          reject(
            new Error(
              error.includes("Another debugger")
                ? t("cdp.devtoolsOpen")
                : t("cdp.attachFailed", { error }),
            ),
          )
          return
        }
        state.attached = true
        resolve()
      })
    }).finally(() => {
      state.attaching = undefined
    })
    return state.attaching
  }

  async detach(tabId: number): Promise<void> {
    const state = this.tabs.get(tabId)
    if (!state?.attached) return
    await new Promise<void>((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        void chrome.runtime.lastError
        state.attached = false
        state.runtime = false
        state.network = false
        state.page = false
        state.focusEmulated = false
        resolve()
      })
    })
  }

  async detachAll(): Promise<void> {
    await Promise.all([...this.tabs.keys()].map((tabId) => this.detach(tabId)))
  }

  async command<T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    await this.attach(tabId)
    return new Promise<T>((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
        const error = chrome.runtime.lastError?.message
        if (error) {
          reject(new Error(`${method}: ${error}`))
          return
        }
        resolve(result as T)
      })
    })
  }

  async enableRuntime(tabId: number): Promise<void> {
    const state = this.state(tabId)
    if (state.runtime) return
    await this.command(tabId, "Runtime.enable")
    state.runtime = true
  }

  async enablePage(tabId: number): Promise<void> {
    const state = this.state(tabId)
    if (state.page) return
    await this.command(tabId, "Page.enable")
    state.page = true
  }

  async enableNetwork(tabId: number): Promise<void> {
    const state = this.state(tabId)
    if (state.network) return
    await this.command(tabId, "Network.enable")
    state.network = true
  }

  /**
   * Emula foco no documento para que a aba aceite input mesmo em segundo
   * plano — é o que permite agir sem trazer a aba (e a janela) para frente.
   * A emulação é por documento, então é reaplicada após cada navegação.
   */
  async enableFocusEmulation(tabId: number): Promise<void> {
    const state = this.state(tabId)
    if (state.focusEmulated) return
    await this.enablePage(tabId)
    await this.command(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true })
    state.focusEmulated = true
  }

  async evaluate(
    tabId: number,
    expression: string,
    options: { awaitPromise?: boolean; timeoutMs?: number } = {},
  ): Promise<{ value: unknown; exception?: string }> {
    await this.enableRuntime(tabId)
    const result = await this.command<{
      result?: { value?: unknown; description?: string }
      exceptionDetails?: { text?: string; exception?: { description?: string } }
    }>(tabId, "Runtime.evaluate", {
      expression,
      awaitPromise: options.awaitPromise ?? true,
      returnByValue: true,
      userGesture: true,
      timeout: options.timeoutMs,
    })
    if (result.exceptionDetails) {
      return {
        value: undefined,
        exception:
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          t("cdp.jsUnknownError"),
      }
    }
    return { value: result.result?.value }
  }

  async screenshot(
    tabId: number,
    options: { clip?: { x: number; y: number; width: number; height: number; scale?: number } } = {},
  ): Promise<string> {
    await this.enablePage(tabId)
    await this.revealGroup(tabId)
    const base = {
      format: "png",
      captureBeyondViewport: false,
      ...(options.clip ? { clip: options.clip } : {}),
    }
    // `fromSurface: true` exige uma superfície renderizada; em aba de segundo
    // plano pode falhar, então tentamos a captura da viewport como fallback.
    let lastError: unknown
    for (const fromSurface of [true, false]) {
      try {
        const result = await this.command<{ data?: string }>(tabId, "Page.captureScreenshot", {
          ...base,
          fromSurface,
        })
        if (result?.data) return result.data
        lastError = new Error(t("cdp.noImage"))
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(t("cdp.noScreenshot"))
  }

  /** Aba dentro de grupo colapsado não é renderizada; expandir não muda o foco. */
  private async revealGroup(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    const groupId = tab?.groupId
    if (groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    const group = await chrome.tabGroups.get(groupId).catch(() => undefined)
    if (!group?.collapsed) return
    await chrome.tabGroups.update(groupId, { collapsed: false }).catch(() => undefined)
  }

  async mouse(
    tabId: number,
    type: "mousePressed" | "mouseReleased" | "mouseMoved",
    x: number,
    y: number,
    options: { button?: "left" | "right" | "middle"; clickCount?: number; modifiers?: number } = {},
  ): Promise<void> {
    await this.enableFocusEmulation(tabId)
    await this.command(tabId, "Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: options.button ?? "left",
      clickCount: options.clickCount ?? 1,
      modifiers: options.modifiers ?? 0,
    })
  }

  async key(
    tabId: number,
    type: "keyDown" | "keyUp",
    key: string,
    options: { code?: string; windowsVirtualKeyCode?: number; modifiers?: number } = {},
  ): Promise<void> {
    await this.enableFocusEmulation(tabId)
    await this.command(tabId, "Input.dispatchKeyEvent", {
      type,
      key,
      code: options.code ?? key,
      windowsVirtualKeyCode: options.windowsVirtualKeyCode,
      modifiers: options.modifiers ?? 0,
    })
  }

  async wheel(tabId: number, x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.enableFocusEmulation(tabId)
    await this.command(tabId, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX,
      deltaY,
    })
  }

  async text(tabId: number, value: string): Promise<void> {
    await this.enableFocusEmulation(tabId)
    await this.command(tabId, "Input.insertText", { text: value })
  }

  consoleMessages(tabId: number): ConsoleEntry[] {
    return this.state(tabId).console
  }

  clearConsole(tabId: number): void {
    this.state(tabId).console = []
  }

  networkRequests(tabId: number): NetworkEntry[] {
    return this.state(tabId).networkEntries
  }

  clearNetwork(tabId: number): void {
    this.state(tabId).networkEntries = []
  }

  private onEvent(tabId: number, method: string, params: Record<string, unknown>): void {
    const state = this.state(tabId)
    if (method === "Runtime.consoleAPICalled") {
      const args = Array.isArray(params.args) ? params.args : []
      const text = args
        .map((arg) => {
          const item = arg as { value?: unknown; description?: string; type?: string }
          if (item.value !== undefined) {
            return typeof item.value === "string" ? item.value : JSON.stringify(item.value)
          }
          return item.description ?? item.type ?? ""
        })
        .join(" ")
      this.pushConsole(state, {
        type: typeof params.type === "string" ? params.type : "log",
        text,
        timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
      })
      return
    }
    if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails as
        | { text?: string; exception?: { description?: string }; url?: string; lineNumber?: number }
        | undefined
      this.pushConsole(state, {
        type: "exception",
        text: details?.exception?.description ?? details?.text ?? "Exceção",
        timestamp: Date.now(),
        url: details?.url,
        lineNumber: details?.lineNumber,
      })
      return
    }
    if (method === "Page.frameNavigated") {
      const frame = params.frame as { url?: string; parentId?: string } | undefined
      if (!frame?.parentId) {
        // Documento novo: a emulação de foco não sobrevive à navegação.
        state.focusEmulated = false
        if (frame?.url) {
          const next = domainOf(frame.url)
          if (state.domain && next && state.domain !== next) state.networkEntries = []
          state.domain = next
        }
      }
      return
    }
    if (method === "Network.requestWillBeSent") {
      const request = params.request as { url?: string; method?: string } | undefined
      const url = request?.url ?? ""
      const domain = domainOf(url)
      if (state.domain && domain && state.domain !== domain) return
      state.networkEntries.push({
        requestId: String(params.requestId ?? ""),
        url,
        method: request?.method ?? "GET",
        domain,
        timestamp: Date.now(),
      })
      if (state.networkEntries.length > MAX_NETWORK) state.networkEntries.shift()
      return
    }
    if (method === "Network.responseReceived") {
      const response = params.response as { status?: number } | undefined
      const entry = state.networkEntries.find((item) => item.requestId === params.requestId)
      if (entry && typeof response?.status === "number") entry.status = response.status
      return
    }
  }

  private pushConsole(
    state: TabState,
    entry: Omit<ConsoleEntry, "domain"> & { domain?: string },
  ): void {
    state.console.push({ ...entry, domain: entry.domain ?? state.domain })
    if (state.console.length > MAX_CONSOLE) state.console.shift()
  }
}
