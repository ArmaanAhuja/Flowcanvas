// Routes registered in code (ADR 0030): Hono apps (Rallly, Documenso) and Express apps and routers (LibreChat). A
// file reports each router it creates, the routes registered on it (`app.get('/polls', …, handler)`), and the
// routers it mounts (`app.route('/api/auth', auth)`, `router.use('/admin', adminRouter)`); joinRouters() then gives
// every route its full path, through the mounts, across files. Frameworks are known by the module they're imported
// or required from, as written. https://hono.dev/docs/api/routing and https://expressjs.com/en/guide/routing.html
import type * as TS from 'typescript';
import { importsOf, joinPath, positionOf, spanOf, stringValue, type FileContext } from './ast.js';
import type { FoundEntry, Position, Span } from './types.js';

export type RouterFramework = 'hono' | 'express';

const HTTP = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'] as const;

/** A route as its router registers it: its own path, before any base path or mount. */
export interface RegisteredRoute {
  readonly method: string;
  /** Null when the code doesn't fix it. */
  readonly path: string | null;
  readonly at: Position;
  readonly handler?: Span;
  readonly handlerName?: Span;
  /** Why it has neither. */
  readonly why?: string;
}

/** One router mounting another: the prefix it's mounted at, and the expression naming the router mounted. */
export interface Mount {
  readonly prefix: string | null;
  readonly target: Span;
  readonly at: Position;
}

export interface Router {
  /** Where it's declared: the variable's name, or the expression creating it. The joiner's key. */
  readonly id: Span;
  readonly framework: RouterFramework;
  /** A Hono app's `basePath('/api/private')`: `''` without one, null when the code doesn't fix it. */
  readonly base: string | null;
  readonly routes: readonly RegisteredRoute[];
  readonly mounts: readonly Mount[];
}

/** The routers a file creates, with their routes and mounts. */
export function routersOf(context: FileContext): Router[] {
  const { ts, source } = context;
  const creators = creatorsOf(context);
  if (creators.hono.size === 0 && creators.express.size === 0) return [];
  // Each router by its variable (or, unnamed, its creating expression), and what's registered on it.
  const routers = new Map<
    TS.Node,
    { framework: RouterFramework; base: string | null; routes: RegisteredRoute[]; mounts: Mount[] }
  >();
  const byName = new Map<string, TS.Node>();

  /** If `expression` is a chain that starts by creating a router, the router's framework and its base path. */
  const created = (
    expression: TS.Expression,
  ): { framework: RouterFramework; base: string | null } | null => {
    let node: TS.Expression = expression;
    let base: string | null = '';
    const chain: TS.CallExpression[] = [];
    for (;;) {
      // The creating call ends the chain, even when it's a member call itself (`express.Router()`).
      if (creation(context, creators, node) !== null) break;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        chain.push(node);
        node = node.expression.expression;
        continue;
      }
      break;
    }
    const framework = creation(context, creators, node);
    if (framework === null) return null;
    for (const call of chain.reverse()) {
      const name = (call.expression as TS.PropertyAccessExpression).name.text;
      if (framework === 'hono' && name === 'basePath') {
        const value =
          call.arguments[0] === undefined ? null : stringValue(context, call.arguments[0]);
        base = base === null || value === null ? null : joinPath(base, value);
      }
    }
    return { framework, base };
  };

  // Routers held by variables.
  const visitDeclarations = (node: TS.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const made = created(node.initializer);
      if (made !== null) {
        routers.set(node.name, { ...made, routes: [], mounts: [] });
        byName.set(node.name.text, node.name);
        registerChain(node.name, node.initializer);
      }
    }
    ts.forEachChild(node, visitDeclarations);
  };

  /** A chain like `new Hono().basePath('/x').get('/a', h).route('/b', sub)`: what it registers on `owner`. */
  const registerChain = (owner: TS.Node, expression: TS.Expression) => {
    const calls: TS.CallExpression[] = [];
    let node: TS.Expression = expression;
    while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      calls.push(node);
      node = node.expression.expression;
    }
    for (const call of calls.reverse()) register(owner, call);
  };

  const register = (owner: TS.Node, call: TS.CallExpression) => {
    const router = routers.get(owner);
    if (router === undefined || !ts.isPropertyAccessExpression(call.expression)) return;
    const name = call.expression.name.text;
    const args = call.arguments;
    const at = positionOf(source, call.expression.name);
    if ((HTTP as readonly string[]).includes(name) && args.length >= 2) {
      router.routes.push(...route(context, name.toUpperCase(), args[0], args, at));
    } else if (router.framework === 'hono' && name === 'on' && args.length >= 3) {
      const methods =
        args[0] !== undefined && ts.isArrayLiteralExpression(args[0])
          ? args[0].elements
          : args.slice(0, 1);
      for (const method of methods) {
        const value = stringValue(context, method);
        router.routes.push(
          ...route(context, value?.toUpperCase() ?? ':UNKNOWN', args[1], args.slice(1), at),
        );
      }
    } else if (
      router.framework === 'hono' &&
      name === 'route' &&
      args.length === 2 &&
      args[1] !== undefined
    ) {
      router.mounts.push({
        prefix: args[0] === undefined ? null : stringValue(context, args[0]),
        target: spanOf(source, args[1]),
        at,
      });
    } else if (router.framework === 'express' && name === 'use') {
      // `use([prefix], ...middleware or routers)`: each identifier or member may be a router; the joiner keeps the
      // ones that are.
      const first = args[0];
      const given =
        first === undefined || isFunctionLike(ts, first) ? null : stringValue(context, first);
      const prefix = given ?? '';
      for (const arg of given === null ? args : args.slice(1)) {
        if (
          ts.isIdentifier(arg) ||
          ts.isPropertyAccessExpression(arg) ||
          ts.isCallExpression(arg)
        ) {
          router.mounts.push({ prefix, target: spanOf(source, arg), at });
        }
      }
    } else if (
      router.framework === 'express' &&
      name === 'route' &&
      args.length === 1 &&
      args[0] !== undefined
    ) {
      const path = args[0];
      // `router.route('/:id').get(h).post(h)`: the methods chained on it, at its path.
      let parent: TS.Node = call;
      while (
        ts.isPropertyAccessExpression(parent.parent) &&
        ts.isCallExpression(parent.parent.parent) &&
        parent.parent.parent.expression === parent.parent
      ) {
        const chained = parent.parent.parent;
        const method = parent.parent.name.text;
        if ((HTTP as readonly string[]).includes(method)) {
          router.routes.push(
            ...route(
              context,
              method.toUpperCase(),
              path,
              [path, ...chained.arguments],
              positionOf(source, parent.parent.name),
            ),
          );
        }
        parent = chained;
      }
    }
  };

  visitDeclarations(source);
  // Registrations on a router's name: `app.get(…)`, and chains starting from it (`app.get(…).post(…)`).
  const visitCalls = (node: TS.Node) => {
    if (ts.isExpressionStatement(node) || ts.isReturnStatement(node)) {
      const expression = ts.isExpressionStatement(node) ? node.expression : node.expression;
      if (expression !== undefined) {
        let root: TS.Expression = expression;
        while (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression)) {
          root = root.expression.expression;
        }
        const owner = ts.isIdentifier(root) ? byName.get(root.text) : undefined;
        if (owner !== undefined) registerChain(owner, expression);
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(source);

  return [...routers].map(([node, router]) => ({ id: spanOf(source, node), ...router }));
}

function route(
  context: FileContext,
  method: string,
  pathArg: TS.Expression | undefined,
  args: readonly TS.Expression[],
  at: Position,
): RegisteredRoute[] {
  const { ts, source } = context;
  // Express takes a list of paths too (`['/:id/files', '/:id/files/*rest']`): one route each.
  const paths =
    pathArg !== undefined && ts.isArrayLiteralExpression(pathArg)
      ? pathArg.elements.map((element) => stringValue(context, element))
      : [pathArg === undefined ? null : stringValue(context, pathArg)];
  const last = args.at(-1);
  const handling: Pick<RegisteredRoute, 'handler' | 'handlerName' | 'why'> =
    last === undefined || args.length < 2
      ? { why: 'It has no handler written here.' }
      : isFunctionLike(ts, last)
        ? { handler: spanOf(source, last) }
        : ts.isIdentifier(last) || ts.isPropertyAccessExpression(last)
          ? { handlerName: spanOf(source, last) }
          : ts.isSpreadElement(last)
            ? { why: 'Its handlers are a list built in code.' }
            : { why: 'Its handler is made when the app runs, not written as a function here.' };
  return paths.map((path) => ({ method, path, at, ...handling }));
}

const isFunctionLike = (ts: FileContext['ts'], node: TS.Node) =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/** The local names that create routers: Hono's class, Express's function and its Router. */
function creatorsOf(context: FileContext): { hono: Set<string>; express: Set<string> } {
  const { ts, source } = context;
  const hono = new Set<string>();
  const express = new Set<string>();
  for (const [local, imported] of importsOf(ts, source)) {
    if (/^hono(\/|$)/.test(imported.module) && imported.name === 'Hono') hono.add(local);
    if (imported.module === 'express')
      express.add(imported.name === 'Router' ? `Router:${local}` : local);
  }
  // CommonJS: `const express = require('express')`, `const { Router } = require('express')`.
  const visit = (node: TS.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'require' &&
      node.initializer.arguments[0] !== undefined &&
      ts.isStringLiteral(node.initializer.arguments[0]) &&
      node.initializer.arguments[0].text === 'express'
    ) {
      if (ts.isIdentifier(node.name)) express.add(node.name.text);
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const name = (element.propertyName ?? element.name).getText(source);
          if (name === 'Router' && ts.isIdentifier(element.name))
            express.add(`Router:${element.name.text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { hono, express };
}

/** Whether `node` creates a router: `new Hono()`, `express()`, `express.Router()`, `Router()`. */
function creation(
  context: FileContext,
  creators: { hono: Set<string>; express: Set<string> },
  node: TS.Expression,
): RouterFramework | null {
  const { ts } = context;
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    creators.hono.has(node.expression.text)
  ) {
    return 'hono';
  }
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    if (creators.express.has(callee.text) || creators.express.has(`Router:${callee.text}`))
      return 'express';
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    creators.express.has(callee.expression.text) &&
    callee.name.text === 'Router'
  ) {
    return 'express';
  }
  return null;
}

/** A router across files, as the joiner sees it: `key` is its file and id, `mounts` resolved to other routers' keys. */
export interface JoinableRouter {
  readonly key: string;
  readonly framework: RouterFramework;
  readonly base: string | null;
  readonly routes: readonly (RegisteredRoute & { readonly file: string })[];
  /** Each mount's prefix and the key of the router it mounts (unresolved mounts aren't listed). */
  readonly mounts: readonly { readonly prefix: string | null; readonly target: string }[];
}

/**
 * Every route with its full path: from each router no other mounts (a root), down its mounts. A router mounted at
 * two prefixes has its routes under both. A prefix or path the code doesn't fix makes the route incomplete, its
 * unknown part written `:unknown`; a cycle of mounts is cut where it repeats.
 */
export function joinRouters(
  routers: readonly JoinableRouter[],
): (FoundEntry & { readonly file: string })[] {
  const byKey = new Map(routers.map((router) => [router.key, router]));
  const mounted = new Set(routers.flatMap((router) => router.mounts.map((m) => m.target)));
  const found: (FoundEntry & { file: string })[] = [];
  const walk = (router: JoinableRouter, prefix: string | null, seen: ReadonlySet<string>) => {
    const base = prefix === null || router.base === null ? null : joinPath(prefix, router.base);
    for (const r of router.routes) {
      const complete = base !== null && r.path !== null;
      found.push({
        kind: 'api-route',
        framework: router.framework,
        name: `${r.method} ${joinPath(base ?? ':unknown', r.path ?? ':unknown')}`,
        at: r.at,
        complete,
        ...(complete
          ? r.why === undefined
            ? {}
            : { why: r.why }
          : { why: 'Part of its path isn’t a constant the code fixes.' }),
        ...(r.handler === undefined ? {} : { handler: r.handler }),
        ...(r.handlerName === undefined ? {} : { handlerName: r.handlerName }),
        file: r.file,
      });
    }
    for (const mount of router.mounts) {
      const next = byKey.get(mount.target);
      if (next === undefined || seen.has(next.key)) continue;
      walk(
        next,
        base === null || mount.prefix === null ? null : joinPath(base, mount.prefix),
        new Set([...seen, next.key]),
      );
    }
  };
  for (const router of routers) {
    if (!mounted.has(router.key)) walk(router, '', new Set([router.key]));
  }
  return found;
}
