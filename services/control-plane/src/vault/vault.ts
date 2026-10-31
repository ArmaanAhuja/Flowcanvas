import type { Database } from '../db/database.js';
import {
  decryptValue,
  encryptValue,
  MASTER_KEY_VERSION,
  newWrappedDataKey,
  unwrapDataKey,
  type AesKey,
  type Sealed,
} from './crypto.js';

/** What anyone can see about a secret: never its value. */
export interface SecretInfo {
  readonly name: string;
  /** Who first saved it; null if that person's account was deleted. */
  readonly addedBy: string | null;
  /** ISO 8601, UTC. */
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const SECRET_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
/** 64 KiB of UTF-8; the schema allows the ciphertext 16 bytes more (the GCM tag). */
export const VALUE_MAX_BYTES = 65_536;

export interface SecretProblem {
  readonly field: 'name' | 'value';
  readonly message: string;
}

export function checkSecretName(name: string): SecretProblem | undefined {
  return SECRET_NAME.test(name)
    ? undefined
    : {
        field: 'name',
        message:
          'Use capital letters, digits and underscores, starting with a letter or underscore (like DATABASE_URL).',
      };
}

export function checkSecretValue(value: unknown): SecretProblem | undefined {
  if (typeof value !== 'string' || value === '') {
    return { field: 'value', message: 'Enter the secret’s value.' };
  }
  if (new TextEncoder().encode(value).length > VALUE_MAX_BYTES) {
    return { field: 'value', message: 'Keep the value under 64 KB.' };
  }
  return undefined;
}

/** The project's data key, creating it on first use. Concurrent first uses agree on one key. */
async function dataKey(db: Database, master: AesKey, projectId: string): Promise<AesKey> {
  const read = () =>
    db.query<Sealed>(
      `select encode(wrapped_key, 'hex') as ciphertext, encode(wrap_iv, 'hex') as iv
       from project_keys where project_id = $1`,
      [projectId],
    );
  let wrapped = (await read())[0];
  if (wrapped === undefined) {
    const fresh = await newWrappedDataKey(master, projectId);
    // If another request created the key meanwhile, theirs stays and we read it back.
    await db.query(
      `insert into project_keys (project_id, wrapped_key, wrap_iv, key_version)
       values ($1, decode($2, 'hex'), decode($3, 'hex'), $4)
       on conflict (project_id) do nothing`,
      [projectId, fresh.ciphertext, fresh.iv, MASTER_KEY_VERSION],
    );
    wrapped = (await read())[0];
    if (wrapped === undefined) throw new Error('project key missing after insert');
  }
  return unwrapDataKey(master, wrapped, projectId);
}

export async function listSecrets(db: Database, projectId: string): Promise<SecretInfo[]> {
  const rows = await db.query<{
    name: string;
    added_by: string | null;
    created_ms: number;
    updated_ms: number;
  }>(
    `select s.name, u.display_name as added_by,
            (extract(epoch from s.created_at) * 1000)::float8 as created_ms,
            (extract(epoch from s.updated_at) * 1000)::float8 as updated_ms
     from project_secrets s left join users u on u.id = s.created_by
     where s.project_id = $1 order by s.name`,
    [projectId],
  );
  return rows.map((row) => ({
    name: row.name,
    addedBy: row.added_by,
    createdAt: new Date(row.created_ms).toISOString(),
    updatedAt: new Date(row.updated_ms).toISOString(),
  }));
}

/** Saves a secret, replacing (rotating) any value with that name. Only ciphertext reaches the database. */
export async function putSecret(
  db: Database,
  master: AesKey,
  secret: {
    readonly projectId: string;
    readonly userId: string;
    readonly name: string;
    readonly value: string;
  },
): Promise<'created' | 'replaced'> {
  const key = await dataKey(db, master, secret.projectId);
  const sealed = await encryptValue(key, secret.value, secret.projectId, secret.name);
  const rows = await db.query<{ created: boolean }>(
    `insert into project_secrets (project_id, name, ciphertext, iv, created_by)
     values ($1, $2, decode($3, 'hex'), decode($4, 'hex'), $5)
     on conflict (project_id, name) do update
       set ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = now()
     returning (xmax = 0) as created`,
    [secret.projectId, secret.name, sealed.ciphertext, sealed.iv, secret.userId],
  );
  return rows[0]?.created === true ? 'created' : 'replaced';
}

export async function deleteSecret(
  db: Database,
  projectId: string,
  name: string,
): Promise<boolean> {
  const rows = await db.query(
    'delete from project_secrets where project_id = $1 and name = $2 returning id',
    [projectId, name],
  );
  return rows.length > 0;
}

/**
 * Decrypts one value. No API route calls this: values are write-only for people. It exists for handing secrets
 * to the project's workspace (phase 1d) and for the tests that prove encryption round-trips.
 */
export async function readSecret(
  db: Database,
  master: AesKey,
  projectId: string,
  name: string,
): Promise<string | undefined> {
  const rows = await db.query<Sealed>(
    `select encode(ciphertext, 'hex') as ciphertext, encode(iv, 'hex') as iv
     from project_secrets where project_id = $1 and name = $2`,
    [projectId, name],
  );
  const sealed = rows[0];
  if (sealed === undefined) return undefined;
  return decryptValue(await dataKey(db, master, projectId), sealed, projectId, name);
}
