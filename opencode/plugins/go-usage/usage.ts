/**
 * Cliente da cota do OpenCode Go.
 *
 * O Go expõe um endpoint de uso (não documentado publicamente, usado pelo
 * dashboard): `GET https://opencode.ai/zen/go/v1/usage` com
 * `Authorization: Bearer <key>`, que devolve percentual usado e horário de
 * reset das três janelas da assinatura (5h corridas / semanal / mensal).
 *
 * A credencial é resolvida com o mesmo método da extensão GNOME
 * `opencode-go-tray@local` do autor: `OPENCODE_API_KEY` (env) →
 * `opencode.db` (tabela `credential`, `opencode-go` ativo) → `auth.json`
 * legado (`opencode-go`, fallback `opencode`).
 *
 * Adaptado de @mellena1/opencode-go-usage (MIT) e da extensão GNOME
 * `opencode-go-tray@local` do mesmo autor.
 */
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { clampPercent } from "./format.ts";

/** Uma janela de cota como reportada pelo endpoint. */
export interface UsageWindow {
  status?: string;
  percent?: number;
  resetsAt?: string;
}

/** As três janelas da assinatura OpenCode Go. */
export interface GoUsage {
  rolling?: UsageWindow;
  weekly?: UsageWindow;
  monthly?: UsageWindow;
}

/** API key resolvida + de onde ela veio (diagnóstico). */
export interface ResolvedKey {
  apiKey: string;
  source: "env" | "database" | "auth";
}

export type UsageErrorKind =
  | "config"
  | "unauthorized"
  | "no-subscription"
  | "bad-response"
  | "network"
  | "http";

/** Erro tipado do cliente de uso, com mensagem já em pt-BR. */
export class UsageError extends Error {
  readonly kind: UsageErrorKind;
  readonly status?: number;

  constructor(kind: UsageErrorKind, message: string, status?: number) {
    super(message);
    this.name = "UsageError";
    this.kind = kind;
    this.status = status;
  }
}

export const DEFAULT_BASE_URL = "https://opencode.ai/zen/go";
export const DEFAULT_TIMEOUT_MS = 15_000;

/** SQL usado pela extensão GNOME: pega a credencial `opencode-go` ativa. */
const CREDENTIAL_SQL =
  "SELECT value FROM credential WHERE integration_id='opencode-go' ORDER BY active DESC LIMIT 1;";

/** Caminhos candidatos do banco de credenciais V2 (mesma ordem da extensão). */
export function databaseCandidates(): string[] {
  const out: string[] = [];
  const override = process.env.OPENCODE_DB;
  if (override && override.trim()) out.push(override.trim());
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) out.push(join(xdg.trim(), "opencode", "opencode.db"));
  out.push(join(homedir(), ".local", "share", "opencode", "opencode.db"));
  return out;
}

/** Extrai `key` do JSON de uma linha da tabela `credential`. */
export function parseCredentialKey(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as { key?: unknown };
    return typeof parsed?.key === "string" && parsed.key.trim() ? parsed.key.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lê a key ativa do `opencode.db` (V2), como a extensão GNOME faz.
 * Tenta `bun:sqlite` (runtime do TUI) e, se indisponível, o CLI `sqlite3`.
 */
export async function readKeyFromDatabase(): Promise<string | undefined> {
  for (const dbPath of databaseCandidates()) {
    try {
      await access(dbPath);
    } catch {
      continue;
    }
    const raw = (await queryWithBunSqlite(dbPath)) ?? (await queryWithSqliteCli(dbPath));
    if (!raw) continue;
    const key = parseCredentialKey(raw);
    if (key) return key;
  }
  return undefined;
}

async function queryWithBunSqlite(dbPath: string): Promise<string | undefined> {
  try {
    type BunDatabase = { query(sql: string): { get(): unknown }; close(): void };
    const { Database } = (await import("bun:sqlite")) as unknown as {
      Database: new (path: string, options?: { readonly?: boolean }) => BunDatabase;
    };
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query(CREDENTIAL_SQL).get() as { value?: string } | null | undefined;
      return row?.value;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function queryWithSqliteCli(dbPath: string): Promise<string | undefined> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)("sqlite3", [dbPath, CREDENTIAL_SQL], {
      timeout: 5000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a key com o método da extensão: `OPENCODE_API_KEY` (env) →
 * `opencode.db` (credencial ativa) → `auth.json` legado (`opencode-go`,
 * depois `opencode`).
 */
export async function resolveApiKey(): Promise<ResolvedKey | undefined> {
  const fromEnv = process.env.OPENCODE_API_KEY;
  if (fromEnv && fromEnv.trim()) {
    return { apiKey: fromEnv.trim(), source: "env" };
  }

  const fromDatabase = await readKeyFromDatabase();
  if (fromDatabase) {
    return { apiKey: fromDatabase, source: "database" };
  }

  const auth = await readAuthFile();
  if (auth) {
    for (const provider of ["opencode-go", "opencode"] as const) {
      const entry = auth[provider];
      if (!entry || typeof entry !== "object") continue;
      const key =
        typeof entry.key === "string"
          ? entry.key
          : typeof entry.apiKey === "string"
            ? entry.apiKey
            : undefined;
      if (key && key.trim()) return { apiKey: key.trim(), source: "auth" };
    }
  }

  return undefined;
}

/**
 * Busca as janelas de uso da assinatura.
 *
 * A troca inteira (request + leitura do corpo) é limitada por `timeoutMs`:
 * `AbortSignal` não dispara de forma confiável no runtime do TUI, então o
 * deadline é reforçado com um timer próprio.
 */
export async function fetchUsage(
  apiKey: string,
  options: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<GoUsage> {
  const baseUrl = assertSecureBaseUrl(
    stripTrailingSlashes((options.baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL),
  );
  const url = `${baseUrl}/v1/usage`;
  const timeoutMs =
    typeof options.timeoutMs === "number" &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const deadline = AbortSignal.timeout(timeoutMs);
  const timeoutMessage = `Sem resposta da API (timeout de ${timeoutMs}ms).`;

  let response: globalThis.Response;
  try {
    response = await withTimeout(
      fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        // Nunca seguir redirect com o token anexado; se a resposta for 3xx,
        // falhar fechado.
        redirect: "error",
        signal: deadline,
      }),
      timeoutMs,
      timeoutMessage,
    );
  } catch (error) {
    if (error instanceof UsageError) throw error; // o deadline disparou
    throw new UsageError(
      "network",
      deadline.aborted ? timeoutMessage : "Sem conexão com a API do OpenCode Go.",
    );
  }

  if (response.status === 401) {
    throw new UsageError("unauthorized", "API key inválida (401). Regenere a key e refaça o login.");
  }
  // Key válida sem assinatura Go retorna 403 EntitlementError.
  if (response.status === 403) {
    throw new UsageError(
      "no-subscription",
      "Assinatura Go não encontrada (403). Verifique o plano no dashboard.",
    );
  }
  if (!response.ok) {
    throw new UsageError("http", `Falha na API (HTTP ${response.status}).`, response.status);
  }

  let body: unknown;
  try {
    body = await withTimeout(response.json(), timeoutMs, timeoutMessage);
  } catch (error) {
    if (error instanceof UsageError) throw error; // o deadline disparou no meio do corpo
    throw new UsageError("bad-response", "Resposta inválida da API.");
  }

  const usage = parseUsage(body);
  if (!usage) {
    throw new UsageError("bad-response", "Resposta da API em formato inesperado.");
  }
  return usage;
}

/**
 * Lê `body.usage.{rolling,weekly,monthly}`, limitando percentuais e validando
 * `resetsAt`. Exportado para testes.
 */
export function parseUsage(body: unknown): GoUsage | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const usage = (body as Record<string, unknown>).usage;
  if (typeof usage !== "object" || usage === null) return undefined;

  const record = usage as Record<string, unknown>;
  const result: GoUsage = {};
  let found = false;
  for (const key of ["rolling", "weekly", "monthly"] as const) {
    const raw = record[key];
    if (typeof raw !== "object" || raw === null) continue;
    const window = raw as Record<string, unknown>;
    result[key] = {
      status: typeof window.status === "string" ? window.status : undefined,
      percent: typeof window.percent === "number" ? clampPercent(window.percent) : undefined,
      resetsAt:
        typeof window.resetsAt === "string" && !Number.isNaN(Date.parse(window.resetsAt))
          ? window.resetsAt
          : undefined,
    };
    found = true;
  }
  return found ? result : undefined;
}

/**
 * Garante que a troca de deadline independa do dispatch do AbortSignal: um
 * fetch pendurado precisa liquidar para o widget nunca ficar em "Carregando…".
 */
function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UsageError("network", timeoutMessage)), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * A key é uma credencial e só pode trafegar em TLS. `http://` é tolerado
 * apenas para localhost/loopback (testes locais com servidor mock).
 */
function assertSecureBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new UsageError("config", `baseUrl inválida: "${baseUrl}"`);
  }
  if (parsed.protocol === "https:") return baseUrl;
  if (parsed.protocol === "http:") {
    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
    if (isLoopback) return baseUrl;
  }
  throw new UsageError("config", "baseUrl precisa ser https; http só é aceito em localhost.");
}

type AuthEntry = { key?: unknown; apiKey?: unknown; [key: string]: unknown };
type AuthFile = Record<string, AuthEntry>;

/**
 * Arquivo de credencial legado escrito pelo `auth login`:
 * `~/.local/share/opencode/auth.json` (Linux), `~/Library/Application
 * Support/opencode/auth.json` (macOS), `%LOCALAPPDATA%\opencode\auth.json`
 * (Windows), ou `$OPENCODE_AUTH_JSON` quando definido.
 */
function authFilePath(): string {
  if (process.env.OPENCODE_AUTH_JSON?.trim()) {
    return process.env.OPENCODE_AUTH_JSON.trim();
  }
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return join(
        process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
        "opencode",
        "auth.json",
      );
    case "darwin":
      return join(home, "Library", "Application Support", "opencode", "auth.json");
    default:
      return join(
        process.env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"),
        "opencode",
        "auth.json",
      );
  }
}

async function readAuthFile(): Promise<AuthFile | undefined> {
  try {
    const raw = await readFile(authFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as AuthFile;
  } catch {
    return undefined;
  }
}
