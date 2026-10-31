import { describe, expect, it } from 'vitest';
import { constantTimeEqual, pkceChallenge, randomToken, sha256Hex } from './crypto.js';

describe('sign-in crypto', () => {
  it('makes 32-byte base64url tokens that never repeat', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('computes the PKCE S256 challenge from RFC 7636, appendix B', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('hashes to 64 hex characters', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares strings exactly', () => {
    expect(constantTimeEqual('state-1', 'state-1')).toBe(true);
    expect(constantTimeEqual('state-1', 'state-2')).toBe(false);
    expect(constantTimeEqual('state', 'state-1')).toBe(false);
  });
});
