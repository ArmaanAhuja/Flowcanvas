// Applies the real migrations to a fresh in-process Postgres (PGlite) per test and checks the schema's rules.
// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';
import { checksum, migrate, orderMigrations, type MigrationDatabase } from './migrations.js';

let pg: PGlite;
let db: MigrationDatabase;

function adapter(instance: PGlite): MigrationDatabase {
  return {
    exec: async (sql) => {
      await instance.exec(sql);
    },
    query: async <Row>(sql: string, params: readonly unknown[] = []) =>
      (await instance.query<Row>(sql, [...params])).rows,
  };
}

beforeEach(async () => {
  pg = await PGlite.create();
  db = adapter(pg);
});

async function migrated(): Promise<void> {
  await migrate(db, loadMigrations());
}

async function user(email = 'ada@example.com'): Promise<string> {
  const rows = await db.query<{ id: string }>(
    "insert into users (email, display_name) values ($1, 'Ada') returning id",
    [email],
  );
  return rows[0]?.id ?? '';
}

async function project(ownerId: string, name = 'Rallly'): Promise<string> {
  const rows = await db.query<{ id: string }>(
    'insert into projects (owner_id, name) values ($1, $2) returning id',
    [ownerId, name],
  );
  return rows[0]?.id ?? '';
}

const bytes = (length: number) => new Uint8Array(length).fill(7);

describe('migration runner', () => {
  it('applies every migration once, in order, and records checksums', async () => {
    const first = await migrate(db, loadMigrations());
    const all = ['0001_initial', '0002_workspace_for_every_project'];
    expect(first.applied).toEqual(all);
    const second = await migrate(db, loadMigrations());
    expect(second).toEqual({ applied: [], alreadyApplied: all });
    const rows = await db.query<{ checksum: string }>('select checksum from schema_migrations');
    expect(rows[0]?.checksum).toBe(checksum(loadMigrations()[0]?.sql ?? ''));
  });

  it('gives projects made before 0002 their workspace record', async () => {
    const [initial, ...later] = loadMigrations();
    if (initial === undefined) throw new Error('no migrations');
    await migrate(db, [initial]);
    const projectId = await project(await user());
    await migrate(db, [initial, ...later]);
    expect(await db.query('select project_id, state from workspaces')).toEqual([
      { project_id: projectId, state: 'not_created' },
    ]);
  });

  it('refuses to run when an applied migration was edited', async () => {
    await migrated();
    const edited = loadMigrations().map((m) => ({ ...m, sql: `${m.sql}\n-- edited` }));
    await expect(migrate(db, edited)).rejects.toThrow('changed after it was applied');
  });

  it('refuses a database that has a migration this code does not know', async () => {
    await migrated();
    await db.query("insert into schema_migrations (version, checksum) values ('9999_future', 'x')");
    await expect(migrate(db, loadMigrations())).rejects.toThrow('which this code doesn');
  });

  it('rolls a failing migration back completely', async () => {
    const broken = orderMigrations([
      { name: '0001_half.sql', sql: 'create table half (id int); select * from missing_table;' },
    ]);
    await expect(migrate(db, broken)).rejects.toThrow('0001_half failed and was rolled back');
    const tables = await db.query("select 1 from pg_tables where tablename = 'half'");
    const recorded = await db.query('select 1 from schema_migrations');
    expect(tables).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('rejects badly named or duplicate-numbered files', () => {
    expect(() => orderMigrations([{ name: 'initial.sql', sql: '' }])).toThrow('must be named');
    expect(() =>
      orderMigrations([
        { name: '0001_a.sql', sql: '' },
        { name: '0001_b.sql', sql: '' },
      ]),
    ).toThrow('two migrations are numbered 0001');
  });
});

describe('schema rules', () => {
  beforeEach(migrated);

  it('stores emails in lower case only, one user per email', async () => {
    await expect(user('Ada@Example.com')).rejects.toThrow(/check constraint/);
    await user('ada@example.com');
    await expect(user('ada@example.com')).rejects.toThrow(/duplicate key/);
  });

  it('links each external account to exactly one user', async () => {
    const id = await user();
    const link = 'insert into identities (user_id, provider, provider_user_id) values ($1, $2, $3)';
    await db.query(link, [id, 'github', '42']);
    await expect(db.query(link, [id, 'github', '42'])).rejects.toThrow(/duplicate key/);
    await expect(db.query(link, [id, 'gitlab', '7'])).rejects.toThrow(/check constraint/);
  });

  it('stores sessions only as 32-byte hashes that expire after they start', async () => {
    const id = await user();
    const insert =
      "insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '7 days')";
    await db.query(insert, [bytes(32), id]);
    await expect(db.query(insert, [bytes(16), id])).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        "insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() - interval '1 second')",
        [bytes(32).fill(9), id],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('keeps project names trimmed and unique per owner, not globally', async () => {
    const ada = await user('ada@example.com');
    const grace = await user('grace@example.com');
    await project(ada, 'Rallly');
    await expect(project(ada, 'Rallly')).rejects.toThrow(/duplicate key/);
    await expect(project(ada, ' padded ')).rejects.toThrow(/check constraint/);
    await expect(project(grace, 'Rallly')).resolves.toBeTruthy();
  });

  it('accepts only environment-variable-style secret names, 12-byte IVs, one value per name', async () => {
    const id = await project(await user());
    const insert =
      'insert into project_secrets (project_id, name, ciphertext, iv) values ($1, $2, $3, $4)';
    await db.query(insert, [id, 'DATABASE_URL', bytes(40), bytes(12)]);
    await expect(db.query(insert, [id, 'DATABASE_URL', bytes(40), bytes(12)])).rejects.toThrow(
      /duplicate key/,
    );
    for (const bad of ['database_url', '1KEY', 'KEY-NAME', '']) {
      await expect(db.query(insert, [id, bad, bytes(40), bytes(12)])).rejects.toThrow(
        /check constraint/,
      );
    }
    await expect(db.query(insert, [id, 'API_KEY', bytes(40), bytes(16)])).rejects.toThrow(
      /check constraint/,
    );
  });

  it('deleting a user removes everything they own', async () => {
    const id = await user();
    const projectId = await project(id);
    await db.query(
      'insert into identities (user_id, provider, provider_user_id) values ($1, $2, $3)',
      [id, 'google', 'g-1'],
    );
    await db.query(
      "insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')",
      [bytes(32), id],
    );
    await db.query('insert into workspaces (project_id) values ($1)', [projectId]);
    await db.query(
      'insert into project_keys (project_id, wrapped_key, wrap_iv, key_version) values ($1, $2, $3, 1)',
      [projectId, bytes(48), bytes(12)],
    );
    await db.query(
      'insert into project_secrets (project_id, name, ciphertext, iv) values ($1, $2, $3, $4)',
      [projectId, 'API_KEY', bytes(40), bytes(12)],
    );

    await db.query('delete from users where id = $1', [id]);
    for (const table of [
      'identities',
      'sessions',
      'projects',
      'workspaces',
      'project_keys',
      'project_secrets',
    ]) {
      expect(await db.query(`select 1 from ${table}`), table).toEqual([]);
    }
  });

  it('records usage only with non-negative amounts over valid periods', async () => {
    const id = await user();
    const insert =
      'insert into usage_records (user_id, kind, quantity, started_at, ended_at) values ($1, $2, $3, $4, $5)';
    await db.query(insert, [
      id,
      'workspace_seconds',
      600,
      '2026-10-30T10:00:00Z',
      '2026-10-30T10:10:00Z',
    ]);
    await expect(
      db.query(insert, [
        id,
        'workspace_seconds',
        -1,
        '2026-10-30T10:00:00Z',
        '2026-10-30T10:10:00Z',
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(insert, [
        id,
        'workspace_seconds',
        1,
        '2026-10-30T10:10:00Z',
        '2026-10-30T10:00:00Z',
      ]),
    ).rejects.toThrow(/check constraint/);
  });

  it('keeps allowlist emails in lower case', async () => {
    await expect(
      db.query("insert into sign_in_allowlist (email) values ('Ada@Example.com')"),
    ).rejects.toThrow(/check constraint/);
    await db.query(
      "insert into sign_in_allowlist (email, role) values ('ada@example.com', 'admin')",
    );
  });
});
