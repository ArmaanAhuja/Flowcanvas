// Phase 1d's security check, against real Docker: secrets planted everywhere they could pass through (the host's
// token, a project's .env, a command's arguments and output, a terminal session) never end up anywhere they
// could be read later: the host's log lines, Docker's stored logs, a container's environment, or the
// processes inside the workspace. Run with `pnpm test:docker`; it removes everything it makes.
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { buildImage } from '@flowcanvas/workspace-image';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { findObjects, remove } from './clean.js';
import { dockerCli } from './docker-cli.js';
import { PATHS } from './protocol.js';
import { createHostServer } from './server.js';
import { WorkspaceHost } from './workspaces.js';

const run = promisify(execFile);
const prefix = `fc-test-${randomBytes(4).toString('hex')}`;
const CANARIES = {
  token: `CANARYtoken${randomBytes(24).toString('hex')}`,
  envFile: 'CANARY-dotenv-postgres-password',
  argument: 'CANARY-command-argument',
  output: 'CANARY-command-output',
  typed: 'CANARY-typed-in-the-terminal',
};

const lines: string[] = [];
const log = (line: string) => lines.push(line);
const host = new WorkspaceHost({ docker: dockerCli, prefix, image: () => buildImage(), log });
const workspaceId = randomUUID();
const ref = host.refFor(workspaceId);
let port = 0;
let server: ReturnType<typeof createHostServer>;

async function call(path: string, body?: unknown): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${CANARIES.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.text();
}

beforeAll(async () => {
  await buildImage();
  // The server checks its own Host header, so it needs its port before it listens.
  const probe = createHostServer({ host, token: CANARIES.token, port: 0, log });
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  port = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  server = createHostServer({ host, token: CANARIES.token, port, log });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
}, 300_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const object of (await findObjects(dockerCli)).filter((o) => o.prefix === prefix)) {
    await remove(dockerCli, object).catch(() => undefined);
  }
}, 120_000);

describe('no secret is kept anywhere it could be read later', { timeout: 120_000 }, () => {
  const answers: string[] = [];

  it('goes through a workspace with secrets in every place they can pass', async () => {
    answers.push(await call(PATHS.create, { workspaceId, repoUrl: null }));
    await run('docker', [
      'exec',
      ref,
      'sh',
      '-c',
      `mkdir -p /workspace/project && echo "DATABASE_URL=${CANARIES.envFile}" > /workspace/project/.env`,
    ]);
    // The .env file is refused through the API.
    const read = await call(PATHS.agent(ref), { op: 'read', path: '.env' });
    expect(read).toContain('secret_file');
    expect(read).not.toContain(CANARIES.envFile);
    // A command's own output comes back to its owner (that's the point), but is kept nowhere.
    const exec = await call(PATHS.agent(ref), {
      op: 'exec',
      command: ['sh', '-c', `echo ${CANARIES.argument} >/dev/null; echo ${CANARIES.output}`],
      cwd: '',
      timeoutMs: 10_000,
    });
    expect(exec).toContain(CANARIES.output);

    // A terminal session: typed, echoed and printed.
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${PATHS.terminal(ref, 80, 24)}`, {
      headers: { authorization: `Bearer ${CANARIES.token}` },
    });
    let screen = '';
    socket.on('message', (data: Buffer, binary: boolean) => {
      if (binary) screen += data.toString();
    });
    await new Promise((resolve) => socket.once('open', resolve));
    socket.send(Buffer.from(`echo ${CANARIES.typed}; cat .env\r`), { binary: true });
    const since = Date.now();
    while (!screen.includes(CANARIES.envFile) && Date.now() - since < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // The person's own shell shows them their own file: proven here so the checks below mean something.
    expect(screen).toContain(CANARIES.typed);
    expect(screen).toContain(CANARIES.envFile);
    const closed = new Promise((resolve) => socket.once('close', resolve));
    socket.send(Buffer.from('exit\r'), { binary: true });
    await closed;

    await host.pause(ref);
    await host.resume(ref);
    answers.push(await call(PATHS.pressure));
  });

  it("never in the host's log lines", () => {
    expect(lines.length).toBeGreaterThan(3);
    const all = lines.join('\n');
    for (const [name, canary] of Object.entries(CANARIES)) expect(all, name).not.toContain(canary);
  });

  it('never in the answers of other requests (only the owner’s own command and shell showed them)', () => {
    const all = answers.join('\n');
    for (const [name, canary] of Object.entries(CANARIES)) expect(all, name).not.toContain(canary);
  });

  it('never stored by Docker: container logs are off for the workspace and the proxy', async () => {
    for (const container of [ref, `${prefix}-egress`]) {
      const logs = await run('docker', ['logs', container]).then(
        ({ stdout, stderr }) => `${stdout}${stderr}`,
        (error: unknown) => String(error),
      );
      expect(logs, container).toMatch(/does not support reading|logging driver/i);
      for (const [name, canary] of Object.entries(CANARIES)) {
        expect(logs, `${name} in ${container}`).not.toContain(canary);
      }
    }
  });

  it("never in a container's settings or environment (docker inspect)", async () => {
    for (const container of [ref, `${prefix}-egress`]) {
      const settings = (await run('docker', ['inspect', container])).stdout;
      expect(settings, container).not.toContain(CANARIES.token);
      expect(settings, container).not.toContain(CANARIES.envFile);
    }
  });

  it('never in the environment of any process the workspace can see', async () => {
    // As the workspace's own user: every process environment it can read, including the agent's.
    const { stdout } = await run('docker', [
      'exec',
      ref,
      'sh',
      '-c',
      'for f in /proc/[0-9]*/environ; do tr "\\0" "\\n" < "$f" 2>/dev/null; done; ps -eo args',
    ]);
    expect(stdout.length).toBeGreaterThan(100);
    expect(stdout).not.toContain(CANARIES.token);
    // The agent runs there; it's never given the host's token or anything from .env.
    expect(stdout).toContain('flowcanvas-agent');
    expect(stdout).not.toContain(CANARIES.envFile);
  });
});
