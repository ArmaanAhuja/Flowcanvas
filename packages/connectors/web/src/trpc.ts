// tRPC (Rallly, Documenso; ADR 0030): a procedure is an API route named by its path through the routers
// (`admin.search`). Procedures are written inline in `router({ … })` or held by constants in other files, and routers
// nest by name across files, so each file reports its routers and procedures, and joinTrpc() names them from the root
// down. `router`, `mergeRouters` and the procedure builders are the project's own (`export const router = t.router`),
// so they're recognised by following them back, with the checker, to `initTRPC` from `@trpc/server`; never by their
// spelling. https://trpc.io/docs/server/routers
import type * as TS from 'typescript';
import { importsOf, positionOf, spanOf, type FileContext } from './ast.js';
import type { FoundEntry, Position, Span } from './types.js';

const KINDS = ['query', 'mutation', 'subscription'] as const;

export interface TrpcProcedure {
  readonly kind: (typeof KINDS)[number];
  readonly at: Position;
  readonly handler?: Span;
  readonly why?: string;
}

/** What a router's key holds: a procedure written there, or a name (a procedure or a router elsewhere). */
export type TrpcValue =
  { readonly procedure: TrpcProcedure } | { readonly target: Span } | { readonly router: Span };

export interface TrpcRouter {
  /** The `router(…)` call (or the variable holding it): the joiner's key. */
  readonly id: Span;
  /** The variable holding it, when one does; others refer to it by that. */
  readonly name?: Span;
  readonly keys: readonly { readonly key: string; readonly value: TrpcValue }[];
  /** `mergeRouters(a, b)`: routers whose procedures it has at its own level. */
  readonly merged: readonly TrpcValue[];
}

export interface TrpcFile {
  readonly routers: readonly TrpcRouter[];
  /** Procedures held by variables: `export const adminSearchRoute = adminProcedure.query(…)`. */
  readonly procedures: readonly { readonly name: Span; readonly procedure: TrpcProcedure }[];
}

export function trpcOf(context: FileContext): TrpcFile {
  const { ts, source, checker } = context;
  if (checker === undefined) return { routers: [], procedures: [] };
  const routers: TrpcRouter[] = [];
  const procedures: { name: Span; procedure: TrpcProcedure }[] = [];
  const from = trpcMaker(context);

  /** `router({…})` or `mergeRouters(…)` at `node`, recorded with what it holds. */
  const routerAt = (call: TS.CallExpression, name?: TS.Node): Span | null => {
    const made = from(call.expression);
    if (made !== 'router' && made !== 'merge') return null;
    const id = spanOf(source, call);
    const keys: { key: string; value: TrpcValue }[] = [];
    const merged: TrpcValue[] = [];
    if (made === 'router') {
      const object = call.arguments[0];
      if (object !== undefined && ts.isObjectLiteralExpression(object)) {
        for (const property of object.properties) {
          if (ts.isPropertyAssignment(property)) {
            const key = property.name.getText(source).replace(/^['"]|['"]$/g, '');
            const value = valueOf(property.initializer);
            if (value !== null) keys.push({ key, value });
          } else if (ts.isShorthandPropertyAssignment(property)) {
            keys.push({
              key: property.name.text,
              value: { target: spanOf(source, property.name) },
            });
          } else if (ts.isSpreadAssignment(property)) {
            const value = valueOf(property.expression);
            if (value !== null) merged.push(value);
          }
        }
      }
    } else {
      for (const argument of call.arguments) {
        const value = valueOf(argument);
        if (value !== null) merged.push(value);
      }
    }
    routers.push({
      id,
      ...(name === undefined ? {} : { name: spanOf(source, name) }),
      keys,
      merged,
    });
    return id;
  };

  const valueOf = (expression: TS.Expression): TrpcValue | null => {
    if (ts.isCallExpression(expression)) {
      const nested = routerAt(expression);
      if (nested !== null) return { router: nested };
      const procedure = procedureOf(context, expression, from);
      if (procedure !== null) return { procedure };
      return null;
    }
    if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
      return { target: spanOf(source, expression) };
    }
    return null;
  };

  const visit = (node: TS.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = node.initializer;
      if (ts.isCallExpression(initializer)) {
        if (routerAt(initializer, node.name) !== null) return;
        const procedure = procedureOf(context, initializer, from);
        if (procedure !== null) {
          procedures.push({ name: spanOf(source, node.name), procedure });
          return;
        }
      }
    }
    // A router not held by a variable (`export default router({…})`) is still one.
    if (ts.isCallExpression(node) && routerAt(node) !== null) return;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { routers, procedures };
}

/** A procedure chain (`adminProcedure.input(x).query(async …)`), if `call` ends one. */
function procedureOf(
  context: FileContext,
  call: TS.CallExpression,
  from: (expression: TS.Expression) => TrpcMade | null,
): TrpcProcedure | null {
  const { ts, source } = context;
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const kind = call.expression.name.text;
  if (!(KINDS as readonly string[]).includes(kind)) return null;
  let root: TS.Expression = call.expression.expression;
  while (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression)) {
    root = root.expression.expression;
  }
  if (from(root) !== 'procedure') return null;
  const fn = call.arguments[0];
  const handled =
    fn !== undefined && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
      ? { handler: spanOf(source, fn) }
      : { why: 'Its handler isn’t written as a function here.' };
  return {
    kind: kind as TrpcProcedure['kind'],
    at: positionOf(source, call.expression.name),
    ...handled,
  };
}

type TrpcMade = 'router' | 'merge' | 'procedure';

/**
 * Whether an expression is tRPC's router maker, its merge, or a procedure builder: followed back through variables,
 * imports and member chains (`t.procedure.use(mw)`) to a value made by `initTRPC` from `@trpc/server`.
 */
function trpcMaker(context: FileContext): (expression: TS.Expression) => TrpcMade | null {
  const { ts, checker } = context;
  const known = new Map<TS.Node, TrpcMade | null>();
  const isInit = (node: TS.Expression, depth: number): boolean => {
    let root: TS.Expression = node;
    while (
      (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root)) &&
      !(ts.isIdentifier(root.expression) && isInitTRPC(root.expression))
    ) {
      root = root.expression;
    }
    if (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root)) return true;
    return ts.isIdentifier(root) && depth < 6 && declared(root, depth + 1) === 'instance';
  };
  const isInitTRPC = (identifier: TS.Identifier): boolean => {
    const imported = importsOf(ts, identifier.getSourceFile()).get(identifier.text);
    return imported?.module === '@trpc/server' && imported.name === 'initTRPC';
  };
  /** What a name is declared as: tRPC's instance (`t`), or one of its makers. */
  const declared = (identifier: TS.Identifier, depth: number): TrpcMade | 'instance' | null => {
    if (checker === undefined) return null;
    let symbol = checker.getSymbolAtLocation(identifier);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (
      declaration === undefined ||
      !ts.isVariableDeclaration(declaration) ||
      declaration.initializer === undefined
    ) {
      return null;
    }
    const value = declaration.initializer;
    // `t.router`, `t.mergeRouters`, `t.procedure…`: a maker, if its root is tRPC's instance.
    let root: TS.Expression = value;
    let member: string | null = null;
    while (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root)) {
      if (ts.isPropertyAccessExpression(root)) member = root.name.text;
      root = root.expression;
    }
    if (ts.isIdentifier(root) && isInitTRPC(root)) return 'instance';
    if (!ts.isIdentifier(root) || declared(root, depth + 1) !== 'instance') {
      // A builder made from another builder: `publicProcedure.use(mw)`.
      return ts.isIdentifier(root) && depth < 6 && declared(root, depth + 1) === 'procedure'
        ? 'procedure'
        : null;
    }
    if (member === 'router' || member === 'createRouter') return 'router';
    if (member === 'mergeRouters') return 'merge';
    // `t.procedure`, `t.procedure.use(mw)`: the first member read from the instance names it.
    let first: TS.Expression = value;
    let name: string | null = null;
    while (ts.isCallExpression(first) || ts.isPropertyAccessExpression(first)) {
      if (ts.isPropertyAccessExpression(first)) name = first.name.text;
      first = first.expression;
    }
    return name === 'procedure' ? 'procedure' : null;
  };
  return (expression) => {
    if (known.has(expression)) return known.get(expression) ?? null;
    let made: TrpcMade | null = null;
    if (ts.isIdentifier(expression)) {
      const kind = declared(expression, 0);
      made = kind === 'instance' ? null : kind;
    } else if (ts.isPropertyAccessExpression(expression) && isInit(expression.expression, 0)) {
      // `t.router(…)` and `t.procedure.query(…)` used straight from the instance.
      made =
        expression.name.text === 'router'
          ? 'router'
          : expression.name.text === 'mergeRouters'
            ? 'merge'
            : expression.name.text === 'procedure'
              ? 'procedure'
              : null;
    }
    known.set(expression, made);
    return made;
  };
}

/** A tRPC file's parts across files, keyed for the joiner; `target`s already resolved to keys. */
export interface JoinableTrpc {
  readonly routers: readonly {
    readonly key: string;
    readonly file: string;
    readonly keys: readonly { readonly key: string; readonly value: JoinableValue }[];
    readonly merged: readonly JoinableValue[];
  }[];
  readonly procedures: ReadonlyMap<string, TrpcProcedure & { readonly file: string }>;
}
export type JoinableValue =
  | { readonly procedure: TrpcProcedure & { readonly file: string } }
  | { readonly ref: string }
  | { readonly unresolved: true };

/**
 * Every procedure with its full name, from each router no other router holds (a root), down its keys and merges.
 * A key holding a name that couldn't be resolved is listed as incomplete (`admin.*`), never left out silently.
 */
export function joinTrpc(trpc: JoinableTrpc): (FoundEntry & { readonly file: string })[] {
  const byKey = new Map(trpc.routers.map((router) => [router.key, router]));
  const held = new Set(
    trpc.routers.flatMap((router) =>
      [...router.keys.map((k) => k.value), ...router.merged].flatMap((v) =>
        'ref' in v ? [v.ref] : [],
      ),
    ),
  );
  const found: (FoundEntry & { file: string })[] = [];
  const add = (name: string, procedure: TrpcProcedure & { file: string }) => {
    found.push({
      kind: 'api-route',
      framework: 'trpc',
      name: `${procedure.kind} ${name}`,
      at: procedure.at,
      complete: true,
      ...(procedure.handler === undefined ? {} : { handler: procedure.handler }),
      ...(procedure.why === undefined ? {} : { why: procedure.why }),
      file: procedure.file,
    });
  };
  const walk = (key: string, prefix: string, seen: ReadonlySet<string>) => {
    const router = byKey.get(key);
    if (router === undefined) return;
    const step = (value: JoinableValue, path: string, file: string) => {
      if ('procedure' in value) add(path, value.procedure);
      else if ('ref' in value) {
        const procedure = trpc.procedures.get(value.ref);
        if (procedure !== undefined) add(path, procedure);
        else if (byKey.has(value.ref) && !seen.has(value.ref)) {
          walk(value.ref, path, new Set([...seen, value.ref]));
        }
      } else {
        found.push({
          kind: 'api-route',
          framework: 'trpc',
          name: `${path === '' ? '' : `${path}.`}*`,
          at: { line: 1, column: 1 },
          complete: false,
          why: 'It holds a router or procedure the code doesn’t name.',
          file,
        });
      }
    };
    for (const { key: name, value } of router.keys) {
      step(value, prefix === '' ? name : `${prefix}.${name}`, router.file);
    }
    for (const value of router.merged) step(value, prefix, router.file);
  };
  for (const router of trpc.routers) {
    if (!held.has(router.key)) walk(router.key, '', new Set([router.key]));
  }
  return found;
}
