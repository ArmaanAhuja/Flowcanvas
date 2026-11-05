// The rules for when a workspace sleeps and how long it counts as running, shared by the lifecycle and the
// usage meter (which can't import the lifecycle: the lifecycle records usage).

/** A running workspace with no activity for this long is put to sleep (build plan, phase 1d). */
export const IDLE_SLEEP_MS = 10 * 60_000;

/**
 * Until when a running workspace is metered: now, or the moment it would have slept, whichever is earlier.
 * If nothing put it to sleep (the laptop was shut, or `pnpm dev` stopped), the time after that isn't charged.
 */
export function meteredUntil(lastActiveMs: number | null, nowMs: number): number {
  return lastActiveMs === null ? nowMs : Math.min(nowMs, lastActiveMs + IDLE_SLEEP_MS);
}
