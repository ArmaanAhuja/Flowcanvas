// Where a value comes from (ADR 0031): followed back through the project's own code (imports, `require`, variables,
// destructuring, class fields, typed parameters, `extends`, a function's returned value) to the package it's imported
// from, as written. Corpus projects don't install their packages, so a library is known by its module's name, never by
// resolving into node_modules (as with the entry-point detectors, ADR 0030). What can't be followed is null: a rule
// then says the call isn't recognised, never guesses.
import type * as TS from 'typescript';
import type { FileContext } from './ast.js';

/**
 * A step from the import to the value: an instance (`new`), a call's result, or a property's name. A call is written
 * with its arguments' string literals, `_` for any other: `()`, `('User',_)`, `(_,'person')`.
 */
export type Step = string;
export const NEW: Step = 'new';
export const CALL: Step = '()';
/** Whether a step is a call's result (not a callback's parameter). */
export const isCall = (step: Step | undefined): boolean =>
  step !== undefined && step.startsWith('(') && step !== PARAM;
/** A call step's string arguments, by position (null where it isn't a literal). */
export function callArguments(step: Step): (string | null)[] {
  if (!isCall(step) || step === CALL) return [];
  return JSON.parse(`[${step.slice(1, -1).replaceAll('_', 'null')}]`) as (string | null)[];
}
/** A callback's parameter: the value a library passes to a function given to it (`$transaction(async (tx) => …)`). */
export const PARAM: Step = '(param)';

export interface Origin {
  /** The module as the code imports it (`@prisma/client`, `kysely`, `mongoose`); null for a global (`fetch`). */
  readonly module: string | null;
  /** Its name in that module: an export's name, `default`, or `*` for the whole module. */
  readonly name: string;
  /** From that import to the value. */
  readonly steps: readonly Step[];
}

const MAX_DEPTH = 24;

/** The globals a rule may name (a value with no import). */
const GLOBALS = new Set([
  'fetch',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'WebSocket',
]);

export function originOf(context: FileContext, expression: TS.Expression): Origin | null {
  return trace(context, expression, 0, new Set());
}

function callStep(ts: typeof TS, call: TS.CallExpression): Step {
  if (call.arguments.length === 0) return CALL;
  return `(${call.arguments
    .map((a) => (ts.isStringLiteralLike(a) ? JSON.stringify(a.text) : '_'))
    .join(',')})`;
}

function unwrap(ts: typeof TS, expression: TS.Expression): TS.Expression {
  let current = expression;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAwaitExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

const withSteps = (origin: Origin | null, ...steps: Step[]): Origin | null =>
  origin === null ? null : { ...origin, steps: [...origin.steps, ...steps] };

function trace(
  context: FileContext,
  raw: TS.Expression,
  depth: number,
  seen: Set<TS.Node>,
): Origin | null {
  const { ts } = context;
  if (depth > MAX_DEPTH) return null;
  const expression = unwrap(ts, raw);
  if (seen.has(expression)) return null;
  seen.add(expression);
  const next = (e: TS.Expression) => trace(context, e, depth + 1, seen);

  if (ts.isIdentifier(expression)) return identifierOrigin(context, expression, depth, seen);
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return null;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const name = ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : ts.isStringLiteral(expression.argumentExpression) ||
          ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression)
        ? expression.argumentExpression.text
        : null;
    // A property the project declares (an object literal's, a class member's): followed to its value.
    const member = memberDeclaration(context, expression);
    if (member !== undefined) {
      const followed = declarationOrigin(context, member, depth + 1, seen);
      if (followed !== null) return followed;
    }
    if (name === null) return null;
    return withSteps(next(expression.expression), name);
  }
  if (ts.isCallExpression(expression)) {
    const callee = unwrap(ts, expression.expression);
    // `require('m')` in CommonJS (LibreChat's server).
    if (ts.isIdentifier(callee) && callee.text === 'require') {
      const [first] = expression.arguments;
      return first !== undefined && ts.isStringLiteralLike(first)
        ? { module: first.text, name: 'default', steps: [] }
        : null;
    }
    // A project function: what it returns (a factory, a singleton's getter).
    const returned = returnedValue(context, callee);
    if (returned !== undefined) {
      const followed = next(returned);
      if (followed !== null) return followed;
    }
    // A project function typed to hand back what it's given: `remember<T>(name, getValue: () => T): T`.
    // Several values (`if (!replicas) return prisma; return prisma.$extends(…)`): when all come from one import.
    const passed = passedThrough(context, expression);
    if (passed !== undefined) {
      // Each with its own record of what it's been through: they may share a declaration, which isn't a cycle.
      const origins = passed.map((value) => trace(context, value, depth + 1, new Set(seen)));
      const [first] = origins;
      if (
        first !== null &&
        first !== undefined &&
        origins.every((o) => o !== null && o.module === first.module && o.name === first.name)
      ) {
        return first;
      }
    }
    return withSteps(next(callee), callStep(ts, expression));
  }
  if (ts.isNewExpression(expression)) return withSteps(next(expression.expression), NEW);
  if (ts.isBinaryExpression(expression)) {
    // `a || b`, `a ?? b`: the first side that can be followed (`mongoose.models.User || mongoose.model(…)`).
    const kind = expression.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return next(expression.left) ?? next(expression.right);
    }
  }
  if (ts.isConditionalExpression(expression)) {
    return next(expression.whenTrue) ?? next(expression.whenFalse);
  }
  return null;
}

function identifierOrigin(
  context: FileContext,
  identifier: TS.Identifier,
  depth: number,
  seen: Set<TS.Node>,
): Origin | null {
  const { checker } = context;
  const symbol = checker?.getSymbolAtLocation(identifier);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (symbol === undefined || declaration === undefined) {
    return GLOBALS.has(identifier.text) ? { module: null, name: identifier.text, steps: [] } : null;
  }
  // A global the library files declare (`fetch` in lib.dom.d.ts).
  if (declaration.getSourceFile().isDeclarationFile && GLOBALS.has(identifier.text)) {
    return { module: null, name: identifier.text, steps: [] };
  }
  return declarationOrigin(context, declaration, depth + 1, seen, symbol);
}

/** An import's module and name, read from the import itself. */
function importOrigin(ts: typeof TS, declaration: TS.Declaration): Origin | null {
  if (ts.isImportSpecifier(declaration)) {
    const module = declaration.parent.parent.parent.moduleSpecifier;
    return ts.isStringLiteral(module)
      ? {
          module: module.text,
          name: (declaration.propertyName ?? declaration.name).text,
          steps: [],
        }
      : null;
  }
  if (ts.isImportClause(declaration)) {
    const module = declaration.parent.moduleSpecifier;
    return ts.isStringLiteral(module) ? { module: module.text, name: 'default', steps: [] } : null;
  }
  if (ts.isNamespaceImport(declaration)) {
    const module = declaration.parent.parent.moduleSpecifier;
    return ts.isStringLiteral(module) ? { module: module.text, name: '*', steps: [] } : null;
  }
  if (ts.isImportEqualsDeclaration(declaration)) {
    const reference = declaration.moduleReference;
    return ts.isExternalModuleReference(reference) && ts.isStringLiteral(reference.expression)
      ? { module: reference.expression.text, name: 'default', steps: [] }
      : null;
  }
  return null;
}

function declarationOrigin(
  context: FileContext,
  declaration: TS.Declaration,
  depth: number,
  seen: Set<TS.Node>,
  symbol?: TS.Symbol,
): Origin | null {
  const { ts, checker } = context;
  if (depth > MAX_DEPTH) return null;
  const next = (e: TS.Expression) => trace(context, e, depth + 1, seen);
  const imported = importOrigin(ts, declaration);
  if (imported !== null) {
    // Imported from the project's own code: followed there (`@documenso/prisma` → `new PrismaClient()`).
    if (symbol !== undefined && checker !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
      const aliased = checker.getAliasedSymbol(symbol);
      const target = aliased.valueDeclaration ?? aliased.declarations?.[0];
      if (
        target !== undefined &&
        target !== declaration &&
        !target.getSourceFile().isDeclarationFile
      ) {
        const followed = declarationOrigin(context, target, depth + 1, seen);
        if (followed !== null) return followed;
      }
      // Re-exported through the project to a module it doesn't have (a generated client): the last re-export's.
      const reexported = lastReexport(ts, checker, symbol);
      if (reexported !== null) return reexported;
    }
    return imported;
  }
  if (ts.isVariableDeclaration(declaration)) {
    if (declaration.initializer !== undefined) {
      const followed = next(declaration.initializer);
      if (followed !== null) return followed;
    }
    // `let client: Stripe | undefined; … client = createStripeClient(…)`: what it's assigned, when all agree.
    const assigned = assignmentsOf(context, declaration).map((value) =>
      trace(context, value, depth + 1, new Set(seen)),
    );
    const [first] = assigned;
    if (
      first !== null &&
      first !== undefined &&
      assigned.every((o) => o !== null && o.module === first.module && o.name === first.name)
    ) {
      return first;
    }
    return declaration.type === undefined
      ? null
      : typeOrigin(context, declaration.type, depth, seen);
  }
  if (ts.isBindingElement(declaration)) {
    // `const { User } = require('~/db/models')`, `const { prisma } = ctx`: the source, then the property.
    const property =
      declaration.propertyName !== undefined && ts.isIdentifier(declaration.propertyName)
        ? declaration.propertyName.text
        : ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : null;
    const pattern = declaration.parent;
    const holder = pattern.parent;
    if (property === null || !ts.isObjectBindingPattern(pattern)) return null;
    // A destructured parameter (`{ db = prisma }`, `{ stripe }: { stripe: Stripe }`): its default, else its declared
    // type's property.
    if (ts.isParameter(holder)) {
      if (declaration.initializer !== undefined) {
        const followed = next(declaration.initializer);
        if (followed !== null) return followed;
      }
      const member = checker?.getPropertyOfType(checker.getTypeAtLocation(holder), property);
      const memberDeclaration = member?.valueDeclaration ?? member?.declarations?.[0];
      return memberDeclaration === undefined || memberDeclaration.getSourceFile().isDeclarationFile
        ? null
        : declarationOrigin(context, memberDeclaration, depth + 1, seen);
    }
    if (ts.isVariableDeclaration(holder) && holder.initializer !== undefined) {
      // A property the project declares on what's destructured: followed to its value.
      const member = checker?.getPropertyOfType(
        checker.getTypeAtLocation(holder.initializer),
        property,
      );
      const memberDeclaration = member?.valueDeclaration ?? member?.declarations?.[0];
      if (memberDeclaration !== undefined && !memberDeclaration.getSourceFile().isDeclarationFile) {
        const followed = declarationOrigin(context, memberDeclaration, depth + 1, seen);
        if (followed !== null) return followed;
      }
      return withSteps(next(holder.initializer), property);
    }
    return null;
  }
  if (ts.isParameter(declaration)) {
    if (declaration.type !== undefined) {
      const typed = typeOrigin(context, declaration.type, depth, seen);
      if (typed !== null) return typed;
    }
    // A callback's parameter: what's passed to the function this callback is given to.
    const fn = declaration.parent;
    if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isCallExpression(fn.parent)) {
      const call = fn.parent;
      if (call.arguments.includes(fn)) return withSteps(next(call.expression), PARAM);
    }
    return null;
  }
  if (
    ts.isPropertyDeclaration(declaration) ||
    ts.isPropertySignature(declaration) ||
    ts.isPropertyAssignment(declaration)
  ) {
    if (!ts.isPropertySignature(declaration) && declaration.initializer !== undefined) {
      const followed = next(declaration.initializer);
      if (followed !== null) return followed;
    }
    const type = ts.isPropertyAssignment(declaration) ? undefined : declaration.type;
    return type === undefined ? null : typeOrigin(context, type, depth, seen);
  }
  if (ts.isShorthandPropertyAssignment(declaration)) {
    const value = checker?.getShorthandAssignmentValueSymbol(declaration);
    const target = value?.valueDeclaration ?? value?.declarations?.[0];
    return target === undefined ? null : declarationOrigin(context, target, depth + 1, seen, value);
  }
  if (ts.isExportAssignment(declaration)) return next(declaration.expression);
  if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
    // A class as a value: what it extends (`class PrismaService extends PrismaClient`), still a class.
    const base = baseOf(ts, declaration);
    return base === undefined ? null : next(base);
  }
  return null;
}

/** A type written in the code (`prisma: PrismaService`, `Repository<User>`): its class or import, as an instance. */
function typeOrigin(
  context: FileContext,
  type: TS.TypeNode,
  depth: number,
  seen: Set<TS.Node>,
): Origin | null {
  const { ts, checker } = context;
  // `Stripe | undefined`: its one type that isn't nothing.
  if (ts.isUnionTypeNode(type)) {
    const real = type.types.filter(
      (t) =>
        !(ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) &&
        t.kind !== ts.SyntaxKind.UndefinedKeyword &&
        t.kind !== ts.SyntaxKind.NullKeyword,
    );
    const [only] = real;
    return real.length === 1 && only !== undefined ? typeOrigin(context, only, depth, seen) : null;
  }
  // `typeof import('mongoose')`: the module itself.
  if (ts.isImportTypeNode(type) && type.isTypeOf) {
    const argument = type.argument;
    return ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)
      ? { module: argument.literal.text, name: '*', steps: [] }
      : null;
  }
  // `typeof mongoose`: what that value is.
  if (ts.isTypeQueryNode(type)) {
    const name = ts.isIdentifier(type.exprName) ? type.exprName : type.exprName.right;
    return trace(context, name, depth + 1, seen);
  }
  if (!ts.isTypeReferenceNode(type)) return null;
  // `Prisma.TransactionClient`: the namespace's origin, then the type's name, as an instance.
  if (ts.isQualifiedName(type.typeName) && ts.isIdentifier(type.typeName.left)) {
    const namespace = trace(context, type.typeName.left, depth + 1, seen);
    if (namespace !== null) return withSteps(namespace, type.typeName.right.text, NEW);
  }
  const name = ts.isIdentifier(type.typeName) ? type.typeName : type.typeName.right;
  const symbol = checker?.getSymbolAtLocation(name);
  const declaration = symbol?.declarations?.[0];
  if (symbol === undefined || declaration === undefined) return null;
  // The class it names, followed to what it extends, then an instance of it.
  let target: TS.Declaration = declaration;
  if (symbol.flags & ts.SymbolFlags.Alias && checker !== undefined) {
    const aliased = checker.getAliasedSymbol(symbol);
    const found = aliased.declarations?.[0];
    if (found !== undefined && !found.getSourceFile().isDeclarationFile) target = found;
  }
  if (ts.isClassDeclaration(target)) {
    const base = baseOf(ts, target);
    const followed = base === undefined ? null : trace(context, base, depth + 1, seen);
    if (followed !== null) return withSteps(followed, NEW);
    // A class of the project's that extends nothing a rule knows: itself, by its name, as an instance.
    return null;
  }
  const imported = importOrigin(ts, target);
  return imported === null ? null : withSteps(imported, NEW);
}

function baseOf(ts: typeof TS, declaration: TS.ClassLikeDeclaration): TS.Expression | undefined {
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) return clause.types[0]?.expression;
  }
  return undefined;
}

/** A property the project declares, for `a.b` or `a['b']`: an object literal's, a class member's. */
function memberDeclaration(
  context: FileContext,
  expression: TS.PropertyAccessExpression | TS.ElementAccessExpression,
): TS.Declaration | undefined {
  const { ts, checker } = context;
  if (checker === undefined) return undefined;
  const at = ts.isPropertyAccessExpression(expression)
    ? expression.name
    : expression.argumentExpression;
  const symbol = checker.getSymbolAtLocation(at);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return undefined;
  return ts.isPropertyAssignment(declaration) ||
    ts.isShorthandPropertyAssignment(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isParameter(declaration)
    ? declaration
    : undefined;
}

/** For a call of a function the project declares with one returned value: that value. */
function returnedValue(context: FileContext, callee: TS.Expression): TS.Expression | undefined {
  const { ts, checker } = context;
  if (checker === undefined) return undefined;
  const at = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  let symbol = checker.getSymbolAtLocation(at);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  let declaration: TS.Node | undefined = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return undefined;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    declaration = declaration.initializer;
  }
  // A known wrapper that calls the function it's given (`cache(async () => …)`): that function.
  if (ts.isCallExpression(declaration)) {
    const wrapped = wrappedFunction(context, declaration);
    if (wrapped !== undefined) declaration = wrapped;
  }
  if (!(
    ts.isFunctionDeclaration(declaration) ||
    ts.isArrowFunction(declaration) ||
    ts.isFunctionExpression(declaration) ||
    ts.isMethodDeclaration(declaration)
  )) {
    return undefined;
  }
  const body = declaration.body;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) return body;
  const returns: TS.Expression[] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) returns.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  // One value returned, or several that are the same variable (`if (!client) client = …; return client;`).
  const [first] = returns;
  if (first === undefined) return undefined;
  const text = first.getText();
  return returns.every((r) => r.getText() === text) ? first : undefined;
}

/**
 * For a call of a project function declared to return its type parameter `T`, with a parameter typed `T` or `() => T`:
 * the value that argument gives (Documenso's `remember('prisma', () => new PrismaClient())`). Read from the declared
 * types, so it holds whatever the body does with it.
 */
function passedThrough(
  context: FileContext,
  call: TS.CallExpression,
): readonly TS.Expression[] | undefined {
  const { ts, checker } = context;
  if (checker === undefined) return undefined;
  const callee = call.expression;
  let symbol = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(callee) ? callee.name : callee,
  );
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.valueDeclaration;
  if (
    declaration === undefined ||
    declaration.getSourceFile().isDeclarationFile ||
    !(ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
  ) {
    return undefined;
  }
  const returns = declaration.type;
  if (
    returns === undefined ||
    !ts.isTypeReferenceNode(returns) ||
    !ts.isIdentifier(returns.typeName)
  ) {
    return undefined;
  }
  const parameter = returns.typeName.text;
  if (!(declaration.typeParameters ?? []).some((p) => p.name.text === parameter)) return undefined;
  const isT = (type: TS.TypeNode | undefined) =>
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === parameter;
  for (const [index, p] of declaration.parameters.entries()) {
    const argument = call.arguments[index];
    if (argument === undefined) continue;
    if (isT(p.type)) return [argument];
    if (p.type !== undefined && ts.isFunctionTypeNode(p.type) && isT(p.type.type)) {
      if (!(ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) return undefined;
      const body = argument.body;
      if (!ts.isBlock(body)) return [body];
      const returned: TS.Expression[] = [];
      const visit = (node: TS.Node): void => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression !== undefined)
          returned.push(node.expression);
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
      return returned.length > 0 ? returned : undefined;
    }
  }
  return undefined;
}

/**
 * Following an import one alias at a time, the last `export { X } from 'm'` on the way: where the project says the value
 * comes from when the module itself isn't there (Rallly's `export { Prisma } from '../generated/prisma/client'`).
 */
function lastReexport(ts: typeof TS, checker: TS.TypeChecker, symbol: TS.Symbol): Origin | null {
  let found: Origin | null = null;
  let current = symbol;
  for (let hops = 0; hops < 8; hops += 1) {
    // Only an alias has a next step (the checker asserts it).
    if ((current.flags & ts.SymbolFlags.Alias) === 0) break;
    const next = checker.getImmediateAliasedSymbol(current);
    const declaration = next?.declarations?.[0];
    if (next === undefined || declaration === undefined) break;
    if (ts.isExportSpecifier(declaration)) {
      const module = declaration.parent.parent.moduleSpecifier;
      if (module !== undefined && ts.isStringLiteral(module)) {
        found = {
          module: module.text,
          name: (declaration.propertyName ?? declaration.name).text,
          steps: [],
        };
      }
    }
    current = next;
  }
  return found;
}

/** Functions that hand back the function they're given, calling it as it is (memoised): React's and lodash's. */
const PASS_THROUGH: Readonly<Record<string, ReadonlySet<string>>> = {
  react: new Set(['cache', 'useCallback']),
  lodash: new Set(['memoize', 'once']),
  'lodash/memoize': new Set(['default']),
  'lodash/once': new Set(['default']),
};

function wrappedFunction(context: FileContext, call: TS.CallExpression): TS.Expression | undefined {
  const { ts } = context;
  const [fn] = call.arguments;
  if (fn === undefined || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)))
    return undefined;
  const wrapper = trace(context, call.expression, 0, new Set());
  if (wrapper?.module == null || wrapper.steps.length > 0) return undefined;
  return PASS_THROUGH[wrapper.module]?.has(wrapper.name) === true ? fn : undefined;
}

/** The values a variable is assigned in its file (`client = createStripeClient(…)`). */
function assignmentsOf(context: FileContext, declaration: TS.VariableDeclaration): TS.Expression[] {
  const { ts, checker } = context;
  if (checker === undefined || !ts.isIdentifier(declaration.name)) return [];
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (symbol === undefined) return [];
  const values: TS.Expression[] = [];
  const visit = (node: TS.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      checker.getSymbolAtLocation(node.left) === symbol
    ) {
      values.push(node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.getSourceFile());
  return values;
}
