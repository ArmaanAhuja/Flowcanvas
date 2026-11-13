// Started by the workspace host inside the workspace container (ADR 0025): `node /tmp/flowcanvas-engine/main.js`,
// bundled with its WebAssembly files, the semantic worker and TypeScript beside it, with the host on the other end of stdin and stdout. It indexes
// the project, follows its changes, and ends when the host closes stdin.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from '@flowcanvas/workspace-agent/agent';
import { PROJECT_ROOT } from '@flowcanvas/workspace-agent/protocol';
import { startWatcher } from '@flowcanvas/workspace-agent/watch';
import { ENGINE_SEMANTICS_WORKER } from './bundle-files.js';
import { useGrammarDirectory } from './grammars.js';
import { Indexer } from './indexer.js';
import { FactsStore } from './facts.js';
import { FACTS_FILE, GRAPH_FILE, INDEX_FILE } from './protocol.js';
import { SnapshotStore } from './snapshots.js';
import { SemanticClient, threadWorker } from './semantics/client.js';
import { serveEngine } from './serve.js';
import { startEngineService } from './service.js';
import { IndexStore } from './store.js';

useGrammarDirectory(dirname(fileURLToPath(import.meta.url)));
// Beside the journal, in the volume; only the workspace's own user can read it.
await mkdir(dirname(INDEX_FILE), { recursive: true, mode: 0o700 });

// The same file list as the file tree: the agent's own (git's files, never secret ones).
const agent = createAgent({ root: PROJECT_ROOT });
const store = new IndexStore(INDEX_FILE);
const snapshots = new SnapshotStore(GRAPH_FILE);
// Opened here first (it sets the table up); the worker writes it during passes, the engine reads it.
const facts = new FactsStore(FACTS_FILE, { root: PROJECT_ROOT });
const indexer = new Indexer({ root: PROJECT_ROOT, store });
const listFiles = async () => {
  const result = await agent.handle({ op: 'files' });
  if (!('files' in result)) throw new Error('no file list');
  return result.files;
};
// TypeScript's answers (phase 5, ADR 0026): a worker thread with a heap cap, started on the first question, with
// TypeScript unpacked beside this script by the host.
const here = dirname(fileURLToPath(import.meta.url));
const semantics = new SemanticClient({
  root: PROJECT_ROOT,
  typescriptPath: join(here, 'typescript', 'typescript.js'),
  factsFile: FACTS_FILE,
  start: threadWorker(new URL(`./${ENGINE_SEMANTICS_WORKER}`, import.meta.url)),
  listFiles,
});
const service = startEngineService({
  store,
  indexer,
  listFiles,
  watch: (emit) => startWatcher({ root: PROJECT_ROOT, emit }),
  semantics,
  snapshots,
  facts,
});

await serveEngine(service, process.stdin, process.stdout);
service.close();
await indexer.close();
store.close();
snapshots.close();
facts.close();
process.exit(0);
