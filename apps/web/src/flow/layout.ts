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
  /**
   * On a convention edge, the rule's framework or library, in words (Graphite: "Framework glyph (e.g. Prisma)"; the
   * design brief: "small framework badge").
   */
  readonly badge?: string;
  /** Work handed off (phase 11): the design brief's async hand-off arrow, with a clock. */
  readonly handoff?: boolean;
}
export interface LaneData extends Record<string, unknown> {
  /** "Background": where handed-off work runs (build plan phase 11). */
  readonly label: string;
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
    }
  | {
      readonly id: string;
      readonly type: 'lane';
      readonly position: Point;
      readonly size: Size;
      /** React Flow's own size for it, and behind everything: a frame, never selected, moved or focused. */
      readonly width: number;
      readonly height: number;
      readonly zIndex: number;
      readonly selectable: false;
      readonly draggable: false;
      readonly focusable: false;
      readonly data: LaneData;
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

const LIBRARIES: Readonly<Record<string, string>> = {
  prisma: 'Prisma',
  kysely: 'Kysely',
  sql: 'SQL',
  mongoose: 'Mongoose',
  typeorm: 'TypeORM',
};

/**
 * A node as its card shows it: Graphite's kind (its icon), and the line under its name: where a code unit is, or what
 * a table, a service or a hand-off is (phases 9 to 11). What isn't fully detected says so; the inspector says why.
 */
export function cardOf(node: Flow['nodes'][number]): { kind: FlowNodeKind; location: string } {
  const place = node.place === null ? '' : shortPlace(node.place.path, node.place.line);
  const partly = (complete: boolean) => (complete ? '' : ' · not fully detected');
  if (node.data !== undefined) {
    return {
      kind: 'data',
      location: `${node.data.operation} · ${LIBRARIES[node.data.library] ?? node.data.library}${partly(node.data.complete)}`,
    };
  }
  if (node.service !== undefined) {
    return {
      kind: node.service.kind === 'ai' ? 'ai' : 'external',
      location: `${node.service.url ?? node.service.library}${partly(node.service.complete)}`,
    };
  }
  if (node.handoff !== undefined) {
    return {
      kind: 'queue',
      location: `${node.handoff.kind} · ${node.handoff.library}${partly(node.handoff.complete)}`,
    };
  }
  if (node.entry !== undefined) {
    return {
      kind:
        node.entry.kind === 'api-route'
          ? 'route'
          : node.entry.kind === 'cli-command'
            ? 'function'
            : node.entry.kind === 'job' || node.entry.kind === 'cron' || node.entry.kind === 'event'
              ? 'queue'
              : 'ui',
      location: place,
    };
  }
  return { kind: unitKind(node.unit), location: place };
}

const stubText = (variant: StubData['variant'], count: number) =>
  variant === 'unknown'
    ? `${String(count)} unknown calls`
    : `${String(count)} more calls not shown`;

/** The background lane's frame: padding around its nodes, room for its label, and the gap above it. */
export const LANE = { padding: 24, header: 28, gap: 48 } as const;

const FRAMEWORKS: Readonly<Record<string, string>> = {
  trpc: 'tRPC',
  next: 'Next.js',
  express: 'Express',
  hono: 'Hono',
  graphql: 'GraphQL',
  nestjs: 'NestJS',
  react: 'React',
  'react-router': 'React Router',
  'package-json': 'package.json',
};

/** A convention edge's badge: the framework or library whose rule matched it, from what it reaches or comes from. */
function badgeOf(flow: Flow, edge: Flow['edges'][number]): string | undefined {
  if (edge.provenance !== 'convention') return undefined;
  const to = flow.nodes.find((n) => n.id === edge.to);
  const from = flow.nodes.find((n) => n.id === edge.from);
  if (to?.data !== undefined) return LIBRARIES[to.data.library] ?? to.data.library;
  if (to?.service !== undefined) return to.service.library;
  if (to?.handoff !== undefined) return to.handoff.library;
  if (from?.handoff !== undefined) return from.handoff.library;
  const entry = to?.entry ?? from?.entry;
  return entry === undefined ? undefined : (FRAMEWORKS[entry.framework] ?? entry.framework);
}

/**
 * What runs in the background (phase 11): what a hand-off leads to that the flow doesn't reach any other way. The
 * hand-off itself stays where the work is handed off.
 */
export function backgroundOf(flow: Flow): Set<string> {
  const out = new Map<string, string[]>();
  const handoffs = new Set(flow.nodes.filter((n) => n.kind === 'async-handoff').map((n) => n.id));
  for (const edge of flow.edges) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
  const reach = (starts: readonly string[], through: (id: string) => boolean) => {
    const seen = new Set<string>(starts);
    const queue = [...starts];
    for (const id of queue) {
      if (!through(id)) continue;
      for (const next of out.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  // Reached without passing through a hand-off: the main lane.
  const main = reach([flow.root], (id) => !handoffs.has(id));
  const handed = [...handoffs].flatMap((id) => out.get(id) ?? []).filter((id) => !main.has(id));
  return new Set([...reach(handed, () => true)].filter((id) => !main.has(id)));
}

interface Part {
  readonly children: ElkNode[];
  readonly nodes: Omit<LaidOutNode, 'position' | 'size'>[];
  readonly edges: LaidOutEdge[];
}

async function layoutPart(part: Part, elk: ElkLike, dy: number) {
  const laid = await elk.layout({
    id: 'flow',
    layoutOptions: ELK_OPTIONS,
    children: part.children,
    edges: part.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
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
          : [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
              x: p.x,
              y: p.y + dy,
            })),
      ] as const;
    }),
  );
  return {
    nodes: part.nodes.map((node) => {
      const at = placed.get(node.id);
      return {
        ...node,
        position: { x: at?.x ?? 0, y: (at?.y ?? 0) + dy },
        size: { width: at?.width ?? 0, height: at?.height ?? 0 },
      } as LaidOutNode;
    }),
    edges: part.edges.map((edge) => {
      const route = routes.get(edge.id);
      return route === undefined ? edge : { ...edge, data: { ...edge.data, route } };
    }),
    height: laid.height ?? 0,
    width: laid.width ?? 0,
  };
}

export async function layoutFlow(
  flow: Flow,
  elk: ElkLike,
): Promise<{ readonly nodes: LaidOutNode[]; readonly edges: LaidOutEdge[] }> {
  const background = backgroundOf(flow);
  const main: Part = { children: [], nodes: [], edges: [] };
  const back: Part = { children: [], nodes: [], edges: [] };
  const partOf = (id: string) => (background.has(id) ? back : main);
  for (const node of flow.nodes) {
    const part = partOf(node.id);
    if (node.kind === 'decision') {
      const textWidth = node.name.length * SIZES.char;
      const width = Math.min(SIZES.node.width, SIZES.decisionChrome.width + textWidth);
      const lines = textWidth > SIZES.node.width - SIZES.decisionChrome.width ? 2 : 1;
      part.children.push({
        id: node.id,
        width,
        height: SIZES.decisionChrome.height + lines * SIZES.decisionLine,
      });
      part.nodes.push({
        id: node.id,
        type: 'decision',
        data: { condition: node.name, id: node.id, place: node.place },
      });
    } else {
      const { kind, location } = cardOf(node);
      // Its height as it renders, wrapped (a long name takes two lines): ELK routes edges around what it's told.
      part.children.push({
        id: node.id,
        width: SIZES.node.width,
        height: nodeHeight(node.name, location),
      });
      part.nodes.push({
        id: node.id,
        type: 'flow',
        data: {
          title: node.name,
          location,
          kind,
          place: node.place,
          id: node.id,
        },
      });
    }
  }
  // Edges within a lane are laid out with it; those crossing into the background (hand-offs) are drawn between them.
  const crossing: LaidOutEdge[] = [];
  flow.edges.forEach((edge, index) => {
    const badge = badgeOf(flow, edge);
    const laid: LaidOutEdge = {
      id: `e${String(index)}`,
      source: edge.from,
      target: edge.to,
      type: 'flow',
      data: {
        provenance: edge.provenance,
        label: edge.label,
        failure: edge.label === 'error',
        stub: false,
        ...(badge === undefined ? {} : { badge }),
        ...(edge.kind === 'handoff' ? { handoff: true } : {}),
      },
    };
    if (partOf(edge.from) === partOf(edge.to)) partOf(edge.from).edges.push(laid);
    else crossing.push(laid);
  });
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
    const part = partOf(stub.from);
    part.children.push({
      id,
      width: SIZES.stub.chrome + stubText(stub.variant, stub.count).length * SIZES.char,
      height: SIZES.stub.height,
    });
    part.nodes.push({ id, type: 'stub', data: stub });
    part.edges.push({
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
  const top = await layoutPart(main, elk, 0);
  if (back.nodes.length === 0) return { nodes: top.nodes, edges: [...top.edges, ...crossing] };
  // The background lane below the main flow, framed and labelled.
  const laneTop = top.height + LANE.gap;
  const below = await layoutPart(back, elk, laneTop + LANE.header + LANE.padding);
  const size = {
    width: below.width + 2 * LANE.padding,
    height: below.height + LANE.header + 2 * LANE.padding,
  };
  const lane: LaidOutNode = {
    id: 'lane:background',
    type: 'lane',
    position: { x: -LANE.padding, y: laneTop },
    size,
    width: size.width,
    height: size.height,
    zIndex: -1,
    selectable: false,
    draggable: false,
    focusable: false,
    data: { label: 'Background' },
  };
  return {
    nodes: [lane, ...top.nodes, ...below.nodes],
    edges: [...top.edges, ...below.edges, ...crossing],
  };
}
