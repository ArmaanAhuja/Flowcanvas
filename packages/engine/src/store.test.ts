import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INDEX_FORMAT, IndexStore, type FileRecord } from './store.js';
import type { FileSymbol } from './symbols.js';

const record = (path: string, extra: Partial<FileRecord> = {}): FileRecord => ({
  path,
  version: 'a'.repeat(64),
  language: 'typescript',
  status: 'parsed',
  syntaxErrors: false,
  limitation: null,
  ...extra,
});
const symbol = (name: string, line = 1): FileSymbol => ({
  name,
  kind: 'function',
  container: null,
  line,
  column: 1,
  exported: true,
});

const folders: string[] = [];
afterEach(() => {
  folders.splice(0).forEach((f) => {
    rmSync(f, { recursive: true, force: true });
  });
});
const tempDb = () => {
  const folder = mkdtempSync(join(tmpdir(), 'flowcanvas-index-'));
  folders.push(folder);
  return join(folder, 'index.db');
};

describe('IndexStore', () => {
  it('stores a file with its symbols and replaces them on the next put', () => {
    const store = new IndexStore(':memory:');
    store.transaction(() => {
      store.put(record('src/a.ts'), [symbol('one', 2), symbol('two', 1)]);
    });
    expect(store.symbolsIn('src/a.ts').map((s) => s.name)).toEqual(['two', 'one']);
    store.transaction(() => {
      store.put(record('src/a.ts', { version: 'b'.repeat(64) }), [symbol('three')]);
    });
    expect(store.symbolsIn('src/a.ts')).toEqual([{ ...symbol('three'), path: 'src/a.ts' }]);
    expect(store.versionOf('src/a.ts')).toBe('b'.repeat(64));
    expect(store.versionOf('src/missing.ts')).toBeUndefined();
    store.close();
  });

  it('removes a file with its symbols, and keeps the full-text index in step', () => {
    const store = new IndexStore(':memory:');
    store.transaction(() => {
      store.put(record('a.ts'), [symbol('createPoll')]);
      store.put(record('b.ts'), [symbol('createPollOption')]);
    });
    store.transaction(() => {
      store.remove('a.ts');
    });
    expect(store.paths()).toEqual(['b.ts']);
    expect(store.counts().symbols).toBe(1);
    store.close();
  });

  it('writes all of a transaction or none of it', () => {
    const store = new IndexStore(':memory:');
    expect(() =>
      store.transaction(() => {
        store.put(record('a.ts'), [symbol('kept')]);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.paths()).toEqual([]);
    store.close();
  });

  it('counts files by status, syntax errors and partly read files', () => {
    const store = new IndexStore(':memory:');
    store.transaction(() => {
      store.put(record('a.ts', { syntaxErrors: true }), [symbol('a')]);
      store.put(record('docs/b.mdx', { language: 'markdown', limitation: 'mdx-components' }), []);
      store.put(
        record('schema.prisma', { version: null, language: null, status: 'no-grammar' }),
        [],
      );
      store.put(record('big.json', { version: null, language: 'json', status: 'too-large' }), []);
    });
    expect(store.counts()).toEqual({
      files: 4,
      symbols: 1,
      byStatus: { parsed: 2, 'no-grammar': 1, 'too-large': 1, binary: 0, unreadable: 0 },
      withSyntaxErrors: 1,
      partlyRead: 1,
    });
    expect(store.file('docs/b.mdx')).toEqual(
      record('docs/b.mdx', { language: 'markdown', limitation: 'mdx-components' }),
    );
    store.close();
  });

  it('keeps the index across reopening', () => {
    const file = tempDb();
    const first = new IndexStore(file);
    first.transaction(() => {
      first.put(record('a.ts'), [symbol('kept')]);
    });
    first.close();
    const second = new IndexStore(file);
    expect(second.symbolsIn('a.ts').map((s) => s.name)).toEqual(['kept']);
    second.close();
  });

  it('rebuilds an index written in another format', () => {
    const file = tempDb();
    const old = new DatabaseSync(file);
    old.exec(
      `CREATE TABLE files (path TEXT); INSERT INTO files VALUES ('stale.ts'); PRAGMA user_version = ${String(INDEX_FORMAT + 1)}`,
    );
    old.close();
    const store = new IndexStore(file);
    expect(store.paths()).toEqual([]);
    store.transaction(() => {
      store.put(record('a.ts'), [symbol('fresh')]);
    });
    expect(store.counts().symbols).toBe(1);
    store.close();
  });
});

describe('IndexStore.search', () => {
  const hit = (name: string, extra: Partial<FileSymbol> = {}): FileSymbol => ({
    ...symbol(name),
    exported: false,
    ...extra,
  });

  function storeWith(entries: Record<string, FileSymbol[]>): IndexStore {
    const store = new IndexStore(':memory:');
    store.transaction(() => {
      for (const [path, symbols] of Object.entries(entries)) store.put(record(path), symbols);
    });
    return store;
  }

  it('ranks an exact name, then a prefix, then a word start, then anywhere', () => {
    const store = storeWith({
      'a.ts': [hit('createPollOption'), hit('pollster'), hit('createPoll')],
      'b.ts': [hit('Poll'), hit('apollo'), hit('poll_id')],
    });
    expect(store.search('poll').map((s) => s.name)).toEqual([
      'Poll',
      'poll_id', // both prefixes: the shorter name first
      'pollster',
      'createPoll',
      'createPollOption',
      'apollo',
    ]);
    store.close();
  });

  it('puts exported symbols first, then by kind, then shorter names', () => {
    const store = storeWith({
      'a.ts': [
        hit('usePollList', { kind: 'function' }),
        hit('usePolls', { kind: 'function', exported: true }),
        hit('usePollCard', { kind: 'component' }),
      ],
    });
    expect(store.search('usepoll').map((s) => s.name)).toEqual([
      'usePolls',
      'usePollList',
      'usePollCard',
    ]);
    store.close();
  });

  it('ignores case, needs every word, and matches short words too', () => {
    const store = storeWith({
      'a.ts': [hit('createPoll'), hit('deletePoll'), hit('createUser'), hit('id'), hit('uuid')],
    });
    expect(store.search('CREATE poll').map((s) => s.name)).toEqual(['createPoll']);
    expect(store.search('id').map((s) => s.name)).toEqual(['id', 'uuid']);
    expect(store.search('   ')).toEqual([]);
    store.close();
  });

  it('takes the query literally: no LIKE wildcards, no full-text syntax', () => {
    const store = storeWith({
      'a.ts': [hit('a_b'), hit('axb'), hit('x%y'), hit('quote"d')],
    });
    expect(store.search('a_b').map((s) => s.name)).toEqual(['a_b']);
    expect(store.search('x%').map((s) => s.name)).toEqual(['x%y']);
    expect(store.search('te"d').map((s) => s.name)).toEqual(['quote"d']);
    expect(() => store.search('AND OR NOT ( * "')).not.toThrow();
    store.close();
  });

  it('returns at most the limit, with path and position', () => {
    const store = storeWith({
      'src/poll.ts': Array.from({ length: 80 }, (_, i) => hit(`poll${String(i)}`, { line: i + 1 })),
    });
    const found = store.search('poll', 5);
    expect(found).toHaveLength(5);
    expect(found[0]).toEqual({
      path: 'src/poll.ts',
      name: 'poll0',
      kind: 'function',
      container: null,
      line: 1,
      column: 1,
      exported: false,
    });
    expect(store.search('poll')).toHaveLength(50);
    store.close();
  });

  it('finds the best matches even past the candidate limit', () => {
    const many = Array.from({ length: 3000 }, (_, i) => hit(`zzpollzz${String(i)}`));
    const store = storeWith({ 'a.ts': [...many, hit('pollExact'), hit('poll')] });
    expect(store.search('poll', 2).map((s) => s.name)).toEqual(['poll', 'pollExact']);
    store.close();
  });

  it('answers within the 100 ms target on 100,000 symbols', () => {
    const words = ['create', 'poll', 'user', 'sign', 'field', 'team', 'use', 'render', 'dialog'];
    const symbols = Array.from({ length: 100_000 }, (_, i) =>
      hit(`${words[i % 9] ?? ''}${(words[(i * 7) % 9] ?? '').toUpperCase()}${String(i)}`),
    );
    const store = storeWith({ 'a.ts': symbols });
    const times = ['po', 'poll', 'create poll', 'usePoll', 'dialog', 'x'].flatMap((q) =>
      Array.from({ length: 10 }, () => {
        const started = performance.now();
        store.search(q);
        return performance.now() - started;
      }),
    );
    times.sort((a, b) => a - b);
    // p95; generous against slow CI machines, still well under 100 ms.
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(100);
    store.close();
  });
});
