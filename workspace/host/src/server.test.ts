import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostError } from './errors.js';
import { PATHS } from './protocol.js';
import { BODY_MAX_BYTES, createHostServer, type HostOperations } from './server.js';

const TOKEN = 'a'.repeat(64);
const REF = 'fc-ws-00000000-0000-4000-8000-000000000001';

let server: Server;
let port: number;
let calls: string[];
let log: ReturnType<typeof vi.fn<(line: string) => void>>;
let failWith: Error | undefined;

const fake: HostOperations = {
  create: async (request) => {
    calls.push(`create ${JSON.stringify(request)}`);
    if (failWith !== undefined) throw failWith;
    return Promise.resolve({ ref: REF, cloned: true, cloneMs: 6200 });
  },
  start: async (ref) => {
    calls.push(`start ${ref}`);
    if (failWith !== undefined) throw failWith;
    return Promise.resolve();
  },
  pause: async (ref) => {
    calls.push(`pause ${ref}`);
    return Promise.resolve();
  },
  resume: async (ref) => {
    calls.push(`resume ${ref}`);
    return Promise.resolve();
  },
  stop: async (ref) => {
    calls.push(`stop ${ref}`);
    return Promise.resolve();
  },
};

beforeEach(async () => {
  calls = [];
  failWith = undefined;
  log = vi.fn<(line: string) => void>();
  // Port 0 picks a free one; the server needs to know it to check the Host header, so it's started twice.
  const probe = createHostServer({ host: fake, token: TOKEN, port: 0, log });
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  port = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  server = createHostServer({ host: fake, token: TOKEN, port, log });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function call(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { authorization: `Bearer ${TOKEN}`, ...options.headers },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString()));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

describe('who may call it', () => {
  it('answers the health check with the token', async () => {
    expect(await call('GET', PATHS.health)).toEqual({
      status: 200,
      body: '{"ok":true,"protocol":"v1"}',
    });
  });

  it('refuses a missing or wrong token', async () => {
    expect((await call('GET', PATHS.health, { headers: { authorization: '' } })).status).toBe(401);
    expect(
      (await call('GET', PATHS.health, { headers: { authorization: `Bearer ${'b'.repeat(64)}` } }))
        .status,
    ).toBe(401);
    expect(
      (await call('GET', PATHS.health, { headers: { authorization: `Bearer ${TOKEN}x` } })).status,
    ).toBe(401);
  });

  it('refuses anything a browser sent (Origin), and other Host names (DNS rebinding)', async () => {
    expect(
      (await call('POST', PATHS.create, { headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
    expect(
      (await call('GET', PATHS.health, { headers: { host: `evil.example:${String(port)}` } }))
        .status,
    ).toBe(403);
    expect(
      (await call('GET', PATHS.health, { headers: { host: `localhost:${String(port)}` } })).status,
    ).toBe(200);
    expect(calls).toEqual([]);
  });
});

describe('routes', () => {
  it('creates a workspace', async () => {
    const body = JSON.stringify({ workspaceId: 'w', repoUrl: null });
    expect(await call('POST', PATHS.create, { body })).toEqual({
      status: 200,
      body: JSON.stringify({ ref: REF, cloned: true, cloneMs: 6200 }),
    });
    expect(calls).toEqual(['create {"workspaceId":"w","repoUrl":null}']);
  });

  it('refuses a malformed or oversized create', async () => {
    for (const body of ['not json', '{"workspaceId":1}', '{"workspaceId":"w","repoUrl":5}']) {
      expect((await call('POST', PATHS.create, { body })).status).toBe(422);
    }
    const huge = JSON.stringify({ workspaceId: 'w', repoUrl: 'x'.repeat(BODY_MAX_BYTES) });
    expect(await call('POST', PATHS.create, { body: huge })).toMatchObject({ status: 422 });
    expect(calls).toEqual([]);
  });

  it('runs the four actions, with the reference decoded', async () => {
    for (const action of ['start', 'pause', 'resume', 'stop'] as const) {
      expect((await call('POST', PATHS.action(REF, action))).status).toBe(204);
    }
    expect(calls).toEqual([`start ${REF}`, `pause ${REF}`, `resume ${REF}`, `stop ${REF}`]);
  });

  it('knows nothing else', async () => {
    for (const [method, path] of [
      ['GET', PATHS.create],
      ['POST', `/v1/workspaces/${REF}/remove`],
      ['POST', `/v1/workspaces/${REF}/stop/now`],
      ['GET', PATHS.action(REF, 'stop')],
      ['POST', '/v2/workspaces'],
    ] as const) {
      expect((await call(method, path)).status).toBe(404);
    }
    expect(calls).toEqual([]);
  });
});

describe('errors', () => {
  it('passes a HostError through with its kind, status and sentence', async () => {
    failWith = new HostError('refused', '2 workspaces are already running on this computer.');
    expect(await call('POST', PATHS.action(REF, 'start'))).toEqual({
      status: 409,
      body: JSON.stringify({
        error: { kind: 'refused', message: '2 workspaces are already running on this computer.' },
      }),
    });
  });

  it('turns anything else into a plain sentence, keeping details in the terminal', async () => {
    failWith = new Error('docker said: CANARY-secret at /home/someone');
    const response = await call('POST', PATHS.action(REF, 'start'));
    expect(response.status).toBe(422);
    expect(response.body).not.toContain('CANARY');
    expect(JSON.parse(response.body)).toEqual({
      error: { kind: 'failed', message: 'Something went wrong in the workspace host. Try again.' },
    });
  });

  it('never logs the token', async () => {
    await call('GET', PATHS.health);
    await call('GET', PATHS.health, { headers: { authorization: 'Bearer wrong' } });
    for (const [line] of log.mock.calls) expect(line).not.toContain(TOKEN);
  });
});
