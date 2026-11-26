import { describe, expect, test } from "bun:test";
import {
  COPILOT_REFRESH_MS,
  fetchCopilotUsage,
  parseCopilotCredentialValue,
  parseCopilotUsage,
} from "./usage.ts";

describe("parseCopilotCredentialValue", () => {
  test("trata expires zero como expiração desconhecida", () => {
    const credential = parseCopilotCredentialValue({
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: 0,
    });

    expect(credential?.token).toBe("access-token");
    expect(credential?.expiresAt).toBeUndefined();
  });

  test("usa refresh quando access está vencido ou ausente", () => {
    const expiredAccess = parseCopilotCredentialValue({
      type: "oauth",
      access: "expired-access",
      refresh: "refresh-token",
      expires: 1,
    });
    const noAccess = parseCopilotCredentialValue({
      type: "oauth",
      refresh: "refresh-token",
      expires: 0,
    });

    expect(expiredAccess?.token).toBe("refresh-token");
    expect(expiredAccess?.expiresAt).toBeUndefined();
    expect(noAccess?.token).toBe("refresh-token");
  });
});

describe("parseCopilotUsage", () => {
  test("reads finite quotas, unlimited categories, plan, and reset date", () => {
    const usage = parseCopilotUsage({
      copilot_plan: "individual",
      quota_reset_date_utc: "2026-12-01T00:00:00.000Z",
      quota_snapshots: {
        chat: { unlimited: true, has_quota: false },
        premium_interactions: {
          entitlement: 300,
          remaining: 75,
          percent_remaining: 25,
          has_quota: true,
        },
        completions: { entitlement: 0, remaining: 0, unlimited: true },
      },
    });

    expect(usage).toEqual({
      plan: "individual",
      resetsAt: "2026-12-01T00:00:00.000Z",
      quotas: [
        {
          id: "premium_interactions",
          label: "Premium",
          used: 225,
          total: 300,
          percent: 75,
          unlimited: false,
        },
        { id: "chat", label: "Chat", unlimited: true },
        { id: "completions", label: "Conclusões", unlimited: true },
      ],
    });
  });

  test("calculates usage when percent_remaining is absent and skips unmetered quotas", () => {
    const usage = parseCopilotUsage({
      quota_snapshots: {
        premium_interactions: { entitlement: 100, quota_remaining: 40 },
        chat: { entitlement: 0, remaining: 0, has_quota: false },
      },
    });

    expect(usage?.quotas).toEqual([
      {
        id: "premium_interactions",
        label: "Premium",
        used: 60,
        total: 100,
        percent: 60,
        unlimited: false,
      },
    ]);
  });

  test("usa credits_used quando a resposta Copilot não traz remaining", () => {
    const usage = parseCopilotUsage({
      quota_snapshots: {
        premium_interactions: {
          entitlement: 1_000,
          credits_used: 275,
          has_quota: true,
        },
      },
    });

    expect(usage?.quotas[0]).toMatchObject({ used: 275, total: 1_000 });
    expect(usage?.quotas[0]?.percent).toBeCloseTo(27.5);
  });

  test("returns undefined when no usable quota is available", () => {
    expect(parseCopilotUsage(null)).toBeUndefined();
    expect(parseCopilotUsage({ quota_snapshots: [] })).toBeUndefined();
    expect(parseCopilotUsage({ quota_snapshots: { chat: { entitlement: 0, remaining: 0 } } }))
      .toBeUndefined();
  });
});

describe("fetchCopilotUsage", () => {
  test("aplica intervalo mínimo e distingue sucesso de erro HTTP", async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = "";
    let requestRedirect: RequestRedirect | undefined;
    let requestUserAgent: string | null = null;
    let calls = 0;
    globalThis.fetch = (async (input, init) => {
      calls++;
      requestUrl = String(input);
      requestRedirect = init?.redirect;
      requestUserAgent = new Headers(init?.headers).get("User-Agent");
      if (calls === 1) {
        return Response.json({
          quota_snapshots: {
            premium_interactions: { entitlement: 100, remaining: 70 },
          },
        });
      }
      return new Response("", { status: 403 });
    }) as typeof fetch;

    try {
      const usage = await fetchCopilotUsage("fake-test-token");
      expect(requestUrl).toBe("https://api.github.com/copilot_internal/user");
      expect(requestRedirect).toBe("error");
      expect(requestUserAgent).toBe("opencode-go-usage");
      expect(usage.quotas[0]?.used).toBe(30);

      await expect(fetchCopilotUsage("fake-test-token")).rejects.toMatchObject({
        kind: "http",
        status: 403,
      });
      expect(calls).toBe(2);
      expect(COPILOT_REFRESH_MS).toBe(10 * 60 * 1000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
