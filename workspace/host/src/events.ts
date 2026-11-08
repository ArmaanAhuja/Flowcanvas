// The project's file watcher over a WebSocket (phase 3 step 3): each line the watcher prints is checked
// (the workspace is untrusted) and passed on as one text frame. The page sends nothing.
import { createInterface } from 'node:readline';
import type { WebSocket } from 'ws';
import { AGENT_PROTOCOL, parseWatchEvent } from '@flowcanvas/workspace-agent/protocol';
import type { AgentProcess } from './agents.js';

/** A watcher line is one small event; anything longer isn't one. */
const LINE_MAX = 4096;
/** After the page goes away, the watcher gets this long to end by itself before it's killed. */
export const WATCHER_GRACE_MS = 2000;

export function relayEvents(
  socket: WebSocket,
  watcher: AgentProcess,
  log: (line: string) => void,
): void {
  let refused = 0;
  const lines = createInterface({ input: watcher.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    let event;
    try {
      const envelope =
        line.length > LINE_MAX ? undefined : (JSON.parse(line) as { v?: unknown; event?: unknown });
      event = envelope?.v === AGENT_PROTOCOL ? parseWatchEvent(envelope.event) : undefined;
    } catch {
      event = undefined;
    }
    if (event === undefined) {
      refused += 1;
      // Once, and never the line itself: it could hold anything.
      if (refused === 1) log('watcher sent something that is not an event; dropped');
      return;
    }
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  });
  watcher.onExit(() => {
    if (socket.readyState === socket.OPEN) socket.close(1000, 'watcher ended');
  });
  // Nothing is expected from the page; whatever comes is ignored.
  socket.on('close', () => {
    // Ending stdin lets the watcher stop by itself; the kill is the backstop.
    watcher.stdin.end();
    setTimeout(() => {
      watcher.kill();
    }, WATCHER_GRACE_MS).unref();
  });
}
