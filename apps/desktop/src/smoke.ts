// `flowcanvas --smoke-test <folder>`: checks an installed app works end to end without a person (CI, after
// installing the .deb): the page is served under its security policy, the folder's files are listed, and the engine
// indexes it and finds a symbol, its graph is built (the semantic worker and the TypeScript shipped with it loading,
// phase 4), and a process runs on a pty (node-pty shipped and loading, phase 3). Prints one line per check; the exit
// code says whether all passed.
import { setTimeout as sleep } from 'node:timers/promises';
import type { Folders } from './folders.js';
import type { Projects } from './projects.js';
import { Processes } from './run/processes.js';
import type { DesktopServer } from './server.js';

export async function smokeTest(options: {
  readonly server: DesktopServer;
  readonly projects: Projects;
  readonly folders: Folders;
  readonly folder: string | undefined;
  readonly timeoutMs?: number;
}): Promise<boolean> {
  const say = (ok: boolean, what: string) => {
    process.stdout.write(`${ok ? 'ok' : 'FAILED'}: ${what}\n`);
    return ok;
  };
  if (options.folder === undefined)
    return say(false, 'give a folder: flowcanvas --smoke-test <folder>');
  const project = options.projects.open(options.folder);

  // The page, through the same door the window uses.
  const entry = await fetch(options.server.entryUrl(`/p/${project.id}`), { redirect: 'manual' });
  const cookie = entry.headers.get('set-cookie')?.split(';')[0] ?? '';
  const page = await fetch(`${options.server.origin}/p/${project.id}`, { headers: { cookie } });
  const html = await page.text();
  const served =
    say(page.ok && html.includes('<div id="root">'), 'the app is served') &&
    say((page.headers.get('content-security-policy') ?? '') !== '', 'under its security policy');

  const tree = await options.folders.agent(project.path, { op: 'files' });
  const listed = say(
    tree.ok && 'files' in tree.result && tree.result.files.length > 0,
    'files listed',
  );

  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let ready = false;
  while (!ready && Date.now() < deadline) {
    // An engine that stopped is started again on the next question; keep asking until the deadline.
    const status = await options.folders
      .index(project.path, { op: 'status' })
      .catch(() => undefined);
    ready = status?.ok === true && 'state' in status.result && status.result.state === 'ready';
    if (!ready) await sleep(500);
  }
  const indexed = say(ready, 'the engine indexed the folder');
  let found = false;
  if (indexed) {
    const search = await options.folders
      .index(project.path, { op: 'search', query: 'a', limit: 20 })
      .catch(() => undefined);
    found =
      search?.ok === true &&
      'symbols' in search.result &&
      Array.isArray(search.result.symbols) &&
      search.result.symbols.length > 0;
  }
  const searched = say(found, 'search finds symbols');

  // The graph: TypeScript, as shipped, loads in the semantic worker and the whole folder is analysed.
  let built = false;
  while (indexed && !built && Date.now() < deadline) {
    const graph = await options.folders.index(project.path, { op: 'graph' }).catch(() => undefined);
    const state = graph?.ok === true && 'state' in graph.result ? graph.result.state : undefined;
    built = state === 'ready';
    if (state === 'failed') break;
    if (!built) await sleep(500);
  }
  const graphed = say(built, 'the engine built the graph');

  // The terminal's and the process cards' native module, loaded from the installed app.
  let ran: boolean;
  try {
    const processes = new Processes();
    const view = processes.start({
      kind: 'script',
      label: 'smoke',
      file: 'sh',
      args: ['-c', 'echo pty-$((40+2))'],
      cwd: project.path,
    });
    for (let i = 0; i < 100 && processes.get(view.id)?.state === 'running'; i += 1) await sleep(50);
    ran =
      processes.get(view.id)?.state === 'finished' &&
      (processes.log(view.id) ?? '').includes('pty-42');
  } catch {
    ran = false;
  }
  return served && listed && indexed && searched && graphed && say(ran, 'a process runs on a pty');
}
