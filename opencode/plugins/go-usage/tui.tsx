/** @jsxImportSource @opentui/solid */
/**
 * Widget das cotas OpenCode Go e GitHub Copilot no sidebar da sessão.
 *
 * A credencial do Go vem da integração `opencode` do V2 (`opencode auth login
 * opencode`); o runtime renova o access token OAuth, então o widget só lê o
 * estado atual e sinaliza quando a sessão expira. Copilot usa apenas a integração
 * GitHub Copilot conectada no OpenCode.
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
  COPILOT_REFRESH_MS,
  DEFAULT_TIMEOUT_MS,
  UsageError,
  fetchCopilotUsage,
  fetchUsage,
  resolveApiKey,
  resolveCopilotKey,
  type CopilotQuota,
  type CopilotUsage,
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
/** Access token OAuth vencido que o runtime ainda não renovou. */
const EXPIRED_MESSAGE = "Sessão expirada. Rode: opencode auth login opencode.";

const WINDOWS: ReadonlyArray<{ key: keyof GoUsage; label: string }> = [
  { key: "rolling", label: "5 horas" },
  { key: "weekly", label: "Semanal" },
  { key: "monthly", label: "Mensal" },
];

interface WidgetState {
  status: "loading" | "ok" | "no-key" | "error";
  usage?: GoUsage;
  copilot?: CopilotUsage;
  copilotError?: string;
  error?: string;
}

interface CopilotRefreshResult {
  usage?: CopilotUsage;
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

/** Cabeçalho e janelas Go, seguidos de uma seção Copilot opcional. */
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
      return "Sem credencial. Rode: opencode auth login opencode.";
    }
    if (state.status === "loading") return "Carregando…";
    if (state.status === "error") return state.error ?? "Indisponível.";
    return "";
  })();

  return (
    <box>
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
      {state.copilot || state.copilotError ? (
        <CopilotUsageWidget usage={state.copilot} error={state.copilotError} theme={theme} />
      ) : null}
    </box>
  );
}

function CopilotUsageWidget(props: {
  usage?: CopilotUsage;
  error?: string;
  theme: ResolvedTheme;
}): JSX.Element {
  const theme = props.theme;
  const dot = props.error ? theme.text.feedback.error.base : theme.text.feedback.success.base;
  return (
    <box>
      <box flexDirection="row" gap={1}>
        <text fg={dot}>●</text>
        <text fg={theme.text.base}>
          <b>GitHub Copilot</b>
          {props.usage?.plan ? ` (${props.usage.plan})` : ""}
        </text>
      </box>
      <For each={props.usage?.quotas ?? []}>
        {(quota) => <CopilotQuotaRow quota={quota} theme={theme} />}
      </For>
      {props.usage?.resetsAt ? (
        <text fg={theme.text.muted} wrapMode="none">
          {`↻ ${formatReset(secondsUntil(props.usage.resetsAt))}`}
        </text>
      ) : null}
      {props.error ? (
        <text fg={theme.text.feedback.error.base} wrapMode="word">
          {props.error}
        </text>
      ) : null}
    </box>
  );
}

function CopilotQuotaRow(props: { quota: CopilotQuota; theme: ResolvedTheme }): JSX.Element {
  const { quota, theme } = props;
  if (quota.unlimited) {
    return (
      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted} width={10} wrapMode="none">
          {quota.label}
        </text>
        <text fg={theme.text.muted} wrapMode="none">
          Ilimitado
        </text>
      </box>
    );
  }

  const color = levelColor(theme, levelFor(quota.percent));
  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.text.muted} width={10} wrapMode="none">
        {quota.label}
      </text>
      <text fg={color} wrapMode="none">
        {progressBar(quota.percent, 8)}
      </text>
      <text fg={color} width={4} wrapMode="none">
        {percentText(quota.percent)}
      </text>
      <text fg={theme.text.muted} wrapMode="none">
        {`${quota.used}/${quota.total}`}
      </text>
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
    /** O endpoint interno de quota do Copilot deve ser consultado no máximo a cada 10 min. */
    let lastCopilotAttemptAt = 0;

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
     * Mesma ordem do runtime: `OPENCODE_API_KEY` → `opencode.db`
     * (credencial ativa de `opencode`/`opencode-go`) → `auth.json` legado.
     */
    async function resolveKey(): Promise<ResolvedKey | undefined> {
      try {
        return await resolveApiKey();
      } catch {
        return undefined;
      }
    }

    /** Usa somente a conta GitHub Copilot conectada no OpenCode. */
    async function resolveCopilotCredential(): Promise<ResolvedKey | undefined> {
      try {
        return await resolveCopilotKey();
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

    async function refreshGo(
      current: number,
    ): Promise<Omit<WidgetState, "copilot" | "copilotError">> {
      const key = await resolveKey();
      if (current !== generation) return { status: "loading" };

      if (!key) {
        // Não é erro operacional — só não há o que mostrar até o Go ser configurado.
        return { status: "no-key" };
      }

      // O refresh token rotaciona a cada renovação, então quem renova é o
      // runtime — aqui só resta pedir novo login quando o token já venceu.
      if (key.expired) {
        if (current === generation) notify(EXPIRED_MESSAGE);
        return { status: "error", error: EXPIRED_MESSAGE, usage: last?.usage };
      }

      try {
        const usage = await fetchUsage(key.token, { orgID: key.orgID });
        if (current !== generation) return { status: "loading" };
        notified = null;
        return { status: "ok", usage };
      } catch (error) {
        if (current !== generation) return { status: "loading" };
        const message =
          error instanceof UsageError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        notify(message);
        // Mantém os últimos valores conhecidos quando um refresh falha.
        return { status: "error", error: message, usage: last?.usage };
      }
    }

    async function refreshCopilot(current: number): Promise<CopilotRefreshResult> {
      const credential = await resolveCopilotCredential();
      if (current !== generation) {
        return { usage: last?.copilot, error: last?.copilotError };
      }
      if (!credential) return {};
      if (credential.expired) {
        return {
          usage: last?.copilot,
          error: "Sessão do GitHub Copilot expirada. Rode: opencode auth login github-copilot.",
        };
      }

      if (Date.now() - lastCopilotAttemptAt < COPILOT_REFRESH_MS) {
        return { usage: last?.copilot, error: last?.copilotError };
      }
      lastCopilotAttemptAt = Date.now();

      try {
        return { usage: await fetchCopilotUsage(credential.token) };
      } catch (error) {
        const message =
          error instanceof UsageError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        // Preserva o último valor válido e deixa a falha visível no bloco do Copilot.
        return { usage: last?.copilot, error: message };
      }
    }

    async function refresh(): Promise<void> {
      const current = ++generation;
      refreshStartedAt = Date.now();

      const [go, copilot] = await Promise.all([
        refreshGo(current),
        refreshCopilot(current),
      ]);
      if (current !== generation) return;

      refreshStartedAt = 0;
      last = { ...go, copilot: copilot.usage, copilotError: copilot.error };
      renderWidget();
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
      last = {
        status: "error",
        error: message,
        usage: last?.usage,
        copilot: last?.copilot,
        copilotError: last?.copilotError,
      };
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
