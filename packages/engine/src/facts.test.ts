import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { FACTS_FORMAT, FactsStore, contentHash } from './facts.js';
import type { NodeDetails } from './protocol.js';
import type { UnitFacts } from './semantics/details.js';

const none = { items: [], total: 0 };
const details = (id: string): NodeDetails => ({
  id,
  name: id.split('#')[1] ?? id,
  unit: 'function',
  place: { path: 'a.ts', line: 1, column: 1 },
  signature: null,
  params: none,
  returns: null,
  async: false,
  exported: false,
  decisions: none,
  throws: none,
  awaits: none,
  unresolved: none,
  writes: none,
});
const unit = (id: string, start: [number, number], end: [number, number]): UnitFacts => ({
  id,
  start,
  end,
  details: details(id),
});
// a.ts: the top level (lines 1-20); outer (2:1-10:2) holds inner (4:3-6:4); later (12:1-14:2).
const units = [
  unit('a.ts#(top level)', [1, 1], [20, 1]),
  unit('a.ts#outer', [2, 1], [10, 2]),
  unit('a.ts#outer.inner', [4, 3], [6, 4]),
  unit('a.ts#later', [12, 1], [14, 2]),
];

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('FactsStore', () => {
  it('keeps each file’s units, and finds the innermost one at a place', () => {
    const store = new FactsStore(':memory:');
    store.put('a.ts', { hash: 'h', units });
    expect(store.units('a.ts')).toBeUndefined();
    store.flush();
    expect(store.units('a.ts')).toEqual(units);
    const at = (line: number, column: number) => store.unitAt('a.ts', line, column)?.id;
    expect(at(1, 1)).toBe('a.ts#(top level)');
    expect(at(2, 1)).toBe('a.ts#outer');
    expect(at(4, 3)).toBe('a.ts#outer.inner');
    expect(at(6, 3)).toBe('a.ts#outer.inner');
    // An end is just past the unit's last character.
    expect(at(6, 4)).toBe('a.ts#outer');
    expect(at(11, 1)).toBe('a.ts#(top level)');
    expect(at(13, 5)).toBe('a.ts#later');
    expect(store.unitAt('b.ts', 1, 1)).toBeUndefined();
    expect(store.details('a.ts#outer.inner')).toEqual(details('a.ts#outer.inner'));
    expect(store.details('a.ts#gone')).toBeUndefined();
    store.close();
  });

  it('forgets a file that’s gone, and after a whole pass keeps only the files it walked', () => {
    const store = new FactsStore(':memory:');
    store.put('a.ts', { hash: 'h', units });
    store.put('b.ts', { hash: 'h', units: [unit('b.ts#(top level)', [1, 1], [2, 1])] });
    store.put('c.ts', { hash: 'h', units: [unit('c.ts#(top level)', [1, 1], [2, 1])] });
    store.flush();
    store.put('b.ts', null);
    store.flush();
    expect(store.units('b.ts')).toBeUndefined();
    store.keepOnly(new Set(['a.ts']));
    expect(store.units('a.ts')).toBeDefined();
    expect(store.units('c.ts')).toBeUndefined();
    store.close();
  });

  it('is written by one connection (the worker) and read by another (the engine), which forgets after a pass', () => {
    dir = mkdtempSync(join(tmpdir(), 'fc-facts-'));
    const file = join(dir, 'facts.db');
    const reader = new FactsStore(file);
    const writer = new FactsStore(file);
    writer.put('a.ts', { hash: 'h', units });
    writer.flush();
    expect(reader.unitAt('a.ts', 13, 5)?.id).toBe('a.ts#later');
    writer.put('a.ts', { hash: 'h', units: [unit('a.ts#(top level)', [1, 1], [20, 1])] });
    writer.flush();
    // Its decoded copy is the pass before's until it's told a pass finished.
    expect(reader.unitAt('a.ts', 13, 5)?.id).toBe('a.ts#later');
    reader.forget();
    expect(reader.unitAt('a.ts', 13, 5)?.id).toBe('a.ts#(top level)');
    reader.close();
    writer.close();
  });

  it('with the project’s folder, answers only for a file still the text its facts came from', () => {
    dir = mkdtempSync(join(tmpdir(), 'fc-facts-'));
    const root = join(dir, 'project');
    mkdirSync(root);
    writeFileSync(join(root, 'a.ts'), '\uFEFFexport function later() {}\n');
    const store = new FactsStore(':memory:', { root });
    // The hash the pass takes of TypeScript's text, which has no byte-order mark.
    store.put('a.ts', { hash: contentHash('export function later() {}\n'), units });
    store.flush();
    expect(store.unitAt('a.ts', 13, 5)?.id).toBe('a.ts#later');
    writeFileSync(join(root, 'a.ts'), 'export function later() { return 1; }\n');
    expect(store.unitAt('a.ts', 13, 5)).toBeUndefined();
    expect(store.details('a.ts#later')).toBeUndefined();
    rmSync(join(root, 'a.ts'));
    expect(store.units('a.ts')).toBeUndefined();
    store.close();
  });

  it('knows which files call a place, by their stored calls, and forgets a caller that’s rewritten or gone', () => {
    const store = new FactsStore(':memory:');
    const callee = (line: number, hierarchy: boolean) => ({
      name: 'save',
      kind: 'function' as const,
      container: null,
      place: { path: 'db.ts', line, column: 17 },
      builtIn: false,
      relation: 'calls' as const,
      provenance: 'resolved' as const,
      sites: [{ path: 'b.ts', line: 3, column: 5 }],
      hierarchy,
    });
    const calling = (path: string, callees: ReturnType<typeof callee>[]) => ({
      hash: 'h',
      units: [
        {
          ...unit(`${path}#(top level)`, [1, 1], [9, 1]),
          calls: {
            item: { name: path, kind: null, container: null, place: null, builtIn: false },
            callees,
            complete: true,
          },
        },
      ],
    });
    store.put('b.ts', calling('b.ts', [callee(1, true)]));
    store.put('c.ts', calling('c.ts', [callee(1, true), callee(5, false)]));
    store.flush();
    expect(store.callerFiles({ path: 'db.ts', line: 1, column: 17 })).toEqual(['b.ts', 'c.ts']);
    // Only what TypeScript's call hierarchy gave has callers.
    expect(store.callerFiles({ path: 'db.ts', line: 5, column: 17 })).toEqual([]);
    store.put('b.ts', calling('b.ts', []));
    store.put('c.ts', null);
    store.flush();
    expect(store.callerFiles({ path: 'db.ts', line: 1, column: 17 })).toEqual([]);
    store.close();
  });

  it('drops rows in an older format', () => {
    dir = mkdtempSync(join(tmpdir(), 'fc-facts-'));
    const file = join(dir, 'facts.db');
    const store = new FactsStore(file);
    store.put('a.ts', { hash: 'h', units });
    store.flush();
    store.close();
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${String(FACTS_FORMAT - 1)}`);
    raw.close();
    const reopened = new FactsStore(file);
    expect(reopened.units('a.ts')).toBeUndefined();
    reopened.close();
  });
});
