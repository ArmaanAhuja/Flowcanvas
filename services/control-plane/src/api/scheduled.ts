import { sleepIdleWorkspaces } from '../workspaces/lifecycle.js';
import { resolveDependencies, type ApiBindings, type ApiDependencies } from './app.js';
import { describeError } from './redact.js';

/** What Cloudflare passes to a scheduled run (no Workers type package here; only what we read). */
export interface ScheduledRun {
  readonly cron: string;
  readonly scheduledTime: number;
}

/**
 * The Worker's scheduled handler, run every minute by the Cron Trigger in wrangler.jsonc (phase 1d step 8).
 * Locally, `wrangler dev` doesn't run Cron Triggers, so scripts/dev.ts calls it once a minute.
 *
 * It puts idle workspaces to sleep. Where nothing runs workspaces (staging, until a cloud provider is
 * connected), it does nothing at all, not even open the database.
 */
export function createScheduled(overrides: Partial<ApiDependencies> = {}) {
  const deps = resolveDependencies(overrides);
  return async (_run: ScheduledRun, env: ApiBindings): Promise<void> => {
    const provider = deps.workspaceProvider(env);
    if (provider === undefined) return;
    const databaseUrl = env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl === '') {
      deps.log('scheduled: DATABASE_URL is missing, so idle workspaces were not checked');
      return;
    }
    try {
      const db = deps.database(databaseUrl);
      const slept = await sleepIdleWorkspaces({ db, provider, now: deps.now, log: deps.log });
      if (slept > 0) deps.log(`scheduled: ${String(slept)} idle workspace(s) put to sleep`);
    } catch (error) {
      // Never the error object itself: it can quote a connection string.
      deps.log(`scheduled: checking idle workspaces failed: ${describeError(error)}`);
    }
  };
}
