// Entry points in the graph pass (phase 8, ADR 0030), on a small Next.js app whose API is a Hono app mounted across
// files: found, joined, handled by code units, and kept right when a file they depend on changes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateGraph, type Graph, type GraphNode } from '@flowcanvas/graph-model';
import { ENTRY_MESSAGES, routeFileOf } from './entry-pass.js';
import { SemanticService } from './semantic-service.js';

// Real TypeScript programs, as in semantic-service.test.ts.
vi.setConfig({ testTimeout: 20_000 });

const POLLS = [
  "import { Hono } from 'hono';",
  "import { slug } from '../lib/slug';",
  'export const polls = new Hono();',
  "polls.get('/:id', (c) => {",
  "  slug('c');",
  '  return c.json({});',
  '});',
  '',
].join('\n');

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', private: true }),
  'apps/web/package.json': JSON.stringify(
    {
      name: '@fx/web',
      scripts: { dev: 'next dev', seed: 'tsx scripts/seed.ts' },
      dependencies: { next: '16.0.0', hono: '4.0.0' },
    },
    null,
    2,
  ),
  'apps/web/tsconfig.json': JSON.stringify({
    compilerOptions: { strict: true, jsx: 'preserve' },
    include: ['src', 'scripts'],
  }),
  'apps/web/scripts/seed.ts': "import { slug } from '../src/lib/slug';\nslug('seed');\n",
  'apps/web/src/lib/slug.ts':
    'export function slug(text: string): string {\n  return text.trim();\n}\n',
  'apps/web/src/app/polls/[id]/page.tsx': [
    "import { useCallback } from 'react';",
    "import { slug } from '../../../lib/slug';",
    'export default function PollPage() {',
    "  const onSave = useCallback(() => slug('a'), []);",
    '  return (',
    '    <div>',
    "      <button onClick={() => slug('b')}>Save</button>",
    '      <form onSubmit={onSave} />',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n'),
  'apps/web/src/app/api/[...route]/route.ts': [
    "import { handle } from 'hono/vercel';",
    "import { app } from '../../../server/app';",
    'export const GET = handle(app);',
    'export const POST = handle(app);',
    '',
  ].join('\n'),
  'apps/web/src/server/app.ts': [
    "import { Hono } from 'hono';",
    "import { polls } from './polls';",
    "export const app = new Hono().basePath('/api');",
    "app.route('/polls', polls);",
    '',
  ].join('\n'),
  'apps/web/src/server/polls.ts': POLLS,
  // Rallly's v1 API: a Hono app served through a function that rewrites the path (owner, 14 Nov 2026).
  'apps/web/src/app/api/v1/[...route]/route.ts': [
    "import { Hono } from 'hono';",
    "const app = new Hono().basePath('/v1');",
    "app.post('/polls', (c) => c.json({}));",
    'async function handler(request: Request) {',
    '  const url = new URL(request.url);',
    '  url.pathname = url.pathname.slice(4);',
    '  return app.fetch(new Request(url, request));',
    '}',
    'export const POST = handler;',
    '',
  ].join('\n'),
  // Rallly's integrations: the route file's handler is a factory's `handle(app)`, so it isn't listed; the factory's
  // app has its base path from an argument, so its route is listed as not fully detected.
  'apps/web/src/lib/integration.ts': [
    "import { Hono } from 'hono';",
    "import { handle } from 'hono/vercel';",
    'export function makeIntegration({ basePath }: { basePath: string }) {',
    '  const app = new Hono().basePath(basePath);',
    "  app.get('/callback/:id', (c) => c.json({}));",
    '  return { handler: handle(app) };',
    '}',
    '',
  ].join('\n'),
  'apps/web/src/app/api/integrations/[...connection]/route.ts': [
    "import { makeIntegration } from '../../../../lib/integration';",
    "const { handler } = makeIntegration({ basePath: '/api/integrations' });",
    'export const GET = handler;',
    '',
  ].join('\n'),
  // LibreChat's shape: a route whose component only redirects isn't a screen.
  'apps/web/src/router.tsx': [
    "import { createBrowserRouter, Navigate } from 'react-router-dom';",
    'function PromptsRedirect() {',
    "  return <Navigate to='/c/new' replace />;",
    '}',
    'function Chat() {',
    '  return <main />;',
    '}',
    'export const router = createBrowserRouter([',
    "  { path: 'c/:id', element: <Chat /> },",
    "  { path: 'prompts/*', element: <PromptsRedirect /> },",
    ']);',
    '',
  ].join('\n'),
  // A test file's app and elements aren't entry points (owner, 14 Nov 2026).
  'apps/web/src/server/polls.test.tsx': [
    "import { Hono } from 'hono';",
    'const testApp = new Hono();',
    "testApp.get('/only-in-a-test', (c) => c.json({}));",
    'export const Probe = () => <button onClick={() => undefined} />;',
    '',
  ].join('\n'),
  // Rallly's shape: tRPC routers held by name in the root's shorthand properties.
  'apps/web/src/trpc/init.ts': [
    "import { initTRPC } from '@trpc/server';",
    'const t = initTRPC.create();',
    'export const router = t.router;',
    'export const publicProcedure = t.procedure;',
    '',
  ].join('\n'),
  'apps/web/src/trpc/polls.ts': [
    "import { publicProcedure, router } from './init';",
    'export const polls = router({ list: publicProcedure.query(() => []) });',
    '',
  ].join('\n'),
  'apps/web/src/trpc/index.ts': [
    "import { router } from './init';",
    "import { polls } from './polls';",
    'export const appRouter = router({ polls });',
    '',
  ].join('\n'),
  // LibreChat's shape: CommonJS routers gathered in an index and mounted through it.
  'apps/api/package.json': JSON.stringify({ name: '@fx/api', dependencies: { express: '4.0.0' } }),
  'apps/api/server.js': [
    "const express = require('express');",
    "const routes = require('./routes');",
    'const app = express();',
    "app.use('/api/auth', routes.auth);",
    // A router made when the app starts (LibreChat's files): the router its function returns.
    "(async () => { app.use('/api/files', await routes.files.initialize()); })();",
    '',
  ].join('\n'),
  'apps/api/jsconfig.json': JSON.stringify({
    compilerOptions: { baseUrl: './', paths: { '~/*': ['./*'] } },
  }),
  'apps/api/routes/index.js':
    "const { auth } = require('./auth');\nconst files = require('./files');\nmodule.exports = { auth, files };\n",
  'apps/api/routes/files.js': [
    "const express = require('express');",
    // Renamed out of `{ auth: router, avatar }` (LibreChat's agents avatar router).
    "const { avatar: agentAvatar } = require('./auth');",
    'const initialize = async () => {',
    '  const router = express.Router();',
    "  router.get('/config', (req, res) => res.end());",
    "  router.use('/images/agents', agentAvatar);",
    '  return router;',
    '};',
    'module.exports = { initialize };',
    '',
  ].join('\n'),
  'apps/api/routes/auth.js': [
    "const express = require('express');",
    // Through jsconfig.json's alias, which only it defines.
    "const { login } = require('~/controllers/login');",
    'const router = express.Router();',
    "router.post('/login', login);",
    'const avatar = express.Router();',
    "avatar.post('/:id/avatar', (req, res) => res.end());",
    // A property naming the router (LibreChat's `{ v1: router }`), which TypeScript doesn't follow by itself.
    'module.exports = { auth: router, avatar };',
    '',
  ].join('\n'),
  'apps/api/controllers/login.js': [
    'const login = async (req, res) => {',
    '  res.end();',
    '};',
    'module.exports = { login };',
    '',
  ].join('\n'),
};

let root: string;
let service: SemanticService;

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fc-entries-'));
  for (const [path, content] of Object.entries(FILES)) write(path, content);
  service = new SemanticService({ ts, root, files: Object.keys(FILES) });
});
afterEach(() => {
  service.dispose();
  rmSync(root, { recursive: true, force: true });
});

async function pass(): Promise<Graph> {
  const result = await service.graph(() => Promise.resolve());
  if (result === null) throw new Error('no pass');
  expect(validateGraph(result.graph)).toEqual([]);
  return result.graph;
}

const entries = (graph: Graph) => graph.nodes.filter((n) => n.kind === 'entry-point');
const handledBy = (graph: Graph, entry: GraphNode | undefined) =>
  graph.edges
    .filter((e) => e.from === entry?.id)
    .map((e) => [e.to ?? e.target, e.provenance, e.relation]);
const named = (graph: Graph, name: string) => entries(graph).find((n) => n.name === name);

describe('entry points in the graph pass', () => {
  it('lists every entry point, joined across files, each with what handles it', async () => {
    const graph = await pass();
    expect(
      entries(graph)
        .map((n) => [n.entry?.kind, n.entry?.framework, n.name])
        .sort(),
    ).toEqual([
      ['api-route', 'express', 'GET /api/files/config'],
      ['api-route', 'express', 'POST /api/auth/login'],
      ['api-route', 'express', 'POST /api/files/images/agents/:id/avatar'],
      ['api-route', 'hono', 'GET /:unknown/callback/:id'],
      ['api-route', 'hono', 'GET /api/polls/:id'],
      ['api-route', 'hono', 'POST /v1/polls'],
      ['api-route', 'next', 'POST /api/v1/*'],
      ['api-route', 'trpc', 'query polls.list'],
      ['cli-command', 'package-json', '@fx/web: dev'],
      ['cli-command', 'package-json', '@fx/web: seed'],
      ['element', 'react', '<button> onClick'],
      ['element', 'react', '<form> onSubmit'],
      ['screen', 'next', '/polls/:id'],
      ['screen', 'react-router', '/c/:id'],
    ]);
    // The route file hands every request to the Hono app: its own GET and POST aren't listed (ADR 0030 §1).
    expect(ENTRY_MESSAGES.delegated).toContain('Hono');
    expect(handledBy(graph, named(graph, '/polls/:id'))).toEqual([
      ['apps/web/src/app/polls/[id]/page.tsx#PollPage', 'convention', 'renders'],
    ]);
    expect(handledBy(graph, named(graph, '@fx/web: seed'))).toEqual([
      ['apps/web/scripts/seed.ts#(top level)', 'convention', 'calls'],
    ]);
    // Mounted through `routes.auth`, an index's `module.exports = { auth }`, a require and `{ auth: router }`;
    // handled by a named function.
    expect(handledBy(graph, named(graph, 'POST /api/auth/login'))).toEqual([
      ['apps/api/controllers/login.js#login', 'convention', 'calls'],
    ]);
    // A named handler keeps its own name.
    expect(
      graph.nodes.find((n) => n.id === 'apps/web/src/app/polls/[id]/page.tsx#PollPage')?.name,
    ).toBe('PollPage');
    // A script that runs no project file has nothing to reach, rather than a guess.
    expect(handledBy(graph, named(graph, '@fx/web: dev'))).toEqual([]);
    expect(
      entries(graph)
        .filter((n) => !n.entry?.complete)
        .map((n) => n.name),
    ).toEqual(['GET /:unknown/callback/:id']);
    // The path the app registers, marked as served through a rewrite; the route file's own entry reaches its handler.
    expect(named(graph, 'POST /v1/polls')?.entry?.why).toBe(ENTRY_MESSAGES.rewritten('route.ts'));
    expect(handledBy(graph, named(graph, 'POST /api/v1/*'))).toEqual([
      ['apps/web/src/app/api/v1/[...route]/route.ts#handler', 'convention', 'calls'],
    ]);
  });

  it('makes an anonymous handler a code unit named after its entry point, owning its calls in the graph', async () => {
    const graph = await pass();
    const route = named(graph, 'GET /api/polls/:id');
    const [[unit]] = handledBy(graph, route) as [[string]];
    expect(unit).toBe('apps/web/src/server/polls.ts#(handler GET /:id)');
    expect(graph.nodes.find((n) => n.id === unit)).toMatchObject({
      kind: 'code-unit',
      unit: 'function',
      name: 'GET /api/polls/:id',
      place: { path: 'apps/web/src/server/polls.ts', line: 4, column: 19 },
    });
    // Its own calls: slug, and Hono's c.json (not the project's: unknown, by its text).
    expect(
      graph.edges.filter((e) => e.from === unit).map((e) => [e.to ?? e.target, e.provenance]),
    ).toEqual([
      ['apps/web/src/lib/slug.ts#slug', 'resolved'],
      ['c.json', 'unknown'],
    ]);
    // Not the file's top level any more, in the graph.
    expect(
      graph.edges.some(
        (e) => e.from === 'apps/web/src/server/polls.ts#(top level)' && e.to?.endsWith('#slug'),
      ),
    ).toBe(false);
    // The Calls tab keeps TypeScript's view: the top level calls slug (owner, 12 Nov 2026).
    const callers = service.callers('apps/web/src/lib/slug.ts', 1, 17);
    expect(callers.entries.map((e) => e.name)).toContain('polls.ts (top level)');
  });

  it('gives an element the unit it’s in, and follows a handler made by a call to the function it was given', async () => {
    const graph = await pass();
    const button = named(graph, '<button> onClick');
    const form = named(graph, '<form> onSubmit');
    expect(button?.entry?.within).toBe('apps/web/src/app/polls/[id]/page.tsx#PollPage');
    expect(handledBy(graph, button)).toEqual([
      [
        'apps/web/src/app/polls/[id]/page.tsx#PollPage.(handler <button> onClick)',
        'convention',
        'calls',
      ],
    ]);
    // `const onSave = useCallback(() => slug('a'), [])`: the arrow runs on submit.
    expect(handledBy(graph, form)).toEqual([
      ['apps/web/src/app/polls/[id]/page.tsx#PollPage.(handler onSave)', 'convention', 'calls'],
    ]);
    const formUnit = graph.nodes.find((n) => n.id.endsWith('(handler onSave)'));
    expect(formUnit?.name).toBe('<form> onSubmit');
  });

  it('joins again from the files it keeps when one changes, and walks again a file whose keys moved', async () => {
    await pass();
    write(
      'apps/web/src/server/app.ts',
      FILES['apps/web/src/server/app.ts']?.replace("'/api'", "'/v2'") ?? '',
    );
    service.changed(['apps/web/src/server/app.ts']);
    expect(named(await pass(), 'GET /v2/polls/:id')?.entry?.complete).toBe(true);
    // Lines above the router move its declaration: app.ts's key for it is worked out again, so it stays mounted.
    write('apps/web/src/server/polls.ts', `// Polls.\n\n${POLLS}`);
    service.changed(['apps/web/src/server/polls.ts']);
    const graph = await pass();
    expect(
      entries(graph)
        .filter((n) => n.entry?.framework === 'hono' && n.entry.complete)
        .map((n) => n.name),
    ).toEqual(['POST /v1/polls', 'GET /v2/polls/:id']);
  });
});

describe('routeFileOf', () => {
  const pkg = (dir: string, uses: string[]) => ({ name: dir, dir, dependsOn: [], uses, paths: {} });
  it('knows a route file by its package’s framework and folder', () => {
    const packages = [
      pkg('apps/web', ['next']),
      pkg('apps/remix', ['remix-flat-routes']),
      pkg('', []),
    ];
    expect(routeFileOf('apps/web/src/app/polls/[id]/page.tsx', packages)).toEqual({
      kind: 'next',
      route: { kind: 'page', path: '/polls/:id' },
    });
    expect(
      routeFileOf('apps/remix/app/routes/_authenticated+/settings.profile.tsx', packages),
    ).toEqual({
      kind: 'flat',
      route: { path: '/settings/profile', layout: false },
    });
    // A Next.js-looking folder in a package that doesn't use Next.js isn't one.
    expect(routeFileOf('tools/app/page.tsx', packages)).toBeNull();
  });
});
