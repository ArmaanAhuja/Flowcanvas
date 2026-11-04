// The workspace host against real Docker: a real clone of Rallly through the egress proxy, sleep and resume,
// the 2-workspace cap, and what a workspace can and can't reach. Needs Docker 28+ and the internet.
// Run with `pnpm test:docker`. Everything it creates has its own prefix and is removed afterwards.
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { buildImage } from '@flowcanvas/workspace-image';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findObjects, remove } from './clean.js';
import { dockerCli } from './docker-cli.js';
import { HostError } from './errors.js';
import { WorkspaceHost } from './workspaces.js';

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

  it('reaches GitHub only through the proxy, and nothing else at all', async () => {
    const through = await sh(ref, 'curl -sS -o /dev/null -w "%{http_code}" https://github.com');
    expect(through.out).toBe('200');
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
  });

  it('refuses a third running workspace', async () => {
    await host.create({ workspaceId: second, repoUrl: null });
    const third = host.create({ workspaceId: randomUUID(), repoUrl: null });
    await expect(third).rejects.toBeInstanceOf(HostError);
    await expect(third).rejects.toMatchObject({ kind: 'refused' });
  });

  it("can't reach another workspace, the host or the home network", async () => {
    const address = (
      await run('docker', [
        'inspect',
        '--format',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        host.refFor(second),
      ])
    ).stdout.trim();
    expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    const probe = (target: string) =>
      `node -e "require('net').connect(80,'${target}').on('connect',()=>console.log('CONNECTED')).on('error',e=>console.log(e.code))"`;
    for (const target of [address, '172.17.0.1', '192.168.1.1', '169.254.169.254']) {
      expect((await sh(ref, probe(target))).out, target).toBe('ENETUNREACH');
    }
  });

  it('logged the clone time, and no addresses', () => {
    expect(lines.some((line) => /^cloned into .* in \d+ ms$/.test(line))).toBe(true);
    expect(lines.join('\n')).not.toContain('github.com');
  });
});
