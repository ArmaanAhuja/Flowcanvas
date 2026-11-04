// Both sides of the local workspace host's protocol together: the real host process (workspace/host, run as
// `pnpm dev` runs it) and this adapter, with real Docker. Run with `pnpm test:docker`.
// @vitest-environment node
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MESSAGES, localHostFromEnv } from './local-host.js';
import type { WorkspaceProvider } from './provider.js';

const run = promisify(execFile);
const prefix = `fc-test-${randomBytes(4).toString('hex')}`;
const token = randomBytes(32).toString('hex');
const hostDir = fileURLToPath(new URL('../../../../workspace/host/', import.meta.url));
let child: ChildProcess;
let hostUrl = '';
let provider: WorkspaceProvider;
let output = '';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  // Its own process group (detached), so afterAll can stop tsx and the node process it starts, not just one.
  child = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
    cwd: hostDir,
    detached: true,
    env: {
      ...process.env,
      WORKSPACE_HOST_TOKEN: token,
      WORKSPACE_HOST_PORT: String(port),
      WORKSPACE_HOST_PREFIX: prefix,
    },
  });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const started = Date.now();
  while (!output.includes('Listening on')) {
    if (Date.now() - started > 30_000) throw new Error(`host didn't start:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  hostUrl = `http://127.0.0.1:${String(port)}`;
  const configured = localHostFromEnv(
    { WORKSPACE_HOST_URL: hostUrl, WORKSPACE_HOST_TOKEN: token },
    (input, init) => fetch(input, init),
  );
  if (configured === undefined) throw new Error('no provider');
  provider = configured;
}, 60_000);

afterAll(async () => {
  if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
  const list = async (args: string[]) =>
    (
      await run('docker', [...args, '--filter', `label=org.flowcanvas.prefix=${prefix}`, '-q'])
    ).stdout
      .split('\n')
      .filter((id) => id !== '');
  for (const id of await list(['ps', '--all'])) await run('docker', ['rm', '--force', id]);
  for (const id of await list(['network', 'ls'])) await run('docker', ['network', 'rm', id]);
  for (const id of await list(['volume', 'ls']))
    await run('docker', ['volume', 'rm', '--force', id]);
}, 60_000);

describe('the control plane driving the real workspace host', { timeout: 120_000 }, () => {
  it('creates, sleeps, resumes, stops and starts a workspace', async () => {
    const { ref } = await provider.create({ workspaceId: randomUUID(), repoUrl: null });
    expect(ref).toMatch(new RegExp(`^${prefix}-ws-`));
    const status = async () =>
      (await run('docker', ['inspect', '--format', '{{.State.Status}}', ref])).stdout.trim();
    await provider.pause(ref);
    expect(await status()).toBe('paused');
    await provider.resume(ref);
    expect(await status()).toBe('running');
    await provider.stop(ref);
    expect(await status()).toBe('exited');
    await provider.start(ref);
    expect(await status()).toBe('running');
  });

  it('asks the agent inside the workspace', async () => {
    const { ref } = await provider.create({ workspaceId: randomUUID(), repoUrl: null });
    // No repository, so no project folder yet.
    expect(await provider.agent(ref, { op: 'list', path: '' })).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'This workspace has no project files yet.' },
    });
    await provider.stop(ref);
  });

  it("passes the host's refusals through with their kind and sentence", async () => {
    await expect(provider.resume(`${prefix}-ws-${randomUUID()}`)).rejects.toMatchObject({
      kind: 'gone',
      userMessage: 'This workspace no longer exists on this computer.',
    });
    await expect(
      provider.create({ workspaceId: randomUUID(), repoUrl: 'https://gitlab.com/a/b' }),
    ).rejects.toMatchObject({ kind: 'failed' });
  });

  it('is refused with the wrong token', async () => {
    const url = /Listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? '';
    const wrong = localHostFromEnv(
      { WORKSPACE_HOST_URL: url, WORKSPACE_HOST_TOKEN: 'f'.repeat(64) },
      (input, init) => fetch(input, init),
    );
    await expect(wrong?.stop(`${prefix}-ws-${randomUUID()}`)).rejects.toMatchObject({
      kind: 'unavailable',
      userMessage: MESSAGES.noToken,
    });
  });

  it('relays a real shell through the Worker running in workerd', async () => {
    const { ref } = await provider.create({ workspaceId: randomUUID(), repoUrl: null });
    const port = await freePort();
    const worker = spawn(
      'pnpm',
      [
        'exec',
        'wrangler',
        'dev',
        '--config',
        'src/test/terminal-worker.wrangler.jsonc',
        '--port',
        String(port),
        '--ip',
        '127.0.0.1',
        '--var',
        `HOST_URL:${hostUrl}`,
        '--var',
        `HOST_TOKEN:${token}`,
      ],
      { cwd: fileURLToPath(new URL('../../', import.meta.url)), detached: true },
    );
    let log = '';
    worker.stdout.on('data', (chunk: Buffer) => (log += chunk.toString()));
    worker.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()));
    try {
      const started = Date.now();
      while (!log.includes('Ready on')) {
        if (Date.now() - started > 60_000) throw new Error(`wrangler didn't start:\n${log}`);
        await sleep(200);
      }
      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/?ref=${ref}`);
      socket.binaryType = 'arraybuffer';
      let output = '';
      const controls: unknown[] = [];
      socket.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data === 'string') controls.push(JSON.parse(event.data));
        else output += Buffer.from(event.data as ArrayBuffer).toString();
      });
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', () => {
          reject(new Error(`the WebSocket didn't open; wrangler said:\n${log.slice(-2000)}`));
        });
      });
      const until = async (text: string) => {
        const begun = Date.now();
        while (!output.includes(text)) {
          if (Date.now() - begun > 15_000)
            throw new Error(`no "${text}" in: ${output.slice(-300)}`);
          await sleep(50);
        }
      };
      // Bytes as a binary frame, the way xterm.js sends them; the reply comes back as bytes too.
      socket.send(new TextEncoder().encode('echo relayed-$((40+2))\r'));
      await until('relayed-42');
      socket.send(JSON.stringify({ type: 'resize', cols: 132, rows: 43 }));
      await sleep(200);
      socket.send(new TextEncoder().encode('stty size\r'));
      await until('43 132');
      const closed = new Promise((resolve) => {
        socket.addEventListener('close', resolve);
      });
      socket.send(new TextEncoder().encode('exit 5\r'));
      await closed;
      expect(controls).toContainEqual({ type: 'exit', code: 5 });
    } finally {
      if (worker.pid !== undefined) process.kill(-worker.pid, 'SIGTERM');
      await provider.stop(ref).catch(() => undefined);
    }
  });

  it('never printed the token', () => {
    expect(output).not.toContain(token);
  });
});
