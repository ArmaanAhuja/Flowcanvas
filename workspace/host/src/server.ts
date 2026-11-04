// The local workspace host's HTTP API (ADR 0016, protocol.ts). It listens on 127.0.0.1 only, and every request
// needs the token from .dev.vars. Browsers are turned away: a web page could send requests to 127.0.0.1, but
// it can't set the Host header to something else or leave out Origin, and it doesn't know the token.
import { createHash, timingSafeEqual } from 'node:crypto';
import { AgentProblem, LIMITS, parseAgentRequest } from '@flowcanvas/workspace-agent/protocol';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ERROR_STATUS, HostError } from './errors.js';
import {
  ACTIONS,
  MESSAGE_MAX,
  PATHS,
  PROTOCOL_VERSION,
  type HostAction,
  type HostErrorBody,
} from './protocol.js';
import type { WorkspaceHost } from './workspaces.js';

/** The part of WorkspaceHost the server calls, so tests can pass a fake. */
export type HostOperations = Pick<
  WorkspaceHost,
  'create' | 'start' | 'pause' | 'resume' | 'stop' | 'agent'
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

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // A browser always sends Origin on a cross-site POST, and a DNS-rebinding page has someone else's Host.
    if (request.headers.origin !== undefined || !ownHosts.has(request.headers.host ?? '')) {
      send(response, 403, { error: { kind: 'refused', message: 'Not from here.' } });
      return;
    }
    const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    // Compared as fixed-length digests in constant time, so timing reveals nothing about the token.
    if (!timingSafeEqual(digest(given), expected)) {
      send(response, 401, { error: { kind: 'refused', message: 'Wrong or missing token.' } });
      return;
    }

    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && path === PATHS.health) {
      send(response, 200, { ok: true, protocol: PROTOCOL_VERSION });
      return;
    }
    if (request.method === 'POST' && path === PATHS.create) {
      const body = await readJson(request);
      const fields =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const { workspaceId, repoUrl } = fields;
      if (typeof workspaceId !== 'string' || (repoUrl !== null && typeof repoUrl !== 'string')) {
        throw new HostError('failed', 'Send a workspaceId and a repoUrl (or null).');
      }
      send(response, 200, await options.host.create({ workspaceId, repoUrl }));
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

  return createServer((request, response) => {
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
}
