import { uploadFiles } from "./a11y"
import { withIndicator } from "./tabs"
import type { ToolContext, ToolMap, ToolResult } from "./types"
import { requireString } from "./types"
import { t } from "../../shared/i18n/runtime"

const MAX_FILES = 3
const MAX_BASE64 = 7 * 1024 * 1024

function parseFiles(input: unknown): Array<{ data: string; name: string; mimeType?: string }> {
  if (!Array.isArray(input)) return []
  const files: Array<{ data: string; name: string; mimeType?: string }> = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Record<string, unknown>
    const data = typeof item.data === "string" ? item.data : ""
    if (!data) continue
    const name =
      typeof item.name === "string" && item.name.trim().length > 0
        ? item.name.trim()
        : `file-${files.length + 1}.bin`
    if (data.length > MAX_BASE64) {
      throw new Error(`File ${name} exceeds the ~5 MB limit.`)
    }
    const mimeType =
      typeof item.mimeType === "string"
        ? item.mimeType
        : typeof item.mime_type === "string"
          ? item.mime_type
          : undefined
    files.push({ data, name, mimeType })
    if (files.length >= MAX_FILES) break
  }
  return files
}

async function resolveTab(args: Record<string, unknown>, ctx: ToolContext): Promise<number> {
  const requested = typeof args.tabId === "number" ? args.tabId : undefined
  return (await ctx.tabs.resolveTab(ctx.sessionID, requested)).tabId
}

export const uploadTools: ToolMap = {
  async upload_image(args, ctx): Promise<ToolResult> {
    const tabId = await resolveTab(args, ctx)
    const ref = requireString(args, "ref")
    const files = parseFiles(args.files)
    if (files.length === 0) {
      throw new Error("Provide `files` with [{ data: <base64>, name, mimeType }].")
    }
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    const allowed = await ctx.ask({
      kind: "action",
      tool: "upload_image",
      title: t("permission.ask.upload"),
      detail: files.map((file) => file.name).join(", "),
      url: tab?.url,
    })
    if (!allowed) return { content: "Upload denied by the user." }
    const result = await withIndicator(ctx, tabId, "Uploading file", () =>
      uploadFiles(tabId, ref, files),
    )
    if (!result.ok) throw new Error(result.error ?? "Failed to send the file.")
    return {
      content: `File(s) uploaded (${files.map((file) => file.name).join(", ")}) via ${
        result.target === "input" ? "file input" : "drag & drop"
      }.`,
      metadata: { ref, count: files.length },
    }
  },
}
