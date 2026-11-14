// Entry points in the graph pass (phase 8, ADR 0030). Each file's detectors run as the pass walks it, while its
// program and checker are here: what a file settles alone (a route file, a NestJS controller, an event prop, a server
// action) is kept as found; what spans files (a router mounted elsewhere, a tRPC router nested from another file, a
// <Routes> block inside a component) is kept with every name it refers to already resolved to a key, and joined after
// the walk. Every handler is resolved to its node now, so the join needs no checker. An anonymous handler becomes a
// code unit of its own (§3), named after its entry point once the join knows its full name.
import { posix } from 'node:path';
import {
  eventEntries,
  exportsOf,
  flatRoute,
  flatRouteEntries,
  importsOf,
  joinReactRouter,
  joinRouters,
  joinTrpc,
  nestEntries,
  nextAppRoute,
  nextRouteEntries,
  reactRouterOf,
  routersOf,
  scriptEntries,
  serverActionEntries,
  trpcOf,
  type FileContext,
  type FoundEntry,
  type JoinableRoute,
  type JoinableRouter,
  type JoinableTree,
  type JoinableTrpc,
  type JoinableValue,
  type RouteNode,
  type Span,
  type TrpcProcedure,
  type TrpcValue,
} from '@flowcanvas/connectors-web';
import type { GraphEdge, GraphNode, Relation } from '@flowcanvas/graph-model';
import type * as TS from 'typescript';
import { cut, findNode } from './callables.js';
import {
  namedUnitId,
  projectPath,
  unitIdOf,
  unitNodeAt,
  type GraphContext,
  type HandlerUnit,
} from './graph-pass.js';
import type { WorkspacePackage } from './projects.js';

/** What a handler reaches: a node of the graph, or the code's own text when it isn't the project's. */
export type Reach = { readonly to: string } | { readonly text: string };

/** An entry point with the project path of the file it's declared in. */
export type Located = FoundEntry & {
  readonly file: string;
  /** For an element: the unit it's in. */
  readonly within?: string | null;
};

type Procedure = TrpcProcedure & { readonly file: string };

/** One file's entry points, as found and as pieces to join (held with the file's part of the graph). */
export interface FileEntries {
  readonly found: readonly Located[];
  readonly routers: readonly JoinableRouter[];
  readonly trpcRouters: JoinableTrpc['routers'];
  readonly trpcProcedures: readonly (readonly [string, Procedure])[];
  readonly trees: readonly JoinableTree[];
  /** By `path:start:end`: what each handler written in these reports reaches. */
  readonly reaches: ReadonlyMap<string, Reach>;
  /** Project paths whose declarations these reports refer to: a change there walks this file again. */
  readonly dependsOn: readonly string[];
  /** The ids of the units made for anonymous handlers, which take their entry point's name. */
  readonly anonymous: readonly string[];
}

/** A file named by the routes it serves (ADR 0030 §1), in a package that uses that framework. */
export type RouteFile =
  | { readonly kind: 'next'; readonly route: NonNullable<ReturnType<typeof nextAppRoute>> }
  | { readonly kind: 'flat'; readonly route: NonNullable<ReturnType<typeof flatRoute>> };

export const ENTRY_MESSAGES = {
  delegated: 'Its requests go to a Hono app, whose own routes are listed.',
} as const;

/**
 * Whether a file is a route file: in a Next.js package's `app/` (or `src/app/`) folder, or a `remix-flat-routes`
 * package's `app/routes/`. `path` is project-relative.
 */
export function routeFileOf(path: string, packages: Iterable<WorkspacePackage>): RouteFile | null {
  let owner: WorkspacePackage | undefined;
  for (const pkg of packages) {
    const inside = pkg.dir === '' || path.startsWith(`${pkg.dir}/`);
    if (inside && (owner === undefined || pkg.dir.length > owner.dir.length)) owner = pkg;
  }
  if (owner === undefined) return null;
  const rel = owner.dir === '' ? path : path.slice(owner.dir.length + 1);
  if (owner.uses.includes('next')) {
    const folder = ['app/', 'src/app/'].find((f) => rel.startsWith(f));
    const route = folder === undefined ? null : nextAppRoute(rel.slice(folder.length));
    if (route !== null) return { kind: 'next', route };
  }
  if (owner.uses.includes('remix-flat-routes') && rel.startsWith('app/routes/')) {
    const route = flatRoute(rel.slice('app/routes/'.length));
    if (route !== null) return { kind: 'flat', route };
  }
  return null;
}

const spanKey = (file: string, span: Span) => `${file}:${String(span.start)}:${String(span.end)}`;

/** A file's entry points, and the anonymous handlers the walk is to make code units of. */
export function entriesOfFile(
  ctx: GraphContext,
  program: TS.Program,
  source: TS.SourceFile,
  routeFile: RouteFile | null,
): { readonly entries: FileEntries; readonly handlers: ReadonlyMap<TS.Node, HandlerUnit> } {
  const { ts } = ctx;
  const checker = program.getTypeChecker();
  const context: FileContext = { ts, source, checker };
  const path = projectPath(ctx, source.fileName);
  const dependsOn = new Set<string>();
  const handlers = new Map<TS.Node, HandlerUnit>();
  const handlerIds = new Map<string, number>();
  const reaches = new Map<string, Reach>();

  const sourceOf = (fileName: string) =>
    fileName === source.fileName ? source : program.getSourceFile(fileName);
  /** The node a span covers exactly. */
  const nodeAt = (file: TS.SourceFile, span: Span): TS.Node | undefined => {
    for (let node = findNode(ts, file, span.start); node !== undefined; node = node.parent) {
      if (node.getStart(file) === span.start && node.getEnd() === span.end) return node;
      if (ts.isSourceFile(node) || node.getStart(file) < span.start) return undefined;
    }
    return undefined;
  };
  const declarationOf = (node: TS.Node): TS.Declaration | undefined => {
    const name = ts.isPropertyAccessExpression(node) ? node.name : node;
    const resolved = (symbol: TS.Symbol | undefined) =>
      symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    let symbol = resolved(checker.getSymbolAtLocation(name));
    // TypeScript follows `routes.auth` through `module.exports = { auth }` and a `require` itself, but stops at a
    // property naming another value (`module.exports = { v1: router }`, LibreChat's agents): followed to that value,
    // or the router would be taken for a root and its paths listed without their mount.
    for (let step = 0; step < 4 && symbol !== undefined; step += 1) {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      if (
        declaration === undefined ||
        !ts.isPropertyAssignment(declaration) ||
        !(
          ts.isIdentifier(declaration.initializer) ||
          ts.isPropertyAccessExpression(declaration.initializer)
        )
      ) {
        break;
      }
      const value = declaration.initializer;
      symbol = resolved(
        checker.getSymbolAtLocation(ts.isPropertyAccessExpression(value) ? value.name : value),
      );
    }
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };
  const projectFileOf = (declaration: TS.Declaration): string | null => {
    const fileName = declaration.getSourceFile().fileName;
    if (!ctx.inProject(fileName)) return null;
    const file = projectPath(ctx, fileName);
    if (file !== path) dependsOn.add(file);
    return file;
  };
  /** A name's code unit, or its text. */
  const named = (file: TS.SourceFile, span: Span): Reach => {
    const node = nodeAt(file, span);
    if (node === undefined) return { text: cut(file.text.slice(span.start, span.end)) };
    const declaration = declarationOf(node);
    if (declaration !== undefined && projectFileOf(declaration) !== null) {
      const id = unitIdOf(ctx, declaration);
      if (id !== undefined) return { to: id };
      // A constant made by a call given a function (`useCallback(() => …, [])`, `form.handleSubmit(async …)`):
      // that function is what runs, made a unit of its own here when it's in this file.
      const wrapped = wrappedFunction(declaration);
      if (wrapped?.getSourceFile() === source) {
        return written(
          { start: wrapped.getStart(source), end: wrapped.getEnd() },
          node.getText(file),
        );
      }
    }
    return { text: cut(node.getText(file)) };
  };
  const wrappedFunction = (declaration: TS.Declaration): TS.Node | undefined => {
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined)
      return undefined;
    let value = declaration.initializer;
    while (ts.isAwaitExpression(value) || ts.isParenthesizedExpression(value))
      value = value.expression;
    if (!ts.isCallExpression(value)) return undefined;
    return value.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  };
  /** A name's declaration, as a key the join matches: its file and where its name starts. */
  const keyOf = (span: Span): string | null => {
    const node = nodeAt(source, span);
    const declaration = node === undefined ? undefined : declarationOf(node);
    if (declaration === undefined) return null;
    const file = projectFileOf(declaration);
    if (file === null) return null;
    const at = ts.getNameOfDeclaration(declaration) ?? declaration;
    return `${file}:${String(at.getStart(declaration.getSourceFile()))}`;
  };
  /** A function written as a handler: its own unit if it's named, else one made for it (§3). */
  const written = (span: Span, label: string): Reach => {
    const node = nodeAt(source, span);
    if (node === undefined) return { text: label };
    const own = namedUnitId(ctx, node);
    if (own !== undefined) return { to: own };
    const known = handlers.get(node);
    if (known !== undefined) return { to: known.id };
    const scope = unitNodeAt(ctx, source, node.getStart(source));
    const base = `${scope.node === null ? `${path}#` : `${scope.id}.`}(handler ${cut(label)})`;
    const seen = (handlerIds.get(base) ?? 0) + 1;
    handlerIds.set(base, seen);
    const id = seen === 1 ? base : `${base}~${String(seen)}`;
    handlers.set(node, { id, name: cut(label) });
    return { to: id };
  };
  const resolveHandlers = (
    entry: { readonly handler?: Span; readonly handlerName?: Span },
    label: string,
  ) => {
    if (entry.handler !== undefined)
      reaches.set(spanKey(path, entry.handler), written(entry.handler, label));
    if (entry.handlerName !== undefined) {
      reaches.set(spanKey(path, entry.handlerName), named(source, entry.handlerName));
    }
  };

  // Settled in this file.
  const found: Located[] = [];
  const keep = (entry: FoundEntry, within?: string | null) => {
    resolveHandlers(entry, entry.name);
    found.push({ ...entry, file: path, ...(within === undefined ? {} : { within }) });
  };
  if (routeFile?.kind === 'next') {
    const exports = exportsOf(context);
    const imports = importsOf(ts, source);
    // `export const GET = handle(app)`: the Hono app serves it, and its routes are the API (ADR 0030 §1).
    const delegated = (name: string) => {
      const value = exports.get(name.split(' ')[0] ?? '')?.value;
      return (
        value !== null &&
        value !== undefined &&
        ts.isCallExpression(value) &&
        ts.isIdentifier(value.expression) &&
        (imports.get(value.expression.text)?.module.startsWith('hono') ?? false)
      );
    };
    for (const entry of nextRouteEntries(context, routeFile.route)) {
      if (entry.kind === 'api-route' && delegated(entry.name)) continue;
      keep(entry);
    }
  } else if (routeFile?.kind === 'flat') {
    for (const entry of flatRouteEntries(context, routeFile.route)) keep(entry);
  }
  for (const entry of nestEntries(context)) keep(entry);
  for (const entry of serverActionEntries(context)) keep(entry);
  for (const { within, ...entry } of eventEntries(context)) {
    const holder = within === undefined ? null : unitNodeAt(ctx, source, within.start);
    keep(entry, holder?.node == null ? null : holder.id);
  }

  // Routers, joined from the roots through their mounts.
  const routers: JoinableRouter[] = routersOf(context).map((router) => ({
    key: `${path}:${String(router.id.start)}`,
    framework: router.framework,
    base: router.base,
    mountedOnly: router.mountedOnly,
    routes: router.routes.map((route) => {
      resolveHandlers(route, `${route.method} ${route.path ?? ':unknown'}`);
      return { ...route, file: path };
    }),
    mounts: router.mounts.flatMap((mount) => {
      const target = keyOf(mount.target);
      return target === null ? [] : [{ prefix: mount.prefix, target }];
    }),
  }));

  // tRPC routers and the procedures variables hold, joined from the roots.
  const trpc = trpcOf(context);
  const value = (held: TrpcValue, label: string): JoinableValue => {
    if ('procedure' in held) {
      resolveHandlers(held.procedure, `${held.procedure.kind} ${label}`);
      return { procedure: { ...held.procedure, file: path } };
    }
    if ('router' in held) return { ref: `${path}:${String(held.router.start)}` };
    const target = keyOf(held.target);
    return target === null ? { unresolved: true } : { ref: target };
  };
  const trpcRouters: JoinableTrpc['routers'] = trpc.routers.map((router) => ({
    key: `${path}:${String((router.name ?? router.id).start)}`,
    file: path,
    keys: router.keys.map(({ key, value: held }) => ({ key, value: value(held, key) })),
    merged: router.merged.map((held) => value(held, 'merged')),
  }));
  const trpcProcedures = trpc.procedures.map(({ name, procedure }) => {
    const label = source.text.slice(name.start, name.end);
    resolveHandlers(procedure, `${procedure.kind} ${label}`);
    return [`${path}:${String(name.start)}`, { ...procedure, file: path }] as const;
  });

  // React Router trees, each route's component resolved to its unit, and the unit a <Routes> block is in.
  const route = (node: RouteNode): JoinableRoute => {
    const file = projectPath(ctx, node.file);
    if (file !== path) dependsOn.add(file);
    const routeSource = sourceOf(node.file);
    let component: string | undefined;
    if (node.element !== undefined && routeSource !== undefined) {
      const reach = named(routeSource, node.element);
      reaches.set(spanKey(file, node.element), reach);
      if ('to' in reach) component = reach.to;
    }
    return {
      path: node.path,
      index: node.index,
      at: node.at,
      redirect: node.redirect,
      lazy: node.lazy,
      ...(node.unfollowed === undefined ? {} : { unfollowed: node.unfollowed }),
      ...(file === path ? {} : { file }),
      ...(component === undefined ? {} : { component }),
      ...(node.element === undefined ? {} : { element: node.element }),
      children: node.children.map(route),
    };
  };
  const trees: JoinableTree[] = reactRouterOf(context).map((tree) => {
    const holder = tree.within === undefined ? null : unitNodeAt(ctx, source, tree.within.start);
    return {
      file: path,
      root: tree.root,
      ...(holder?.node == null ? {} : { within: holder.id }),
      ...(tree.unfollowed === undefined ? {} : { unfollowed: tree.unfollowed }),
      routes: tree.routes.map(route),
    };
  });

  return {
    entries: {
      found,
      routers,
      trpcRouters,
      trpcProcedures,
      trees,
      reaches,
      dependsOn: [...dependsOn],
      anonymous: [...handlers.values()].map((handler) => handler.id),
    },
    handlers,
  };
}

/** A package's scripts (ADR 0030 §2), each reaching the project file it runs when it names one. */
export function scriptsOf(pkg: WorkspacePackage, text: string): Located[] {
  const file = pkg.dir === '' ? 'package.json' : `${pkg.dir}/package.json`;
  try {
    return scriptEntries(text, pkg.name).map((entry) => ({
      ...entry,
      file,
      ...(entry.runs === undefined
        ? {}
        : { runs: posix.normalize(pkg.dir === '' ? entry.runs : `${pkg.dir}/${entry.runs}`) }),
    }));
  } catch {
    // Not JSON: findPackages has already skipped it.
    return [];
  }
}

export interface JoinedEntries {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Anonymous handlers' names, by their id: their entry point's full name. */
  readonly handlerNames: ReadonlyMap<string, string>;
}

/**
 * Every file's entry points joined into the graph: one node per entry point (§2), with a `convention` edge to what
 * handles it (an unknown one, with its text, when that's not the project's code). `has` says which nodes the graph
 * has: an edge never reaches one it lacks.
 */
export function joinEntries(
  parts: readonly FileEntries[],
  scripts: readonly Located[],
  has: (id: string) => boolean,
): JoinedEntries {
  const reaches = new Map<string, Reach>();
  for (const part of parts) for (const [key, reach] of part.reaches) reaches.set(key, reach);
  const anonymous = new Set(parts.flatMap((part) => part.anonymous));
  const all: Located[] = [
    ...parts.flatMap((part) => part.found),
    ...joinRouters(parts.flatMap((part) => part.routers)),
    ...joinTrpc({
      routers: parts.flatMap((part) => part.trpcRouters),
      procedures: new Map(parts.flatMap((part) => part.trpcProcedures)),
    }),
    ...joinReactRouter(parts.flatMap((part) => part.trees)),
    ...scripts,
  ];
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const handlerNames = new Map<string, string>();
  const seen = new Set<string>();
  const used = new Map<string, number>();
  for (const entry of all) {
    const where = `${entry.file}:${entry.name}:${String(entry.at.line)}:${String(entry.at.column)}`;
    if (seen.has(where)) continue;
    seen.add(where);
    const base = `${entry.file}#(entry ${entry.name})`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}~${String(n)}`;
    nodes.set(id, {
      id,
      kind: 'entry-point',
      name: entry.name,
      place: { path: entry.file, line: entry.at.line, column: entry.at.column },
      unit: null,
      change: 'unchanged',
      entry: {
        kind: entry.kind,
        framework: entry.framework,
        complete: entry.complete,
        why: entry.why ?? null,
        within: entry.within ?? null,
      },
    });
    const span = entry.handler ?? entry.handlerName;
    const reach: Reach | undefined =
      span !== undefined
        ? reaches.get(spanKey(entry.file, span))
        : entry.runs === undefined
          ? undefined
          : has(`${entry.runs}#(top level)`)
            ? { to: `${entry.runs}#(top level)` }
            : { text: entry.runs };
    if (reach === undefined) continue;
    const relation: Relation = entry.kind === 'screen' ? 'renders' : 'calls';
    const call = { from: id, kind: 'call' as const, relation, label: null, lines: [entry.at.line] };
    if ('to' in reach && has(reach.to)) {
      edges.push({ ...call, to: reach.to, target: null, provenance: 'convention' });
      // Mounted twice, a handler is one unit: it's named after the first of its entry points.
      if (anonymous.has(reach.to) && !handlerNames.has(reach.to)) {
        handlerNames.set(reach.to, entry.name);
      }
    } else {
      // A unit the graph lacks (its file in no program): known by name only.
      const text = 'to' in reach ? reach.to.slice(reach.to.indexOf('#') + 1) : reach.text;
      edges.push({ ...call, to: null, target: text, provenance: 'unknown' });
    }
  }
  return { nodes: [...nodes.values()], edges, handlerNames };
}
