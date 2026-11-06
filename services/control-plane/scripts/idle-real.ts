// `pnpm --filter @flowcanvas/control-plane test:idle-real`: the "sleeps after 10 idle minutes and resumes intact"
// check in real time, with nothing faked (phase 1d step 10). About 12 minutes, so it isn't in `pnpm test:docker`
// (that one moves a clock instead); it's run at phase close and whenever idle sleep changes.
//
// The real workspace host (its own fc-test- prefix, so real workspaces are never touched), the real lifecycle
// and the scheduled check every minute on the real clock, as `pnpm dev` runs it. Rallly at its corpus pin.
// Everything it makes is removed at the end, whatever happens.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createScheduled } from '../src/api/scheduled.js';
import { demoProject } from '../src/projects/demo.js';
import { createProject } from '../src/projects/projects.js';
import { migratedDatabase } from '../src/test/database.js';
import { signedInAs } from '../src/test/sessions.js';
import { usageSummary } from '../src/usage/usage.js';
import {
  IDLE_SLEEP_MS,
  loadWorkspace,
  openWorkspace,
  resumeWorkspace,
} from '../src/workspaces/lifecycle.js';
import { localHostFromEnv } from '../src/workspaces/local-host.js';

const run = promisify(execFile);
const prefix = `fc-test-${randomBytes(4).toString('hex')}`;
const token = randomBytes(32).toString('hex');
const hostDir = fileURLToPath(new URL('../../../workspace/host/', import.meta.url));
const TICK_MS = 60_000;
const started = Date.now();
const at = () => `${((Date.now() - started) / 60_000).toFixed(1).padStart(5)} min`;
const say = (line: string) => {
  console.log(`[${at()}] ${line}`);
};

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
  });
}

const port = await freePort();
const host = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
  cwd: hostDir,
  detached: true,
  env: {
    ...process.env,
    WORKSPACE_HOST_TOKEN: token,
    WORKSPACE_HOST_PORT: String(port),
    WORKSPACE_HOST_PREFIX: prefix,
  },
});
let hostOutput = '';
host.stdout.on('data', (chunk: Buffer) => (hostOutput += chunk.toString()));
host.stderr.on('data', (chunk: Buffer) => (hostOutput += chunk.toString()));

async function cleanUp(): Promise<void> {
  if (host.pid !== undefined) process.kill(-host.pid, 'SIGTERM');
  const list = async (args: string[]) =>
    (
      await run('docker', [...args, '--filter', `label=org.flowcanvas.prefix=${prefix}`, '-q'])
    ).stdout
      .split('\n')
      .filter((id) => id !== '');
  for (const id of await list(['ps', '--all'])) await run('docker', ['rm', '--force', id]);
  for (const id of await list(['network', 'ls'])) await run('docker', ['network', 'rm', id]);
  for (const id of await list(['volume', 'ls']))
    await run('docker', ['volume', 'rm', '--force', id]);
}

let failed = false;
const check = (ok: boolean, what: string) => {
  say(`${ok ? 'ok    ' : 'FAILED'} ${what}`);
  if (!ok) failed = true;
};

try {
  while (!hostOutput.includes('Listening on')) {
    if (Date.now() - started > 30_000) throw new Error(`host didn't start:\n${hostOutput}`);
    await sleep(100);
  }
  const provider = localHostFromEnv(
    { WORKSPACE_HOST_URL: `http://127.0.0.1:${String(port)}`, WORKSPACE_HOST_TOKEN: token },
    (input, init) => fetch(input, init),
  );
  if (provider === undefined) throw new Error('no provider');
  const db = await migratedDatabase();
  const { userId } = await signedInAs(db, 'ada@example.com');
  const demo = demoProject();
  const project = await createProject(db, userId, {
    name: demo.name,
    repoUrl: demo.repoUrl,
    repoCommit: demo.commit,
  });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  const ctx = { db, provider, now: () => Date.now(), log: say };
  const load = async () => {
    const row = await loadWorkspace(db, project.id, userId);
    if (row === undefined) throw new Error('no workspace');
    return row;
  };

  const opened = await openWorkspace(ctx, await load());
  check(opened.ok, `opened ${demo.name} at ${demo.commit.slice(0, 7)}`);
  const ref = (await load()).provider_ref ?? '';
  const shell = async (script: string) =>
    (await run('docker', ['exec', ref, 'sh', '-c', script])).stdout.trim();
  await shell('echo kept > /workspace/project/flowcanvas-idle-check.txt');
  const pid = await shell(
    "nohup sh -c 'i=0; while true; do i=$((i+1)); echo $i > /tmp/count; sleep 1; done' >/dev/null 2>&1 & echo $!",
  );
  const idleFrom = Date.now();
  say('a file written and a counting process started; now nothing touches it');

  const tick = createScheduled({ database: () => db, log: say, workspaceProvider: () => provider });
  let sleptAt: number | undefined;
  while (sleptAt === undefined && Date.now() - idleFrom < IDLE_SLEEP_MS + 3 * TICK_MS) {
    await sleep(TICK_MS);
    await tick(
      { cron: '* * * * *', scheduledTime: Date.now() },
      { DATABASE_URL: 'postgresql://unused' },
    );
    const state = (await load()).state;
    say(`tick: ${state}`);
    if (state === 'sleeping') sleptAt = Date.now();
  }
  const idleFor = sleptAt === undefined ? undefined : (sleptAt - idleFrom) / 60_000;
  check(
    idleFor !== undefined && idleFor >= 10 && idleFor < 11.1,
    `asleep after ${idleFor === undefined ? 'never' : idleFor.toFixed(2)} idle minutes (10 to 11: one check a minute)`,
  );
  const status = (
    await run('docker', ['inspect', '--format', '{{.State.Status}}', ref])
  ).stdout.trim();
  check(status === 'paused', `Docker says ${status}`);
  const metered = (await usageSummary(db, userId, Date.now())).workspaceSeconds;
  check(
    Math.abs(metered - IDLE_SLEEP_MS / 1000) <= 2,
    `metered ${String(metered)} s (10 minutes, not the time asleep)`,
  );

  await sleep(30_000);
  const resumed = await resumeWorkspace(ctx, await load());
  check(resumed.ok, 'resumed after 30 s asleep');
  check(
    (await shell('cat /workspace/project/flowcanvas-idle-check.txt')) === 'kept',
    'the file is there',
  );
  check((await shell(`kill -0 ${pid} && echo alive`)) === 'alive', 'the same process is alive');
  const before = Number(await shell('cat /tmp/count'));
  await sleep(3_000);
  check(Number(await shell('cat /tmp/count')) > before, 'and still counting');
  check(!hostOutput.includes(token), 'the host never printed its token');
} catch (error) {
  failed = true;
  say(`FAILED: ${String(error)}`);
} finally {
  // What the host's resource guard saw, so a stop for pressure explains itself.
  for (const line of hostOutput.split('\n').filter((l) => l.includes('guard:')))
    say(`host ${line.trim()}`);
  await cleanUp();
  say(failed ? 'FAILED' : 'PASSED: sleeps after 10 idle minutes and resumes intact, in real time');
  process.exitCode = failed ? 1 : 0;
}
