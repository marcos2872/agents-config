import type { ImagePayload } from "./types";

/** Porta base do relay do Pi (independente do relay do OpenCode na 8799). */
export const RELAY_PORT = 8809;
export const RELAY_URL = `ws://127.0.0.1:${RELAY_PORT}`;
export const RELAY_PROTOCOL = 1;

/** Plugin -> extension */
export type RelayInbound =
  | {
      type: "ready";
      v?: number;
      home?: string;
      workspace?: string;
    }
  | {
      type: "tool_request";
      id: string;
      tool: string;
      args: Record<string, unknown>;
      sessionID?: string;
      permissionMode?: string;
    }
  | { type: "cancel"; id: string }
  | { type: "ping" }
  | {
      type: "ensure_agent_result";
      id: string;
      ok: boolean;
      path?: string;
      error?: string;
    };

/** Extension -> plugin */
export type RelayOutbound =
  | { type: "hello"; v: number; extensionId: string }
  | {
      type: "tool_result";
      id: string;
      ok: boolean;
      content?: string;
      images?: ImagePayload[];
      error?: string;
      metadata?: Record<string, unknown>;
    }
  | { type: "progress"; id: string; phase: string; detail?: string }
  | { type: "pong" }
  | { type: "ensure_agent"; id: string };
