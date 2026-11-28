import type { ImagePayload } from "../../shared/types"
import type { ToolContext, ToolHandler, ToolMap, ToolResult } from "./types"


export class ToolRegistry {
  private tools = new Map<string, ToolHandler>()

  constructor(modules: ToolMap[]) {
    for (const module of modules) {
      for (const [name, handler] of Object.entries(module)) {
        this.tools.set(name, handler)
      }
    }
  }

  list(): string[] {
    return [...this.tools.keys(), "browser_batch"].sort()
  }

  async run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.signal.aborted) throw new Error("Execution interrupted by the user.")
    const normalized = name.replace(/^browser_/, "")
    if (normalized === "browser_batch" || normalized === "batch") {
      return this.batch(args, ctx)
    }
    const handler = this.tools.get(normalized)
    if (!handler) throw new Error(`Unknown tool: ${name}.`)
    return handler(args, ctx)
  }

  private async batch(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const actions = Array.isArray(args.actions) ? args.actions : []
    if (actions.length === 0) throw new Error("browser_batch requires `actions`.")
    if (actions.length > 20) throw new Error("browser_batch accepts at most 20 actions.")
    const results: Array<{ index: number; name: string; ok: boolean; output?: string; error?: string }> = []
    // Capturas feitas dentro do lote precisam voltar para o agente, não só o texto.
    const images: ImagePayload[] = []
    for (const [index, raw] of actions.entries()) {
      if (ctx.signal.aborted) {
        results.push({ index, name: "?", ok: false, error: "Interrupted by the user." })
        break
      }
      if (!raw || typeof raw !== "object") {
        results.push({ index, name: "?", ok: false, error: "Invalid action." })
        continue
      }
      const item = raw as { name?: unknown; input?: unknown }
      const name = typeof item.name === "string" ? item.name : ""
      const input =
        item.input && typeof item.input === "object" && !Array.isArray(item.input)
          ? (item.input as Record<string, unknown>)
          : {}
      if (!name || name === "browser_batch" || name === "batch") {
        results.push({ index, name, ok: false, error: "Invalid action name." })
        continue
      }
      try {
        const result = await this.run(name, input, ctx)
        results.push({ index, name, ok: true, output: result.content })
        if (result.images) images.push(...result.images)
      } catch (error) {
        results.push({
          index,
          name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const ok = results.every((item) => item.ok)
    return {
      content: JSON.stringify({ ok, results }, null, 2),
      images: images.length ? images : undefined,
      metadata: { ok },
    }
  }
}
