/**
 * Formatação pura do widget de cota do OpenCode Go (sem I/O, testável isolado).
 * Espelha a extensão GNOME `opencode-go-tray@local` do mesmo autor.
 */

export type Level = "none" | "ok" | "warning" | "error";

/** Largura padrão da barra de progresso em blocos. */
export const BAR_BLOCKS = 12;

/** Percentual limitado a 0..100 (NaN/infinito vira 0). */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** Barra de blocos, ex.: `██████░░░░░░`. Percentual ausente vira barra vazia. */
export function progressBar(percent: number | undefined, width = BAR_BLOCKS): string {
  const p = percent === undefined ? 0 : clampPercent(percent);
  const filled = Math.round((p / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Nível de alerta de uma janela: >=100 erro, >=80 atenção, senão ok. */
export function levelFor(percent: number | undefined): Level {
  if (percent === undefined || !Number.isFinite(percent)) return "none";
  if (percent >= 100) return "error";
  if (percent >= 80) return "warning";
  return "ok";
}

/** Texto curto do percentual usado: `42%` ou `—`. */
export function percentText(percent: number | undefined): string {
  if (percent === undefined || !Number.isFinite(percent)) return "—";
  return `${Math.round(percent)}%`;
}

/** Segundos até `resetsAt` (NaN se ausente/inválido; nunca negativo). */
export function secondsUntil(resetsAt: string | undefined, now = Date.now()): number {
  if (!resetsAt) return NaN;
  const target = Date.parse(resetsAt);
  if (!Number.isFinite(target)) return NaN;
  return Math.max(0, (target - now) / 1000);
}

/** Contagem regressiva compacta: `1d2h` | `3h30m` | `45m` | `30s` | `—`. */
export function formatReset(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) {
    const restHours = h % 24;
    return restHours ? `${d}d${restHours}h` : `${d}d`;
  }
  if (h >= 1) {
    const restMinutes = m % 60;
    return restMinutes ? `${h}h${restMinutes}m` : `${h}h`;
  }
  if (m >= 1) return `${m}m`;
  return `${s}s`;
}
