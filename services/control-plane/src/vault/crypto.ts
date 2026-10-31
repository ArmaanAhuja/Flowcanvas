/**
 * Envelope encryption for project secrets, with Web Crypto's AES-256-GCM (runs the same in Workers and Node).
 *
 *   master key (VAULT_KEY, a Worker secret; never in the database)
 *     └─ wraps each project's data key (project_keys.wrapped_key)
 *          └─ encrypts each secret value (project_secrets.ciphertext)
 *
 * A database copy alone decrypts nothing. Each ciphertext is bound to where it belongs (additional authenticated
 * data): a wrapped key to its project, a value to its project and name, so rows can't be swapped.
 */

/** Which master key wrapped a data key; rotating the master key adds version 2 (upgrade-later 28). */
export const MASTER_KEY_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** An imported AES key, typed from Web Crypto itself so it means the same in Workers and Node. */
export type AesKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

export class VaultKeyError extends Error {
  override readonly name = 'VaultKeyError';
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const encoder = new TextEncoder();

function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<AesKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** The master key from VAULT_KEY: 32 random bytes, base64. The message never includes the value. */
export async function importMasterKey(base64: string): Promise<AesKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = Uint8Array.from(atob(base64.trim()), (char) => char.charCodeAt(0));
  } catch {
    throw new VaultKeyError('VAULT_KEY is not valid base64');
  }
  if (raw.length !== KEY_BYTES) {
    throw new VaultKeyError(
      `VAULT_KEY must be ${String(KEY_BYTES)} bytes, not ${String(raw.length)}`,
    );
  }
  return aesKey(raw);
}

export interface Sealed {
  /** Hex, as stored with `decode($1, 'hex')`. */
  readonly ciphertext: string;
  readonly iv: string;
}

async function seal(
  key: AesKey,
  plaintext: Uint8Array<ArrayBuffer>,
  context: string,
): Promise<Sealed> {
  // A fresh random IV for every encryption: reusing one with the same key breaks AES-GCM.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    key,
    plaintext,
  );
  return { ciphertext: toHex(new Uint8Array(ciphertext)), iv: toHex(iv) };
}

async function open(
  key: AesKey,
  sealed: Sealed,
  context: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(sealed.iv), additionalData: encoder.encode(context) },
    key,
    fromHex(sealed.ciphertext),
  );
  return new Uint8Array(plaintext);
}

/** A new project's data key, wrapped by the master key (48 bytes: 32 + the 16-byte tag). */
export async function newWrappedDataKey(master: AesKey, projectId: string): Promise<Sealed> {
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return seal(master, raw, `project-key:${projectId}`);
}

export async function unwrapDataKey(
  master: AesKey,
  wrapped: Sealed,
  projectId: string,
): Promise<AesKey> {
  return aesKey(await open(master, wrapped, `project-key:${projectId}`));
}

export function encryptValue(
  dataKey: AesKey,
  value: string,
  projectId: string,
  name: string,
): Promise<Sealed> {
  return seal(dataKey, encoder.encode(value), `secret:${projectId}:${name}`);
}

export async function decryptValue(
  dataKey: AesKey,
  sealed: Sealed,
  projectId: string,
  name: string,
): Promise<string> {
  return new TextDecoder().decode(await open(dataKey, sealed, `secret:${projectId}:${name}`));
}
