// One file's part of the flow graph (phase 6, ADR 0027): its code units, and the calls each makes, resolved with the
// type checker or kept as unknown with the call's text. Built-ins are counted, not kept (owner, 12 Nov 2026).
import { basename, relative, sep } from 'node:path';
import type { GraphEdge, GraphNode, Relation } from '@flowcanvas/graph-model';
import type * as TS from 'typescript';
import { calleeText, cut, findNode, isFixedCallee, isNamedCallable } from './callables.js';
import type { TypeScript } from './projects.js';

export interface FileGraph {
  /** The file's named code units, and its top level if it makes calls there. */
  readonly nodes: readonly GraphNode[];
  /**
   * What this file's code calls: code units (whose own file has them too) and constants or members, which are nodes
   * only because they're called.
   */
  readonly targets: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly builtInCalls: number;
}

export interface GraphContext {
  readonly ts: TypeScript;
  readonly root: string;
  /** Inside the project, not in node_modules. */
  readonly inProject: (file: string) => boolean;
  /** TypeScript's own library. */
  readonly builtIn: (file: string) => boolean;
}

export const projectPath = (ctx: GraphContext, file: string) =>
  relative(ctx.root, file).split(sep).join('/');

/** A declaration's own name: a function's, a method's, or the constant or property it's assigned to. */
export function nameOf(ts: TypeScript, node: TS.Node): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const named = (node as { readonly name?: TS.Node }).name;
  if (
    named !== undefined &&
    (ts.isIdentifier(named) ||
      ts.isPrivateIdentifier(named) ||
      ts.isStringLiteral(named) ||
      ts.isNumericLiteral(named))
  ) {
    return named.text;
  }
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return 'default';
}

/** Whether a declaration is a code unit or a constant or member something can call (ADR 0027 §3). */
function isUnit(ts: TypeScript, node: TS.Node): boolean {
  if (isNamedCallable(ts, node)) return true;
  // A constant or a class property assigned a function is the function's node, not one of its own (a property's
  // was `Store.save.save`, found in phase 7).
  if (
    (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
    node.initializer !== undefined &&
    isNamedCallable(ts, node.initializer)
  ) {
    return false;
  }
  return isFixedCallee(ts, node as TS.Declaration);
}

/** What makes a qualified name: named code units, and the classes, interfaces and namespaces around them. */
function isScope(ts: TypeScript, node: TS.Node): boolean {
  return (
    isUnit(ts, node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name))
  );
}

export function unitOf(ts: TypeScript, node: TS.Node, name: string): GraphNode['unit'] {
  if (ts.isClassLike(node)) return 'class';
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyDeclaration(node.parent)
  ) {
    return 'method';
  }
  return /^[A-Z]/.test(name) ? 'component' : 'function';
}

const ids = new WeakMap<TS.SourceFile, Map<TS.Node, string>>();

/**
 * Every possible node's id in a file (ADR 0027 §4): its path and qualified name, `~2`, `~3` for later declarations
 * with the same one, in source order. Worked out once per source file, so a node has the same id whichever file's
 * walk reaches it.
 */
function idsOf(ctx: GraphContext, source: TS.SourceFile): Map<TS.Node, string> {
  const known = ids.get(source);
  if (known !== undefined) return known;
  const { ts } = ctx;
  const path = projectPath(ctx, source.fileName);
  const found = new Map<TS.Node, string>();
  const used = new Map<string, number>();
  const visit = (node: TS.Node, scope: readonly string[]): void => {
    let inner = scope;
    if (isScope(ts, node)) {
      inner = [...scope, nameOf(ts, node)];
      if (isUnit(ts, node)) {
        const base = `${path}#${inner.join('.')}`;
        const seen = (used.get(base) ?? 0) + 1;
        used.set(base, seen);
        found.set(node, seen === 1 ? base : `${base}~${String(seen)}`);
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, inner);
    });
  };
  visit(source, []);
  ids.set(source, found);
  return found;
}

/**
 * The code unit a place is in (phase 7, ADR 0028): the innermost one, or the file's top level (`node` null). The
 * pass's own ids and rule for whose code is whose (a constant that's only called isn't a unit of its own), so a flow
 * or the inspector starts from the node the graph gives that code.
 */
export function unitNodeAt(
  ctx: GraphContext,
  source: TS.SourceFile,
  offset: number,
): { readonly node: TS.Node | null; readonly id: string } {
  const own = idsOf(ctx, source);
  for (
    let node = findNode(ctx.ts, source, offset);
    node !== undefined && !ctx.ts.isSourceFile(node);
    node = node.parent
  ) {
    // On a constant's or property's name, outside the function it's given: that function (as `callableAt`).
    const unit =
      (ctx.ts.isVariableDeclaration(node) || ctx.ts.isPropertyDeclaration(node)) &&
      node.initializer !== undefined
        ? node.initializer
        : node;
    const id = own.get(unit);
    if (id !== undefined && isNamedCallable(ctx.ts, unit)) return { node: unit, id };
  }
  return { node: null, id: `${projectPath(ctx, source.fileName)}#(top level)` };
}

/** Every code unit of a file, with its id, in source order (the pass's rule: named callables). */
export function unitsOf(
  ctx: GraphContext,
  source: TS.SourceFile,
): { readonly node: TS.Node; readonly id: string }[] {
  return [...idsOf(ctx, source)]
    .filter(([node]) => isNamedCallable(ctx.ts, node))
    .map(([node, id]) => ({ node, id }));
}

export function placeOf(ctx: GraphContext, node: TS.Node): GraphNode['place'] {
  const source = node.getSourceFile();
  const name = ctx.ts.getNameOfDeclaration(node as TS.Declaration) ?? node;
  const { line, character } = source.getLineAndCharacterOfPosition(name.getStart(source));
  return { path: projectPath(ctx, source.fileName), line: line + 1, column: character + 1 };
}

function nodeOf(ctx: GraphContext, node: TS.Node, id: string): GraphNode {
  const name = nameOf(ctx.ts, node);
  return {
    id,
    kind: 'code-unit',
    name,
    place: placeOf(ctx, node),
    unit: unitOf(ctx.ts, node, name),
    change: 'unchanged',
  };
}

/** The node a resolved declaration is, if it's one the graph has (a code unit, or a constant or member). */
function targetOf(ctx: GraphContext, declaration: TS.Declaration): TS.Node | undefined {
  const { ts } = ctx;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    isNamedCallable(ts, declaration.initializer)
  ) {
    return declaration.initializer;
  }
  return isUnit(ts, declaration) ? declaration : undefined;
}

/** A construct that decides whether a call happens (ADR 0028 §1), and which of its outcomes the call is on. */
interface Guard {
  readonly construct: TS.Node;
  /** The condition, or for a switch the switched expression; a try's is "on error". */
  readonly name: string;
  readonly outcome: string;
  /** Where the decision is: its condition's start. */
  readonly at: TS.Node;
}

/**
 * The decisions a call sits under, outermost first: `if`/`else` (yes, no), a ternary or `&&` (yes) or `||`/`??` (no),
 * a `switch` case, and a `catch` (error). Calls in a `try` block or a `finally` aren't conditional.
 */
function guardsOf(ts: TypeScript, source: TS.SourceFile, call: TS.Node, owner: TS.Node): Guard[] {
  const found: Guard[] = [];
  const text = (node: TS.Node) => node.getText(source);
  for (
    let child = call, parent = call.parent;
    parent !== owner;
    child = parent, parent = parent.parent
  ) {
    if (ts.isSourceFile(parent)) break;
    if (ts.isIfStatement(parent) && child !== parent.expression) {
      found.push({
        construct: parent,
        name: text(parent.expression),
        outcome: child === parent.thenStatement ? 'yes' : 'no',
        at: parent.expression,
      });
    } else if (ts.isConditionalExpression(parent) && child !== parent.condition) {
      found.push({
        construct: parent,
        name: text(parent.condition),
        outcome: child === parent.whenTrue ? 'yes' : 'no',
        at: parent.condition,
      });
    } else if (
      ts.isBinaryExpression(parent) &&
      child === parent.right &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(parent.operatorToken.kind)
    ) {
      found.push({
        construct: parent,
        name: text(parent.left),
        outcome: parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? 'yes' : 'no',
        at: parent.left,
      });
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      const switched = parent.parent.parent;
      found.push({
        construct: switched,
        name: text(switched.expression),
        outcome: ts.isCaseClause(parent) ? `case ${cut(text(parent.expression))}` : 'default',
        at: switched.expression,
      });
    } else if (ts.isCatchClause(parent)) {
      found.push({
        construct: parent.parent,
        name: 'on error',
        outcome: 'error',
        at: parent.parent,
      });
    }
  }
  return found.reverse();
}

/** One file's code units and calls. */
export function walkFile(ctx: GraphContext, program: TS.Program, source: TS.SourceFile): FileGraph {
  const { ts } = ctx;
  const checker = program.getTypeChecker();
  const path = projectPath(ctx, source.fileName);
  const own = idsOf(ctx, source);
  const nodes = new Map<string, GraphNode>();
  const targets = new Map<string, GraphNode>();
  const edges = new Map<string, { edge: Omit<GraphEdge, 'lines'>; lines: Set<number> }>();
  let builtInCalls = 0;
  const top = `${path}#(top level)`;

  const add = (edge: Omit<GraphEdge, 'lines'>, line: number) => {
    const key = [
      edge.from,
      edge.to ?? `?${edge.target ?? ''}`,
      edge.kind,
      edge.relation ?? '',
      edge.label ?? '',
    ].join('\u0000');
    const known = edges.get(key);
    if (known === undefined) edges.set(key, { edge, lines: new Set([line]) });
    else known.lines.add(line);
  };

  // Decisions (ADR 0028 §1): one node per construct that guards a call, numbered within its function.
  const decisions = new Map<TS.Node, string>();
  const decisionsIn = new Map<string, number>();
  const decisionOf = (guard: Guard, owner: string): string => {
    const known = decisions.get(guard.construct);
    if (known !== undefined) return known;
    const n = (decisionsIn.get(owner) ?? 0) + 1;
    decisionsIn.set(owner, n);
    const id = `${owner}?${String(n)}`;
    decisions.set(guard.construct, id);
    const at = source.getLineAndCharacterOfPosition(guard.at.getStart(source));
    nodes.set(id, {
      id,
      kind: 'decision',
      name: cut(guard.name),
      place: { path, line: at.line + 1, column: at.character + 1 },
      unit: null,
      change: 'unchanged',
    });
    return id;
  };
  const lineOf = (node: TS.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: TS.Node, owner: string, ownerNode: TS.Node): void => {
    let current = owner;
    let currentNode = ownerNode;
    const id = own.get(node);
    if (id !== undefined && isNamedCallable(ts, node)) {
      current = id;
      currentNode = node;
      nodes.set(id, nodeOf(ctx, node, id));
    }
    const jsx = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
    if (jsx || ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = jsx ? node.tagName : node.expression;
      let inline: TS.Node = callee;
      while (ts.isParenthesizedExpression(inline)) inline = inline.expression;
      const skip =
        callee.kind === ts.SyntaxKind.SuperKeyword ||
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        // An IIFE's body is this code's own, walked below (phase 5).
        ts.isArrowFunction(inline) ||
        ts.isFunctionExpression(inline) ||
        // <div> isn't a call.
        (jsx && ts.isIdentifier(callee) && /^[a-z]/.test(callee.text));
      if (!skip) {
        const relation: Relation = jsx ? 'renders' : 'calls';
        const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
        let symbol = checker.getSymbolAtLocation(name);
        if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
          symbol = checker.getAliasedSymbol(symbol);
        }
        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        const line = source.getLineAndCharacterOfPosition(callee.getStart(source)).line + 1;
        const declaredIn = declaration?.getSourceFile().fileName;
        if (declaredIn !== undefined && ctx.builtIn(declaredIn)) {
          builtInCalls += 1;
        } else {
          const target =
            declaration !== undefined && declaredIn !== undefined && ctx.inProject(declaredIn)
              ? targetOf(ctx, declaration)
              : undefined;
          const targetId =
            target === undefined ? undefined : idsOf(ctx, target.getSourceFile()).get(target);
          if (current === top && !nodes.has(top)) {
            nodes.set(top, {
              id: top,
              kind: 'code-unit',
              name: `${basename(path)} (top level)`,
              place: { path, line: 1, column: 1 },
              unit: 'module',
              change: 'unchanged',
            });
          }
          const reaches =
            target !== undefined && targetId !== undefined
              ? { to: targetId, target: null, provenance: 'resolved' as const }
              : {
                  to: null,
                  target: cut(calleeText(ts, callee, source)),
                  provenance: 'unknown' as const,
                };
          if (target !== undefined && targetId !== undefined) {
            // Every target's node, so an edge never reaches a node the graph lacks (its own file's wins).
            targets.set(targetId, nodeOf(ctx, target, targetId));
          }
          // The call itself, as it always was: callers and callees don't change (ADR 0028 §1).
          add({ from: current, kind: 'call', relation, label: null, ...reaches }, line);
          // And through the decisions it sits under: into the first, from each to the next, out to the call.
          const guards = guardsOf(ts, source, node, currentNode);
          let from = current;
          let outcome: string | null = null;
          for (const guard of guards) {
            const decision = decisionOf(guard, current);
            add(
              {
                from,
                to: decision,
                target: null,
                kind: 'branch',
                relation: null,
                label: outcome,
                provenance: 'resolved',
              },
              lineOf(guard.at),
            );
            from = decision;
            outcome = guard.outcome;
          }
          if (outcome !== null) {
            add({ from, kind: 'branch', relation, label: outcome, ...reaches }, line);
          }
        }
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, current, currentNode);
    });
  };
  visit(source, top, source);

  return {
    nodes: [...nodes.values()],
    targets: [...targets.values()],
    edges: [...edges.values()].map(({ edge, lines }) => ({
      ...edge,
      lines: [...lines].sort((a, b) => a - b),
    })),
    builtInCalls,
  };
}
