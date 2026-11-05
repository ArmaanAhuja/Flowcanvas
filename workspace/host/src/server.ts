// The local workspace host's HTTP API (ADR 0016, protocol.ts). It listens on 127.0.0.1 only, and every request
// needs the token from .dev.vars. Browsers are turned away: a web page could send requests to 127.0.0.1, but
// it can't set the Host header to something else or leave out Origin, and it doesn't know the token.
import { createHash, timingSafeEqual } from 'node:crypto';
import { AgentProblem, LIMITS, parseAgentRequest } from '@flowcanvas/workspace-agent/protocol';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { ERROR_STATUS, HostError } from './errors.js';
import {
  ACTIONS,
  MESSAGE_MAX,
  PATHS,
  PROTOCOL_VERSION,
  type HostAction,
  type HostErrorBody,
  type PressureResponse,
} from './protocol.js';
import { TERMINAL_LIMITS, checkSize, relayTerminal } from './terminal.js';
import type { WorkspaceHost } from './workspaces.js';

/** The part of WorkspaceHost the server calls, so tests can pass a fake. */
export type HostOperations = Pick<
  WorkspaceHost,
  'create' | 'start' | 'pause' | 'resume' | 'stop' | 'agent' | 'terminal' | 'pressure'
>;

export interface ServerOptions {
  readonly host: HostOperations;
  readonly token: string;
  readonly port: number;
  readonly log: (line: string) => void;
}

export const BODY_MAX_BYTES = 4 * 1024;
/** An agent request can carry a 1 MiB file as base64. */
export const AGENT_BODY_MAX_BYTES = LIMITS.lineBytes;
const ACTION_PATH = new RegExp(`^/${PROTOCOL_VERSION}/workspaces/([^/]+)/(${ACTIONS.join('|')})$`);
const AGENT_PATH = new RegExp(`^/${PROTOCOL_VERSION}/workspaces/([^/]+)/agent$`);
const TERMINAL_PATH = new RegExp(`^/${PROTOCOL_VERSION}/workspaces/([^/]+)/terminal$`);

const digest = (value: string) => createHash('sha256').update(value).digest();

function send(response: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function fail(response: ServerResponse, error: HostError): void {
  const body: HostErrorBody = {
    error: { kind: error.kind, message: error.userMessage.slice(0, MESSAGE_MAX) },
  };
  send(response, ERROR_STATUS[error.kind], body);
}

async function readJson(request: IncomingMessage, limit = BODY_MAX_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HostError('failed', 'That request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HostError('failed', 'Send the request as JSON.');
  }
}

export function createHostServer(options: ServerOptions): Server {
  const expected = digest(options.token);
  const ownHosts = new Set([
    `127.0.0.1:${String(options.port)}`,
    `localhost:${String(options.port)}`,
  ]);

  /** Who may call: the token, and not a browser. Undefined when allowed, else the status and sentence. */
  function refusal(request: IncomingMessage): { status: number; message: string } | undefined {
    // A browser always sends Origin on a cross-site request (WebSockets too), and a DNS-rebinding page has
    // someone else's Host.
    if (request.headers.origin !== undefined || !ownHosts.has(request.headers.host ?? '')) {
      return { status: 403, message: 'Not from here.' };
    }
    const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    // Compared as fixed-length digests in constant time, so timing reveals nothing about the token.
    if (!timingSafeEqual(digest(given), expected)) {
      return { status: 401, message: 'Wrong or missing token.' };
    }
    return undefined;
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const refused = refusal(request);
    if (refused !== undefined) {
      send(response, refused.status, { error: { kind: 'refused', message: refused.message } });
      return;
    }

    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && path === PATHS.health) {
      send(response, 200, { ok: true, protocol: PROTOCOL_VERSION });
      return;
    }
    if (request.method === 'GET' && path === PATHS.pressure) {
      const body: PressureResponse = { pressure: options.host.pressure() };
      send(response, 200, body);
      return;
    }
    if (request.method === 'POST' && path === PATHS.create) {
      const body = await readJson(request);
      const fields =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const { workspaceId, repoUrl } = fields;
      const commit = fields.commit ?? null;
      if (
        typeof workspaceId !== 'string' ||
        (repoUrl !== null && typeof repoUrl !== 'string') ||
        (commit !== null && typeof commit !== 'string')
      ) {
        throw new HostError(
          'failed',
          'Send a workspaceId, a repoUrl (or null) and optionally a commit.',
        );
      }
      send(response, 200, await options.host.create({ workspaceId, repoUrl, commit }));
      return;
    }
    const agentMatch = request.method === 'POST' ? AGENT_PATH.exec(path) : null;
    if (agentMatch !== null) {
      const ref = decodeURIComponent(agentMatch[1] ?? '');
      const body = await readJson(request, AGENT_BODY_MAX_BYTES);
      let parsed;
      try {
        parsed = parseAgentRequest(body);
      } catch (error) {
        if (!(error instanceof AgentProblem)) throw error;
        send(response, 200, { ok: false, error: { code: error.code, message: error.message } });
        return;
      }
      send(response, 200, await options.host.agent(ref, parsed));
      return;
    }
    const match = request.method === 'POST' ? ACTION_PATH.exec(path) : null;
    if (match !== null) {
      const ref = decodeURIComponent(match[1] ?? '');
      const action = match[2] as HostAction;
      await options.host[action](ref);
      send(response, 204);
      return;
    }
    send(response, 404, { error: { kind: 'failed', message: 'No such route.' } });
  }

  const server = createServer((request, response) => {
    const started = Date.now();
    handle(request, response)
      .catch((error: unknown) => {
        if (error instanceof HostError) {
          fail(response, error);
          return;
        }
        // Details stay in this terminal; the answer is a plain sentence.
        options.log(
          `unexpected error on ${request.method ?? '?'} ${request.url ?? '?'}: ${String(error)}`,
        );
        fail(
          response,
          new HostError('failed', 'Something went wrong in the workspace host. Try again.'),
        );
      })
      .finally(() => {
        options.log(
          `${request.method ?? '?'} ${request.url ?? '?'} → ${String(response.statusCode)} (${String(Date.now() - started)} ms)`,
        );
      });
  });

  // Terminals (ADR 0017): the same checks as every other request, before the WebSocket is accepted.
  const sockets = new WebSocketServer({ noServer: true, maxPayload: TERMINAL_LIMITS.frameBytes });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const answer = (status: number, kind: string, message: string) => {
      const body = JSON.stringify({ error: { kind, message } });
      socket.end(
        `HTTP/1.1 ${String(status)} ${status === 401 ? 'Unauthorized' : 'Refused'}\r\n` +
          `content-type: application/json\r\ncontent-length: ${String(Buffer.byteLength(body))}\r\n` +
          `connection: close\r\n\r\n${body}`,
      );
    };
    void (async () => {
      const refused = refusal(request);
      if (refused !== undefined) {
        answer(refused.status, 'refused', refused.message);
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const match = TERMINAL_PATH.exec(url.pathname);
      const size = checkSize(
        Number(url.searchParams.get('cols')),
        Number(url.searchParams.get('rows')),
      );
      if (match === null || size === undefined) {
        answer(404, 'failed', 'No such route.');
        return;
      }
      const ref = decodeURIComponent(match[1] ?? '');
      let session;
      try {
        session = await options.host.terminal(ref, size);
      } catch (error) {
        const known = error instanceof HostError ? error : undefined;
        if (known === undefined) options.log(`terminal failed to start: ${String(error)}`);
        answer(
          known === undefined ? 422 : ERROR_STATUS[known.kind],
          known?.kind ?? 'failed',
          known?.userMessage ?? 'The terminal could not be started.',
        );
        return;
      }
      sockets.handleUpgrade(request, socket, head, (webSocket) => {
        options.log(`terminal opened for ${ref}`);
        relayTerminal(webSocket, session, options.log);
        webSocket.once('close', () => {
          options.log(`terminal closed for ${ref}`);
        });
      });
    })();
  });

  return server;
}
