import { createHash } from 'node:crypto';

/** The two things the runner needs from a database connection; Neon and PGlite both fit. */
export interface MigrationDatabase {
  /** Runs SQL that may contain several statements (a migration file). */
  readonly exec: (sql: string) => Promise<void>;
  /** Runs one parameterised statement and returns its rows. */
  readonly query: <Row>(sql: string, params?: readonly unknown[]) => Promise<Row[]>;
}

export interface Migration {
  /** e.g. "0001_initial". */
  readonly version: string;
  readonly sql: string;
}

export interface MigrationReport {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Turns migration files into an ordered list, refusing badly named or duplicate-numbered files. */
export function orderMigrations(files: readonly { name: string; sql: string }[]): Migration[] {
  const numbers = new Set<string>();
  return files
    .map(({ name, sql }) => {
      const match = NAME.exec(name);
      if (match?.[1] === undefined) {
        throw new Error(`migration file "${name}" must be named NNNN_lowercase_words.sql`);
      }
      if (numbers.has(match[1])) throw new Error(`two migrations are numbered ${match[1]}`);
      numbers.add(match[1]);
      return { version: name.replace(/\.sql$/, ''), sql };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * Applies pending migrations in order, each in its own transaction, recording version and checksum.
 * Refuses to run if an applied migration's file has changed since (never edit applied migrations).
 */
export async function migrate(
  db: MigrationDatabase,
  migrations: readonly Migration[],
): Promise<MigrationReport> {
  await db.exec(`create table if not exists schema_migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const rows = await db.query<{ version: string; checksum: string }>(
    'select version, checksum from schema_migrations',
  );
  const done = new Map(rows.map((row) => [row.version, row.checksum]));

  for (const migration of migrations) {
    const recorded = done.get(migration.version);
    if (recorded !== undefined && recorded !== checksum(migration.sql)) {
      throw new Error(
        `migration ${migration.version} changed after it was applied; add a new migration instead`,
      );
    }
  }
  const known = new Set(migrations.map((migration) => migration.version));
  for (const version of done.keys()) {
    if (!known.has(version))
      throw new Error(`database has migration ${version}, which this code doesn't know`);
  }

  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.version)) continue;
    await db.exec('begin');
    try {
      await db.exec(migration.sql);
      await db.query('insert into schema_migrations (version, checksum) values ($1, $2)', [
        migration.version,
        checksum(migration.sql),
      ]);
      await db.exec('commit');
    } catch (error) {
      await db.exec('rollback');
      throw new Error(`migration ${migration.version} failed and was rolled back`, {
        cause: error,
      });
    }
    applied.push(migration.version);
  }
  return { applied, alreadyApplied: [...done.keys()].sort() };
}
