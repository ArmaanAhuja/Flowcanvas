// The desktop app's local server (build plan v2, phase 1): the built web UI and the same /api routes it called on the
// control plane, answered from the user's own folders. It listens on 127.0.0.1 only, and every request must carry
// the per-launch secret (a cookie the window gets once), so another program on the machine can't use it.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { userInfo } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import {
  ENGINE_LIMITS,
  EngineProblem,
  parseEngineRequest,
  TYPESCRIPT_OPS,
} from '@flowcanvas/engine/protocol';
import { LIMITS, type AgentErrorCode } from '@flowcanvas/workspace-agent/protocol';
import { HostError } from '@flowcanvas/workspace-host/errors';
import { WebSocketServer } from 'ws';
import type { Folders } from './folders.js';
import type { OpenedProject, Projects } from './projects.js';

/** The cookie that carries the per-launch secret. */
export const SESSION_COOKIE = 'fc_desktop';

/** As the control plane answered the same codes (services/control-plane/src/workspaces/file-routes.ts). */
const AGENT_STATUS: Record<AgentErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  not_a_directory: 400,
  is_a_directory: 400,
  outside_project: 403,
  secret_file: 403,
  too_large: 413,
  not_allowed: 403,
  conflict: 409,
  failed: 502,
};
const HOST_STATUS: Record<HostError['kind'], number> = {
  gone: 409,
  refused: 503,
  unavailable: 503,
  failed: 502,
};

export const MESSAGES = {
  noProject: 'No such project.',
  notHere: 'That isn’t part of the desktop app.',
  alwaysRunning: 'On the desktop, a project runs while it’s open.',
  unreachable: 'Could not reach the project. Try again in a moment.',
  json: 'Send it as JSON.',
  tooLarge: 'Keep files under 1 MB.',
  forbidden: 'Open Flowcanvas from its window.',
} as const;

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** What the server needs from the open folders: their files, their engine, their changes. */
export type FolderService = Pick<Folders, 'agent' | 'index' | 'watch'>;

export interface DesktopServerOptions {
  readonly projects: Projects;
  readonly folders: FolderService;
  /** The built web app (apps/web/dist). */
  readonly webRoot: string;
  /** For tests: a fixed secret instead of a random one. */
  readonly secret?: string;
  readonly log?: (message: string) => void;
}

export interface DesktopServer {
  /** http://127.0.0.1:<port> */
  readonly origin: string;
  /** Opens a path in the window: sets the session cookie, then goes to `path`. */
  entryUrl(path?: string): string;
  close(): Promise<void>;
}

/**
 * The headers the web app's host served with every page (apps/web/public/_headers: the CSP and the rest), so the
 * desktop window runs under exactly the same policy as the site did.
 */
export function pageHeaders(webRoot: string): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(webRoot, '_headers'), 'utf8').split('\n')) {
      const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) headers[match[1]] = match[2].trim();
    }
  } catch {
    // A build without the file still serves; tests check the policy is there in a real build.
  }
  return headers;
}

export async function startDesktopServer(options: DesktopServerOptions): Promise<DesktopServer> {
  const secret = options.secret ?? randomBytes(32).toString('base64url');
  const log = options.log ?? (() => undefined);
  const headers = pageHeaders(options.webRoot);
  let origin = '';

  const signedIn = (request: IncomingMessage) => {
    const sent = cookie(request.headers.cookie, SESSION_COOKIE);
    if (sent === undefined) return false;
    const a = Buffer.from(sent);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      // The kind of failure only: never paths or contents.
      log(`request failed: ${error instanceof Error ? error.name : 'unknown'}`);
      if (!response.headersSent) json(response, 503, { error: MESSAGES.unreachable });
      else response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === '/__open') {
      // The window's first request: the secret in the address once, then only in an HttpOnly cookie.
      const key = url.searchParams.get('key') ?? '';
      const to = url.searchParams.get('to') ?? '/';
      if (key !== secret || !to.startsWith('/') || to.startsWith('//')) {
        json(response, 403, { error: MESSAGES.forbidden });
        return;
      }
      response.writeHead(302, {
        location: to,
        'set-cookie': `${SESSION_COOKIE}=${secret}; HttpOnly; SameSite=Strict; Path=/`,
        'cache-control': 'no-store',
      });
      response.end();
      return;
    }
    if (!signedIn(request)) {
      json(response, 403, { error: MESSAGES.forbidden });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      // Changes only from our own page (a form elsewhere can't post here).
      if (request.method !== 'GET' && request.headers.origin !== origin) {
        json(response, 403, { error: MESSAGES.forbidden });
        return;
      }
      await api(request, response, url);
      return;
    }
    await page(response, url.pathname);
  }

  async function api(request: IncomingMessage, response: ServerResponse, url: URL) {
    const path = url.pathname;
    if (path === '/api/me' && request.method === 'GET') {
      json(response, 200, {
        user: { id: 'local', email: '', displayName: userInfo().username, role: 'member' },
      });
      return;
    }
    if (path === '/api/projects' && request.method === 'GET') {
      json(response, 200, {
        projects: options.projects.list().map(publicProject),
        workspacesAvailable: true,
      });
      return;
    }
    const match = /^\/api\/projects\/([^/]+)(\/workspace(\/.*)?)?$/.exec(path);
    const project = match?.[1] === undefined ? undefined : options.projects.get(match[1]);
    if (match === null || project === undefined) {
      json(response, 404, { error: match === null ? MESSAGES.notHere : MESSAGES.noProject });
      return;
    }
    const rest = match[3] ?? (match[2] === undefined ? undefined : '');
    if (rest === undefined) {
      if (request.method === 'GET') json(response, 200, { project: publicProject(project) });
      else json(response, 404, { error: MESSAGES.notHere });
      return;
    }
    if (rest === '' && request.method === 'GET') {
      json(response, 200, { workspace: publicProject(project).workspace, available: true });
      return;
    }
    if (request.method === 'POST' && (rest === '/open' || rest === '/resume')) {
      json(response, 200, { workspace: publicProject(project).workspace });
      return;
    }
    if (request.method === 'POST' && (rest === '/sleep' || rest === '/stop')) {
      json(response, 409, {
        error: MESSAGES.alwaysRunning,
        workspace: publicProject(project).workspace,
      });
      return;
    }
    if (rest.startsWith('/index/')) {
      await index(response, project, rest.slice('/index/'.length), url);
      return;
    }
    await files(request, response, project, rest, url);
  }

  async function files(
    request: IncomingMessage,
    response: ServerResponse,
    project: OpenedProject,
    rest: string,
    url: URL,
  ) {
    const query = (name: string) => url.searchParams.get(name) ?? undefined;
    let input: Record<string, unknown> | undefined;
    if (request.method === 'GET') {
      if (rest === '/files') input = { op: 'list', path: query('path') ?? '' };
      else if (rest === '/file') input = { op: 'read', path: query('path') };
      else if (rest === '/tree') input = { op: 'files' };
      else if (rest === '/journal') input = { op: 'journal-list' };
      else if (rest === '/journal/entry') input = { op: 'journal-get', path: query('path') };
    } else if (request.method === 'PUT' && (rest === '/file' || rest === '/journal/entry')) {
      const body = await jsonBody(request, response, LIMITS.lineBytes);
      if (body === undefined) return;
      input =
        rest === '/file'
          ? {
              op: 'write',
              path: query('path'),
              content: body.content,
              encoding: body.encoding,
              ...('baseVersion' in body ? { baseVersion: body.baseVersion } : {}),
            }
          : {
              op: 'journal-put',
              path: query('path'),
              content: body.content,
              baseVersion: body.baseVersion,
              revision: body.revision,
            };
    } else if (request.method === 'DELETE' && rest === '/journal/entry') {
      const revision = query('revision');
      input = {
        op: 'journal-drop',
        path: query('path'),
        revision: revision === undefined ? undefined : Number(revision),
      };
    } else if (request.method === 'POST' && rest === '/exec') {
      const body = await jsonBody(request, response, 64 * 1024);
      if (body === undefined) return;
      input = { op: 'exec', command: body.command, cwd: body.cwd, timeoutMs: body.timeoutMs };
    }
    if (input === undefined) {
      json(response, 404, { error: MESSAGES.notHere });
      return;
    }
    const answer = await options.folders.agent(project.path, input);
    // The operation and the outcome only: never paths or content, which can hold secrets.
    log(`project ${project.id} ${String(input.op)}: ${answer.ok ? 'ok' : answer.error.code}`);
    if (answer.ok) json(response, 200, answer.result);
    else {
      json(response, AGENT_STATUS[answer.error.code], {
        error: answer.error.message,
        code: answer.error.code,
      });
    }
  }

  async function index(response: ServerResponse, project: OpenedProject, op: string, url: URL) {
    const query = (name: string) => url.searchParams.get(name) ?? undefined;
    const limit = query('limit');
    const after = query('after');
    const screen = query('screen');
    const input: Record<string, unknown> | undefined =
      op === 'status' || op === 'graph'
        ? { op }
        : op === 'search'
          ? { op, query: query('q'), ...(limit === undefined ? {} : { limit: Number(limit) }) }
          : op === 'entry-points'
            ? {
                op: 'entryPoints',
                kind: query('kind'),
                after: after === undefined ? 0 : Number(after),
                limit: limit === undefined ? ENGINE_LIMITS.entries : Number(limit),
                ...(screen === undefined ? {} : { screen }),
              }
            : (TYPESCRIPT_OPS as readonly string[]).includes(op)
              ? {
                  op,
                  path: query('path'),
                  line: Number(query('line')),
                  column: Number(query('column')),
                }
              : undefined;
    if (input === undefined) {
      json(response, 404, { error: MESSAGES.notHere });
      return;
    }
    let request;
    try {
      request = parseEngineRequest(input);
    } catch (error) {
      if (!(error instanceof EngineProblem)) throw error;
      json(response, 400, { error: error.message, code: error.code });
      return;
    }
    try {
      const answer = await options.folders.index(project.path, request);
      if (answer.ok) json(response, 200, answer.result);
      else {
        log(`project ${project.id} index ${request.op}: ${answer.error.code}`);
        json(response, answer.error.code === 'invalid_request' ? 400 : 502, {
          error: answer.error.message,
          code: answer.error.code,
        });
      }
    } catch (error) {
      if (!(error instanceof HostError)) throw error;
      json(response, HOST_STATUS[error.kind], { error: error.userMessage, code: error.kind });
    }
  }

  async function page(response: ServerResponse, path: string) {
    // Only files under the built app; anything else is the app itself (its own routes, like /p/<id>).
    const file = normalize(join(options.webRoot, decodeURIComponent(path)));
    const inside = file.startsWith(`${normalize(options.webRoot)}${sep}`);
    let body: Buffer;
    let type = TYPES[extname(file)];
    try {
      if (!inside || type === undefined) throw new Error('not a file');
      body = await readFile(file);
    } catch {
      body = await readFile(join(options.webRoot, 'index.html'));
      type = TYPES['.html'];
    }
    response.writeHead(200, { ...headers, 'content-type': type ?? 'application/octet-stream' });
    response.end(body);
  }

  // The file watcher (phase 3): a WebSocket of the folder's changes, as the control plane relayed them.
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', origin);
    const match = /^\/api\/projects\/([^/]+)\/workspace\/events$/.exec(url.pathname);
    const project = match?.[1] === undefined ? undefined : options.projects.get(match[1]);
    if (!signedIn(request) || request.headers.origin !== origin || project === undefined) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (browser) => {
      void options.folders
        .watch(project.path, (event) => {
          if (browser.readyState === browser.OPEN) browser.send(JSON.stringify(event));
        })
        .then(
          (watcher) => {
            browser.on('close', () => {
              watcher.close();
            });
            if (browser.readyState !== browser.OPEN) watcher.close();
          },
          () => {
            browser.close(1011, 'watching failed');
          },
        );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  return {
    origin,
    entryUrl: (path = '/') =>
      `${origin}/__open?key=${encodeURIComponent(secret)}&to=${encodeURIComponent(path)}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of sockets.clients) client.terminate();
        sockets.close();
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A folder as the web app's Project: always running while it's open in the desktop app. */
export function publicProject(project: OpenedProject) {
  return {
    id: project.id,
    name: project.name,
    repoUrl: null,
    repoCommit: null,
    createdAt: project.openedAt,
    path: project.path,
    workspace: {
      id: project.id,
      state: 'running',
      stateChangedAt: project.lastOpenedAt,
      failure: null,
    },
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function jsonBody(
  request: IncomingMessage,
  response: ServerResponse,
  maxBytes: number,
): Promise<Record<string, unknown> | undefined> {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    json(response, 415, { error: MESSAGES.json, code: 'invalid_request' });
    return undefined;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      json(response, 413, { error: MESSAGES.tooLarge, code: 'too_large' });
      return undefined;
    }
    chunks.push(chunk);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    json(response, 400, { error: MESSAGES.json, code: 'invalid_request' });
    return undefined;
  }
}

function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}
