// The engine's side of the semantic worker (ADR 0026 §1): started on the first question, with a heap cap; questions
// answered by id; a worker that runs out of memory or fails ends only itself, and the next question starts another.
import { Worker } from 'node:worker_threads';
import type {
  CallsResult,
  CodePosition,
  DefinitionResult,
  DetailsResult,
  EngineResults,
  ReferencesResult,
  SemanticOp,
} from '../protocol.js';
import type { FromWorker, GraphWire, ToWorker, WorkerStart } from './worker.js';

/** The heap cap for the worker, in MB: the workspace has 4 GiB, and the indexer and SQLite need the rest. */
export const WORKER_HEAP_MB = 2500;
/** A question that takes longer than this is answered with a "too slow" message rather than left hanging. */
export const ANSWER_TIMEOUT_MS = 60_000;
/** A whole-project graph pass: about a minute for Twenty on the laptop (ADR 0027), slower on a workspace's CPUs. */
export const GRAPH_TIMEOUT_MS = 15 * 60_000;

export const SEMANTIC_MESSAGES = {
  tooLarge: 'This project is too large to resolve calls in here. Search and the code still work.',
  failed: 'TypeScript couldn’t answer that. Try again, or reopen the project.',
  slow: 'TypeScript took too long to answer. Try again in a moment.',
} as const;

/** Why there's no new graph, in words safe to show. */
export const GRAPH_FAILED = {
  tooLarge: 'This project is too large to analyse here. Search and the code still work.',
  failed: 'The graph couldn’t be built. It’s tried again after the next change.',
  slow: 'Building the graph took too long. It’s tried again after the next change.',
} as const;

const graphFailure = (reason: string) => ({
  failed:
    reason === SEMANTIC_MESSAGES.tooLarge
      ? GRAPH_FAILED.tooLarge
      : reason === SEMANTIC_MESSAGES.slow
        ? GRAPH_FAILED.slow
        : GRAPH_FAILED.failed,
});

/** What the client needs from a worker; tests pass a fake. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  on(event: 'message', listener: (message: FromWorker) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  terminate(): Promise<number>;
}

export type StartWorker = (start: WorkerStart) => WorkerLike;

/** A real worker thread from `workerUrl`, with the heap cap. */
export function threadWorker(workerUrl: URL): StartWorker {
  return (start) =>
    new Worker(workerUrl, {
      workerData: start,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
}

type Answer<Op extends SemanticOp> = EngineResults[Op];

interface Pending {
  readonly resolve: (result: unknown) => void;
  /** What to answer when the worker can't: an empty answer for a question, a failure for a graph. */
  readonly fail: (reason: string) => unknown;
  readonly timer: NodeJS.Timeout;
}

export interface SemanticClientOptions {
  readonly root: string;
  readonly typescriptPath: string;
  /** Where the pass stores each file's units and details (phase 7, `FactsStore`). */
  readonly factsFile?: string;
  readonly start: StartWorker;
  /** The project's files at the moment the worker starts (the agent's list). */
  readonly listFiles: () => Promise<readonly string[]>;
  readonly timeoutMs?: number;
  readonly graphTimeoutMs?: number;
}

export class SemanticClient {
  readonly #options: SemanticClientOptions;
  #worker: Promise<WorkerLike> | undefined;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  /** Why the last worker ended, said in place of answers it couldn't give. */
  #ended: string | undefined;

  constructor(options: SemanticClientOptions) {
    this.#options = options;
  }

  ask<Op extends SemanticOp>(op: Op, position: CodePosition): Promise<Answer<Op>> {
    return this.#ask(op, position) as Promise<Answer<Op>>;
  }

  #ask(op: SemanticOp, position: CodePosition): Promise<unknown> {
    return this.#send(
      (id) => ({ type: 'ask', id, op, ...position }),
      (reason) => emptyAnswer(op, reason),
      this.#options.timeoutMs ?? ANSWER_TIMEOUT_MS,
    );
  }

  /** The graph id of the code unit at a place (phase 7): null when it isn't in a TypeScript or JavaScript file. */
  unit(position: CodePosition): Promise<string | null | { readonly failed: string }> {
    return this.#send(
      (id) => ({ type: 'unit', id, ...position }),
      (reason) => ({ failed: reason }),
      this.#options.timeoutMs ?? ANSWER_TIMEOUT_MS,
    ) as Promise<string | null | { readonly failed: string }>;
  }

  /** A graph pass (ADR 0027): the whole project the first time, then what changed since. */
  graph(): Promise<GraphWire | { readonly failed: string }> {
    return this.#send(
      (id) => ({ type: 'graph', id }),
      graphFailure,
      this.#options.graphTimeoutMs ?? GRAPH_TIMEOUT_MS,
    ) as Promise<GraphWire | { readonly failed: string }>;
  }

  async #send(
    message: (id: number) => ToWorker,
    fail: (reason: string) => unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const worker = await this.#start();
    const id = this.#nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve(fail(SEMANTIC_MESSAGES.slow));
      }, timeoutMs);
      this.#pending.set(id, { resolve, fail, timer });
      worker.postMessage(message(id));
    });
  }

  /** Files changed in the project: a running worker re-checks them; one not yet started will read them anyway. */
  changed(paths: readonly string[], files?: readonly string[]): void {
    void this.#worker?.then(
      (worker) => {
        worker.postMessage({ type: 'changed', paths, ...(files === undefined ? {} : { files }) });
      },
      () => undefined,
    );
  }

  async close(): Promise<void> {
    const worker = await this.#worker?.catch(() => undefined);
    this.#worker = undefined;
    await worker?.terminate();
  }

  #start(): Promise<WorkerLike> {
    this.#worker ??= (async () => {
      const files = await this.#options.listFiles();
      const worker = this.#options.start({
        root: this.#options.root,
        files,
        typescriptPath: this.#options.typescriptPath,
        ...(this.#options.factsFile === undefined ? {} : { factsFile: this.#options.factsFile }),
      });
      this.#ended = undefined;
      worker.on('message', (message) => {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve(
          message.type === 'answer' ? message.result : pending.fail(SEMANTIC_MESSAGES.failed),
        );
      });
      const ended = (reason: string) => {
        this.#ended = reason;
        this.#worker = undefined;
        for (const [id, pending] of this.#pending) {
          clearTimeout(pending.timer);
          pending.resolve(pending.fail(reason));
          this.#pending.delete(id);
        }
      };
      // ERR_WORKER_OUT_OF_MEMORY arrives as an error, then the exit.
      worker.on('error', (error) => {
        ended(
          (error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? SEMANTIC_MESSAGES.tooLarge
            : SEMANTIC_MESSAGES.failed,
        );
      });
      worker.on('exit', () => {
        ended(this.#ended ?? SEMANTIC_MESSAGES.failed);
      });
      return worker;
    })();
    return this.#worker;
  }
}

/** An answer with nothing in it, saying why: the shapes the protocol's checks accept. */
export function emptyAnswer(op: SemanticOp, message: string): unknown {
  switch (op) {
    case 'definition':
      return { definitions: [], message } satisfies DefinitionResult;
    case 'references':
      return { target: null, references: [], complete: false, message } satisfies ReferencesResult;
    case 'callers':
    case 'callees':
      return { target: null, entries: [], complete: false, message } satisfies CallsResult;
    case 'details':
      return { details: null, message } satisfies DetailsResult;
  }
}
