import { parseWatchEvent } from '@flowcanvas/workspace-agent/protocol';
import { Hono } from 'hono';
import { describeError } from '../api/redact.js';
import { requireSameOrigin, type SignedInEnv } from '../auth/guards.js';
import { loadWorkspace } from './lifecycle.js';
import { NOT_RUNNING } from './file-routes.js';
import {
  ProviderError,
  WORKSPACES_UNAVAILABLE,
  type ProviderErrorKind,
  type TerminalSocket,
} from './provider.js';
import type { AcceptWebSocket } from './terminal-routes.js';
import type { WorkspaceDependencies } from './routes.js';

const STATUS: Record<ProviderErrorKind, 409 | 502 | 503> = {
  gone: 409,
  refused: 503,
  unavailable: 503,
  failed: 502,
};

/** A watcher event is one small JSON object; anything longer isn't one. */
const EVENT_MAX_CHARS = 4096;

/**
 * Carries the project's file watcher to the page, one way (phase 3): each event from the workspace is checked
 * again (the host already did; the workspace is untrusted) and sent on as JSON text. Nothing from the page goes
 * to the workspace. Watching is not activity: a page left open mustn't keep a workspace awake.
 */
export function relayEvents(browser: TerminalSocket, workspace: TerminalSocket): void {
  browser.accept();
  workspace.accept();
  let closed = false;
  const closeBoth = () => {
    if (closed) return;
    closed = true;
    browser.close(1000, 'watching ended');
    workspace.close(1000, 'watching ended');
  };
  workspace.addEventListener('message', ({ data }) => {
    if (closed || typeof data !== 'string' || data.length > EVENT_MAX_CHARS) return;
    let event;
    try {
      event = parseWatchEvent(JSON.parse(data));
    } catch {
      event = undefined;
    }
    if (event !== undefined) browser.send(JSON.stringify(event));
  });
  for (const socket of [browser, workspace]) {
    socket.addEventListener('close', closeBoth);
    socket.addEventListener('error', closeBoth);
  }
}

/** /api/projects/:projectId/workspace/events: a WebSocket of the project's file changes, while it runs. */
export function eventsRoutes(deps: WorkspaceDependencies & { acceptWebSocket: AcceptWebSocket }) {
  const events = new Hono<SignedInEnv>();

  // Same origin: a WebSocket isn't limited by CORS, and these events name the project's files.
  events.get('/events', requireSameOrigin, async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return c.json({ error: 'Connect with a WebSocket.', code: 'invalid_request' }, 426);
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
      let workspace: TerminalSocket;
      try {
        workspace = await provider.events(row.provider_ref);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        return c.json({ error: error.userMessage, code: error.kind }, STATUS[error.kind]);
      }
      const { response, socket } = deps.acceptWebSocket();
      relayEvents(socket, workspace);
      // Who and which workspace only: never which files.
      deps.log(`workspace ${row.id} watching opened by user ${user.id}`);
      return response;
    } catch (error) {
      deps.log(`opening the watcher failed: ${describeError(error)}`);
      return c.json(
        { error: 'Could not follow changes in the workspace. Try again in a moment.' },
        503,
      );
    }
  });

  return events;
}
