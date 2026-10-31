// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import {
  createSession,
  endSession,
  sessionUser,
  signIn,
  type VerifiedIdentity,
} from './accounts.js';
import { sha256Hex } from './crypto.js';

let db: Database;

beforeEach(async () => {
  db = await migratedDatabase();
});

const ada: VerifiedIdentity = {
  provider: 'github',
  providerUserId: '42',
  username: 'ada',
  email: 'ada@example.com',
  displayName: 'Ada',
  avatarUrl: undefined,
};

async function allow(email: string, role = 'member'): Promise<void> {
  await db.query('insert into sign_in_allowlist (email, role) values ($1, $2)', [email, role]);
}

async function count(table: string): Promise<number> {
  const rows = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]?.n ?? -1;
}

describe('signIn', () => {
  it('turns away anyone not on the allowlist, and stores nothing', async () => {
    expect(await signIn(db, ada)).toEqual({ kind: 'not-allowed' });
    expect(await count('users')).toBe(0);
    expect(await count('identities')).toBe(0);
  });

  it('creates the user and links the GitHub account on first sign-in, with the allowlist role', async () => {
    await allow('ada@example.com', 'admin');
    const result = await signIn(db, { ...ada, email: 'Ada@Example.com' });
    expect(result.kind).toBe('signed-in');
    const users = await db.query<{ email: string; display_name: string; role: string }>(
      'select email, display_name, role from users',
    );
    expect(users).toEqual([{ email: 'ada@example.com', display_name: 'Ada', role: 'admin' }]);
    expect(await count('identities')).toBe(1);
  });

  it('finds the same user next time and refreshes the profile and role', async () => {
    await allow('ada@example.com');
    const first = await signIn(db, ada);
    await db.query("update sign_in_allowlist set role = 'admin'");
    const second = await signIn(db, { ...ada, displayName: 'Ada Lovelace', username: 'ada-l' });

    expect(second).toEqual(first);
    const users = await db.query<{ display_name: string; role: string }>(
      'select display_name, role from users',
    );
    expect(users).toEqual([{ display_name: 'Ada Lovelace', role: 'admin' }]);
    const identities = await db.query<{ username: string }>('select username from identities');
    expect(identities).toEqual([{ username: 'ada-l' }]);
  });

  it('links a second provider with the same verified email to the same user', async () => {
    await allow('ada@example.com');
    const github = await signIn(db, ada);
    const google = await signIn(db, { ...ada, provider: 'google', providerUserId: 'g-1' });
    expect(google).toEqual(github);
    expect(await count('users')).toBe(1);
    expect(await count('identities')).toBe(2);
  });

  it('keeps a 200-character limit on names', async () => {
    await allow('ada@example.com');
    await signIn(db, { ...ada, displayName: 'A'.repeat(300) });
    const rows = await db.query<{ n: number }>('select char_length(display_name) as n from users');
    expect(rows[0]?.n).toBe(200);
  });
});

describe('sessions', () => {
  async function signedInUser(): Promise<string> {
    await allow('ada@example.com');
    const result = await signIn(db, ada);
    if (result.kind !== 'signed-in') throw new Error('expected sign-in');
    return result.userId;
  }

  it('finds the user for a live session token', async () => {
    const userId = await signedInUser();
    const token = await createSession(db, userId, 'Firefox');
    expect(await sessionUser(db, token)).toEqual({
      id: userId,
      email: 'ada@example.com',
      displayName: 'Ada',
      role: 'member',
    });
  });

  it('stores only the SHA-256 of the token', async () => {
    const userId = await signedInUser();
    const token = await createSession(db, userId, undefined);
    const rows = await db.query<{ hash: string }>(
      "select encode(token_hash, 'hex') as hash from sessions",
    );
    expect(rows).toEqual([{ hash: await sha256Hex(token) }]);
    const everything = JSON.stringify(await db.query('select * from sessions'));
    expect(everything).not.toContain(token);
  });

  it('ignores unknown and expired tokens', async () => {
    const userId = await signedInUser();
    const token = await createSession(db, userId, undefined);
    expect(await sessionUser(db, 'not-a-real-token')).toBeUndefined();

    await db.query(
      "update sessions set created_at = now() - interval '31 days', expires_at = now() - interval '1 day'",
    );
    expect(await sessionUser(db, token)).toBeUndefined();
  });

  it('ends a session', async () => {
    const userId = await signedInUser();
    const token = await createSession(db, userId, undefined);
    await endSession(db, token);
    expect(await sessionUser(db, token)).toBeUndefined();
    expect(await count('sessions')).toBe(0);
  });
});
