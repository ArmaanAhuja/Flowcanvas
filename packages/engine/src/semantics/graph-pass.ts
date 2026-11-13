// One file's part of the flow graph (phase 6, ADR 0027): its code units, and the calls each makes, resolved with the
// type checker or kept as unknown with the call's text. Built-ins are counted, not kept (owner, 12 Nov 2026).
import { basename, relative, sep } from 'node:path';
import type { GraphEdge, GraphNode, Relation } from '@flowcanvas/graph-model';
import type * as TS from 'typescript';
import {
  calleeText,
  cut,
  findNode,
  isFixedCallee,
  isNamedCallable,
  kindOf,
  kindOfDeclaration,
} from './callables.js';
import {
  SEMANTIC_LIMITS,
  type CodeItem,
  type CodePosition,
  type Relation as CallRelation,
} from '../protocol.js';
import type { StoredCallee } from './details.js';
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

/** A file's walk, with each unit's calls in the Calls tab's shape (phase 7, ADR 0029): stored, never held. */
export interface WalkedFile extends FileGraph {
  /** By the calling unit's id: its callees, and whether they were all kept (SEMANTIC_LIMITS). */
  readonly calls: ReadonlyMap<
    string,
    { readonly callees: readonly StoredCallee[]; readonly complete: boolean }
  >;
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
  const { ts } = ctx;
  const source = node.getSourceFile();
  // A function held by a constant or a class property is placed at the holder's name, as TypeScript places it (a
  // property's was the arrow's start, found in phase 7).
  const holder =
    (ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent)) &&
    node.parent.initializer === node
      ? node.parent
      : node;
  const name = ts.getNameOfDeclaration(holder as TS.Declaration) ?? node;
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
/**
 * The Calls tab's container for a code unit, as TypeScript's call hierarchy names it: the class, namespace or
 * object literal (by the name it's held by) it's declared in; an interface for a property, none for its methods; none in
 * a function or at a top level.
 */
export function containerOf(ts: TypeScript, node: TS.Node): string | null {
  const holder =
    (ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent)) &&
    node.parent.initializer === node
      ? node.parent
      : node;
  for (let scope = holder.parent; !ts.isSourceFile(scope); scope = scope.parent) {
    // In an interface, a method signature is the call hierarchy's and has none (`Cache.get`); a property holding a
    // function is named by its interface (`HeadlessDatePickerOptions.onNavigationChange`).
    if (ts.isInterfaceDeclaration(scope))
      return ts.isMethodSignature(holder) ? null : scope.name.text;
    if (ts.isClassLike(scope) || ts.isModuleDeclaration(scope)) {
      return scope.name !== undefined && ts.isIdentifier(scope.name) ? scope.name.text : null;
    }
    if (ts.isObjectLiteralExpression(scope)) {
      const named = scope.parent;
      return (ts.isVariableDeclaration(named) || ts.isPropertyAssignment(named)) &&
        ts.isIdentifier(named.name)
        ? named.name.text
        : null;
    }
    if (ts.isFunctionLike(scope) || ts.isBlock(scope)) return null;
  }
  return null;
}

/**
 * Where TypeScript's incoming calls place a call that starts at `start`: at the name called, the last of a chain of
 * property accesses starting there (`a.b.create()`: `create`), where outgoing calls place it at the start (`a`).
 */
function calledName(ts: TypeScript, source: TS.SourceFile, start: number): number {
  let node = findNode(ts, source, start);
  for (
    let parent = node?.parent;
    parent?.getStart(source) === start &&
    (ts.isPropertyAccessExpression(parent) || ts.isNonNullExpression(parent));
    parent = parent.parent
  ) {
    node = parent;
  }
  return node !== undefined && ts.isPropertyAccessExpression(node)
    ? node.name.getStart(source)
    : start;
}

export function walkFile(
  ctx: GraphContext,
  program: TS.Program,
  source: TS.SourceFile,
): WalkedFile {
  const { ts } = ctx;
  const checker = program.getTypeChecker();
  const path = projectPath(ctx, source.fileName);
  const own = idsOf(ctx, source);
  const nodes = new Map<string, GraphNode>();
  const targets = new Map<string, GraphNode>();
  // `direct`: the lines with a call no decision guards; a call's other lines are its guarded ones.
  const edges = new Map<
    string,
    { edge: Omit<GraphEdge, 'lines'>; lines: Set<number>; direct: Set<number> }
  >();
  let builtInCalls = 0;
  const top = `${path}#(top level)`;

  const add = (edge: Omit<GraphEdge, 'lines'>, line: number, guarded = false) => {
    const key = [
      edge.from,
      edge.to ?? `?${edge.target ?? ''}`,
      edge.kind,
      edge.relation ?? '',
      edge.label ?? '',
    ].join('\u0000');
    let known = edges.get(key);
    if (known === undefined) {
      known = { edge, lines: new Set(), direct: new Set() };
      edges.set(key, known);
    }
    known.lines.add(line);
    if (!guarded) known.direct.add(line);
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
  const positionOf = (offset: number): CodePosition => {
    const { line, character } = source.getLineAndCharacterOfPosition(offset);
    return { path, line: line + 1, column: character + 1 };
  };

  // Each unit's calls as the Calls tab lists them: one entry per callee and relation, each call once.
  type Draft = StoredCallee & { sites: CodePosition[]; incoming: CodePosition[] };
  const calls = new Map<
    string,
    { entries: Map<string, Draft>; starts: Set<string>; complete: boolean }
  >();
  const record = (
    owner: string,
    key: string,
    base: CodeItem,
    relation: CallRelation,
    resolved: boolean,
    start: number,
  ) => {
    let mine = calls.get(owner);
    if (mine === undefined) {
      mine = { entries: new Map(), starts: new Set(), complete: true };
      calls.set(owner, mine);
    }
    let entry = mine.entries.get(key);
    if (entry === undefined) {
      if (mine.entries.size >= SEMANTIC_LIMITS.entries) {
        mine.complete = false;
        return;
      }
      entry = {
        ...base,
        relation,
        provenance: resolved ? 'resolved' : 'unresolved',
        hierarchy: base.place !== null,
        sites: [],
        incoming: [],
      };
      mine.entries.set(key, entry);
    }
    if (mine.starts.has(`${key}@${String(start)}`)) return;
    mine.starts.add(`${key}@${String(start)}`);
    if (entry.sites.length < SEMANTIC_LIMITS.sites) {
      entry.sites.push(positionOf(start));
      entry.incoming.push(positionOf(calledName(ts, source, start)));
    }
  };

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
        const start = callee.getStart(source);
        if (declaredIn !== undefined && ctx.builtIn(declaredIn)) {
          builtInCalls += 1;
          // Built-ins: named as the compiler names them (`split`, `Promise`), one row per name.
          const named = cut(symbol?.getName() ?? calleeText(ts, callee, source));
          record(
            current,
            `builtin:${named}:${relation}`,
            {
              name: named,
              kind:
                declaration === undefined
                  ? null
                  : kindOf(ts, kindOfDeclaration(ts, declaration), named),
              // TypeScript's call hierarchy gives a built-in no container (`Math.max`: none).
              container: null,
              place: null,
              builtIn: true,
            },
            relation,
            true,
            start,
          );
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
          // The call itself, as it always was: callers and callees don't change (ADR 0028 §1). Whether a decision
          // guards it is said per line, for the flow.
          const guards = guardsOf(ts, source, node, currentNode);
          add(
            { from: current, kind: 'call', relation, label: null, ...reaches },
            line,
            guards.length > 0,
          );
          if (target !== undefined && targetId !== undefined) {
            const reached = nodeOf(ctx, target, targetId);
            record(
              current,
              `${targetId}:${relation}`,
              {
                name: reached.name,
                kind: kindOf(ts, kindOfDeclaration(ts, target as TS.Declaration), reached.name),
                container: containerOf(ts, target),
                place: reached.place,
                builtIn: false,
              },
              relation,
              true,
              start,
            );
          } else if (
            declaration !== undefined &&
            declaredIn !== undefined &&
            !ctx.inProject(declaredIn) &&
            isFixedCallee(ts, declaration)
          ) {
            // An installed package's function: resolved, with no place in the project (the Calls tab's way; the
            // graph keeps it unknown, as it's not the project's code).
            const named = cut(symbol?.getName() ?? calleeText(ts, callee, source));
            const owner = declaration.parent;
            record(
              current,
              `package:${declaredIn}:${String(declaration.getStart())}:${relation}`,
              {
                name: named,
                kind: kindOf(ts, kindOfDeclaration(ts, declaration), named),
                container:
                  (ts.isInterfaceDeclaration(owner) || ts.isClassLike(owner)) &&
                  owner.name !== undefined
                    ? owner.name.text
                    : null,
                place: null,
                builtIn: false,
              },
              relation,
              true,
              start,
            );
          } else {
            const written = cut(calleeText(ts, callee, source));
            record(
              current,
              `unresolved:${written}:${relation}`,
              { name: written, kind: null, container: null, place: null, builtIn: false },
              relation,
              false,
              start,
            );
          }
          // And through the decisions it sits under: into the first, from each to the next, out to the call.
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
    calls: new Map(
      [...calls].map(([owner, mine]) => [
        owner,
        {
          callees: [...mine.entries.values()].map(({ incoming, ...entry }) =>
            entry.hierarchy ? { ...entry, incoming } : entry,
          ),
          complete: mine.complete,
        },
      ]),
    ),
    nodes: [...nodes.values()],
    targets: [...targets.values()],
    edges: [...edges.values()].map(({ edge, lines, direct }) => {
      const sorted = [...lines].sort((a, b) => a - b);
      const guarded = sorted.filter((line) => !direct.has(line));
      return edge.kind === 'call' && guarded.length > 0
        ? { ...edge, lines: sorted, guarded }
        : { ...edge, lines: sorted };
    }),
    builtInCalls,
  };
}
