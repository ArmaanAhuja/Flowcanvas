// Started by the workspace host inside the workspace container: `node /tmp/flowcanvas-agent/main.js`, with
// the host on the other end of stdin and stdout. It ends when the host closes stdin.
import { createAgent, serve } from './agent.js';
import { PROJECT_ROOT } from './protocol.js';

await serve(createAgent({ root: PROJECT_ROOT }), process.stdin, process.stdout);
