// The resource guard (phase 1d step 8a, owner 4 Nov 2026): keeps Flowcanvas within its budget on this laptop.
// It measures and refuses here, in the host; the control plane's minute tick decides which workspace to put to
// sleep or stop, through the lifecycle, so the page and the usage meter stay right (ADR 0019).
//
// It only ever acts on Flowcanvas's own things: it refuses our own starts, and removes old images of our own
// workspace image. Nothing else on the laptop is touched.
import type { Docker } from './docker-cli.js';
import { findObjects, remove } from './clean.js';
import type { Pressure, PressureKind } from './protocol.js';
import { BUDGET, type SystemFigures } from './resources.js';

export const GUARD = {
  /** Memory, free disk and load: cheap to read. */
  everyMs: 30_000,
  /** Flowcanvas's own disk: slow to measure (Docker sizes every volume), so less often. */
  diskEveryMs: 5 * 60_000,
} as const;

const GiB = 1024 ** 3;
const gib = (bytes: number) => `${String(Math.round(bytes / GiB))} GiB`;

export const MESSAGES: Record<PressureKind, string> = {
  memory: `This computer is low on memory (under ${gib(BUDGET.minAvailableMemoryBytes)} available), so a workspace can't start now. Close something, or stop another workspace, then try again.`,
  disk: `This computer is low on disk space (under ${gib(BUDGET.minFreeDiskBytes)} free), so a workspace can't start now. Free some space, then try again.`,
  load: 'This computer has been very busy for a few minutes, so a workspace can’t start or resume now. Try again in a few minutes.',
  budget: `Flowcanvas's workspaces use more than their ${gib(BUDGET.flowcanvasDiskBytes)} of disk on this computer, so a new one can't start now. Stop one and clean up with pnpm workspace:clean.`,
};

export interface GuardOptions {
  readonly readSystem: () => Promise<SystemFigures>;
  /** Our images and workspace volumes, in bytes. */
  readonly readFlowcanvasDisk: () => Promise<number>;
  /** Frees disk without losing anyone's work; returns what it removed. */
  readonly cleanUp: () => Promise<readonly string[]>;
  readonly now?: () => number;
  readonly log: (line: string) => void;
}

/** The pressures these figures show. `loadHighSince` is when the load went over the line (null if it isn't). */
export function evaluate(
  system: SystemFigures,
  flowcanvasDiskBytes: number,
  loadHighSince: number | null,
  now: number,
): Pressure[] {
  const kinds: PressureKind[] = [];
  if (system.memoryAvailableBytes < BUDGET.minAvailableMemoryBytes) kinds.push('memory');
  if (system.diskFreeBytes < BUDGET.minFreeDiskBytes) kinds.push('disk');
  if (loadHighSince !== null && now - loadHighSince >= BUDGET.loadSustainedMs) kinds.push('load');
  if (flowcanvasDiskBytes > BUDGET.flowcanvasDiskBytes) kinds.push('budget');
  return kinds.map((kind) => ({ kind, message: MESSAGES[kind] }));
}

export class ResourceGuard {
  readonly #options: GuardOptions;
  readonly #now: () => number;
  #pressure: readonly Pressure[] = [];
  #loadHighSince: number | null = null;
  #disk = { bytes: 0, at: Number.NEGATIVE_INFINITY };
  #timer: ReturnType<typeof setInterval> | undefined;
  #failing = false;

  constructor(options: GuardOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  /** What the last check found; empty when there's room. */
  current(): readonly Pressure[] {
    return this.#pressure;
  }

  /** Measures once, and frees disk when it's short. Keeps the last answer if measuring fails. */
  async check(): Promise<readonly Pressure[]> {
    const now = this.#now();
    try {
      const system = await this.#options.readSystem();
      if (now - this.#disk.at >= GUARD.diskEveryMs) {
        this.#disk = { bytes: await this.#options.readFlowcanvasDisk(), at: now };
      }
      const busy = system.load1 > BUDGET.maxLoadPerCore * system.cores;
      this.#loadHighSince = busy ? (this.#loadHighSince ?? now) : null;
      const pressure = evaluate(system, this.#disk.bytes, this.#loadHighSince, now);
      if (pressure.some((p) => p.kind === 'disk' || p.kind === 'budget')) {
        const removed = await this.#options.cleanUp();
        for (const name of removed) this.#options.log(`guard: removed ${name} to free disk`);
        // Measure again next time, now that something may have gone.
        if (removed.length > 0) this.#disk.at = Number.NEGATIVE_INFINITY;
      }
      this.#report(pressure);
      this.#failing = false;
    } catch (error) {
      if (!this.#failing) this.#options.log(`guard: couldn't measure: ${String(error)}`);
      this.#failing = true;
    }
    return this.#pressure;
  }

  start(): void {
    void this.check();
    this.#timer = setInterval(() => void this.check(), GUARD.everyMs);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  /** Logs only changes, so a long spell of pressure is one line, not one every 30 s. */
  #report(pressure: readonly Pressure[]): void {
    const before = this.#pressure.map((p) => p.kind).join(',');
    const after = pressure.map((p) => p.kind).join(',');
    this.#pressure = pressure;
    if (before === after) return;
    this.#options.log(
      after === '' ? 'guard: back within limits' : `guard: under pressure: ${after}`,
    );
  }
}

/** Old images of our workspace image that nothing uses. Docker refuses to remove one a container still uses. */
export async function removeOldImages(docker: Docker, currentImage: string): Promise<string[]> {
  const removed: string[] = [];
  for (const object of await findObjects(docker)) {
    if (object.kind !== 'image' || !object.name.startsWith('flowcanvas-workspace:')) continue;
    if (object.name === currentImage) continue;
    try {
      await remove(docker, object);
      removed.push(object.name);
    } catch {
      // Still used by a stopped workspace's container: kept.
    }
  }
  return removed;
}
