import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { WatchEvent } from '@flowcanvas/workspace-agent/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Indexer } from './indexer.js';
import {
  isEngineResponse,
  type EngineStatus,
  type EntryPointsResult,
  type FlowResult,
  type SearchResult,
} from './protocol.js';
import { serveEngine } from './serve.js';
import { FLOW_LIMITS, encodeGraph, indexGraph, type Graph } from '@flowcanvas/graph-model';
import { GRAPH_FAILED } from './semantics/client.js';
import { listedEntries } from './semantics/graph.js';
import { SnapshotStore } from './snapshots.js';
import type { GraphStatus, NodeDetails } from './protocol.js';
import {
  ENTRY_POINT_MESSAGES,
  FLOW_MESSAGES,
  fittingFlow,
  INDEXING_FAILED,
  NO_GRAPH,
  NO_SEMANTICS,
  NOT_FOLLOWING,
  startEngineService,
  type EngineService,
  type Semantics,
} from './service.js';
import { IndexStore } from './store.js';

let root: string;
let store: IndexStore;
let indexer: Indexer;
let files: string[];
let emit: (event: WatchEvent) => void;
let watcherClosed: boolean;
let service: EngineService;

const write = (path: string, content: string) => {
  writeFileSync(join(root, path), content);
};
const status = async () => (await service.handle({ op: 'status' })) as EngineStatus;
const names = async (query: string) =>
  ((await service.handle({ op: 'search', query, limit: 50 })) as SearchResult).symbols.map(
    (s) => s.name,
  );

function start(overrides: Partial<Parameters<typeof startEngineService>[0]> = {}) {
  service = startEngineService({
    store,
    indexer,
    listFiles: () => Promise.resolve(files),
    watch: (send) => {
      emit = send;
      return Promise.resolve({
        close: () => {
          watcherClosed = true;
        },
      });
    },
    refreshDelayMs: 10,
    ...overrides,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'flowcanvas-service-'));
  store = new IndexStore(':memory:');
  indexer = new Indexer({ root, store });
  files = [];
  watcherClosed = false;
});
afterEach(async () => {
  service.close();
  await indexer.close();
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('the engine service', () => {
  it('starts, indexes everything, and then says it is ready', async () => {
    write('poll.ts', 'export function createPoll() {}');
    write('README.md', '# Rallly');
    write('schema.prisma', 'model Poll {}');
    files = ['poll.ts', 'README.md', 'schema.prisma'];
    start();
    expect((await status()).state).toBe('starting');
    await service.settled();
    expect(await status()).toMatchObject({
      state: 'ready',
      done: 3,
      total: 3,
      files: 3,
      symbols: 2,
      byStatus: { parsed: 2, 'no-grammar': 1 },
      message: null,
    });
    expect((await status()).lastFullMs).toEqual(expect.any(Number));
    expect(await names('poll')).toEqual(['createPoll']);
  });

  it('re-indexes the files the watcher reports, gathered into one refresh', async () => {
    write('a.ts', 'export function first() {}');
    files = ['a.ts'];
    start();
    await service.settled();
    const refresh = vi.spyOn(indexer, 'refresh');

    write('a.ts', 'export function renamed() {}');
    write('b.ts', 'export function added() {}');
    emit({ type: 'changed', path: 'a.ts', deleted: false, version: null });
    emit({ type: 'changed', path: 'b.ts', deleted: false, version: null });
    emit({ type: 'changed', path: 'a.ts', deleted: false, version: null });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await service.settled();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await names('e')).toEqual(['added', 'renamed']);
  });

  it('forgets a deleted file', async () => {
    write('a.ts', 'export function gone() {}');
    files = ['a.ts'];
    start();
    await service.settled();
    rmSync(join(root, 'a.ts'));
    emit({ type: 'changed', path: 'a.ts', deleted: true, version: null });
    await service.settled();
    expect(await names('gone')).toEqual([]);
  });

  it('looks at everything again after an overflow', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    start();
    await service.settled();
    write('b.ts', 'export function two() {}');
    files = ['a.ts', 'b.ts'];
    emit({ type: 'overflow' });
    await service.settled();
    expect(await names('two')).toEqual(['two']);
  });

  it('says so when indexing fails, without the error’s details', async () => {
    start({ listFiles: () => Promise.reject(new Error('/workspace/project/.env: secret')) });
    await service.settled();
    expect(await status()).toMatchObject({ state: 'failed', message: INDEXING_FAILED });
  });

  it('says so when changes can’t be followed, and stays searchable', async () => {
    write('a.ts', 'export function kept() {}');
    files = ['a.ts'];
    start({ watch: () => Promise.reject(new Error('no inotify')) });
    await service.settled();
    expect(await status()).toMatchObject({ state: 'ready', message: NOT_FOLLOWING });
    expect(await names('kept')).toEqual(['kept']);
  });

  it('starts the watcher before the full pass, so no edit falls between them', async () => {
    let watcherUp: (() => void) | undefined;
    const listFiles = vi.fn(() => Promise.resolve(files));
    start({
      listFiles,
      watch: (send) => {
        emit = send;
        return new Promise((resolve) => {
          watcherUp = () => {
            resolve({ close: () => undefined });
          };
        });
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listFiles).not.toHaveBeenCalled();
    expect((await status()).state).toBe('starting');
    watcherUp?.();
    await service.settled();
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect((await status()).state).toBe('ready');
  });

  it('stops watching when closed', async () => {
    start();
    await service.settled();
    service.close();
    expect(watcherClosed).toBe(true);
  });
});

describe('TypeScript’s answers (phase 5)', () => {
  const at = { path: 'a.ts', line: 1, column: 17 };

  it('passes the four questions to the semantic worker', async () => {
    const ask = vi.fn<(op: string, position: unknown) => Promise<unknown>>((op) =>
      Promise.resolve({ asked: op }),
    );
    start({
      semantics: { ask, changed: vi.fn(), close: () => Promise.resolve() } as unknown as Semantics,
    });
    for (const op of ['definition', 'references', 'callers', 'callees'] as const) {
      expect(await service.handle({ op, ...at })).toEqual({ asked: op });
    }
    expect(ask.mock.calls.map(([op, position]) => [op, position])).toEqual([
      ['definition', at],
      ['references', at],
      ['callers', at],
      ['callees', at],
    ]);
  });

  it('says so when there is no semantic worker', async () => {
    start();
    expect(await service.handle({ op: 'callers', ...at })).toEqual({
      target: null,
      entries: [],
      complete: false,
      message: NO_SEMANTICS,
    });
  });

  it('tells the semantic worker about changes, with the fresh file list', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    const changed = vi.fn();
    start({
      semantics: { ask: vi.fn(), changed, close: () => Promise.resolve() } as unknown as Semantics,
    });
    await service.settled();
    write('b.ts', 'export function two() {}');
    files = ['a.ts', 'b.ts'];
    emit({ type: 'changed', path: 'b.ts', deleted: false, version: null });
    await service.settled();
    expect(changed).toHaveBeenCalledWith(['b.ts'], ['a.ts', 'b.ts']);
    emit({ type: 'overflow' });
    await service.settled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(changed).toHaveBeenLastCalledWith([], ['a.ts', 'b.ts']);
  });

  it('tells it at once about a file it knows, without listing the project again (phase 4 of build plan v2)', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    const changed = vi.fn();
    const listFiles = vi.fn(() => Promise.resolve(files));
    start({
      listFiles,
      semantics: { ask: vi.fn(), changed, close: () => Promise.resolve() } as unknown as Semantics,
    });
    await service.settled();
    const listed = listFiles.mock.calls.length;
    write('a.ts', 'export function one() { return 1; }');
    emit({ type: 'changed', path: 'a.ts', deleted: false, version: null });
    await service.settled();
    expect(changed).toHaveBeenLastCalledWith(['a.ts']);
    expect(listFiles).toHaveBeenCalledTimes(listed);
    // Gone: the list is read again, and the worker gets it.
    files = [];
    emit({ type: 'changed', path: 'a.ts', deleted: true, version: null });
    await service.settled();
    expect(changed).toHaveBeenLastCalledWith(['a.ts'], []);
  });
});

describe('the flow graph (phase 6)', () => {
  const graphOf = (...names: string[]): Graph => ({
    nodes: names.map((name) => ({
      id: `a.ts#${name}`,
      kind: 'code-unit' as const,
      name,
      place: { path: 'a.ts', line: 1, column: 17 },
      unit: 'function' as const,
      change: 'unchanged' as const,
    })),
    edges: [],
  });
  const wire = (graph: Graph) => ({
    encoded: encodeGraph(graph),
    files: 1,
    builtInCalls: 2,
    complete: true,
    note: null,
  });
  const graphStatus = async () => (await service.handle({ op: 'graph' })) as GraphStatus;
  const semanticsWith = (graph: () => Promise<unknown>) =>
    ({
      ask: vi.fn(),
      changed: vi.fn(),
      graph,
      close: () => Promise.resolve(),
    }) as unknown as Semantics;

  it('says so where there is no graph', async () => {
    start();
    expect(await graphStatus()).toEqual({ state: 'failed', message: NO_GRAPH, snapshot: null });
  });

  it('builds the graph once the index is ready, saves it, and says how long saving and loading took', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    const graph = vi.fn(() => Promise.resolve(wire(graphOf('one'))));
    start({ semantics: semanticsWith(graph), snapshots: new SnapshotStore(':memory:') });
    await service.settled();
    await service.graphSettled();
    const now = await graphStatus();
    expect(graph).toHaveBeenCalledTimes(1);
    expect(now).toMatchObject({ state: 'ready', message: null });
    expect(now.snapshot).toMatchObject({
      version: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      complete: true,
      files: 1,
      builtInCalls: 2,
      stats: { nodes: 1, edges: 0, byNodeKind: { 'code-unit': 1, 'entry-point': 0 } },
    });
    for (const ms of [now.snapshot?.buildMs, now.snapshot?.saveMs, now.snapshot?.loadMs]) {
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('brings it up to date once changes settle: one more pass for a burst, never two at once', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    let running = 0;
    let most = 0;
    const graph = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return wire(graphOf('one', `v${String(graph.mock.calls.length)}`));
    });
    start({
      semantics: semanticsWith(graph),
      snapshots: new SnapshotStore(':memory:'),
      graphDelayMs: 30,
    });
    await service.settled();
    await service.graphSettled();
    for (const path of ['a.ts', 'b.ts', 'c.ts']) {
      emit({ type: 'changed', path, deleted: false, version: null });
    }
    await service.settled();
    await service.graphSettled();
    expect(graph).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
    expect((await graphStatus()).snapshot?.stats.nodes).toBe(2);
  });

  it('runs a change made during a pass once more after it, never alongside', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    let running = 0;
    let most = 0;
    // The first pass stays running until the test lets it finish: what's seen meanwhile doesn't depend on the
    // machine's speed (with a fixed 80 ms pass, a busy machine finished it before the change was checked).
    let finishFirst: () => void = () => undefined;
    const firstHeld = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const graph = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      if (graph.mock.calls.length === 1) await firstHeld;
      running -= 1;
      return wire(graphOf('one'));
    });
    start({
      semantics: semanticsWith(graph),
      snapshots: new SnapshotStore(':memory:'),
      graphDelayMs: 1,
    });
    await service.settled();
    await vi.waitFor(async () => {
      expect((await graphStatus()).state).toBe('building');
    });
    // Indexed and due for the graph while the first pass is still running: it waits for that pass.
    emit({ type: 'changed', path: 'a.ts', deleted: false, version: null });
    await service.settled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(graph).toHaveBeenCalledTimes(1);
    finishFirst();
    await service.graphSettled();
    expect(graph).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
  });

  it('says why a pass failed, and keeps showing the last good version', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    const answers: unknown[] = [wire(graphOf('one')), { failed: GRAPH_FAILED.tooLarge }];
    start({
      semantics: semanticsWith(() => Promise.resolve(answers.shift())),
      snapshots: new SnapshotStore(':memory:'),
      graphDelayMs: 5,
    });
    await service.settled();
    await service.graphSettled();
    const good = (await graphStatus()).snapshot;
    emit({ type: 'changed', path: 'a.ts', deleted: false, version: null });
    await service.settled();
    await service.graphSettled();
    expect(await graphStatus()).toEqual({
      state: 'failed',
      message: GRAPH_FAILED.tooLarge,
      snapshot: good,
    });
  });

  it('shows the last version from before a restart while the first new pass runs', async () => {
    write('a.ts', 'export function one() {}');
    files = ['a.ts'];
    const snapshots = new SnapshotStore(':memory:');
    start({ semantics: semanticsWith(() => Promise.resolve(wire(graphOf('one')))), snapshots });
    await service.settled();
    await service.graphSettled();
    const before = (await graphStatus()).snapshot;
    service.close();
    // The new pass never ends here: what's shown meanwhile is the stored version.
    start({ semantics: semanticsWith(() => new Promise(() => undefined)), snapshots });
    // Shown from the start, while waiting for the index and then while the pass runs.
    expect((await graphStatus()).snapshot).toMatchObject({ version: before?.version });
    await service.settled();
    await vi.waitFor(async () => {
      expect((await graphStatus()).state).toBe('building');
    });
    expect((await graphStatus()).snapshot).toMatchObject({
      version: before?.version,
      stats: before?.stats,
    });
  });
});

describe('flows (phase 7)', () => {
  // `show` (line 1) calls `load` (line 5); `if (draft)` guards a call to `save` (line 9).
  const graph: Graph = {
    nodes: [
      {
        id: 'a.ts#show',
        kind: 'code-unit',
        name: 'show',
        place: { path: 'a.ts', line: 1, column: 17 },
        unit: 'function',
        change: 'unchanged',
      },
      {
        id: 'a.ts#show?1',
        kind: 'decision',
        name: 'draft',
        place: { path: 'a.ts', line: 3, column: 7 },
        unit: null,
        change: 'unchanged',
      },
      {
        id: 'a.ts#load',
        kind: 'code-unit',
        name: 'load',
        place: { path: 'a.ts', line: 5, column: 17 },
        unit: 'function',
        change: 'unchanged',
      },
      {
        id: 'a.ts#save',
        kind: 'code-unit',
        name: 'save',
        place: { path: 'a.ts', line: 9, column: 17 },
        unit: 'function',
        change: 'unchanged',
      },
    ],
    edges: [
      {
        from: 'a.ts#show',
        to: 'a.ts#load',
        target: null,
        kind: 'call',
        relation: 'calls',
        label: null,
        provenance: 'resolved',
        lines: [2],
      },
      {
        from: 'a.ts#show',
        to: 'a.ts#save',
        target: null,
        kind: 'call',
        relation: 'calls',
        label: null,
        provenance: 'resolved',
        lines: [3],
        // `if (ok) save()`: the pass says every call on line 3 is guarded.
        guarded: [3],
      },
      {
        from: 'a.ts#show',
        to: 'a.ts#show?1',
        target: null,
        kind: 'branch',
        relation: null,
        label: null,
        provenance: 'resolved',
        lines: [3],
      },
      {
        from: 'a.ts#show?1',
        to: 'a.ts#save',
        target: null,
        kind: 'branch',
        relation: 'calls',
        label: 'yes',
        provenance: 'resolved',
        lines: [3],
      },
    ],
  };
  const wire = {
    encoded: encodeGraph(graph),
    files: 1,
    builtInCalls: 0,
    complete: true,
    note: null,
  };
  const semanticsWith = (
    pass: () => Promise<unknown>,
    unit: (position: unknown) => Promise<unknown> = () => Promise.resolve(null),
  ) => {
    const fake = {
      ask: vi.fn(),
      changed: vi.fn(),
      graph: pass,
      unit,
      close: () => Promise.resolve(),
    };
    return fake as unknown as Semantics;
  };
  /** Asks for a flow, and checks the answer as the control plane will (the protocol's own check). */
  const flowAt = async (line: number, column: number): Promise<FlowResult> => {
    const request = { op: 'flow', path: 'a.ts', line, column } as const;
    const result = await service.handle(request);
    expect(isEngineResponse(request, { ok: true, result })).toBe(true);
    return result as FlowResult;
  };
  const ready = async (semantics: Semantics, snapshots = new SnapshotStore(':memory:')) => {
    write('a.ts', 'export function show() {}');
    files = ['a.ts'];
    start({ semantics, snapshots });
    await service.settled();
    await service.graphSettled();
  };

  it('says so where there’s no graph', async () => {
    start();
    expect(await flowAt(1, 17)).toEqual({
      flow: null,
      message: NO_GRAPH,
      version: null,
      takenAt: null,
      current: false,
      complete: false,
    });
  });

  it('opens from a function’s name straight from the graph, decisions included, without asking TypeScript', async () => {
    const unit = vi.fn(() => Promise.resolve(null));
    await ready(semanticsWith(() => Promise.resolve(wire), unit));
    const result = await flowAt(1, 17);
    expect(unit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ message: null, current: true, complete: true });
    expect(result.version).toMatch(/^[0-9a-f]{64}$/);
    expect(result.flow?.nodes.map((n) => n.id)).toEqual([
      'a.ts#show',
      'a.ts#show?1',
      'a.ts#load',
      'a.ts#save',
    ]);
    expect(result.flow?.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['a.ts#show', 'a.ts#show?1', null],
      ['a.ts#show', 'a.ts#load', null],
      ['a.ts#show?1', 'a.ts#save', 'yes'],
    ]);
  });

  it('opens from inside a function: TypeScript says which one', async () => {
    const unit = vi.fn<(position: unknown) => Promise<unknown>>(() => Promise.resolve('a.ts#load'));
    await ready(semanticsWith(() => Promise.resolve(wire), unit));
    const result = await flowAt(6, 3);
    expect(unit).toHaveBeenCalledWith({ path: 'a.ts', line: 6, column: 3 });
    expect(result.flow?.root).toBe('a.ts#load');
  });

  it('says why when there’s no flow to show', async () => {
    const answers: unknown[] = [
      null,
      { failed: 'TypeScript took too long to answer.' },
      'a.ts#gone',
      'a.ts#(top level)',
    ];
    await ready(
      semanticsWith(
        () => Promise.resolve(wire),
        () => Promise.resolve(answers.shift()),
      ),
    );
    expect((await flowAt(2, 1)).message).toBe(FLOW_MESSAGES.notCode);
    expect((await flowAt(2, 1)).message).toBe('TypeScript took too long to answer.');
    expect((await flowAt(2, 1)).message).toBe(FLOW_MESSAGES.notYet);
    expect((await flowAt(2, 1)).message).toBe(FLOW_MESSAGES.noCalls);
  });

  describe('from the facts the pass stored (owner, 13 Nov 2026)', () => {
    const none = { items: [], total: 0 };
    const stored: NodeDetails = {
      id: 'a.ts#load',
      name: 'load',
      unit: 'function',
      place: { path: 'a.ts', line: 5, column: 17 },
      signature: '(): void',
      params: none,
      returns: 'void',
      async: false,
      exported: false,
      decisions: none,
      throws: none,
      awaits: none,
      unresolved: none,
      writes: none,
    };
    const load = { id: 'a.ts#load', start: [5, 1], end: [8, 2], details: stored } as const;
    const factsReader = () => ({
      unitAt: vi.fn((_path: string, line: number) => (line >= 5 ? load : undefined)),
      details: vi.fn((id: string) => (id === 'a.ts#load' ? stored : undefined)),
      forget: vi.fn(),
      units: vi.fn(() => [load]),
      callerFiles: vi.fn(() => []),
    });

    it('opens flows and details from inside a function without asking TypeScript', async () => {
      const facts = factsReader();
      const unit = vi.fn(() => Promise.resolve('a.ts#show'));
      const ask = vi.fn();
      const semantics = { ...semanticsWith(() => Promise.resolve(wire), unit), ask } as Semantics;
      write('a.ts', 'export function show() {}');
      files = ['a.ts'];
      start({ semantics, snapshots: new SnapshotStore(':memory:'), facts });
      await service.settled();
      await service.graphSettled();
      expect((await flowAt(6, 3)).flow?.root).toBe('a.ts#load');
      expect(await service.handle({ op: 'details', path: 'a.ts', line: 6, column: 3 })).toEqual({
        details: stored,
        message: null,
      });
      expect(unit).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
      // A pass that finished: the engine forgets its decoded copies (the worker may have rewritten any file).
      expect(facts.forget).toHaveBeenCalled();
    });

    it('asks TypeScript where the facts have no answer (a file changed since, or not stored yet)', async () => {
      const facts = {
        unitAt: vi.fn(() => undefined),
        details: vi.fn(() => undefined),
        forget: vi.fn(),
        units: vi.fn(() => undefined),
        callerFiles: vi.fn(() => []),
      };
      const unit = vi.fn(() => Promise.resolve('a.ts#show'));
      const ask = vi.fn(() => Promise.resolve({ details: null, message: 'live' }));
      const semantics = { ...semanticsWith(() => Promise.resolve(wire), unit), ask } as Semantics;
      write('a.ts', 'export function show() {}');
      files = ['a.ts'];
      start({ semantics, snapshots: new SnapshotStore(':memory:'), facts });
      await service.settled();
      await service.graphSettled();
      expect((await flowAt(6, 3)).flow?.root).toBe('a.ts#show');
      expect(await service.handle({ op: 'details', path: 'a.ts', line: 6, column: 3 })).toEqual({
        details: null,
        message: 'live',
      });
      expect(facts.unitAt).toHaveBeenCalledWith('a.ts', 6, 3);
      expect(unit).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledWith('details', { path: 'a.ts', line: 6, column: 3 });
    });
  });

  it('shows the last version while the graph catches up, and says so', async () => {
    const snapshots = new SnapshotStore(':memory:');
    await ready(
      semanticsWith(() => Promise.resolve(wire)),
      snapshots,
    );
    const before = await flowAt(1, 17);
    service.close();
    // After a restart, the stored version is there at once; the new pass never ends here.
    start({ semantics: semanticsWith(() => new Promise(() => undefined)), snapshots });
    const during = await flowAt(1, 17);
    expect(during).toMatchObject({ current: false, version: before.version });
    expect(during.flow).toEqual(before.flow);
  });

  it('makes a flow too large to send smaller until it fits, and says so', () => {
    start(); // Every test has a service for afterEach to close.
    // 60 functions each with 20 long unknown calls: about 300 KB at full size.
    const units = Array.from({ length: 61 }, (_, i) => `f${String(i)}`);
    const big: Graph = {
      nodes: units.map((name, i) => ({
        id: `a.ts#${name}`,
        kind: 'code-unit',
        name,
        place: { path: 'a.ts', line: i + 1, column: 1 },
        unit: 'function',
        change: 'unchanged',
      })),
      edges: units.flatMap((name, i) => [
        ...(i === 0
          ? units.slice(1).map((to) => ({
              from: 'a.ts#f0',
              to: `a.ts#${to}`,
              target: null,
              kind: 'call' as const,
              relation: 'calls' as const,
              label: null,
              provenance: 'resolved' as const,
              lines: [1],
            }))
          : []),
        ...Array.from({ length: FLOW_LIMITS.unknown }, (_, n) => ({
          from: `a.ts#${name}`,
          to: null,
          target: `service.${'x'.repeat(100)}${String(n)}`,
          kind: 'call' as const,
          relation: 'calls' as const,
          label: null,
          provenance: 'unknown' as const,
          lines: [i + 1],
        })),
      ]),
    };
    const fitted = fittingFlow(indexGraph(big), 'a.ts#f0');
    expect(fitted?.message).toBe(FLOW_MESSAGES.smaller(30));
    expect(fitted?.flow.nodes).toHaveLength(30);
    // f0 calls the 60 others: 29 of them are shown.
    expect(fitted?.flow.hidden).toBe(31);
    expect(Buffer.byteLength(JSON.stringify(fitted?.flow))).toBeLessThan(256 * 1024 * 0.75);
  });
});

describe('entry points (phase 8)', () => {
  const route = (id: string, name: string, line: number) => ({
    id,
    kind: 'entry-point' as const,
    name,
    place: { path: 'a.ts', line, column: 1 },
    unit: null,
    change: 'unchanged' as const,
    entry: {
      kind: 'api-route' as const,
      framework: 'hono',
      complete: true,
      why: null,
      within: null,
    },
  });
  const graph: Graph = {
    nodes: [
      {
        id: 'a.ts#list',
        kind: 'code-unit',
        name: 'list',
        place: { path: 'a.ts', line: 9, column: 17 },
        unit: 'function',
        change: 'unchanged',
      },
      route('a.ts#(entry POST /polls)', 'POST /polls', 2),
      route('a.ts#(entry GET /polls)', 'GET /polls', 1),
      route('a.ts#(entry DELETE /polls/:id)', 'DELETE /polls/:id', 3),
    ],
    edges: [
      {
        from: 'a.ts#(entry GET /polls)',
        to: 'a.ts#list',
        target: null,
        kind: 'call',
        relation: 'calls',
        label: null,
        provenance: 'convention',
        lines: [1],
      },
    ],
  };
  const ask = async (after: number, limit: number): Promise<EntryPointsResult> => {
    const request = { op: 'entryPoints', kind: 'api-route', after, limit } as const;
    const result = await service.handle(request);
    // Checked as the control plane will.
    expect(isEngineResponse(request, { ok: true, result })).toBe(true);
    return result as EntryPointsResult;
  };

  it('says so before there’s a graph', async () => {
    start();
    expect(await ask(0, 50)).toMatchObject({
      counts: {
        screen: 0,
        element: 0,
        'api-route': 0,
        job: 0,
        cron: 0,
        event: 0,
        'cli-command': 0,
      },
      entries: [],
      next: null,
      message: NO_GRAPH,
    });
    expect(ENTRY_POINT_MESSAGES.noGraph).toContain('graph');
  });

  it('answers a screen’s elements, and gives each screen its count', async () => {
    const screen = {
      ...route('a.ts#(entry /polls)', '/polls', 1),
      entry: {
        kind: 'screen' as const,
        framework: 'next',
        complete: true,
        why: null,
        within: null,
      },
    };
    const element = {
      ...route('a.ts#(entry <button> onClick)', '<button> onClick', 9),
      entry: {
        kind: 'element' as const,
        framework: 'react',
        complete: true,
        why: null,
        within: 'a.ts#list',
      },
    };
    const withScreen: Graph = {
      nodes: [...graph.nodes.slice(0, 1), screen, element],
      edges: [
        {
          from: 'a.ts#(entry /polls)',
          to: 'a.ts#list',
          target: null,
          kind: 'call',
          relation: 'renders',
          label: null,
          provenance: 'convention',
          lines: [1],
        },
      ],
    };
    const snapshots = new SnapshotStore(':memory:');
    snapshots.save(encodeGraph(withScreen), {
      complete: true,
      note: null,
      files: 1,
      builtInCalls: 0,
    });
    start({ snapshots });
    const screens = await service.handle({
      op: 'entryPoints',
      kind: 'screen',
      after: 0,
      limit: 10,
    });
    expect((screens as EntryPointsResult).entries[0]?.elements).toBe(1);
    const request = {
      op: 'entryPoints',
      kind: 'element',
      after: 0,
      limit: 10,
      screen: 'a.ts#(entry /polls)',
    } as const;
    const result = await service.handle(request);
    expect(isEngineResponse(request, { ok: true, result })).toBe(true);
    expect((result as EntryPointsResult).entries.map((e) => e.name)).toEqual(['<button> onClick']);
  });

  it('answers a page of one kind in name order from the latest version, with what handles each', async () => {
    const snapshots = new SnapshotStore(':memory:');
    // A version from before a restart: answered from it until the first pass replaces it.
    snapshots.save(
      encodeGraph(graph),
      { complete: true, note: null, files: 1, builtInCalls: 0 },
      new Date('2026-11-14T10:00:00.000Z'),
    );
    start({ snapshots });
    const first = await ask(0, 2);
    expect(first.counts['api-route']).toBe(3);
    expect(first.entries.map((e) => [e.name, e.handler?.name ?? null])).toEqual([
      ['DELETE /polls/:id', null],
      ['GET /polls', 'list'],
    ]);
    expect(first.next).toBe(2);
    const second = await ask(2, 2);
    expect(second.entries.map((e) => e.name)).toEqual(['POST /polls']);
    expect(second.next).toBeNull();
    expect(second.version).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('serveEngine', () => {
  it('answers each line by id, and refuses what it can’t read', async () => {
    write('a.ts', 'export function createPoll() {}');
    files = ['a.ts'];
    start();
    await service.settled();
    const input = new PassThrough();
    const output = new PassThrough();
    const served = serveEngine(service, input, output);
    const answers: unknown[] = [];
    output.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean))
        answers.push(JSON.parse(line));
    });

    input.write('{"v":1,"id":7,"body":{"op":"search","query":"poll","limit":5}}\n');
    input.write('{"v":1,"id":8,"body":{"op":"search","query":""}}\n');
    input.write('{"v":2,"id":9,"body":{"op":"hello"}}\n');
    input.write('{"v":1,"id":10,"body":{"op":"delete"}}\n');
    input.write('not json\n');
    input.end();
    await served;
    await new Promise((resolve) => setImmediate(resolve));

    expect(answers).toEqual(
      expect.arrayContaining([
        {
          v: 1,
          id: 7,
          body: {
            ok: true,
            result: {
              symbols: [expect.objectContaining({ name: 'createPoll', path: 'a.ts' })],
              ms: expect.any(Number) as number,
            },
          },
        },
        {
          v: 1,
          id: 8,
          body: { ok: true, result: { symbols: [], ms: expect.any(Number) as number } },
        },
        {
          v: 1,
          id: 9,
          body: {
            ok: false,
            error: { code: 'invalid_request', message: 'This engine speaks protocol 1.' },
          },
        },
        {
          v: 1,
          id: 10,
          body: { ok: false, error: { code: 'invalid_request', message: 'Unknown operation.' } },
        },
        {
          v: 1,
          id: 0,
          body: {
            ok: false,
            error: { code: 'invalid_request', message: 'Send one JSON message per line.' },
          },
        },
      ]),
    );
    expect(answers).toHaveLength(5);
  });

  it('describes an unexpected failure without its details', async () => {
    start();
    await service.settled();
    vi.spyOn(store, 'search').mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT at /workspace/.flowcanvas/index.db');
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const served = serveEngine(service, input, output);
    let text = '';
    output.on('data', (chunk: Buffer) => (text += chunk.toString()));
    input.end('{"v":1,"id":3,"body":{"op":"search","query":"x"}}\n');
    await served;
    await new Promise((resolve) => setImmediate(resolve));
    expect(JSON.parse(text)).toEqual({
      v: 1,
      id: 3,
      body: { ok: false, error: { code: 'failed', message: 'The engine couldn’t answer that.' } },
    });
  });
});

describe('a saved edit (phase 4 of build plan v2)', () => {
  const routes = (...names: string[]): Graph => ({
    nodes: names.map((name, i) => ({
      id: `a.ts#(entry ${name})`,
      kind: 'entry-point' as const,
      name,
      place: { path: 'a.ts', line: i + 1, column: 1 },
      unit: null,
      change: 'unchanged' as const,
      entry: {
        kind: 'api-route' as const,
        framework: 'hono',
        complete: true,
        why: null,
        within: null,
      },
    })),
    edges: [],
  });
  const wire = (graph: Graph) => ({
    encoded: encodeGraph(graph),
    files: 1,
    builtInCalls: 0,
    complete: true,
    note: null,
  });
  const listedRoutes = async () => {
    const request = { op: 'entryPoints', kind: 'api-route', after: 0, limit: 50 } as const;
    const result = await service.handle(request);
    expect(isEngineResponse(request, { ok: true, result })).toBe(true);
    const answer = result as EntryPointsResult;
    return { names: answer.entries.map((e) => e.name), current: answer.current };
  };
  const checkedStatus = async () => {
    const result = await status();
    expect(isEngineResponse({ op: 'status' }, { ok: true, result })).toBe(true);
    return result;
  };
  const semanticsWith = (graph: Semantics['graph']) =>
    ({
      ask: vi.fn(),
      changed: vi.fn(),
      graph,
      close: () => Promise.resolve(),
    }) as unknown as Semantics;

  it('lists its entry points ahead of the version, and says analysing until the version is kept', async () => {
    write('a.ts', 'export const app = 1;');
    files = ['a.ts'];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const passes = [routes('GET /polls'), routes('GET /polls', 'POST /polls')];
    let calls = 0;
    start({
      semantics: semanticsWith(async (entries) => {
        const graph = passes[Math.min(calls, passes.length - 1)] ?? routes();
        calls += 1;
        entries?.(listedEntries(graph));
        if (calls === 2) await held;
        return wire(graph);
      }),
      snapshots: new SnapshotStore(':memory:'),
      graphDelayMs: 1,
    });
    await service.settled();
    await service.graphSettled();
    const before = await checkedStatus();
    expect(before.analysing).toBe(false);
    expect(await listedRoutes()).toEqual({ names: ['GET /polls'], current: true });

    // Saved: from now until the new list, what's listed is from before the edit, and never said to be current.
    emit({ type: 'changed', path: 'a.ts', deleted: false, version: null });
    expect((await checkedStatus()).analysing).toBe(true);
    expect(await listedRoutes()).toEqual({ names: ['GET /polls'], current: false });

    // The pass's entry points arrive while its version is still being checked and stored.
    await vi.waitFor(async () => {
      expect((await checkedStatus()).listed).toBeGreaterThan(before.listed);
    });
    expect(await listedRoutes()).toEqual({ names: ['GET /polls', 'POST /polls'], current: true });
    expect((await checkedStatus()).analysing).toBe(true);
    expect(((await service.handle({ op: 'graph' })) as GraphStatus).state).toBe('building');

    release();
    await service.graphSettled();
    expect((await checkedStatus()).analysing).toBe(false);
    expect(await listedRoutes()).toEqual({ names: ['GET /polls', 'POST /polls'], current: true });
  });

  it('goes back to the kept version’s entry points when the pass that listed them fails', async () => {
    write('a.ts', 'export const app = 1;');
    files = ['a.ts'];
    let calls = 0;
    start({
      semantics: semanticsWith((entries) => {
        calls += 1;
        if (calls === 1) {
          entries?.(listedEntries(routes('GET /polls')));
          return Promise.resolve(wire(routes('GET /polls')));
        }
        entries?.(listedEntries(routes('GET /polls', 'POST /polls')));
        return Promise.resolve({ failed: GRAPH_FAILED.failed });
      }),
      snapshots: new SnapshotStore(':memory:'),
      graphDelayMs: 1,
    });
    await service.settled();
    await service.graphSettled();
    emit({ type: 'changed', path: 'a.ts', deleted: false, version: null });
    await service.settled();
    await service.graphSettled();
    // From the version kept before the edit: listed, and not current.
    expect(await listedRoutes()).toEqual({ names: ['GET /polls'], current: false });
  });

  it('says a version kept from before a restart isn’t current until a pass of this session', async () => {
    const snapshots = new SnapshotStore(':memory:');
    snapshots.save(encodeGraph(routes('GET /polls')), {
      complete: true,
      note: null,
      files: 1,
      builtInCalls: 0,
    });
    start({ snapshots });
    expect(await listedRoutes()).toEqual({ names: ['GET /polls'], current: false });
  });
});
