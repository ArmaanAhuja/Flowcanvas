// React Router routes declared in code (LibreChat's route objects, Twenty's <Route> elements; ADR 0030). A file reports
// its route trees: for the app's router (`createBrowserRouter(…)` and its kin), and for `<Routes>` blocks and
// `useRoutes(…)` inside components. Routes are followed wherever the code builds them: arrays of route objects and
// their spreads, `<Route>` elements and fragments, variables, `createRoutesFromElements(…)`, a function's returned value
// (in any file, through the checker), both branches of a `?:`, and a function taking and returning the same route type
// (Twenty's `removeGeneratedRouteIds`), taken as passing its routes through. What can't be followed is marked, never
// guessed. A tree inside a component is mounted wherever a route renders that component (relative to that route's
// path); joinReactRouter() puts them together. A route with children is a layout, not a screen; a redirect
// (`<Navigate>`) isn't one either. https://reactrouter.com/start/data/routing
import type * as TS from 'typescript';
import { importsOf, positionOf, spanOf, stringValue, type FileContext } from './ast.js';
import type { FoundEntry, Position, Span } from './types.js';

export interface RouteNode {
  /** The file it's declared in (it may be another than the tree's). */
  readonly file: string;
  /** Its own path, relative to its parent's (absolute when it starts with `/`); undefined for none, null for unknown. */
  readonly path: string | null | undefined;
  readonly index: boolean;
  readonly at: Position;
  /** The component it renders: its element's tag or `Component`, in `file`, for the engine to resolve. */
  readonly element?: Span;
  readonly redirect: boolean;
  /** Its page is loaded when the app runs (`lazy`). */
  readonly lazy: boolean;
  readonly children: readonly RouteNode[];
  /** Children (or routes) the code builds in a way that couldn't be followed. */
  readonly unfollowed?: string;
}

export interface RouteTree {
  readonly routes: readonly RouteNode[];
  /** The component (or function) whose code holds it, for a `<Routes>` block or `useRoutes`: where it's mounted from. */
  readonly within?: Span;
  /** The app's router itself (createBrowserRouter and its kin): a root. */
  readonly root: boolean;
  /** Routes the code builds in a way that couldn't be followed. */
  readonly unfollowed?: string;
}

const ROUTERS = [
  'createBrowserRouter',
  'createHashRouter',
  'createMemoryRouter',
  'createStaticRouter',
];
/** How many calls and variables deep routes are followed (a route's own children don't count: they always end). */
const DEPTH = 12;

export function reactRouterOf(context: FileContext): RouteTree[] {
  const { ts, source } = context;
  const rrIn = (file: TS.SourceFile) => {
    const names = new Map<string, string>();
    for (const [local, imported] of importsOf(ts, file)) {
      if (imported.module === 'react-router' || imported.module === 'react-router-dom') {
        names.set(local, imported.name);
      }
    }
    return names;
  };
  const here = rrIn(source);
  if (here.size === 0) return [];
  const follow = follower(context, rrIn);
  const trees: RouteTree[] = [];

  const visit = (node: TS.Node, within: TS.Node | undefined) => {
    let holder = within;
    if (
      (ts.isFunctionDeclaration(node) && node.name !== undefined) ||
      (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
    ) {
      holder = node.name;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = here.get(node.expression.text);
      const first = node.arguments[0];
      if (
        name !== undefined &&
        first !== undefined &&
        (ROUTERS.includes(name) || name === 'useRoutes')
      ) {
        const routes = follow.routes(first, 0);
        trees.push({
          routes: routes.routes,
          root: name !== 'useRoutes',
          ...(name === 'useRoutes' && holder !== undefined
            ? { within: spanOf(source, holder) }
            : {}),
          ...(routes.unfollowed === undefined ? {} : { unfollowed: routes.unfollowed }),
        });
        return;
      }
    }
    if (ts.isJsxElement(node) && follow.tagIs(node.openingElement, 'Routes')) {
      trees.push({
        routes: node.children.flatMap((child) => follow.routes(child, 0).routes),
        root: false,
        ...(holder === undefined ? {} : { within: spanOf(source, holder) }),
      });
      return;
    }
    ts.forEachChild(node, (child) => {
      visit(child, holder);
    });
  };
  visit(source, undefined);
  return trees;
}

/** Parameters bound to the arguments of the call being followed, each with the bindings it was written under. */
type Env = ReadonlyMap<
  TS.ParameterDeclaration,
  { readonly value: TS.Expression; readonly env: Env }
>;
const NO_BINDINGS: Env = new Map();

interface Followed {
  readonly routes: RouteNode[];
  readonly unfollowed?: string;
}

function follower(context: FileContext, rrIn: (file: TS.SourceFile) => Map<string, string>) {
  const { ts, checker } = context;
  const rrNames = new Map<TS.SourceFile, Map<string, string>>();
  const rrOf = (file: TS.SourceFile) => {
    let names = rrNames.get(file);
    if (names === undefined) {
      names = rrIn(file);
      rrNames.set(file, names);
    }
    return names;
  };
  const tagIs = (opening: TS.JsxOpeningLikeElement, name: string) =>
    ts.isIdentifier(opening.tagName) &&
    rrOf(opening.getSourceFile()).get(opening.tagName.text) === name;
  const none = (why: string): Followed => ({ routes: [], unfollowed: why });
  const merge = (all: readonly Followed[]): Followed => {
    const unfollowed = all.find((f) => f.unfollowed !== undefined)?.unfollowed;
    return {
      routes: all.flatMap((f) => f.routes),
      ...(unfollowed === undefined ? {} : { unfollowed }),
    };
  };

  /** The declaration a name or call refers to, through imports. */
  const declarationOf = (node: TS.Node): TS.Declaration | undefined => {
    if (checker === undefined) return undefined;
    // A shorthand property's name is the property; its value is the variable of that name.
    let symbol =
      ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };

  /** What a function returns: its concise body, or each `return`'s expression (not inside nested functions). */
  const returnsOf = (fn: TS.SignatureDeclaration): TS.Expression[] => {
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
    const body = (fn as { body?: TS.Node }).body;
    if (body === undefined) return [];
    const found: TS.Expression[] = [];
    const visit = (node: TS.Node) => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  };

  const functionOf = (
    declaration: TS.Declaration | undefined,
  ): TS.SignatureDeclaration | undefined => {
    if (declaration === undefined) return undefined;
    if (ts.isFunctionDeclaration(declaration)) return declaration;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const value = declaration.initializer;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
    }
    return undefined;
  };

  /** A function taking and returning the same declared type (`(routes: R[]): R[]`): it passes its routes through. */
  const passesThrough = (fn: TS.SignatureDeclaration): boolean => {
    const taken = fn.parameters[0]?.type;
    const returned = fn.type;
    if (taken === undefined || returned === undefined) return false;
    return taken.getText(taken.getSourceFile()) === returned.getText(returned.getSourceFile());
  };

  /**
   * The routes an expression holds. `env` binds the parameters of the functions followed into (their callers'
   * arguments), so `routes.flatMap(…)` inside a function leads back to what was passed in.
   */
  const routes = (node: TS.Node, depth: number, env: Env = NO_BINDINGS): Followed => {
    if (depth > DEPTH) return none('Its routes are built deeper in the code than is followed.');
    const next = (child: TS.Node, by = 1) => routes(child, depth + by, env);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return next(node.expression, 0);
    }
    if (ts.isJsxFragment(node)) return merge(node.children.map((child) => next(child, 0)));
    if (ts.isJsxExpression(node)) {
      return node.expression === undefined ? { routes: [] } : next(node.expression, 0);
    }
    if (ts.isJsxText(node)) return { routes: [] };
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
      return jsxRoute(node, depth, env);
    // A single route object, reached through a name (`import dashboardRoutes from './Dashboard'`).
    if (ts.isObjectLiteralExpression(node)) return objectRoute(node, depth, env);
    if (ts.isArrayLiteralExpression(node)) {
      return merge(
        node.elements.map((element) =>
          ts.isSpreadElement(element)
            ? next(element.expression)
            : ts.isObjectLiteralExpression(element)
              ? objectRoute(element, depth, env)
              : next(element),
        ),
      );
    }
    if (ts.isConditionalExpression(node)) {
      return merge([next(node.whenTrue, 0), next(node.whenFalse, 0)]);
    }
    // `{flag && <Route … />}`: a route the code declares, shown when the flag is on; `a ?? b`, `a || b`: either.
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return next(node.right, 0);
      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return merge([next(node.left, 0), next(node.right, 0)]);
      }
    }
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      if (declaration !== undefined && ts.isParameter(declaration)) {
        const bound = env.get(declaration);
        if (bound !== undefined) return routes(bound.value, depth + 1, bound.env);
        return none('Its routes are passed in when the app runs.');
      }
      if (
        declaration !== undefined &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined
      ) {
        return next(declaration.initializer);
      }
      // `export default { … }`, imported by name.
      if (declaration !== undefined && ts.isExportAssignment(declaration)) {
        return next(declaration.expression);
      }
      return none('Its routes are passed in when the app runs.');
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // `routes.filter(…)`, `routes.flatMap(…)`: the routes it starts from.
      if (
        ts.isPropertyAccessExpression(callee) &&
        ['filter', 'map', 'flatMap', 'concat', 'slice'].includes(callee.name.text)
      ) {
        return next(callee.expression);
      }
      if (
        ts.isIdentifier(callee) &&
        rrOf(callee.getSourceFile()).get(callee.text) === 'createRoutesFromElements'
      ) {
        const first = node.arguments[0];
        return first === undefined ? { routes: [] } : next(first);
      }
      const fn = functionOf(
        declarationOf(ts.isPropertyAccessExpression(callee) ? callee.name : callee),
      );
      if (fn === undefined)
        return none('Its routes come from a function whose code isn’t followed.');
      // Its parameters stand for this call's arguments, as they are here.
      const inner = new Map(env);
      for (const [i, parameter] of fn.parameters.entries()) {
        const argument = node.arguments[i];
        if (argument !== undefined) inner.set(parameter, { value: argument, env });
      }
      const returned = merge(
        returnsOf(fn).map((expression) => routes(expression, depth + 1, inner)),
      );
      if (returned.routes.length > 0 || !passesThrough(fn)) return returned;
      const first = node.arguments[0];
      return first === undefined ? returned : next(first);
    }
    return none('Its routes are built in a way that isn’t followed.');
  };

  const jsxRoute = (
    node: TS.JsxElement | TS.JsxSelfClosingElement,
    depth: number,
    env: Env,
  ): Followed => {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    if (!tagIs(opening, 'Route')) return { routes: [] };
    const file = node.getSourceFile();
    const attribute = (name: string) => {
      const found = opening.attributes.properties.find(
        (p): p is TS.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === name,
      );
      const initializer = found?.initializer;
      if (found === undefined) return undefined;
      if (initializer === undefined) return null;
      if (ts.isStringLiteral(initializer)) return initializer;
      return ts.isJsxExpression(initializer) ? (initializer.expression ?? null) : null;
    };
    const children = ts.isJsxElement(node)
      ? merge(node.children.map((child) => routes(child, depth, env)))
      : { routes: [] };
    const path = attribute('path');
    const index = attribute('index');
    return {
      routes: [
        routeNode(
          file,
          path === undefined ? undefined : path === null ? null : stringValue(context, path),
          index !== undefined && index?.kind !== ts.SyntaxKind.FalseKeyword,
          opening.tagName,
          attribute('element') ?? attribute('Component') ?? undefined,
          attribute('lazy') !== undefined,
          children,
        ),
      ],
    };
  };

  const objectRoute = (object: TS.ObjectLiteralExpression, depth: number, env: Env): Followed => {
    const file = object.getSourceFile();
    const property = (name: string): TS.Expression | undefined => {
      for (const p of object.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText(file) === name) return p.initializer;
        // `{ path, children }`: the variable of that name.
        if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
      }
      return undefined;
    };
    const childrenValue = property('children');
    const children =
      childrenValue === undefined ? { routes: [] } : routes(childrenValue, depth, env);
    const path = property('path');
    return {
      routes: [
        routeNode(
          file,
          path === undefined ? undefined : stringValue(context, path),
          property('index')?.kind === ts.SyntaxKind.TrueKeyword,
          object,
          property('element') ?? property('Component'),
          property('lazy') !== undefined,
          children,
        ),
      ],
    };
  };

  const routeNode = (
    file: TS.SourceFile,
    path: string | null | undefined,
    index: boolean,
    at: TS.Node,
    rendered: TS.Expression | undefined,
    lazy: boolean,
    children: Followed,
  ): RouteNode => {
    let element: Span | undefined;
    let redirect = false;
    let target = rendered;
    while (target !== undefined && ts.isParenthesizedExpression(target)) target = target.expression;
    if (target !== undefined) {
      const opening = ts.isJsxElement(target)
        ? target.openingElement
        : ts.isJsxSelfClosingElement(target)
          ? target
          : null;
      if (opening !== null) {
        redirect = tagIs(opening, 'Navigate');
        if (ts.isIdentifier(opening.tagName)) element = spanOf(file, opening.tagName);
      } else if (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target)) {
        element = spanOf(file, target);
      }
    }
    return {
      file: file.fileName,
      path,
      index,
      at: positionOf(file, at),
      ...(element === undefined ? {} : { element }),
      redirect,
      lazy,
      children: children.routes,
      ...(children.unfollowed === undefined ? {} : { unfollowed: children.unfollowed }),
    };
  };

  return { routes, tagIs };
}

/** A tree across files, for the joiner: `within` and each route's element resolved to the components' keys. */
export interface JoinableTree {
  readonly file: string;
  readonly root: boolean;
  readonly within?: string;
  readonly unfollowed?: string;
  readonly routes: readonly JoinableRoute[];
}
export interface JoinableRoute extends Omit<RouteNode, 'children' | 'element' | 'file'> {
  readonly file?: string;
  /** The key of the component it renders, when resolved. */
  readonly component?: string;
  /** The element's span, in the route's file, for the handler. */
  readonly element?: Span;
  readonly children: readonly JoinableRoute[];
}

const join = (parent: string, path: string) =>
  path.startsWith('/') ? path : `${parent.replace(/\/\*$/, '').replace(/\/$/, '')}/${path}`;

/**
 * Every screen, with its full path: from each root tree down its routes' children, and into the trees inside the
 * components a route renders (relative to that route's path, less a trailing `/*`). A route with children, or one
 * rendering a component that holds routes, is a layout; a redirect isn't a screen. Routes the code builds in a way
 * that wasn't followed are listed as `<path>/*`, incomplete, never left out.
 */
export function joinReactRouter(
  trees: readonly JoinableTree[],
): (FoundEntry & { readonly file: string })[] {
  const inside = new Map<string, JoinableTree[]>();
  for (const tree of trees) {
    if (tree.within !== undefined)
      inside.set(tree.within, [...(inside.get(tree.within) ?? []), tree]);
  }
  // Trees some route renders, from every tree, before any is walked: a mounted tree is never listed on its own.
  const rendered = new Set<string>();
  const collect = (routes: readonly JoinableRoute[]) => {
    for (const route of routes) {
      if (route.component !== undefined) rendered.add(route.component);
      collect(route.children);
    }
  };
  for (const tree of trees) collect(tree.routes);
  const found: (FoundEntry & { file: string })[] = [];
  const seenScreens = new Set<string>();
  const unfollowed = (path: string | null, why: string, file: string, at: Position) => {
    found.push({
      kind: 'screen',
      framework: 'react-router',
      name: `${path === null ? '/:unknown' : path === '/' ? '' : path}/*`,
      at,
      complete: false,
      why,
      file,
    });
  };
  const walk = (
    routes: readonly JoinableRoute[],
    parent: string | null,
    file: string,
    seen: ReadonlySet<string>,
  ) => {
    for (const route of routes) {
      const routeFile = route.file ?? file;
      const own = route.path === undefined ? '' : route.path;
      const path = parent === null || own === null ? null : own === '' ? parent : join(parent, own);
      const nested = route.component === undefined ? [] : (inside.get(route.component) ?? []);
      if (route.children.length > 0) walk(route.children, path, routeFile, seen);
      if (route.unfollowed !== undefined) unfollowed(path, route.unfollowed, routeFile, route.at);
      for (const tree of nested) {
        if (route.component !== undefined && seen.has(route.component)) continue;
        walk(tree.routes, path, tree.file, new Set([...seen, route.component ?? '']));
      }
      const page = route.path !== undefined || route.index;
      if (!page || route.redirect || route.children.length > 0 || nested.length > 0) continue;
      const raw = path === null ? ':unknown' : path === '' ? '/' : path;
      const name = raw.startsWith('/') ? raw : `/${raw}`;
      // The same route reached twice (a route list used under two parents with the same path) is one screen.
      const key = `${name}@${routeFile}:${String(route.at.line)}:${String(route.at.column)}`;
      if (seenScreens.has(key)) continue;
      seenScreens.add(key);
      found.push({
        kind: 'screen',
        framework: 'react-router',
        name,
        at: route.at,
        complete: path !== null,
        ...(path === null
          ? { why: 'Part of its path isn’t a constant the code fixes.' }
          : route.lazy
            ? { why: 'Its page is loaded when the app runs (lazy).' }
            : {}),
        ...(route.element === undefined ? {} : { handlerName: route.element }),
        file: routeFile,
      });
    }
  };
  for (const tree of trees) {
    if (!tree.root) continue;
    walk(tree.routes, '/', tree.file, new Set());
    if (tree.unfollowed !== undefined)
      unfollowed('/', tree.unfollowed, tree.file, { line: 1, column: 1 });
  }
  // A tree inside a component nothing mounts as a route's element: listed from the top, as written.
  for (const tree of trees) {
    if (!tree.root && (tree.within === undefined || !rendered.has(tree.within))) {
      walk(tree.routes, '/', tree.file, new Set());
    }
  }
  return found;
}
