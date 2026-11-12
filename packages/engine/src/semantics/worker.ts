// The semantic worker (ADR 0026 §1): TypeScript's language services in a thread of their own, with a heap cap set by
// whoever starts it, so running out of memory ends this thread and never the indexer or search.
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { encodeGraph, validateGraph } from '@flowcanvas/graph-model';
import type { CodePosition, SemanticOp } from '../protocol.js';
import { SemanticService } from './semantic-service.js';
import type { TypeScript } from './projects.js';

export interface WorkerStart {
  readonly root: string;
  readonly files: readonly string[];
  /** Where typescript.js is: beside the bundle in a workspace, the package elsewhere. */
  readonly typescriptPath: string;
}

export type ToWorker =
  | ({ readonly type: 'ask'; readonly id: number; readonly op: SemanticOp } & CodePosition)
  | {
      readonly type: 'changed';
      readonly paths: readonly string[];
      readonly files?: readonly string[];
    }
  | { readonly type: 'graph'; readonly id: number }
  /** The graph id of the code unit at a place (phase 7): a string, or null. */
  | ({ readonly type: 'unit'; readonly id: number } & CodePosition);

/** A graph pass's result across the thread: the graph as its encoding (one string is quick to send). */
export interface GraphWire {
  readonly encoded: string;
  readonly files: number;
  readonly builtInCalls: number;
  readonly complete: boolean;
  readonly note: string | null;
}

export type FromWorker =
  | { readonly type: 'answer'; readonly id: number; readonly result: unknown }
  | { readonly type: 'failed'; readonly id: number };

/** Passes that keep being started again by structural changes give up after this many tries. */
const GRAPH_TRIES = 3;
/** Between files, let waiting questions in. */
const pause = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

const port = parentPort;
if (port !== null) {
  const start = workerData as WorkerStart;
  const ts = createRequire(import.meta.url)(start.typescriptPath) as TypeScript;
  const service = new SemanticService({ ts, root: start.root, files: start.files });
  port.on('message', (message: ToWorker) => {
    if (message.type === 'changed') {
      service.changed(message.paths, message.files);
      return;
    }
    if (message.type === 'graph') {
      void (async () => {
        let reply: FromWorker = { type: 'failed', id: message.id };
        try {
          for (let tries = 0; tries < GRAPH_TRIES; tries += 1) {
            const pass = await service.graph(pause);
            if (pass === null) continue;
            // Checked here, once, before it's saved: loading trusts what was checked (ADR 0028). A graph that breaks
            // the schema is a fault in the pass, answered as a failed pass and never stored.
            if (validateGraph(pass.graph, 1).length > 0) break;
            const wire: GraphWire = {
              encoded: encodeGraph(pass.graph),
              files: pass.files,
              builtInCalls: pass.builtInCalls,
              complete: pass.complete,
              note: pass.note,
            };
            reply = { type: 'answer', id: message.id, result: wire };
            break;
          }
        } catch {
          // Never the error itself: it could name paths or hold file content.
        }
        port.postMessage(reply);
      })();
      return;
    }
    let reply: FromWorker;
    try {
      const { path, line, column } = message;
      const result =
        message.type === 'unit'
          ? service.unitAt(path, line, column)
          : message.op === 'definition'
            ? service.definition(path, line, column)
            : message.op === 'references'
              ? service.references(path, line, column)
              : message.op === 'callers'
                ? service.callers(path, line, column)
                : message.op === 'callees'
                  ? service.callees(path, line, column)
                  : service.details(path, line, column);
      reply = { type: 'answer', id: message.id, result };
    } catch {
      // Never the error itself: it could name paths or hold file content.
      reply = { type: 'failed', id: message.id };
    }
    port.postMessage(reply);
  });
}
