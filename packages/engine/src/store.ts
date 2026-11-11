// The index on disk: one SQLite database per workspace, in Node's built-in node:sqlite (ADR 0023).
// It's a cache of what the files say, so when its format changes it's simply rebuilt.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Limitation, LanguageId } from './grammars.js';
import type { FileSymbol, SymbolKind } from './symbols.js';

/**
 * Raise this whenever the schema or the extraction rules change: an index written under another
 * format is dropped and rebuilt, because unchanged files would otherwise keep stale symbols.
 */
export const INDEX_FORMAT = 1;

/** What happened to a file. Only `parsed` files have symbols. */
export type FileStatus =
  | 'parsed'
  /** No grammar for it (SQL, images, Prisma…): listed and counted. */
  | 'no-grammar'
  /** Over the size limit, like minified bundles and big lockfiles. */
  | 'too-large'
  /** NUL bytes in its first 8 KB: not text, whatever its extension says. */
  | 'binary'
  /** Couldn't be read (gone, a link, permissions). */
  | 'unreadable';

export interface FileRecord {
  readonly path: string;
  /** SHA-256 of its bytes (the agent's file version, ADR 0022); null when it wasn't read. */
  readonly version: string | null;
  readonly language: LanguageId | null;
  readonly status: FileStatus;
  /** The tree has syntax errors (tree-sitter recovers, so the rest still has its symbols). */
  readonly syntaxErrors: boolean;
  readonly limitation: Limitation | null;
}

export interface StoredSymbol extends FileSymbol {
  readonly path: string;
}

export interface IndexCounts {
  readonly files: number;
  readonly symbols: number;
  readonly byStatus: Readonly<Record<FileStatus, number>>;
  readonly withSyntaxErrors: number;
  readonly partlyRead: number;
}

const SCHEMA = `
  CREATE TABLE files (
    path TEXT PRIMARY KEY,
    version TEXT,
    language TEXT,
    status TEXT NOT NULL,
    syntax_errors INTEGER NOT NULL,
    limitation TEXT
  ) STRICT;
  CREATE TABLE symbols (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL REFERENCES files (path) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    container TEXT,
    line INTEGER NOT NULL,
    column INTEGER NOT NULL,
    exported INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX symbols_by_path ON symbols (path);
  CREATE INDEX symbols_by_name ON symbols (name COLLATE NOCASE);
  -- Any three or more letters of a name find it (step 3's search).
  CREATE VIRTUAL TABLE symbol_names USING fts5 (name, content = 'symbols', content_rowid = 'id', tokenize = 'trigram');
  CREATE TRIGGER symbols_added AFTER INSERT ON symbols BEGIN
    INSERT INTO symbol_names (rowid, name) VALUES (new.id, new.name);
  END;
  CREATE TRIGGER symbols_removed AFTER DELETE ON symbols BEGIN
    INSERT INTO symbol_names (symbol_names, rowid, name) VALUES ('delete', old.id, old.name);
  END;
`;

export class IndexStore {
  readonly #db: DatabaseSync;
  readonly #statements: {
    readonly versionOf: StatementSync;
    readonly putFile: StatementSync;
    readonly dropSymbols: StatementSync;
    readonly addSymbol: StatementSync;
    readonly dropFile: StatementSync;
    readonly paths: StatementSync;
    readonly fileOf: StatementSync;
    readonly symbolsIn: StatementSync;
  };

  /** Opens (or creates) the index at `file`; `:memory:` for tests. */
  constructor(file: string) {
    this.#db = new DatabaseSync(file);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);
    this.#migrate();
    this.#statements = {
      versionOf: this.#db.prepare('SELECT version FROM files WHERE path = ?'),
      putFile: this.#db.prepare(
        `INSERT INTO files (path, version, language, status, syntax_errors, limitation)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET version = excluded.version, language = excluded.language,
           status = excluded.status, syntax_errors = excluded.syntax_errors, limitation = excluded.limitation`,
      ),
      dropSymbols: this.#db.prepare('DELETE FROM symbols WHERE path = ?'),
      addSymbol: this.#db.prepare(
        `INSERT INTO symbols (path, name, kind, container, line, column, exported)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      dropFile: this.#db.prepare('DELETE FROM files WHERE path = ?'),
      paths: this.#db.prepare('SELECT path FROM files'),
      fileOf: this.#db.prepare('SELECT * FROM files WHERE path = ?'),
      symbolsIn: this.#db.prepare('SELECT * FROM symbols WHERE path = ? ORDER BY line, column'),
    };
  }

  #migrate(): void {
    const current = this.#db.prepare('PRAGMA user_version').get()?.user_version;
    if (current === INDEX_FORMAT) return;
    // Another format (or a new file): start again. Dropping every table is simpler and safer than
    // migrating a cache that a re-index rebuilds in seconds.
    const tables = this.#db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name));
    this.#db.exec('PRAGMA foreign_keys = OFF');
    for (const table of tables) {
      // Shadow tables go with their FTS table, which may already be gone.
      this.#db.exec(`DROP TABLE IF EXISTS "${table.replaceAll('"', '""')}"`);
    }
    this.#db.exec('DROP TRIGGER IF EXISTS symbols_added; DROP TRIGGER IF EXISTS symbols_removed;');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec(SCHEMA);
    this.#db.exec(`PRAGMA user_version = ${String(INDEX_FORMAT)}`);
  }

  /** The version the index last saw for `path`; undefined when it isn't indexed. */
  versionOf(path: string): string | null | undefined {
    const row = this.#statements.versionOf.get(path);
    return row === undefined ? undefined : (row.version as string | null);
  }

  /** Every indexed path. */
  paths(): string[] {
    return this.#statements.paths.all().map((row) => String(row.path));
  }

  file(path: string): FileRecord | undefined {
    const row = this.#statements.fileOf.get(path);
    if (row === undefined) return undefined;
    return {
      path: String(row.path),
      version: row.version as string | null,
      language: row.language as LanguageId | null,
      status: row.status as FileStatus,
      syntaxErrors: row.syntax_errors === 1,
      limitation: row.limitation as Limitation | null,
    };
  }

  symbolsIn(path: string): StoredSymbol[] {
    return this.#statements.symbolsIn.all(path).map((row) => ({
      path: String(row.path),
      name: String(row.name),
      kind: row.kind as SymbolKind,
      container: row.container as string | null,
      line: Number(row.line),
      column: Number(row.column),
      exported: row.exported === 1,
    }));
  }

  /** Records a file and replaces its symbols. Call inside `transaction`. */
  put(record: FileRecord, symbols: readonly FileSymbol[]): void {
    const s = this.#statements;
    s.putFile.run(
      record.path,
      record.version,
      record.language,
      record.status,
      record.syntaxErrors ? 1 : 0,
      record.limitation,
    );
    s.dropSymbols.run(record.path);
    for (const symbol of symbols) {
      s.addSymbol.run(
        record.path,
        symbol.name,
        symbol.kind,
        symbol.container,
        symbol.line,
        symbol.column,
        symbol.exported ? 1 : 0,
      );
    }
  }

  /** Forgets a file and its symbols. Call inside `transaction`. */
  remove(path: string): void {
    this.#statements.dropFile.run(path);
  }

  /** Runs `work` as one transaction: all of it is written, or none of it. */
  transaction<T>(work: () => T): T {
    this.#db.exec('BEGIN');
    try {
      const result = work();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  counts(): IndexCounts {
    const byStatus: Record<FileStatus, number> = {
      parsed: 0,
      'no-grammar': 0,
      'too-large': 0,
      binary: 0,
      unreadable: 0,
    };
    let files = 0;
    for (const row of this.#db
      .prepare('SELECT status, count(*) AS n FROM files GROUP BY status')
      .all()) {
      const n = Number(row.n);
      byStatus[row.status as FileStatus] = n;
      files += n;
    }
    const one = (sql: string) => Number(this.#db.prepare(sql).get()?.n ?? 0);
    return {
      files,
      symbols: one('SELECT count(*) AS n FROM symbols'),
      byStatus,
      withSyntaxErrors: one('SELECT count(*) AS n FROM files WHERE syntax_errors = 1'),
      partlyRead: one('SELECT count(*) AS n FROM files WHERE limitation IS NOT NULL'),
    };
  }

  close(): void {
    this.#db.close();
  }
}
