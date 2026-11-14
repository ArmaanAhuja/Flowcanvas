// A route file's entry points (ADR 0030): its route comes from its path (file-routes.ts), what it provides from its
// exports. Next.js: a page's default export is its screen; a route handler's exported HTTP methods are API routes.
// React Router (`remix-flat-routes`): a route with a default export is a screen (a layout isn't), and its `loader`
// and `action` run on the server. https://nextjs.org/docs/app/api-reference/file-conventions/route and
// https://reactrouter.com/start/framework/route-module
import type * as TS from 'typescript';
import { positionOf, spanOf, type FileContext } from './ast.js';
import type { FlatRoute, NextRoute } from './file-routes.js';
import type { FoundEntry, Span } from './types.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** A module's exported names, each with where it's declared and the function it holds, if it holds one. */
export interface Exported {
  readonly at: TS.Node;
  /** A function declared or assigned right there; null when it's another value (`handle(app)`, an identifier). */
  readonly fn: TS.Node | null;
  /** The expression it's assigned, for a caller that reads further (`handle(app)`). */
  readonly value: TS.Expression | null;
}

export function exportsOf(context: FileContext): Map<string, Exported> {
  const { ts, source } = context;
  const found = new Map<string, Exported>();
  const isExported = (node: TS.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: TS.Node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  const fnOf = (value: TS.Expression | undefined): TS.Node | null =>
    value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
      ? value
      : null;
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      const name = isDefault(statement) ? 'default' : statement.name?.text;
      if (name !== undefined) {
        found.set(name, { at: statement.name ?? statement, fn: statement, value: null });
      }
    } else if (ts.isClassDeclaration(statement) && isExported(statement) && isDefault(statement)) {
      found.set('default', { at: statement.name ?? statement, fn: statement, value: null });
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        found.set(declaration.name.text, {
          at: declaration.name,
          fn: fnOf(declaration.initializer),
          value: declaration.initializer ?? null,
        });
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      found.set('default', {
        at: statement,
        fn: fnOf(statement.expression) ?? declaredFunction(context, statement.expression),
        value: statement.expression,
      });
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      // `export { loader, Page as default }`: the names, at the local declarations they export.
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).getText(source);
        const declared = localFunction(context, local);
        found.set(element.name.text, { at: element.name, fn: declared, value: null });
      }
    }
  }
  return found;
}

/** `export default Page`, where `Page` is a function in this file. */
function declaredFunction(context: FileContext, expression: TS.Expression): TS.Node | null {
  return context.ts.isIdentifier(expression) ? localFunction(context, expression.text) : null;
}

function localFunction(context: FileContext, name: string): TS.Node | null {
  const { ts, source } = context;
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
          const value = declaration.initializer;
          if (
            value !== undefined &&
            (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
          ) {
            return value;
          }
          return declaration;
        }
      }
    }
  }
  return null;
}

/**
 * Its handler: the function right there, or an identifier naming one declared elsewhere (an import). A value made
 * at run time (`createThemeAction(resolver)`) has neither, and says why.
 */
function handlerOf(
  context: FileContext,
  exported: Exported,
): { handler: Span } | { handlerName: Span } | { why: string } {
  const { ts, source } = context;
  if (exported.fn !== null && !ts.isVariableDeclaration(exported.fn)) {
    return { handler: spanOf(source, exported.fn) };
  }
  const value = exported.value;
  if (value !== null && ts.isIdentifier(value)) return { handlerName: spanOf(source, value) };
  if (exported.value === null && ts.isIdentifier(exported.at) && exported.fn === null) {
    return { handlerName: spanOf(source, exported.at) };
  }
  return { why: 'Its handler is made when the app runs, not written as a function here.' };
}

/** A Next.js app-router file's entry points: its page's screen, or its route handler's methods. */
export function nextRouteEntries(context: FileContext, route: NextRoute): FoundEntry[] {
  const exports = exportsOf(context);
  if (route.kind === 'page') {
    const page = exports.get('default');
    return page === undefined ? [] : [screen(context, route.path, page, 'next')];
  }
  return METHODS.flatMap((method) => {
    const exported = exports.get(method);
    if (exported === undefined) return [];
    return [
      {
        kind: 'api-route' as const,
        framework: 'next' as const,
        name: `${method} ${route.path}`,
        at: positionOf(context.source, exported.at),
        complete: true,
        ...handlerOf(context, exported),
      },
    ];
  });
}

/** A `remix-flat-routes` file's entry points: its screen (unless it's a layout), its loader and its action. */
export function flatRouteEntries(context: FileContext, route: FlatRoute): FoundEntry[] {
  const exports = exportsOf(context);
  const found: FoundEntry[] = [];
  const page = exports.get('default');
  if (page !== undefined && !route.layout)
    found.push(screen(context, route.path, page, 'react-router'));
  for (const name of ['loader', 'action'] as const) {
    const exported = exports.get(name);
    if (exported === undefined) continue;
    found.push({
      kind: 'api-route',
      framework: 'react-router',
      name: `${name} ${route.path}`,
      at: positionOf(context.source, exported.at),
      complete: true,
      ...handlerOf(context, exported),
    });
  }
  return found;
}

function screen(
  context: FileContext,
  path: string,
  page: Exported,
  framework: 'next' | 'react-router',
): FoundEntry {
  return {
    kind: 'screen',
    framework,
    name: path,
    at: positionOf(context.source, page.at),
    complete: true,
    ...handlerOf(context, page),
  };
}
