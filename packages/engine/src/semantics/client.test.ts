// The semantic worker's client, with a fake worker: started on the first question only, answers matched by id, and
// a worker that runs out of memory ends only itself, with an honest answer and a fresh worker next time.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { GRAPH_FAILED, SEMANTIC_MESSAGES, SemanticClient, type WorkerLike } from './client.js';
import type { FromWorker, ToWorker, WorkerStart } from './worker.js';

class FakeWorker extends EventEmitter implements WorkerLike {
  readonly received: ToWorker[] = [];
  constructor(readonly start: WorkerStart) {
    super();
  }
  postMessage(message: ToWorker): void {
    this.received.push(message);
  }
  reply(message: FromWorker): void {
    this.emit('message', message);
  }
  terminate(): Promise<number> {
    this.emit('exit', 1);
    return Promise.resolve(1);
  }
}

function setup(timeoutMs = 5000, graphTimeoutMs = 5000) {
  const workers: FakeWorker[] = [];
  const listFiles = vi.fn(() => Promise.resolve(['src/a.ts']));
  const client = new SemanticClient({
    root: '/workspace/project',
    typescriptPath: '/engine/typescript/typescript.js',
    listFiles,
    timeoutMs,
    graphTimeoutMs,
    start: (start) => {
      const worker = new FakeWorker(start);
      workers.push(worker);
      return worker;
    },
  });
  return { client, workers, listFiles };
}

const at = { path: 'src/a.ts', line: 3, column: 17 };
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('SemanticClient', () => {
  it('starts the worker on the first question, with the files and where TypeScript is', async () => {
    const { client, workers, listFiles } = setup();
    expect(workers).toHaveLength(0);
    const answer = client.ask('callers', at);
    await tick();
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(workers[0]?.start).toEqual({
      root: '/workspace/project',
      files: ['src/a.ts'],
      typescriptPath: '/engine/typescript/typescript.js',
    });
    const asked = workers[0]?.received[0];
    expect(asked).toEqual({ type: 'ask', id: 1, op: 'callers', ...at });
    workers[0]?.reply({ type: 'answer', id: 1, result: { target: null, entries: [] } });
    expect(await answer).toEqual({ target: null, entries: [] });
  });

  it('matches answers to questions by id, whatever order they come back in', async () => {
    const { client, workers } = setup();
    const first = client.ask('definition', at);
    const second = client.ask('references', at);
    await tick();
    workers[0]?.reply({ type: 'answer', id: 2, result: 'second' });
    workers[0]?.reply({ type: 'answer', id: 1, result: 'first' });
    expect([await first, await second]).toEqual(['first', 'second']);
    expect(workers).toHaveLength(1);
  });

  it('answers honestly when the worker runs out of memory, and starts a fresh one next time', async () => {
    const { client, workers } = setup();
    const waiting = client.ask('callers', at);
    await tick();
    workers[0]?.emit(
      'error',
      Object.assign(new Error('heap'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }),
    );
    workers[0]?.emit('exit', 1);
    expect(await waiting).toEqual({
      target: null,
      entries: [],
      complete: false,
      message: SEMANTIC_MESSAGES.tooLarge,
    });
    const again = client.ask('callees', at);
    await tick();
    expect(workers).toHaveLength(2);
    workers[1]?.reply({ type: 'answer', id: 2, result: 'fresh' });
    expect(await again).toBe('fresh');
  });

  it('says so when the worker fails a question, without the error', async () => {
    const { client, workers } = setup();
    const answer = client.ask('definition', at);
    await tick();
    workers[0]?.reply({ type: 'failed', id: 1 });
    expect(await answer).toEqual({ definitions: [], message: SEMANTIC_MESSAGES.failed });
  });

  it('answers "too slow" rather than hanging', async () => {
    const { client } = setup(20);
    expect(await client.ask('references', at)).toEqual({
      target: null,
      references: [],
      complete: false,
      message: SEMANTIC_MESSAGES.slow,
    });
  });

  it('passes changes to a running worker, and none to one not started', async () => {
    const { client, workers } = setup();
    client.changed(['src/a.ts']);
    await tick();
    expect(workers).toHaveLength(0);
    void client.ask('callers', at);
    await tick();
    client.changed(['src/a.ts'], ['src/a.ts', 'src/b.ts']);
    await tick();
    expect(workers[0]?.received.at(-1)).toEqual({
      type: 'changed',
      paths: ['src/a.ts'],
      files: ['src/a.ts', 'src/b.ts'],
    });
  });
});

describe('SemanticClient.graph (phase 6)', () => {
  const wire = { encoded: '{"format":1}', files: 3, builtInCalls: 1, complete: true, note: null };

  it('asks the worker for a graph pass and passes its result on', async () => {
    const { client, workers } = setup();
    const pending = client.graph();
    await tick();
    const worker = workers[0];
    if (worker === undefined) throw new Error('no worker');
    const asked = worker.received[0];
    expect(asked).toEqual({ type: 'graph', id: expect.any(Number) as unknown });
    worker.reply({ type: 'answer', id: (asked as { id: number }).id, result: wire });
    expect(await pending).toEqual(wire);
  });

  it('says why in its own words when the pass fails, runs out of memory, or takes too long', async () => {
    const failing = setup();
    const failed = failing.client.graph();
    await tick();
    failing.workers[0]?.reply({ type: 'failed', id: 1 });
    expect(await failed).toEqual({ failed: GRAPH_FAILED.failed });

    const large = setup();
    const tooLarge = large.client.graph();
    await tick();
    const error = Object.assign(new Error('out of memory'), { code: 'ERR_WORKER_OUT_OF_MEMORY' });
    large.workers[0]?.emit('error', error);
    expect(await tooLarge).toEqual({ failed: GRAPH_FAILED.tooLarge });

    const slow = setup(5000, 20);
    expect(await slow.client.graph()).toEqual({ failed: GRAPH_FAILED.slow });
    // A question still gets its own words.
    const asking = setup(20);
    expect(await asking.client.ask('callers', at)).toMatchObject({
      message: SEMANTIC_MESSAGES.slow,
    });
  });
});
