import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Agents, type StartAgent } from './agents.js';
import { HostError } from './errors.js';
import { MESSAGES as GUARD_MESSAGES } from './guard.js';
import type { Pressure } from './protocol.js';
import { AGENT_PROTOCOL } from '@flowcanvas/workspace-agent/protocol';
import { FakeDocker } from './test/fake-docker.js';
import type { Engine } from './engine.js';
import {
  CLONE_TIMEOUT_MS,
  MAX_TERMINALS,
  MAX_WATCHERS,
  MESSAGES,
  WorkspaceHost,
} from './workspaces.js';

const IMAGE = 'flowcanvas-workspace:0123456789ab';
const REPO = 'https://github.com/ArmaanAhuja-7777/rallly';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let docker: FakeDocker;
let log: ReturnType<typeof vi.fn<(line: string) => void>>;
let host: WorkspaceHost;
let agentStarts: string[];
let agentKills: number;
let execBodies: unknown[];

/** Records exec bodies and hands back a stream for each terminal. */
const fakeEngine: Engine = {
  json: (method, path, body) => {
    if (method === 'POST' && path.endsWith('/exec')) execBodies.push(body);
    return Promise.resolve({ status: 201, body: { Id: 'a'.repeat(64) } });
  },
  upgrade: () => Promise.resolve(new PassThrough()),
};

/** An agent that answers every request with a hello. */
const fakeAgent: StartAgent = (ref) => {
  agentStarts.push(ref);
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const exits: (() => void)[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk
      .toString()
      .split('\n')
      .filter((l) => l !== '')) {
      const { id } = JSON.parse(line) as { id: number };
      const result = { protocol: AGENT_PROTOCOL, node: 'v26' };
      stdout.write(`${JSON.stringify({ v: AGENT_PROTOCOL, id, body: { ok: true, result } })}\n`);
    }
  });
  return Promise.resolve({
    stdin,
    stdout,
    kill: () => {
      agentKills += 1;
      for (const exit of exits) exit();
    },
    onExit: (listener) => exits.push(listener),
  });
};

/** Watchers started, by ref; each can be ended from the test. */
let watchers: { ref: string; killed: boolean; exit: () => void }[] = [];
const fakeWatcher: StartAgent = (watchedRef) => {
  const exits: (() => void)[] = [];
  const record = {
    ref: watchedRef,
    killed: false,
    exit: () => {
      for (const listener of exits) listener();
    },
  };
  watchers.push(record);
  return Promise.resolve({
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: () => {
      record.killed = true;
      record.exit();
    },
    onExit: (listener) => exits.push(listener),
  });
};

beforeEach(() => {
  watchers = [];
  docker = new FakeDocker();
  log = vi.fn<(line: string) => void>();
  agentStarts = [];
  agentKills = 0;
  execBodies = [];
  host = new WorkspaceHost({
    docker: docker.run,
    prefix: 'fc',
    image: () => Promise.resolve(IMAGE),
    log,
    agents: new Agents(fakeAgent),
    engine: fakeEngine,
    watchers: fakeWatcher,
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

  it('checks out a pinned commit exactly, shallow and detached, with the same https-only rules', async () => {
    const pin = '8e67a2161a2d2211c04ef60d3a40ec365b50149c';
    expect(await host.create({ workspaceId: id(1), repoUrl: REPO, commit: pin })).toMatchObject({
      cloned: true,
    });
    const git = docker.calls
      .filter((args) => args[0] === 'exec' && args[2] === 'git')
      .map((args) => args.slice(3));
    const rules = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always'];
    expect(git).toEqual([
      [...rules, 'init', '--quiet', '--', '/workspace/project'],
      [...rules, '-C', '/workspace/project', 'remote', 'add', 'origin', '--', REPO],
      [
        ...rules,
        '-C',
        '/workspace/project',
        'fetch',
        '--depth',
        '1',
        '--no-tags',
        '--quiet',
        'origin',
        pin,
      ],
      [...rules, '-C', '/workspace/project', 'checkout', '--quiet', '--detach', pin],
    ]);
  });

  it('refuses a commit that is not a full SHA, or one without a repository, before touching Docker', async () => {
    for (const commit of [
      '8e67a21',
      'main',
      '--upload-pack=evil',
      '8E67A2161A2D2211C04EF60D3A40EC365B50149C',
    ]) {
      await expectHostError(host.create({ workspaceId: id(1), repoUrl: REPO, commit }), 'failed');
    }
    await expectHostError(
      host.create({
        workspaceId: id(1),
        repoUrl: null,
        commit: '8e67a2161a2d2211c04ef60d3a40ec365b50149c',
      }),
      'failed',
    );
    expect(docker.calls).toEqual([]);
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

describe("the resource guard's pressure", () => {
  let pressure: Pressure[];
  beforeEach(() => {
    pressure = [];
    host = new WorkspaceHost({
      docker: docker.run,
      prefix: 'fc',
      image: () => Promise.resolve(IMAGE),
      log,
      agents: new Agents(fakeAgent),
      engine: fakeEngine,
      pressure: () => pressure,
    });
  });

  it('refuses new and stopped workspaces under any pressure, with its sentence', async () => {
    await host.create({ workspaceId: id(1), repoUrl: null });
    await host.stop(ref(1));
    for (const kind of ['memory', 'disk', 'load', 'budget'] as const) {
      pressure = [{ kind, message: GUARD_MESSAGES[kind] }];
      await expectHostError(
        host.create({ workspaceId: id(2), repoUrl: null }),
        'refused',
        GUARD_MESSAGES[kind],
      );
      await expectHostError(host.start(ref(1)), 'refused', GUARD_MESSAGES[kind]);
    }
    expect(docker.containers.has(ref(2))).toBe(false);
    expect(docker.containers.get(ref(1))?.status).toBe('exited');
  });

  it('lets a sleeping workspace resume unless the computer is busy (it already holds its memory)', async () => {
    await host.create({ workspaceId: id(1), repoUrl: null });
    await host.pause(ref(1));
    pressure = [{ kind: 'load', message: GUARD_MESSAGES.load }];
    await expectHostError(host.resume(ref(1)), 'refused', GUARD_MESSAGES.load);
    pressure = [
      { kind: 'memory', message: GUARD_MESSAGES.memory },
      { kind: 'disk', message: GUARD_MESSAGES.disk },
    ];
    await host.resume(ref(1));
    expect(docker.containers.get(ref(1))?.status).toBe('running');
  });

  it('still lets running workspaces sleep and stop under pressure', async () => {
    await host.create({ workspaceId: id(1), repoUrl: null });
    pressure = [{ kind: 'memory', message: GUARD_MESSAGES.memory }];
    await host.pause(ref(1));
    await host.stop(ref(1));
    expect(docker.containers.get(ref(1))?.status).toBe('exited');
    expect(host.pressure()).toEqual(pressure);
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

describe('agent', () => {
  beforeEach(async () => {
    await host.create({ workspaceId: id(1), repoUrl: null });
  });

  it('passes requests to the running workspace’s agent', async () => {
    expect(await host.agent(ref(1), { op: 'hello' })).toEqual({
      ok: true,
      result: { protocol: AGENT_PROTOCOL, node: 'v26' },
    });
    expect(agentStarts).toEqual([ref(1)]);
  });

  it('refuses a workspace that is asleep, stopped or not ours', async () => {
    await host.pause(ref(1));
    await expectHostError(host.agent(ref(1), { op: 'hello' }), 'refused', MESSAGES.asleep);
    await host.resume(ref(1));
    await host.stop(ref(1));
    await expectHostError(host.agent(ref(1), { op: 'hello' }), 'refused', MESSAGES.notRunning);
    await expectHostError(host.agent('postgres', { op: 'hello' }), 'gone');
    expect(agentStarts).toEqual([]);
  });

  it('ends the agent when the workspace stops', async () => {
    await host.agent(ref(1), { op: 'hello' });
    await host.stop(ref(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agentKills).toBe(1);
  });
});

describe('terminal', () => {
  beforeEach(async () => {
    await host.create({ workspaceId: id(1), repoUrl: REPO });
  });

  it('starts bash on a pty as the workspace user, in the project', async () => {
    await host.terminal(ref(1), { cols: 100, rows: 30 });
    expect(execBodies).toEqual([
      expect.objectContaining({
        Tty: true,
        Cmd: ['bash', '-l'],
        User: '1000:1000',
        WorkingDir: '/workspace/project',
        ConsoleSize: [30, 100],
      }),
    ]);
  });

  it('starts in /workspace when there is no project', async () => {
    await host.create({ workspaceId: id(2), repoUrl: null });
    await host.terminal(ref(2), { cols: 80, rows: 24 });
    expect(execBodies).toEqual([expect.objectContaining({ WorkingDir: '/workspace' })]);
  });

  it(`allows ${String(MAX_TERMINALS)} at once, and another once one closes`, async () => {
    const sessions = [];
    for (let n = 0; n < MAX_TERMINALS; n += 1)
      sessions.push(await host.terminal(ref(1), { cols: 80, rows: 24 }));
    await expectHostError(
      host.terminal(ref(1), { cols: 80, rows: 24 }),
      'refused',
      MESSAGES.tooManyTerminals,
    );
    sessions[0]?.stream.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await host.terminal(ref(1), { cols: 80, rows: 24 });
  });

  it('refuses a workspace that is asleep, stopped or not ours', async () => {
    await host.pause(ref(1));
    await expectHostError(
      host.terminal(ref(1), { cols: 80, rows: 24 }),
      'refused',
      MESSAGES.asleep,
    );
    await host.resume(ref(1));
    await host.stop(ref(1));
    await expectHostError(
      host.terminal(ref(1), { cols: 80, rows: 24 }),
      'refused',
      MESSAGES.notRunning,
    );
    await expectHostError(host.terminal('postgres', { cols: 80, rows: 24 }), 'gone');
    expect(execBodies).toEqual([]);
  });
});

describe('watch (phase 3)', () => {
  beforeEach(async () => {
    await host.create({ workspaceId: id(1), repoUrl: REPO });
  });

  it(`starts a watcher per page, ${String(MAX_WATCHERS)} at most, and another once one ends`, async () => {
    for (let n = 0; n < MAX_WATCHERS; n += 1) await host.watch(ref(1));
    expect(watchers.map((w) => w.ref)).toEqual(Array(MAX_WATCHERS).fill(ref(1)));
    await expectHostError(host.watch(ref(1)), 'refused', MESSAGES.tooManyWatchers);
    watchers[0]?.exit();
    await host.watch(ref(1));
  });

  it('refuses a workspace that is asleep, stopped or not ours', async () => {
    await host.pause(ref(1));
    await expectHostError(host.watch(ref(1)), 'refused', MESSAGES.asleep);
    await host.resume(ref(1));
    await host.stop(ref(1));
    await expectHostError(host.watch(ref(1)), 'refused', MESSAGES.notRunning);
    await expectHostError(host.watch('postgres'), 'gone');
    expect(watchers).toEqual([]);
  });

  it('ends its watchers when the workspace stops', async () => {
    await host.watch(ref(1));
    await host.watch(ref(1));
    await host.stop(ref(1));
    expect(watchers.map((w) => w.killed)).toEqual([true, true]);
  });
});
