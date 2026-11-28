import type { ToolMap, ToolResult } from "./types"
import { t } from "../../shared/i18n/runtime"
import { truncate } from "./types"

export const planTools: ToolMap = {
  async update_plan(args, ctx): Promise<ToolResult> {
    const domains = Array.isArray(args.domains)
      ? args.domains.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
    const approach = Array.isArray(args.approach)
      ? args.approach.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
    if (domains.length === 0 || approach.length === 0) {
      throw new Error("update_plan requires `domains` and `approach` as non-empty arrays.")
    }
    const first = domains[0]
    const allowed = await ctx.ask({
      kind: "plan",
      tool: "update_plan",
      title: t("permission.ask.approvePlan"),
      detail: approach.join("\n"),
      url: /^https?:\/\//i.test(first) ? first : `https://${first}`,
      plan: { domains, approach },
    })
    if (!allowed) {
      return {
        content: "Plan declined by the user. Do not navigate to the proposed domains.",
        metadata: { approved: false },
      }
    }
    for (const domain of domains) {
      ctx.permissions.allowForSession(ctx.sessionID, domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    }
    return {
      content: `Plan approved. Domains allowed in this session: ${domains.join(", ")}.\n\n${truncate(
        approach.map((step, index) => `${index + 1}. ${step}`).join("\n"),
        4000,
      )}`,
      metadata: { approved: true, domains },
    }
  },
}
