// The usage meter against real SQL (PGlite).
// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';
import { monthPeriod, recordUsage, usageSummary, type UsageRecord } from './usage.js';

const NOW = Date.parse('2026-10-31T12:00:00Z');

describe('monthPeriod', () => {
  it('is the UTC calendar month, including across a year end', () => {
    expect(monthPeriod(NOW)).toEqual({
      start: new Date('2026-10-01T00:00:00Z'),
      end: new Date('2026-11-01T00:00:00Z'),
    });
    expect(monthPeriod(Date.parse('2026-12-31T23:59:59Z')).end).toEqual(
      new Date('2027-01-01T00:00:00Z'),
    );
  });
});

describe('the usage meter', () => {
  let db: Database;
  let ada: string;
  let grace: string;
  let adasWorkspace: string;
  let gracesWorkspace: string;

  async function workspaceOf(userId: string): Promise<string> {
    const project = await createProject(db, userId, { name: 'Rallly', repoUrl: null });
    if (project === 'duplicate-name') throw new Error('unexpected duplicate');
    return project.workspace.id;
  }

  beforeEach(async () => {
    db = await migratedDatabase();
    ada = (await signedInAs(db, 'ada@example.com')).userId;
    grace = (await signedInAs(db, 'grace@example.com')).userId;
    adasWorkspace = await workspaceOf(ada);
    gracesWorkspace = await workspaceOf(grace);
  });

  const run = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
    userId: ada,
    workspaceId: adasWorkspace,
    kind: 'workspace_seconds',
    quantity: 600,
    startedAt: new Date('2026-10-30T10:00:00Z'),
    endedAt: new Date('2026-10-30T10:10:00Z'),
    ...overrides,
  });

  it('reports a real 0 before anything is recorded, and when it resets', async () => {
    expect(await usageSummary(db, ada, NOW)).toEqual({
      periodStart: '2026-10-01T00:00:00.000Z',
      resetsAt: '2026-11-01T00:00:00.000Z',
      workspaceSeconds: 0,
      storageByteHours: 0,
    });
  });

  it('sums this month only, per person and per kind', async () => {
    await recordUsage(db, run());
    await recordUsage(db, run({ quantity: 300 }));
    await recordUsage(db, run({ kind: 'storage_byte_hours', quantity: 5_000_000 }));
    // Last month, and another person: neither counts.
    await recordUsage(
      db,
      run({
        startedAt: new Date('2026-09-30T23:00:00Z'),
        endedAt: new Date('2026-09-30T23:10:00Z'),
      }),
    );
    await recordUsage(db, run({ userId: grace, workspaceId: gracesWorkspace }));

    expect(await usageSummary(db, ada, NOW)).toMatchObject({
      workspaceSeconds: 900,
      storageByteHours: 5_000_000,
    });
    expect((await usageSummary(db, grace, NOW)).workspaceSeconds).toBe(600);
  });

  it('refuses impossible records instead of storing a wrong amount', async () => {
    for (const record of [
      run({ quantity: -1 }),
      run({ quantity: 1.5 }),
      run({ endedAt: new Date('2026-10-30T09:00:00Z') }),
      run({ startedAt: new Date('invalid') }),
      // More seconds than the period has.
      run({ quantity: 601 }),
      // Crosses into November: the recorder splits it at the boundary.
      run({
        startedAt: new Date('2026-10-31T23:50:00Z'),
        endedAt: new Date('2026-11-01T00:10:00Z'),
      }),
    ]) {
      await expect(recordUsage(db, record)).rejects.toThrow();
    }
    expect(await db.query('select 1 from usage_records')).toEqual([]);
  });

  it('refuses to charge one person for another person’s workspace', async () => {
    await expect(recordUsage(db, run({ workspaceId: gracesWorkspace }))).rejects.toThrow(
      'isn’t this person’s',
    );
    // Usage that isn't tied to a workspace is fine.
    await recordUsage(db, run({ workspaceId: null, kind: 'storage_byte_hours' }));
    expect((await usageSummary(db, ada, NOW)).storageByteHours).toBe(600);
  });
});
