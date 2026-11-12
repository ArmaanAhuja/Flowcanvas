// The rules for what a callable is and what a call site reaches (phase 5, ADR 0026 addendum), shared by the Calls tab's
// answers and the graph pass (phase 6, ADR 0027) so both see the same code the same way.
import type * as TS from 'typescript';
import type { TypeScript } from './projects.js';

const MAX_NAME = 120;

/**
 * A callee whose function is fixed where it's declared: a module-level constant or variable (`export const nanoid =
 * customAlphabet(…)`), or a member of an interface, type or class. Not a parameter, a local, a destructured name or
 * an object literal's property: those hold whatever they're given at run time.
 */
export function isFixedCallee(ts: TypeScript, declaration: TS.Declaration): boolean {
  if (ts.isVariableDeclaration(declaration)) {
    const statement = declaration.parent.parent;
    return (
      ts.isIdentifier(declaration.name) &&
      ts.isVariableStatement(statement) &&
      (ts.isSourceFile(statement.parent) || ts.isModuleBlock(statement.parent))
    );
  }
  return (
    ts.isPropertySignature(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isMethodSignature(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isFunctionDeclaration(declaration) ||
    ts.isClassLike(declaration)
  );
}

/**
 * A declaration TypeScript's call hierarchy treats as its own callable (its `isValidCallHierarchyDeclaration`): a
 * function, method, accessor or class, a named function expression, or a function or class assigned to a constant
 * or a class property. Its calls are its own, not the enclosing function's.
 */
export function isNamedCallable(ts: TypeScript, node: TS.Node): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name))
  ) {
    return true;
  }
  if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name !== undefined)
    return true;
  if (!(ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isClassExpression(node)))
    return false;
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.initializer === node &&
    ts.isIdentifier(parent.name) &&
    (ts.isPropertyDeclaration(parent) ||
      (ts.getCombinedNodeFlags(parent) & ts.NodeFlags.Const) !== 0)
  );
}

/**
 * The callable whose name is at `position`: the function, method or class itself, or, for `const f = () => …`, the
 * function assigned (climbing from the name reaches the file, and the whole file was scanned: found by the corpus
 * check, `createPoll` listed calls from the functions after it).
 */
export function callableAt(
  ts: TypeScript,
  source: TS.SourceFile,
  position: number,
): TS.Node | undefined {
  let node = findNode(ts, source, position);
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return node;
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer !== undefined &&
      isNamedCallable(ts, node.initializer)
    ) {
      return node.initializer;
    }
    node = node.parent;
  }
  return node;
}

/**
 * A callee as written, a call's arguments shortened: `Buffer.concat(…).toString`, not the whole array passed to
 * `concat` (found by the corpus check). Anything else (`(save as () => void)`) as written; `cut` caps it.
 */
export function calleeText(ts: TypeScript, node: TS.Node, source: TS.SourceFile): string {
  if (ts.isPropertyAccessExpression(node)) {
    return `${calleeText(ts, node.expression, source)}.${node.name.getText(source)}`;
  }
  if (ts.isCallExpression(node)) return `${calleeText(ts, node.expression, source)}(…)`;
  if (ts.isElementAccessExpression(node)) return `${calleeText(ts, node.expression, source)}[…]`;
  if (ts.isNonNullExpression(node)) return `${calleeText(ts, node.expression, source)}!`;
  return node.getText(source);
}

/** A declaration's kind in TypeScript's words, for `kindOf`. */
export function kindOfDeclaration(ts: TypeScript, node: TS.Declaration): TS.ScriptElementKind {
  const K = ts.ScriptElementKind;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    return K.functionElement;
  // A property holding a function is called like a method, and listed as one.
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    return K.memberFunctionElement;
  }
  if (ts.isClassLike(node)) return K.classElement;
  if (ts.isVariableDeclaration(node))
    return (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) !== 0
      ? K.constElement
      : K.variableElement;
  if (ts.isInterfaceDeclaration(node)) return K.interfaceElement;
  return K.unknown;
}

export const cut = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_NAME ? `${flat.slice(0, MAX_NAME - 1)}…` : flat;
};

/** The innermost node that contains `position`. */
export function findNode(
  ts: TypeScript,
  source: TS.SourceFile,
  position: number,
): TS.Node | undefined {
  let found: TS.Node | undefined;
  const visit = (node: TS.Node) => {
    if (position >= node.getStart(source) && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(source, visit);
  return found;
}
