// The control plane's `pnpm dev`: `wrangler dev` with the arguments it's given, plus the once-a-minute tick that
// the Cron Trigger gives the deployed Worker. Wrangler doesn't run Cron Triggers locally, so without this, idle
// workspaces would never sleep in development (phase 1d step 8; src/api/scheduled.ts).
import { spawn } from 'node:child_process';

export const TICK_MS = 60_000;

const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt === -1 ? '8787' : (args[portAt + 1] ?? '8787');
// Loopback only, and the same cron as wrangler.jsonc.
const tickUrl = `http://127.0.0.1:${port}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('* * * * *')}`;

let warned = false;
const timer = setInterval(() => {
  fetch(tickUrl)
    .then((response) => {
      if (!response.ok && !warned) {
        warned = true;
        console.error(`[tick] the scheduled handler answered ${String(response.status)}`);
      }
    })
    .catch(() => {
      // Wrangler is starting or restarting; the next tick tries again.
    });
}, TICK_MS);

const wrangler = spawn('wrangler', ['dev', ...args], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    wrangler.kill(signal);
  });
}
wrangler.on('exit', (code, signal) => {
  clearInterval(timer);
  process.exit(code ?? (signal === null ? 1 : 0));
});
