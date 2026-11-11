// The engine's side of the semantic worker (ADR 0026 §1): started on the first question, with a heap cap; questions
// answered by id; a worker that runs out of memory or fails ends only itself, and the next question starts another.
import { Worker } from 'node:worker_threads';
import type {
  CallsResult,
  CodePosition,
  DefinitionResult,
  EngineResults,
  ReferencesResult,
  SemanticOp,
} from '../protocol.js';
import type { FromWorker, ToWorker, WorkerStart } from './worker.js';

/** The heap cap for the worker, in MB: the workspace has 4 GiB, and the indexer and SQLite need the rest. */
export const WORKER_HEAP_MB = 2500;
/** A question that takes longer than this is answered with a "too slow" message rather than left hanging. */
export const ANSWER_TIMEOUT_MS = 60_000;

export const SEMANTIC_MESSAGES = {
  tooLarge: 'This project is too large to resolve calls in here. Search and the code still work.',
  failed: 'TypeScript couldn’t answer that. Try again, or reopen the project.',
  slow: 'TypeScript took too long to answer. Try again in a moment.',
} as const;

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
  readonly op: SemanticOp;
  readonly resolve: (result: unknown) => void;
  readonly timer: NodeJS.Timeout;
}

export interface SemanticClientOptions {
  readonly root: string;
  readonly typescriptPath: string;
  readonly start: StartWorker;
  /** The project's files at the moment the worker starts (the agent's list). */
  readonly listFiles: () => Promise<readonly string[]>;
  readonly timeoutMs?: number;
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

  async #ask(op: SemanticOp, position: CodePosition): Promise<unknown> {
    const worker = await this.#start();
    const id = this.#nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve(emptyAnswer(op, SEMANTIC_MESSAGES.slow));
      }, this.#options.timeoutMs ?? ANSWER_TIMEOUT_MS);
      this.#pending.set(id, { op, resolve, timer });
      worker.postMessage({ type: 'ask', id, op, ...position });
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
      });
      this.#ended = undefined;
      worker.on('message', (message) => {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve(
          message.type === 'answer'
            ? message.result
            : emptyAnswer(pending.op, SEMANTIC_MESSAGES.failed),
        );
      });
      const ended = (reason: string) => {
        this.#ended = reason;
        this.#worker = undefined;
        for (const [id, pending] of this.#pending) {
          clearTimeout(pending.timer);
          pending.resolve(emptyAnswer(pending.op, reason));
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
  }
}
