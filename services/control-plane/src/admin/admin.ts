import type { Role } from '../auth/accounts.js';
import type { Database } from '../db/database.js';
import { monthPeriod } from '../usage/usage.js';

/**
 * What the admin view shows: who can sign in, who has, and how much each person uses. Counts only: never project
 * names, repository addresses, secrets or anything inside a project.
 */
export interface Person {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  /** The providers this person has signed in with, e.g. ['github', 'google']. */
  readonly providers: readonly string[];
  readonly projectCount: number;
  readonly workspaceSecondsThisMonth: number;
  /** ISO 8601, UTC. */
  readonly createdAt: string;
  readonly lastSignedInAt: string | null;
  /** Whether this email is still on the allowlist; people taken off it keep their data but can't sign in. */
  readonly allowed: boolean;
}

export interface AllowedEmail {
  readonly email: string;
  readonly role: Role;
  /** ISO 8601, UTC. */
  readonly addedAt: string;
  /** Whether someone has signed in with this email yet. */
  readonly signedUp: boolean;
}

export interface EmailProblem {
  readonly field: 'email';
  readonly message: string;
}

// Deliberately loose: the provider verifies the address; this only stops typos and junk.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMAIL_MAX = 254;

/** Lower-cases and checks an email for the allowlist, the same way sign-in compares them. */
export function parseEmail(value: unknown): string | EmailProblem {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email === '') return { field: 'email', message: 'Enter an email address.' };
  if (email.length > EMAIL_MAX || !EMAIL.test(email)) {
    return { field: 'email', message: 'Enter a full email address, like ada@example.com.' };
  }
  return email;
}

export function isRole(value: unknown): value is Role {
  return value === 'member' || value === 'admin';
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export async function listPeople(db: Database, now: number): Promise<Person[]> {
  const { start, end } = monthPeriod(now);
  const rows = await db.query<{
    id: string;
    email: string;
    display_name: string;
    role: Role;
    providers: string[] | null;
    project_count: number;
    workspace_seconds: number;
    created_ms: number;
    last_signed_in_ms: number | null;
    allowed: boolean;
  }>(
    `select u.id, u.email, u.display_name, u.role,
            (select array_agg(distinct i.provider order by i.provider) from identities i
             where i.user_id = u.id) as providers,
            (select count(*) from projects p where p.owner_id = u.id)::int as project_count,
            (select coalesce(sum(r.quantity), 0) from usage_records r
             where r.user_id = u.id and r.kind = 'workspace_seconds'
               and r.started_at >= $1::timestamptz and r.started_at < $2::timestamptz)::float8
              as workspace_seconds,
            (extract(epoch from u.created_at) * 1000)::float8 as created_ms,
            (extract(epoch from u.last_signed_in_at) * 1000)::float8 as last_signed_in_ms,
            exists (select 1 from sign_in_allowlist a where a.email = u.email) as allowed
     from users u order by u.last_signed_in_at desc nulls last, u.email`,
    [start.toISOString(), end.toISOString()],
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    providers: row.providers ?? [],
    projectCount: row.project_count,
    workspaceSecondsThisMonth: row.workspace_seconds,
    createdAt: new Date(row.created_ms).toISOString(),
    lastSignedInAt: iso(row.last_signed_in_ms),
    allowed: row.allowed,
  }));
}

export async function listAllowlist(db: Database): Promise<AllowedEmail[]> {
  const rows = await db.query<{ email: string; role: Role; added_ms: number; signed_up: boolean }>(
    `select a.email, a.role, (extract(epoch from a.added_at) * 1000)::float8 as added_ms,
            exists (select 1 from users u where u.email = a.email) as signed_up
     from sign_in_allowlist a order by a.email`,
  );
  return rows.map((row) => ({
    email: row.email,
    role: row.role,
    addedAt: new Date(row.added_ms).toISOString(),
    signedUp: row.signed_up,
  }));
}

/**
 * Adds an email to the allowlist, or changes its role. A person who already signed in gets the new role at once,
 * not only at their next sign-in, so taking admin away takes effect immediately.
 */
export async function allowEmail(
  db: Database,
  email: string,
  role: Role,
): Promise<'added' | 'changed'> {
  const rows = await db.query<{ added: boolean }>(
    `with allowed as (
       insert into sign_in_allowlist (email, role) values ($1, $2)
       on conflict (email) do update set role = excluded.role
       returning (xmax = 0) as added
     ), person as (
       update users set role = $2 where email = $1 returning id
     )
     select added from allowed`,
    [email, role],
  );
  return rows[0]?.added === true ? 'added' : 'changed';
}

/**
 * Takes an email off the allowlist and ends that person's sessions, so they're signed out everywhere now. Their
 * account and projects stay (deleting someone's data is a separate, later decision).
 */
export async function disallowEmail(
  db: Database,
  email: string,
): Promise<{ readonly removed: boolean; readonly sessionsEnded: number }> {
  const rows = await db.query<{ removed: number; sessions_ended: number }>(
    `with removed as (
       delete from sign_in_allowlist where email = $1 returning email
     ), ended as (
       delete from sessions where user_id in (
         select u.id from users u join removed on removed.email = u.email
       ) returning 1
     )
     select (select count(*) from removed)::int as removed,
            (select count(*) from ended)::int as sessions_ended`,
    [email],
  );
  const row = rows[0];
  return { removed: (row?.removed ?? 0) > 0, sessionsEnded: row?.sessions_ended ?? 0 };
}
