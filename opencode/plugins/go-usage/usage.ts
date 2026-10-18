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

/**
 * Integrações que emitem a credencial da assinatura: `opencode` (OpenCode
 * Console, método atual) e `opencode-go` (instalações anteriores).
 */
const INTEGRATION_IDS = ["opencode", "opencode-go"] as const;

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
const CREDENTIAL_SQL = `SELECT value FROM credential
  WHERE integration_id IN (${INTEGRATION_IDS.map((id) => `'${id}'`).join(",")})
  ORDER BY active DESC, time_updated DESC;`;

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
  let expired: ParsedCredential | undefined;
  for (const dbPath of await databaseCandidates()) {
    try {
      await access(dbPath);
    } catch {
      continue;
    }
    const rows = await readDatabaseValues(dbPath);
    if (!rows) continue;
    for (const raw of rows) {
      const credential = parseCredential(raw);
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
async function readDatabaseValues(dbPath: string): Promise<string[] | undefined> {
  return (
    (await queryWithBunSqlite(dbPath)) ??
    (await queryWithNodeSqlite(dbPath)) ??
    (await queryWithSqliteCli(dbPath))
  );
}

/** OAuth fora da validade (só credencial OAuth tem `expires`). */
function isExpired(credential: ParsedCredential): boolean {
  return credential.expiresAt !== undefined && credential.expiresAt <= Date.now();
}

async function queryWithBunSqlite(dbPath: string): Promise<string[] | undefined> {
  try {
    type BunDatabase = { query(sql: string): { all(): unknown[] }; close(): void };
    const { Database } = (await import("bun:sqlite")) as unknown as {
      Database: new (path: string, options?: { readonly?: boolean }) => BunDatabase;
    };
    const db = new Database(dbPath, { readonly: true });
    try {
      return extractValues(db.query(CREDENTIAL_SQL).all());
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function queryWithNodeSqlite(dbPath: string): Promise<string[] | undefined> {
  try {
    type NodeDatabase = { prepare(sql: string): { all(): unknown[] }; close(): void };
    const { DatabaseSync } = (await import("node:sqlite")) as unknown as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => NodeDatabase;
    };
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return extractValues(db.prepare(CREDENTIAL_SQL).all());
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function queryWithSqliteCli(dbPath: string): Promise<string[] | undefined> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    // `-json` mantém o valor íntegro mesmo com quebras de linha no JSON da credencial.
    const { stdout } = await promisify(execFile)("sqlite3", ["-json", dbPath, CREDENTIAL_SQL], {
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
