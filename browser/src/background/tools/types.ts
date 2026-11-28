import type { ImagePayload } from "../../shared/types"
import type { Cdp } from "../cdp"
import type { Permissions } from "../permissions"
import type { TabGroups } from "../tabGroups"
import type { TreeOptions } from "./a11y"

export interface ToolResult {
  content: string
  images?: ImagePayload[]
  metadata?: Record<string, unknown>
}

export interface ToolContext {
  sessionID: string
  signal: AbortSignal
  cdp: Cdp
  permissions: Permissions
  tabs: TabGroups
  progress: (phase: string, detail?: string) => void
  indicator: (tabId: number, status: string, busy?: boolean) => Promise<void>
  hideIndicator: (tabId: number) => Promise<void>
  /** Move o mouse virtual; com `click`, espera a viagem e anima o clique. */
  cursor: (tabId: number, x: number, y: number, options?: { click?: boolean }) => Promise<void>
  rank?: (
    query: string,
    candidates: Array<{ ref: string; role: string; name: string; type?: string }>,
  ) => Promise<string[] | null>
  ask: (input: {
    kind: "action" | "plan" | "domain"
    tool: string
    title: string
    detail?: string
    url?: string
    screenshot?: string
    text?: string
    plan?: { domains: string[]; approach: string[] }
    fromDomain?: string
    toDomain?: string
  }) => Promise<boolean>
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>

export type ToolMap = Record<string, ToolHandler>

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function truncate(text: string, max = 50_000): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf("\n", max)
  return `${text.slice(0, cut > 0 ? cut : max)}\n\n[output truncated at ${max} characters]`
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = str(args[key])
  if (!value) throw new Error(`Missing required parameter: ${key}.`)
  return value
}

export function treeOptions(args: Record<string, unknown>): TreeOptions {
  return {
    filter: str(args.filter) === "interactive" ? "interactive" : "all",
    depth: num(args.depth),
    refId: str(args.ref_id) ?? str(args.refId),
    maxChars: num(args.max_chars) ?? num(args.maxChars),
    includeHidden: bool(args.include_hidden) ?? bool(args.includeHidden),
  }
}
