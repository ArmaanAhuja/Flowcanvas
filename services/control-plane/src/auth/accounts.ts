import type { Database } from '../db/database.js';
import { randomToken, sha256Hex } from './crypto.js';

/** How long a session lasts without signing in again. The cookie's Max-Age matches it. */
export const SESSION_DAYS = 30;

export type Role = 'member' | 'admin';

/** Who an external account says they are, after its provider has verified the email. */
export interface VerifiedIdentity {
  readonly provider: 'github' | 'google';
  readonly providerUserId: string;
  readonly username: string | undefined;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | undefined;
}

export type SignInResult =
  { readonly kind: 'signed-in'; readonly userId: string } | { readonly kind: 'not-allowed' };

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
}

/**
 * Lets an allowlisted person in: finds the user this external account is linked to, or links it to the user
 * with the same (verified) email, or creates one. The allowlist decides the role on every sign-in.
 */
export async function signIn(db: Database, identity: VerifiedIdentity): Promise<SignInResult> {
  const email = identity.email.toLowerCase();
  const allowed = await db.query<{ role: Role }>(
    'select role from sign_in_allowlist where email = $1',
    [email],
  );
  const role = allowed[0]?.role;
  if (role === undefined) return { kind: 'not-allowed' };

  const displayName = identity.displayName.slice(0, 200);
  const avatarUrl = identity.avatarUrl ?? null;
  const username = identity.username ?? null;

  const linked = await db.query<{ user_id: string }>(
    'select user_id from identities where provider = $1 and provider_user_id = $2',
    [identity.provider, identity.providerUserId],
  );
  const linkedUserId = linked[0]?.user_id;
  if (linkedUserId !== undefined) {
    // One statement, so the profile and the identity's username change together.
    await db.query(
      `with updated as (
         update users set display_name = $2, avatar_url = $3, role = $4, last_signed_in_at = now()
         where id = $1 returning id
       )
       update identities set username = $5
       where user_id = (select id from updated) and provider = $6 and provider_user_id = $7`,
      [
        linkedUserId,
        displayName,
        avatarUrl,
        role,
        username,
        identity.provider,
        identity.providerUserId,
      ],
    );
    return { kind: 'signed-in', userId: linkedUserId };
  }

  // First sign-in with this account: create the user (or reuse the one with this email) and link it.
  const created = await db.query<{ user_id: string }>(
    `with person as (
       insert into users (email, display_name, avatar_url, role, last_signed_in_at)
       values ($1, $2, $3, $4, now())
       on conflict (email) do update
         set display_name = excluded.display_name, avatar_url = excluded.avatar_url,
             role = excluded.role, last_signed_in_at = now()
       returning id
     )
     insert into identities (user_id, provider, provider_user_id, username)
     select id, $5, $6, $7 from person
     on conflict (provider, provider_user_id) do update set username = excluded.username
     returning user_id`,
    [email, displayName, avatarUrl, role, identity.provider, identity.providerUserId, username],
  );
  const userId = created[0]?.user_id;
  if (userId === undefined) throw new Error('sign-in did not return a user');
  return { kind: 'signed-in', userId };
}

/** Starts a session and returns its token. Only the token's SHA-256 is stored. */
export async function createSession(
  db: Database,
  userId: string,
  userAgent: string | undefined,
): Promise<string> {
  const token = randomToken();
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at, user_agent)
     values (decode($1, 'hex'), $2, now() + make_interval(days => $3), $4)`,
    [await sha256Hex(token), userId, SESSION_DAYS, userAgent?.slice(0, 500) ?? null],
  );
  return token;
}

/** The signed-in user for a session token, or undefined if it's unknown or expired. */
export async function sessionUser(db: Database, token: string): Promise<SessionUser | undefined> {
  const rows = await db.query<{ id: string; email: string; display_name: string; role: Role }>(
    `with session as (
       update sessions set last_seen_at = now()
       where token_hash = decode($1, 'hex') and expires_at > now()
       returning user_id
     )
     select users.id, users.email, users.display_name, users.role
     from users join session on session.user_id = users.id`,
    [await sha256Hex(token)],
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

export async function endSession(db: Database, token: string): Promise<void> {
  await db.query("delete from sessions where token_hash = decode($1, 'hex')", [
    await sha256Hex(token),
  ]);
}
