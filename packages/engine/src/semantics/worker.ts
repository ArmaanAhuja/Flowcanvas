// The semantic worker (ADR 0026 §1): TypeScript's language services in a thread of their own, with a heap cap set by
// whoever starts it, so running out of memory ends this thread and never the indexer or search.
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
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
    };

export type FromWorker =
  | { readonly type: 'answer'; readonly id: number; readonly result: unknown }
  | { readonly type: 'failed'; readonly id: number };

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
    let reply: FromWorker;
    try {
      const { path, line, column } = message;
      const result =
        message.op === 'definition'
          ? service.definition(path, line, column)
          : message.op === 'references'
            ? service.references(path, line, column)
            : message.op === 'callers'
              ? service.callers(path, line, column)
              : service.callees(path, line, column);
      reply = { type: 'answer', id: message.id, result };
    } catch {
      // Never the error itself: it could name paths or hold file content.
      reply = { type: 'failed', id: message.id };
    }
    port.postMessage(reply);
  });
}
