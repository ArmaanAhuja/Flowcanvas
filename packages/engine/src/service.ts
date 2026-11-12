// The engine as a service in the workspace (phase 4 step 3, ADR 0025): a full index when it starts, then
// re-indexing as the watcher reports changes, and answers to status and search. Its files and watcher are
// passed in, so tests run it without a container.
import {
  FLOW_MAX_NODES,
  buildFlow,
  graphStats,
  indexGraph,
  placeKey,
  type Flow,
  type Graph,
  type GraphIndex,
} from '@flowcanvas/graph-model';
import type { WatchEvent } from '@flowcanvas/workspace-agent/protocol';
import type { Indexer } from './indexer.js';
import type {
  CodePosition,
  EngineRequest,
  EngineResults,
  EngineState,
  EngineStatus,
  GraphSnapshotInfo,
  GraphState,
  GraphStatus,
  FlowResult,
  SearchResult,
  SemanticOp,
} from './protocol.js';
import { ENGINE_LIMITS, ENGINE_PROTOCOL } from './protocol.js';
import { emptyAnswer, GRAPH_FAILED } from './semantics/client.js';
import type { GraphWire } from './semantics/worker.js';
import type { SnapshotStore } from './snapshots.js';
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
  /** TypeScript's answers (phase 5, ADR 0026): the semantic worker's client. Kept current with the same events. */
  readonly semantics?: Semantics;
  /** Where the flow graph's versions are kept (phase 6, ADR 0027); with `semantics`, the graph is built. */
  readonly snapshots?: SnapshotStore;
  /** After changes are indexed, the graph waits this long for more before it's brought up to date. */
  readonly graphDelayMs?: number;
}

/** What the engine needs from the semantic worker's client (semantics/client.ts). */
export interface Semantics {
  ask<Op extends SemanticOp>(op: Op, position: CodePosition): Promise<EngineResults[Op]>;
  changed(paths: readonly string[], files?: readonly string[]): void;
  /** A graph pass (ADR 0027). */
  graph(): Promise<GraphWire | { readonly failed: string }>;
  /** The graph id of the code unit at a place (phase 7): null when it isn't in a TypeScript or JavaScript file. */
  unit(position: CodePosition): Promise<string | null | { readonly failed: string }>;
  close(): Promise<void>;
}

export interface EngineService {
  /** The answer to a checked request: the result for its `op` (EngineResults). */
  handle(request: EngineRequest): Promise<EngineResults[keyof EngineResults]>;
  /** Waits for the current pass and any pending changes to be indexed (for tests and shutdown). */
  settled(): Promise<void>;
  /** Waits until no graph pass is running or waiting to start (for tests and shutdown). */
  graphSettled(): Promise<void>;
  close(): void;
}

/** Shown when a pass fails. Never the error itself: it could name paths or hold file content. */
export const INDEXING_FAILED = 'Indexing stopped. Reopen the project to try again.';
/** Shown when changes can't be followed; the index is still searchable. */
export const NOT_FOLLOWING =
  'Changes to files aren’t being followed. Reopen the project to update the index.';

const REFRESH_DELAY_MS = 200;

/** Where no semantic worker was given (tests of the index alone). */
export const NO_SEMANTICS = 'TypeScript’s answers aren’t available here.';
/** Where there's no semantic worker or no snapshot store. */
export const NO_GRAPH = 'The graph isn’t available here.';

const GRAPH_DELAY_MS = 2000;

/** Words for flows (phase 7), safe to show. */
export const FLOW_MESSAGES = {
  noGraph: 'The graph is still being built. Flows open once it’s ready.',
  notCode: 'Flows start from functions in TypeScript or JavaScript files.',
  notYet: 'This isn’t in the graph yet. It will be once the graph has caught up with your changes.',
  noCalls: 'There’s no function here, and this file’s top level makes no calls.',
  smaller: (nodes: number) =>
    `Shown with up to ${String(nodes)} nodes: the whole flow is too large to send at once.`,
} as const;

/** A flow's answer has to fit in one message line (ENGINE_LIMITS.lineBytes), with room for the rest. */
const FLOW_BYTES = ENGINE_LIMITS.lineBytes * 0.75;

/** The flow from `root`, made smaller until it fits in a message: halving the node cap, and saying so. */
export function fittingFlow(
  index: GraphIndex,
  root: string,
): { readonly flow: Flow; readonly message: string | null } | undefined {
  for (let most = FLOW_MAX_NODES; most >= 1; most = Math.floor(most / 2)) {
    const flow = buildFlow(index, root, most);
    if (flow === undefined) return undefined;
    if (Buffer.byteLength(JSON.stringify(flow)) <= FLOW_BYTES) {
      return { flow, message: most === FLOW_MAX_NODES ? null : FLOW_MESSAGES.smaller(most) };
    }
  }
  return undefined;
}

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

  // The flow graph (phase 6, ADR 0027): built after the first index, then brought up to date once edits settle.
  // One pass at a time; a request during one runs once more after it.
  const { semantics, snapshots } = options;
  const graphDelayMs = options.graphDelayMs ?? GRAPH_DELAY_MS;
  let graphState: GraphState =
    semantics !== undefined && snapshots !== undefined ? 'waiting' : 'failed';
  let graphMessage: string | null = graphState === 'failed' ? NO_GRAPH : null;
  let graphInfo: GraphSnapshotInfo | null = null;
  // The latest version, decoded and indexed (about 60 MB for Twenty): flows are built from it in milliseconds.
  let graphIndex: GraphIndex | undefined;
  const keep = (graph: Graph) => {
    graphIndex = indexGraph(graph);
  };
  let graphTimer: NodeJS.Timeout | undefined;
  let graphRunning: Promise<void> | undefined;
  let graphAgain = false;

  // The last version from before a restart is shown until the first pass replaces it.
  if (snapshots !== undefined) {
    try {
      const latest = snapshots.latest();
      const loaded = latest === undefined ? undefined : snapshots.load(latest.version);
      if (latest !== undefined && loaded !== undefined) {
        keep(loaded.graph);
        graphInfo = {
          ...latest,
          stats: graphStats(loaded.graph),
          buildMs: 0,
          saveMs: 0,
          loadMs: Math.round(loaded.ms),
        };
      }
    } catch {
      // An unreadable version is replaced by the next pass.
    }
  }

  const runGraph = () => {
    graphTimer = undefined;
    if (semantics === undefined || snapshots === undefined || closed) return;
    if (graphRunning !== undefined) {
      graphAgain = true;
      return;
    }
    graphState = 'building';
    graphRunning = (async () => {
      const started = performance.now();
      const result = await semantics.graph();
      const buildMs = Math.round(performance.now() - started);
      if ('failed' in result) {
        graphState = 'failed';
        graphMessage = result.failed;
        return;
      }
      const saved = snapshots.save(result.encoded, {
        complete: result.complete,
        note: result.note,
        files: result.files,
        builtInCalls: result.builtInCalls,
      });
      // Loaded straight back: every version proves it reads, and how fast (the Done when's "under 1 s").
      const loaded = snapshots.load(saved.meta.version);
      if (loaded === undefined) throw new Error('not stored');
      keep(loaded.graph);
      graphInfo = {
        ...saved.meta,
        stats: graphStats(loaded.graph),
        buildMs,
        saveMs: Math.round(saved.ms),
        loadMs: Math.round(loaded.ms),
      };
      graphState = 'ready';
      graphMessage = null;
    })()
      .catch(() => {
        graphState = 'failed';
        graphMessage = GRAPH_FAILED.failed;
      })
      .finally(() => {
        graphRunning = undefined;
        if (graphAgain && !closed) {
          graphAgain = false;
          runGraph();
        }
      });
  };

  const requestGraph = (delayMs: number) => {
    if (semantics === undefined || snapshots === undefined || closed) return;
    if (graphTimer !== undefined) clearTimeout(graphTimer);
    graphTimer = setTimeout(runGraph, delayMs);
  };

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
        requestGraph(0);
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
        // The semantic worker re-checks the same files; with the fresh list, it notices new and deleted ones.
        if (options.semantics !== undefined) {
          options.semantics.changed(
            changes.map((c) => c.path),
            await options.listFiles(),
          );
          requestGraph(graphDelayMs);
        }
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
        if (options.semantics !== undefined) {
          const semantics = options.semantics;
          void options.listFiles().then(
            (files) => {
              semantics.changed([], files);
            },
            () => undefined,
          );
        }
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

  const flow = async (position: CodePosition): Promise<FlowResult> => {
    // Read when answering, not when asked: a new version may arrive while TypeScript works out the function.
    const none = (message: string): FlowResult => ({ flow: null, message, ...aboutGraph() });
    if (graphIndex === undefined || semantics === undefined) {
      return none(
        graphState === 'failed' ? (graphMessage ?? FLOW_MESSAGES.noGraph) : FLOW_MESSAGES.noGraph,
      );
    }
    // A function's name (from search or the Calls tab) is found in the graph itself; anywhere else, TypeScript
    // says which function the place is in.
    let root = graphIndex.byPlace.get(placeKey(position.path, position.line, position.column));
    if (root === undefined) {
      const unit = await semantics.unit(position);
      if (unit === null) return none(FLOW_MESSAGES.notCode);
      if (typeof unit !== 'string') return none(unit.failed);
      root = unit;
    }
    // The latest index, read after the await (once set, it's only ever replaced).
    const built = fittingFlow(graphIndex, root);
    if (built === undefined) {
      return none(
        graphState === 'ready' && root.endsWith('#(top level)')
          ? FLOW_MESSAGES.noCalls
          : FLOW_MESSAGES.notYet,
      );
    }
    return { ...built, ...aboutGraph() };
  };

  const aboutGraph = () => ({
    version: graphInfo?.version ?? null,
    takenAt: graphInfo?.takenAt ?? null,
    current: graphState === 'ready',
    complete: graphInfo?.complete ?? false,
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
        case 'graph':
          return Promise.resolve({
            state: graphState,
            message: graphMessage,
            snapshot: graphInfo,
          } satisfies GraphStatus);
        case 'search':
          return Promise.resolve(search(request.query, request.limit));
        case 'definition':
        case 'references':
        case 'callers':
        case 'callees':
        case 'details': {
          const { path, line, column } = request;
          return options.semantics === undefined
            ? Promise.resolve(emptyAnswer(request.op, NO_SEMANTICS) as EngineResults[SemanticOp])
            : options.semantics.ask(request.op, { path, line, column });
        }
        case 'flow': {
          const { path, line, column } = request;
          return flow({ path, line, column });
        }
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
    graphSettled: async () => {
      while (graphTimer !== undefined || graphRunning !== undefined) {
        if (graphTimer !== undefined) {
          clearTimeout(graphTimer);
          runGraph();
        }
        await graphRunning;
      }
    },
    close: () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      if (graphTimer !== undefined) clearTimeout(graphTimer);
      watcher?.close();
      void options.semantics?.close();
    },
  };
}
