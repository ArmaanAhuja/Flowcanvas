// What the inspector shows of a code unit (phase 7, ADR 0028 §3): everything its code reveals, read with TypeScript.
// Its signature and typed inputs and output; its decisions and their conditions; what it throws and awaits; the calls
// whose target wasn't found; and its writes to module state. The unit is the one the graph gives the place to, by the
// pass's own rules, so the inspector and the flow always describe the same node.
import { basename } from 'node:path';
import { FLOW_LIMITS, type GraphEdge } from '@flowcanvas/graph-model';
import type * as TS from 'typescript';
import {
  DETAIL_LIMITS,
  type CallEntry,
  type CodeItem,
  type CodePosition,
  type DetailDecision,
  type DetailLine,
  type DetailList,
  type DetailParam,
  type NodeDetails,
  type SymbolKindName,
} from '../protocol.js';
import { calleeText, kindOf, kindOfDeclaration } from './callables.js';
import {
  nameOf,
  placeOf,
  projectPath,
  unitNodeAt,
  unitOf,
  unitsOf,
  walkFile,
  type GraphContext,
  containerOf,
  type WalkedFile,
} from './graph-pass.js';

/** Flattened and cut: the inspector's texts are one line each, and bounded (the full text is in the code). */
export const cutDetail = (text: string, most: number = DETAIL_LIMITS.text): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > most ? `${flat.slice(0, most - 1)}…` : flat;
};

/** A list's first `most` items, and how many there were in all. */
function gather<T>(most: number) {
  const items: T[] = [];
  let total = 0;
  return {
    add(item: T) {
      total += 1;
      if (items.length < most) items.push(item);
    },
    done: (): DetailList<T> => ({ items, total }),
  };
}

/** The details of the code unit at a place, asked of TypeScript now (a file changed since the last pass). */
export function detailsAt(
  ctx: GraphContext,
  program: TS.Program,
  source: TS.SourceFile,
  offset: number,
): NodeDetails {
  const { node, id } = unitNodeAt(ctx, source, offset);
  const checker = program.getTypeChecker();
  const edges = walkFile(ctx, program, source).edges;
  return unitDetails(ctx, checker, source, node, id, edges, fileContext(ctx, checker, source));
}

/** A callee as the pass stores it: with whether TypeScript's call hierarchy gave it (only those have callers). */
export interface StoredCallee extends CallEntry {
  readonly hierarchy: boolean;
  /**
   * The same calls as TypeScript's incoming calls place them, for the callee's callers: at the name called
   * (`poll.create()`: `create`), where outgoing calls place them at the callee expression's start (`poll`).
   */
  readonly incoming?: readonly CodePosition[];
}

/** A unit's Calls-tab answer, as the pass stores it: its own item, and its callees. */
export interface StoredCalls {
  readonly item: CodeItem;
  readonly callees: readonly StoredCallee[];
  readonly complete: boolean;
}

/** One code unit of a file, as the pass stores it: its id, the range it covers (1-based), and its details. */
export interface UnitFacts {
  readonly id: string;
  /** Its Calls-tab answer (callees, and its side of its callees' callers); none where TypeScript gave none. */
  readonly calls?: StoredCalls | undefined;
  /** From its start (a constant's: the declaration's, name included) to its end, as [line, column]. */
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  readonly details: NodeDetails;
}

/**
 * Every code unit of a file with its details, worked out in the graph pass while TypeScript has the file's program
 * (owner, 13 Nov 2026: compute once, store, reuse). The innermost range holding a place is the unit there, as
 * `unitNodeAt` finds it; the top level covers the whole file.
 */
export function fileFacts(
  ctx: GraphContext,
  program: TS.Program,
  source: TS.SourceFile,
  walked: WalkedFile,
): UnitFacts[] {
  const { ts } = ctx;
  const checker = program.getTypeChecker();
  const at = (position: number): [number, number] => {
    const { line, character } = source.getLineAndCharacterOfPosition(position);
    return [line + 1, character + 1];
  };
  const file = fileContext(ctx, checker, source);
  // Its Calls-tab answer: its own item, and the callees the walk recorded for it.
  const withCalls = (
    id: string,
    start: [number, number],
    end: [number, number],
    details: NodeDetails,
    kind: SymbolKindName | null,
    container: string | null,
  ): UnitFacts => {
    const recorded = walked.calls.get(id);
    return {
      id,
      start,
      end,
      details,
      calls: {
        item: {
          name: details.name,
          kind,
          container,
          place: details.place,
          builtIn: false,
        },
        callees: recorded?.callees ?? [],
        complete: recorded?.complete ?? true,
      },
    };
  };
  const top = unitNodeAt(ctx, source, -1).id;
  const facts: UnitFacts[] = [
    withCalls(
      top,
      [1, 1],
      at(source.getEnd()),
      unitDetails(ctx, checker, source, null, top, walked.edges, file),
      null,
      null,
    ),
  ];
  for (const { node, id } of unitsOf(ctx, source)) {
    const holder =
      (ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent)) &&
      node.parent.initializer === node
        ? node.parent
        : node;
    facts.push(
      withCalls(
        id,
        at(holder.getStart(source)),
        at(holder.getEnd()),
        unitDetails(ctx, checker, source, node, id, walked.edges, file),
        // As the Calls tab names its kind: from the declaration (a property holding an arrow is a function).
        kindOf(ts, kindOfDeclaration(ts, node as TS.Declaration), nameOf(ts, node)),
        containerOf(ts, node),
      ),
    );
  }
  return facts;
}

/**
 * What a file's module exports (`export function`, `export const`, `export { name }`, a default), as declarations:
 * read once per file.
 */
function exportsOf(
  ctx: GraphContext,
  checker: TS.TypeChecker,
  source: TS.SourceFile,
): Set<TS.Node> {
  const { ts } = ctx;
  const found = new Set<TS.Node>();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return found;
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    for (const declaration of target.declarations ?? []) found.add(declaration);
  }
  return found;
}

/** What every unit of a file shares, read once per file: what it exports, and its units (whose code is their own). */
interface FileContext {
  readonly exports: ReadonlySet<TS.Node>;
  readonly units: ReadonlySet<TS.Node>;
}

function fileContext(
  ctx: GraphContext,
  checker: TS.TypeChecker,
  source: TS.SourceFile,
): FileContext {
  return {
    exports: exportsOf(ctx, checker, source),
    units: new Set(unitsOf(ctx, source).map(({ node }) => node)),
  };
}

function unitDetails(
  ctx: GraphContext,
  checker: TS.TypeChecker,
  source: TS.SourceFile,
  node: TS.Node | null,
  id: string,
  edges: readonly GraphEdge[],
  file: FileContext,
): NodeDetails {
  const { ts } = ctx;
  const path = projectPath(ctx, source.fileName);
  const lineOf = (n: TS.Node) => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const text = (n: TS.Node) => cutDetail(n.getText(source)) || '…';

  const name = node === null ? `${basename(path)} (top level)` : nameOf(ts, node);
  const unit = node === null ? 'module' : (unitOf(ts, node, name) ?? 'function');
  const place = (node === null ? null : placeOf(ctx, node)) ?? { path, line: 1, column: 1 };

  // The signature: each type as written where it's written (cheap, and what the person reads in the code), else as
  // the compiler infers it. A class's inputs are its constructor's. Printing whole signatures with the checker took
  // half of the details' time in the pass (Documenso, 13 Nov 2026).
  const typeOf = (written: TS.TypeNode | undefined, infer: () => TS.Type, at: TS.Node) =>
    (written === undefined ? '' : cutDetail(written.getText(source))) ||
    cutDetail(checker.typeToString(infer(), at)) ||
    'unknown';
  let signature: string | null = null;
  let returns: string | null = null;
  const params = gather<DetailParam>(DETAIL_LIMITS.params);
  let declared: readonly TS.ParameterDeclaration[] = [];
  if (node !== null && ts.isFunctionLike(node)) {
    declared = node.parameters;
  } else if (node !== null && ts.isClassLike(node)) {
    declared = node.members.find(ts.isConstructorDeclaration)?.parameters ?? [];
  }
  const written: string[] = [];
  for (const param of declared) {
    const type = typeOf(param.type, () => checker.getTypeAtLocation(param), param);
    const optional =
      param.questionToken !== undefined ||
      param.initializer !== undefined ||
      param.dotDotDotToken !== undefined;
    params.add({ name: text(param.name), type, optional });
    written.push(
      `${param.dotDotDotToken === undefined ? '' : '...'}${text(param.name)}${param.questionToken === undefined ? '' : '?'}: ${type}`,
    );
  }
  if (node !== null && ts.isFunctionLike(node)) {
    const found = checker.getSignatureFromDeclaration(node);
    returns = typeOf(node.type, () => found?.getReturnType() ?? checker.getAnyType(), node);
    signature = cutDetail(`(${written.join(', ')}): ${returns}`);
  }
  const async =
    node !== null &&
    ts.isFunctionLike(node) &&
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0;

  const declaration = node !== null && ts.isVariableDeclaration(node.parent) ? node.parent : node;
  const exported = declaration !== null && file.exports.has(declaration);

  /** A variable declared at a file's top level, in the project: module state. */
  const isModuleState = (identifier: TS.Identifier) => {
    let symbol = checker.getSymbolAtLocation(identifier);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const variable = symbol?.valueDeclaration;
    if (variable === undefined || !ts.isVariableDeclaration(variable)) return false;
    const statement = variable.parent.parent;
    return (
      ts.isVariableStatement(statement) &&
      ts.isSourceFile(statement.parent) &&
      ctx.inProject(statement.parent.fileName)
    );
  };
  const awaited = (expression: TS.Expression) => {
    let inner = expression;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    return ts.isCallExpression(inner)
      ? cutDetail(calleeText(ts, inner.expression, source)) || '…'
      : text(inner);
  };

  const decisions = gather<DetailDecision>(DETAIL_LIMITS.items);
  const throws = gather<DetailLine>(DETAIL_LIMITS.items);
  const awaits = gather<DetailLine>(DETAIL_LIMITS.items);
  const writes = gather<DetailLine>(DETAIL_LIMITS.items);
  // Its own code only: a nested function, method or class is a unit of its own, as in the graph.
  const visit = (n: TS.Node): void => {
    if (n !== node && file.units.has(n)) return;
    if (ts.isIfStatement(n)) {
      decisions.add({
        kind: 'if',
        condition: text(n.expression),
        outcomes: n.elseStatement === undefined ? ['yes'] : ['yes', 'no'],
        line: lineOf(n.expression),
      });
    } else if (ts.isSwitchStatement(n)) {
      decisions.add({
        kind: 'switch',
        condition: text(n.expression),
        outcomes: n.caseBlock.clauses
          .slice(0, DETAIL_LIMITS.outcomes)
          .map((clause) =>
            ts.isCaseClause(clause)
              ? cutDetail(`case ${clause.expression.getText(source)}`)
              : 'default',
          ),
        line: lineOf(n.expression),
      });
    } else if (ts.isConditionalExpression(n)) {
      decisions.add({
        kind: 'ternary',
        condition: text(n.condition),
        outcomes: ['yes', 'no'],
        line: lineOf(n.condition),
      });
    } else if (ts.isTryStatement(n) && n.catchClause !== undefined) {
      decisions.add({
        kind: 'catch',
        condition: 'on error',
        outcomes: ['error'],
        line: lineOf(n.catchClause),
      });
    } else if (ts.isThrowStatement(n)) {
      throws.add({ text: text(n.expression), line: lineOf(n) });
    } else if (ts.isAwaitExpression(n)) {
      awaits.add({ text: awaited(n.expression), line: lineOf(n) });
    } else if (ts.isForOfStatement(n) && n.awaitModifier !== undefined) {
      awaits.add({ text: cutDetail(`for await of ${text(n.expression)}`), line: lineOf(n) });
    }
    // Writes: an assignment or ++/-- whose target is (a property of) a module-level variable.
    const target =
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ? n.left
        : (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
            (n.operator === ts.SyntaxKind.PlusPlusToken ||
              n.operator === ts.SyntaxKind.MinusMinusToken)
          ? n.operand
          : undefined;
    if (target !== undefined) {
      let root: TS.Node = target;
      while (
        ts.isPropertyAccessExpression(root) ||
        ts.isElementAccessExpression(root) ||
        ts.isParenthesizedExpression(root) ||
        ts.isNonNullExpression(root)
      ) {
        root = root.expression;
      }
      if (ts.isIdentifier(root) && isModuleState(root)) {
        writes.add({ text: text(target), line: lineOf(target) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node ?? source);

  // Calls whose target wasn't found: the graph's own unknown call edges from this unit (its flow's open stub).
  const unresolved = gather<{ readonly text: string; readonly lines: readonly number[] }>(
    DETAIL_LIMITS.items,
  );
  for (const edge of edges) {
    if (edge.kind === 'call' && edge.from === id && edge.to === null && edge.target !== null) {
      unresolved.add({
        text: cutDetail(edge.target) || '…',
        lines: edge.lines.slice(0, FLOW_LIMITS.lines),
      });
    }
  }

  return {
    id,
    name: cutDetail(name) || 'default',
    unit,
    place,
    signature,
    params: params.done(),
    returns,
    async,
    exported,
    decisions: decisions.done(),
    throws: throws.done(),
    awaits: awaits.done(),
    unresolved: unresolved.done(),
    writes: writes.done(),
  };
}
