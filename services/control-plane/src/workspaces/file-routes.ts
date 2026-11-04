import {
  AgentProblem,
  LIMITS,
  parseAgentRequest,
  type AgentErrorCode,
  type AgentRequest,
  type AgentResponse,
} from '@flowcanvas/workspace-agent/protocol';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeError } from '../api/redact.js';
import { requireSameOrigin, type SignedInEnv } from '../auth/guards.js';
import { loadWorkspace, touchWorkspace } from './lifecycle.js';
import { ProviderError, WORKSPACES_UNAVAILABLE, type ProviderErrorKind } from './provider.js';
import type { WorkspaceDependencies } from './routes.js';

type FileContext = Context<SignedInEnv>;

const AGENT_STATUS: Record<AgentErrorCode, 400 | 403 | 404 | 413 | 502> = {
  invalid_request: 400,
  not_found: 404,
  not_a_directory: 400,
  is_a_directory: 400,
  outside_project: 403,
  secret_file: 403,
  too_large: 413,
  not_allowed: 403,
  failed: 502,
};

const PROVIDER_STATUS: Record<ProviderErrorKind, 409 | 502 | 503> = {
  gone: 409,
  refused: 503,
  unavailable: 503,
  failed: 502,
};

export const NOT_RUNNING = 'Open the workspace first.';

/**
 * The project's files and commands, through the workspace agent (phase 1d step 5). Mounted inside the workspace
 * routes: /api/projects/:projectId/workspace/{files,file,exec}. Only the project's owner, only while running.
 */
export function fileRoutes(deps: WorkspaceDependencies) {
  const files = new Hono<SignedInEnv>();

  async function ask(c: FileContext, input: unknown): Promise<Response> {
    let request: AgentRequest;
    try {
      request = parseAgentRequest(input);
    } catch (error) {
      if (!(error instanceof AgentProblem)) throw error;
      return c.json({ error: error.message, code: error.code }, AGENT_STATUS[error.code]);
    }
    const user = c.get('user');
    try {
      const db = deps.database(c.env.DATABASE_URL ?? '');
      const row = await loadWorkspace(db, c.req.param('projectId') ?? '', user.id);
      if (row === undefined) return c.json({ error: 'No such project.' }, 404);
      const provider = deps.workspaceProvider(c.env);
      if (provider === undefined)
        return c.json({ error: WORKSPACES_UNAVAILABLE, code: 'unavailable' }, 503);
      if (row.state !== 'running' || row.provider_ref === null) {
        return c.json({ error: NOT_RUNNING, code: 'not_running' }, 409);
      }
      let response: AgentResponse;
      try {
        response = await provider.agent(row.provider_ref, request);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        return c.json({ error: error.userMessage, code: error.kind }, PROVIDER_STATUS[error.kind]);
      }
      // Using the files or running something counts as activity, so the workspace doesn't sleep under you.
      await touchWorkspace(db, row.id, deps.now());
      // The operation and the outcome only: never paths, content or commands, which can hold secrets.
      deps.log(
        `workspace ${row.id} ${request.op} by user ${user.id}: ${response.ok ? 'ok' : response.error.code}`,
      );
      if (response.ok) return c.json(response.result);
      return c.json(
        { error: response.error.message, code: response.error.code },
        AGENT_STATUS[response.error.code],
      );
    } catch (error) {
      deps.log(`workspace ${request.op} failed: ${describeError(error)}`);
      return c.json({ error: 'Could not reach the workspace. Try again in a moment.' }, 503);
    }
  }

  async function jsonBody(c: FileContext): Promise<Record<string, unknown> | Response> {
    if (!c.req.header('content-type')?.startsWith('application/json')) {
      return c.json({ error: 'Send it as JSON.', code: 'invalid_request' }, 415);
    }
    try {
      const body: unknown = await c.req.json();
      return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    } catch {
      return c.json({ error: 'Send it as JSON.', code: 'invalid_request' }, 400);
    }
  }

  const tooLarge = (c: FileContext) =>
    c.json({ error: 'Keep files under 1 MB.', code: 'too_large' }, 413);

  files.get('/files', (c) => ask(c, { op: 'list', path: c.req.query('path') ?? '' }));
  files.get('/file', (c) => ask(c, { op: 'read', path: c.req.query('path') }));

  files.put(
    '/file',
    requireSameOrigin,
    bodyLimit({ maxSize: LIMITS.lineBytes, onError: tooLarge }),
    async (c) => {
      const body = await jsonBody(c);
      if (body instanceof Response) return body;
      return ask(c, {
        op: 'write',
        path: c.req.query('path'),
        content: body.content,
        encoding: body.encoding,
      });
    },
  );

  files.post(
    '/exec',
    requireSameOrigin,
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: 'That command is too long.', code: 'too_large' }, 413),
    }),
    async (c) => {
      const body = await jsonBody(c);
      if (body instanceof Response) return body;
      return ask(c, {
        op: 'exec',
        command: body.command,
        cwd: body.cwd,
        timeoutMs: body.timeoutMs,
      });
    },
  );

  return files;
}
