// The workspace lifecycle against real SQL (PGlite) and a fake provider, with a clock the tests move.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { FakeProvider } from '../test/fake-provider.js';
import { signedInAs } from '../test/sessions.js';
import { usageSummary } from '../usage/usage.js';
import {
  IDLE_SLEEP_MS,
  STUCK_MS,
  loadWorkspace,
  RELIEF_NOTICES,
  openWorkspace,
  relievePressure,
  resumeWorkspace,
  sleepIdleWorkspaces,
  sleepWorkspace,
  stopWorkspace,
  touchWorkspace,
  type LifecycleContext,
} from './lifecycle.js';
import { ProviderError, type WorkspaceProvider } from './provider.js';

const REPO = 'https://github.com/ArmaanAhuja-7777/rallly';
const NOV_4 = Date.UTC(2026, 10, 4, 12, 0, 0);

let db: Database;
let provider: FakeProvider;
let now: number;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let ctx: LifecycleContext;
let userId: string;
let projectId: string;

beforeEach(async () => {
  db = await migratedDatabase();
  provider = new FakeProvider();
  now = NOV_4;
  log = vi.fn<(message: string) => void>();
  ctx = { db, provider, now: () => now, log };
  userId = (await signedInAs(db, 'ada@example.com')).userId;
  const project = await createProject(db, userId, { name: 'Rallly', repoUrl: REPO });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  projectId = project.id;
});

async function current() {
  const row = await loadWorkspace(db, projectId, userId);
  if (row === undefined) throw new Error('no workspace');
  return row;
}

const seconds = async () => (await usageSummary(db, userId, now)).workspaceSeconds;

describe('loadWorkspace', () => {
  it("finds only the person's own workspace", async () => {
    const grace = (await signedInAs(db, 'grace@example.com')).userId;
    expect((await current()).state).toBe('not_created');
    expect(await loadWorkspace(db, projectId, grace)).toBeUndefined();
    expect(await loadWorkspace(db, 'not-a-uuid', userId)).toBeUndefined();
  });
});

describe('open', () => {
  it('creates the workspace with its repository the first time', async () => {
    const result = await openWorkspace(ctx, await current());
    expect(result).toMatchObject({ ok: true, workspace: { state: 'running', failure: null } });
    const row = await current();
    expect(provider.calls).toEqual([`create ${row.id}`]);
    expect(row.provider_ref).toBe(`fake-${row.id}`);
    const [stored] = await db.query<{ provider: string }>('select provider from workspaces');
    expect(stored?.provider).toBe('fake');
  });

  it('passes a pinned commit on to the provider, so a lost workspace is made again at the same commit', async () => {
    const pinned = await createProject(db, userId, {
      name: 'Pinned',
      repoUrl: REPO,
      repoCommit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
    });
    if (pinned === 'duplicate-name') throw new Error('unexpected duplicate');
    const row = await loadWorkspace(db, pinned.id, userId);
    if (row === undefined) throw new Error('no workspace');
    await openWorkspace(ctx, row);
    expect(provider.created.at(-1)).toEqual({
      workspaceId: row.id,
      repoUrl: REPO,
      commit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
    });
  });

  it('does nothing more when it is already running', async () => {
    await openWorkspace(ctx, await current());
    expect(await openWorkspace(ctx, await current())).toMatchObject({ ok: true });
    expect(provider.calls).toHaveLength(1);
  });

  it('resumes a sleeping workspace instead of creating another', async () => {
    await openWorkspace(ctx, await current());
    await sleepWorkspace(ctx, await current());
    expect(await openWorkspace(ctx, await current())).toMatchObject({
      workspace: { state: 'running' },
    });
    expect(provider.calls.map((call) => call.split(' ')[0])).toEqual(['create', 'pause', 'resume']);
  });

  it('starts a stopped workspace again with the same files', async () => {
    await openWorkspace(ctx, await current());
    const ref = (await current()).provider_ref;
    await stopWorkspace(ctx, await current());
    expect(await openWorkspace(ctx, await current())).toMatchObject({ ok: true });
    expect(provider.calls.at(-1)).toBe(`start ${String(ref)}`);
    expect((await current()).provider_ref).toBe(ref);
  });

  it('makes a new one when the provider lost the stopped one', async () => {
    await openWorkspace(ctx, await current());
    await stopWorkspace(ctx, await current());
    provider.lose(String((await current()).provider_ref));
    expect(await openWorkspace(ctx, await current())).toMatchObject({
      ok: true,
      workspace: { state: 'running', failure: null },
    });
    expect(provider.calls.slice(-2).map((call) => call.split(' ')[0])).toEqual(['start', 'create']);
  });

  it('records a failed clone as failed, with its message, and can be tried again', async () => {
    provider.failNext('create', new ProviderError('failed', 'The repository could not be cloned.'));
    expect(await openWorkspace(ctx, await current())).toEqual({
      ok: false,
      problem: 'failed',
      message: 'The repository could not be cloned.',
      workspace: expect.objectContaining({
        state: 'failed',
        failure: 'The repository could not be cloned.',
      }) as unknown,
    });
    expect(await openWorkspace(ctx, await current())).toMatchObject({
      ok: true,
      workspace: { state: 'running', failure: null },
    });
  });

  it('leaves it as it was when the host is down or the laptop is busy', async () => {
    provider.failNext(
      'create',
      new ProviderError('unavailable', 'The workspace host isn’t running.'),
    );
    expect(await openWorkspace(ctx, await current())).toMatchObject({
      problem: 'unavailable',
      workspace: { state: 'not_created', failure: 'The workspace host isn’t running.' },
    });
    await openWorkspace(ctx, await current());
    await stopWorkspace(ctx, await current());
    provider.failNext('start', new ProviderError('refused', 'Your computer is low on memory.'));
    expect(await openWorkspace(ctx, await current())).toMatchObject({
      problem: 'refused',
      workspace: { state: 'stopped' },
    });
  });

  it('never stores or shows an unexpected error, only a plain sentence', async () => {
    provider.failNext('create', new Error('spawn failed: token=CANARY-ghp_1234 at /home/someone'));
    const result = await openWorkspace(ctx, await current());
    expect(result).toMatchObject({ ok: false, problem: 'failed', workspace: { state: 'failed' } });
    expect(JSON.stringify(result)).not.toContain('CANARY');
    expect((await current()).failure).toBe(
      'Something went wrong with the workspace. Try again in a moment.',
    );
    // The details go to the (redacted) log, where the API's wrapper removes tokens.
    expect(log).toHaveBeenCalledWith(expect.stringContaining('workspace create failed'));
  });

  it('refuses a second open while the first is still starting', async () => {
    const release = provider.holdNext('create');
    const first = openWorkspace(ctx, await current());
    await vi.waitFor(() => {
      expect(provider.calls).toHaveLength(1);
    });
    expect(await openWorkspace(ctx, await current())).toMatchObject({
      ok: false,
      problem: 'conflict',
      message: 'This workspace is already starting. Wait a moment.',
    });
    release();
    expect(await first).toMatchObject({ ok: true, workspace: { state: 'running' } });
    expect(provider.calls).toHaveLength(1);
  });

  it('allows opening again when a start crashed part-way', async () => {
    const release = provider.holdNext('create');
    void openWorkspace(ctx, await current());
    await vi.waitFor(() => {
      expect(provider.calls).toHaveLength(1);
    });
    now += STUCK_MS;
    // The first request never finishes (its process died); this one takes over.
    expect(await openWorkspace(ctx, await current())).toMatchObject({ ok: true });
    release();
  });
});

describe('sleep, resume and stop', () => {
  beforeEach(async () => {
    await openWorkspace(ctx, await current());
  });

  it('sleeps, and records the time it ran', async () => {
    now += 90_000;
    expect(await sleepWorkspace(ctx, await current())).toMatchObject({
      workspace: { state: 'sleeping' },
    });
    expect(provider.workspaces.get(String((await current()).provider_ref))).toBe('paused');
    expect(await seconds()).toBe(90);
  });

  it('counts only running time: asleep costs nothing', async () => {
    now += 60_000;
    await sleepWorkspace(ctx, await current());
    now += 3_600_000;
    await resumeWorkspace(ctx, await current());
    now += 30_000;
    await stopWorkspace(ctx, await current());
    expect(await seconds()).toBe(90);
  });

  it('records the time only once when two requests race', async () => {
    const stale = await current();
    now += 10_000;
    expect(await sleepWorkspace(ctx, stale)).toMatchObject({ ok: true });
    expect(await sleepWorkspace(ctx, stale)).toMatchObject({ ok: false, problem: 'conflict' });
    expect(await seconds()).toBe(10);
  });

  it('splits run time at the end of the month', async () => {
    const fresh = await migratedDatabase();
    const user = (await signedInAs(fresh, 'ada@example.com')).userId;
    const project = await createProject(fresh, user, { name: 'Rallly', repoUrl: null });
    if (project === 'duplicate-name') throw new Error('unexpected duplicate');
    const local = { ...ctx, db: fresh };
    now = Date.UTC(2026, 9, 31, 23, 59, 0);
    const row = await loadWorkspace(fresh, project.id, user);
    if (row === undefined) throw new Error('no workspace');
    await openWorkspace(local, row);
    now = Date.UTC(2026, 10, 1, 0, 1, 0);
    const running = await loadWorkspace(fresh, project.id, user);
    if (running === undefined) throw new Error('no workspace');
    await stopWorkspace(local, running);
    const records = await fresh.query<{ quantity: number }>(
      'select quantity::float8 as quantity from usage_records order by started_at',
    );
    expect(records.map((record) => record.quantity)).toEqual([60, 60]);
  });

  it('resumes with the same workspace', async () => {
    await sleepWorkspace(ctx, await current());
    expect(await resumeWorkspace(ctx, await current())).toMatchObject({
      workspace: { state: 'running' },
    });
    expect(provider.calls.at(-1)).toBe(`resume ${String((await current()).provider_ref)}`);
  });

  it('says so, and shows it stopped, when it was lost while asleep', async () => {
    await sleepWorkspace(ctx, await current());
    provider.lose(String((await current()).provider_ref));
    const result = await resumeWorkspace(ctx, await current());
    expect(result).toMatchObject({ ok: false, problem: 'gone', workspace: { state: 'stopped' } });
    expect(result.ok ? '' : result.message).toMatch(/stopped while it was asleep.*files are kept/);
  });

  it('stays asleep when resuming is refused, so it can be tried again', async () => {
    await sleepWorkspace(ctx, await current());
    provider.failNext('resume', new ProviderError('refused', 'Your computer is low on memory.'));
    expect(await resumeWorkspace(ctx, await current())).toMatchObject({
      problem: 'refused',
      workspace: { state: 'sleeping', failure: 'Your computer is low on memory.' },
    });
    expect(await resumeWorkspace(ctx, await current())).toMatchObject({
      workspace: { state: 'running', failure: null },
    });
  });

  it('stays running when pausing fails, and reports it', async () => {
    provider.failNext(
      'pause',
      new ProviderError('unavailable', 'The workspace host isn’t running.'),
    );
    expect(await sleepWorkspace(ctx, await current())).toMatchObject({
      problem: 'unavailable',
      workspace: { state: 'running' },
    });
  });

  it('stops from running or sleeping; a lost workspace counts as stopped', async () => {
    await sleepWorkspace(ctx, await current());
    expect(await stopWorkspace(ctx, await current())).toMatchObject({
      workspace: { state: 'stopped' },
    });
    await openWorkspace(ctx, await current());
    provider.lose(String((await current()).provider_ref));
    expect(await stopWorkspace(ctx, await current())).toMatchObject({
      ok: true,
      workspace: { state: 'stopped' },
    });
  });

  it('refuses changes that make no sense from where it is', async () => {
    await stopWorkspace(ctx, await current());
    expect(await sleepWorkspace(ctx, await current())).toMatchObject({ problem: 'conflict' });
    expect(await resumeWorkspace(ctx, await current())).toMatchObject({ problem: 'conflict' });
    expect(await stopWorkspace(ctx, await current())).toMatchObject({ ok: true });
  });
});

describe('idle sleep', () => {
  beforeEach(async () => {
    await openWorkspace(ctx, await current());
  });

  it('puts a workspace to sleep after 10 idle minutes', async () => {
    now += IDLE_SLEEP_MS - 1;
    expect(await sleepIdleWorkspaces(ctx)).toBe(0);
    now += 1;
    expect(await sleepIdleWorkspaces(ctx)).toBe(1);
    expect((await current()).state).toBe('sleeping');
    expect(await seconds()).toBe(IDLE_SLEEP_MS / 1000);
  });

  it('counts the 10 minutes from the last activity', async () => {
    now += 9 * 60_000;
    await touchWorkspace(db, (await current()).id, now);
    now += 9 * 60_000;
    expect(await sleepIdleWorkspaces(ctx)).toBe(0);
    now += 60_000;
    expect(await sleepIdleWorkspaces(ctx)).toBe(1);
  });
});

describe('metering', () => {
  beforeEach(async () => {
    await openWorkspace(ctx, await current());
  });

  it('counts a running workspace as it runs, and the same seconds once it sleeps (no double count)', async () => {
    now += 5 * 60_000;
    expect(await seconds()).toBe(300);
    await sleepWorkspace(ctx, await current());
    expect(await seconds()).toBe(300);
    now += 60 * 60_000;
    expect(await seconds()).toBe(300);
  });

  it('counts only until it would have slept, when nothing put it to sleep (laptop shut, pnpm dev stopped)', async () => {
    now += 2 * 60_000;
    await touchWorkspace(db, (await current()).id, now);
    now += 5 * 3_600_000;
    // 2 minutes, then 10 idle minutes after the last activity: 12 minutes, not 5 hours.
    expect(await seconds()).toBe(12 * 60);
    expect(await sleepIdleWorkspaces(ctx)).toBe(1);
    expect(await seconds()).toBe(12 * 60);
  });

  it('records no more than that when a lost workspace is found later', async () => {
    provider.lose(String((await current()).provider_ref));
    now += 3 * 3_600_000;
    expect(await sleepIdleWorkspaces(ctx)).toBe(0);
    expect((await current()).state).toBe('stopped');
    expect(await seconds()).toBe(IDLE_SLEEP_MS / 1000);
  });

  it("counts a workspace that's been running since last month from this month's start only", async () => {
    now = Date.UTC(2026, 10, 30, 23, 58, 0);
    const fresh = await migratedDatabase();
    const user = (await signedInAs(fresh, 'ada@example.com')).userId;
    const project = await createProject(fresh, user, { name: 'Rallly', repoUrl: null });
    if (project === 'duplicate-name') throw new Error('unexpected duplicate');
    const local = { ...ctx, db: fresh };
    const row = await loadWorkspace(fresh, project.id, user);
    if (row === undefined) throw new Error('no workspace');
    await openWorkspace(local, row);
    now = Date.UTC(2026, 11, 1, 0, 3, 0);
    await touchWorkspace(fresh, row.id, now);
    expect((await usageSummary(fresh, user, now)).workspaceSeconds).toBe(180);
  });

  it("counts only the person's own workspaces", async () => {
    now += 60_000;
    const grace = (await signedInAs(db, 'grace@example.com')).userId;
    expect((await usageSummary(db, grace, now)).workspaceSeconds).toBe(0);
  });
});

describe('the resource guard (relievePressure)', () => {
  let second: string;
  const stateOf = async (id: string) =>
    (
      await db.query<{ state: string; failure: string | null }>(
        'select state, failure from workspaces where project_id = $1',
        [id],
      )
    )[0];

  beforeEach(async () => {
    const other = await createProject(db, userId, { name: 'Documenso', repoUrl: null });
    if (other === 'duplicate-name') throw new Error('unexpected duplicate');
    second = other.id;
    await openWorkspace(ctx, await current());
    now += 60_000;
    const row = await loadWorkspace(db, second, userId);
    if (row === undefined) throw new Error('no workspace');
    await openWorkspace(ctx, row);
    now += 60_000;
  });

  it('does nothing without pressure, or when only disk is short (that is the host’s job)', async () => {
    expect(await relievePressure(ctx)).toEqual({ action: 'none' });
    provider.pressureNow = ['disk', 'budget'];
    expect(await relievePressure(ctx)).toEqual({ action: 'none' });
    expect(provider.calls.filter((c) => /^(pause|stop)/.test(c))).toEqual([]);
  });

  it('under memory pressure, stops the least recently used workspace, with a notice', async () => {
    provider.pressureNow = ['memory'];
    // Rallly was opened first, so it was used least recently.
    expect(await relievePressure(ctx)).toMatchObject({ action: 'stopped' });
    expect(await stateOf(projectId)).toEqual({
      state: 'stopped',
      failure: RELIEF_NOTICES.stoppedForMemory,
    });
    expect((await stateOf(second))?.state).toBe('running');
    // Its time was recorded when it stopped.
    expect(await seconds()).toBeGreaterThan(0);
  });

  it('stops an asleep workspace before a running one: pausing keeps memory, only stopping frees it', async () => {
    const row = await loadWorkspace(db, second, userId);
    if (row === undefined) throw new Error('no workspace');
    await sleepWorkspace(ctx, row);
    provider.pressureNow = ['memory'];
    await relievePressure(ctx);
    expect((await stateOf(second))?.state).toBe('stopped');
    expect((await stateOf(projectId))?.state).toBe('running');
  });

  it('when the computer is busy, puts the least recently used running workspace to sleep', async () => {
    await touchWorkspace(db, (await current()).id, now);
    provider.pressureNow = ['load'];
    expect(await relievePressure(ctx)).toMatchObject({ action: 'slept' });
    expect(await stateOf(second)).toEqual({
      state: 'sleeping',
      failure: RELIEF_NOTICES.sleptForLoad,
    });
    // One per tick: the next tick acts only if that wasn't enough.
    expect((await stateOf(projectId))?.state).toBe('running');
    expect(await relievePressure(ctx)).toMatchObject({ action: 'slept' });
    expect(await relievePressure(ctx)).toEqual({ action: 'none' });
  });

  it('logs a workspace it could not change, and carries on', async () => {
    provider.pressureNow = ['memory'];
    provider.failNext('stop', new ProviderError('unavailable', 'The host isn’t running.'));
    expect(await relievePressure(ctx)).toEqual({ action: 'none' });
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^guard: workspace .* wasn't stopped: unavailable$/),
    );
  });

  it('does nothing with a provider that has no guard (a cloud one)', async () => {
    provider.pressureNow = ['memory'];
    const cloud: WorkspaceProvider = {
      name: 'cloud',
      create: (input) => provider.create(input),
      start: (ref) => provider.start(ref),
      pause: (ref) => provider.pause(ref),
      resume: (ref) => provider.resume(ref),
      stop: (ref) => provider.stop(ref),
      agent: (ref, request) => provider.agent(ref, request),
      terminal: (ref, size) => provider.terminal(ref, size),
    };
    expect(await relievePressure({ ...ctx, provider: cloud })).toEqual({ action: 'none' });
  });

  it('a person opening it again clears the notice', async () => {
    provider.pressureNow = ['memory'];
    await relievePressure(ctx);
    provider.pressureNow = [];
    await openWorkspace(ctx, await current());
    expect(await stateOf(projectId)).toEqual({ state: 'running', failure: null });
  });
});

describe('the database backstop', () => {
  it('refuses a running workspace without a start time, and the reverse', async () => {
    await expect(db.query("update workspaces set state = 'running'")).rejects.toThrow(
      /workspaces_running_since_check/,
    );
    await expect(db.query('update workspaces set running_since = now()')).rejects.toThrow(
      /workspaces_running_since_check/,
    );
  });
});
