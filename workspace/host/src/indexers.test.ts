// The host's engine connections: against the real built engine as a local process (no Docker), and against
// fake processes that answer wrongly, since the workspace is untrusted.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostError } from './errors.js';
import { ENGINE_MESSAGES, Indexers, type StartEngine } from './indexers.js';
import type { WorkspaceProcess } from './lines.js';

let root: string;
let started: number;
let processes: WorkspaceProcess[];

/** The built engine with `root` as its project and an index in memory, as main.js runs in a workspace. */
const local: StartEngine = () => {
  started += 1;
  const engine = import.meta.resolve('@flowcanvas/engine');
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { IndexStore, Indexer } from ${JSON.stringify(engine)};
       import { startEngineService } from ${JSON.stringify(engine.replace(/index\.js$/, 'service.js'))};
       import { serveEngine } from ${JSON.stringify(engine.replace(/index\.js$/, 'serve.js'))};
       const store = new IndexStore(':memory:');
       const indexer = new Indexer({ root: ${JSON.stringify(root)}, store });
       const service = startEngineService({
         store, indexer,
         listFiles: async () => ['poll.ts'],
         watch: async () => ({ close() {} }),
       });
       await serveEngine(service, process.stdin, process.stdout);`,
    ],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const engineProcess: WorkspaceProcess = {
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => child.kill(),
    onExit: (listener) => child.on('exit', listener),
  };
  processes.push(engineProcess);
  return Promise.resolve(engineProcess);
};

/** A process that answers every request with `answer(body)`; `null` means no answer at all. */
function fake(answer: (request: { op: string }) => unknown): StartEngine {
  return () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const listeners: (() => void)[] = [];
    stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const { v, id, body } = JSON.parse(line) as { v: number; id: number; body: { op: string } };
        const reply = answer(body);
        if (reply !== null) stdout.write(`${JSON.stringify({ v, id, body: reply })}\n`);
      }
    });
    const fakeProcess: WorkspaceProcess = {
      stdin,
      stdout,
      kill: () => {
        for (const listener of listeners) listener();
      },
      onExit: (listener) => listeners.push(listener),
    };
    processes.push(fakeProcess);
    return Promise.resolve(fakeProcess);
  };
}
const hello = { ok: true, result: { protocol: 1 } };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fc-indexers-'));
  await writeFile(join(root, 'poll.ts'), 'export function createPoll() {}\n');
  started = 0;
  processes = [];
});

afterEach(async () => {
  for (const engineProcess of processes) engineProcess.kill();
  await rm(root, { recursive: true, force: true });
});

describe('Indexers', () => {
  it('starts the engine once, and searches what it indexed', async () => {
    const indexers = new Indexers(local);
    let status;
    do {
      status = await indexers.call('ws', { op: 'status' });
    } while (status.ok && 'byStatus' in status.result && status.result.state !== 'ready');
    expect(status).toMatchObject({ ok: true, result: { state: 'ready', files: 1, symbols: 1 } });
    expect(await indexers.call('ws', { op: 'search', query: 'poll', limit: 5 })).toMatchObject({
      ok: true,
      result: { symbols: [{ name: 'createPoll', path: 'poll.ts', line: 1, column: 17 }] },
    });
    expect(started).toBe(1);
  });

  it('refuses an engine that speaks another protocol', async () => {
    const indexers = new Indexers(fake(() => ({ ok: true, result: { protocol: 2 } })));
    await expect(indexers.call('ws', { op: 'status' })).rejects.toEqual(
      new HostError('failed', ENGINE_MESSAGES.wrongVersion),
    );
  });

  it('refuses an answer that isn’t a valid one, such as a path outside the project', async () => {
    const indexers = new Indexers(
      fake((request) =>
        request.op === 'hello'
          ? hello
          : {
              ok: true,
              result: {
                ms: 1,
                symbols: [
                  {
                    path: '/etc/passwd',
                    name: 'root',
                    kind: 'function',
                    container: null,
                    line: 1,
                    column: 1,
                    exported: false,
                  },
                ],
              },
            },
      ),
    );
    await expect(indexers.call('ws', { op: 'search', query: 'r', limit: 5 })).rejects.toEqual(
      new HostError('failed', ENGINE_MESSAGES.badAnswer),
    );
  });

  it('says the index stopped when the engine ends, and starts it again next time', async () => {
    let calls = 0;
    const indexers = new Indexers(
      fake((request) => {
        calls += 1;
        return request.op === 'hello' ? hello : null;
      }),
    );
    const pending = indexers.call('ws', { op: 'status' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    processes.at(-1)?.kill();
    await expect(pending).rejects.toEqual(new HostError('failed', ENGINE_MESSAGES.stopped));
    const again = indexers.call('ws', { op: 'status' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(processes).toHaveLength(2);
    expect(calls).toBe(4);
    processes.at(-1)?.kill();
    await expect(again).rejects.toEqual(new HostError('failed', ENGINE_MESSAGES.stopped));
  });
});
