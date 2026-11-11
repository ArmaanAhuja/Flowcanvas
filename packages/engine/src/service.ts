// The engine as a service in the workspace (phase 4 step 3, ADR 0025): a full index when it starts, then
// re-indexing as the watcher reports changes, and answers to status and search. Its files and watcher are
// passed in, so tests run it without a container.
import type { WatchEvent } from '@flowcanvas/workspace-agent/protocol';
import type { Indexer } from './indexer.js';
import type {
  EngineRequest,
  EngineResults,
  EngineState,
  EngineStatus,
  SearchResult,
} from './protocol.js';
import { ENGINE_PROTOCOL } from './protocol.js';
import type { IndexStore } from './store.js';

export interface EngineServiceOptions {
  readonly store: IndexStore;
  readonly indexer: Indexer;
  /** The project's whole file list (the agent's: git's files, never secret ones). */
  readonly listFiles: () => Promise<readonly string[]>;
  /** Starts the project's watcher (the agent's); its events re-index changed files. */
  readonly watch: (emit: (event: WatchEvent) => void) => Promise<{ close(): void }>;
  /** Changes are gathered this long before they're re-indexed, so a save that writes many files is one pass. */
  readonly refreshDelayMs?: number;
}

export interface EngineService {
  /** The answer to a checked request: the result for its `op` (EngineResults). */
  handle(request: EngineRequest): Promise<EngineResults[keyof EngineResults]>;
  /** Waits for the current pass and any pending changes to be indexed (for tests and shutdown). */
  settled(): Promise<void>;
  close(): void;
}

/** Shown when a pass fails. Never the error itself: it could name paths or hold file content. */
export const INDEXING_FAILED = 'Indexing stopped. Reopen the project to try again.';
/** Shown when changes can't be followed; the index is still searchable. */
export const NOT_FOLLOWING =
  'Changes to files aren’t being followed. Reopen the project to update the index.';

const REFRESH_DELAY_MS = 200;

export function startEngineService(options: EngineServiceOptions): EngineService {
  const { store, indexer } = options;
  const refreshDelayMs = options.refreshDelayMs ?? REFRESH_DELAY_MS;
  let state: EngineState = 'starting';
  let progress = { done: 0, total: 0 };
  let lastFullMs: number | null = null;
  let message: string | null = null;
  let closed = false;
  let watcher: { close(): void } | undefined;
  const pending = new Map<string, boolean>();
  let timer: NodeJS.Timeout | undefined;
  let work: Promise<unknown> = Promise.resolve();

  // Every pass and refresh goes through `work`, so `settled` can wait for all of it. The indexer queues
  // them itself as well.
  const enqueue = (job: () => Promise<unknown>) => {
    work = work.then(job, job).catch(() => undefined);
    return work;
  };

  const fullPass = () =>
    enqueue(async () => {
      try {
        const files = await options.listFiles();
        if (closed) return;
        state = 'indexing';
        const run = await indexer.sync(files, (p) => {
          progress = p;
        });
        lastFullMs = run.ms;
        state = 'ready';
      } catch {
        state = 'failed';
        message = INDEXING_FAILED;
      }
    });

  const flush = () => {
    timer = undefined;
    const changes = [...pending].map(([path, deleted]) => ({ path, deleted }));
    pending.clear();
    if (changes.length === 0 || closed) return;
    void enqueue(async () => {
      try {
        await indexer.refresh(changes);
      } catch {
        // The full index is still there; the next change or a reopen tries again.
        message = NOT_FOLLOWING;
      }
    });
  };

  const onEvent = (event: WatchEvent) => {
    if (closed) return;
    switch (event.type) {
      case 'changed':
        pending.set(event.path, event.deleted);
        timer ??= setTimeout(flush, refreshDelayMs);
        return;
      case 'overflow':
        // Too many changes at once (a checkout, an install): look at everything again.
        pending.clear();
        void fullPass();
        return;
      case 'error':
        message = NOT_FOLLOWING;
        return;
      default:
        return;
    }
  };

  // The watcher first, then the full pass: a change before the watcher was up is read by the pass, and one
  // after it is reported and re-indexed. The other order leaves a gap in which an edit is missed for good
  // (found by the Docker test, 11 Nov 2026).
  void enqueue(async () => {
    try {
      const started = await options.watch(onEvent);
      if (closed) started.close();
      else watcher = started;
    } catch {
      message = NOT_FOLLOWING;
    }
  });
  void fullPass();

  const status = (): EngineStatus => ({
    state,
    done: progress.done,
    total: progress.total,
    ...store.counts(),
    lastFullMs,
    message,
  });

  const search = (query: string, limit: number): SearchResult => {
    const started = performance.now();
    const symbols = store.search(query, limit);
    return { symbols, ms: Math.round(performance.now() - started) };
  };

  return {
    handle: (request) => {
      switch (request.op) {
        case 'hello':
          return Promise.resolve({ protocol: ENGINE_PROTOCOL });
        case 'status':
          return Promise.resolve(status());
        case 'search':
          return Promise.resolve(search(request.query, request.limit));
      }
    },
    settled: async () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        flush();
      }
      // A job may queue another (an overflow during a pass): wait until nothing new arrives.
      for (let seen: Promise<unknown> | undefined; seen !== work;) {
        seen = work;
        await seen;
      }
    },
    close: () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
    },
  };
}
