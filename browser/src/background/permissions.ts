import type { PermissionDecision } from "../shared/types"

/**
 * Permissão em modo `allow`: toda ação é autorizada na hora, sem modal nem
 * notificação (extensão sem UI). Mantém a superfície usada pelas tools:
 * `check()` (via `ctx.ask`), `hostOf()` e `allowForSession()` (no-op em allow).
 */
export class Permissions {
  async init(): Promise<void> {}

  async check(_input: unknown, _sessionID: string): Promise<PermissionDecision> {
    return { allowed: true, scope: "once" }
  }

  hostOf(url: string | undefined): string {
    if (!url) return ""
    try {
      return new URL(url).hostname
    } catch {
      return ""
    }
  }

  allowForSession(_sessionID: string, _host: string): void {}
}
