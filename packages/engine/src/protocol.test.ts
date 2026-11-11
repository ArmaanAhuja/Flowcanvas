import { describe, expect, it } from 'vitest';
import {
  ENGINE_LIMITS,
  EngineProblem,
  isEngineResponse,
  parseEngineRequest,
  type EngineRequest,
  type EngineStatus,
  type SymbolHit,
} from './protocol.js';

const status: EngineStatus = {
  state: 'ready',
  done: 10,
  total: 10,
  files: 12,
  byStatus: { parsed: 10, 'no-grammar': 2, 'too-large': 0, binary: 0, unreadable: 0 },
  symbols: 40,
  withSyntaxErrors: 1,
  partlyRead: 0,
  lastFullMs: 1800,
  message: null,
};
const hit: SymbolHit = {
  path: 'src/poll.ts',
  name: 'createPoll',
  kind: 'function',
  container: null,
  line: 3,
  column: 17,
  exported: true,
};
const search: EngineRequest = { op: 'search', query: 'poll', limit: 2 };

describe('parseEngineRequest', () => {
  it('accepts the three operations, with a default limit', () => {
    expect(parseEngineRequest({ op: 'hello' })).toEqual({ op: 'hello' });
    expect(parseEngineRequest({ op: 'status', extra: 1 })).toEqual({ op: 'status' });
    expect(parseEngineRequest({ op: 'search', query: 'poll' })).toEqual({
      op: 'search',
      query: 'poll',
      limit: ENGINE_LIMITS.defaultResults,
    });
  });

  it.each([
    [null, 'Unknown operation.'],
    [{ op: 'sync' }, 'Unknown operation.'],
    [{ op: 'search' }, 'Give something to search for.'],
    [{ op: 'search', query: 'x'.repeat(101) }, 'Keep searches under 100 characters.'],
    [{ op: 'search', query: 'x', limit: 0 }, 'Ask for 1 to 100 results.'],
    [{ op: 'search', query: 'x', limit: 101 }, 'Ask for 1 to 100 results.'],
    [{ op: 'search', query: 'x', limit: 1.5 }, 'Ask for 1 to 100 results.'],
  ])('refuses %j', (input, message) => {
    expect(() => parseEngineRequest(input)).toThrow(new EngineProblem('invalid_request', message));
  });
});

describe('isEngineResponse', () => {
  it('accepts well-formed answers', () => {
    expect(isEngineResponse({ op: 'hello' }, { ok: true, result: { protocol: 1 } })).toBe(true);
    expect(isEngineResponse({ op: 'status' }, { ok: true, result: status })).toBe(true);
    expect(isEngineResponse(search, { ok: true, result: { symbols: [hit], ms: 3 } })).toBe(true);
    expect(
      isEngineResponse(search, { ok: false, error: { code: 'failed', message: 'No index.' } }),
    ).toBe(true);
  });

  it.each([
    ['not an object', 'yes'],
    ['an unknown state', { ok: true, result: { ...status, state: 'done' } }],
    ['a negative count', { ok: true, result: { ...status, symbols: -1 } }],
    ['a missing status count', { ok: true, result: { ...status, byStatus: { parsed: 1 } } }],
    [
      'an extra status',
      { ok: true, result: { ...status, byStatus: { ...status.byStatus, x: 1 } } },
    ],
    ['a long message', { ok: true, result: { ...status, message: 'x'.repeat(301) } }],
  ])('refuses a status with %s', (_, value) => {
    expect(isEngineResponse({ op: 'status' }, value)).toBe(false);
  });

  it.each([
    ['more results than asked for', [hit, hit, hit]],
    ['an absolute path', [{ ...hit, path: '/etc/passwd' }]],
    ['an unknown kind', [{ ...hit, kind: 'secret' }]],
    ['line 0', [{ ...hit, line: 0 }]],
    ['an empty name', [{ ...hit, name: '' }]],
    ['a huge name', [{ ...hit, name: 'x'.repeat(ENGINE_LIMITS.text + 1) }]],
    ['a string for exported', [{ ...hit, exported: 'yes' }]],
  ])('refuses search results with %s', (_, symbols) => {
    expect(isEngineResponse(search, { ok: true, result: { symbols, ms: 1 } })).toBe(false);
  });

  it('refuses an unknown error code or a long error message', () => {
    expect(isEngineResponse(search, { ok: false, error: { code: 'boom', message: 'x' } })).toBe(
      false,
    );
    expect(
      isEngineResponse(search, { ok: false, error: { code: 'failed', message: 'x'.repeat(301) } }),
    ).toBe(false);
  });
});
