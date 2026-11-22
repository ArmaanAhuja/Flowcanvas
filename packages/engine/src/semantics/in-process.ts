// The semantic service behind the engine's `Semantics`, in this thread: for tests and measurements that run the
// engine against real TypeScript without a worker (the worker's own messages are tested apart).
import { encodeGraph } from '@flowcanvas/graph-model';
import type { CodePosition, EngineResults, SemanticOp } from '../protocol.js';
import type { Semantics } from '../service.js';
import { listedEntries } from './graph.js';
import type { SemanticService } from './semantic-service.js';

export function inProcessSemantics(service: SemanticService): Semantics {
  return {
    ask: <Op extends SemanticOp>(op: Op, { path, line, column }: CodePosition) =>
      Promise.resolve(service[op](path, line, column) as unknown as EngineResults[Op]),
    changed: (paths, files) => {
      service.changed(paths, files);
    },
    graph: async (entries) => {
      const pass = await service.graph(() => Promise.resolve());
      if (pass === null) return { failed: 'The project changed while the graph was built.' };
      entries?.(listedEntries(pass.graph));
      return {
        encoded: encodeGraph(pass.graph),
        files: pass.files,
        builtInCalls: pass.builtInCalls,
        complete: pass.complete,
        note: pass.note,
      };
    },
    unit: ({ path, line, column }) => Promise.resolve(service.unitAt(path, line, column)),
    close: () => {
      service.dispose();
      return Promise.resolve();
    },
  };
}
