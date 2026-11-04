// The local workspace host's HTTP protocol (ADR 0016), shared with the control plane's adapter so both sides
// agree on paths and error kinds. Pure constants and types: the control plane bundles this into its Worker.

export const PROTOCOL_VERSION = 'v1';
export const DEFAULT_PORT = 8790;

/** The same kinds as the control plane's ProviderError, so errors pass straight through. */
export const ERROR_KINDS = ['unavailable', 'gone', 'refused', 'failed'] as const;
export type HostErrorKind = (typeof ERROR_KINDS)[number];

export const ACTIONS = ['start', 'pause', 'resume', 'stop'] as const;
export type HostAction = (typeof ACTIONS)[number];

export interface CreateRequest {
  readonly workspaceId: string;
  readonly repoUrl: string | null;
}

export interface CreateResponse {
  /** The host's name for the workspace (its container name). */
  readonly ref: string;
  /** Whether this call cloned the repository (false when there's none, or it was already there). */
  readonly cloned: boolean;
  readonly cloneMs: number | null;
}

/** Every error answer: a kind, and a sentence that's safe to show the person. */
export interface HostErrorBody {
  readonly error: { readonly kind: HostErrorKind; readonly message: string };
}

export const PATHS = {
  health: `/${PROTOCOL_VERSION}/health`,
  create: `/${PROTOCOL_VERSION}/workspaces`,
  action: (ref: string, action: HostAction) =>
    `/${PROTOCOL_VERSION}/workspaces/${encodeURIComponent(ref)}/${action}`,
  /** Body: one AgentRequest (@flowcanvas/workspace-agent/protocol); answer: its AgentResponse, always 200. */
  agent: (ref: string) => `/${PROTOCOL_VERSION}/workspaces/${encodeURIComponent(ref)}/agent`,
  /**
   * A WebSocket (ADR 0017): binary frames are terminal bytes, text frames JSON control messages
   * (`{ type: 'resize', cols, rows }` in; `{ type: 'exit', code }` and `{ type: 'error', message }` out).
   */
  terminal: (ref: string, cols: number, rows: number) =>
    `/${PROTOCOL_VERSION}/workspaces/${encodeURIComponent(ref)}/terminal?cols=${String(cols)}&rows=${String(rows)}`,
} as const;

export function isHostErrorKind(value: unknown): value is HostErrorKind {
  return typeof value === 'string' && (ERROR_KINDS as readonly string[]).includes(value);
}

/** Longest error sentence either side accepts (the workspace's `failure` column holds 300). */
export const MESSAGE_MAX = 300;
