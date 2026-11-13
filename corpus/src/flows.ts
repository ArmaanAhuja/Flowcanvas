// Phase 7's Done when: flows for 10 functions render correctly and every node opens the right line. A flow from the
// engine is turned into short lines (each node with its file and line, each edge with its kind and outcome, each
// node's unknown calls, where it was cut), compared exactly with hand-written labels (labels/flows.json), written by
// reading the code. Shapes are structural, so the corpus package doesn't depend on the engine.
import { difference, type Difference } from './calls.js';

export interface FlowLike {
  readonly root: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly kind: string;
    readonly name: string;
    readonly place: { readonly path: string; readonly line: number } | null;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly kind: string;
    readonly label: string | null;
  }[];
  readonly unknown: readonly {
    readonly from: string;
    readonly total: number;
    readonly calls: readonly { readonly target: string; readonly label: string | null }[];
  }[];
  readonly cut: readonly { readonly from: string; readonly nodes: number }[];
}

export interface FlowLabel {
  readonly name: string;
  /** Why it was picked: what of a flow it exercises. */
  readonly case: string;
  /** Its name's place: where the flow is opened from. */
  readonly path: string;
  readonly line: number;
  readonly column: number;
  /** The flow, as `flowLines` writes it, by reading the code. */
  readonly lines: readonly string[];
}

const fileOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A node as the lines name it: a function by its name, a decision by its condition, with file and line. */
function keyOf(node: FlowLike['nodes'][number]): string {
  const at = node.place === null ? '?' : `${fileOf(node.place.path)}:${String(node.place.line)}`;
  return node.kind === 'decision' ? `if ${node.name} (${at})` : `${node.name} (${at})`;
}

/** The flow as lines, sorted: what's in it, never the order the engine happened to find it in. */
export function flowLines(flow: FlowLike): string[] {
  const keys = new Map(flow.nodes.map((node) => [node.id, keyOf(node)]));
  const key = (id: string) => keys.get(id) ?? `? ${id}`;
  return [
    ...flow.nodes.map((node) => `node ${keyOf(node)}`),
    ...flow.edges.map(
      (edge) =>
        `${edge.kind} ${key(edge.from)} -> ${key(edge.to)}${edge.label === null ? '' : ` [${edge.label}]`}`,
    ),
    ...flow.unknown.map(
      (group) =>
        `unknown from ${key(group.from)}: ${String(group.total)}: ${group.calls
          .map((call) => `${call.target}${call.label === null ? '' : ` [${call.label}]`}`)
          .sort()
          .join(', ')}`,
    ),
    ...flow.cut.map((cut) => `cut ${key(cut.from)}: ${String(cut.nodes)}`),
  ].sort();
}

/** The flow compared with its label, exactly, as multisets of lines. */
export function compareFlow(label: FlowLabel, flow: FlowLike): Difference {
  return difference([...label.lines].sort(), flowLines(flow));
}
