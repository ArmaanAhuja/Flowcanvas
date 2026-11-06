// A fresh in-process Postgres (PGlite) with the real migrations applied, for tests that run real SQL.
//
// Starting PGlite is almost all of the cost (about 0.8 s each here, and up to 10 s on a busy 4-core CI runner,
// where setup hooks timed out: phase 1d step 11), while the migrations take next to nothing. So each test file
// starts and migrates one Postgres once, and every test gets its own clone of it (about 0.2 s): just as fresh
// and independent, only faster.
import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import type { Database } from '../db/database.js';
import { loadMigrations } from '../db/migration-files.js';
import { migrate } from '../db/migrations.js';

const asDatabase = (pg: PGliteInterface): Database => ({
  query: async <Row>(sql: string, params: readonly unknown[] = []) =>
    (await pg.query<Row>(sql, [...params])).rows,
});

let template: Promise<PGlite> | undefined;
// Each clone holds its own copy of the database in memory: closed after every test (src/test/setup.ts).
const open = new Set<PGliteInterface>();

/** Closes every database handed out so far. The test setup calls it after each test. */
export async function closeOpenDatabases(): Promise<void> {
  const closing = [...open];
  open.clear();
  await Promise.all(closing.map((pg) => pg.close()));
}

async function migratedTemplate(): Promise<PGlite> {
  const pg = await PGlite.create();
  const db = asDatabase(pg);
  await migrate(
    {
      exec: async (sql) => {
        await pg.exec(sql);
      },
      query: db.query,
    },
    loadMigrations(),
  );
  return pg;
}

export async function migratedDatabase(): Promise<Database> {
  template ??= migratedTemplate();
  const copy = await (await template).clone();
  open.add(copy);
  return asDatabase(copy);
}
