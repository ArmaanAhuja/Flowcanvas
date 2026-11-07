import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, parseWatchEvent, type WatchEvent } from './protocol.js';
import { startWatcher, type Watcher, type WatcherOptions } from './watch.js';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

let base: string;
let root: string;
let events: WatchEvent[];
let watcher: Watcher | undefined;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'fc-watch-'));
  root = join(base, 'project');
  await mkdir(join(root, 'src', 'lib'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'react'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{}\n');
  await writeFile(join(root, 'src', 'index.ts'), 'export {};\n');
  await writeFile(join(root, 'src', 'lib', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'node_modules', 'react', 'index.js'), '');
  events = [];
});

afterEach(async () => {
  watcher?.close();
  watcher = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(options: Partial<WatcherOptions> = {}): Promise<void> {
  watcher = await startWatcher({
    root,
    emit: (event) => events.push(event),
    coalesceMs: 20,
    ...options,
  });
}

/** Waits until an event matches, failing after a second. */
async function seen(match: (event: WatchEvent) => boolean): Promise<WatchEvent> {
  const started = Date.now();
  for (;;) {
    const found = events.find(match);
    if (found !== undefined) return found;
    if (Date.now() - started > 1000) throw new Error(`not seen; got ${JSON.stringify(events)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const changedAt = (path: string) => (event: WatchEvent) =>
  event.type === 'changed' && event.path === path && !event.deleted;
const deletedAt = (path: string) => (event: WatchEvent) =>
  event.type === 'changed' && event.path === path && event.deleted;
const quietFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the watcher', () => {
  it('starts by counting what it watches, without node_modules', async () => {
    await start();
    // project, src, src/lib: 3 folders; package.json, index.ts, a.ts.
    expect(events).toEqual([{ type: 'ready', folders: 3, files: 3 }]);
  });

  it('reports an edited file with its new version', async () => {
    await start();
    await writeFile(join(root, 'src', 'lib', 'a.ts'), 'export const a = 2;\n');
    expect(await seen(changedAt('src/lib/a.ts'))).toEqual({
      type: 'changed',
      path: 'src/lib/a.ts',
      deleted: false,
      version: sha('export const a = 2;\n'),
    });
  });

  it('keeps reporting a file that sed -i replaced (a new file renamed over the old one)', async () => {
    await start();
    for (const value of [2, 3]) {
      await writeFile(
        join(root, 'src', 'lib', '.a.ts.tmp'),
        `export const a = ${String(value)};\n`,
      );
      await rename(join(root, 'src', 'lib', '.a.ts.tmp'), join(root, 'src', 'lib', 'a.ts'));
      await seen(
        (event) =>
          event.type === 'changed' &&
          event.path === 'src/lib/a.ts' &&
          event.version === sha(`export const a = ${String(value)};\n`),
      );
    }
  });

  it('watches folders made after it started, and reports what is already in them', async () => {
    await start();
    await mkdir(join(root, 'src', 'features', 'polls'), { recursive: true });
    await writeFile(join(root, 'src', 'features', 'polls', 'poll.ts'), 'one');
    await seen(changedAt('src/features/polls/poll.ts'));
    events = [];
    await writeFile(join(root, 'src', 'features', 'polls', 'poll.ts'), 'two');
    expect(await seen(changedAt('src/features/polls/poll.ts'))).toMatchObject({
      version: sha('two'),
    });
  });

  it('reports a deleted file, and every file of a deleted folder', async () => {
    await start();
    await rm(join(root, 'package.json'));
    await seen(deletedAt('package.json'));
    await rm(join(root, 'src'), { recursive: true });
    await seen(deletedAt('src/index.ts'));
    await seen(deletedAt('src/lib/a.ts'));
    expect(events.filter((event) => event.type === 'changed' && event.deleted)).toHaveLength(3);
  });

  it('says nothing about .env files, node_modules or a rewrite with the same content', async () => {
    await start();
    await writeFile(join(root, '.env'), 'CANARY=1');
    await writeFile(join(root, 'src', '.env.local'), 'CANARY=2');
    await writeFile(join(root, 'node_modules', 'react', 'index.js'), 'changed');
    await mkdir(join(root, 'node_modules', 'new-package'));
    await writeFile(join(root, 'src', 'index.ts'), 'export {};\n');
    await quietFor(200);
    expect(events).toEqual([{ type: 'ready', folders: 3, files: 3 }]);
    expect(JSON.stringify(events)).not.toContain('CANARY');
  });

  it('reports a file too large to read without its version', async () => {
    await start();
    await writeFile(join(root, 'big.json'), Buffer.alloc(LIMITS.fileBytes + 1));
    expect(await seen(changedAt('big.json'))).toMatchObject({ version: null, deleted: false });
  });

  it('turns too many changes at once into one overflow, then keeps up again', async () => {
    await start({ pending: 5 });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeFile(join(root, `f${String(i)}.ts`), String(i))),
    );
    await seen((event) => event.type === 'overflow');
    await quietFor(100);
    expect(events.filter((event) => event.type === 'changed')).toEqual([]);
    events = [];
    // The picture was brought up to date: an edit to a file from the burst is reported.
    await writeFile(join(root, 'f3.ts'), 'edited');
    expect(await seen(changedAt('f3.ts'))).toMatchObject({ version: sha('edited') });
  });

  it('says so when a project has more folders than it may watch', async () => {
    await start({ folders: 2 });
    expect(events).toEqual([
      {
        type: 'error',
        message: 'This project has too many folders to watch them all; some changes won’t show.',
      },
      { type: 'ready', folders: 2, files: 2 },
    ]);
  });
});

describe('parseWatchEvent', () => {
  const version = 'a'.repeat(64);

  it('passes real events on', () => {
    for (const event of [
      { type: 'ready', folders: 3, files: 9 },
      { type: 'changed', path: 'src/a.ts', deleted: false, version },
      { type: 'changed', path: 'src/a.ts', deleted: true, version: null },
      { type: 'changed', path: 'big.json', deleted: false, version: null },
      { type: 'overflow' },
      { type: 'error', message: 'A sentence.' },
    ]) {
      expect(parseWatchEvent(event)).toEqual(event);
    }
  });

  it('refuses anything a workspace could use to mislead the page', () => {
    for (const event of [
      null,
      'changed',
      { type: 'nope' },
      { type: 'changed', path: '../outside', deleted: false, version },
      { type: 'changed', path: '/etc/passwd', deleted: false, version },
      { type: 'changed', path: 'a//b', deleted: false, version },
      { type: 'changed', path: '.env', deleted: false, version },
      { type: 'changed', path: 'src/.env.local', deleted: false, version },
      { type: 'changed', path: 'node_modules/x/index.js', deleted: false, version },
      { type: 'changed', path: 'a.ts', deleted: true, version },
      { type: 'changed', path: 'a.ts', deleted: false, version: 'not-a-version' },
      { type: 'changed', path: 'a.ts', version },
      { type: 'ready', folders: 'many', files: 1 },
      { type: 'error', message: 'x'.repeat(301) },
    ]) {
      expect(parseWatchEvent(event)).toBeUndefined();
    }
  });
});
