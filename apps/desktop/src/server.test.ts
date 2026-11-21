// The desktop app's local server over real HTTP: the secret, the same-origin rule, the web app's routes answered
// from a real folder by the real file agent, and the engine's routes (a stand-in engine; the real one is checked
// by the smoke test and the walkthrough).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineRequest, EngineResponse } from '@flowcanvas/engine/protocol';
import { HostError } from '@flowcanvas/workspace-host/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Folders } from './folders.js';
import { Projects } from './projects.js';
import { listedFiles, RunService, type RunState } from './run/service.js';
import type { Pty } from './run/terminal.js';
import { MESSAGES, SESSION_COOKIE, startDesktopServer, type DesktopServer } from './server.js';

const SECRET = 'test-secret-0123456789';
let base: string;
let folder: string;
let web: string;
let server: DesktopServer;
let projects: Projects;
let engineAnswer: (request: EngineRequest) => Promise<EngineResponse>;
let projectId: string;
let run: RunService;
/** What the fake shell was sent, and a way to make it print. */
let typed: string[];
let resized: [number, number][];
let print: (text: string) => void;
let exitShell: (code: number) => void;

const cookie = `${SESSION_COOKIE}=${SECRET}`;
const get = (path: string, headers: Record<string, string> = { cookie }) =>
  fetch(`${server.origin}${path}`, { headers });
const send = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.origin}${path}`, {
    method,
    headers: { cookie, origin: server.origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const workspace = (rest: string) => `/api/projects/${projectId}/workspace${rest}`;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'fc-desktop-'));
  folder = join(base, 'my-app');
  web = join(base, 'web');
  mkdirSync(join(folder, 'src'), { recursive: true });
  mkdirSync(web);
  writeFileSync(join(folder, 'src', 'index.ts'), 'export const hello = 1;\n');
  writeFileSync(join(folder, '.env'), 'SECRET=1\n');
  writeFileSync(join(web, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(web, 'app.js'), 'console.log(1);');
  writeFileSync(join(web, '_headers'), "/*\n  Content-Security-Policy: default-src 'self'\n");
  projects = new Projects({ dataRoot: join(base, 'data') });
  projectId = projects.open(folder).id;
  engineAnswer = () =>
    Promise.resolve({ ok: true, result: { symbols: [], ms: 1 } } as unknown as EngineResponse);
  const folders = new Folders({
    engineMain: 'unused',
    dataFolder: (ref) =>
      projects.dataFolder(projects.list().find((p) => p.path === ref)?.id ?? 'x'),
  });
  run = new RunService({
    files: async (ref) => {
      const answer = await folders.agent(ref, { op: 'files' });
      return answer.ok ? listedFiles(answer.result) : [];
    },
    onPath: () => false,
  });
  typed = [];
  resized = [];
  print = () => undefined;
  exitShell = () => undefined;
  const fakePty = (): Pty => ({
    onData: (listener) => {
      print = listener;
      return { dispose: () => undefined };
    },
    onExit: (listener) => {
      exitShell = (exitCode) => {
        listener({ exitCode });
      };
      return { dispose: () => undefined };
    },
    write: (data) => typed.push(data.toString()),
    resize: (cols, rows) => resized.push([cols, rows]),
    kill: () => undefined,
  });
  server = await startDesktopServer({
    projects,
    webRoot: web,
    secret: SECRET,
    run,
    openPty: fakePty,
    folders: {
      agent: (ref, request) => folders.agent(ref, request),
      index: (_ref, request) => engineAnswer(request),
      watch: (ref, emit) => folders.watch(ref, emit),
    },
  });
});
afterEach(async () => {
  await run.stopAll();
  await server.close();
  rmSync(base, { recursive: true, force: true });
});

describe('the door: only the window gets in', () => {
  it('refuses everything without the session cookie, and gives the cookie once for the secret', async () => {
    expect((await get('/', {})).status).toBe(403);
    expect((await get('/api/projects', {})).status).toBe(403);
    expect((await fetch(`${server.origin}/__open?key=wrong`, { redirect: 'manual' })).status).toBe(
      403,
    );
    const entry = await fetch(server.entryUrl('/p/x'), { redirect: 'manual' });
    expect(entry.status).toBe(302);
    expect(entry.headers.get('location')).toBe('/p/x');
    expect(entry.headers.get('set-cookie')).toContain('HttpOnly');
    expect(entry.headers.get('set-cookie')).toContain('SameSite=Strict');
  });

  it('never redirects anywhere but its own pages', async () => {
    const away = await fetch(`${server.origin}/__open?key=${SECRET}&to=//evil.example`, {
      redirect: 'manual',
    });
    expect(away.status).toBe(403);
  });

  it('refuses changes from any other origin', async () => {
    const response = await send(
      'PUT',
      workspace('/file?path=src/index.ts'),
      { content: 'x' },
      {
        origin: 'http://evil.example',
      },
    );
    expect(response.status).toBe(403);
    expect(readFileSync(join(folder, 'src', 'index.ts'), 'utf8')).toBe('export const hello = 1;\n');
  });
});

describe('the web app, served as the site served it', () => {
  it('serves its files under the site’s security policy, and the app itself for its own routes', async () => {
    const script = await get('/app.js');
    expect(script.headers.get('content-type')).toContain('javascript');
    expect(script.headers.get('content-security-policy')).toBe("default-src 'self'");
    const route = await get(`/p/${projectId}`);
    expect(await route.text()).toContain('<div id="root">');
    // A path that tries to leave the built app gets the app, never another file.
    expect(await (await get('/..%2f..%2fmy-app%2fsrc%2findex.ts')).text()).toContain('id="root"');
  });
});

describe('the API the web app calls, from the folder', () => {
  it('lists the open folders as projects, each running', async () => {
    const body = (await (await get('/api/projects')).json()) as {
      projects: { id: string; name: string; path: string; workspace: { state: string } }[];
      workspacesAvailable: boolean;
    };
    expect(body.workspacesAvailable).toBe(true);
    expect(body.projects).toEqual([
      expect.objectContaining({
        id: projectId,
        name: 'my-app',
        path: folder,
        workspace: expect.objectContaining({ state: 'running' }) as unknown,
      }),
    ]);
    expect((await get('/api/projects/nope/workspace/tree')).status).toBe(404);
    expect((await (await get('/api/me')).json()) as { user: { id: string } }).toMatchObject({
      user: { id: 'local' },
    });
  });

  it('lists, reads and writes the folder’s files on disk, never a secret file', async () => {
    const tree = (await (await get(workspace('/tree'))).json()) as { files: string[] };
    expect(tree.files).toContain('src/index.ts');
    expect(tree.files).not.toContain('.env');
    const read = (await (await get(workspace('/file?path=src/index.ts'))).json()) as {
      content: string;
      version: string;
    };
    expect(read.content).toBe('export const hello = 1;\n');
    const written = await send('PUT', workspace('/file?path=src/index.ts'), {
      content: 'export const hello = 2;\n',
      baseVersion: read.version,
    });
    expect(written.status).toBe(200);
    expect(readFileSync(join(folder, 'src', 'index.ts'), 'utf8')).toBe('export const hello = 2;\n');
    // An old version is a conflict, as on the site: the page decides.
    const stale = await send('PUT', workspace('/file?path=src/index.ts'), {
      content: 'x',
      baseVersion: read.version,
    });
    expect(stale.status).toBe(409);
    expect((await get(workspace('/file?path=.env'))).status).toBe(403);
  });

  it('keeps unsaved buffers in the app’s data, never in the project', async () => {
    const put = await send('PUT', workspace('/journal/entry?path=src/index.ts'), {
      content: 'draft',
      baseVersion: null,
      revision: 1,
    });
    expect(put.status).toBe(200);
    const list = (await (await get(workspace('/journal'))).json()) as {
      entries: { path: string }[];
    };
    expect(list.entries.map((e) => e.path)).toEqual(['src/index.ts']);
    const tree = (await (await get(workspace('/tree'))).json()) as { files: string[] };
    expect(tree.files.some((f) => f.includes('journal'))).toBe(false);
  });

  it('says a project runs while it’s open: it can’t be put to sleep', async () => {
    const sleep = await send('POST', workspace('/sleep'), {});
    expect(sleep.status).toBe(409);
    expect(((await sleep.json()) as { error: string }).error).toBe(MESSAGES.alwaysRunning);
    expect((await send('POST', workspace('/open'), {})).status).toBe(200);
  });

  it('asks the engine with the site’s routes, checks what’s asked, and passes its failures on plainly', async () => {
    let asked: EngineRequest | undefined;
    engineAnswer = (request) => {
      asked = request;
      return Promise.resolve({
        ok: true,
        result: { symbols: [], ms: 2 },
      } as unknown as EngineResponse);
    };
    expect((await get(workspace('/index/search?q=hello&limit=5'))).status).toBe(200);
    expect(asked).toEqual({ op: 'search', query: 'hello', limit: 5 });
    expect(
      (await get(workspace('/index/definition?path=src/index.ts&line=x&column=1'))).status,
    ).toBe(400);
    expect((await get(workspace('/index/unknown'))).status).toBe(404);
    engineAnswer = () => Promise.reject(new HostError('failed', 'The project index stopped.'));
    const stopped = await get(workspace('/index/status'));
    expect(stopped.status).toBe(502);
    expect(await stopped.json()).toEqual({ error: 'The project index stopped.', code: 'failed' });
  });

  it('streams the folder’s changes over a WebSocket, from our own page only', async () => {
    const refused = new WebSocket(`${server.origin.replace('http', 'ws')}${workspace('/events')}`, {
      headers: { cookie, origin: 'http://evil.example' },
    });
    await new Promise<void>((resolve) => {
      refused.on('error', () => {
        resolve();
      });
    });
    const socket = new WebSocket(`${server.origin.replace('http', 'ws')}${workspace('/events')}`, {
      headers: { cookie, origin: server.origin },
    });
    const events: { type: string; path?: string }[] = [];
    socket.on('message', (data: Buffer) =>
      events.push(JSON.parse(data.toString()) as { type: string }),
    );
    await new Promise<void>((resolve) => {
      socket.on('open', () => {
        resolve();
      });
    });
    await expect.poll(() => events.some((e) => e.type === 'ready'), { timeout: 5000 }).toBe(true);
    writeFileSync(join(folder, 'src', 'index.ts'), 'export const hello = 3;\n');
    await expect
      .poll(() => events.some((e) => e.type === 'changed' && e.path === 'src/index.ts'), {
        timeout: 5000,
      })
      .toBe(true);
    socket.close();
  });
});

const socketUrl = (rest: string) => `${server.origin.replace('http', 'ws')}${workspace(rest)}`;
const opened = (socket: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    socket.on('open', () => {
      resolve();
    });
    socket.on('error', reject);
  });

describe('running the project', () => {
  beforeEach(() => {
    writeFileSync(
      join(folder, 'package.json'),
      JSON.stringify({ scripts: { dev: 'echo ready on http://localhost:4555' } }),
    );
    writeFileSync(join(folder, 'package-lock.json'), '{}');
    writeFileSync(join(folder, '.env.example'), 'SECRET=\nAPI_KEY=\n');
  });

  it('says how the project runs and which variables are missing, never their values', async () => {
    const state = (await (await get(workspace('/run'))).json()) as RunState;
    expect(state).toMatchObject({
      docker: false,
      plan: { packageManager: 'npm', main: 'dev', installed: false, compose: null },
      processes: [],
    });
    // SECRET is set in the folder's .env; only API_KEY is missing.
    expect(state.plan.missing).toEqual([
      { name: 'API_KEY', listedIn: '.env.example', file: '.env', required: null },
    ]);
    expect(JSON.stringify(state)).not.toContain('SECRET=1');
  });

  it('starts a script from the page, and streams its card and output to our own page only', async () => {
    const refused = new WebSocket(socketUrl('/run/events'), {
      headers: { cookie, origin: 'http://evil.example' },
    });
    await expect(opened(refused)).rejects.toThrow();
    const socket = new WebSocket(socketUrl('/run/events'), {
      headers: { cookie, origin: server.origin },
    });
    const events: { type: string; process?: { state: string; ports: number[] }; text?: string }[] =
      [];
    socket.on('message', (data: Buffer) =>
      events.push(JSON.parse(data.toString()) as (typeof events)[number]),
    );
    await opened(socket);

    expect(
      (await send('POST', workspace('/run/start'), { kind: 'script', script: 'nope' })).status,
    ).toBe(409);
    const started = await send('POST', workspace('/run/start'), { kind: 'script', script: 'dev' });
    expect(started.status).toBe(200);
    const { process } = (await started.json()) as { process: { id: string; command: string } };
    expect(process.command).toBe('npm run dev');
    await expect
      .poll(() => events.some((e) => e.type === 'process' && e.process?.state === 'finished'), {
        timeout: 10_000,
      })
      .toBe(true);
    expect(events.some((e) => e.text?.includes('ready on') === true)).toBe(true);
    const { log } = (await (await get(workspace(`/run/processes/${process.id}/log`))).json()) as {
      log: string;
    };
    expect(log).toContain('ready on');
    expect((await send('POST', workspace('/run/start'), { kind: 'services' })).status).toBe(409);
    socket.close();
  }, 20_000);

  it('writes a missing variable into the .env beside the example, and nowhere else', async () => {
    const outside = await send('PUT', workspace('/run/env'), {
      file: '../x/.env',
      name: 'API_KEY',
      value: 'v',
    });
    expect(outside.status).toBe(409);
    const set = await send('PUT', workspace('/run/env'), {
      file: '.env',
      name: 'API_KEY',
      value: 'key-value-1',
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as RunState).plan.missing).toEqual([]);
    expect(readFileSync(join(folder, '.env'), 'utf8')).toBe('SECRET=1\nAPI_KEY=key-value-1\n');
    // It's there already, so it isn't started again from the example.
    expect((await send('POST', workspace('/run/env-file'), { file: '.env' })).status).toBe(409);
  });

  it('opens a terminal in the folder over a WebSocket: bytes both ways, resizes, and the exit code', async () => {
    const noSize = new WebSocket(socketUrl('/terminal'), {
      headers: { cookie, origin: server.origin },
    });
    await expect(opened(noSize)).rejects.toThrow();
    const socket = new WebSocket(socketUrl('/terminal?cols=80&rows=24'), {
      headers: { cookie, origin: server.origin },
    });
    const frames: (string | Buffer)[] = [];
    socket.on('message', (data: Buffer, binary: boolean) =>
      frames.push(binary ? data : data.toString()),
    );
    await opened(socket);
    socket.send(Buffer.from('ls\r'), { binary: true });
    socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    await expect.poll(() => typed).toEqual(['ls\r']);
    await expect.poll(() => resized).toEqual([[120, 40]]);
    print('file.txt\r\n');
    await expect
      .poll(() => frames.some((f) => Buffer.isBuffer(f) && f.toString() === 'file.txt\r\n'))
      .toBe(true);
    const closed = new Promise<void>((resolve) =>
      socket.on('close', () => {
        resolve();
      }),
    );
    exitShell(0);
    await closed;
    expect(frames).toContain(JSON.stringify({ type: 'exit', code: 0 }));
  });
});
