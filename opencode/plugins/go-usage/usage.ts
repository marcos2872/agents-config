/**
 * Cliente da cota do OpenCode Go.
 *
 * O Go expõe um endpoint de uso (não documentado publicamente, usado pelo
 * dashboard): `GET https://opencode.ai/zen/go/v1/usage` com
 * `Authorization: Bearer <token>`, que devolve percentual usado e horário de
 * reset das três janelas da assinatura (5h corridas / semanal / mensal).
 *
 * No OpenCode V2 a credencial é da integração `opencode` ("OpenCode Console"),
 * criada por `opencode auth login opencode` e guardada no SQLite do servidor
 * (tabela `credential`): `{"type":"oauth",…,"access"}` no login por device ou
 * `{"type":"key","key"}` na API key de service account. A resolução aqui é
 * `OPENCODE_API_KEY` (env) → `opencode.db`/`opencode-<canal>.db` (credencial
 * ativa) → `auth.json` legado.
 *
 * Quem renova o access token OAuth é o runtime (o refresh token rotaciona a
 * cada renovação); o plugin nunca renova por conta própria.
 *
 * Adaptado de @mellena1/opencode-go-usage (MIT) e da extensão GNOME
 * `opencode-go-tray@local` do mesmo autor.
 */
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
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

/** Uma categoria de cota reportada pela integração GitHub Copilot. */
export interface CopilotQuota {
  id: string;
  label: string;
  used?: number;
  total?: number;
  percent?: number;
  unlimited: boolean;
}

/** Cotas do GitHub Copilot para o período atual. */
export interface CopilotUsage {
  plan?: string;
  quotas: CopilotQuota[];
  resetsAt?: string;
}

/** Credencial interpretada de `credential.value` (schema do V2). */
export interface ParsedCredential {
  /** Bearer: `access` (OAuth) ou `key`/`apiKey` (API key). */
  token: string;
  /** Expiração em epoch ms; só credencial OAuth tem. */
  expiresAt?: number;
  /** `metadata.orgID` da conta, enviado como `x-org-id`. */
  orgID?: string;
}

/** Token resolvido + de onde veio (diagnóstico) + validade. */
export interface ResolvedKey {
  token: string;
  source: "env" | "database" | "auth";
  /** OAuth expirado que o runtime ainda não renovou: exige novo login. */
  expired: boolean;
  orgID?: string;
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
/** GitHub limita consultas ao endpoint interno de quota do Copilot. */
export const COPILOT_REFRESH_MS = 10 * 60 * 1000;

/**
 * Integrações que emitem a credencial da assinatura: `opencode` (OpenCode
 * Console, método atual) e `opencode-go` (instalações anteriores).
 */
const INTEGRATION_IDS = ["opencode", "opencode-go"] as const;
const COPILOT_INTEGRATION_IDS = ["github-copilot"] as const;

/**
 * Ordem de leitura do `auth.json` legado (V1): lá a credencial do Go ficava em
 * `opencode-go`, então ela vence quando as duas entradas existem.
 */
const LEGACY_AUTH_PROVIDERS = ["opencode-go", "opencode"] as const;

/**
 * Credenciais das integrações, ativas primeiro e mais recentes antes. Traz
 * todas as linhas aptas porque quem chama descarta as que não carregam segredo
 * (ex.: `type: "external"`).
 */
function credentialSql(integrationIDs: readonly string[]): string {
  return `SELECT value FROM credential
    WHERE integration_id IN (${integrationIDs.map((id) => `'${id}'`).join(",")})
    ORDER BY active DESC, time_updated DESC;`;
}

const CREDENTIAL_SQL = credentialSql(INTEGRATION_IDS);
const COPILOT_CREDENTIAL_SQL = credentialSql(COPILOT_INTEGRATION_IDS);

/**
 * Data dir do OpenCode: regra XDG em todas as plataformas (o runtime usa
 * `$XDG_DATA_HOME` e, sem ele, `~/.local/share`).
 */
function dataDirs(): string[] {
  const out: string[] = [];
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim()) out.push(join(xdg.trim(), "opencode"));
  out.push(join(homedir(), ".local", "share", "opencode"));
  return out;
}

/**
 * Bancos de canal (`opencode-<canal>.db`) ao lado do `opencode.db`; o
 * `opencode-next.db` é só origem de migração e fica de fora.
 */
const CHANNEL_DB_PATTERN = /^opencode-(?!next\.db$)[\w.-]+\.db$/;

/**
 * Caminhos candidatos do banco de credenciais, na ordem de leitura: o override
 * `OPENCODE_DB` (exclusivo, como no runtime) ou o `opencode.db` de cada data
 * dir seguido dos bancos de canal.
 */
export async function databaseCandidates(): Promise<string[]> {
  const override = process.env.OPENCODE_DB;
  if (override && override.trim()) {
    const value = override.trim();
    if (value === ":memory:") return [];
    return [isAbsolute(value) ? value : join(dataDirs()[0], value)];
  }

  const out: string[] = [];
  for (const dir of dataDirs()) {
    out.push(join(dir, "opencode.db"));
    out.push(...(await channelDatabases(dir)));
  }
  return out;
}

/** Bancos de canal presentes no data dir, em ordem estável. */
async function channelDatabases(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((name) => CHANNEL_DB_PATTERN.test(name))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Interpreta o JSON de uma linha da tabela `credential` (ou de uma entrada do
 * `auth.json` legado): `Credential.OAuth` (`access`), `Credential.Key` (`key`)
 * e o formato legado `{key|apiKey}`. Devolve `undefined` quando não há segredo
 * utilizável.
 */
export function parseCredential(json: string): ParsedCredential | undefined {
  try {
    return parseCredentialValue(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/** Mesma interpretação de `parseCredential`, a partir do valor já desserializado. */
export function parseCredentialValue(value: unknown): ParsedCredential | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;

  const access = readString(record.access);
  const key = readString(record.key) ?? readString(record.apiKey);
  const token = access ?? key;
  if (!token) return undefined;

  const metadata =
    typeof record.metadata === "object" && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : undefined;
  const expires =
    typeof record.expires === "number" && Number.isFinite(record.expires)
      ? record.expires
      : undefined;

  return { token, expiresAt: expires, orgID: readString(metadata?.orgID) };
}

/**
 * Lê a credencial do `opencode.db` (V2): a primeira utilizável entre os bancos
 * candidatos. Tenta `bun:sqlite` (runtime do TUI), `node:sqlite` e, por último,
 * o CLI `sqlite3`. Uma credencial OAuth vencida só é aceita quando nenhuma
 * outra serve — quem renova o token é o runtime.
 */
export async function readCredentialFromDatabase(): Promise<ParsedCredential | undefined> {
  return readCredentialFromDatabaseBySql(CREDENTIAL_SQL);
}

/** Lê a credencial ativa de uma integração específica do OpenCode. */
async function readCredentialFromDatabaseBySql(
  sql: string,
  parse: (json: string) => ParsedCredential | undefined = parseCredential,
): Promise<ParsedCredential | undefined> {
  let expired: ParsedCredential | undefined;
  for (const dbPath of await databaseCandidates()) {
    try {
      await access(dbPath);
    } catch {
      continue;
    }
    const rows = await readDatabaseValues(dbPath, sql);
    if (!rows) continue;
    for (const raw of rows) {
      const credential = parse(raw);
      if (!credential) continue;
      if (isExpired(credential)) {
        expired ??= credential;
        continue;
      }
      return credential;
    }
  }
  return expired;
}

/** Valores de `credential.value` do banco, pelo primeiro driver disponível. */
async function readDatabaseValues(dbPath: string, sql: string): Promise<string[] | undefined> {
  return (
    (await queryWithBunSqlite(dbPath, sql)) ??
    (await queryWithNodeSqlite(dbPath, sql)) ??
    (await queryWithSqliteCli(dbPath, sql))
  );
}

/** OAuth fora da validade (só credencial OAuth tem `expires`). */
function isExpired(credential: ParsedCredential): boolean {
  return credential.expiresAt !== undefined && credential.expiresAt <= Date.now();
}

async function queryWithBunSqlite(dbPath: string, sql: string): Promise<string[] | undefined> {
  try {
    type BunDatabase = { query(sql: string): { all(): unknown[] }; close(): void };
    const { Database } = (await import("bun:sqlite")) as unknown as {
      Database: new (path: string, options?: { readonly?: boolean }) => BunDatabase;
    };
    const db = new Database(dbPath, { readonly: true });
    try {
      return extractValues(db.query(sql).all());
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function queryWithNodeSqlite(dbPath: string, sql: string): Promise<string[] | undefined> {
  try {
    type NodeDatabase = { prepare(sql: string): { all(): unknown[] }; close(): void };
    const { DatabaseSync } = (await import("node:sqlite")) as unknown as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => NodeDatabase;
    };
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return extractValues(db.prepare(sql).all());
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function queryWithSqliteCli(dbPath: string, sql: string): Promise<string[] | undefined> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    // `-json` mantém o valor íntegro mesmo com quebras de linha no JSON da credencial.
    const { stdout } = await promisify(execFile)("sqlite3", ["-json", dbPath, sql], {
      timeout: 5000,
    });
    const rows: unknown = JSON.parse(stdout.trim() || "[]");
    return Array.isArray(rows) ? extractValues(rows) : undefined;
  } catch {
    return undefined;
  }
}

/** Extrai `value` das linhas lidas do banco, descartando o que não é texto. */
function extractValues(rows: unknown[]): string[] {
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const value = (row as Record<string, unknown>).value;
    return typeof value === "string" ? [value] : [];
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Copilot usa access/refresh e pode persistir `expires: 0` sem uma expiração
 * conhecida. Se o access já venceu, segue o comportamento do agent-usage e
 * tenta o refresh como bearer em vez de descartar a integração.
 */
export function parseCopilotCredentialValue(value: unknown): ParsedCredential | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const access = readString(record.access);
  const refresh = readString(record.refresh);
  const key = readString(record.key) ?? readString(record.apiKey);
  const expires = finiteNumber(record.expires);
  const accessExpired = expires !== undefined && expires > 0 && expires <= Date.now();
  const usingRefresh = (accessExpired && Boolean(refresh)) || (!access && Boolean(refresh));
  const token = usingRefresh ? refresh : access ?? refresh ?? key;
  if (!token) return undefined;

  const metadata =
    typeof record.metadata === "object" && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : undefined;
  const expiresAt = !usingRefresh && access && expires !== undefined && expires > 0
    ? expires
    : undefined;

  return { token, expiresAt, orgID: readString(metadata?.orgID) };
}

function parseCopilotCredential(json: string): ParsedCredential | undefined {
  try {
    return parseCopilotCredentialValue(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/**
 * Resolve a credencial na ordem do V2: `OPENCODE_API_KEY` (env) →
 * `opencode.db` (credencial ativa) → `auth.json` legado.
 */
export async function resolveApiKey(): Promise<ResolvedKey | undefined> {
  const fromEnv = readString(process.env.OPENCODE_API_KEY);
  if (fromEnv) {
    return { token: fromEnv, source: "env", expired: false };
  }

  const fromDatabase = await readCredentialFromDatabase();
  if (fromDatabase) {
    return toResolvedKey(fromDatabase, "database");
  }

  const auth = await readAuthFile();
  if (auth) {
    for (const provider of LEGACY_AUTH_PROVIDERS) {
      const entry = auth[provider];
      if (typeof entry !== "object" || entry === null) continue;
      const credential = parseCredentialValue(entry);
      if (credential) return toResolvedKey(credential, "auth");
    }
  }

  return undefined;
}

/** Lê somente a credencial conectada do GitHub Copilot no banco do OpenCode. */
export async function resolveCopilotKey(): Promise<ResolvedKey | undefined> {
  const credential = await readCredentialFromDatabaseBySql(
    COPILOT_CREDENTIAL_SQL,
    parseCopilotCredential,
  );
  return credential ? toResolvedKey(credential, "database") : undefined;
}

function toResolvedKey(credential: ParsedCredential, source: ResolvedKey["source"]): ResolvedKey {
  return {
    token: credential.token,
    source,
    expired: isExpired(credential),
    orgID: credential.orgID,
  };
}

/**
 * Busca as janelas de uso da assinatura.
 *
 * A troca inteira (request + leitura do corpo) é limitada por `timeoutMs`:
 * `AbortSignal` não dispara de forma confiável no runtime do TUI, então o
 * deadline é reforçado com um timer próprio.
 */
export async function fetchUsage(
  token: string,
  options: { baseUrl?: string; timeoutMs?: number; orgID?: string } = {},
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
  const orgID = options.orgID?.trim();

  const deadline = AbortSignal.timeout(timeoutMs);
  const timeoutMessage = `Sem resposta da API (timeout de ${timeoutMs}ms).`;

  let response: globalThis.Response;
  try {
    response = await withTimeout(
      fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          // Mesmo par do runtime: o Bearer da conta vai acompanhado da org.
          ...(orgID ? { "x-org-id": orgID } : {}),
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
    throw new UsageError(
      "unauthorized",
      "Credencial inválida ou expirada (401). Rode: opencode auth login opencode.",
    );
  }
  // Credencial válida sem assinatura Go retorna 403 EntitlementError.
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
 * Consulta a quota do Copilot pela integração já conectada no OpenCode.
 * O endpoint `copilot_internal` não é documentado publicamente, então erros e
 * mudanças de formato são tratados pelo chamador como ausência de dados.
 */
export async function fetchCopilotUsage(
  token: string,
  options: { timeoutMs?: number } = {},
): Promise<CopilotUsage> {
  const timeoutMs =
    typeof options.timeoutMs === "number" &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const timeoutMessage = `Sem resposta da API do GitHub Copilot (timeout de ${timeoutMs}ms).`;

  let response: globalThis.Response;
  try {
    response = await withTimeout(
      fetch("https://api.github.com/copilot_internal/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "opencode-go-usage",
        },
        // Nunca encaminhar a credencial a outro host por um redirect.
        redirect: "error",
        signal: deadline,
      }),
      timeoutMs,
      timeoutMessage,
    );
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(
      "network",
      deadline.aborted ? timeoutMessage : "Sem conexão com a API do GitHub Copilot.",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new UsageError(
        "unauthorized",
        "Credencial do GitHub Copilot inválida (401). Rode: opencode auth login github-copilot.",
        response.status,
      );
    }
    if (response.status === 403) {
      throw new UsageError(
        "http",
        "GitHub Copilot recusou a consulta (403): confira assento/entitlement ou aguarde o intervalo de atualização.",
        response.status,
      );
    }
    if (response.status === 404) {
      throw new UsageError(
        "http",
        "Endpoint interno de quota do GitHub Copilot indisponível (404).",
        response.status,
      );
    }
    throw new UsageError(
      "http",
      `Falha na API do GitHub Copilot (HTTP ${response.status}).`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await withTimeout(response.json(), timeoutMs, timeoutMessage);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError("bad-response", "Resposta inválida da API do GitHub Copilot.");
  }

  const usage = parseCopilotUsage(body);
  if (!usage) {
    throw new UsageError(
      "bad-response",
      "Resposta da API do GitHub Copilot sem cotas utilizáveis.",
    );
  }
  return usage;
}

/**
 * Interpreta `quota_snapshots` sem depender de uma lista fechada de categorias.
 * Retorna `undefined` quando a API não oferece uma cota que possa ser exibida.
 */
export function parseCopilotUsage(body: unknown): CopilotUsage | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const snapshots = record.quota_snapshots;
  if (typeof snapshots !== "object" || snapshots === null || Array.isArray(snapshots)) {
    return undefined;
  }

  const quotas = Object.entries(snapshots as Record<string, unknown>).flatMap(
    ([id, raw]): CopilotQuota[] => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
      const quota = raw as Record<string, unknown>;
      if (quota.has_quota === false && quota.unlimited !== true) return [];

      if (quota.unlimited === true) {
        return [{ id, label: copilotQuotaLabel(id), unlimited: true }];
      }

      const total = finiteNumber(quota.entitlement);
      const reportedUsed = finiteNumber(quota.credits_used);
      const remaining = finiteNumber(quota.quota_remaining) ?? finiteNumber(quota.remaining);
      if (total === undefined || total <= 0) return [];

      const used =
        reportedUsed ?? (remaining === undefined ? undefined : Math.max(0, total - remaining));
      if (used === undefined) return [];
      const remainingPercent = finiteNumber(quota.percent_remaining);
      const percent =
        remainingPercent === undefined
          ? clampPercent((used / total) * 100)
          : clampPercent(100 - remainingPercent);

      return [{ id, label: copilotQuotaLabel(id), used, total, percent, unlimited: false }];
    },
  );

  if (quotas.length === 0) return undefined;

  const resetValue = readString(record.quota_reset_date_utc) ?? readString(record.quota_reset_date);
  const resetsAt = resetValue && Number.isFinite(Date.parse(resetValue)) ? resetValue : undefined;
  return {
    plan: readString(record.copilot_plan),
    quotas: orderCopilotQuotas(quotas),
    resetsAt,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function copilotQuotaLabel(id: string): string {
  const known: Record<string, string> = {
    premium_interactions: "Premium",
    chat: "Chat",
    completions: "Conclusões",
  };
  return (
    known[id] ?? id.replaceAll(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function orderCopilotQuotas(quotas: CopilotQuota[]): CopilotQuota[] {
  const priority = ["premium_interactions", "ai_credits", "chat", "completions"];
  return quotas.sort((left, right) => {
    const leftIndex = priority.indexOf(left.id);
    const rightIndex = priority.indexOf(right.id);
    const leftOrder = leftIndex < 0 ? priority.length : leftIndex;
    const rightOrder = rightIndex < 0 ? priority.length : rightIndex;
    return leftOrder - rightOrder;
  });
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
 * A credencial só pode trafegar em TLS. `http://` é tolerado apenas para
 * localhost/loopback (testes locais com servidor mock).
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

type AuthEntry = { [key: string]: unknown };
type AuthFile = Record<string, AuthEntry>;

/**
 * Arquivo de credencial legado importado pelo V2:
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
