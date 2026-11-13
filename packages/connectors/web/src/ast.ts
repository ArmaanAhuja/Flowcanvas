// What the detectors read from a file's syntax, with TypeScript's checker where a value lives elsewhere (an enum's
// member, an imported constant). Corpus projects don't install their packages, so a decorator or a function is known
// by the module it's imported from, as written, never by resolving into node_modules.
import type * as TS from 'typescript';
import type { Position, Span } from './types.js';

export type TypeScript = typeof TS;

/** What every detector is given for one file. */
export interface FileContext {
  readonly ts: TypeScript;
  readonly source: TS.SourceFile;
  /** For values defined elsewhere; without one, only literals are read. */
  readonly checker?: TS.TypeChecker;
}

/** Each imported name in a file: the module it's from, and its name there (`default` for a default import). */
export function importsOf(
  ts: TypeScript,
  source: TS.SourceFile,
): Map<string, { module: string; name: string }> {
  const found = new Map<string, { module: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) found.set(clause.name.text, { module, name: 'default' });
    const bindings = clause.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        found.set(element.name.text, {
          module,
          name: (element.propertyName ?? element.name).text,
        });
      }
    }
  }
  return found;
}

/**
 * A string an expression always has: a literal, or (with the checker) an enum member or a constant whose type is one
 * string literal. Null when it isn't known from the code.
 */
export function stringValue(context: FileContext, expression: TS.Expression): string | null {
  const { ts, checker } = context;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text;
  if (checker === undefined) return null;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const constant = checker.getConstantValue(expression);
    if (typeof constant === 'string') return constant;
  }
  const type = checker.getTypeAtLocation(expression);
  return type.isStringLiteral() ? type.value : null;
}

export function positionOf(source: TS.SourceFile, node: TS.Node): Position {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: line + 1, column: character + 1 };
}

export const spanOf = (source: TS.SourceFile, node: TS.Node): Span => ({
  start: node.getStart(source),
  end: node.getEnd(),
});

/** A path's pieces joined with single slashes, starting with one: `('/api', 'users/', ':id')` is `/api/users/:id`. */
export function joinPath(...pieces: readonly string[]): string {
  const joined = pieces
    .flatMap((piece) => piece.split('/'))
    .filter((segment) => segment !== '')
    .join('/');
  return `/${joined}`;
}

/** A decorator's name as written (`Get` in `@Get('x')`) and its arguments. */
export function decoratorCall(
  ts: TypeScript,
  decorator: TS.Decorator,
): { name: string; args: readonly TS.Expression[] } | null {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    return { name: expression.expression.text, args: expression.arguments };
  }
  if (ts.isIdentifier(expression)) return { name: expression.text, args: [] };
  return null;
}
