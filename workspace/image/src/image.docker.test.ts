// Real containers: the image and every lock-down flag, checked from inside. Needs Docker 28+.
// Run with `pnpm test:docker` (not part of `pnpm test`, which must work without Docker).
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildImage } from './docker.js';
import { WORKSPACE_LIMITS, networkCreateArgs, runArgs, type WorkspaceLimits } from './spec.js';

const run = promisify(execFile);
const MiB = 1024 ** 2;
const id = randomBytes(4).toString('hex');
const network = `fc-test-net-${id}`;
const containers: string[] = [];
const volumes: string[] = [];
let image = '';

async function docker(...args: string[]): Promise<string> {
  return (await run('docker', args, { maxBuffer: 16 * MiB })).stdout.trim();
}

/** Runs a shell script inside the container; never throws, so tests can check failures. */
async function sh(container: string, script: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run('docker', ['exec', container, 'sh', '-c', script], {
      maxBuffer: 16 * MiB,
    });
    return { code: 0, out: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : -1,
      out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim(),
    };
  }
}

async function start(
  limits?: Partial<WorkspaceLimits>,
  volume = `fc-test-vol-${id}-${String(volumes.length)}`,
) {
  if (!volumes.includes(volume)) volumes.push(volume);
  const name = `fc-test-ws-${id}-${String(containers.length)}`;
  containers.push(name);
  await docker(...runArgs({ name, network, volume, image, ...(limits ? { limits } : {}) }));
  return { name, volume };
}

beforeAll(async () => {
  image = await buildImage();
  await docker(...networkCreateArgs(network));
}, 300_000);

afterAll(async () => {
  for (const name of containers) await docker('rm', '--force', name).catch(() => '');
  for (const volume of volumes) await docker('volume', 'rm', '--force', volume).catch(() => '');
  await docker('network', 'rm', network).catch(() => '');
}, 60_000);

describe('workspace image', { timeout: 60_000 }, () => {
  it('has Node 24, pnpm and git', async () => {
    const { name } = await start();
    const { code, out } = await sh(name, 'node -v && pnpm -v && git --version');
    expect(code).toBe(0);
    expect(out).toMatch(/^v24\.\d+\.\d+\n12\.15\.0\ngit version /);
  });

  it('runs as uid 1000 with no capabilities and no way to gain privileges', async () => {
    const { name } = await start();
    const { out } = await sh(
      name,
      'id -u; grep -E "^(CapEff|CapPrm|NoNewPrivs):" /proc/self/status',
    );
    expect(out).toContain('1000');
    expect(out).toMatch(/CapPrm:\s+0000000000000000/);
    expect(out).toMatch(/CapEff:\s+0000000000000000/);
    expect(out).toMatch(/NoNewPrivs:\s+1/);
  });

  it('has no Docker socket inside', async () => {
    const { name } = await start();
    expect(
      (await sh(name, 'test -e /var/run/docker.sock || test -e /run/docker.sock')).code,
    ).not.toBe(0);
  });

  it('keeps the root filesystem read-only; /workspace and /tmp are writable', async () => {
    const { name } = await start();
    expect((await sh(name, 'touch /etc/flowcanvas-test')).out).toMatch(/Read-only file system/);
    expect((await sh(name, 'touch /usr/local/bin/x')).code).not.toBe(0);
    expect((await sh(name, 'touch /workspace/a /tmp/b /workspace/.home/c')).code).toBe(0);
  });

  it('keeps files in the volume when the container is replaced', async () => {
    const first = await start();
    await sh(first.name, 'echo kept > /workspace/note.txt');
    await docker('rm', '--force', first.name);
    const second = await start(undefined, first.volume);
    expect((await sh(second.name, 'cat /workspace/note.txt')).out).toBe('kept');
  });

  it('caps /tmp at its size', async () => {
    const { name } = await start({ tmpBytes: 16 * MiB });
    const { code, out } = await sh(name, 'dd if=/dev/zero of=/tmp/big bs=1M count=32 status=none');
    expect(code).not.toBe(0);
    expect(out).toMatch(/No space left on device/);
  });

  it('kills a process that goes over the memory limit', async () => {
    const { name } = await start({ memoryBytes: 64 * MiB });
    // Filled with 1s: zero-filled memory is mapped lazily and wouldn't count against the limit.
    const { code } = await sh(
      name,
      'node -e "const b = Buffer.alloc(256 * 1024 * 1024, 1); console.log(b.length)"',
    );
    expect(code).toBe(137);
    expect(await docker('inspect', '--format', '{{.HostConfig.MemorySwap}}', name)).toBe(
      String(64 * MiB),
    );
  });

  it('stops new processes at the process limit', async () => {
    const { name } = await start({ pids: 32 });
    const { out } = await sh(name, 'for i in $(seq 64); do sleep 30 & done');
    expect(out).toMatch(/Cannot fork/);
    // Counted from the host: inside, the container has no processes left to count with.
    const pids = Number(await docker('stats', '--no-stream', '--format', '{{.PIDs}}', name));
    expect(pids).toBeGreaterThan(16);
    expect(pids).toBeLessThanOrEqual(32);
  });

  it('limits CPU to its share', async () => {
    const { name } = await start();
    const { out } = await sh(name, 'cat /sys/fs/cgroup/cpu.max');
    expect(out).toBe(`${String(WORKSPACE_LIMITS.cpus * 100_000)} 100000`);
  });

  it('has no route to the host or the internet', async () => {
    const { name } = await start();
    const probe = (host: string) =>
      `node -e "require('net').connect(80,'${host}').on('connect',()=>console.log('CONNECTED')).on('error',e=>console.log(e.code))"`;
    for (const host of ['172.17.0.1', '1.1.1.1', '169.254.169.254']) {
      expect((await sh(name, probe(host))).out).toBe('ENETUNREACH');
    }
  });
});
