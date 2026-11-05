import { describeError } from '../api/redact.js';
import type { Database } from '../db/database.js';
import { isUuid, type WorkspaceState } from '../projects/projects.js';
import { monthPeriod, recordUsage } from '../usage/usage.js';
import { IDLE_SLEEP_MS, meteredUntil } from './policy.js';
import { ProviderError, type WorkspaceProvider } from './provider.js';

export { IDLE_SLEEP_MS } from './policy.js';

/**
 * The workspace lifecycle (phase 1d step 3):
 *
 *   not_created ─open─► creating ─► running ─sleep─► sleeping ─resume─► resuming ─► running
 *   stopped / failed ─open─► creating        running / sleeping ─stop─► stopped
 *
 * Each change is one compare-and-set on `version`, so concurrent requests can't both act. The provider is called
 * outside the database statement; a request that loses the race says so instead of acting twice.
 */

/** A start that hasn't finished in this long crashed part-way, so opening it again is allowed. */
export const STUCK_MS = 5 * 60_000;

/** What the page sees. The provider's own name for the workspace stays on the server. */
export interface Workspace {
  readonly id: string;
  readonly state: WorkspaceState;
  /** ISO 8601, UTC. */
  readonly stateChangedAt: string;
  /** Why the last attempt didn't work, as a sentence for the person; null when it did. */
  readonly failure: string | null;
}

export type LifecycleProblem = 'conflict' | 'unavailable' | 'refused' | 'failed' | 'gone';

export type LifecycleResult =
  | { readonly ok: true; readonly workspace: Workspace }
  | {
      readonly ok: false;
      readonly problem: LifecycleProblem;
      readonly message: string;
      readonly workspace: Workspace;
    };

export interface LifecycleContext {
  readonly db: Database;
  readonly provider: WorkspaceProvider;
  readonly now: () => number;
  readonly log: (message: string) => void;
}

interface Row {
  readonly id: string;
  readonly owner_id: string;
  readonly repo_url: string | null;
  readonly state: WorkspaceState;
  readonly provider_ref: string | null;
  readonly version: number;
  readonly state_changed_ms: number;
  readonly running_since_ms: number | null;
  readonly last_active_ms: number | null;
  readonly failure: string | null;
}

const COLUMNS = `w.id, p.owner_id, p.repo_url, w.state, w.provider_ref, w.version,
  (extract(epoch from w.state_changed_at) * 1000)::float8 as state_changed_ms,
  (extract(epoch from w.running_since) * 1000)::float8 as running_since_ms,
  (extract(epoch from w.last_active_at) * 1000)::float8 as last_active_ms, w.failure`;

const MESSAGES = {
  busy: 'This workspace is already starting. Wait a moment.',
  changed: 'This workspace changed in the meantime. Reload to see where it is.',
  unexpected: 'Something went wrong with the workspace. Try again in a moment.',
  lostWhileAsleep:
    'This workspace stopped while it was asleep, for example because the computer restarted. Open it to start it again; its files are kept.',
} as const;

function toWorkspace(row: Row): Workspace {
  return {
    id: row.id,
    state: row.state,
    stateChangedAt: new Date(row.state_changed_ms).toISOString(),
    failure: row.failure,
  };
}

/** The workspace of one of this person's projects; undefined for a missing project or someone else's. */
export async function loadWorkspace(
  db: Database,
  projectId: string,
  ownerId: string,
): Promise<Row | undefined> {
  if (!isUuid(projectId)) return undefined;
  const rows = await db.query<Row>(
    `select ${COLUMNS} from workspaces w join projects p on p.id = w.project_id
     where p.id = $1 and p.owner_id = $2`,
    [projectId, ownerId],
  );
  return rows[0];
}

export function publicWorkspace(row: Row): Workspace {
  return toWorkspace(row);
}

/**
 * Moves the workspace from the version we read to `to`, or returns undefined if someone else changed it first.
 * `running_since` and `last_active_at` start when it becomes running; `failure` is replaced every time.
 */
async function change(
  ctx: LifecycleContext,
  row: Row,
  to: WorkspaceState,
  fields: { failure?: string | null; ref?: string | null } = {},
): Promise<Row | undefined> {
  const rows = await ctx.db.query<Row>(
    `update workspaces w set
       state = $3,
       version = w.version + 1,
       state_changed_at = to_timestamp($4::float8 / 1000),
       updated_at = to_timestamp($4::float8 / 1000),
       running_since = case when $3 = 'running' then to_timestamp($4::float8 / 1000) end,
       last_active_at = case when $3 = 'running' then to_timestamp($4::float8 / 1000) else w.last_active_at end,
       failure = $5,
       provider = case when $6::boolean then $7 else w.provider end,
       provider_ref = case when $6::boolean then $8 else w.provider_ref end
     from projects p
     where p.id = w.project_id and w.id = $1 and w.version = $2
     returning ${COLUMNS}`,
    [
      row.id,
      row.version,
      to,
      ctx.now(),
      fields.failure ?? null,
      fields.ref !== undefined,
      fields.ref === null || fields.ref === undefined ? null : ctx.provider.name,
      fields.ref ?? null,
    ],
  );
  return rows[0];
}

/** Calls the provider; any error comes back as a ProviderError whose message is safe to show and store. */
async function attempt<T>(
  ctx: LifecycleContext,
  what: string,
  action: () => Promise<T>,
): Promise<T | ProviderError> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ProviderError) return error;
    ctx.log(`workspace ${what} failed: ${describeError(error)}`);
    return new ProviderError('failed', MESSAGES.unexpected);
  }
}

const ok = (row: Row): LifecycleResult => ({ ok: true, workspace: toWorkspace(row) });

function problem(row: Row, kind: LifecycleProblem, message: string): LifecycleResult {
  return { ok: false, problem: kind, message, workspace: toWorkspace(row) };
}

const conflict = (row: Row, message: string) => problem(row, 'conflict', message);

/** The result of a change that lost the race: the state as someone else left it. */
const lostRace = (row: Row) => conflict(row, MESSAGES.changed);

/**
 * Records the time it was running, up to `meteredUntil` (policy.ts), split at month boundaries (each usage
 * record sits within one month).
 */
async function recordRunTime(ctx: LifecycleContext, row: Row): Promise<void> {
  if (row.running_since_ms === null) return;
  const endMs = meteredUntil(row.last_active_ms, ctx.now());
  let start = row.running_since_ms;
  while (start < endMs) {
    const end = Math.min(endMs, monthPeriod(start).end.getTime());
    await recordUsage(ctx.db, {
      userId: row.owner_id,
      workspaceId: row.id,
      kind: 'workspace_seconds',
      quantity: Math.floor((end - start) / 1000),
      startedAt: new Date(start),
      endedAt: new Date(end),
    });
    start = end;
  }
}

function stuck(ctx: LifecycleContext, row: Row): boolean {
  return ctx.now() - row.state_changed_ms >= STUCK_MS;
}

/** Opens the workspace: creates it the first time, starts it again when stopped, resumes it when asleep. */
export async function openWorkspace(ctx: LifecycleContext, row: Row): Promise<LifecycleResult> {
  if (row.state === 'running') return ok(row);
  if (row.state === 'sleeping') return resumeWorkspace(ctx, row);
  if ((row.state === 'creating' || row.state === 'resuming') && !stuck(ctx, row)) {
    return conflict(row, MESSAGES.busy);
  }

  const creating = await change(ctx, row, 'creating');
  if (creating === undefined) return lostRace(row);

  let ref = row.provider_ref;
  let failure: ProviderError | undefined;
  if (ref !== null) {
    const existing = ref;
    const started = await attempt(ctx, 'start', () => ctx.provider.start(existing));
    if (started instanceof ProviderError) {
      failure = started;
      // The provider lost it (cleaned up, or removed by hand): make a new one.
      if (started.kind === 'gone') ref = null;
    }
  }
  if (ref === null) {
    const created = await attempt(ctx, 'create', () =>
      ctx.provider.create({ workspaceId: row.id, repoUrl: row.repo_url }),
    );
    if (created instanceof ProviderError) failure = created;
    else {
      ref = created.ref;
      failure = undefined;
    }
  }

  if (failure === undefined && ref !== null) {
    const running = await change(ctx, creating, 'running', { ref });
    return running === undefined ? lostRace(creating) : ok(running);
  }
  const error = failure ?? new ProviderError('failed', MESSAGES.unexpected);
  // Not started because of where it is (the host is down, or the laptop is busy): leave it as it was.
  const back =
    error.kind === 'unavailable' || error.kind === 'refused'
      ? row.state === 'creating' || row.state === 'resuming'
        ? 'failed'
        : row.state
      : 'failed';
  const after = await change(ctx, creating, back, { failure: error.userMessage });
  return problem(after ?? creating, error.kind, error.userMessage);
}

/** Why a workspace changed without the person asking: shown with it (from step 9), as its `failure`. */
export interface ChangeOptions {
  readonly notice?: string;
}

/** Puts a running workspace to sleep, and records how long it ran. */
export async function sleepWorkspace(
  ctx: LifecycleContext,
  row: Row,
  options: ChangeOptions = {},
): Promise<LifecycleResult> {
  if (row.state === 'sleeping') return ok(row);
  if (row.state !== 'running' || row.provider_ref === null) {
    return conflict(row, 'Only a running workspace can sleep.');
  }
  const ref = row.provider_ref;
  const result = await attempt(ctx, 'pause', () => ctx.provider.pause(ref));
  const failure = result instanceof ProviderError ? result : undefined;
  if (failure !== undefined && failure.kind !== 'gone') {
    return problem(row, failure.kind, failure.userMessage);
  }
  const to = failure === undefined ? 'sleeping' : 'stopped';
  const after = await change(ctx, row, to, {
    failure: failure?.userMessage ?? options.notice ?? null,
  });
  if (after === undefined) return lostRace(row);
  await recordRunTime(ctx, row);
  return failure === undefined ? ok(after) : problem(after, 'gone', failure.userMessage);
}

/** Wakes a sleeping workspace, with its files and processes as they were. */
export async function resumeWorkspace(ctx: LifecycleContext, row: Row): Promise<LifecycleResult> {
  if (row.state === 'running') return ok(row);
  if (row.state !== 'sleeping' || row.provider_ref === null) {
    return conflict(row, 'Only a sleeping workspace can resume.');
  }
  const ref = row.provider_ref;
  const resuming = await change(ctx, row, 'resuming');
  if (resuming === undefined) return lostRace(row);

  const result = await attempt(ctx, 'resume', () => ctx.provider.resume(ref));
  const failure = result instanceof ProviderError ? result : undefined;
  if (failure === undefined) {
    const running = await change(ctx, resuming, 'running');
    return running === undefined ? lostRace(resuming) : ok(running);
  }
  if (failure.kind === 'gone') {
    const stopped = await change(ctx, resuming, 'stopped', { failure: MESSAGES.lostWhileAsleep });
    return problem(stopped ?? resuming, 'gone', MESSAGES.lostWhileAsleep);
  }
  // Still asleep, and it can be tried again.
  const asleep = await change(ctx, resuming, 'sleeping', { failure: failure.userMessage });
  return problem(asleep ?? resuming, failure.kind, failure.userMessage);
}

/** Stops a running or sleeping workspace. Its files are kept, and opening it starts it again. */
export async function stopWorkspace(
  ctx: LifecycleContext,
  row: Row,
  options: ChangeOptions = {},
): Promise<LifecycleResult> {
  if (row.state === 'stopped') return ok(row);
  if ((row.state !== 'running' && row.state !== 'sleeping') || row.provider_ref === null) {
    return conflict(row, 'Only a running or sleeping workspace can be stopped.');
  }
  const ref = row.provider_ref;
  const result = await attempt(ctx, 'stop', () => ctx.provider.stop(ref));
  const failure = result instanceof ProviderError ? result : undefined;
  // Gone is as good as stopped.
  if (failure !== undefined && failure.kind !== 'gone') {
    return problem(row, failure.kind, failure.userMessage);
  }
  const after = await change(ctx, row, 'stopped', { failure: options.notice ?? null });
  if (after === undefined) return lostRace(row);
  await recordRunTime(ctx, row);
  return ok(after);
}

/** Notes activity (terminal input, a process running) so the workspace isn't put to sleep as idle. */
export async function touchWorkspace(
  db: Database,
  workspaceId: string,
  now: number,
): Promise<void> {
  await db.query(
    `update workspaces set last_active_at = to_timestamp($2::float8 / 1000)
     where id = $1 and state = 'running'`,
    [workspaceId, now],
  );
}

/**
 * Puts every running workspace idle for `idleMs` or more to sleep. Returns how many went to sleep. The
 * scheduled tick calls it every minute (scheduled.ts).
 */
export async function sleepIdleWorkspaces(
  ctx: LifecycleContext,
  idleMs: number = IDLE_SLEEP_MS,
): Promise<number> {
  const rows = await ctx.db.query<Row>(
    `select ${COLUMNS} from workspaces w join projects p on p.id = w.project_id
     where w.state = 'running' and w.last_active_at <= to_timestamp($1::float8 / 1000)`,
    [ctx.now() - idleMs],
  );
  let slept = 0;
  for (const row of rows) {
    const result = await sleepWorkspace(ctx, row);
    if (result.ok) slept += 1;
    else ctx.log(`idle workspace ${row.id} didn't sleep: ${result.problem}`);
  }
  return slept;
}

/** What the page says about a workspace the resource guard changed (ADR 0019). */
export const RELIEF_NOTICES = {
  stoppedForMemory:
    'Stopped to free memory on this computer. Its files are kept: open it to start it again.',
  sleptForLoad: 'Put to sleep because this computer was very busy. Resume it when you need it.',
} as const;

export type Relief =
  | { readonly action: 'stopped' | 'slept'; readonly workspaceId: string }
  | { readonly action: 'none' };

/**
 * The resource guard's half in the control plane (step 8a, ADR 0019): when the provider's machine is short of
 * memory, stop the least recently used workspace (asleep ones first: pausing keeps memory, so only stopping
 * frees it); when it's busy, put the least recently used running one to sleep. One workspace per tick: the
 * host measures again every 30 s, so the next tick acts only if that wasn't enough. Disk is the host's own job
 * (old images) and its refusals; nothing here deletes anyone's files.
 */
export async function relievePressure(ctx: LifecycleContext): Promise<Relief> {
  if (ctx.provider.pressure === undefined) return { action: 'none' };
  const kinds = await ctx.provider.pressure();
  const memory = kinds.includes('memory');
  if (!memory && !kinds.includes('load')) return { action: 'none' };
  const [row] = await ctx.db.query<Row>(
    `select ${COLUMNS} from workspaces w join projects p on p.id = w.project_id
     where w.provider_ref is not null and w.state = any($1::text[])
     order by (w.state = 'running'), w.last_active_at nulls first, w.id
     limit 1`,
    [memory ? ['sleeping', 'running'] : ['running']],
  );
  if (row === undefined) return { action: 'none' };
  const result = memory
    ? await stopWorkspace(ctx, row, { notice: RELIEF_NOTICES.stoppedForMemory })
    : await sleepWorkspace(ctx, row, { notice: RELIEF_NOTICES.sleptForLoad });
  const action = memory ? 'stopped' : 'slept';
  if (!result.ok) {
    ctx.log(`guard: workspace ${row.id} wasn't ${action}: ${result.problem}`);
    return { action: 'none' };
  }
  ctx.log(`guard: workspace ${row.id} ${action} (${memory ? 'memory' : 'load'})`);
  return { action, workspaceId: row.id };
}
