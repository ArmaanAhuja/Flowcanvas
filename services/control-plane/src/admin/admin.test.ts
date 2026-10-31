// The admin view's queries against real SQL (PGlite).
// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionUser } from '../auth/accounts.js';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';
import { recordUsage } from '../usage/usage.js';
import { allowEmail, disallowEmail, listAllowlist, listPeople, parseEmail } from './admin.js';

const NOW = Date.parse('2026-10-31T12:00:00Z');

describe('parseEmail', () => {
  it('lower-cases and trims, and refuses what isn’t an address', () => {
    expect(parseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
    for (const bad of [
      '',
      'ada',
      'ada@example',
      'a b@example.com',
      42,
      `${'a'.repeat(250)}@x.io`,
    ]) {
      expect(parseEmail(bad)).toMatchObject({ field: 'email' });
    }
  });
});

describe('the admin view', () => {
  let db: Database;

  beforeEach(async () => {
    db = await migratedDatabase();
  });

  it('lists people with counts only, never project details', async () => {
    const ada = await signedInAs(db, 'ada@example.com', 'admin');
    await signedInAs(db, 'grace@example.com');
    const project = await createProject(db, ada.userId, {
      name: 'Secret plans',
      repoUrl: 'https://github.com/ada/private-thing',
    });
    if (project === 'duplicate-name') throw new Error('unexpected duplicate');
    await recordUsage(db, {
      userId: ada.userId,
      workspaceId: project.workspace.id,
      kind: 'workspace_seconds',
      quantity: 120,
      startedAt: new Date('2026-10-30T10:00:00Z'),
      endedAt: new Date('2026-10-30T10:02:00Z'),
    });

    const people = await listPeople(db, NOW);
    expect(people.map((person) => person.email).sort()).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
    expect(people.find((person) => person.email === 'ada@example.com')).toMatchObject({
      role: 'admin',
      providers: ['github'],
      projectCount: 1,
      workspaceSecondsThisMonth: 120,
      allowed: true,
    });
    const text = JSON.stringify(people);
    expect(text).not.toContain('Secret plans');
    expect(text).not.toContain('private-thing');
  });

  it('adds an email, then changes its role, including for someone already signed in', async () => {
    expect(await allowEmail(db, 'linus@example.com', 'member')).toBe('added');
    expect(await listAllowlist(db)).toMatchObject([
      { email: 'linus@example.com', role: 'member', signedUp: false },
    ]);

    const grace = await signedInAs(db, 'grace@example.com');
    expect(await allowEmail(db, 'grace@example.com', 'admin')).toBe('changed');
    const [person] = await db.query<{ role: string }>('select role from users where id = $1', [
      grace.userId,
    ]);
    expect(person?.role).toBe('admin');
  });

  it('removing an email signs that person out everywhere and keeps their data', async () => {
    const grace = await signedInAs(db, 'grace@example.com');
    const token = grace.cookie.split('=')[1] ?? '';
    await createProject(db, grace.userId, { name: 'Rallly', repoUrl: null });
    expect(await sessionUser(db, token)).toBeDefined();

    expect(await disallowEmail(db, 'grace@example.com')).toEqual({
      removed: true,
      sessionsEnded: 1,
    });
    expect(await sessionUser(db, token)).toBeUndefined();
    expect(await listAllowlist(db)).toEqual([]);
    const [person] = await listPeople(db, NOW);
    expect(person).toMatchObject({ email: 'grace@example.com', projectCount: 1, allowed: false });

    expect(await disallowEmail(db, 'grace@example.com')).toEqual({
      removed: false,
      sessionsEnded: 0,
    });
  });
});
