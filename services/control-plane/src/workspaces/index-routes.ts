import {
  EngineProblem,
  parseEngineRequest,
  type EngineRequest,
  type EngineResponse,
} from '@flowcanvas/engine/protocol';
import { Hono, type Context } from 'hono';
import { describeError } from '../api/redact.js';
import type { SignedInEnv } from '../auth/guards.js';
import { NOT_RUNNING } from './file-routes.js';
import { loadWorkspace, touchWorkspace } from './lifecycle.js';
import { ProviderError, WORKSPACES_UNAVAILABLE, type ProviderErrorKind } from './provider.js';
import type { WorkspaceDependencies } from './routes.js';

const PROVIDER_STATUS: Record<ProviderErrorKind, 409 | 502 | 503> = {
  gone: 409,
  refused: 503,
  unavailable: 503,
  failed: 502,
};

/**
 * The project index (phase 4, ADR 0025): /api/projects/:projectId/workspace/index/{status,search}. Only the
 * project's owner, only while the workspace runs.
 *
 * Indexing is not activity (decisions log, 9 Nov 2026): the page asks for the status while it shows progress,
 * and that must never keep a workspace awake. A search is the person using the project, like opening a file,
 * so it counts.
 */
export function indexRoutes(deps: WorkspaceDependencies) {
  const index = new Hono<SignedInEnv>();

  async function ask(
    c: Context<SignedInEnv>,
    input: unknown,
    countsAsActivity: boolean,
  ): Promise<Response> {
    let request: EngineRequest;
    try {
      request = parseEngineRequest(input);
    } catch (error) {
      if (!(error instanceof EngineProblem)) throw error;
      return c.json({ error: error.message, code: error.code }, 400);
    }
    const user = c.get('user');
    try {
      const db = deps.database(c.env.DATABASE_URL ?? '');
      const row = await loadWorkspace(db, c.req.param('projectId') ?? '', user.id);
      if (row === undefined) return c.json({ error: 'No such project.' }, 404);
      const provider = deps.workspaceProvider(c.env);
      if (provider === undefined) {
        return c.json({ error: WORKSPACES_UNAVAILABLE, code: 'unavailable' }, 503);
      }
      if (row.state !== 'running' || row.provider_ref === null) {
        return c.json({ error: NOT_RUNNING, code: 'not_running' }, 409);
      }
      let response: EngineResponse;
      try {
        response = await provider.index(row.provider_ref, request);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        return c.json({ error: error.userMessage, code: error.kind }, PROVIDER_STATUS[error.kind]);
      }
      if (countsAsActivity) await touchWorkspace(db, row.id, deps.now());
      if (!response.ok) {
        // The operation and outcome only; never the query, which is what the person typed.
        deps.log(
          `workspace ${row.id} index ${request.op} by user ${user.id}: ${response.error.code}`,
        );
        return c.json(
          { error: response.error.message, code: response.error.code },
          response.error.code === 'invalid_request' ? 400 : 502,
        );
      }
      return c.json(response.result);
    } catch (error) {
      deps.log(`workspace index ${request.op} failed: ${describeError(error)}`);
      return c.json({ error: 'Could not reach the workspace. Try again in a moment.' }, 503);
    }
  }

  index.get('/index/status', (c) => ask(c, { op: 'status' }, false));
  index.get('/index/search', (c) => {
    const limit = c.req.query('limit');
    return ask(
      c,
      {
        op: 'search',
        query: c.req.query('q'),
        ...(limit === undefined ? {} : { limit: Number(limit) }),
      },
      true,
    );
  });

  return index;
}
