import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Docker } from './docker-cli.js';
import { GUARD, MESSAGES, ResourceGuard, evaluate, removeOldImages } from './guard.js';
import { BUDGET, type SystemFigures } from './resources.js';

const GiB = 1024 ** 3;
const roomy: SystemFigures = {
  memoryTotalBytes: 31 * GiB,
  memoryAvailableBytes: 20 * GiB,
  diskFreeBytes: 500 * GiB,
  load1: 1,
  cores: 16,
};
const busyLoad = BUDGET.maxLoadPerCore * 16 + 0.5;
const kinds = (pressure: readonly { kind: string }[]) => pressure.map((p) => p.kind);

describe('evaluate', () => {
  it('finds nothing when there is room', () => {
    expect(evaluate(roomy, 1 * GiB, null, 0)).toEqual([]);
  });

  it('reports each limit crossed, with its sentence', () => {
    const tight = {
      ...roomy,
      memoryAvailableBytes: BUDGET.minAvailableMemoryBytes - 1,
      diskFreeBytes: BUDGET.minFreeDiskBytes - 1,
    };
    expect(evaluate(tight, BUDGET.flowcanvasDiskBytes + 1, 0, BUDGET.loadSustainedMs)).toEqual([
      { kind: 'memory', message: MESSAGES.memory },
      { kind: 'disk', message: MESSAGES.disk },
      { kind: 'load', message: MESSAGES.load },
      { kind: 'budget', message: MESSAGES.budget },
    ]);
  });

  it('counts the load only once it has stayed high for 2 minutes', () => {
    expect(evaluate(roomy, 0, 0, BUDGET.loadSustainedMs - 1)).toEqual([]);
    expect(kinds(evaluate(roomy, 0, 0, BUDGET.loadSustainedMs))).toEqual(['load']);
  });

  it("says what to do, in sentences that don't blame the person", () => {
    expect(MESSAGES.memory).toMatch(/^This computer is low on memory \(under 4 GiB available\)/);
    expect(MESSAGES.budget).toMatch(/25 GiB/);
  });
});

describe('ResourceGuard', () => {
  let now: number;
  let system: SystemFigures;
  let diskBytes: number;
  let diskReads: number;
  let removed: string[];
  let lines: string[];
  let guard: ResourceGuard;

  beforeEach(() => {
    now = 0;
    system = roomy;
    diskBytes = 1 * GiB;
    diskReads = 0;
    removed = [];
    lines = [];
    guard = new ResourceGuard({
      readSystem: () => Promise.resolve(system),
      readFlowcanvasDisk: () => {
        diskReads += 1;
        return Promise.resolve(diskBytes);
      },
      cleanUp: () => Promise.resolve(removed),
      now: () => now,
      log: (line) => lines.push(line),
    });
  });

  it('acts on load only after 2 minutes of samples above the line, and forgets once it drops', async () => {
    system = { ...roomy, load1: busyLoad };
    for (const at of [0, 30_000, 60_000, 90_000]) {
      now = at;
      expect(await guard.check()).toEqual([]);
    }
    now = 120_000;
    expect(kinds(await guard.check())).toEqual(['load']);
    system = roomy;
    now = 150_000;
    expect(await guard.check()).toEqual([]);
    // High again: the 2 minutes start over.
    system = { ...roomy, load1: busyLoad };
    now = 180_000;
    expect(await guard.check()).toEqual([]);
  });

  it('measures its own disk only every 5 minutes (it takes seconds)', async () => {
    for (let at = 0; at < GUARD.diskEveryMs; at += GUARD.everyMs) {
      now = at;
      await guard.check();
    }
    expect(diskReads).toBe(1);
    now = GUARD.diskEveryMs;
    await guard.check();
    expect(diskReads).toBe(2);
  });

  it('frees disk when short, and measures again straight after removing something', async () => {
    system = { ...roomy, diskFreeBytes: BUDGET.minFreeDiskBytes - 1 };
    removed = ['flowcanvas-workspace:000000000000'];
    expect(kinds(await guard.check())).toEqual(['disk']);
    expect(lines).toContain('guard: removed flowcanvas-workspace:000000000000 to free disk');
    now = GUARD.everyMs;
    await guard.check();
    expect(diskReads).toBe(2);
  });

  it('frees disk when Flowcanvas is over its own budget too', async () => {
    diskBytes = BUDGET.flowcanvasDiskBytes + 1;
    const cleanUp = vi.fn(() => Promise.resolve([]));
    guard = new ResourceGuard({
      readSystem: () => Promise.resolve(system),
      readFlowcanvasDisk: () => Promise.resolve(diskBytes),
      cleanUp,
      now: () => now,
      log: (line) => lines.push(line),
    });
    expect(kinds(await guard.check())).toEqual(['budget']);
    expect(cleanUp).toHaveBeenCalledOnce();
  });

  it('logs changes only, not every check', async () => {
    system = { ...roomy, memoryAvailableBytes: 1 * GiB };
    await guard.check();
    now = 30_000;
    await guard.check();
    system = roomy;
    now = 60_000;
    await guard.check();
    expect(lines).toEqual(['guard: under pressure: memory', 'guard: back within limits']);
  });

  it('keeps its last answer when measuring fails, and says so once', async () => {
    system = { ...roomy, memoryAvailableBytes: 1 * GiB };
    await guard.check();
    const failing = new ResourceGuard({
      readSystem: () => Promise.reject(new Error('Docker is not running')),
      readFlowcanvasDisk: () => Promise.resolve(0),
      cleanUp: () => Promise.resolve([]),
      log: (line) => lines.push(line),
    });
    expect(await failing.check()).toEqual([]);
    expect(await failing.check()).toEqual([]);
    expect(lines.filter((line) => line.startsWith("guard: couldn't measure"))).toHaveLength(1);
    expect(kinds(guard.current())).toEqual(['memory']);
  });
});

describe('removeOldImages', () => {
  it("removes our old image tags only, keeps the current one, and skips one that's still used", async () => {
    const commands: string[] = [];
    const docker: Docker = (args) => {
      commands.push(args.join(' '));
      if (args[0] === 'image' && args[1] === 'ls') {
        return Promise.resolve({
          stdout: [
            'flowcanvas-workspace:aaaaaaaaaaaa',
            'flowcanvas-workspace:bbbbbbbbbbbb',
            'flowcanvas-workspace:cccccccccccc',
          ].join('\n'),
          stderr: '',
        });
      }
      if (args[0] === 'image' && args[1] === 'rm' && args[2]?.endsWith('bbbbbbbbbbbb') === true) {
        return Promise.reject(new Error('image is being used by stopped container'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    };
    expect(await removeOldImages(docker, 'flowcanvas-workspace:cccccccccccc')).toEqual([
      'flowcanvas-workspace:aaaaaaaaaaaa',
    ]);
    // Never a container, network or volume: those hold people's work.
    expect(commands.filter((c) => /^(rm|network rm|volume rm)/.test(c))).toEqual([]);
    expect(commands.filter((c) => c.startsWith('image rm'))).toEqual([
      'image rm flowcanvas-workspace:aaaaaaaaaaaa',
      'image rm flowcanvas-workspace:bbbbbbbbbbbb',
    ]);
  });
});
