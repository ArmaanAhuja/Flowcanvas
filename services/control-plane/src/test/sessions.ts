// Signs a test person in directly (allowlist, user, session), for tests of routes behind requireUser.
import { createSession, signIn, type Role } from '../auth/accounts.js';
import type { Database } from '../db/database.js';

/** Returns the Cookie header for a fresh session, and the user's ID. */
export async function signedInAs(
  db: Database,
  email: string,
  role: Role = 'member',
): Promise<{ cookie: string; userId: string }> {
  await db.query('insert into sign_in_allowlist (email, role) values ($1, $2)', [email, role]);
  const result = await signIn(db, {
    provider: 'github',
    providerUserId: email,
    username: undefined,
    email,
    displayName: email.split('@')[0] ?? email,
    avatarUrl: undefined,
  });
  if (result.kind !== 'signed-in') throw new Error(`could not sign in ${email}`);
  const token = await createSession(db, result.userId, undefined);
  return { cookie: `__Host-fc_session=${token}`, userId: result.userId };
}
