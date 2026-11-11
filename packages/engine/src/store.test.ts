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
