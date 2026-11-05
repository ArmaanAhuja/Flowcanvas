// The workspace host against real Docker: a real clone of Rallly through the egress proxy, sleep and resume,
// the 2-workspace cap, and what a workspace can and can't reach. Needs Docker 28+ and the internet.
// Run with `pnpm test:docker`. Everything it creates has its own prefix and is removed afterwards.
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { buildImage } from '@flowcanvas/workspace-image';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findObjects, remove } from './clean.js';
import { dockerCli } from './docker-cli.js';
import { ALLOWED_HOSTS } from './egress/proxy.js';
import { HostError } from './errors.js';
import { WorkspaceHost } from './workspaces.js';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { PATHS } from './protocol.js';
import { createHostServer } from './server.js';

const run = promisify(execFile);
const RALLLY = 'https://github.com/ArmaanAhuja-7777/rallly';
const prefix = `fc-test-${randomBytes(4).toString('hex')}`;
const lines: string[] = [];
const host = new WorkspaceHost({
  docker: dockerCli,
  prefix,
  image: () => buildImage(),
  log: (line) => lines.push(line),
});
const rallly = randomUUID();
const ref = host.refFor(rallly);
const second = randomUUID();

async function sh(container: string, script: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run('docker', ['exec', container, 'sh', '-c', script]);
    return { code: 0, out: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
}

beforeAll(async () => {
  await buildImage();
}, 300_000);

afterAll(async () => {
  for (const object of (await findObjects(dockerCli)).filter((o) => o.prefix === prefix)) {
    await remove(dockerCli, object).catch(() => undefined);
  }
}, 120_000);

describe('workspace host with Docker', { timeout: 120_000 }, () => {
  it('opens Rallly from its GitHub address in under 60 seconds', async () => {
    const started = Date.now();
    const result = await host.create({ workspaceId: rallly, repoUrl: RALLLY });
    const total = Date.now() - started;
    console.log(`Rallly: opened in ${String(total)} ms (clone ${String(result.cloneMs)} ms)`);
    expect(result).toMatchObject({ ref, cloned: true });
    expect(total).toBeLessThan(60_000);
    expect(
      (
        await sh(
          ref,
          'test -f /workspace/project/package.json && git -C /workspace/project log --oneline -1',
        )
      ).code,
    ).toBe(0);
  });

  it('keeps the clone when opened again', async () => {
    expect(await host.create({ workspaceId: rallly, repoUrl: RALLLY })).toMatchObject({
      cloned: false,
    });
  });

  it('lists, reads and writes the project through the agent', async () => {
    const list = await host.agent(ref, { op: 'list', path: '' });
    expect(list.ok && 'entries' in list.result && list.result.entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['package.json', 'apps']),
    );
    const read = await host.agent(ref, { op: 'read', path: 'package.json' });
    expect(read.ok && 'content' in read.result && read.result.content).toContain('"name"');
    expect(
      await host.agent(ref, {
        op: 'write',
        path: 'flowcanvas-note.md',
        content: '# Hi\n',
        encoding: 'utf8',
      }),
    ).toMatchObject({ ok: true, result: { size: 5 } });
    expect((await sh(ref, 'stat -c "%u %s" /workspace/project/flowcanvas-note.md')).out).toBe(
      '1000 5',
    );
  });

  it('never reads a .env file, and never leaves the project', async () => {
    await sh(ref, 'echo DATABASE_URL=CANARY-postgres > /workspace/project/.env');
    const secret = await host.agent(ref, { op: 'read', path: '.env' });
    expect(secret).toMatchObject({ ok: false, error: { code: 'secret_file' } });
    expect(JSON.stringify(secret)).not.toContain('CANARY');
    await sh(ref, 'ln -s /etc/passwd /workspace/project/passwd');
    expect(await host.agent(ref, { op: 'read', path: 'passwd' })).toMatchObject({
      ok: false,
      error: { code: 'outside_project' },
    });
    expect(await host.agent(ref, { op: 'list', path: '../.home' })).toMatchObject({
      ok: false,
      error: { code: 'outside_project' },
    });
  });

  it('runs commands in the project, as the workspace user, through the proxy', async () => {
    const node = await host.agent(ref, {
      op: 'exec',
      command: ['node', '-v'],
      cwd: '',
      timeoutMs: 10_000,
    });
    expect(node).toMatchObject({ ok: true, result: { exitCode: 0 } });
    expect(node.ok && 'stdout' in node.result && node.result.stdout).toMatch(/^v24\./);
    const who = await host.agent(ref, {
      op: 'exec',
      command: ['sh', '-c', 'id -u; pwd'],
      cwd: 'apps',
      timeoutMs: 10_000,
    });
    expect(who.ok && 'stdout' in who.result && who.result.stdout).toBe(
      '1000\n/workspace/project/apps\n',
    );
    const git = await host.agent(ref, {
      op: 'exec',
      command: ['git', 'ls-remote', '--heads', 'https://github.com/ArmaanAhuja-7777/rallly'],
      cwd: '',
      timeoutMs: 30_000,
    });
    expect(git).toMatchObject({ ok: true, result: { exitCode: 0 } });
  });

  it('gives a real shell over the WebSocket: input, output, resize and exit code', async () => {
    const token = randomBytes(32).toString('hex');
    const probe = createHostServer({ host, token, port: 0, log: () => undefined });
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    const server = createHostServer({ host, token, port, log: (line) => lines.push(line) });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${PATHS.terminal(ref, 80, 24)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      let output = '';
      let exit: unknown;
      socket.on('message', (data: Buffer, binary: boolean) => {
        if (binary) output += data.toString();
        else exit = JSON.parse(data.toString());
      });
      await new Promise((resolve) => socket.once('open', resolve));
      const until = async (text: string) => {
        const started = Date.now();
        while (!output.includes(text)) {
          if (Date.now() - started > 15_000)
            throw new Error(`no "${text}" in: ${output.slice(-500)}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      };
      socket.send(Buffer.from('echo answer-$((6*7)); whoami; pwd\r'), { binary: true });
      await until('answer-42');
      await until('/workspace/project');
      expect(output).toContain('node');
      socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      socket.send(Buffer.from('stty size\r'), { binary: true });
      await until('40 120');
      const closed = new Promise((resolve) => socket.once('close', resolve));
      socket.send(Buffer.from('exit 3\r'), { binary: true });
      await closed;
      expect(exit).toEqual({ type: 'exit', code: 3 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reaches the allowlisted hosts only through the proxy, and nothing else at all', async () => {
    const through = await sh(ref, 'curl -sS -o /dev/null -w "%{http_code}" https://github.com');
    expect(through.out).toBe('200');
    // Every allowlisted host is reachable through it (any HTTP answer means the tunnel and TLS worked).
    for (const allowed of ALLOWED_HOSTS) {
      const answer = await sh(
        ref,
        `curl -sS -m 20 -o /dev/null -w "%{http_code}" https://${allowed}/`,
      );
      expect(answer.code, allowed).toBe(0);
      expect(answer.out, allowed).toMatch(/^[1-5]\d\d$/);
    }
    // Not on the allowlist: the proxy says no.
    const other = await sh(ref, 'curl -sS -o /dev/null https://example.com');
    expect(other.code).not.toBe(0);
    expect(other.out).toMatch(/CONNECT tunnel failed, response 403/);
    // Around the proxy: no route out at all.
    const direct = await sh(ref, 'curl -sS --noproxy "*" -m 5 -o /dev/null https://github.com');
    expect(direct.code).not.toBe(0);
    // Plain HTTP through the proxy is refused too.
    const plain = await sh(
      ref,
      `curl -sS -o /dev/null -w "%{http_code}" -x http://${prefix}-egress:3128 http://github.com`,
    );
    expect(plain.out).toBe('403');
  });

  it("gives the proxy no packet forwarding between the networks it's on", async () => {
    expect((await sh(`${prefix}-egress`, 'cat /proc/sys/net/ipv4/ip_forward')).out).toBe('0');
  });

  it('sleeps and resumes with its processes intact', async () => {
    await sh(ref, 'sleep 600 >/dev/null 2>&1 & echo $! > /tmp/sleeper');
    const pid = (await sh(ref, 'cat /tmp/sleeper')).out;
    await host.pause(ref);
    expect(
      (await run('docker', ['inspect', '--format', '{{.State.Status}}', ref])).stdout.trim(),
    ).toBe('paused');
    await host.resume(ref);
    expect((await sh(ref, `kill -0 ${pid} && echo alive`)).out).toBe('alive');
  });

  it('stops and starts again with its files', async () => {
    await host.stop(ref);
    await expect(host.resume(ref)).rejects.toMatchObject({ kind: 'gone' });
    await host.start(ref);
    expect((await sh(ref, 'test -d /workspace/project/.git && echo kept')).out).toBe('kept');
    // A restarted container has a fresh /tmp: the agent is copied in and started again.
    expect(await host.agent(ref, { op: 'read', path: 'flowcanvas-note.md' })).toMatchObject({
      ok: true,
      result: { content: '# Hi\n' },
    });
  });

  it('refuses a third running workspace', async () => {
    await host.create({ workspaceId: second, repoUrl: null });
    const third = host.create({ workspaceId: randomUUID(), repoUrl: null });
    await expect(third).rejects.toBeInstanceOf(HostError);
    await expect(third).rejects.toMatchObject({ kind: 'refused' });
  });

  describe("workspaces can't reach each other, the host or the home network (Done when)", () => {
    const other = () => host.refFor(second);
    // Run inside a workspace: tries each host|port and prints what happened. ECONNREFUSED means something
    // answered, so it counts as reached: only no route, no host or silence counts as unreachable.
    const PROBE = `
      const net = require('net');
      Promise.all(process.argv.slice(1).map((t) => new Promise((done) => {
        const [host, port] = t.split('|');
        const s = net.connect({ host, port: Number(port), timeout: 3000 });
        s.on('connect', () => { s.destroy(); done(t + ' CONNECTED'); });
        s.on('timeout', () => { s.destroy(); done(t + ' TIMEOUT'); });
        s.on('error', (e) => done(t + ' ' + e.code));
      }))).then((r) => console.log(r.join('\\n')));`;
    const UNREACHABLE = /^(ENETUNREACH|EHOSTUNREACH|TIMEOUT)$/;

    async function probe(from: string, targets: string[]): Promise<Map<string, string>> {
      const { stdout } = await run('docker', ['exec', from, 'node', '-e', PROBE, ...targets]);
      return new Map(
        stdout
          .trim()
          .split('\n')
          .map((line) => line.split(' ') as [string, string]),
      );
    }

    /** Each network a container is on, with its address there. */
    async function addresses(container: string): Promise<Map<string, string>> {
      const { stdout } = await run('docker', [
        'inspect',
        '--format',
        '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{$net.IPAddress}}\n{{end}}',
        container,
      ]);
      return new Map(
        stdout
          .trim()
          .split('\n')
          .map((line) => line.split(' ') as [string, string]),
      );
    }

    /** This computer's own IPv4 addresses: the home network, Docker's bridges, VPNs. */
    function hostAddresses(): string[] {
      return Object.values(networkInterfaces())
        .flatMap((list) => list ?? [])
        .filter((i) => i.family === 'IPv4' && !i.internal)
        .map((i) => i.address);
    }

    it('one workspace reaches nothing of the other, in either direction', async () => {
      for (const [from, to] of [
        [ref, other()],
        [other(), ref],
      ] as const) {
        const address = [...(await addresses(to)).values()][0] ?? '';
        expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        const results = await probe(
          from,
          ['22', '80', '443', '3000', '5173', '8080'].map((port) => `${address}|${port}`),
        );
        for (const [target, result] of results) expect(result, target).toMatch(UNREACHABLE);
        // Not even its name: each workspace's DNS knows only its own network.
        expect((await sh(from, `getent hosts ${to}`)).code, to).not.toBe(0);
      }
    });

    it('reaches the proxy on its own network on the proxy port only, and none of its other sides', async () => {
      const egress = await addresses(`${prefix}-egress`);
      const own = egress.get(ref) ?? '';
      expect(own).not.toBe('');
      const others = [...egress].filter(([network]) => network !== ref).map(([, a]) => a);
      // The other workspace's network and the proxy's own way out.
      expect(others.length).toBeGreaterThanOrEqual(2);
      const results = await probe(ref, [
        `${own}|3128`,
        `${own}|22`,
        ...others.map((a) => `${a}|3128`),
      ]);
      expect(results.get(`${own}|3128`)).toBe('CONNECTED');
      expect(results.get(`${own}|22`)).toBe('ECONNREFUSED');
      for (const address of others) {
        expect(results.get(`${address}|3128`), address).toMatch(UNREACHABLE);
      }
    });

    it("reaches none of this computer's addresses, the cloud metadata address or the internet directly", async () => {
      const targets = [
        ...hostAddresses().flatMap((a) => [`${a}|22`, `${a}|8790`, `${a}|5173`]),
        '172.17.0.1|80',
        '169.254.169.254|80',
        '1.1.1.1|443',
        '140.82.112.3|443',
      ];
      for (const [target, result] of await probe(ref, targets)) {
        expect(result, target).toMatch(UNREACHABLE);
      }
    });

    it('has no way to look names up outside, and no IPv6 apart from loopback', async () => {
      // DNS would be a way out (tunnelling data through lookups); an internal network doesn't forward it.
      expect((await sh(ref, 'getent hosts github.com')).code).not.toBe(0);
      expect((await sh(ref, 'getent hosts example.com')).code).not.toBe(0);
      const v6 = (await sh(ref, 'cat /proc/net/if_inet6')).out.split('\n').filter((l) => l !== '');
      expect(
        v6.every((line) => line.trim().endsWith(' lo')),
        v6.join('; '),
      ).toBe(true);
    });

    it("can't use the proxy to reach the other workspace or the host", async () => {
      const otherAddress = [...(await addresses(other())).values()][0] ?? '';
      for (const target of [otherAddress, other(), '172.17.0.1', 'localhost', `${prefix}-egress`]) {
        const result = await sh(ref, `curl -sS -m 10 -o /dev/null https://${target}/`);
        expect(result.code, target).not.toBe(0);
        expect(result.out, target).toMatch(/CONNECT tunnel failed, response 403/);
      }
    });
  });

  it('logged the clone time, and no addresses', () => {
    expect(lines.some((line) => /^cloned into .* in \d+ ms$/.test(line))).toBe(true);
    expect(lines.join('\n')).not.toContain('github.com');
  });
});
