import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { encodeGraph, type Graph } from '@flowcanvas/graph-model';
import { afterEach, describe, expect, it } from 'vitest';
import { SNAPSHOTS_KEPT, SNAPSHOT_STORE_FORMAT, SnapshotStore } from './snapshots.js';

const graphOf = (name: string): Graph => ({
  nodes: [
    {
      id: `src/a.ts#${name}`,
      kind: 'code-unit',
      name,
      place: { path: 'src/a.ts', line: 1, column: 17 },
      unit: 'function',
      change: 'unchanged',
    },
  ],
  edges: [
    {
      from: `src/a.ts#${name}`,
      to: null,
      target: 'prisma.poll.create',
      kind: 'call',
      relation: 'calls',
      provenance: 'unknown',
      lines: [2],
    },
  ],
});
const details = { complete: true, note: null, files: 1, builtInCalls: 3 };

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('SnapshotStore', () => {
  it('saves a version named by its encoding’s SHA-256, and loads the same graph back', () => {
    const store = new SnapshotStore(':memory:');
    const encoded = encodeGraph(graphOf('createPoll'));
    const { meta, ms } = store.save(encoded, details, new Date('2026-11-12T10:00:00Z'));
    expect(meta).toEqual({
      version: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      takenAt: '2026-11-12T10:00:00.000Z',
      ...details,
    });
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(store.latest()).toEqual(meta);
    expect(store.load(meta.version)?.graph).toEqual(graphOf('createPoll'));
    expect(store.load('0'.repeat(64))).toBeUndefined();
  });

  it('stores the same graph once: saved again, it becomes the latest with its new time', () => {
    const store = new SnapshotStore(':memory:');
    const a = store.save(encodeGraph(graphOf('a')), details).meta;
    const b = store.save(encodeGraph(graphOf('b')), details).meta;
    const again = store.save(encodeGraph(graphOf('a')), details, new Date('2030-01-01T00:00:00Z'));
    expect(again.meta.version).toBe(a.version);
    expect(store.versions()).toEqual([a.version, b.version]);
    expect(store.latest()?.takenAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it(`keeps the last ${String(SNAPSHOTS_KEPT)} versions`, () => {
    const store = new SnapshotStore(':memory:');
    const versions = Array.from(
      { length: SNAPSHOTS_KEPT + 3 },
      (_, i) => store.save(encodeGraph(graphOf(`f${String(i)}`)), details).meta.version,
    );
    expect(store.versions()).toEqual(versions.slice(3).reverse());
  });

  it('keeps versions across a reopen, and drops them under another format', () => {
    dir = mkdtempSync(join(tmpdir(), 'fc-snapshots-'));
    const file = join(dir, 'graph.db');
    const first = new SnapshotStore(file);
    const { meta } = first.save(encodeGraph(graphOf('kept')), details);
    first.close();
    const second = new SnapshotStore(file);
    expect(second.latest()).toEqual(meta);
    second.close();
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${String(SNAPSHOT_STORE_FORMAT + 1)}`);
    raw.close();
    const third = new SnapshotStore(file);
    expect(third.latest()).toBeUndefined();
    third.close();
  });

  it('refuses a stored version that isn’t a valid graph', () => {
    dir = mkdtempSync(join(tmpdir(), 'fc-snapshots-'));
    const file = join(dir, 'graph.db');
    const store = new SnapshotStore(file);
    const { version } = store.save(encodeGraph(graphOf('ok')), details).meta;
    store.close();
    // Corrupted in place, as a broken disk could: an edge from a node that isn't there.
    const raw = new DatabaseSync(file);
    raw
      .prepare('UPDATE snapshots SET data = ? WHERE version = ?')
      .run(gzipSync('{"format":1,"nodes":[],"texts":["x"],"edges":[[0,-1,0,0,0,4,[1]]]}'), version);
    raw.close();
    const reopened = new SnapshotStore(file);
    expect(() => reopened.load(version)).toThrow('Bad node index 0');
    reopened.close();
  });
});
