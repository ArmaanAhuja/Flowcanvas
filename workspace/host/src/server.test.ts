import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Duplex, PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { HostError } from './errors.js';
import { PATHS, type Pressure } from './protocol.js';
import { BODY_MAX_BYTES, createHostServer, type HostOperations } from './server.js';

const TOKEN = 'a'.repeat(64);
const REF = 'fc-ws-00000000-0000-4000-8000-000000000001';

let server: Server;
let port: number;
let calls: string[];
let log: ReturnType<typeof vi.fn<(line: string) => void>>;
let failWith: Error | undefined;
let resizes: string[];
let shell: Duplex | undefined;
let pressure: Pressure[];
/** The fake watcher process the last events socket got. */
let watcher:
  { stdout: PassThrough; stdin: PassThrough; killed: boolean; exit: () => void } | undefined;

/** A fake shell that echoes what it's sent, and ends when sent 'exit'. */
function echoShell(): Duplex {
  const stream: Duplex = new Duplex({
    read() {
      // Pushed from write().
    },
    write(chunk: Buffer, _encoding, done) {
      if (chunk.toString() === 'exit') stream.push(null);
      else stream.push(Buffer.concat([Buffer.from('echo:'), chunk]));
      done();
    },
  });
  return stream;
}

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
  terminal: async (ref, size) => {
    calls.push(`terminal ${ref} ${String(size.cols)}x${String(size.rows)}`);
    if (failWith !== undefined) throw failWith;
    shell = echoShell();
    return Promise.resolve({
      stream: shell,
      resize: (cols, rows) => {
        resizes.push(`${String(cols)}x${String(rows)}`);
        return Promise.resolve();
      },
      exitCode: () => Promise.resolve(3),
    });
  },
  agent: async (ref, request) => {
    calls.push(`agent ${ref} ${JSON.stringify(request)}`);
    if (failWith !== undefined) throw failWith;
    return Promise.resolve({ ok: true, result: { protocol: 1, node: 'v24' } });
  },
  watch: async (ref) => {
    calls.push(`watch ${ref}`);
    if (failWith !== undefined) throw failWith;
    const listeners: (() => void)[] = [];
    const process = {
      stdout: new PassThrough(),
      stdin: new PassThrough(),
      killed: false,
      exit: () => {
        for (const listener of listeners) listener();
      },
    };
    watcher = process;
    return Promise.resolve({
      stdin: process.stdin,
      stdout: process.stdout,
      kill: () => {
        process.killed = true;
      },
      onExit: (listener) => listeners.push(listener),
    });
  },
  pressure: () => pressure,
};

beforeEach(async () => {
  calls = [];
  failWith = undefined;
  resizes = [];
  shell = undefined;
  pressure = [];
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
    expect(calls).toEqual(['create {"workspaceId":"w","repoUrl":null,"commit":null}']);
  });

  it('refuses a malformed or oversized create', async () => {
    for (const body of [
      'not json',
      '{"workspaceId":1}',
      '{"workspaceId":"w","repoUrl":5}',
      '{"workspaceId":"w","repoUrl":null,"commit":7}',
    ]) {
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

  it("says whether the computer is under pressure (the resource guard's last check)", async () => {
    expect(await call('GET', PATHS.pressure)).toEqual({ status: 200, body: '{"pressure":[]}' });
    pressure = [{ kind: 'memory', message: 'Low on memory.' }];
    expect(JSON.parse((await call('GET', PATHS.pressure)).body)).toEqual({ pressure });
    expect((await call('GET', PATHS.pressure, { headers: { authorization: '' } })).status).toBe(
      401,
    );
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

describe('agent requests', () => {
  it('passes a checked request to the agent and returns its answer', async () => {
    const body = JSON.stringify({ op: 'list', path: 'src' });
    expect(await call('POST', PATHS.agent(REF), { body })).toEqual({
      status: 200,
      body: JSON.stringify({ ok: true, result: { protocol: 1, node: 'v24' } }),
    });
    expect(calls).toEqual([`agent ${REF} {"op":"list","path":"src"}`]);
  });

  it('answers a malformed request itself, without reaching the agent', async () => {
    const response = await call('POST', PATHS.agent(REF), {
      body: '{"op":"read","path":"/etc/passwd"}',
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      error: { code: 'outside_project' },
    });
    expect(calls).toEqual([]);
  });

  it('takes a 1 MiB file, but not much more', async () => {
    const content = Buffer.alloc(1024 * 1024).toString('base64');
    const ok = JSON.stringify({ op: 'write', path: 'a.bin', content, encoding: 'base64' });
    expect((await call('POST', PATHS.agent(REF), { body: ok })).status).toBe(200);
    const huge = JSON.stringify({ op: 'write', path: 'a', content: 'x'.repeat(3 * 1024 * 1024) });
    expect((await call('POST', PATHS.agent(REF), { body: huge })).status).toBe(422);
  });
});

/** Opens a terminal WebSocket; resolves with the socket once open, or the refusal's status and body. */
function terminal(
  path = PATHS.terminal(REF, 80, 24),
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
): Promise<WebSocket | { status: number; body: string }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, { headers });
    socket.on('open', () => {
      resolve(socket);
    });
    socket.on('unexpected-response', (_request, response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString()));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
  });
}

function next(socket: WebSocket): Promise<{ binary: boolean; text: string }> {
  return new Promise((resolve) => {
    socket.once('message', (data: Buffer, binary: boolean) => {
      resolve({ binary, text: data.toString() });
    });
  });
}

describe('terminals', () => {
  it('carries bytes both ways, resizes, and reports the exit code', async () => {
    const socket = await terminal();
    if (!(socket instanceof WebSocket)) throw new Error(`refused: ${socket.body}`);
    expect(calls).toEqual([`terminal ${REF} 80x24`]);
    socket.send(Buffer.from('ls'), { binary: true });
    expect(await next(socket)).toEqual({ binary: true, text: 'echo:ls' });
    socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    await vi.waitFor(() => {
      expect(resizes).toEqual(['120x40']);
    });
    const closed = new Promise((resolve) => socket.once('close', resolve));
    socket.send(Buffer.from('exit'), { binary: true });
    expect(await next(socket)).toEqual({ binary: false, text: '{"type":"exit","code":3}' });
    await closed;
  });

  it('answers unknown control messages, and never treats them as input', async () => {
    const socket = await terminal();
    if (!(socket instanceof WebSocket)) throw new Error('refused');
    for (const text of ['ls', '{"type":"resize","cols":9999,"rows":1}', '{"type":"exec"}']) {
      socket.send(text);
      expect(await next(socket)).toEqual({
        binary: false,
        text: '{"type":"error","message":"Unknown control message."}',
      });
    }
    expect(resizes).toEqual([]);
    socket.close();
  });

  it('hangs up the shell when the page goes away', async () => {
    const socket = await terminal();
    if (!(socket instanceof WebSocket)) throw new Error('refused');
    socket.close();
    await vi.waitFor(() => {
      expect(shell?.destroyed).toBe(true);
    });
  });

  it('checks the caller before accepting the WebSocket', async () => {
    expect(await terminal(undefined, {})).toMatchObject({ status: 401 });
    expect(
      await terminal(undefined, {
        authorization: `Bearer ${TOKEN}`,
        origin: 'https://evil.example',
      }),
    ).toMatchObject({ status: 403 });
    expect(await terminal(PATHS.terminal(REF, 9999, 24))).toMatchObject({ status: 404 });
    expect(await terminal(`/v1/workspaces/${REF}/shell`)).toMatchObject({ status: 404 });
    expect(calls).toEqual([]);
  });

  it("passes the host's refusal on, with its sentence", async () => {
    failWith = new HostError('refused', 'This workspace is asleep. Resume it first.');
    expect(await terminal()).toEqual({
      status: 409,
      body: JSON.stringify({
        error: { kind: 'refused', message: 'This workspace is asleep. Resume it first.' },
      }),
    });
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

describe('file watcher events', () => {
  const version = 'c'.repeat(64);
  const line = (event: unknown, v = 2) => `${JSON.stringify({ v, event })}\n`;

  it('passes checked events on as text, and drops anything else', async () => {
    const socket = await terminal(PATHS.events(REF));
    if (!(socket instanceof WebSocket)) throw new Error(`refused: ${socket.body}`);
    expect(calls).toEqual([`watch ${REF}`]);
    const received: string[] = [];
    socket.on('message', (data: Buffer) => received.push(data.toString()));
    watcher?.stdout.write(line({ type: 'ready', folders: 3, files: 9 }));
    watcher?.stdout.write(line({ type: 'changed', path: '.env', deleted: false, version }));
    watcher?.stdout.write(
      line({ type: 'changed', path: '../etc/passwd', deleted: false, version }),
    );
    watcher?.stdout.write(line({ type: 'ready', folders: 1, files: 1 }, 1));
    watcher?.stdout.write('not json CANARY\n');
    watcher?.stdout.write(`${'x'.repeat(5000)}\n`);
    watcher?.stdout.write(line({ type: 'changed', path: 'src/a.ts', deleted: false, version }));
    await vi.waitFor(() => {
      expect(received).toHaveLength(2);
    });
    expect(received.map((text) => JSON.parse(text) as unknown)).toEqual([
      { type: 'ready', folders: 3, files: 9 },
      { type: 'changed', path: 'src/a.ts', deleted: false, version },
    ]);
    const lines = log.mock.calls.map(([text]) => text);
    expect(lines.filter((text) => text.includes('not an event'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('CANARY');
    socket.close();
  });

  it('ends the watcher when the page goes away, and closes the page when the watcher ends', async () => {
    const socket = await terminal(PATHS.events(REF));
    if (!(socket instanceof WebSocket)) throw new Error('refused');
    const stdinEnded = new Promise((resolve) => watcher?.stdin.on('finish', resolve));
    socket.close();
    await stdinEnded;
    await vi.waitFor(
      () => {
        expect(watcher?.killed).toBe(true);
      },
      { timeout: 4000 },
    );
    const again = await terminal(PATHS.events(REF));
    if (!(again instanceof WebSocket)) throw new Error('refused');
    const closed = new Promise<number>((resolve) => {
      again.once('close', (code) => {
        resolve(code);
      });
    });
    watcher?.exit();
    expect(await closed).toBe(1000);
  });

  it('says why when there is nothing to watch, and checks the caller first', async () => {
    failWith = new HostError('refused', 'This workspace is asleep. Resume it first.');
    expect(await terminal(PATHS.events(REF))).toEqual({
      status: 409,
      body: JSON.stringify({
        error: { kind: 'refused', message: 'This workspace is asleep. Resume it first.' },
      }),
    });
    failWith = undefined;
    calls = [];
    expect(await terminal(PATHS.events(REF), {})).toMatchObject({ status: 401 });
    expect(calls).toEqual([]);
  });
});
