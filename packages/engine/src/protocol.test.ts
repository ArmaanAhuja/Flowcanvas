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

describe('the semantic questions (phase 5)', () => {
  const at = { path: 'apps/web/src/page.tsx', line: 6, column: 17 };
  const item = { name: 'Page', kind: 'component', container: null, place: at, builtIn: false };

  it('accepts a place in the project for each of the four', () => {
    for (const op of ['definition', 'references', 'callers', 'callees'] as const) {
      expect(parseEngineRequest({ op, ...at })).toEqual({ op, ...at });
    }
  });

  it.each([
    [{ path: '/etc/passwd', line: 1, column: 1 }, 'Give a file in the project, like src/index.ts.'],
    [
      { path: '../outside.ts', line: 1, column: 1 },
      'Give a file in the project, like src/index.ts.',
    ],
    [{ path: 'a//b.ts', line: 1, column: 1 }, 'Give a file in the project, like src/index.ts.'],
    [{ path: 'a.ts', line: 0, column: 1 }, 'Give a line and a column, counting from 1.'],
    [{ path: 'a.ts', line: 1, column: 1.5 }, 'Give a line and a column, counting from 1.'],
  ])('refuses %j', (place, message) => {
    expect(() => parseEngineRequest({ op: 'callers', ...place })).toThrow(
      new EngineProblem('invalid_request', message),
    );
  });

  const callers: EngineRequest = { op: 'callers', ...at };
  const entry = {
    ...item,
    relation: 'renders',
    provenance: 'resolved',
    sites: [{ path: 'apps/web/src/app.tsx', line: 3, column: 5 }],
  };

  it('accepts well-formed answers', () => {
    expect(
      isEngineResponse(callers, {
        ok: true,
        result: { target: item, entries: [entry], complete: true, message: null },
      }),
    ).toBe(true);
    expect(
      isEngineResponse(
        { op: 'definition', ...at },
        { ok: true, result: { definitions: [item], message: null } },
      ),
    ).toBe(true);
    expect(
      isEngineResponse(
        { op: 'references', ...at },
        {
          ok: true,
          result: {
            target: item,
            references: [{ ...at, isDefinition: true }],
            complete: true,
            message: null,
          },
        },
      ),
    ).toBe(true);
  });

  it.each([
    ['an unresolved entry with a place to jump to', { ...entry, provenance: 'unresolved' }],
    ['an unknown relation', { ...entry, relation: 'imports' }],
    ['a site outside the project', { ...entry, sites: [{ path: '/etc/x', line: 1, column: 1 }] }],
    ['a place that climbs out', { ...entry, place: { path: 'a/../../x', line: 1, column: 1 } }],
    ['an unknown kind', { ...entry, kind: 'secret' }],
    ['a non-boolean built-in', { ...entry, builtIn: 'no' }],
  ])('refuses callers with %s', (_, bad) => {
    expect(
      isEngineResponse(callers, {
        ok: true,
        result: { target: item, entries: [bad], complete: true, message: null },
      }),
    ).toBe(false);
  });
});

describe('the graph (phase 6)', () => {
  const graph: EngineRequest = { op: 'graph' };
  const snapshot = {
    version: 'a'.repeat(64),
    takenAt: '2026-11-12T10:00:00.000Z',
    complete: true,
    note: null,
    files: 1168,
    builtInCalls: 3930,
    stats: {
      nodes: 3327,
      edges: 16394,
      byNodeKind: {
        'entry-point': 0,
        'code-unit': 3327,
        decision: 0,
        'data-access': 0,
        'async-handoff': 0,
        'external-boundary': 0,
      },
      byCodeUnit: { function: 1603, method: 189, component: 1081, class: 38, module: 416 },
      byEdgeKind: { call: 16394, branch: 0, data: 0, handoff: 0, boundary: 0 },
      byProvenance: { observed: 0, resolved: 7514, convention: 0, suggested: 0, unknown: 8880 },
    },
    buildMs: 4100,
    saveMs: 20,
    loadMs: 10,
  };
  const ok = (result: unknown) => isEngineResponse(graph, { ok: true, result });

  it('is an operation of its own', () => {
    expect(parseEngineRequest({ op: 'graph' })).toEqual({ op: 'graph' });
  });

  it('accepts its states, with or without a snapshot', () => {
    expect(ok({ state: 'ready', message: null, snapshot })).toBe(true);
    expect(ok({ state: 'waiting', message: null, snapshot: null })).toBe(true);
    expect(ok({ state: 'failed', message: 'Too large.', snapshot })).toBe(true);
  });

  it('refuses anything else: a bad version, a kind missing or extra, a count that isn’t one', () => {
    const stats = snapshot.stats;
    for (const bad of [
      { state: 'done', message: null, snapshot: null },
      { state: 'ready', message: 'x'.repeat(301), snapshot: null },
      { state: 'ready', message: null, snapshot: { ...snapshot, version: '../etc/passwd' } },
      { state: 'ready', message: null, snapshot: { ...snapshot, takenAt: 'yesterday' } },
      { state: 'ready', message: null, snapshot: { ...snapshot, loadMs: -1 } },
      {
        state: 'ready',
        message: null,
        snapshot: { ...snapshot, stats: { ...stats, byNodeKind: { 'code-unit': 1 } } },
      },
      {
        state: 'ready',
        message: null,
        snapshot: {
          ...snapshot,
          stats: { ...stats, byProvenance: { ...stats.byProvenance, guessed: 1 } },
        },
      },
      { state: 'ready', message: null, snapshot: { ...snapshot, stats: { ...stats, extra: 1 } } },
    ]) {
      expect(ok(bad), JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });
});

describe('flows (phase 7)', () => {
  const at = { path: 'src/poll.ts', line: 3, column: 17 };
  const request: EngineRequest = { op: 'flow', ...at };
  const node = (id: string, kind = 'code-unit') => ({
    id,
    kind,
    name: id.split('#')[1],
    place: { path: 'src/poll.ts', line: 3, column: 17 },
    unit: kind === 'code-unit' ? 'function' : null,
    change: 'unchanged',
  });
  const flow = {
    root: 'src/poll.ts#create',
    nodes: [
      node('src/poll.ts#create'),
      node('src/poll.ts#create?1', 'decision'),
      node('src/db.ts#save'),
    ],
    edges: [
      {
        from: 'src/poll.ts#create',
        to: 'src/poll.ts#create?1',
        kind: 'branch',
        relation: null,
        label: null,
        provenance: 'resolved',
        lines: [4],
        sites: 1,
      },
      {
        from: 'src/poll.ts#create?1',
        to: 'src/db.ts#save',
        kind: 'branch',
        relation: 'calls',
        label: 'yes',
        provenance: 'resolved',
        lines: [5],
        sites: 1,
      },
    ],
    unknown: [
      {
        from: 'src/poll.ts#create',
        total: 3,
        calls: [
          { target: 'prisma.poll.create', relation: 'calls', label: null, lines: [6], sites: 1 },
        ],
      },
    ],
    cut: [{ from: 'src/db.ts#save', nodes: 2 }],
    hidden: 2,
    byProvenance: { observed: 0, resolved: 1, convention: 0, suggested: 0, unknown: 3 },
  };
  const result = {
    flow,
    message: null,
    version: 'b'.repeat(64),
    takenAt: '2026-11-12T10:00:00.000Z',
    current: true,
    complete: true,
  };
  const ok = (value: unknown) => isEngineResponse(request, { ok: true, result: value });

  it('starts from a place, checked like the other questions', () => {
    expect(parseEngineRequest({ op: 'flow', ...at })).toEqual(request);
    expect(() => parseEngineRequest({ op: 'flow', path: '../x.ts', line: 1, column: 1 })).toThrow(
      new EngineProblem('invalid_request', 'Give a file in the project, like src/index.ts.'),
    );
  });

  it('accepts a flow, or none with a reason', () => {
    expect(ok(result)).toBe(true);
    expect(ok({ ...result, flow: null, message: 'Not yet.', current: false })).toBe(true);
    expect(ok({ ...result, flow: null, version: null, takenAt: null, complete: false })).toBe(true);
  });

  it('refuses a flow that isn’t whole, bounded and well-formed', () => {
    const [first, second] = flow.edges;
    const group = flow.unknown[0];
    const many = Array.from({ length: 61 }, (_, i) => node(`a.ts#f${String(i)}`));
    for (const bad of [
      { ...flow, root: 'src/other.ts#x' },
      { ...flow, nodes: [] },
      { ...flow, nodes: many, root: 'a.ts#f0', edges: [], unknown: [], cut: [] },
      { ...flow, nodes: [...flow.nodes, node('src/poll.ts#create')] },
      {
        ...flow,
        nodes: [{ ...node('a.ts#x'), place: { path: '/etc/passwd', line: 1, column: 1 } }],
      },
      { ...flow, nodes: [{ ...node('a.ts#x'), kind: 'guess' }] },
      { ...flow, edges: [{ ...first, to: 'src/elsewhere.ts#x' }] },
      { ...flow, edges: [{ ...second, provenance: 'guessed' }] },
      { ...flow, edges: [{ ...second, kind: 'data' }] },
      {
        ...flow,
        edges: [{ ...second, lines: Array.from({ length: 11 }, (_, i) => i + 1), sites: 11 }],
      },
      { ...flow, edges: [{ ...second, lines: [1, 2], sites: 1 }] },
      { ...flow, unknown: [{ ...group, from: 'src/elsewhere.ts#x' }] },
      { ...flow, unknown: [{ ...group, total: 0 }] },
      { ...flow, unknown: [{ ...group, calls: [{ ...group?.calls[0], target: '' }] }] },
      { ...flow, cut: [{ from: 'src/db.ts#save', nodes: 0 }] },
      { ...flow, hidden: -1 },
      { ...flow, byProvenance: { resolved: 1 } },
    ]) {
      expect(ok({ ...result, flow: bad }), JSON.stringify(bad).slice(0, 120)).toBe(false);
    }
    for (const bad of [
      { ...result, version: 'not-a-version' },
      { ...result, takenAt: 'yesterday' },
      { ...result, current: 'yes' },
      { ...result, message: 'x'.repeat(301) },
    ]) {
      expect(ok(bad)).toBe(false);
    }
  });
});
