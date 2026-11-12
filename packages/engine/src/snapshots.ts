// The flow graph's versions on disk (phase 6, ADR 0027 §5): one SQLite file of its own, beside the index, so the
// index can be rebuilt without losing history. Each version is the graph's compact encoding, gzipped, named by the
// SHA-256 of the encoding: the same graph is stored once.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeGraph, type Graph } from '@flowcanvas/graph-model';

/** Raise when the table changes: snapshots under another format are dropped (the next pass makes a new one). */
export const SNAPSHOT_STORE_FORMAT = 1;
/** Versions kept; checkpoints that pin their own arrive in stage 3. */
export const SNAPSHOTS_KEPT = 20;

export interface SnapshotMeta {
  readonly version: string;
  readonly takenAt: string;
  readonly complete: boolean;
  readonly note: string | null;
  readonly files: number;
  readonly builtInCalls: number;
}

const SCHEMA = `
  CREATE TABLE snapshots (
    version TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    taken_at TEXT NOT NULL,
    complete INTEGER NOT NULL,
    note TEXT,
    files INTEGER NOT NULL,
    built_in_calls INTEGER NOT NULL,
    data BLOB NOT NULL
  );
  CREATE INDEX snapshots_seq ON snapshots (seq);
`;

const metaOf = (row: Record<string, unknown>): SnapshotMeta => ({
  version: String(row.version),
  takenAt: String(row.taken_at),
  complete: row.complete === 1,
  note: typeof row.note === 'string' ? row.note : null,
  files: Number(row.files),
  builtInCalls: Number(row.built_in_calls),
});

export class SnapshotStore {
  readonly #db: DatabaseSync;

  /** Opens (or creates) the store at `file`; `:memory:` for tests. */
  constructor(file: string) {
    this.#db = new DatabaseSync(file);
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    const current = this.#db.prepare('PRAGMA user_version').get()?.user_version;
    if (current !== SNAPSHOT_STORE_FORMAT) {
      this.#db.exec('DROP TABLE IF EXISTS snapshots');
      this.#db.exec(SCHEMA);
      this.#db.exec(`PRAGMA user_version = ${String(SNAPSHOT_STORE_FORMAT)}`);
    }
  }

  /**
   * Stores a graph's encoding (`encodeGraph`) as the latest version, and keeps the last `SNAPSHOTS_KEPT`. An encoding
   * already stored becomes the latest again, with its new time, rather than a second copy.
   */
  save(
    encoded: string,
    details: Omit<SnapshotMeta, 'version' | 'takenAt'>,
    takenAt = new Date(),
  ): { readonly meta: SnapshotMeta; readonly ms: number } {
    const started = performance.now();
    const version = createHash('sha256').update(encoded).digest('hex');
    const seq =
      Number(this.#db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM snapshots').get()?.seq) + 1;
    const known = this.#db.prepare('SELECT 1 FROM snapshots WHERE version = ?').get(version);
    if (known === undefined) {
      this.#db
        .prepare(
          `INSERT INTO snapshots (version, seq, taken_at, complete, note, files, built_in_calls, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          version,
          seq,
          takenAt.toISOString(),
          details.complete ? 1 : 0,
          details.note,
          details.files,
          details.builtInCalls,
          gzipSync(encoded, { level: 1 }),
        );
    } else {
      this.#db
        .prepare('UPDATE snapshots SET seq = ?, taken_at = ? WHERE version = ?')
        .run(seq, takenAt.toISOString(), version);
    }
    this.#db
      .prepare(
        `DELETE FROM snapshots WHERE seq NOT IN (SELECT seq FROM snapshots ORDER BY seq DESC LIMIT ?)`,
      )
      .run(SNAPSHOTS_KEPT);
    const meta: SnapshotMeta = { version, takenAt: takenAt.toISOString(), ...details };
    return { meta, ms: performance.now() - started };
  }

  /** The latest version's details, without loading its graph. */
  latest(): SnapshotMeta | undefined {
    const row = this.#db
      .prepare(
        'SELECT version, taken_at, complete, note, files, built_in_calls FROM snapshots ORDER BY seq DESC LIMIT 1',
      )
      .get();
    return row === undefined ? undefined : metaOf(row);
  }

  /** The versions kept, latest first. */
  versions(): string[] {
    return this.#db
      .prepare('SELECT version FROM snapshots ORDER BY seq DESC')
      .all()
      .map((row) => String(row.version));
  }

  /** A version's graph, decoded and checked against the schema; and how long that took. */
  load(version: string): { readonly graph: Graph; readonly ms: number } | undefined {
    const started = performance.now();
    const row = this.#db.prepare('SELECT data FROM snapshots WHERE version = ?').get(version);
    if (row === undefined) return undefined;
    const graph = decodeGraph(gunzipSync(row.data as Uint8Array).toString('utf8'));
    return { graph, ms: performance.now() - started };
  }

  close(): void {
    this.#db.close();
  }
}
