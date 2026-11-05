import type { AgentRequest, AgentResponse } from '@flowcanvas/workspace-agent/protocol';

/**
 * What the control plane needs from whatever runs workspaces (ADR 0016). For now that's the local workspace host
 * and Docker (step 4); a cloud provider implements the same interface later (upgrade-later 33).
 * Every method is safe to call twice: pausing a paused workspace or stopping a stopped one does nothing.
 */
export interface WorkspaceProvider {
  /** Stored with the workspace, e.g. `docker-local`. */
  readonly name: string;
  /** Creates and starts the workspace, and clones the repository into it if there is one. */
  create(input: {
    readonly workspaceId: string;
    readonly repoUrl: string | null;
  }): Promise<{ readonly ref: string }>;
  /** Starts a stopped workspace again, with its files. */
  start(ref: string): Promise<void>;
  /** Sleep: everything frozen in place. */
  pause(ref: string): Promise<void>;
  resume(ref: string): Promise<void>;
  /** Stops it; its files are kept. */
  stop(ref: string): Promise<void>;
  /**
   * A file or process request for the agent in a running workspace (step 5). The agent's own refusals (a
   * missing file, a .env file) come back as `{ ok: false }`; a ProviderError means it couldn't be asked.
   */
  agent(ref: string, request: AgentRequest): Promise<AgentResponse>;
  /** A shell on a pty in a running workspace, as a WebSocket not yet accepted (ADR 0017). */
  terminal(ref: string, size: { cols: number; rows: number }): Promise<TerminalSocket>;
  /**
   * Whether the machine running the workspaces is short of something (the local resource guard, step 8a). A
   * provider without it (a cloud one, whose own limits apply) leaves it out, and nothing is relieved.
   */
  pressure?(): Promise<readonly PressureKind[]>;
}

/** Short of memory, of disk, busy for minutes, or over Flowcanvas's own disk budget (ADR 0019). */
export type PressureKind = 'memory' | 'disk' | 'load' | 'budget';

/**
 * The part of a Workers WebSocket the terminal relay uses, so tests can pass a fake. Binary frames are
 * terminal bytes; text frames are JSON control messages (`@flowcanvas/workspace-host/protocol`).
 */
export interface TerminalSocket {
  binaryType: string;
  accept(): void;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', listener: () => void): void;
}

/** What the API says where nothing can run workspaces (staging, until a cloud provider is connected). */
export const WORKSPACES_UNAVAILABLE =
  'Workspaces run locally for now. Open this project on your own computer with pnpm dev.';

/**
 * - `unavailable`: the provider can't be reached (the local host isn't running).
 * - `gone`: the provider no longer has this workspace in the state we thought (e.g. lost while asleep).
 * - `refused`: the provider won't do it now (the laptop's resource guard, step 8a).
 * - `failed`: it tried and failed (a clone that didn't work).
 */
export type ProviderErrorKind = 'unavailable' | 'gone' | 'refused' | 'failed';

/** A provider failure with a sentence that's safe to show the person and store. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    readonly kind: ProviderErrorKind,
    /** Shown in the page and stored as the workspace's failure; never a raw error message. */
    readonly userMessage: string,
  ) {
    super(`${kind}: ${userMessage}`);
  }
}
