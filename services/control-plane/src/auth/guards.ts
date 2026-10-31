import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { describeError } from '../api/redact.js';
import type { Database } from '../db/database.js';
import { sessionUser, type SessionUser } from './accounts.js';
import { SESSION_COOKIE } from './cookies.js';

/** What a guarded route can read: `c.get('user')` is the signed-in person. */
export interface SignedInEnv {
  // Every binding a guarded route might read (VAULT_KEY: the secrets vault's master key, src/vault/).
  Bindings: {
    readonly DATABASE_URL?: string;
    readonly APP_ORIGIN?: string;
    readonly VAULT_KEY?: string;
  };
  Variables: { user: SessionUser };
}

interface GuardDependencies {
  readonly database: (databaseUrl: string) => Database;
  readonly log: (message: string) => void;
}

/** Lets a request through only with a live session: 401 otherwise. Sets `c.get('user')`. */
export function requireUser(deps: GuardDependencies): MiddlewareHandler<SignedInEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE, 'host');
    const databaseUrl = c.env.DATABASE_URL;
    if (token === undefined || !databaseUrl) return c.json({ error: 'Sign in first.' }, 401);
    let user: SessionUser | undefined;
    try {
      user = await sessionUser(deps.database(databaseUrl), token);
    } catch (error) {
      deps.log(`session lookup failed: ${describeError(error)}`);
      return c.json({ error: 'Could not check your session. Try again in a moment.' }, 503);
    }
    if (user === undefined) return c.json({ error: 'Your session has ended. Sign in again.' }, 401);
    c.set('user', user);
    await next();
    return undefined;
  };
}

/** After `requireUser`: only admins (role from the allowlist) get through, 403 for everyone else. */
export const requireAdmin: MiddlewareHandler<SignedInEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'Only admins can do this.' }, 403);
  await next();
  return undefined;
};

/**
 * For requests that change something: only our own pages may send them. SameSite=Lax already keeps the session
 * cookie off other sites' background requests; this checks the Origin header too (defence in depth).
 * APP_ORIGIN covers local development, where Vite forwards /api to the Worker on another port.
 */
export const requireSameOrigin: MiddlewareHandler<{
  Bindings: { readonly APP_ORIGIN?: string };
}> = async (c, next) => {
  const ownOrigins = [new URL(c.req.url).origin, c.env.APP_ORIGIN];
  if (!ownOrigins.includes(c.req.header('origin'))) {
    return c.json({ error: 'This request must come from Flowcanvas itself.' }, 403);
  }
  await next();
  return undefined;
};
