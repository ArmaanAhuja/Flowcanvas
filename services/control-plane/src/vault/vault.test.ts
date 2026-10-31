// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/database.js';
import { createProject } from '../projects/projects.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';
import { testVaultKey } from '../test/vault-key.js';
import { importMasterKey, type AesKey } from './crypto.js';
import {
  checkSecretName,
  checkSecretValue,
  deleteSecret,
  listSecrets,
  putSecret,
  readSecret,
} from './vault.js';

const CANARY = 'CANARY-postgres://user:Pa55word@db.internal/app';

let db: Database;
let master: AesKey;
let userId: string;
let projectId: string;

beforeEach(async () => {
  db = await migratedDatabase();
  master = await importMasterKey(testVaultKey());
  userId = (await signedInAs(db, 'ada@example.com')).userId;
  const project = await createProject(db, userId, { name: 'Rallly', repoUrl: null });
  if (project === 'duplicate-name') throw new Error('unexpected duplicate');
  projectId = project.id;
});

async function everyRow(): Promise<string> {
  const tables = ['project_keys', 'project_secrets', 'projects', 'users', 'sessions'];
  const rows = await Promise.all(tables.map((table) => db.query(`select * from ${table}`)));
  const hex = await db.query<{ hex: string }>(
    "select encode(ciphertext, 'hex') || encode(iv, 'hex') as hex from project_secrets",
  );
  return JSON.stringify(rows) + JSON.stringify(hex);
}

describe('names and values', () => {
  it('accepts environment-variable names only', () => {
    for (const name of ['DATABASE_URL', '_X', 'A1']) expect(checkSecretName(name)).toBeUndefined();
    for (const name of ['database_url', '1A', 'A-B', '', 'A'.repeat(129)]) {
      expect(checkSecretName(name)).toMatchObject({ field: 'name' });
    }
  });

  it('needs a non-empty value of at most 64 KB', () => {
    expect(checkSecretValue('x')).toBeUndefined();
    expect(checkSecretValue('')).toMatchObject({ field: 'value' });
    expect(checkSecretValue(42)).toMatchObject({ field: 'value' });
    expect(checkSecretValue('é'.repeat(32_769))).toMatchObject({ field: 'value' }); // 65,538 bytes
  });
});

describe('the vault', () => {
  it('saves a secret encrypted, and lists it by name only', async () => {
    expect(
      await putSecret(db, master, { projectId, userId, name: 'DATABASE_URL', value: CANARY }),
    ).toBe('created');
    const listed = await listSecrets(db, projectId);
    expect(listed).toEqual([
      {
        name: 'DATABASE_URL',
        addedBy: 'ada',
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain('CANARY');
  });

  it('never stores the value in plain text anywhere in the database', async () => {
    await putSecret(db, master, { projectId, userId, name: 'DATABASE_URL', value: CANARY });
    const everything = await everyRow();
    expect(everything).not.toContain('CANARY');
    expect(everything).not.toContain(Buffer.from('CANARY').toString('hex'));
  });

  it('round-trips the value for the workspace (phase 1d), and replaces it on a second save', async () => {
    await putSecret(db, master, { projectId, userId, name: 'API_KEY', value: 'first' });
    expect(await readSecret(db, master, projectId, 'API_KEY')).toBe('first');
    expect(
      await putSecret(db, master, { projectId, userId, name: 'API_KEY', value: 'second' }),
    ).toBe('replaced');
    expect(await readSecret(db, master, projectId, 'API_KEY')).toBe('second');
    expect(await listSecrets(db, projectId)).toHaveLength(1);
  });

  it('creates one data key per project, wrapped (48 bytes, version 1)', async () => {
    await putSecret(db, master, { projectId, userId, name: 'A', value: 'a' });
    await putSecret(db, master, { projectId, userId, name: 'B', value: 'b' });
    const keys = await db.query<{ n: number; version: number }>(
      'select octet_length(wrapped_key) as n, key_version as version from project_keys',
    );
    expect(keys).toEqual([{ n: 48, version: 1 }]);
  });

  it('can’t be read with a different master key', async () => {
    await putSecret(db, master, { projectId, userId, name: 'A', value: 'a' });
    const other = await importMasterKey(testVaultKey());
    await expect(readSecret(db, other, projectId, 'A')).rejects.toThrow();
  });

  it('refuses ciphertext copied onto another name', async () => {
    await putSecret(db, master, { projectId, userId, name: 'A', value: 'a' });
    await putSecret(db, master, { projectId, userId, name: 'B', value: 'b' });
    await db.query(
      `update project_secrets set ciphertext = (select ciphertext from project_secrets where name = 'A'),
         iv = (select iv from project_secrets where name = 'A') where name = 'B'`,
    );
    await expect(readSecret(db, master, projectId, 'B')).rejects.toThrow();
  });

  it('deletes a secret', async () => {
    await putSecret(db, master, { projectId, userId, name: 'A', value: 'a' });
    expect(await deleteSecret(db, projectId, 'A')).toBe(true);
    expect(await deleteSecret(db, projectId, 'A')).toBe(false);
    expect(await listSecrets(db, projectId)).toEqual([]);
  });
});
