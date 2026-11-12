import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { WatchEvent } from '@flowcanvas/workspace-agent/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Indexer } from './indexer.js';
import type { EngineStatus, SearchResult } from './protocol.js';
import { serveEngine } from './serve.js';
import { encodeGraph, type Graph } from '@flowcanvas/graph-model';
import { GRAPH_FAILED } from './semantics/client.js';
import { SnapshotStore } from './snapshots.js';
import type { GraphStatus } from './protocol.js';
import {
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
