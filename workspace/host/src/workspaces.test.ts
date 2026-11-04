import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HostError } from './errors.js';
import { FakeDocker } from './test/fake-docker.js';
import { CLONE_TIMEOUT_MS, MESSAGES, WorkspaceHost } from './workspaces.js';

const IMAGE = 'flowcanvas-workspace:0123456789ab';
const REPO = 'https://github.com/ArmaanAhuja-7777/rallly';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let docker: FakeDocker;
let log: ReturnType<typeof vi.fn<(line: string) => void>>;
let host: WorkspaceHost;

beforeEach(() => {
  docker = new FakeDocker();
  log = vi.fn<(line: string) => void>();
  host = new WorkspaceHost({
    docker: docker.run,
    prefix: 'fc',
    image: () => Promise.resolve(IMAGE),
    log,
  });
});

const ref = (n: number) => `fc-ws-${id(n)}`;

async function expectHostError(
  promise: Promise<unknown>,
  kind: HostError['kind'],
  message?: string,
) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HostError);
  expect((error as HostError).kind).toBe(kind);
  if (message !== undefined) expect((error as HostError).userMessage).toBe(message);
}

describe('create', () => {
  it('starts the proxy, the network, the volume and the container, then clones', async () => {
    const result = await host.create({ workspaceId: id(1), repoUrl: REPO });
    expect(result).toMatchObject({ ref: ref(1), cloned: true });
    expect(docker.commands).toEqual(
      expect.arrayContaining([
        'network create --opt com.docker.network.bridge.enable_icc=false --label org.flowcanvas.workspace=1 --label org.flowcanvas.prefix=fc --label org.flowcanvas.role=egress fc-egress-out',
        'run fc-egress',
        `run ${ref(1)}`,
        `network connect ${ref(1)} fc-egress`,
      ]),
    );
    const clone = docker.calls.find((args) => args.includes('clone'));
    expect(clone).toEqual([
      'exec',
      ref(1),
      'git',
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.https.allow=always',
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--no-tags',
      '--',
      REPO,
      '/workspace/project',
    ]);
    expect(docker.containers.get(ref(1))?.labels.get('org.flowcanvas.workspace-id')).toBe(id(1));
    // The proxy is never on the workspace's own network at creation time, only connected afterwards.
    expect(docker.containers.get('fc-egress')?.networks).toEqual(
      new Set(['fc-egress-out', ref(1)]),
    );
  });

  it('works without a repository', async () => {
    expect(await host.create({ workspaceId: id(1), repoUrl: null })).toEqual({
      ref: ref(1),
      cloned: false,
      cloneMs: null,
    });
    expect(docker.calls.some((args) => args.includes('clone'))).toBe(false);
  });

  it('is safe to call again: it wakes the same container and keeps the clone', async () => {
    await host.create({ workspaceId: id(1), repoUrl: REPO });
    await host.pause(ref(1));
    docker.calls.length = 0;
    expect(await host.create({ workspaceId: id(1), repoUrl: REPO })).toMatchObject({
      cloned: false,
    });
    expect(docker.commands).toContain(`unpause ${ref(1)}`);
    expect(docker.commands.filter((c) => c.startsWith('run '))).toEqual([]);
  });

  it('refuses anything but a public GitHub address, before touching Docker', async () => {
    for (const repoUrl of [
      'https://gitlab.com/a/b',
      'http://github.com/a/b',
      'https://github.com/a',
      'https://github.com/a/b/../../c',
      'https://github.com.evil.example/a/b',
      'https://user@github.com/a/b',
      '--upload-pack=touch /tmp/x',
    ]) {
      await expectHostError(
        host.create({ workspaceId: id(1), repoUrl }),
        'failed',
        MESSAGES.notGitHub,
      );
    }
    await expectHostError(host.create({ workspaceId: '../etc', repoUrl: null }), 'failed');
    expect(docker.calls).toEqual([]);
  });

  it('accepts the usual forms of a GitHub address', async () => {
    for (const [n, repoUrl] of [REPO, `${REPO}.git`, `${REPO}/`].entries()) {
      await host.create({ workspaceId: id(n + 1), repoUrl });
      await host.stop(ref(n + 1));
    }
  });

  it('refuses a third running workspace, but not one that is asleep', async () => {
    await host.create({ workspaceId: id(1), repoUrl: null });
    await host.create({ workspaceId: id(2), repoUrl: null });
    await expectHostError(
      host.create({ workspaceId: id(3), repoUrl: null }),
      'refused',
      MESSAGES.full,
    );
    expect(docker.containers.has(ref(3))).toBe(false);
    await host.pause(ref(1));
    await host.create({ workspaceId: id(3), repoUrl: null });
    await expectHostError(host.resume(ref(1)), 'refused', MESSAGES.full);
  });

  it('cleans up after a failed clone, and logs only the exit code', async () => {
    docker.failClone = 128;
    await expectHostError(
      host.create({ workspaceId: id(1), repoUrl: REPO }),
      'failed',
      MESSAGES.cloneFailed,
    );
    expect(docker.commands).toContain(`exec ${ref(1)} rm -rf /workspace/project`);
    const lines = log.mock.calls.map(([line]) => line).join('\n');
    expect(lines).toContain('exit 128');
    expect(lines).not.toContain('github.com');
    // Trying again clones afresh.
    expect(await host.create({ workspaceId: id(1), repoUrl: REPO })).toMatchObject({
      cloned: true,
    });
  });

  it('gives the clone its own, longer timeout', async () => {
    const timeouts: (number | undefined)[] = [];
    const run = docker.run;
    host = new WorkspaceHost({
      docker: (args, options) => {
        if (args.includes('clone')) timeouts.push(options?.timeoutMs);
        return run(args, options);
      },
      prefix: 'fc',
      image: () => Promise.resolve(IMAGE),
      log,
    });
    await host.create({ workspaceId: id(1), repoUrl: REPO });
    expect(timeouts).toEqual([CLONE_TIMEOUT_MS]);
  });

  it('replaces the proxy when its version changed, and reattaches every workspace network', async () => {
    await host.create({ workspaceId: id(1), repoUrl: null });
    docker.containers.get('fc-egress')?.labels.set('org.flowcanvas.egress-version', 'old');
    await host.create({ workspaceId: id(2), repoUrl: null });
    expect(docker.commands).toContain('rm --force fc-egress');
    expect(docker.containers.get('fc-egress')?.networks).toEqual(
      new Set(['fc-egress-out', ref(1), ref(2)]),
    );
  });
});

describe('start, pause, resume, stop', () => {
  beforeEach(async () => {
    await host.create({ workspaceId: id(1), repoUrl: null });
  });

  it('pauses and resumes', async () => {
    await host.pause(ref(1));
    expect(docker.containers.get(ref(1))?.status).toBe('paused');
    await host.pause(ref(1));
    await host.resume(ref(1));
    expect(docker.containers.get(ref(1))?.status).toBe('running');
  });

  it('stops a paused workspace by waking it first', async () => {
    await host.pause(ref(1));
    docker.calls.length = 0;
    await host.stop(ref(1));
    expect(docker.commands.slice(-2)).toEqual([`unpause ${ref(1)}`, `stop --time 10 ${ref(1)}`]);
  });

  it('starts a stopped one again; a stopped one cannot sleep or resume', async () => {
    await host.stop(ref(1));
    await expectHostError(host.pause(ref(1)), 'gone');
    await expectHostError(host.resume(ref(1)), 'gone');
    await host.start(ref(1));
    expect(docker.containers.get(ref(1))?.status).toBe('running');
  });

  it("answers gone for a workspace Docker doesn't have", async () => {
    docker.containers.delete(ref(1));
    for (const action of ['start', 'pause', 'resume', 'stop'] as const) {
      await expectHostError(host[action](ref(1)), 'gone');
    }
  });

  it('refuses names that are not its own workspaces, before touching Docker', async () => {
    docker.calls.length = 0;
    for (const name of [
      'fc-egress',
      'postgres',
      `fc-ws-${id(1)} --privileged`,
      '../x',
      'fc-ws-1',
    ]) {
      await expectHostError(host.stop(name), 'gone');
    }
    expect(docker.calls).toEqual([]);
  });

  it('runs one operation at a time per workspace', async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    docker.before = async (args) => {
      if (args[0] === 'pause') {
        order.push('pause starts');
        await held;
        order.push('pause ends');
      }
      if (args[0] === 'stop') order.push('stop');
    };
    const pause = host.pause(ref(1));
    const stop = host.stop(ref(1));
    await vi.waitFor(() => {
      expect(order).toEqual(['pause starts']);
    });
    release?.();
    await Promise.all([pause, stop]);
    expect(order).toEqual(['pause starts', 'pause ends', 'stop']);
  });
});
