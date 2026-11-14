// React's entry points in the code (ADR 0030). Event props: every `on…` prop on a JSX element (`onClick={handleLogin}`,
// `onSubmit={() => …}`), an element a person can act on, named by its tag and prop (`<button> onClick`) and listed
// under the screens that render its component. Next.js server actions: the exported functions of a `'use server'`
// file, and any function with `'use server'` in its own body; called from the page, they run on the server.
// https://react.dev/learn/responding-to-events and
// https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
import type * as TS from 'typescript';
import { positionOf, spanOf, type FileContext } from './ast.js';
import type { FoundEntry, Span } from './types.js';

export interface ElementEntry extends FoundEntry {
  /** The component (or function) it's in: where it's rendered from, for listing it under its screens. */
  readonly within?: Span;
}

/** Every event prop on a JSX element, with its handler: written there, or named for the engine to resolve. */
export function eventEntries(context: FileContext): ElementEntry[] {
  const { ts, source } = context;
  if (!/\bon[A-Z]\w*\s*=/.test(source.text)) return [];
  const found: ElementEntry[] = [];
  const visit = (node: TS.Node, within: TS.Node | undefined) => {
    let holder = within;
    if (
      ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name !== undefined) ||
      (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
    ) {
      holder = node.name;
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && /^on[A-Z]/.test(node.name.text)) {
      const element = node.parent.parent;
      const tag = element.tagName.getText(source);
      const value =
        node.initializer !== undefined && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : undefined;
      if (value !== undefined) {
        found.push({
          kind: 'element',
          framework: 'react',
          name: `<${tag}> ${node.name.text}`,
          at: positionOf(source, node.name),
          complete: true,
          ...handling(ts, source, value),
          ...(holder === undefined ? {} : { within: spanOf(source, holder) }),
        });
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, holder);
    });
  };
  visit(source, undefined);
  return found;
}

/** A handler written there (`() => …`), named (`handleLogin`, `form.submit`), or made when the app runs. */
function handling(
  ts: FileContext['ts'],
  source: TS.SourceFile,
  value: TS.Expression,
): { handler: Span } | { handlerName: Span } | { why: string } {
  let target = value;
  while (ts.isParenthesizedExpression(target)) target = target.expression;
  if (ts.isArrowFunction(target) || ts.isFunctionExpression(target))
    return { handler: spanOf(source, target) };
  if (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target))
    return { handlerName: spanOf(source, target) };
  return { why: 'Its handler is made when the app runs, not written as a function here.' };
}

/** The function a server action runs: the value itself, or the function given to its chain's last call. */
function actionFunction(ts: FileContext['ts'], value: TS.Expression): TS.Node | null {
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
  if (ts.isCallExpression(value)) {
    const fn = value.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
    return fn ?? null;
  }
  return null;
}

/** Next.js server actions: a `'use server'` file's exported functions, and functions marked `'use server'` themselves. */
export function serverActionEntries(context: FileContext): FoundEntry[] {
  const { ts, source } = context;
  if (!source.text.includes('use server')) return [];
  const found: FoundEntry[] = [];
  const directive = (statements: readonly TS.Statement[]) =>
    statements.some(
      (s) =>
        ts.isExpressionStatement(s) &&
        ts.isStringLiteral(s.expression) &&
        s.expression.text === 'use server',
    );
  const action = (name: TS.Identifier, fn: TS.Node | null) => {
    found.push({
      kind: 'api-route',
      framework: 'next',
      name: `server action ${name.text}`,
      at: positionOf(source, name),
      complete: true,
      ...(fn === null
        ? { why: 'Its handler is made when the app runs, not written as a function here.' }
        : { handler: spanOf(source, fn) }),
    });
  };
  const exported = (node: TS.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  // Only directives at the very top count: a prologue ends at the first statement that isn't a string literal.
  const prologue: TS.Statement[] = [];
  for (const statement of source.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression))
      prologue.push(statement);
    else break;
  }
  if (directive(prologue)) {
    for (const statement of source.statements) {
      if (!exported(statement)) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined)
        action(statement.name, statement);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const value = declaration.initializer;
          // Everything a use-server file exports is a server action, however it's built: a function, or a
          // client's chain (`authActionClient.metadata(…).action(async …)`), whose handler is its last call's function.
          // A plain value (`LIMIT = 5`) isn't one: Next.js refuses anything but async functions there.
          if (
            ts.isIdentifier(declaration.name) &&
            value !== undefined &&
            (ts.isCallExpression(value) || actionFunction(ts, value) !== null)
          ) {
            action(declaration.name, actionFunction(ts, value));
          }
        }
      }
    }
    return found;
  }
  // A function marked in its own body.
  const visit = (node: TS.Node) => {
    const body =
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
        ? node.body
        : undefined;
    if (body !== undefined && ts.isBlock(body) && directive(body.statements.slice(0, 1))) {
      const name = ts.isFunctionDeclaration(node)
        ? node.name
        : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
          ? node.parent.name
          : undefined;
      if (name !== undefined) action(name, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
