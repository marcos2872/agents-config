/** @jsxImportSource @opentui/solid */
/**
 * Widget de cota do OpenCode Go no sidebar da sessão.
 *
 * O estado vive fora do Solid e o claim do slot é remontado a cada mudança:
 * sinais reativos de plugins não repintam no CLI empacotado
 * (anomalyco/opencode#39986) — remontar é um repaint inicial, que sempre
 * funciona. Padrão adaptado de @mellena1/opencode-go-usage (MIT) e da extensão
 * GNOME `opencode-go-tray@local` do mesmo autor.
 */
import { For, type JSX } from "solid-js";
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { ResolvedTheme } from "@opencode/theme/tui";
import {
  DEFAULT_TIMEOUT_MS,
  UsageError,
  fetchUsage,
  resolveApiKey,
  type GoUsage,
  type ResolvedKey,
  type UsageWindow,
} from "./usage.ts";
import {
  formatReset,
  levelFor,
  percentText,
  progressBar,
  secondsUntil,
  type Level,
} from "./format.ts";

/** Atualização automática a cada 5 minutos. */
const REFRESH_MS = 5 * 60 * 1000;
/** De quanto em quanto tempo o watchdog confere refreshes pendurados. */
const WATCHDOG_MS = 10_000;
/** Folga além do deadline do fetch antes de declarar um refresh travado. */
const WATCHDOG_SLACK_MS = 5_000;

const WINDOWS: ReadonlyArray<{ key: keyof GoUsage; label: string }> = [
  { key: "rolling", label: "5 horas" },
  { key: "weekly", label: "Semanal" },
  { key: "monthly", label: "Mensal" },
];

interface WidgetState {
  status: "loading" | "ok" | "no-key" | "error";
  usage?: GoUsage;
  error?: string;
}

function levelColor(theme: ResolvedTheme, level: Level): string {
  switch (level) {
    case "error":
      return theme.text.feedback.error.base;
    case "warning":
      return theme.text.feedback.warning.base;
    case "ok":
      return theme.text.feedback.success.base;
    default:
      return theme.text.muted;
  }
}

/**
 * Estrutura fixa (cabeçalho, três janelas, linha de status) para que uma
 * remontagem nunca mude a altura do widget no sidebar.
 */
function UsageWidget(props: { state: WidgetState; theme: ResolvedTheme }): JSX.Element {
  const theme = props.theme;
  const state = props.state;
  const usage = state.usage;

  const worst = (() => {
    if (!usage) return undefined;
    const values = [usage.rolling?.percent, usage.weekly?.percent, usage.monthly?.percent].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    return values.length > 0 ? Math.max(...values) : undefined;
  })();

  const dot = (() => {
    if (state.status === "loading" || state.status === "no-key") return theme.text.muted;
    if (state.status === "error" && !usage) return theme.text.feedback.error.base;
    return levelColor(theme, levelFor(worst));
  })();

  const statusLine = (() => {
    if (state.status === "no-key") {
      return "Sem API key. Rode: opencode auth login -p opencode-go.";
    }
    if (state.status === "loading") return "Carregando…";
    if (state.status === "error") return state.error ?? "Indisponível.";
    return "";
  })();

  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={dot}>●</text>
        <text fg={theme.text.base}>
          <b>OpenCode Go</b>
        </text>
      </box>
      <For each={WINDOWS}>
        {(entry) => <WindowRow label={entry.label} window={usage?.[entry.key]} theme={theme} />}
      </For>
      {statusLine !== "" ? (
        <text fg={theme.text.muted} wrapMode="none">
          {statusLine}
        </text>
      ) : null}
    </box>
  );
}

function WindowRow(props: {
  label: string;
  window: UsageWindow | undefined;
  theme: ResolvedTheme;
}): JSX.Element {
  const theme = props.theme;
  const percent = typeof props.window?.percent === "number" ? props.window.percent : undefined;
  const level = levelFor(percent);
  const color = levelColor(theme, level);
  const limited = props.window?.status === "rate-limited" || (percent !== undefined && percent >= 100);
  const reset = limited ? "limite" : `↻ ${formatReset(secondsUntil(props.window?.resetsAt))}`;

  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.text.muted} width={7} wrapMode="none">
        {props.label}
      </text>
      <text fg={color} wrapMode="none">
        {progressBar(percent, 12)}
      </text>
      <text fg={color} width={4} wrapMode="none">
        {percentText(percent)}
      </text>
      <text fg={theme.text.muted} wrapMode="none">
        {reset}
      </text>
    </box>
  );
}

export default Plugin.define({
  id: "go-usage",
  setup: (ctx: Context) => {
    /**
     * Snapshot imutável passado ao claim por valor; remontado quando muda.
     */
    let last: WidgetState | null = null;
    let disposeWidget: (() => void) | null = null;
    /** Descarta resultados fora de ordem (fetch lento terminando após um novo). */
    let generation = 0;
    let notified: string | null = null;
    /** Início do refresh mais recente, usado pelo watchdog. */
    let refreshStartedAt = 0;

    function renderWidget(): void {
      disposeWidget?.();
      disposeWidget = null;
      const state: WidgetState = last ?? { status: "loading" };
      disposeWidget = ctx.ui.slot({
        append: "sidebar.content",
        render: () => <UsageWidget state={state} theme={ctx.theme} />,
      });
    }

    /**
     * Mesmo método da extensão GNOME: `OPENCODE_API_KEY` → `opencode.db`
     * (tabela `credential`, `opencode-go` ativo) → `auth.json` legado.
     */
    async function resolveKey(): Promise<ResolvedKey | undefined> {
      try {
        return await resolveApiKey();
      } catch {
        return undefined;
      }
    }

    function notify(message: string): void {
      if (notified === message) return;
      notified = message;
      ctx.ui.toast.show({
        variant: "error",
        title: "Go usage",
        message,
        duration: 6000,
      });
    }

    async function refresh(): Promise<void> {
      const current = ++generation;
      refreshStartedAt = Date.now();

      const key = await resolveKey();
      if (current !== generation) return;

      if (!key) {
        // Não é erro operacional — só não há o que mostrar até o Go ser configurado.
        refreshStartedAt = 0;
        last = { status: "no-key" };
        renderWidget();
        return;
      }

      try {
        const usage = await fetchUsage(key.apiKey);
        if (current !== generation) return;
        notified = null;
        refreshStartedAt = 0;
        last = { status: "ok", usage };
        renderWidget();
      } catch (error) {
        if (current !== generation) return;
        const message =
          error instanceof UsageError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        notify(message);
        // Mantém os últimos valores conhecidos quando um refresh falha.
        refreshStartedAt = 0;
        last = { status: "error", error: message, usage: last?.usage };
        renderWidget();
      }
    }

    renderWidget();
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);

    // Rede de segurança: se um refresh nunca liquidar (stall patológico além do
    // deadline), tira o widget de "Carregando…" em vez de deixá-lo preso.
    const watchdog = setInterval(() => {
      if (refreshStartedAt === 0) return;
      if (Date.now() - refreshStartedAt <= DEFAULT_TIMEOUT_MS + WATCHDOG_SLACK_MS) return;
      generation++;
      refreshStartedAt = 0;
      const message = "Tempo esgotado ao atualizar o uso do OpenCode Go.";
      notify(message);
      last = { status: "error", error: message, usage: last?.usage };
      renderWidget();
    }, WATCHDOG_MS);

    return () => {
      generation++;
      clearInterval(timer);
      clearInterval(watchdog);
      disposeWidget?.();
    };
  },
});
