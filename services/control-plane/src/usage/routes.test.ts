// /api/usage through the whole API (PGlite).
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/app.js';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';
import { recordUsage } from './usage.js';

const APP = 'https://flowcanvas.example.workers.dev';
const env = { DATABASE_URL: 'postgresql://unused-by-the-fake-database', APP_ORIGIN: APP };
const NOW = Date.parse('2026-10-31T12:00:00Z');

let db: Database;
let log: ReturnType<typeof vi.fn<(message: string) => void>>;

beforeEach(async () => {
  db = await migratedDatabase();
  log = vi.fn<(message: string) => void>();
});

const get = (cookie?: string, database: () => Database = () => db) =>
  createApi({ database, log, now: () => NOW }).request(
    `${APP}/api/usage`,
    cookie === undefined ? {} : { headers: { cookie } },
    env,
  );

describe('/api/usage', () => {
  it('needs a signed-in person', async () => {
    expect((await get()).status).toBe(401);
  });

  it('answers with this month’s sums for the signed-in person only', async () => {
    const ada = await signedInAs(db, 'ada@example.com');
    const grace = await signedInAs(db, 'grace@example.com');
    await recordUsage(db, {
      userId: grace.userId,
      workspaceId: null,
      kind: 'workspace_seconds',
      quantity: 60,
      startedAt: new Date('2026-10-30T10:00:00Z'),
      endedAt: new Date('2026-10-30T10:01:00Z'),
    });

    const response = await get(ada.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      usage: {
        periodStart: '2026-10-01T00:00:00.000Z',
        resetsAt: '2026-11-01T00:00:00.000Z',
        workspaceSeconds: 0,
        storageByteHours: 0,
      },
    });
    expect(
      ((await (await get(grace.cookie)).json()) as { usage: { workspaceSeconds: number } }).usage
        .workspaceSeconds,
    ).toBe(60);
  });

  it('says so when the database fails, without details', async () => {
    const { cookie } = await signedInAs(db, 'ada@example.com');
    let calls = 0;
    // The session check succeeds; the usage query fails.
    const flaky = (): Database => ({
      query: async (sql, params) => {
        calls += 1;
        if (calls > 1) throw new Error('connection reset');
        return db.query(sql, params);
      },
    });
    const response = await get(cookie, flaky);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Could not load your usage. Try again in a moment.',
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('reading usage failed'));
  });
});
