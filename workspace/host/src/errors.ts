import type { HostErrorKind } from './protocol.js';

/** An error with a kind the control plane understands and a sentence that's safe to show the person. */
export class HostError extends Error {
  override readonly name = 'HostError';
  constructor(
    readonly kind: HostErrorKind,
    readonly userMessage: string,
  ) {
    super(`${kind}: ${userMessage}`);
  }
}

/** HTTP status for each kind. */
export const ERROR_STATUS: Record<HostErrorKind, number> = {
  unavailable: 503,
  gone: 404,
  refused: 409,
  failed: 422,
};
