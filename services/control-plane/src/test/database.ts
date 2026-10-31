// A fresh in-process Postgres (PGlite) with the real migrations applied, for tests that run real SQL.
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../db/database.js';
import { loadMigrations } from '../db/migration-files.js';
import { migrate } from '../db/migrations.js';

export async function migratedDatabase(): Promise<Database> {
  const pg = await PGlite.create();
  const db: Database = {
    query: async <Row>(sql: string, params: readonly unknown[] = []) =>
      (await pg.query<Row>(sql, [...params])).rows,
  };
  await migrate(
    {
      exec: async (sql) => {
        await pg.exec(sql);
      },
      query: db.query,
    },
    loadMigrations(),
  );
  return db;
}
