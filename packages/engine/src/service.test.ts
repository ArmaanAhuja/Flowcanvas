import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { WatchEvent } from '@flowcanvas/workspace-agent/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Indexer } from './indexer.js';
import type { EngineStatus, SearchResult } from './protocol.js';
import { serveEngine } from './serve.js';
import {
  INDEXING_FAILED,
  NOT_FOLLOWING,
  startEngineService,
  type EngineService,
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
