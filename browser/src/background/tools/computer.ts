import { clickRef, focusRef, hoverRef, isMainFrameRef, resolveRef, scrollRef } from "./a11y"
import { hideOverlay } from "../overlay"
import { withIndicator } from "./tabs"
import type { ToolContext, ToolMap, ToolResult } from "./types"
import { num, requireString, truncate } from "./types"
import { t } from "../../shared/i18n/runtime"

async function resolveTab(args: Record<string, unknown>, ctx: ToolContext): Promise<number> {
  const requested = typeof args.tabId === "number" ? args.tabId : undefined
  return (await ctx.tabs.resolveTab(ctx.sessionID, requested)).tabId
}

const MODIFIERS: Record<string, number> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  win: 4,
  shift: 8,
}

type KeyDetails = {
  key: string
  code: string
  windowsVirtualKeyCode?: number
}

const NAMED_KEYS: Record<string, KeyDetails> = {
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  del: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  end: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
  insert: { key: "Insert", code: "Insert", windowsVirtualKeyCode: 45 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
}

function parseKey(input: string): { key: string; modifiers: number } {
  const parts = input.split("+").map((part) => part.trim()).filter(Boolean)
  let modifiers = 0
  const keys: string[] = []
  for (const part of parts) {
    const value = MODIFIERS[part.toLowerCase()]
    if (value !== undefined) modifiers |= value
    else keys.push(part)
  }
  return { key: keys.at(-1) ?? input, modifiers }
}

function keyDetails(key: string, modifiers: number): KeyDetails {
  const letter = /^[a-z]$/i.test(key) ? key.toUpperCase() : undefined
  if (letter) {
    const shifted = (modifiers & MODIFIERS.shift) !== 0
    return {
      key: shifted ? letter : letter.toLowerCase(),
      code: `Key${letter}`,
      windowsVirtualKeyCode: letter.charCodeAt(0),
    }
  }

  if (/^[0-9]$/.test(key)) {
    if ((modifiers & MODIFIERS.shift) !== 0) {
      throw new Error(
        `Cannot infer the shifted character for ${key} without the keyboard layout. Pass the intended symbol directly (for example, "!") instead of "Shift+${key}".`,
      )
    }
    return { key, code: `Digit${key}`, windowsVirtualKeyCode: key.charCodeAt(0) }
  }

  const named = NAMED_KEYS[key.toLowerCase()]
  if (named) return named

  const functionKey = /^F([1-9]|1[0-2])$/i.exec(key)
  if (functionKey) {
    const normalized = `F${functionKey[1]}`
    return { key: normalized, code: normalized, windowsVirtualKeyCode: 111 + Number(functionKey[1]) }
  }

  // Símbolos são valores lógicos; sem o layout não inventamos um código físico.
  return { key, code: "" }
}

async function pointFor(
  args: Record<string, unknown>,
  ctx: ToolContext,
  tabId: number,
): Promise<{ x: number; y: number }> {
  const ref = typeof args.ref === "string" ? args.ref : undefined
  if (ref) {
    const element = await resolveRef(tabId, ref)
    if (!element) throw new Error(`Ref ${ref} not found.`)
    return { x: element.x ?? 0, y: element.y ?? 0 }
  }
  const coordinate = args.coordinate
  if (Array.isArray(coordinate) && coordinate.length >= 2) {
    const x = Number(coordinate[0])
    const y = Number(coordinate[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid coordinate.")
    return { x, y }
  }
  throw new Error("Provide `ref` or `coordinate`.")
}

async function adoptOpenerTabs(ctx: ToolContext, tabId: number): Promise<number[]> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (!tab?.windowId) return []
  const groupId = await ctx.tabs.groupOf(ctx.sessionID)
  if (groupId === null) return []
  const tabs = await chrome.tabs.query({ windowId: tab.windowId })
  const adopted: number[] = []
  for (const candidate of tabs) {
    if (candidate.id === undefined || candidate.groupId === groupId) continue
    if (candidate.openerTabId !== tabId) continue
    await ctx.tabs.addTab(ctx.sessionID, candidate.id)
    adopted.push(candidate.id)
  }
  return adopted
}

export const computerTools: ToolMap = {
  async computer(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    const action = requireString(args, "action")
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)

    if (action === "wait") {
      const seconds = Math.min(Math.max(num(args.duration) ?? 1, 0.1), 10)
      await withIndicator(ctx, tabId, `Aguardando ${seconds}s`, () => sleep(seconds * 1000))
      return { content: `Aguardou ${seconds}s.` }
    }

    if (action === "screenshot") {
      const allowed = await ctx.ask({
        kind: "action",
        tool: "computer",
        title: t("permission.ask.screenshot"),
        detail: tab?.title,
        url: tab?.url,
      })
      if (!allowed) return { content: "Screenshot denied by the user." }
      return withIndicator(ctx, tabId, "Capturando screenshot", async () => {
        await hideOverlay(tabId)
        const data = await ctx.cdp.screenshot(tabId)
        return {
          content: `Screenshot captured (${tab?.title ?? "page"}).`,
          images: [{ name: `screenshot-${Date.now()}.png`, mime: "image/png", data }],
        }
      })
    }

    if (action === "zoom") {
      const allowed = await ctx.ask({
        kind: "action",
        tool: "computer",
        title: t("permission.ask.zoom"),
        detail: tab?.title,
        url: tab?.url,
      })
      if (!allowed) return { content: "Capture denied by the user." }
      const region = args.region
      let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined
      if (Array.isArray(region) && region.length >= 4) {
        const [x1, y1, x2, y2] = region.map(Number)
        clip = {
          x: Math.max(0, Math.min(x1, x2)),
          y: Math.max(0, Math.min(y1, y2)),
          width: Math.max(1, Math.abs(x2 - x1)),
          height: Math.max(1, Math.abs(y2 - y1)),
          scale: 2,
        }
      }
      return withIndicator(ctx, tabId, t("activity.capturingRegion"), async () => {
        await hideOverlay(tabId)
        const data = await ctx.cdp.screenshot(tabId, clip ? { clip } : {})
        return {
          content: "Region captured.",
          images: [{ name: `zoom-${Date.now()}.png`, mime: "image/png", data }],
        }
      })
    }

    const allowed = await ctx.ask({
      kind: "action",
      tool: "computer",
      title: actionTitle(action),
      detail: actionDetail(args),
      url: tab?.url,
      text: typeof args.text === "string" ? args.text.slice(0, 2000) : undefined,
    })
    if (!allowed) return { content: "Action denied by the user." }

    if (action === "click") {
      const ref = typeof args.ref === "string" ? args.ref : undefined
      if (ref && !isMainFrameRef(ref)) {
        const result = await withIndicator(ctx, tabId, t("activity.clickingShort"), () => clickRef(tabId, ref))
        if (!result.ok) throw new Error(result.error ?? "Failed to click the element.")
        await sleep(200)
        const adopted = await adoptOpenerTabs(ctx, tabId)
        const suffix =
          adopted.length > 0
            ? `\nThe new tab opened as Tab ID ${adopted.join(", ")} and joined this session's group.`
            : ""
        return { content: `Clicked ${ref} (iframe, via DOM events).${suffix}` }
      }
      const point = await pointFor(args, ctx, tabId)
      const button = args.button === "right" ? "right" : args.button === "middle" ? "middle" : "left"
      const count = Math.min(Math.max(num(args.click_count) ?? num(args.clickCount) ?? 1, 1), 3)
      await ctx.indicator(tabId, t("activity.clickingShort"), true)
      await ctx.cursor(tabId, point.x, point.y, { click: true })
      try {
        await ctx.cdp.mouse(tabId, "mouseMoved", point.x, point.y)
        for (let index = 1; index <= count; index += 1) {
          await ctx.cdp.mouse(tabId, "mousePressed", point.x, point.y, { button, clickCount: index })
          await ctx.cdp.mouse(tabId, "mouseReleased", point.x, point.y, { button, clickCount: index })
        }
      } catch (error) {
        if (!ref) {
          await ctx.hideIndicator(tabId)
          throw error
        }
        const fallback = await clickRef(tabId, ref)
        if (!fallback.ok) {
          await ctx.hideIndicator(tabId)
          throw new Error(fallback.error ?? "Failed to click (DevTools open?).", { cause: error })
        }
      }
      await sleep(250)
      const adopted = await adoptOpenerTabs(ctx, tabId)
      await ctx.hideIndicator(tabId)
      const suffix =
        adopted.length > 0
          ? `\nThe new tab opened as Tab ID ${adopted.join(", ")} and joined this session's group.`
          : ""
      return { content: `Clicked (${Math.round(point.x)}, ${Math.round(point.y)}).${suffix}` }
    }

    if (action === "hover") {
      return withIndicator(ctx, tabId, t("activity.hoveringShort"), async () => {
        const ref = typeof args.ref === "string" ? args.ref : undefined
        if (ref && !isMainFrameRef(ref)) {
          const result = await hoverRef(tabId, ref)
          if (!result.ok) throw new Error(result.error ?? "Falha no hover.")
          return { content: `Hover em ${ref} (iframe, via eventos de DOM).` }
        }
        const point = await pointFor(args, ctx, tabId)
        await ctx.cursor(tabId, point.x, point.y)
        try {
          await ctx.cdp.mouse(tabId, "mouseMoved", point.x, point.y)
        } catch (error) {
          if (!ref) throw error
          const fallback = await hoverRef(tabId, ref)
          if (!fallback.ok) throw new Error(fallback.error ?? "Falha no hover (DevTools aberto?).", { cause: error })
        }
        return { content: `Hover em (${Math.round(point.x)}, ${Math.round(point.y)}).` }
      })
    }

    if (action === "type") {
      const text = typeof args.text === "string" ? args.text : ""
      if (!text) throw new Error("Informe `text`.")
      await ctx.indicator(tabId, "Digitando", true)
      try {
        if (typeof args.ref === "string") {
          if (!isMainFrameRef(args.ref)) {
            const result = await focusRef(tabId, args.ref)
            if (!result.ok) throw new Error(result.error ?? "Falha ao focar o campo.")
            await sleep(80)
          } else {
            const point = await pointFor(args, ctx, tabId)
            await ctx.cursor(tabId, point.x, point.y, { click: true })
            await ctx.cdp.mouse(tabId, "mousePressed", point.x, point.y, { button: "left", clickCount: 1 })
            await ctx.cdp.mouse(tabId, "mouseReleased", point.x, point.y, { button: "left", clickCount: 1 })
            await sleep(100)
          }
        }
        await ctx.cdp.text(tabId, text)
        if (args.submit === true) {
          await ctx.cdp.key(tabId, "keyDown", "Enter", { code: "Enter", windowsVirtualKeyCode: 13 })
          await ctx.cdp.key(tabId, "keyUp", "Enter", { code: "Enter", windowsVirtualKeyCode: 13 })
        }
        await sleep(150)
        await adoptOpenerTabs(ctx, tabId)
      } finally {
        await ctx.hideIndicator(tabId)
      }
      return { content: `Digitou ${text.length} caractere(s)${args.submit === true ? " e pressionou Enter" : ""}.` }
    }

    if (action === "key") {
      const raw = requireString(args, "keys")
      const { key, modifiers } = parseKey(raw)
      const details = keyDetails(key, modifiers)
      const options = { code: details.code, windowsVirtualKeyCode: details.windowsVirtualKeyCode, modifiers }
      await ctx.cdp.key(tabId, "keyDown", details.key, options)
      await ctx.cdp.key(tabId, "keyUp", details.key, options)
      await sleep(150)
      await adoptOpenerTabs(ctx, tabId)
      return { content: `Tecla ${raw} pressionada.` }
    }

    if (action === "scroll") {
      const direction = typeof args.scroll_direction === "string" ? args.scroll_direction : "down"
      if (!["up", "down", "left", "right"].includes(direction)) {
        throw new Error(`Invalid scroll direction: ${direction}. Use up, down, left or right.`)
      }
      const amount = Math.min(Math.max(num(args.scroll_amount) ?? 600, 50), 5000)
      const ref = typeof args.ref === "string" ? args.ref : undefined
      if (ref && !isMainFrameRef(ref)) {
        const result = await withIndicator(ctx, tabId, t("activity.scrollingShort"), () => scrollRef(tabId, ref))
        if (!result.ok) throw new Error(result.error ?? "Failed to scroll to the element.")
        return { content: `Scrolled to ${ref} (iframe).` }
      }
      const point =
        typeof args.ref === "string" || Array.isArray(args.coordinate)
          ? await pointFor(args, ctx, tabId)
          : await center(tabId)
      const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0
      const deltaY = direction === "up" ? -amount : direction === "down" ? amount : 0
      await ctx.indicator(tabId, "Rolando", true)
      await ctx.cursor(tabId, point.x, point.y)
      try {
        await ctx.cdp.wheel(tabId, point.x, point.y, deltaX, deltaY)
        await sleep(250)
      } finally {
        await ctx.hideIndicator(tabId)
      }
      return { content: `Scrolled ${direction} by ${amount}px.` }
    }

    throw new Error(`Unknown action: ${action}`)
  },

  async javascript_tool(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    const code = requireString(args, "text")
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    const allowed = await ctx.ask({
      kind: "action",
      tool: "javascript_tool",
      title: t("permission.ask.javascript"),
      detail: tab?.title,
      url: tab?.url,
      text: code.slice(0, 2000),
    })
    if (!allowed) return { content: "Execution denied by the user." }
    return withIndicator(ctx, tabId, t("activity.runningJs"), async () => {
      const result = await ctx.cdp.evaluate(tabId, code, { awaitPromise: true, timeoutMs: 10_000 })
      if (result.exception) {
        return { content: `Execution error: ${truncate(result.exception, 5000)}` }
      }
      const value = result.value
      const text =
        value === undefined
          ? "undefined"
          : typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2)
      return { content: truncate(text), metadata: { tabId } }
    })
  },

  async read_console_messages(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    await ctx.cdp.enableRuntime(tabId)
    await sleep(200)
    const pattern = typeof args.pattern === "string" ? args.pattern : undefined
    const onlyErrors = args.onlyErrors === true || args.only_errors === true
    const limit = Math.min(Math.max(num(args.limit) ?? 100, 1), 500)
    const clear = args.clear === true
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    const host = ctx.permissions.hostOf(tab?.url)
    const entries = ctx.cdp
      .consoleMessages(tabId)
      .filter((entry) => !entry.domain || !host || entry.domain === host)
      .filter((entry) => !onlyErrors || entry.type === "error" || entry.type === "exception")
      .filter((entry) => !pattern || entry.text.toLowerCase().includes(pattern.toLowerCase()))
    if (clear) ctx.cdp.clearConsole(tabId)
    if (entries.length === 0) {
      return {
        content:
          "No console messages found.\n\nMonitoring starts when this tool is used; reload the page to capture loading messages.",
      }
    }
    const slice = entries.slice(-limit)
    const lines = slice.map((entry, index) => {
      const where = entry.url && entry.lineNumber !== undefined ? ` (${entry.url}:${entry.lineNumber})` : ""
      return `[${index + 1}] [${entry.type.toUpperCase()}]${where}\n${entry.text}`
    })
    return { content: `Found ${entries.length} message(s)${entries.length > limit ? ` (showing ${limit})` : ""}:\n\n${lines.join("\n\n")}` }
  },

  async read_network_requests(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    await ctx.cdp.enableNetwork(tabId)
    await sleep(200)
    const pattern = typeof args.urlPattern === "string" ? args.urlPattern : typeof args.url_pattern === "string" ? args.url_pattern : undefined
    const limit = Math.min(Math.max(num(args.limit) ?? 100, 1), 500)
    const clear = args.clear === true
    const entries = ctx.cdp
      .networkRequests(tabId)
      .filter((entry) => !pattern || entry.url.toLowerCase().includes(pattern.toLowerCase()))
    if (clear) ctx.cdp.clearNetwork(tabId)
    if (entries.length === 0) {
      return {
        content:
          "No requests found.\n\nMonitoring starts when this tool is used; reload the page to capture the initial requests.",
      }
    }
    const slice = entries.slice(-limit)
    const lines = slice.map(
      (entry, index) => `${index + 1}. url: ${entry.url}\n   method: ${entry.method}\n   statusCode: ${entry.status ?? "pending"}`,
    )
    return { content: `Found ${entries.length} request(s)${entries.length > limit ? ` (showing ${limit})` : ""}:\n\n${lines.join("\n\n")}` }
  },
}

function actionTitle(action: string): string {
  switch (action) {
    case "click":
      return t("permission.ask.click")
    case "type":
      return t("permission.ask.type")
    case "key":
      return t("permission.ask.key")
    case "scroll":
      return t("permission.ask.scroll")
    case "hover":
      return t("permission.ask.hover")
    default:
      return t("permission.ask.action", { action })
  }
}

function actionDetail(args: Record<string, unknown>): string | undefined {
  if (typeof args.ref === "string") return `Element ${args.ref}`
  if (Array.isArray(args.coordinate)) {
    const [x, y] = args.coordinate
    return t("permission.ask.coordinate", { x: Number(x), y: Number(y) })
  }
  if (typeof args.keys === "string") return args.keys
  return undefined
}

async function center(tabId: number): Promise<{ x: number; y: number }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }),
  })
  return (result?.result as { x: number; y: number } | undefined) ?? { x: 400, y: 300 }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
