import { Hono } from 'hono';
import { describeError } from '../api/redact.js';
import { requireUser, type SignedInEnv } from '../auth/guards.js';
import type { Database } from '../db/database.js';
import { usageSummary } from './usage.js';

interface UsageDependencies {
  readonly database: (databaseUrl: string) => Database;
  readonly now: () => number;
  readonly log: (message: string) => void;
}

/** /api/usage: what the signed-in person has used this month. */
export function usageRoutes(deps: UsageDependencies) {
  const usage = new Hono<SignedInEnv>();
  usage.use(requireUser(deps));

  usage.get('/', async (c) => {
    try {
      const db = deps.database(c.env.DATABASE_URL ?? '');
      return c.json({ usage: await usageSummary(db, c.get('user').id, deps.now()) });
    } catch (error) {
      deps.log(`reading usage failed: ${describeError(error)}`);
      return c.json({ error: 'Could not load your usage. Try again in a moment.' }, 503);
    }
  });

  return usage;
}
