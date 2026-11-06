// The Worker's scheduled handler (the once-a-minute tick), with real SQL (PGlite) and a fake provider.
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { FakeProvider } from '../test/fake-provider.js';
import { signedInAs } from '../test/sessions.js';
import { IDLE_SLEEP_MS, loadWorkspace, openWorkspace } from '../workspaces/lifecycle.js';
import { createScheduled } from './scheduled.js';

const RUN = { cron: '* * * * *', scheduledTime: 0 };
const DATABASE_URL = 'postgresql://user:hunter2@db.example.com/flowcanvas';

let db: Database;
let provider: FakeProvider;
let now: number;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;
let workspaceOf: () => Promise<string>;

beforeEach(async () => {
  db = await migratedDatabase();
  provider = new FakeProvider();
  now = Date.UTC(2026, 10, 5, 9, 0, 0);
  log = vi.fn<(message: string) => void>();
  const { userId } = await signedInAs(db, 'ada@example.com');
  const project = await createProject(db, userId, { name: 'Rallly', repoUrl: null });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  const row = await loadWorkspace(db, project.id, userId);
  if (row === undefined) throw new Error('no workspace');
  await openWorkspace({ db, provider, now: () => now, log }, row);
  workspaceOf = async () => (await loadWorkspace(db, project.id, userId))?.state ?? 'missing';
});

const tick = (options: { provider?: FakeProvider | undefined; database?: () => Database } = {}) =>
  createScheduled({
    database: options.database ?? (() => db),
    now: () => now,
    log,
    workspaceProvider: () => ('provider' in options ? options.provider : provider),
  });

describe('the scheduled tick', () => {
  it('puts a workspace idle for 10 minutes to sleep, and leaves a busy one running', async () => {
    now += IDLE_SLEEP_MS - 1_000;
    await tick()(RUN, { DATABASE_URL });
    expect(await workspaceOf()).toBe('running');
    now += 1_000;
    await tick()(RUN, { DATABASE_URL });
    expect(await workspaceOf()).toBe('sleeping');
    expect(log).toHaveBeenCalledWith('scheduled: 1 idle workspace(s) put to sleep');
  });

  it('then relieves pressure: under memory pressure it stops a workspace, with its notice', async () => {
    provider.pressureNow = ['memory'];
    await tick()(RUN, { DATABASE_URL });
    expect(await workspaceOf()).toBe('stopped');
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^guard: workspace .* stopped \(memory\)$/),
    );
  });

  it('does nothing at all where nothing runs workspaces (staging), not even open the database', async () => {
    const database = vi.fn(() => db);
    now += IDLE_SLEEP_MS;
    await tick({ provider: undefined, database })(RUN, { DATABASE_URL });
    expect(database).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('says so when the database is not configured', async () => {
    await tick()(RUN, {});
    expect(log).toHaveBeenCalledWith(
      'scheduled: DATABASE_URL is missing, so idle workspaces were not checked',
    );
  });

  it('logs a failure without throwing, and never the connection string', async () => {
    const broken = () => ({
      query: () => Promise.reject(new Error(`connect failed for ${DATABASE_URL}`)),
    });
    await expect(tick({ database: broken })(RUN, { DATABASE_URL })).resolves.toBeUndefined();
    const lines = log.mock.calls.map(([line]) => line).join('\n');
    expect(lines).toMatch(/scheduled: the checks failed/);
    expect(lines).not.toContain('hunter2');
  });
});
