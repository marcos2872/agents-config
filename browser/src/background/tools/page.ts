import { generateTree, generateTreeFrames, listElements, listElementsFrames, pageText, pageTextFrames, setValue } from "./a11y"
import { tabContext, withIndicator } from "./tabs"
import type { ToolContext, ToolMap, ToolResult } from "./types"
import { requireString, treeOptions, truncate } from "./types"
import { t } from "../../shared/i18n/runtime"

async function resolveTab(args: Record<string, unknown>, ctx: ToolContext): Promise<number> {
  const requested = typeof args.tabId === "number" ? args.tabId : undefined
  return (await ctx.tabs.resolveTab(ctx.sessionID, requested)).tabId
}

function wantsAllFrames(args: Record<string, unknown>): boolean {
  return args.frames === "all" || args.all_frames === true || args.allFrames === true
}

export const pageTools: ToolMap = {
  async read_page(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    const allFrames = wantsAllFrames(args)
    return withIndicator(ctx, tabId, allFrames ? t("activity.readingPageAllFrames") : t("activity.readingPage"), async () => {
      if (allFrames) {
        const tree = await generateTreeFrames(tabId, treeOptions(args))
        const tabs = await tabContext(ctx, tabId)
        const header = `Frames lidos: ${tree.frames.length} (refs de iframes usam o prefixo f<frameId>_ref_N).`
        return {
          content: `${header}\n\n${truncate(tree.combined)}\n\n${tabs}`,
          metadata: { count: tree.count, frames: tree.frames.length },
        }
      }
      const tree = await generateTree(tabId, 0, treeOptions(args))
      const tabs = await tabContext(ctx, tabId)
      return {
        content: `${truncate(tree.pageContent)}\n\nViewport: ${tree.viewport.width}x${tree.viewport.height}\n\n${tabs}`,
        metadata: { count: tree.count, frames: 1 },
      }
    })
  },

  async find(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    const query = requireString(args, "query")
    const max = typeof args.max_results === "number" ? Math.min(Math.max(args.max_results, 1), 50) : 20
    const allFrames = wantsAllFrames(args)
    return withIndicator(ctx, tabId, `Procurando: ${query}`, async () => {
      const elements = allFrames ? await listElementsFrames(tabId) : await listElements(tabId, 0)
      const tokens = query
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
      const scored = elements
        .map((element) => {
          const haystack = [element.role, element.name, element.tag, element.type, element.value]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
          let score = 0
          for (const token of tokens) if (haystack.includes(token)) score += 2
          if (element.name.toLowerCase().includes(query.toLowerCase())) score += 3
          if (element.role.toLowerCase() === query.toLowerCase()) score += 2
          return { element, score }
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)

      let chosen = scored.slice(0, max)
      let rankedByModel = false
      if (ctx.rank) {
        const ranked = await ctx.rank(
          query,
          elements.slice(0, 200).map((element) => ({
            ref: element.ref,
            role: element.role,
            name: element.name,
            type: element.type,
          })),
        )
        if (ranked && ranked.length > 0) {
          const byRef = new Map(elements.map((element) => [element.ref, element]))
          const picked = ranked
            .map((ref) => byRef.get(ref))
            .filter((element): element is NonNullable<typeof element> => Boolean(element))
            .slice(0, max)
          if (picked.length > 0) {
            chosen = picked.map((element) => ({ element, score: 99 }))
            rankedByModel = true
          }
        }
      }

      if (chosen.length === 0) {
        return {
          content: `No elements found for "${query}".\nTry simpler terms or use read_page with filter "interactive".`,
        }
      }
      const lines = chosen.map(
        ({ element }) =>
          `- ${element.ref}: ${element.role}${element.name ? ` "${element.name}"` : ""}${
            element.type ? ` (${element.type})` : ""
          }${element.disabled ? " (disabled)" : ""}`,
      )
      const mode = rankedByModel ? " (ranking por modelo)" : ""
      const frameNote = allFrames ? " em todos os frames" : ""
      return {
        content: `Encontrados ${chosen.length} elemento(s) para "${query}"${mode}${frameNote}:\n\n${lines.join(
          "\n",
        )}\n\n${await tabContext(ctx, tabId)}`,
        metadata: { count: chosen.length, rankedByModel },
      }
    })
  },

  async get_page_text(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    const max = typeof args.max_chars === "number" ? Math.min(Math.max(args.max_chars, 1000), 200_000) : 50_000
    const allFrames = wantsAllFrames(args)
    return withIndicator(ctx, tabId, "Extraindo texto", async () => {
      const page = allFrames ? await pageTextFrames(tabId, max) : await pageText(tabId, 0, max)
      if (!page.text.trim()) throw new Error("The page has no readable text.")
      return {
        content: `Title: ${page.title}\nURL: ${page.url}\nSource: <${page.source}>\n---\n${truncate(
          page.text,
          max,
        )}`,
        metadata: { source: page.source, frames: allFrames ? "all" : "main" },
      }
    })
  },

  async form_input(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    const ref = requireString(args, "ref")
    const value =
      typeof args.value === "string"
        ? args.value
        : typeof args.value === "number" || typeof args.value === "boolean"
          ? String(args.value)
          : ""
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    const allowed = await ctx.ask({
      kind: "action",
      tool: "form_input",
      title: t("permission.ask.fillField", { ref }),
      detail: tab?.title,
      url: tab?.url,
      text: value.slice(0, 2000),
    })
    if (!allowed) return { content: "Fill denied by the user." }
    const result = await withIndicator(ctx, tabId, `Filling ${ref}`, () => setValue(tabId, ref, value))
    if (!result.ok) throw new Error(result.error ?? "Falha ao preencher o campo.")
    return {
      content: `Field ${ref} filled.\n\n${await tabContext(ctx, tabId)}`,
      metadata: { ref },
    }
  },
}
