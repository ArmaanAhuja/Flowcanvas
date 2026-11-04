import { Hono } from 'hono';
import { describeError } from '../api/redact.js';
import { requireSameOrigin, type SignedInEnv } from '../auth/guards.js';
import type { Database } from '../db/database.js';
import {
  loadWorkspace,
  openWorkspace,
  publicWorkspace,
  resumeWorkspace,
  sleepWorkspace,
  stopWorkspace,
  type LifecycleContext,
  type LifecycleProblem,
  type LifecycleResult,
} from './lifecycle.js';
import { WORKSPACES_UNAVAILABLE, type WorkspaceProvider } from './provider.js';
import { fileRoutes } from './file-routes.js';
import { terminalRoutes, workersAcceptWebSocket, type AcceptWebSocket } from './terminal-routes.js';

export interface WorkspaceDependencies {
  readonly database: (databaseUrl: string) => Database;
  readonly log: (message: string) => void;
  readonly now: () => number;
  /** Undefined where nothing can run workspaces: staging, until a cloud provider is connected (ADR 0016). */
  readonly workspaceProvider: (env: SignedInEnv['Bindings']) => WorkspaceProvider | undefined;
  /** Accepts a browser WebSocket; WebSocketPair on Workers, a fake in tests. */
  readonly acceptWebSocket?: AcceptWebSocket;
}

export { WORKSPACES_UNAVAILABLE } from './provider.js';

const ACTIONS = {
  open: openWorkspace,
  sleep: sleepWorkspace,
  resume: resumeWorkspace,
  stop: stopWorkspace,
} as const;

const STATUS: Record<LifecycleProblem, 409 | 502 | 503> = {
  conflict: 409,
  gone: 409,
  unavailable: 503,
  refused: 503,
  failed: 502,
};

/** /api/projects/:projectId/workspace, mounted inside the projects routes (so requireUser has already run). */
export function workspaceRoutes(deps: WorkspaceDependencies) {
  const workspace = new Hono<SignedInEnv>();

  workspace.get('/', async (c) => {
    try {
      const db = deps.database(c.env.DATABASE_URL ?? '');
      const row = await loadWorkspace(db, c.req.param('projectId') ?? '', c.get('user').id);
      // Another person's project answers exactly like a missing one, so IDs can't be probed.
      if (row === undefined) return c.json({ error: 'No such project.' }, 404);
      return c.json({
        workspace: publicWorkspace(row),
        available: deps.workspaceProvider(c.env) !== undefined,
      });
    } catch (error) {
      deps.log(`loading a workspace failed: ${describeError(error)}`);
      return c.json({ error: 'Could not load the workspace. Try again in a moment.' }, 503);
    }
  });

  // One route per action. (A `:action{open|…}` pattern isn't anchored in Hono's router when mounted, so
  // `/open/extra` matched it; see the routes test.)
  for (const action of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]) {
    workspace.post(`/${action}`, requireSameOrigin, async (c) => {
      const user = c.get('user');
      let result: LifecycleResult;
      try {
        const db = deps.database(c.env.DATABASE_URL ?? '');
        const row = await loadWorkspace(db, c.req.param('projectId') ?? '', user.id);
        if (row === undefined) return c.json({ error: 'No such project.' }, 404);
        const provider = deps.workspaceProvider(c.env);
        if (provider === undefined) {
          return c.json(
            {
              error: WORKSPACES_UNAVAILABLE,
              problem: 'unavailable',
              workspace: publicWorkspace(row),
            },
            503,
          );
        }
        const ctx: LifecycleContext = { db, provider, now: deps.now, log: deps.log };
        result = await ACTIONS[action](ctx, row);
        // By IDs only: never names, addresses or provider details (CLAUDE.md, logging rules).
        deps.log(
          `workspace ${row.id} ${action} by user ${user.id}: ${row.state} → ${result.workspace.state}` +
            (result.ok ? '' : ` (${result.problem})`),
        );
      } catch (error) {
        deps.log(`workspace ${action} failed: ${describeError(error)}`);
        return c.json({ error: 'Could not change the workspace. Try again in a moment.' }, 503);
      }
      if (result.ok) return c.json({ workspace: result.workspace });
      return c.json(
        { error: result.message, problem: result.problem, workspace: result.workspace },
        STATUS[result.problem],
      );
    });
  }

  workspace.route('/', fileRoutes(deps));
  workspace.route(
    '/',
    terminalRoutes({ ...deps, acceptWebSocket: deps.acceptWebSocket ?? workersAcceptWebSocket }),
  );

  return workspace;
}
