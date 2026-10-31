/**
 * Database commands for the control plane, against the database in DATABASE_URL.
 * Locally DATABASE_URL comes from the repo's .dev.vars (your Neon `dev` branch); an exported
 * DATABASE_URL takes precedence (for example staging, entered with `read -s`).
 *
 *   pnpm db:status                         which migrations are applied and pending
 *   pnpm db:migrate                        apply pending migrations
 *   pnpm db:allow you@example.com [--admin]   let an email sign in (and make it an admin)
 */
import { Client } from '@neondatabase/serverless';
import { loadMigrations } from '../src/db/migration-files.js';
import { checksum, migrate, type MigrationDatabase } from '../src/db/migrations.js';

function fail(message: string): never {
  console.error(`db: ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === '') {
  fail('DATABASE_URL is not set (expected in .dev.vars, or exported for this command)');
}
// Show where we're connected without the password.
const target = new URL(databaseUrl);
console.log(`Database: ${target.hostname}${target.pathname}`);

const client = new Client(databaseUrl);
await client.connect();
const db: MigrationDatabase = {
  exec: async (sql) => {
    await client.query(sql);
  },
  query: async <Row>(sql: string, params: readonly unknown[] = []) =>
    (await client.query(sql, [...params])).rows as Row[],
};

try {
  const [command, ...args] = process.argv.slice(2);
  const migrations = loadMigrations();
  if (command === 'migrate') {
    const report = await migrate(db, migrations);
    console.log(
      report.applied.length === 0
        ? 'Up to date: nothing to apply.'
        : `Applied: ${report.applied.join(', ')}`,
    );
  } else if (command === 'status') {
    await db.exec(
      'create table if not exists schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())',
    );
    const rows = await db.query<{ version: string; checksum: string }>(
      'select version, checksum from schema_migrations',
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));
    for (const migration of migrations) {
      const recorded = applied.get(migration.version);
      const state =
        recorded === undefined
          ? 'pending'
          : recorded === checksum(migration.sql)
            ? 'applied'
            : 'CHANGED since applied';
      console.log(`  ${migration.version}  ${state}`);
    }
  } else if (command === 'allow') {
    const email = args.find((arg) => !arg.startsWith('--'))?.toLowerCase();
    if (email === undefined || !/^[^@\s]+@[^@\s]+$/.test(email))
      fail('usage: db:allow <email> [--admin]');
    const role = args.includes('--admin') ? 'admin' : 'member';
    await db.query(
      `insert into sign_in_allowlist (email, role) values ($1, $2)
       on conflict (email) do update set role = excluded.role`,
      [email, role],
    );
    console.log(`Allowed ${email} as ${role}.`);
  } else {
    fail('usage: db.ts migrate | status | allow <email> [--admin]');
  }
} finally {
  await client.end();
}
