// Started by the workspace host inside the workspace container: `node /tmp/flowcanvas-agent/main.js`, with
// the host on the other end of stdin and stdout. It ends when the host closes stdin.
// With `--watch` (phase 3), it's the project's file watcher instead: one event per line on stdout.
import { createAgent, serve } from './agent.js';
import { AGENT_PROTOCOL, PROJECT_ROOT, type WatchEvent } from './protocol.js';
import { startWatcher } from './watch.js';

if (process.argv.includes('--watch')) {
  const send = (event: WatchEvent) => {
    process.stdout.write(`${JSON.stringify({ v: AGENT_PROTOCOL, event })}\n`);
  };
  try {
    const watcher = await startWatcher({ root: PROJECT_ROOT, emit: send });
    // The host closes stdin (or kills the process) when the page goes away.
    process.stdin.resume();
    process.stdin.on('end', () => {
      watcher.close();
      process.exit(0);
    });
  } catch {
    send({ type: 'error', message: 'This workspace has no project files to watch yet.' });
    process.exit(1);
  }
} else {
  await serve(createAgent({ root: PROJECT_ROOT }), process.stdin, process.stdout);
}
