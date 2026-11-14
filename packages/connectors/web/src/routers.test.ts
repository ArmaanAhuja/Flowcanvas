import { describe, expect, it } from 'vitest';
import { joinRouters, ROUTER_MESSAGES, routersOf, type JoinableRouter } from './routers.js';
import { programOf } from './test-program.js';

describe('routersOf: Hono', () => {
  it('reads a base path, routes on the variable and in its chain, and their handlers', () => {
    const file = programOf({
      '/route.ts': [
        "import { Hono } from 'hono';",
        "const app = new Hono().basePath('/api/private');",
        "app.get('/polls', auth, async (c) => c.json([]));",
        "app.post('/polls', createPoll);",
        "app.get('/a', h).delete('/b', h);",
        "app.on(['PUT', 'PATCH'], '/polls/:id', async (c) => c.json({}));",
      ].join('\n'),
    });
    const [router] = routersOf(file('/route.ts'));
    expect(router?.framework).toBe('hono');
    expect(router?.base).toBe('/api/private');
    expect(
      router?.routes.map((r) => [
        r.method,
        r.path,
        r.at.line,
        r.handler !== undefined,
        r.handlerName !== undefined,
      ]),
    ).toEqual([
      ['GET', '/polls', 3, true, false],
      ['POST', '/polls', 4, false, true],
      ['GET', '/a', 5, false, true],
      ['DELETE', '/b', 5, false, true],
      ['PUT', '/polls/:id', 6, true, false],
      ['PATCH', '/polls/:id', 6, true, false],
    ]);
  });

  it('reads mounts in a creating chain, and ignores objects that aren’t Hono apps', () => {
    const file = programOf({
      '/index.ts': [
        "import { Hono } from 'hono';",
        "import { session } from './session';",
        "export const auth = new Hono().route('/', session).route('/oauth', oauth);",
        'const notRouter = { get: (a: string, b: unknown) => b };',
        "notRouter.get('/x', 1);",
      ].join('\n'),
    });
    const routers = routersOf(file('/index.ts'));
    expect(routers).toHaveLength(1);
    expect(routers[0]?.mounts.map((m) => [m.prefix, m.at.line])).toEqual([
      ['/', 3],
      ['/oauth', 3],
    ]);
  });
});

describe('routersOf: Express', () => {
  it('reads require’d Express routers, their routes, route() chains and use() mounts', () => {
    const file = programOf({
      '/convos.js': [
        "const express = require('express');",
        'const router = express.Router();',
        'router.use(requireJwtAuth);',
        "router.get('/', async (req, res) => res.json([]));",
        "router.route('/:id').get(getOne).delete(removeOne);",
        "router.use('/admin', adminRouter);",
        'module.exports = router;',
      ].join('\n'),
    });
    const [router] = routersOf(file('/convos.js'));
    expect(router?.framework).toBe('express');
    expect(router?.routes.map((r) => [r.method, r.path, r.at.line])).toEqual([
      ['GET', '/', 4],
      ['GET', '/:id', 5],
      ['DELETE', '/:id', 5],
    ]);
    expect(router?.mounts.map((m) => [m.prefix, m.at.line])).toEqual([
      ['', 3],
      ['/admin', 6],
    ]);
  });

  it('lists one route per path in a list, and says why a handler made at run time or spread isn’t there', () => {
    const file = programOf({
      '/skills.js': [
        "const express = require('express');",
        'const router = express.Router();',
        "router.post(['/:id/files', '/:id/files/*rest'], upload);",
        "router.get('/access', createHandler({ a: 1 }));",
        "router.post('/v1/traces', ...pipeline);",
      ].join('\n'),
    });
    const [router] = routersOf(file('/skills.js'));
    expect(router?.routes.map((r) => [r.path, r.handlerName !== undefined, r.why])).toEqual([
      ['/:id/files', true, undefined],
      ['/:id/files/*rest', true, undefined],
      ['/access', false, 'Its handler is made when the app runs, not written as a function here.'],
      ['/v1/traces', false, 'Its handlers are a list built in code.'],
    ]);
  });

  it('knows `const { Router } = require(…)` and ES imports of express', () => {
    const file = programOf({
      '/a.js':
        "const { Router } = require('express');\nconst r = Router();\nr.get('/x', (q, s) => s.end());\n",
      '/b.ts':
        "import express from 'express';\nconst app = express();\napp.get('/y', (q, s) => s.end());\n",
    });
    expect(routersOf(file('/a.js'))[0]?.routes[0]?.path).toBe('/x');
    expect(routersOf(file('/b.ts'))[0]?.routes[0]?.path).toBe('/y');
    // A Router serves nothing until mounted; an app is a root.
    expect(routersOf(file('/a.js'))[0]?.mountedOnly).toBe(true);
    expect(routersOf(file('/b.ts'))[0]?.mountedOnly).toBe(false);
  });
});

describe('joinRouters', () => {
  const route = (method: string, path: string | null, line = 1) => ({
    method,
    path,
    at: { line, column: 1 },
    file: 'f.ts',
  });
  it('gives each route its full path through the mounts, from the roots down', () => {
    const routers: JoinableRouter[] = [
      {
        key: 'server',
        framework: 'hono',
        base: '',
        routes: [route('GET', '/health')],
        mounts: [{ prefix: '/api/auth', target: 'auth' }],
      },
      {
        key: 'auth',
        framework: 'hono',
        base: '',
        routes: [],
        mounts: [
          { prefix: '/', target: 'session' },
          { prefix: '/oauth', target: 'oauth' },
        ],
      },
      {
        key: 'session',
        framework: 'hono',
        base: '',
        routes: [route('GET', '/session')],
        mounts: [],
      },
      {
        key: 'oauth',
        framework: 'hono',
        base: '',
        routes: [route('POST', '/authorize')],
        mounts: [],
      },
    ];
    expect(joinRouters(routers).map((e) => [e.name, e.complete])).toEqual([
      ['GET /health', true],
      ['GET /api/auth/session', true],
      ['POST /api/auth/oauth/authorize', true],
    ]);
  });

  it('marks what the code doesn’t fix, and stops a cycle of mounts', () => {
    const routers: JoinableRouter[] = [
      {
        key: 'root',
        framework: 'express',
        base: '',
        routes: [],
        mounts: [{ prefix: null, target: 'a' }],
      },
      {
        key: 'a',
        framework: 'express',
        base: '',
        routes: [route('GET', '/x'), route('GET', null)],
        mounts: [{ prefix: '/again', target: 'a' }],
      },
    ];
    expect(joinRouters(routers).map((e) => [e.name, e.complete, e.why])).toEqual([
      ['GET /:unknown/x', false, 'Part of its path isn’t a constant the code fixes.'],
      ['GET /:unknown/:unknown', false, 'Part of its path isn’t a constant the code fixes.'],
    ]);
  });

  it('lists a Router no followed mount reaches under an unknown prefix, never as a root', () => {
    const routers: JoinableRouter[] = [
      {
        key: 'app',
        framework: 'express',
        base: '',
        mountedOnly: false,
        routes: [route('GET', '/health')],
        mounts: [{ prefix: '/api/files', target: 'files' }],
      },
      {
        key: 'files',
        framework: 'express',
        base: '',
        mountedOnly: true,
        routes: [route('GET', '/:id')],
        mounts: [],
      },
      {
        key: 'agents',
        framework: 'express',
        base: '',
        mountedOnly: true,
        routes: [route('DELETE', '/:id')],
        mounts: [{ prefix: '/actions', target: 'actions' }],
      },
      {
        key: 'actions',
        framework: 'express',
        base: '',
        mountedOnly: true,
        routes: [route('GET', '/')],
        mounts: [],
      },
    ];
    expect(joinRouters(routers).map((e) => [e.name, e.complete, e.why ?? null])).toEqual([
      ['GET /health', true, null],
      ['GET /api/files/:id', true, null],
      ['DELETE /:unknown/:id', false, ROUTER_MESSAGES.unmounted],
      ['GET /:unknown/actions', false, ROUTER_MESSAGES.unmounted],
    ]);
  });
});
