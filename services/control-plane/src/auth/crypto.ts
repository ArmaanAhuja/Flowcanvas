/** Random, unguessable values and hashes for sign-in. Web Crypto only, so the same code runs in Workers and Node. */

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `bytes` random bytes as base64url (32 bytes → 43 characters): safe in cookies and URLs. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** SHA-256 as 64 hex characters: how a session token is stored (`decode($1, 'hex')` in SQL). */
export async function sha256Hex(text: string): Promise<string> {
  return Array.from(await sha256(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** PKCE's S256 challenge for a verifier (RFC 7636): base64url of its SHA-256. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

/** Compares two strings in time that doesn't depend on where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
