// UI → API links (build plan phase 9, owner 15 Nov 2026; ADR 0031): where the app's own code calls its API, keyed as
// phase 8 names the API's entry points, so the engine joins the two. tRPC by the procedure's path, fetch and axios by
// method and path (through the project's own wrappers, one level), GraphQL (Apollo) by operation and root field.
import type * as TS from 'typescript';
import { stringValue, type FileContext } from './ast.js';
import { PARAM, isCall, originOf, type Origin } from './origin.js';

export type LinkProtocol = 'trpc' | 'http' | 'graphql';

export interface FoundLink {
  readonly protocol: LinkProtocol;
  /**
   * As the API's entry points are named: a tRPC path (`polls.make`), a method and path (`POST /api/auth/login`, a
   * value written `:param`, an unknown base `{BASE_URL}`), an operation and root field (`mutation signIn`). Empty when
   * the code doesn't fix it (then `why`).
   */
  readonly keys: readonly string[];
  readonly complete: boolean;
  readonly why?: string;
}

export const LINK_MESSAGES = {
  url: 'Its URL isn’t one the code fixes.',
  document: 'Its GraphQL document isn’t one the code fixes.',
  path: 'Its procedure isn’t one the code fixes.',
} as const;

/** tRPC calls that make a request (a `useMutation` makes one when its `mutate` is called). */
const TRPC_REQUESTS = new Set([
  'query',
  'mutate',
  'subscribe',
  'useQuery',
  'useSuspenseQuery',
  'useInfiniteQuery',
  'useSuspenseInfiniteQuery',
  'useSubscription',
  'fetch',
  'fetchInfinite',
  'prefetch',
  'prefetchInfinite',
  'ensureData',
  'queryOptions',
  'mutationOptions',
  'infiniteQueryOptions',
]);
const MUTATE = new Set(['mutate', 'mutateAsync']);
const AXIOS_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const APOLLO_HOOKS = new Set([
  'useQuery',
  'useSuspenseQuery',
  'useLazyQuery',
  'useMutation',
  'useSubscription',
]);

export function linkOf(context: FileContext, call: TS.CallExpression): FoundLink | null {
  return trpcLink(context, call) ?? httpLink(context, call, 0) ?? graphqlLink(context, call);
}

// tRPC.

function trpcLink(context: FileContext, call: TS.CallExpression): FoundLink | null {
  const { ts } = context;
  const callee = call.expression;
  const origin = originOf(
    context,
    ts.isPropertyAccessExpression(callee) ? callee.expression : callee,
  );
  if (!(origin?.module ?? '').startsWith('@trpc/') || origin === null) return null;
  const tokens = ts.isPropertyAccessExpression(callee)
    ? [...origin.steps, callee.name.text]
    : [...origin.steps];
  // `mutate(…)` on a `useMutation()`: the request.
  let end = tokens.length;
  const last = tokens[end - 1] ?? '';
  if (MUTATE.has(last) && isCall(tokens[end - 2]) && tokens[end - 3] === 'useMutation') end -= 3;
  else if (TRPC_REQUESTS.has(last)) end -= 1;
  else return null;
  // The procedure's path: the names back to the call that made the client (`createTRPCReact()`, `useTRPC()`).
  const path: string[] = [];
  for (let i = end - 1; i >= 0; i -= 1) {
    const token = tokens[i] ?? '';
    if (isCall(token) || token === PARAM) break;
    path.unshift(token);
  }
  if (path.length === 0) return null;
  return { protocol: 'trpc', keys: [path.join('.')], complete: true };
}

// HTTP: fetch and axios with the app's own (relative) URLs.

interface HttpCall {
  readonly method: string;
  /** The argument holding the URL. */
  readonly url: TS.Expression | undefined;
}

/** A direct fetch or axios call: its method and URL argument. */
function directHttp(context: FileContext, call: TS.CallExpression): HttpCall | undefined {
  const { ts } = context;
  const callee = call.expression;
  const [first, second] = call.arguments;
  if (ts.isIdentifier(callee)) {
    const origin = originOf(context, callee);
    if (origin?.module === null && origin.name === 'fetch') {
      return { method: optionString(context, second, 'method') ?? 'GET', url: first };
    }
    if (origin?.module === 'axios' && origin.steps.length === 0) {
      return first !== undefined && ts.isObjectLiteralExpression(first)
        ? {
            method: optionString(context, first, 'method') ?? 'GET',
            url: optionValue(ts, first, 'url'),
          }
        : { method: optionString(context, second, 'method') ?? 'GET', url: first };
    }
  } else if (ts.isPropertyAccessExpression(callee) && AXIOS_METHODS.has(callee.name.text)) {
    const origin = originOf(context, callee.expression);
    if (origin?.module === 'axios') return { method: callee.name.text.toUpperCase(), url: first };
  }
  return undefined;
}

function httpLink(context: FileContext, call: TS.CallExpression, depth: number): FoundLink | null {
  const direct = directHttp(context, call);
  if (direct !== undefined) return keyOfHttp(context, direct, new Map());
  // A project function that hands one of its parameters to fetch or axios (`request.post(url, data)`).
  const wrapper = depth === 0 ? forwarding(context, call) : undefined;
  if (wrapper === undefined) return null;
  return keyOfHttp(
    context,
    { method: wrapper.method, url: call.arguments[wrapper.index] },
    new Map(),
  );
}

function keyOfHttp(
  context: FileContext,
  http: HttpCall,
  values: ReadonlyMap<TS.Symbol, string>,
): FoundLink | null {
  if (http.url === undefined) return null;
  const url = urlText(context, http.url, values, 0);
  if (url === null) return { protocol: 'http', keys: [], complete: false, why: LINK_MESSAGES.url };
  // An outside URL is a boundary (services.ts), not a link.
  if (/^[a-z]+:\/\//i.test(url)) return null;
  const path = url.split(/[?#]/)[0] ?? url;
  if (!path.startsWith('/') && !path.startsWith('{')) return null;
  return { protocol: 'http', keys: [`${http.method} ${path}`], complete: true };
}

/** A project function (`_post`, or `request.post` naming it) whose body passes parameter `index` to fetch or axios. */
function forwarding(
  context: FileContext,
  call: TS.CallExpression,
): { index: number; method: string } | undefined {
  const { ts } = context;
  const fn = projectFunction(context, call.expression);
  if (fn?.body === undefined) return undefined;
  const parameters = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  let found: { index: number; method: string } | undefined;
  const visit = (node: TS.Node): void => {
    if (found !== undefined || (node !== fn.body && ts.isFunctionLike(node))) return;
    if (ts.isCallExpression(node)) {
      const direct = directHttp(context, node);
      if (direct?.url !== undefined && ts.isIdentifier(direct.url)) {
        const index = parameters.indexOf(direct.url.text);
        if (index !== -1) found = { index, method: direct.method };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return found;
}

/** The function the project declares that a callee names: directly, or an object's property naming one. */
function projectFunction(
  context: FileContext,
  callee: TS.Expression,
): TS.FunctionLikeDeclaration | undefined {
  const { ts, checker } = context;
  if (checker === undefined) return undefined;
  const at = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  let symbol = checker.getSymbolAtLocation(at);
  for (let hops = 0; hops < 6 && symbol !== undefined; hops += 1) {
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration: TS.Node | undefined = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (declaration === undefined || declaration.getSourceFile().isDeclarationFile)
      return undefined;
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
      return declaration;
    const value = ts.isVariableDeclaration(declaration)
      ? declaration.initializer
      : ts.isPropertyAssignment(declaration)
        ? declaration.initializer
        : ts.isShorthandPropertyAssignment(declaration)
          ? declaration.name
          : undefined;
    if (value === undefined) return undefined;
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
    if (!ts.isIdentifier(value)) return undefined;
    symbol = ts.isShorthandPropertyAssignment(declaration)
      ? checker.getShorthandAssignmentValueSymbol(declaration)
      : checker.getSymbolAtLocation(value);
  }
  return undefined;
}

/**
 * A URL's text as the code fixes it: literals and constants; a template, its values written `:param` (or `{NAME}` for a
 * value at the very start, the app's base: LibreChat's `${BASE_URL}/api/…`); a project function's returned URL
 * (`endpoints.login()`), its parameters as values.
 */
function urlText(
  context: FileContext,
  expression: TS.Expression,
  values: ReadonlyMap<TS.Symbol, string>,
  depth: number,
): string | null {
  const { ts, checker } = context;
  if (depth > 4) return null;
  const fixed = stringValue(context, expression);
  if (fixed !== null) return fixed;
  if (ts.isTemplateExpression(expression)) {
    let text = expression.head.text;
    for (const span of expression.templateSpans) {
      const inner = urlText(context, span.expression, values, depth + 1);
      const atStart = text === '';
      text +=
        inner ??
        (atStart && ts.isIdentifier(span.expression) ? `{${span.expression.text}}` : ':param');
      text += span.literal.text;
    }
    return text;
  }
  if (ts.isCallExpression(expression)) {
    const fn = projectFunction(context, expression.expression);
    if (fn?.body === undefined) return null;
    const body = fn.body;
    let returned: TS.Expression | undefined;
    if (!ts.isBlock(body)) returned = body;
    else {
      const [only, ...more] = body.statements;
      if (more.length === 0 && only !== undefined && ts.isReturnStatement(only))
        returned = only.expression;
    }
    return returned === undefined ? null : urlText(context, returned, values, depth + 1);
  }
  if (ts.isIdentifier(expression) && checker !== undefined) {
    const symbol = checker.getSymbolAtLocation(expression);
    if (symbol !== undefined) {
      const known = values.get(symbol);
      if (known !== undefined) return known;
    }
  }
  return null;
}

function optionValue(
  ts: typeof TS,
  object: TS.ObjectLiteralExpression,
  name: string,
): TS.Expression | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name
    ) {
      return property.initializer;
    }
  }
  return undefined;
}

function optionString(
  context: FileContext,
  options: TS.Expression | undefined,
  name: string,
): string | null {
  const { ts } = context;
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return null;
  const value = optionValue(ts, options, name);
  return value === undefined ? null : (stringValue(context, value)?.toUpperCase() ?? null);
}

// GraphQL (Apollo).

function graphqlLink(context: FileContext, call: TS.CallExpression): FoundLink | null {
  const { ts } = context;
  const callee = call.expression;
  // `useQuery(Doc)`: the request is the hook.
  const hook = apolloHook(context, callee);
  if (
    hook !== null &&
    (hook === 'useQuery' || hook === 'useSuspenseQuery' || hook === 'useSubscription')
  ) {
    return documentLink(context, call.arguments[0]);
  }
  // `signIn(…)` from `const [signIn] = useMutation(Doc)` (and `useLazyQuery`): the request is calling it.
  if (ts.isIdentifier(callee)) {
    const made = madeByHook(context, callee);
    if (made !== undefined) return documentLink(context, made.arguments[0]);
  }
  // `client.mutate({ mutation: Doc })`, `client.query({ query: Doc })`.
  if (
    ts.isPropertyAccessExpression(callee) &&
    /^(mutate|query|subscribe)$/.test(callee.name.text)
  ) {
    const origin = originOf(context, callee.expression);
    if (isApollo(origin)) {
      const [options] = call.arguments;
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        const document = optionValue(ts, options, 'mutation') ?? optionValue(ts, options, 'query');
        return documentLink(context, document);
      }
    }
  }
  return null;
}

const isApollo = (origin: Origin | null): boolean =>
  /^@apollo\/client(\/|$)/.test(origin?.module ?? '');

function apolloHook(context: FileContext, callee: TS.Expression): string | null {
  const origin = originOf(context, callee);
  if (!isApollo(origin) || origin === null) return null;
  return origin.steps.length === 0 && APOLLO_HOOKS.has(origin.name) ? origin.name : null;
}

/** For a function taken from a hook's result (`const [signIn] = useMutation(Doc)`): that hook's call. */
function madeByHook(context: FileContext, callee: TS.Identifier): TS.CallExpression | undefined {
  const { ts, checker } = context;
  const symbol = checker?.getSymbolAtLocation(callee);
  const declaration = symbol?.valueDeclaration;
  if (declaration === undefined || !ts.isBindingElement(declaration)) return undefined;
  const pattern = declaration.parent;
  if (!ts.isArrayBindingPattern(pattern) || pattern.elements.indexOf(declaration) !== 0)
    return undefined;
  const holder = pattern.parent;
  if (!ts.isVariableDeclaration(holder) || holder.initializer === undefined) return undefined;
  const init = holder.initializer;
  if (!ts.isCallExpression(init)) return undefined;
  const hook = apolloHook(context, init.expression);
  return hook === 'useMutation' || hook === 'useLazyQuery' ? init : undefined;
}

/** A document's operation and root fields: from `gql` text, or a generated document object. */
function documentLink(context: FileContext, document: TS.Expression | undefined): FoundLink {
  const keys = document === undefined ? null : documentKeys(context, document, 0);
  return keys === null || keys.length === 0
    ? { protocol: 'graphql', keys: [], complete: false, why: LINK_MESSAGES.document }
    : { protocol: 'graphql', keys, complete: true };
}

function documentKeys(context: FileContext, raw: TS.Expression, depth: number): string[] | null {
  const { ts, checker } = context;
  if (depth > 6) return null;
  let expression = raw;
  while (
    ts.isAsExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (ts.isTaggedTemplateExpression(expression)) {
    const template = expression.template;
    const text = ts.isNoSubstitutionTemplateLiteral(template)
      ? template.text
      : [template.head.text, ...template.templateSpans.map((s) => s.literal.text)].join(' ');
    return graphqlKeys(text);
  }
  if (ts.isObjectLiteralExpression(expression)) return generatedKeys(ts, expression);
  if (ts.isIdentifier(expression) && checker !== undefined) {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined
    ) {
      return documentKeys(context, declaration.initializer, depth + 1);
    }
  }
  return null;
}

/** `mutation SignIn(…) { signIn(…) { … } }` → `mutation signIn`: the first operation's root fields. */
export function graphqlKeys(text: string): string[] | null {
  const start = /\b(query|mutation|subscription)\b[^{]*\{/.exec(text) ?? /^\s*\{/.exec(text);
  if (start === null) return null;
  const operation = start[1] ?? 'query';
  const keys: string[] = [];
  let depth = 1;
  let i = start.index + start[0].length;
  while (i < text.length && depth > 0) {
    const char = text[i] ?? '';
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '(') {
      // Skip arguments.
      let open = 1;
      i += 1;
      while (i < text.length && open > 0) {
        if (text[i] === '(') open += 1;
        else if (text[i] === ')') open -= 1;
        i += 1;
      }
      continue;
    } else if (depth === 1 && /[A-Za-z_]/.test(char)) {
      const word = /^[A-Za-z_]\w*/.exec(text.slice(i))?.[0] ?? '';
      // `alias: field`: the field.
      const after = text.slice(i + word.length).trimStart();
      if (after.startsWith(':')) {
        i += word.length;
        continue;
      }
      if (word !== '' && word !== 'on' && !text.slice(Math.max(0, i - 3), i).includes('...')) {
        keys.push(`${operation} ${word}`);
      }
      i += word.length;
      continue;
    }
    i += 1;
  }
  return keys;
}

/** A generated document (`{ kind: 'Document', definitions: [{ operation: 'mutation', selectionSet: … }] }`). */
function generatedKeys(ts: typeof TS, document: TS.ObjectLiteralExpression): string[] | null {
  const prop = (object: TS.ObjectLiteralExpression, name: string): TS.Expression | undefined => {
    for (const p of object.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (key === name) return p.initializer;
    }
    return undefined;
  };
  const definitions = prop(document, 'definitions');
  if (definitions === undefined || !ts.isArrayLiteralExpression(definitions)) return null;
  for (const definition of definitions.elements) {
    if (!ts.isObjectLiteralExpression(definition)) continue;
    const operation = prop(definition, 'operation');
    if (operation === undefined || !ts.isStringLiteral(operation)) continue;
    const set = prop(definition, 'selectionSet');
    const selections =
      set !== undefined && ts.isObjectLiteralExpression(set) ? prop(set, 'selections') : undefined;
    if (selections === undefined || !ts.isArrayLiteralExpression(selections)) return null;
    const keys: string[] = [];
    for (const selection of selections.elements) {
      if (!ts.isObjectLiteralExpression(selection)) continue;
      const kind = prop(selection, 'kind');
      if (kind === undefined || !ts.isStringLiteral(kind) || kind.text !== 'Field') continue;
      const name = prop(selection, 'name');
      const value =
        name !== undefined && ts.isObjectLiteralExpression(name) ? prop(name, 'value') : undefined;
      if (value !== undefined && ts.isStringLiteral(value))
        keys.push(`${operation.text} ${value.text}`);
    }
    return keys;
  }
  return null;
}
