import { describe, expect, it } from 'vitest';
import { testVaultKey } from '../test/vault-key.js';
import {
  decryptValue,
  encryptValue,
  importMasterKey,
  newWrappedDataKey,
  unwrapDataKey,
} from './crypto.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CANARY = 'CANARY-sk_live_value';

describe('vault crypto', () => {
  it('refuses a master key of the wrong size or format, without echoing it', async () => {
    await expect(importMasterKey(btoa('too short'))).rejects.toThrow(
      'VAULT_KEY must be 32 bytes, not 9',
    );
    await expect(importMasterKey('not base64 at all!')).rejects.toThrow(
      'VAULT_KEY is not valid base64',
    );
    await expect(importMasterKey('not base64 at all!')).rejects.not.toThrow(/at all/);
  });

  it('round-trips a value through a wrapped data key', async () => {
    const master = await importMasterKey(testVaultKey());
    const wrapped = await newWrappedDataKey(master, PROJECT);
    expect(wrapped.ciphertext).toHaveLength(96); // 48 bytes: the 32-byte key plus the 16-byte tag
    const key = await unwrapDataKey(master, wrapped, PROJECT);

    const sealed = await encryptValue(key, CANARY, PROJECT, 'STRIPE_KEY');
    expect(sealed.ciphertext).not.toContain(Buffer.from(CANARY).toString('hex'));
    expect(await decryptValue(key, sealed, PROJECT, 'STRIPE_KEY')).toBe(CANARY);
  });

  it('uses a new IV every time, so the same value never encrypts the same way twice', async () => {
    const master = await importMasterKey(testVaultKey());
    const key = await unwrapDataKey(master, await newWrappedDataKey(master, PROJECT), PROJECT);
    const first = await encryptValue(key, CANARY, PROJECT, 'A');
    const second = await encryptValue(key, CANARY, PROJECT, 'A');
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('binds a value to its project and name: moved or renamed ciphertext won’t open', async () => {
    const master = await importMasterKey(testVaultKey());
    const key = await unwrapDataKey(master, await newWrappedDataKey(master, PROJECT), PROJECT);
    const sealed = await encryptValue(key, CANARY, PROJECT, 'STRIPE_KEY');
    await expect(decryptValue(key, sealed, PROJECT, 'OTHER_NAME')).rejects.toThrow();
    await expect(
      decryptValue(key, sealed, '22222222-2222-4222-8222-222222222222', 'STRIPE_KEY'),
    ).rejects.toThrow();
  });

  it('can’t unwrap a data key with another master key, or for another project', async () => {
    const master = await importMasterKey(testVaultKey());
    const wrapped = await newWrappedDataKey(master, PROJECT);
    const otherMaster = await importMasterKey(testVaultKey());
    await expect(unwrapDataKey(otherMaster, wrapped, PROJECT)).rejects.toThrow();
    await expect(
      unwrapDataKey(master, wrapped, '22222222-2222-4222-8222-222222222222'),
    ).rejects.toThrow();
  });
});
