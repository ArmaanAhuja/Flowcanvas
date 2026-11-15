// Phases 9 to 11's bar (owner, 15 Nov 2026): the connectors held to hand labels (labels/connections.json). Every
// connector site in Rallly and Documenso, and in the same fixed modules of LibreChat and Twenty as phase 8: a read or
// write and its table, an outside service, a hand-off, a link to the app's API. 100% precision; at least 95% recall per
// fork; every miss explained. Shapes are structural, so the corpus package doesn't depend on the engine.

export type ConnectionKind = 'data' | 'service' | 'handoff' | 'link';
export const CONNECTION_KINDS: readonly ConnectionKind[] = ['data', 'service', 'handoff', 'link'];

export interface ConnectionLabel {
  /** Project-relative file, and the line the connection is drawn at (its method's). */
  readonly file: string;
  readonly line: number;
  readonly kind: ConnectionKind;
  /** What it reaches, as `connectionTo` writes it: `prisma polls write`, `email nodemailer`, `job:x`, a node's name. */
  readonly to: string;
  /** Set on a site the engine doesn't find (or finds incompletely): why, read in the code. */
  readonly missed?: string;
}

export interface ForkConnections {
  /** Files in scope: prefixes, or `*` for every file of the fork (tests aside). */
  readonly scope: readonly string[];
  readonly notes?: readonly string[];
  readonly sites: readonly ConnectionLabel[];
  /**
   * The *Done when*s' chains, read in the code: each node reachable from the one before it in the graph (phase 9: a
   * form's submit → its API's entry point → its handler; phase 10: writes and the email; phase 11: enqueue → queue →
   * worker → result).
   */
  readonly chains?: readonly ConnectionChain[];
}

export interface ConnectionChain {
  /** Which *Done when*, and what it shows. */
  readonly name: string;
  /** Node ids, in order. */
  readonly path: readonly string[];
}

interface GraphLike {
  readonly nodes: readonly {
    readonly id: string;
    readonly name: string;
    readonly data?: {
      readonly library: string;
      readonly table: string | null;
      readonly operation: string;
    };
    readonly service?: {
      readonly kind: string;
      readonly library: string;
      readonly url: string | null;
    };
    readonly handoff?: { readonly kind: string; readonly name: string | null };
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string | null;
    readonly kind?: string;
    readonly provenance: string;
    readonly lines: readonly number[];
  }[];
}

/** Test and story files: how the code is tested, not what it does (phase 8's rule). */
export const NOT_IN_SCOPE =
  /(^|\/)(__tests__|__mocks__|test|tests|e2e|playwright|cypress)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)ee\//;

export const inConnectionScope = (scope: readonly string[], file: string): boolean =>
  !NOT_IN_SCOPE.test(file) && scope.some((prefix) => prefix === '*' || file.startsWith(prefix));

/** What a node is, as a label writes it. */
export function connectionTo(node: GraphLike['nodes'][number]): string {
  if (node.data !== undefined) {
    return `${node.data.library} ${node.data.table ?? '?'} ${node.data.operation}`;
  }
  if (node.service !== undefined) {
    return `${node.service.kind} ${node.service.library}${node.service.url === null ? '' : ` ${node.service.url}`}`;
  }
  if (node.handoff !== undefined) {
    const key = node.id.slice('(handoff '.length, -1);
    return key.includes(' ') ? `${node.handoff.kind} ${node.handoff.name ?? '?'}` : key;
  }
  return node.name;
}

/**
 * The graph's connector sites in a scope: each data, boundary and hand-off edge, and each convention call from code
 * (a link to the app's API, or a mutation run through a hook), at each of its lines.
 */
export function connectionsOf(graph: GraphLike, scope: readonly string[]): ConnectionLabel[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const sites = new Map<string, ConnectionLabel>();
  for (const edge of graph.edges) {
    const hash = edge.from.indexOf('#');
    if (hash === -1 || edge.from.includes('#(entry ') || edge.to === null) continue;
    const file = edge.from.slice(0, hash);
    if (!inConnectionScope(scope, file)) continue;
    const kind: ConnectionKind | undefined =
      edge.kind === 'data'
        ? 'data'
        : edge.kind === 'boundary'
          ? 'service'
          : edge.kind === 'handoff'
            ? 'handoff'
            : (edge.kind ?? 'call') === 'call' && edge.provenance === 'convention'
              ? 'link'
              : undefined;
    const to = byId.get(edge.to);
    if (kind === undefined || to === undefined) continue;
    for (const line of edge.lines) {
      const site = { file, line, kind, to: connectionTo(to) };
      sites.set(keyOf(site), site);
    }
  }
  return [...sites.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

export const keyOf = (s: Pick<ConnectionLabel, 'file' | 'line' | 'kind' | 'to'>) =>
  `${s.file}:${String(s.line).padStart(5, '0')}:${s.kind}:${s.to}`;

export interface ConnectionResult {
  /** Per kind: labelled sites, found, and the misses (labelled ones the engine lacks, each with its reason). */
  readonly kinds: Readonly<
    Record<
      ConnectionKind,
      { readonly labelled: number; readonly found: number; readonly missed: readonly string[] }
    >
  >;
  /** Engine sites in scope that no label has: false finds (the bar allows none). */
  readonly falseFinds: readonly string[];
  /** Labelled as missed, yet found: the label is stale. */
  readonly nowFound: readonly string[];
  /** Missed with no reason: the bar requires one. */
  readonly unexplained: readonly string[];
}

export function compareConnections(labels: ForkConnections, graph: GraphLike): ConnectionResult {
  const found = new Set(connectionsOf(graph, labels.scope).map(keyOf));
  const labelled = new Set(labels.sites.map(keyOf));
  const kinds = Object.fromEntries(
    CONNECTION_KINDS.map((kind) => [kind, { labelled: 0, found: 0, missed: [] as string[] }]),
  ) as Record<ConnectionKind, { labelled: number; found: number; missed: string[] }>;
  const nowFound: string[] = [];
  const unexplained: string[] = [];
  for (const site of labels.sites) {
    const tally = kinds[site.kind];
    tally.labelled += 1;
    const key = keyOf(site);
    if (found.has(key)) {
      tally.found += 1;
      if (site.missed !== undefined) nowFound.push(key);
    } else {
      tally.missed.push(`${key}${site.missed === undefined ? '' : ` (${site.missed})`}`);
      if (site.missed === undefined) unexplained.push(key);
    }
  }
  const falseFinds = [...found].filter((key) => !labelled.has(key));
  return { kinds, falseFinds, nowFound, unexplained };
}

/** The bar's problems for one fork: none means it's met. */
export function connectionBarProblems(result: ConnectionResult): string[] {
  const problems: string[] = [];
  let labelled = 0;
  let found = 0;
  for (const kind of CONNECTION_KINDS) {
    labelled += result.kinds[kind].labelled;
    found += result.kinds[kind].found;
  }
  if (labelled > 0 && found / labelled < 0.95) {
    problems.push(`recall ${(100 * (found / labelled)).toFixed(1)}% is under 95%`);
  }
  for (const key of result.falseFinds) problems.push(`false find: ${key}`);
  for (const key of result.unexplained) problems.push(`missed without a reason: ${key}`);
  for (const key of result.nowFound) problems.push(`labelled as missed, but found: ${key}`);
  return problems;
}

/** Each chain's first unreachable step: none means every chain holds in the graph. */
export function chainProblems(labels: ForkConnections, graph: GraphLike): string[] {
  const out = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.to !== null) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
  }
  const ids = new Set(graph.nodes.map((n) => n.id));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const queue = [from];
    for (const id of queue) {
      if (id === to) return true;
      for (const next of out.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  const problems: string[] = [];
  for (const chain of labels.chains ?? []) {
    const missing = chain.path.find((id) => !ids.has(id));
    if (missing !== undefined) {
      problems.push(`${chain.name}: no node ${missing}`);
      continue;
    }
    for (let i = 1; i < chain.path.length; i += 1) {
      const from = chain.path[i - 1] ?? '';
      const to = chain.path[i] ?? '';
      if (!reaches(from, to)) {
        problems.push(`${chain.name}: ${to} isn’t reached from ${from}`);
        break;
      }
    }
  }
  return problems;
}
