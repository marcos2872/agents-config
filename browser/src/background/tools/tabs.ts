import type { ToolContext, ToolMap, ToolResult } from "./types"
import { t } from "../../shared/i18n/runtime"

export async function tabContext(ctx: ToolContext, tabId: number): Promise<string> {
  const [tabs, groupId] = await Promise.all([ctx.tabs.list(ctx.sessionID), ctx.tabs.groupOf(ctx.sessionID)])
  const validGroup = typeof groupId === "number" && Number.isFinite(groupId) ? groupId : null
  return JSON.stringify(
    {
      currentTabId: tabId,
      ...(validGroup !== null ? { tabGroupId: validGroup } : {}),
      availableTabs: tabs.map((tab) => ({ tabId: tab.id, title: tab.title, url: tab.url })),
      tabCount: tabs.length,
    },
    null,
    2,
  )
}

async function resolve(ctx: ToolContext, args: Record<string, unknown>): Promise<number> {
  const requested = typeof args.tabId === "number" ? args.tabId : undefined
  const { tabId } = await ctx.tabs.resolveTab(ctx.sessionID, requested)
  return tabId
}

async function currentHost(ctx: ToolContext, tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  return ctx.permissions.hostOf(tab?.url)
}

export const tabsTools: ToolMap = {
  async tabs_context(args, ctx) {
    const createIfEmpty = args.createIfEmpty === true || args.create_if_empty === true
    let tabs = await ctx.tabs.list(ctx.sessionID)
    if (tabs.length === 0 && createIfEmpty) {
      await ctx.tabs.ensure(ctx.sessionID)
      tabs = await ctx.tabs.list(ctx.sessionID)
    }
    const [groupId, mainTabId] = await Promise.all([
      ctx.tabs.groupOf(ctx.sessionID),
      ctx.tabs.currentTabId(ctx.sessionID),
    ])
    const active = mainTabId !== null
      ? tabs.find((tab) => tab.id === mainTabId) ?? tabs.find((tab) => tab.active) ?? tabs[0]
      : tabs.find((tab) => tab.active) ?? tabs[0]
    const output = JSON.stringify(
      {
        ...(groupId !== null ? { tabGroupId: groupId } : {}),
        ...(active ? { currentTabId: active.id } : {}),
        availableTabs: tabs.map((tab) => ({ tabId: tab.id, title: tab.title, url: tab.url })),
        tabCount: tabs.length,
      },
      null,
      2,
    )
    return { content: output }
  },

  async tabs_create(args, ctx) {
    const url = typeof args.url === "string" && args.url.length > 0 ? args.url : "about:blank"
    // Criar aba não traz a janela para frente, a menos que o usuário peça
    // `active: true` e tenha liberado a ativação nas configurações.
    const wantsActive = args.active === true
    const tabId = await ctx.tabs.createTab(ctx.sessionID, url, wantsActive)
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    const note = tab?.active === false
      ? "\n\nThe tab stayed in the background. Enable “Bring tabs to front” in the settings to see it in the foreground."
      : ""
    return {
      content: `Tab created. Tab ID: ${tabId}${note}\n\n${await tabContext(ctx, tabId)}`,
      metadata: { tabId },
    }
  },

  async tabs_close(args, ctx) {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined
    if (tabId === undefined) throw new Error("Missing required parameter: tabId.")
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    const allowed = await ctx.ask({
      kind: "action",
      tool: "tabs_close",
      title: t("permission.ask.closeTab"),
      detail: tab?.title ?? t("permission.ask.tab", { id: tabId }),
      url: tab?.url,
    })
    if (!allowed) return { content: "Action denied by the user. No tab was closed." }
    await ctx.tabs.closeTab(ctx.sessionID, tabId)
    const tabs = await ctx.tabs.list(ctx.sessionID)
    return {
      content: `Tab ${tabId} closed. ${tabs.length} remaining tab(s).\n\n${JSON.stringify(
        { availableTabs: tabs.map((item) => ({ tabId: item.id, title: item.title, url: item.url })), tabCount: tabs.length },
        null,
        2,
      )}`,
    }
  },

  async tabs_attach(args, ctx) {
    let tabId = typeof args.tabId === "number" ? args.tabId : undefined
    if (tabId === undefined) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      tabId = active?.id
    }
    if (tabId === undefined) throw new Error("No active tab found to attach.")
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab) throw new Error("Tab not found.")
    if (!/^https?:/i.test(tab.url ?? "")) {
      throw new Error("Only http(s) tabs can be attached.")
    }
    // Falha rápido: não pede permissão para uma anexação que será recusada.
    await ctx.tabs.assertAttachable(ctx.sessionID, tabId)
    const allowed = await ctx.ask({
      kind: "action",
      tool: "tabs_attach",
      title: t("permission.ask.attachTab"),
      detail: tab.title,
      url: tab.url,
    })
    if (!allowed) return { content: "Attach denied by the user." }
    await ctx.tabs.addTab(ctx.sessionID, tabId, { makeMain: true, activate: true })
    return {
      content: `Tab attached to this session's group.\n\n${await tabContext(ctx, tabId)}`,
      metadata: { tabId },
    }
  },

  async navigate(args, ctx) {
    const tabId = await resolve(ctx, args)
    const direction = args.direction
    if (direction === "back" || direction === "forward") {
      const tab = await chrome.tabs.get(tabId)
      if (direction === "back") await chrome.tabs.goBack(tabId)
      else await chrome.tabs.goForward(tabId)
      await waitForLoad(tabId).catch(() => undefined)
      return { content: `Went ${direction === "back" ? "back" : "forward"} from ${tab.url ?? ""}.` }
    }

    let raw = typeof args.url === "string" ? args.url.trim() : ""
    if (!raw) throw new Error("Provide `url` or `direction` (back/forward).")
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error(`Invalid URL: ${raw}`)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Only http(s) navigation is allowed.")
    }

    const from = await currentHost(ctx, tabId)
    const to = url.hostname
    const allowed = await ctx.ask({
      kind: from && to && from !== to ? "domain" : "action",
      tool: "navigate",
      title:
        from && to && from !== to
          ? t("permission.ask.navigateFromTo", { from, to })
          : t("permission.ask.navigateTo", { to }),
      detail: url.toString(),
      url: url.toString(),
      fromDomain: from || undefined,
      toDomain: to,
    })
    if (!allowed) return { content: "Navigation denied by the user." }

    await chrome.tabs.update(tabId, { url: url.toString() })
    await waitForLoad(tabId).catch(() => undefined)
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    return {
      content: `Navigated to ${tab?.url ?? url.toString()}\n\n${await tabContext(ctx, tabId)}`,
    }
  },

  async resize_window(args, ctx) {
    const tabId = await resolve(ctx, args)
    const width = typeof args.width === "number" ? Math.round(args.width) : undefined
    const height = typeof args.height === "number" ? Math.round(args.height) : undefined
    if (!width || !height) throw new Error("Provide width and height.")
    const tab = await chrome.tabs.get(tabId)
    if (!tab.windowId) throw new Error("Tab has no window.")
    await chrome.windows.update(tab.windowId, { width, height })
    return { content: `Window resized to ${width}x${height}.` }
  },
}

function waitForLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error("Timed out waiting for the page to load."))
    }, timeoutMs)
    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId !== tabId || info.status !== "complete") return
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") {
          clearTimeout(timer)
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      },
      () => undefined,
    )
  })
}

export async function withIndicator<T>(
  ctx: ToolContext,
  tabId: number,
  status: string,
  task: () => Promise<T>,
): Promise<T> {
  await ctx.indicator(tabId, status, true)
  try {
    return await task()
  } finally {
    await ctx.hideIndicator(tabId)
  }
}

export type { ToolResult }
