import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexable, Indexer, type IndexProgress } from './indexer.js';
import { IndexStore } from './store.js';

let root: string;
let outside: string;
let store: IndexStore;
let indexer: Indexer;

const write = (path: string, content: string | Buffer) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const names = (path: string) => store.symbolsIn(path).map((s) => s.name);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'flowcanvas-project-'));
  outside = mkdtempSync(join(tmpdir(), 'flowcanvas-outside-'));
  store = new IndexStore(':memory:');
  indexer = new Indexer({ root, store, batchSize: 2, maxFileBytes: 1000 });
});
afterEach(async () => {
  await indexer.close();
  store.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('Indexer.sync', () => {
  it('parses every file of a shipped grammar and records the rest', async () => {
    write('src/poll.ts', 'export function createPoll() {}');
    write('app/page.tsx', 'export default function Page() { return <main />; }');
    write('README.md', '# Rallly\n');
    write('docs/intro.mdx', '# Intro\n<Note />\n');
    write('styles.css', '.a { color: red; }');
    write('schema.prisma', 'model Poll { id String @id }');
    write('logo.json', Buffer.from([0x7b, 0x00, 0x7d]));
    write('big.ts', `export const big = "${'x'.repeat(2000)}";`);
    write('broken.ts', 'export function ok() {}\nconst = ;');
    symlinkSync(join(outside, 'secret.ts'), join(root, 'linked.ts'));
    writeFileSync(join(outside, 'secret.ts'), 'export function leaked() {}');

    const progress: IndexProgress[] = [];
    const files = [
      'src/poll.ts',
      'app/page.tsx',
      'README.md',
      'docs/intro.mdx',
      'styles.css',
      'schema.prisma',
      'logo.json',
      'big.ts',
      'broken.ts',
      'linked.ts',
    ];
    const run = await indexer.sync(files, (p) => progress.push(p));

    expect(run).toMatchObject({ checked: 10, parsed: 6, unchanged: 0, removed: 0 });
    expect(names('src/poll.ts')).toEqual(['createPoll']);
    expect(store.symbolsIn('app/page.tsx')[0]).toMatchObject({ name: 'Page', kind: 'component' });
    expect(names('README.md')).toEqual(['Rallly']);
    expect(store.file('docs/intro.mdx')).toMatchObject({
      status: 'parsed',
      limitation: 'mdx-components',
    });
    expect(store.file('styles.css')).toMatchObject({ status: 'parsed', language: 'css' });
    expect(store.file('schema.prisma')).toMatchObject({ status: 'no-grammar', version: null });
    expect(store.file('logo.json')).toMatchObject({ status: 'binary' });
    expect(store.file('big.ts')).toMatchObject({ status: 'too-large', version: null });
    expect(store.file('broken.ts')).toMatchObject({ status: 'parsed', syntaxErrors: true });
    expect(names('broken.ts')).toEqual(['ok']);
    // A link is never followed, so a file outside the project is never read.
    expect(store.file('linked.ts')).toMatchObject({ status: 'unreadable' });
    expect(names('linked.ts')).toEqual([]);
    expect(progress.at(0)).toEqual({ done: 0, total: 10 });
    expect(progress.at(-1)).toEqual({ done: 10, total: 10 });
  });

  it('parses only new and changed files the second time, and drops removed ones', async () => {
    write('a.ts', 'export function one() {}');
    write('b.ts', 'export function two() {}');
    write('schema.prisma', 'model A {}');
    await indexer.sync(['a.ts', 'b.ts', 'schema.prisma']);

    write('a.ts', 'export function uno() {}');
    write('c.ts', 'export function three() {}');
    const run = await indexer.sync(['a.ts', 'c.ts', 'schema.prisma']);

    expect(run).toMatchObject({ checked: 3, parsed: 2, unchanged: 1, removed: 1 });
    expect(names('a.ts')).toEqual(['uno']);
    expect(names('c.ts')).toEqual(['three']);
    expect(store.paths().sort()).toEqual(['a.ts', 'c.ts', 'schema.prisma']);
  });

  it('treats a rewrite with the same bytes as unchanged', async () => {
    write('a.ts', 'export function one() {}');
    await indexer.sync(['a.ts']);
    write('a.ts', 'export function one() {}');
    expect(await indexer.sync(['a.ts'])).toMatchObject({ parsed: 0, unchanged: 1 });
  });

  it('never stores secret files, ignored folders or paths that leave the project', async () => {
    write('.env', 'DATABASE_URL=postgres://canary');
    write('apps/web/.env.local', 'SECRET=canary');
    write('node_modules/lib/index.ts', 'export function dep() {}');
    write('.env.example', 'DATABASE_URL=');
    const run = await indexer.sync([
      '.env',
      'apps/web/.env.local',
      'node_modules/lib/index.ts',
      '../outside.ts',
      '/etc/passwd',
      '.env.example',
    ]);
    expect(run.checked).toBe(1);
    expect(store.paths()).toEqual(['.env.example']);
  });
});

describe('Indexer.refresh', () => {
  it('re-indexes changed paths and forgets deleted ones', async () => {
    write('a.ts', 'export function one() {}');
    write('b.ts', 'export function two() {}');
    await indexer.sync(['a.ts', 'b.ts']);

    write('a.ts', 'export function one() {}\nexport function added() {}');
    rmSync(join(root, 'b.ts'));
    write('new.ts', 'export const NEW = 1;');
    const run = await indexer.refresh([
      { path: 'a.ts' },
      { path: 'b.ts', deleted: true },
      { path: 'new.ts' },
    ]);

    expect(run).toMatchObject({ checked: 2, parsed: 2, removed: 1 });
    expect(names('a.ts')).toEqual(['one', 'added']);
    expect(names('new.ts')).toEqual(['NEW']);
    expect(store.paths().sort()).toEqual(['a.ts', 'new.ts']);
  });

  it('waits for a running sync instead of writing in the middle of it', async () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${String(i)}.ts`);
    for (const file of files) write(file, 'export const x = 1;');
    write('late.ts', 'export const late = 1;');
    const put = vi.spyOn(store, 'put');
    // batchSize 2: the sync yields between its 10 batches, where an unqueued refresh would write.
    const sync = indexer.sync(files);
    const refresh = indexer.refresh([{ path: 'late.ts' }]);
    await Promise.all([sync, refresh]);
    expect(put.mock.calls.map(([record]) => record.path)).toEqual([...files, 'late.ts']);
  });

  it('waits for a running sync, so the newest content wins', async () => {
    write('a.ts', 'export function first() {}');
    const sync = indexer.sync(['a.ts']);
    write('a.ts', 'export function second() {}');
    const refresh = indexer.refresh([{ path: 'a.ts' }]);
    await Promise.all([sync, refresh]);
    expect(names('a.ts')).toEqual(['second']);
  });

  it('keeps working after a run fails', async () => {
    write('a.ts', 'export function one() {}');
    vi.spyOn(store, 'paths').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(indexer.sync(['a.ts'])).rejects.toThrow('disk full');
    await expect(indexer.sync(['a.ts'])).resolves.toMatchObject({ parsed: 1 });
  });
});

describe('indexable', () => {
  it.each(['src/a.ts', '.env.example', 'docs/env.md', 'a/b/c.json'])('indexes %s', (path) => {
    expect(indexable(path)).toBe(true);
  });
  it.each([
    '.env',
    'apps/web/.env.production',
    '.dev.vars',
    'docs/.env.md', // the agent's rule: anything named .env.<something> but example, sample, template
    'node_modules/x/a.ts',
    'apps/web/.next/server.js',
    '.git/config',
    '../a.ts',
    'src/../../a.ts',
    '/abs.ts',
    'a//b.ts',
    './a.ts',
    '',
  ])('never indexes %s', (path) => {
    expect(indexable(path)).toBe(false);
  });
});
