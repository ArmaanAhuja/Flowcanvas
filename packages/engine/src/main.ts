// Started by the workspace host inside the workspace container (ADR 0025): `node /tmp/flowcanvas-engine/main.js`,
// bundled with its WebAssembly files beside it, with the host on the other end of stdin and stdout. It indexes
// the project, follows its changes, and ends when the host closes stdin.
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from '@flowcanvas/workspace-agent/agent';
import { PROJECT_ROOT } from '@flowcanvas/workspace-agent/protocol';
import { startWatcher } from '@flowcanvas/workspace-agent/watch';
import { useGrammarDirectory } from './grammars.js';
import { Indexer } from './indexer.js';
import { INDEX_FILE } from './protocol.js';
import { serveEngine } from './serve.js';
import { startEngineService } from './service.js';
import { IndexStore } from './store.js';

useGrammarDirectory(dirname(fileURLToPath(import.meta.url)));
// Beside the journal, in the volume; only the workspace's own user can read it.
await mkdir(dirname(INDEX_FILE), { recursive: true, mode: 0o700 });

// The same file list as the file tree: the agent's own (git's files, never secret ones).
const agent = createAgent({ root: PROJECT_ROOT });
const store = new IndexStore(INDEX_FILE);
const indexer = new Indexer({ root: PROJECT_ROOT, store });
const service = startEngineService({
  store,
  indexer,
  listFiles: async () => {
    const result = await agent.handle({ op: 'files' });
    if (!('files' in result)) throw new Error('no file list');
    return result.files;
  },
  watch: (emit) => startWatcher({ root: PROJECT_ROOT, emit }),
});

await serveEngine(service, process.stdin, process.stdout);
service.close();
await indexer.close();
store.close();
process.exit(0);
