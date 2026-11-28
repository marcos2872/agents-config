export type PermissionMode = "ask" | "allow" | "deny";

export interface ImagePayload {
  name: string;
  mime: string;
  data: string;
}

export type PermissionScope = "once" | "site" | "always";

export interface PermissionDecision {
  allowed: boolean;
  scope?: PermissionScope;
}

export interface PermissionRequest {
  id: string;
  kind: "action" | "plan" | "domain";
  sessionID?: string;
  tool: string;
  title: string;
  detail?: string;
  url?: string;
  host?: string;
  screenshot?: string;
  text?: string;
  plan?: {
    domains: string[];
    approach: string[];
  };
  fromDomain?: string;
  toDomain?: string;
}

/** Motivo da última queda do relay. */
export type RelayFailure =
  | "missing_plugin"
  | "rejected"
  | "closed"
  | "silent";

export interface RelayState {
  connected: boolean;
  url: string;
  lastError?: string;
  reason?: RelayFailure;
  /** Última mensagem recebida do plugin (prova de vida). */
  lastSeenAt?: number;
}
