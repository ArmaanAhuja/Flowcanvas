// A flow from the engine, laid out for the canvas (phase 7, ADR 0028 §4): ELK's layered layout, top to bottom as
// Figma 06 draws flows, with decisions as diamonds and the flow's honest ends (unknown calls, what wasn't shown) as
// stubs. Pure: the ELK it's given runs in a Web Worker in the page (never the UI thread) and in-thread in tests.
import type { FlowResult } from '@flowcanvas/engine/protocol';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { nodeHeight, type FlowNodeKind } from '@flowcanvas/ui';

type Flow = NonNullable<FlowResult['flow']>;
type Provenance = Flow['edges'][number]['provenance'];

/** The layout ELK runs: `elkjs`'s `ELK.layout`. */
export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}

export interface UnitData extends Record<string, unknown> {
  readonly title: string;
  readonly location: string;
  readonly kind: FlowNodeKind;
  /** The node's place, which "Open code" opens. */
  readonly place: { readonly path: string; readonly line: number; readonly column: number } | null;
  readonly id: string;
}
export interface DecisionData extends Record<string, unknown> {
  readonly condition: string;
  readonly id: string;
  /** Where its condition is. */
  readonly place: UnitData['place'];
}
export interface StubData extends Record<string, unknown> {
  readonly variant: 'unknown' | 'more';
  readonly count: number;
  /** The node it hangs off. */
  readonly from: string;
}
export interface FlowEdgeData extends Record<string, unknown> {
  readonly provenance: Provenance;
  /** The outcome, on a branch out of a decision. */
  readonly label: string | null;
  /** A `catch`'s outcome: drawn as a failure path (design brief, "Flow graph view"). */
  readonly failure: boolean;
  /** The edge to a stub: no arrow, as Graphite's open stub. */
  readonly stub: boolean;
  /** ELK's route around the nodes, start to end; drawn as it is (route.ts). Absent before layout. */
  readonly route?: readonly Point[];
}

export type LaidOutNode =
  | {
      readonly id: string;
      readonly type: 'flow';
      readonly position: Point;
      /** Its size as ELK placed it (as it renders, at most). */
      readonly size: Size;
      readonly data: UnitData;
    }
  | {
      readonly id: string;
      readonly type: 'decision';
      readonly position: Point;
      /** Its size as ELK placed it (as it renders, at most). */
      readonly size: Size;
      readonly data: DecisionData;
    }
  | {
      readonly id: string;
      readonly type: 'stub';
      readonly position: Point;
      /** Its size as ELK placed it (as it renders, at most). */
      readonly size: Size;
      readonly data: StubData;
    };
export interface LaidOutEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: 'flow';
  readonly data: FlowEdgeData;
}
interface Point {
  readonly x: number;
  readonly y: number;
}
interface Size {
  readonly width: number;
  readonly height: number;
}

/** Sizes ELK places by (px): a flow node (Graphite, 216 × 56), and estimates for a decision's and a stub's text. */
export const SIZES = {
  node: { width: 216, height: 56 },
  /** Mono small: about 6.6 px a character; a decision wraps to two lines within the node's width. */
  char: 6.6,
  decisionLine: 16,
  decisionChrome: { width: 46, height: 10 },
  stub: { height: 24, chrome: 40 },
} as const;

/** ELK's options: layered, downward, orthogonal edges, room for the outcome labels between layers. */
export const ELK_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '32',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
};

/**
 * Where a node is, as Figma's nodes write it: its folder and file, and the line (`team/get-team.ts:38`). The full path
 * is in the inspector; on the node it would wrap over three lines.
 */
export const shortPlace = (path: string, line: number) =>
  `${path.split('/').slice(-2).join('/')}:${String(line)}`;

const unitKind = (unit: Flow['nodes'][number]['unit']): FlowNodeKind =>
  unit === 'component' ? 'ui' : unit === 'module' ? 'file' : 'function';

const stubText = (variant: StubData['variant'], count: number) =>
  variant === 'unknown'
    ? `${String(count)} unknown calls`
    : `${String(count)} more calls not shown`;

export async function layoutFlow(
  flow: Flow,
  elk: ElkLike,
): Promise<{ readonly nodes: LaidOutNode[]; readonly edges: LaidOutEdge[] }> {
  const children: ElkNode[] = [];
  const nodes: Omit<LaidOutNode, 'position' | 'size'>[] = [];
  for (const node of flow.nodes) {
    if (node.kind === 'decision') {
      const textWidth = node.name.length * SIZES.char;
      const width = Math.min(SIZES.node.width, SIZES.decisionChrome.width + textWidth);
      const lines = textWidth > SIZES.node.width - SIZES.decisionChrome.width ? 2 : 1;
      children.push({
        id: node.id,
        width,
        height: SIZES.decisionChrome.height + lines * SIZES.decisionLine,
      });
      nodes.push({
        id: node.id,
        type: 'decision',
        data: { condition: node.name, id: node.id, place: node.place },
      });
    } else {
      const location = node.place === null ? '' : shortPlace(node.place.path, node.place.line);
      // Its height as it renders, wrapped (a long name takes two lines): ELK routes edges around what it's told.
      children.push({
        id: node.id,
        width: SIZES.node.width,
        height: nodeHeight(node.name, location),
      });
      nodes.push({
        id: node.id,
        type: 'flow',
        data: {
          title: node.name,
          location,
          kind: unitKind(node.unit),
          place: node.place,
          id: node.id,
        },
      });
    }
  }
  const edges: LaidOutEdge[] = flow.edges.map((edge, index) => ({
    id: `e${String(index)}`,
    source: edge.from,
    target: edge.to,
    type: 'flow',
    data: {
      provenance: edge.provenance,
      label: edge.label,
      failure: edge.label === 'error',
      stub: false,
    },
  }));
  // The open ends, each hanging off its node.
  const stubs = [
    ...flow.unknown.map((group) => ({
      from: group.from,
      variant: 'unknown' as const,
      count: group.total,
    })),
    ...flow.cut.map((cut) => ({ from: cut.from, variant: 'more' as const, count: cut.nodes })),
  ];
  for (const stub of stubs) {
    const id = `${stub.from}::${stub.variant}`;
    children.push({
      id,
      width: SIZES.stub.chrome + stubText(stub.variant, stub.count).length * SIZES.char,
      height: SIZES.stub.height,
    });
    nodes.push({ id, type: 'stub', data: stub });
    edges.push({
      id: `${id}:edge`,
      source: stub.from,
      target: id,
      type: 'flow',
      data: {
        provenance: stub.variant === 'unknown' ? 'unknown' : 'resolved',
        label: null,
        failure: false,
        stub: true,
      },
    });
  }
  const laid = await elk.layout({
    id: 'flow',
    layoutOptions: ELK_OPTIONS,
    children,
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  const placed = new Map((laid.children ?? []).map((child) => [child.id, child]));
  // Each edge's route, in the same coordinates as the nodes (the flow's own: no offset).
  const routes = new Map(
    (laid.edges ?? []).map((edge) => {
      const section = edge.sections?.[0];
      return [
        edge.id,
        section === undefined
          ? undefined
          : [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
      ] as const;
    }),
  );
  return {
    nodes: nodes.map((node) => {
      const at = placed.get(node.id);
      return {
        ...node,
        position: { x: at?.x ?? 0, y: at?.y ?? 0 },
        size: { width: at?.width ?? 0, height: at?.height ?? 0 },
      } as LaidOutNode;
    }),
    edges: edges.map((edge) => {
      const route = routes.get(edge.id);
      return route === undefined ? edge : { ...edge, data: { ...edge.data, route } };
    }),
  };
}
