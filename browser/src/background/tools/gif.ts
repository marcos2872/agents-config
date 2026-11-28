import type { Recording } from "../recording"
import type { ToolMap, ToolResult } from "./types"
import { t } from "../../shared/i18n/runtime"
import { requireString } from "./types"

export function gifTools(recording: Recording): ToolMap {
  return {
    async gif_creator(args, ctx): Promise<ToolResult> {
      const action = requireString(args, "action")
      if (action === "start") {
        recording.start(ctx.sessionID)
        const { tabId } = await ctx.tabs.resolveTab(ctx.sessionID)
        await recording.capture(tabId, "recording start")
        return { content: "Recording started. Each agent action adds a frame (max 30)." }
      }
      if (action === "stop") {
        await recording.stop()
        return {
          content: `Recording stopped (${recording.count} frame(s)). Use action=export to generate the GIF.`,
        }
      }
      if (action === "export") {
        const frames = await recording.take()
        if (frames.length === 0) {
          throw new Error("No frames recorded. Use action=start before navigating/interacting.")
        }
        const requested = typeof args.tabId === "number" ? args.tabId : undefined
        const tab = await chrome.tabs
          .get((await ctx.tabs.resolveTab(ctx.sessionID, requested)).tabId)
          .catch(() => undefined)
        const allowed = await ctx.ask({
          kind: "action",
          tool: "gif_creator",
          title: t("permission.ask.exportGif"),
          detail: `${frames.length} frames`,
          url: tab?.url,
        })
        if (!allowed) return { content: "Export denied by the user." }
        const response = (await chrome.runtime.sendMessage({
          type: "ENCODE_GIF",
          frames,
          delay: 600,
        })) as { data?: string; error?: string } | undefined
        if (!response?.data) {
          throw new Error(response?.error ?? "Failed to generate the GIF (offscreen unavailable).")
        }
        const filename = `pi-browser-${Date.now()}.gif`
        try {
          await chrome.downloads.download({
            url: `data:image/gif;base64,${response.data}`,
            filename,
            saveAs: false,
          })
        } catch {
          // O download pode falhar; o GIF ainda é devolvido no resultado.
        }
        recording.clear()
        const size = Math.round((response.data.length * 3) / 4 / 1024)
        return {
          content: `GIF generated (${frames.length} frames, ~${size} KB) and saved to Downloads/${filename}.`,
          images: [{ name: filename, mime: "image/gif", data: response.data }],
          metadata: { frames: frames.length, filename },
        }
      }
      throw new Error(`Unknown action: ${action}. Use start, stop or export.`)
    },
  }
}
