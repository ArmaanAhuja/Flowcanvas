import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeError } from '../api/redact.js';
import { requireAdmin, requireSameOrigin, requireUser, type SignedInEnv } from '../auth/guards.js';
import type { Database } from '../db/database.js';
import {
  allowEmail,
  disallowEmail,
  isRole,
  listAllowlist,
  listPeople,
  parseEmail,
} from './admin.js';

interface AdminDependencies {
  readonly database: (databaseUrl: string) => Database;
  readonly now: () => number;
  readonly log: (message: string) => void;
}

const UNAVAILABLE = 'Could not reach the database. Try again in a moment.';

/** /api/admin: people and the sign-in allowlist, for admins only. Changes are logged by user ID, never by email. */
export function adminRoutes(deps: AdminDependencies) {
  const admin = new Hono<SignedInEnv>();
  admin.use(requireUser(deps), requireAdmin);

  admin.get('/', async (c) => {
    try {
      const db = deps.database(c.env.DATABASE_URL ?? '');
      const [people, allowlist] = await Promise.all([
        listPeople(db, deps.now()),
        listAllowlist(db),
      ]);
      return c.json({ people, allowlist });
    } catch (error) {
      deps.log(`admin view failed: ${describeError(error)}`);
      return c.json({ error: UNAVAILABLE }, 503);
    }
  });

  admin.put(
    '/allowlist/:email',
    requireSameOrigin,
    bodyLimit({
      maxSize: 1024,
      onError: (c) => c.json({ error: 'That request is too large.' }, 413),
    }),
    async (c) => {
      const email = parseEmail(c.req.param('email'));
      if (typeof email !== 'string')
        return c.json({ error: email.message, field: email.field }, 400);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Send the role as JSON.' }, 400);
      }
      const role = (body as { role?: unknown } | null)?.role;
      if (!isRole(role)) return c.json({ error: 'The role must be member or admin.' }, 400);
      // An admin can't lock themselves out; another admin has to do it.
      if (email === c.get('user').email && role !== 'admin') {
        return c.json({ error: 'You can’t remove your own admin role.' }, 409);
      }
      try {
        const result = await allowEmail(deps.database(c.env.DATABASE_URL ?? ''), email, role);
        deps.log(`admin ${c.get('user').id} ${result} an allowlist entry (${role})`);
        return c.json({ email, role, result }, result === 'added' ? 201 : 200);
      } catch (error) {
        deps.log(`allowlist change failed: ${describeError(error)}`);
        return c.json({ error: UNAVAILABLE }, 503);
      }
    },
  );

  admin.delete('/allowlist/:email', requireSameOrigin, async (c) => {
    const email = parseEmail(c.req.param('email'));
    if (typeof email !== 'string') return c.json({ error: email.message, field: email.field }, 400);
    if (email === c.get('user').email) {
      return c.json({ error: 'You can’t remove yourself from the allowlist.' }, 409);
    }
    try {
      const result = await disallowEmail(deps.database(c.env.DATABASE_URL ?? ''), email);
      if (!result.removed) return c.json({ error: 'That email isn’t on the allowlist.' }, 404);
      deps.log(
        `admin ${c.get('user').id} removed an allowlist entry; ${String(result.sessionsEnded)} sessions ended`,
      );
      return c.body(null, 204);
    } catch (error) {
      deps.log(`allowlist removal failed: ${describeError(error)}`);
      return c.json({ error: UNAVAILABLE }, 503);
    }
  });

  return admin;
}
