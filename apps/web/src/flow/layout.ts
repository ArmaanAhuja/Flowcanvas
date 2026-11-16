// A flow from the engine, laid out for the canvas (phase 7, ADR 0028 §4; phase 12, ADR 0032):
// ELK's layered layout, top to bottom as Figma 06 draws flows, with decisions as diamonds, the flow's honest ends
// (unknown calls, what wasn't shown) as stubs, and semantic grouping for large flows (phase 12).
// Pure: the ELK it's given runs in a Web Worker in the page (never the UI thread) and in-thread in tests.
import type { FlowResult } from '@flowcanvas/engine/protocol';
import {
  MAX_FLOW_GROUPS,
  backgroundOf as modelBackgroundOf,
  semanticGrouping,
} from '@flowcanvas/graph-model';
import { nodeHeight, type FlowNodeKind } from '@flowcanvas/ui';
import type { ElkNode } from 'elkjs/lib/elk-api';

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
export interface GroupMemberItem {
  readonly id: string;
  readonly name: string;
  readonly location: string;
}
/** A group of the flow's nodes (phase 12): named from the code (its folder, or its kind), opened in place. */
export interface GroupData extends Record<string, unknown> {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly kind: FlowNodeKind;
  /** Open: a frame its members are drawn in, over the canvas; closed: a stacked card. */
  readonly expanded: boolean;
  /** Its members, in the flow's order, for the inspector. */
  readonly members: readonly GroupMemberItem[];
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
  readonly route?: readonly Point[] | undefined;
  /**
   * On a convention edge, the rule's framework or library, in words (Graphite: "Framework glyph (e.g. Prisma)"; the
   * design brief: "small framework badge").
   */
  readonly badge?: string | undefined;
  /** Work handed off (phase 11): the design brief's async hand-off arrow, with a clock. */
  readonly handoff?: boolean | undefined;
  /**
   * Known less surely than resolved (convention, suggested, unknown): what the completeness pill shows when it's
   * pressed. Observed is known surely too (phase 29).
   */
  readonly weak: boolean;
  /** The pill pressed: this edge stands out (a weak one), or recedes (true or false); unset when it isn't pressed. */
  readonly highlighted?: boolean | undefined;
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
      /** In an open group: over its frame. */
      readonly zIndex?: number;
      readonly data: UnitData;
    }
  | {
      readonly id: string;
      readonly type: 'decision';
      readonly position: Point;
      /** Its size as ELK placed it (as it renders, at most). */
      readonly size: Size;
      /** In an open group: over its frame. */
      readonly zIndex?: number;
      readonly data: DecisionData;
    }
  | {
      readonly id: string;
      readonly type: 'stub';
      readonly position: Point;
      /** Its size as ELK placed it (as it renders, at most). */
      readonly size: Size;
      /** In an open group: over its frame. */
      readonly zIndex?: number;
      readonly data: StubData;
    }
  | {
      readonly id: string;
      readonly type: 'group';
      readonly position: Point;
      readonly size: Size;
      /** React Flow's own size for it (an open group's frame is larger than its card). */
      readonly width: number;
      readonly height: number;
      /** An open group's frame and members are drawn over the rest (nothing else moves). */
      readonly zIndex: number;
      readonly data: GroupData;
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
  /** Into, out of or inside an open group: drawn over its frame. */
  readonly zIndex?: number;
}
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface LayoutOptions {
  /** Group the flow (phase 12): by default when it has `GROUP_THRESHOLD` nodes or more. */
  readonly group?: boolean | undefined;
  /** At most this many groups (default 8: the plan's Done when). */
  readonly maxGroups?: number | undefined;
  /** The groups opened. Opening one never moves anything else (design brief: "pushes nothing else around"). */
  readonly expandedGroups?: ReadonlySet<string> | undefined;
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
 * hand-off itself stays where the work is handed off. The graph model's, so grouping and the lane agree.
 */
export const backgroundOf = (flow: Flow): Set<string> => modelBackgroundOf(flow);

/** Each kind of node before ELK places it (Omit over each member of the union, not their common fields). */
type Unplaced = LaidOutNode extends infer N
  ? N extends LaidOutNode
    ? Omit<N, 'position' | 'size'>
    : never
  : never;

interface Part {
  readonly children: ElkNode[];
  readonly nodes: Unplaced[];
  readonly edges: LaidOutEdge[];
}
const newPart = (): Part => ({ children: [], nodes: [], edges: [] });

async function layoutPart(part: Part, elk: ElkLike, dx: number, dy: number) {
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
  // Each edge's route, in the same coordinates as the nodes.
  const routes = new Map(
    (laid.edges ?? []).map((edge) => {
      const section = edge.sections?.[0];
      return [
        edge.id,
        section === undefined
          ? undefined
          : [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
              x: p.x + dx,
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
        position: { x: (at?.x ?? 0) + dx, y: (at?.y ?? 0) + dy },
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

/** A flow node into a part: a decision as a diamond sized by its condition, anything else as a card. */
function addNode(part: Part, node: Flow['nodes'][number]) {
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
    return;
  }
  const { kind, location } = cardOf(node);
  part.children.push({
    id: node.id,
    width: SIZES.node.width,
    height: nodeHeight(node.name, location),
  });
  part.nodes.push({
    id: node.id,
    type: 'flow',
    data: { title: node.name, location, kind, place: node.place, id: node.id },
  });
}

/** A stub (unknown calls, or what isn't shown) hanging off `from`, with its edge. */
function addStub(part: Part, from: string, variant: StubData['variant'], count: number) {
  const id = `${from}::${variant}`;
  part.children.push({
    id,
    width: SIZES.stub.chrome + stubText(variant, count).length * SIZES.char,
    height: SIZES.stub.height,
  });
  part.nodes.push({ id, type: 'stub', data: { variant, count, from } });
  part.edges.push({
    id: `${id}:edge`,
    source: from,
    target: id,
    type: 'flow',
    data: {
      provenance: variant === 'unknown' ? 'unknown' : 'resolved',
      label: null,
      failure: false,
      stub: true,
      weak: variant === 'unknown',
    },
  });
}

/** Weakest first: an edge standing for several says how surely its weakest is known. */
const STRENGTH: readonly Provenance[] = [
  'unknown',
  'suggested',
  'convention',
  'resolved',
  'observed',
];
const isWeak = (provenance: Provenance) =>
  STRENGTH.indexOf(provenance) < STRENGTH.indexOf('resolved');

/** The edges between two shown things, each pair once: one flow edge as it is, several as their weakest. */
function edgesBetween(
  flow: Flow,
  endOf: (id: string) => string,
): Map<string, { source: string; target: string; edges: Flow['edges'][number][] }> {
  const pairs = new Map<
    string,
    { source: string; target: string; edges: Flow['edges'][number][] }
  >();
  for (const edge of flow.edges) {
    const source = endOf(edge.from);
    const target = endOf(edge.to);
    if (source === target) continue;
    const key = `${source}\u0000${target}`;
    const pair = pairs.get(key) ?? { source, target, edges: [] };
    pair.edges.push(edge);
    pairs.set(key, pair);
  }
  return pairs;
}

function laidEdge(
  flow: Flow,
  id: string,
  pair: { source: string; target: string; edges: Flow['edges'][number][] },
): LaidOutEdge {
  const [first] = pair.edges;
  const one = pair.edges.length === 1 && first !== undefined ? first : null;
  const provenance =
    one?.provenance ??
    pair.edges
      .map((e) => e.provenance)
      .sort((a, b) => STRENGTH.indexOf(a) - STRENGTH.indexOf(b))[0] ??
    'unknown';
  const badge = one === null ? undefined : badgeOf(flow, one);
  return {
    id,
    source: pair.source,
    target: pair.target,
    type: 'flow',
    data: {
      provenance,
      // An outcome or a framework is said only of one edge: a group's edge stands for several.
      label: one?.label ?? null,
      failure: one?.label === 'error',
      stub: false,
      ...(badge === undefined ? {} : { badge }),
      ...(pair.edges.some((e) => e.kind === 'handoff') ? { handoff: true } : {}),
      weak: isWeak(provenance),
    },
  };
}

/** The background lane's frame, around what's laid out below the main lane. */
function laneNode(top: number, below: { width: number; height: number }): LaidOutNode {
  const size = {
    width: below.width + 2 * LANE.padding,
    height: below.height + LANE.header + 2 * LANE.padding,
  };
  return {
    id: 'lane:background',
    type: 'lane',
    position: { x: -LANE.padding, y: top },
    size,
    width: size.width,
    height: size.height,
    zIndex: -1,
    selectable: false,
    draggable: false,
    focusable: false,
    data: { label: 'Background' },
  };
}

/** Flows this large are grouped (phase 12). */
export const GROUP_THRESHOLD = 25;
/** An open group's frame: padding around its members, and room for its header (its card's height). */
export const GROUP_FRAME = { padding: 16, header: 56 } as const;
/** Drawn over the canvas: an open group's frame, then its members and their edges. */
const Z = { frame: 10, member: 11 } as const;

export async function layoutFlow(
  flow: Flow,
  elk: ElkLike,
  options?: LayoutOptions,
): Promise<{ readonly nodes: LaidOutNode[]; readonly edges: LaidOutEdge[] }> {
  const grouped = options?.group ?? flow.nodes.length >= GROUP_THRESHOLD;
  if (grouped) return layoutGrouped(flow, elk, options);

  const background = backgroundOf(flow);
  const main = newPart();
  const back = newPart();
  const partOf = (id: string) => (background.has(id) ? back : main);
  for (const node of flow.nodes) addNode(partOf(node.id), node);
  const crossing: LaidOutEdge[] = [];
  let index = 0;
  for (const pair of edgesBetween(flow, (id) => id).values()) {
    const laid = laidEdge(flow, `e${String(index++)}`, pair);
    if (partOf(pair.source) === partOf(pair.target)) partOf(pair.source).edges.push(laid);
    else crossing.push(laid);
  }
  for (const group of flow.unknown) addStub(partOf(group.from), group.from, 'unknown', group.total);
  for (const cut of flow.cut) addStub(partOf(cut.from), cut.from, 'more', cut.nodes);

  const top = await layoutPart(main, elk, 0, 0);
  if (back.nodes.length === 0) return { nodes: top.nodes, edges: [...top.edges, ...crossing] };
  const laneTop = top.height + LANE.gap;
  const below = await layoutPart(back, elk, 0, laneTop + LANE.header + LANE.padding);
  return {
    nodes: [laneNode(laneTop, below), ...top.nodes, ...below.nodes],
    edges: [...top.edges, ...below.edges, ...crossing],
  };
}

/**
 * A grouped flow (phase 12, ADR 0032). The base layout is the flow with every group closed, laid out from the flow
 * alone, so it's the same whatever is open: opening a group never moves anything else. An open group's members are
 * laid out on their own and drawn in a frame at its card's place, over the canvas; edges into it are drawn to its
 * members as they're placed (not ELK's routes, which are for the closed card).
 */
async function layoutGrouped(
  flow: Flow,
  elk: ElkLike,
  options?: LayoutOptions,
): Promise<{ readonly nodes: LaidOutNode[]; readonly edges: LaidOutEdge[] }> {
  const grouping = semanticGrouping(flow, { maxGroups: options?.maxGroups ?? MAX_FLOW_GROUPS });
  const open = new Set(
    [...(options?.expandedGroups ?? [])].filter((id) => grouping.groups.some((g) => g.id === id)),
  );
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const background = backgroundOf(flow);
  const shown = (id: string) => grouping.nodeToGroup.get(id) ?? id;

  // The base: the root, nodes on their own, closed groups, and stubs by what they hang off.
  const main = newPart();
  const back = newPart();
  const partOf = (id: string) => {
    const group = grouping.groups.find((g) => g.id === id);
    return (group?.lane ?? (background.has(id) ? 'background' : 'main')) === 'background'
      ? back
      : main;
  };
  for (const id of grouping.standaloneNodeIds) {
    const node = byId.get(id);
    if (node !== undefined) addNode(partOf(id), node);
  }
  for (const group of grouping.groups) {
    const part = partOf(group.id);
    part.children.push({ id: group.id, width: SIZES.node.width, height: SIZES.node.height });
    part.nodes.push({
      id: group.id,
      type: 'group',
      width: SIZES.node.width,
      height: SIZES.node.height,
      zIndex: 0,
      data: {
        id: group.id,
        title: group.title,
        count: group.count,
        kind: group.kind,
        expanded: false,
        members: group.nodeIds.map((member) => {
          const node = byId.get(member);
          return {
            id: member,
            name: node?.name ?? member,
            location: node === undefined ? '' : cardOf(node).location,
          };
        }),
      },
    });
  }
  const stubs = new Map<string, { from: string; variant: StubData['variant']; count: number }>();
  const addTo = (from: string, variant: StubData['variant'], count: number) => {
    const key = `${shown(from)}::${variant}`;
    const known = stubs.get(key);
    stubs.set(key, { from: shown(from), variant, count: (known?.count ?? 0) + count });
  };
  for (const group of flow.unknown) addTo(group.from, 'unknown', group.total);
  for (const cut of flow.cut) addTo(cut.from, 'more', cut.nodes);
  for (const stub of stubs.values())
    addStub(partOf(stub.from), stub.from, stub.variant, stub.count);
  const crossing: LaidOutEdge[] = [];
  let index = 0;
  for (const pair of edgesBetween(flow, shown).values()) {
    const laid = laidEdge(flow, `e${String(index++)}`, pair);
    if (partOf(pair.source) === partOf(pair.target)) partOf(pair.source).edges.push(laid);
    else crossing.push(laid);
  }
  const top = await layoutPart(main, elk, 0, 0);
  const laneTop = top.height + LANE.gap;
  const below =
    back.nodes.length > 0
      ? await layoutPart(back, elk, 0, laneTop + LANE.header + LANE.padding)
      : null;
  const base = below === null ? top.nodes : [...top.nodes, ...below.nodes];
  const baseEdges =
    below === null ? [...top.edges, ...crossing] : [...top.edges, ...below.edges, ...crossing];
  if (open.size === 0) {
    return { nodes: below === null ? base : [laneNode(laneTop, below), ...base], edges: baseEdges };
  }

  // Open groups: each a frame at its card's place, its members laid out inside.
  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  for (const node of base) {
    if (node.type !== 'group' || !open.has(node.id)) {
      // An open group's stubs are its members' now.
      if (!(node.type === 'stub' && open.has(node.data.from))) nodes.push(node);
      continue;
    }
    const group = grouping.groups.find((g) => g.id === node.id);
    if (group === undefined) continue;
    const inside = newPart();
    const members = new Set(group.nodeIds);
    for (const member of group.nodeIds) {
      const flowNode = byId.get(member);
      if (flowNode !== undefined) addNode(inside, flowNode);
    }
    let inner = 0;
    for (const pair of edgesBetween(flow, (id) => id).values()) {
      if (members.has(pair.source) && members.has(pair.target)) {
        inside.edges.push(laidEdge(flow, `${group.id}:e${String(inner++)}`, pair));
      }
    }
    for (const unknown of flow.unknown) {
      if (members.has(unknown.from)) addStub(inside, unknown.from, 'unknown', unknown.total);
    }
    for (const cut of flow.cut)
      if (members.has(cut.from)) addStub(inside, cut.from, 'more', cut.nodes);
    const sub = await layoutPart(
      inside,
      elk,
      node.position.x + GROUP_FRAME.padding,
      node.position.y + GROUP_FRAME.header + GROUP_FRAME.padding,
    );
    const size = {
      width: Math.max(SIZES.node.width, sub.width + 2 * GROUP_FRAME.padding),
      height: sub.height + GROUP_FRAME.header + 2 * GROUP_FRAME.padding,
    };
    nodes.push({
      ...node,
      size,
      width: size.width,
      height: size.height,
      zIndex: Z.frame,
      data: { ...node.data, expanded: true },
    });
    for (const member of sub.nodes) nodes.push({ ...member, zIndex: Z.member } as LaidOutNode);
    for (const edge of sub.edges) edges.push({ ...edge, zIndex: Z.member });
  }
  // Edges: the base's between closed things as ELK routed them; any touching an open group, to its members as placed.
  const touchesOpen = (id: string) => open.has(id) || open.has(id.slice(0, id.lastIndexOf('::')));
  for (const edge of baseEdges) {
    if (
      edge.data.stub ? !touchesOpen(edge.source) : !open.has(edge.source) && !open.has(edge.target)
    ) {
      edges.push(edge);
    }
  }
  const end = (id: string) => {
    const group = grouping.nodeToGroup.get(id);
    return group !== undefined && open.has(group) ? id : shown(id);
  };
  let outer = 0;
  for (const pair of edgesBetween(flow, end).values()) {
    const sourceGroup = grouping.nodeToGroup.get(pair.source);
    const targetGroup = grouping.nodeToGroup.get(pair.target);
    const sourceOpen =
      pair.source !== shown(pair.source) && sourceGroup !== undefined && open.has(sourceGroup);
    const targetOpen =
      pair.target !== shown(pair.target) && targetGroup !== undefined && open.has(targetGroup);
    if (!sourceOpen && !targetOpen) continue;
    if (sourceOpen && targetOpen && sourceGroup === targetGroup) continue;
    edges.push({ ...laidEdge(flow, `open:e${String(outer++)}`, pair), zIndex: Z.member });
  }
  return { nodes: below === null ? nodes : [laneNode(laneTop, below), ...nodes], edges };
}
