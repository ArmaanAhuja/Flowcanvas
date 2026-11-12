// What the inspector shows of a code unit (phase 7, ADR 0028 §3): everything its code reveals, read with TypeScript.
// Its signature and typed inputs and output; its decisions and their conditions; what it throws and awaits; the calls
// whose target wasn't found; and its writes to module state. The unit is the one the graph gives the place to, by the
// pass's own rules, so the inspector and the flow always describe the same node.
import { basename } from 'node:path';
import { FLOW_LIMITS } from '@flowcanvas/graph-model';
import type * as TS from 'typescript';
import {
  DETAIL_LIMITS,
  type DetailDecision,
  type DetailLine,
  type DetailList,
  type DetailParam,
  type NodeDetails,
} from '../protocol.js';
import { calleeText } from './callables.js';
import {
  nameOf,
  ownsItsCode,
  placeOf,
  projectPath,
  unitNodeAt,
  unitOf,
  walkFile,
  type GraphContext,
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

export function detailsAt(
  ctx: GraphContext,
  program: TS.Program,
  source: TS.SourceFile,
  offset: number,
): NodeDetails {
  const { ts } = ctx;
  const checker = program.getTypeChecker();
  const { node, id } = unitNodeAt(ctx, source, offset);
  const path = projectPath(ctx, source.fileName);
  const lineOf = (n: TS.Node) => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const text = (n: TS.Node) => cutDetail(n.getText(source)) || '…';

  const name = node === null ? `${basename(path)} (top level)` : nameOf(ts, node);
  const unit = node === null ? 'module' : (unitOf(ts, node, name) ?? 'function');
  const place = (node === null ? null : placeOf(ctx, node)) ?? { path, line: 1, column: 1 };

  // The signature, as the compiler sees it; a class's inputs are its constructor's.
  let signature: string | null = null;
  let returns: string | null = null;
  const params = gather<DetailParam>(DETAIL_LIMITS.params);
  let declared: readonly TS.ParameterDeclaration[] = [];
  if (node !== null && ts.isFunctionLike(node)) {
    declared = node.parameters;
    const found = checker.getSignatureFromDeclaration(node);
    if (found !== undefined) {
      signature = cutDetail(checker.signatureToString(found, node));
      returns = cutDetail(checker.typeToString(found.getReturnType(), node));
    }
  } else if (node !== null && ts.isClassLike(node)) {
    declared = node.members.find(ts.isConstructorDeclaration)?.parameters ?? [];
  }
  for (const param of declared) {
    params.add({
      name: text(param.name),
      type: cutDetail(checker.typeToString(checker.getTypeAtLocation(param), param)) || 'unknown',
      optional:
        param.questionToken !== undefined ||
        param.initializer !== undefined ||
        param.dotDotDotToken !== undefined,
    });
  }
  const async =
    node !== null &&
    ts.isFunctionLike(node) &&
    (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0;

  // Exported: among what its module exports (`export function`, `export const`, `export { name }`, a default).
  const declaration = node !== null && ts.isVariableDeclaration(node.parent) ? node.parent : node;
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const exported =
    declaration !== null &&
    moduleSymbol !== undefined &&
    checker.getExportsOfModule(moduleSymbol).some((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return target.declarations?.includes(declaration as TS.Declaration) === true;
    });

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
    if (n !== node && ownsItsCode(ctx, n)) return;
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
  for (const edge of walkFile(ctx, program, source).edges) {
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
