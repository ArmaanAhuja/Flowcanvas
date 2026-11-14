import { describe, expect, it } from 'vitest';
import { programOf } from './test-program.js';
import { joinTrpc, trpcOf, type JoinableTrpc } from './trpc.js';

const FILES = {
  '/trpc.ts': [
    "import { initTRPC } from '@trpc/server';",
    'const t = initTRPC.context<{}>().create();',
    'export const router = t.router;',
    'export const mergeRouters = t.mergeRouters;',
    'export const publicProcedure = t.procedure;',
    'export const adminProcedure = t.procedure.use(async (o: any) => o.next());',
  ].join('\n'),
  '/admin-search.ts': [
    "import { adminProcedure } from './trpc';",
    'export const adminSearchRoute = adminProcedure',
    '  .input(1)',
    '  .query(async () => []);',
  ].join('\n'),
  '/admin.ts': [
    "import { router } from './trpc';",
    "import { adminSearchRoute } from './admin-search';",
    'export const adminRouter = router({ search: adminSearchRoute });',
  ].join('\n'),
  '/app.ts': [
    "import { mergeRouters, publicProcedure, router } from './trpc';",
    "import { adminRouter } from './admin';",
    'export const appRouter = mergeRouters(',
    '  router({',
    '    admin: adminRouter,',
    '    health: publicProcedure.query(() => "ok"),',
    '    polls: router({ close: publicProcedure.mutation(async () => {}) }),',
    '  }),',
    ');',
  ].join('\n'),
  '/nested.ts': [
    "import { publicProcedure, router } from './trpc';",
    'declare function makeRouter(): unknown;',
    'export const orgRouter = router({',
    '  analytics: { overview: publicProcedure.query(() => 1), deep: { more: publicProcedure.query(() => 2) } },',
    '  made: makeRouter(),',
    '});',
  ].join('\n'),
  '/not-trpc.ts': [
    'const router = (o: object) => o;',
    'const procedure = { query: (f: () => void) => f };',
    'export const notOne = router({ a: procedure.query(() => {}) });',
  ].join('\n'),
};

describe('trpcOf', () => {
  const file = programOf(FILES);

  it('finds routers by following `router` back to initTRPC, and what each key holds', () => {
    const app = trpcOf(file('/app.ts'));
    // The merge, the router inside it, and the router nested inline.
    expect(app.routers).toHaveLength(3);
    const outer = app.routers.find((r) => r.keys.some((k) => k.key === 'health'));
    expect(outer?.keys.map((k) => [k.key, Object.keys(k.value)[0]])).toEqual([
      ['admin', 'target'],
      ['health', 'procedure'],
      ['polls', 'router'],
    ]);
  });

  it('finds procedures held by variables, through a builder made with use()', () => {
    const search = trpcOf(file('/admin-search.ts'));
    expect(
      search.procedures.map((p) => [
        p.procedure.kind,
        p.procedure.at.line,
        p.procedure.handler !== undefined,
      ]),
    ).toEqual([['query', 4, true]]);
  });

  it('reads a plain object as a router of its own, and keeps what it can’t read rather than dropping it', () => {
    const nested = trpcOf(file('/nested.ts'));
    // The router, `analytics`, and `deep`.
    expect(nested.routers).toHaveLength(3);
    const outer = nested.routers.find((r) => r.keys.some((k) => k.key === 'made'));
    expect(outer?.keys.map((k) => [k.key, Object.keys(k.value)[0]])).toEqual([
      ['analytics', 'router'],
      ['made', 'unreadable'],
    ]);
  });

  it('isn’t fooled by functions that are only named like tRPC’s', () => {
    expect(trpcOf(file('/not-trpc.ts'))).toEqual({ routers: [], procedures: [] });
  });
});

describe('joinTrpc', () => {
  it('names each procedure by its path from the root, through names and merges', () => {
    const proc = (kind: 'query' | 'mutation', line: number) => ({
      kind,
      at: { line, column: 1 },
      file: 'f.ts',
    });
    const trpc: JoinableTrpc = {
      routers: [
        { key: 'merge', file: 'app.ts', keys: [], merged: [{ ref: 'outer' }] },
        {
          key: 'outer',
          file: 'app.ts',
          keys: [
            { key: 'admin', value: { ref: 'admin' } },
            { key: 'health', value: { procedure: proc('query', 6) } },
            { key: 'billing', value: { unresolved: true } },
            // Resolved to a name that holds neither a router nor a procedure.
            { key: 'other', value: { ref: 'nothing' } },
          ],
          merged: [],
        },
        {
          key: 'admin',
          file: 'admin.ts',
          keys: [{ key: 'search', value: { ref: 'search-proc' } }],
          merged: [],
        },
      ],
      procedures: new Map([['search-proc', proc('query', 4)]]),
    };
    expect(joinTrpc(trpc).map((e) => [e.name, e.complete])).toEqual([
      ['query admin.search', true],
      ['query health', true],
      ['billing.*', false],
      ['other.*', false],
    ]);
  });
});
