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
}

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
