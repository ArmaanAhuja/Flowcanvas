import {
  TERMINAL_LIMITS,
  checkSize,
  parseControl,
  type ServerControl,
} from '@flowcanvas/workspace-host/protocol';
import { Hono } from 'hono';
import { describeError } from '../api/redact.js';
import { requireSameOrigin, type SignedInEnv } from '../auth/guards.js';
import { loadWorkspace, touchWorkspace } from './lifecycle.js';
import { NOT_RUNNING } from './file-routes.js';
import {
  ProviderError,
  WORKSPACES_UNAVAILABLE,
  type ProviderErrorKind,
  type TerminalSocket,
} from './provider.js';
import type { WorkspaceDependencies } from './routes.js';

/** The browser's end of a new WebSocket, and the 101 response that hands it over. */
export type AcceptWebSocket = () => { response: Response; socket: TerminalSocket };

declare const WebSocketPair: new () => { 0: TerminalSocket; 1: TerminalSocket };

/** The Workers way: a pair, one end returned to the browser in a 101 response, the other kept here. */
export const workersAcceptWebSocket: AcceptWebSocket = () => {
  const pair = new WebSocketPair();
  return {
    response: new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit),
    socket: pair[1],
  };
};

/** Typing counts as activity, but the database hears about it at most this often. */
export const TOUCH_EVERY_MS = 30_000;
const CONTROL_MAX_CHARS = 1024;

const STATUS: Record<ProviderErrorKind, 409 | 502 | 503> = {
  gone: 409,
  refused: 503,
  unavailable: 503,
  failed: 502,
};

/**
 * Carries a terminal between the browser and the workspace (ADR 0017). From the browser, only bounded byte
 * frames and valid resize messages go on; from the workspace, everything comes back as it is.
 */
export function relay(
  browser: TerminalSocket,
  workspace: TerminalSocket,
  onInput: () => void,
): void {
  // Without this, Workers deliver binary frames as Blobs, which would be sent on as "[object Blob]".
  browser.binaryType = 'arraybuffer';
  workspace.binaryType = 'arraybuffer';
  browser.accept();
  workspace.accept();
  const tell = (control: ServerControl) => {
    browser.send(JSON.stringify(control));
  };
  let closed = false;
  const closeBoth = () => {
    if (closed) return;
    closed = true;
    browser.close(1000, 'terminal closed');
    workspace.close(1000, 'terminal closed');
  };

  browser.addEventListener('message', ({ data }) => {
    if (closed) return;
    if (data instanceof ArrayBuffer) {
      if (data.byteLength > TERMINAL_LIMITS.frameBytes) {
        tell({ type: 'error', message: 'That was too much at once.' });
        return;
      }
      workspace.send(data);
      onInput();
      return;
    }
    const control =
      typeof data === 'string' && data.length <= CONTROL_MAX_CHARS ? parseControl(data) : undefined;
    if (control === undefined) {
      tell({ type: 'error', message: 'Unknown control message.' });
      return;
    }
    workspace.send(JSON.stringify(control));
  });
  workspace.addEventListener('message', ({ data }) => {
    if (closed) return;
    if (typeof data === 'string' || data instanceof ArrayBuffer) browser.send(data);
  });
  for (const socket of [browser, workspace]) {
    socket.addEventListener('close', closeBoth);
    socket.addEventListener('error', closeBoth);
  }
}

/** /api/projects/:projectId/workspace/terminal: a WebSocket to a shell in the project's running workspace. */
export function terminalRoutes(deps: WorkspaceDependencies & { acceptWebSocket: AcceptWebSocket }) {
  const terminal = new Hono<SignedInEnv>();

  // Same origin matters most here: a WebSocket isn't limited by CORS, so another site could otherwise open
  // one with the visitor's cookie (cross-site WebSocket hijacking).
  terminal.get('/terminal', requireSameOrigin, async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return c.json({ error: 'Connect with a WebSocket.', code: 'invalid_request' }, 426);
    }
    const size = checkSize(Number(c.req.query('cols')), Number(c.req.query('rows')));
    if (size === undefined) {
      return c.json({ error: 'Give the terminal’s size.', code: 'invalid_request' }, 400);
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
        workspace = await provider.terminal(row.provider_ref, size);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        return c.json({ error: error.userMessage, code: error.kind }, STATUS[error.kind]);
      }
      const { response, socket } = deps.acceptWebSocket();
      let lastTouch = 0;
      relay(socket, workspace, () => {
        const now = deps.now();
        if (now - lastTouch < TOUCH_EVERY_MS) return;
        lastTouch = now;
        touchWorkspace(db, row.id, now).catch((error: unknown) => {
          deps.log(`terminal activity not recorded: ${describeError(error)}`);
        });
      });
      // Who and which workspace only: never what's typed or shown.
      deps.log(`workspace ${row.id} terminal opened by user ${user.id}`);
      return response;
    } catch (error) {
      deps.log(`opening a terminal failed: ${describeError(error)}`);
      return c.json({ error: 'Could not open the terminal. Try again in a moment.' }, 503);
    }
  });

  return terminal;
}
