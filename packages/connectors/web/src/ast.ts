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
 * A string an expression always has: a literal; (with the checker) an enum member, or a constant whose type is one
 * string literal; or a pure string operation on such strings (`a + b`, a template, `.replace('/*', '')`,
 * `.toLowerCase()`), and a `const` holding one (Twenty's `AppPath.SettingsCatchAll.replace('/*', '')`). That's
 * evaluating what the code fixes, not guessing; anything else is null.
 */
export function stringValue(
  context: FileContext,
  expression: TS.Expression,
  depth = 0,
): string | null {
  const { ts, checker } = context;
  if (depth > 8) return null;
  const value = (node: TS.Expression) => stringValue(context, node, depth + 1);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
    return value(expression.expression);
  }
  if (ts.isTemplateExpression(expression)) {
    let text = expression.head.text;
    for (const span of expression.templateSpans) {
      const part = value(span.expression);
      if (part === null) return null;
      text += part + span.literal.text;
    }
    return text;
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = value(expression.left);
    const right = left === null ? null : value(expression.right);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const method = expression.expression.name.text;
    const receiver = value(expression.expression.expression);
    if (receiver === null) return null;
    const args = expression.arguments.map((argument) => value(argument));
    if (args.some((argument) => argument === null)) return null;
    const [a = '', b = ''] = args as string[];
    if (method === 'replace' && args.length === 2) return receiver.replace(a, b);
    if (method === 'replaceAll' && args.length === 2) return receiver.split(a).join(b);
    if (method === 'toLowerCase' && args.length === 0) return receiver.toLowerCase();
    if (method === 'toUpperCase' && args.length === 0) return receiver.toUpperCase();
    if (method === 'trim' && args.length === 0) return receiver.trim();
    return null;
  }
  if (checker === undefined) return null;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const constant = checker.getConstantValue(expression);
    if (typeof constant === 'string') return constant;
  }
  const type = checker.getTypeAtLocation(expression);
  if (type.isStringLiteral()) return type.value;
  // A `const` holding a string the code fixes.
  if (ts.isIdentifier(expression)) {
    let symbol = checker.getSymbolAtLocation(expression);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0
    ) {
      return value(declaration.initializer);
    }
  }
  return null;
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
