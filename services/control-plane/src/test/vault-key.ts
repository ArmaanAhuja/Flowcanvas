/** A fresh random master key in VAULT_KEY's format (32 bytes, base64), for tests. */
export function testVaultKey(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}
