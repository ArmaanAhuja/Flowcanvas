// The connectors in the graph pass (phases 9 to 11, ADR 0031): what a call reaches when it isn't the project's code (a
// table, an outside service, work handed off, the app's own API), as nodes and edges; and the two halves that need
// every file to join (a link to its API's entry point, a hand-off to what takes it).
import {
  dataOf,
  handoffOf,
  linkOf,
  linksWithin,
  mutationFunction,
  receiversOf,
  serviceOf,
  socketOf,
  taggedDataOf,
  type FileContext,
  type FoundData,
  type FoundHandoff,
  type FoundService,
  type LinkProtocol,
} from '@flowcanvas/connectors-web';
import type { GraphEdge, GraphNode } from '@flowcanvas/graph-model';
import type * as TS from 'typescript';
import { cut, findNode } from './callables.js';
import {
  namedUnitId,
  projectPath,
  unitIdOf,
  unitNodeAt,
  type GraphContext,
  type HandlerUnit,
} from './graph-pass.js';

/** A call's link to the app's API, joined after the pass (it replaces the call's unknown edge when it's found). */
export interface PendingLink {
  readonly from: string;
  /** The unknown edge's text it replaces (at `line`); null beside a resolved call (a wrapper), replacing nothing. */
  readonly target: string | null;
  readonly line: number;
  /** Its own line: the method's (`request.post`), where the joined edge is drawn. */
  readonly at: number;
  readonly protocol: LinkProtocol;
  readonly keys: readonly string[];
}

/** What takes handed-off work in a file: its key, and the unit that handles it. */
export interface PendingReceiver {
  readonly key: string;
  readonly to: string;
}

/** A file's halves to join (held with its part of the graph). */
export interface FileConnections {
  readonly links: readonly PendingLink[];
  readonly receivers: readonly PendingReceiver[];
}

export const NO_CONNECTIONS: FileConnections = { links: [], receivers: [] };

/** Bundled or minified output (a line this long): built code, not the project's own; the connectors skip it. */
export const BUNDLED_LINE = 10_000;

/** Whether a file is bundled output: any line longer than `BUNDLED_LINE` (Twenty's 1 MB seed bundle took 418 s). */
export function isBundled(text: string): boolean {
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf('\n', start);
    const stop = end === -1 ? text.length : end;
    if (stop - start > BUNDLED_LINE) return true;
    start = stop + 1;
  }
  return false;
}

/** What a call reaches, as the walk adds it: a node, and the kind of edge to it. */
export interface Reached {
  readonly node: GraphNode;
  readonly edge: GraphEdge['kind'];
  /** For a timer: the unit it runs, when that's a named one of the project's. */
  readonly runs?: string;
}

const table = (data: FoundData) => data.table ?? '?';

function dataNode(data: FoundData): GraphNode {
  return {
    id: `(data ${data.library} ${table(data)} ${data.operation})`,
    kind: 'data-access',
    name: data.table ?? `${data.library} ${data.operation}`,
    place: null,
    unit: null,
    change: 'unchanged',
    data: {
      library: data.library,
      table: data.table,
      operation: data.operation,
      complete: data.complete,
      why: data.why ?? null,
    },
  };
}

const SERVICE_NAMES = {
  email: 'Email',
  payments: 'Payments',
  storage: 'Storage',
  ai: 'AI',
  http: 'HTTP',
} as const;

function serviceNode(service: FoundService): GraphNode {
  const name =
    service.kind === 'http'
      ? (/^https?:\/\/([^/?#]+)/i.exec(service.url ?? '')?.[1] ?? 'HTTP')
      : `${SERVICE_NAMES[service.kind]} · ${service.library}`;
  return {
    id: `(service ${service.kind} ${service.library}${service.url === null ? '' : ` ${service.url}`})`,
    kind: 'external-boundary',
    name: cut(name),
    place: null,
    unit: null,
    change: 'unchanged',
    service: {
      kind: service.kind,
      library: service.library,
      url: service.url,
      complete: service.complete,
      why: service.why ?? null,
    },
  };
}

function handoffNode(handoff: FoundHandoff, path: string, line: number): GraphNode {
  return {
    // Keyed hand-offs are one node wherever they're handed off from; the rest, one per place.
    id: `(handoff ${handoff.key ?? `${handoff.kind} ${path}:${String(line)}`})`,
    kind: 'async-handoff',
    name: cut(handoff.name ?? handoff.kind),
    place: null,
    unit: null,
    change: 'unchanged',
    handoff: {
      kind: handoff.kind,
      library: handoff.library,
      name: handoff.name,
      complete: handoff.complete,
      why: handoff.why ?? null,
    },
  };
}

/** The walk's view of the connectors for one file: what each call reaches, and the links it records. */
export class FileConnector {
  readonly links: PendingLink[] = [];
  readonly #context: FileContext;
  readonly #ctx: GraphContext;
  readonly #tables: ReadonlyMap<string, string>;
  readonly #path: string;
  /** Bundled output: nothing is asked of the connectors in it, so its calls stay what they were. */
  readonly #bundled: boolean;

  constructor(
    ctx: GraphContext,
    program: TS.Program,
    source: TS.SourceFile,
    tables: ReadonlyMap<string, string>,
  ) {
    this.#ctx = ctx;
    this.#context = { ts: ctx.ts, source, checker: program.getTypeChecker() };
    this.#tables = tables;
    this.#path = projectPath(ctx, source.fileName);
    this.#bundled = isBundled(source.text);
  }

  /** Whether a call is a connection: something it reaches, or a link with a key. */
  claims(node: TS.CallExpression | TS.NewExpression): boolean {
    if (this.#bundled) return false;
    const ts = this.#ctx.ts;
    if (this.reached(node, 0) !== null) return true;
    if (!ts.isCallExpression(node)) return false;
    const found = linkOf(this.#context, node);
    return found !== null && found.keys.length > 0;
  }

  /** For a call that isn't the project's own code: what it reaches, or null. */
  reached(node: TS.CallExpression | TS.NewExpression, line: number): Reached | null {
    if (this.#bundled) return null;
    const ts = this.#ctx.ts;
    if (ts.isNewExpression(node)) {
      const socket = socketOf(this.#context, node);
      return socket === null
        ? null
        : { node: handoffNode(socket, this.#path, line), edge: 'handoff' };
    }
    const data = dataOf(this.#context, node, this.#tables);
    if (data !== null) return { node: dataNode(data), edge: 'data' };
    const service = serviceOf(this.#context, node);
    if (service !== null) return { node: serviceNode(service), edge: 'boundary' };
    const handoff = handoffOf(this.#context, node);
    if (handoff !== null) {
      const runs = handoff.runs === undefined ? undefined : this.#runs(handoff.runs);
      return {
        node: handoffNode(handoff, this.#path, line),
        edge: 'handoff',
        ...(runs === undefined ? {} : { runs }),
      };
    }
    return null;
  }

  /** For a call into the project's own code: work it hands off as well (`jobs.triggerJob(…)`), or null. */
  alongside(node: TS.CallExpression, line: number): Reached | null {
    if (this.#bundled) return null;
    const handoff = handoffOf(this.#context, node);
    return handoff === null || handoff.kind === 'timer'
      ? null
      : { node: handoffNode(handoff, this.#path, line), edge: 'handoff' };
  }

  /** A tagged template of raw SQL. */
  reachedByTemplate(node: TS.TaggedTemplateExpression): Reached | null {
    if (this.#bundled) return null;
    const data = taggedDataOf(this.#context, node);
    return data === null ? null : { node: dataNode(data), edge: 'data' };
  }

  /** A call to the app's own API: recorded, to join once every file's entry points are known. */
  link(
    node: TS.CallExpression,
    from: string,
    target: string | null,
    line: number,
    at: number,
  ): void {
    if (this.#bundled) return;
    const { ts } = this.#ctx;
    const found = linkOf(this.#context, node);
    if (found !== null && found.keys.length > 0) {
      this.links.push({ from, target, line, at, protocol: found.protocol, keys: found.keys });
      return;
    }
    // Beside a resolved call, only a link of its own (a wrapper's): not what an inline mutation makes.
    if (target === null) return;
    // `mutation.mutate(…)` on a mutation whose function is written inline: the links that function makes.
    const fn = mutationFunction(this.#context, node);
    if (fn === null || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return;
    for (const inner of linksWithin(this.#context, fn)) {
      this.links.push({ from, target, line, at, protocol: inner.protocol, keys: inner.keys });
    }
  }

  /**
   * The project's function a call runs through a hook (`mutation.mutate(…)` on `useMutation(mutationOptions(action))`):
   * its declaration, for the walk to reach as it reaches a resolved call.
   */
  through(node: TS.CallExpression): TS.Declaration | undefined {
    if (this.#bundled) return undefined;
    const { ts } = this.#ctx;
    const checker = this.#context.checker;
    const fn = mutationFunction(this.#context, node);
    if (fn === null || checker === undefined) return undefined;
    // Written right there (`mutationFn: async (data) => …`): no unit to reach; its calls are already its holder's.
    if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) return undefined;
    const at = ts.isPropertyAccessExpression(fn) ? fn.name : fn;
    let symbol = checker.getSymbolAtLocation(at);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const declaration = symbol?.valueDeclaration;
    return declaration !== undefined && this.#ctx.inProject(declaration.getSourceFile().fileName)
      ? declaration
      : undefined;
  }

  /** A timer's function, when it's a named unit of the project's. */
  #runs(expression: TS.Expression): string | undefined {
    const { ts } = this.#ctx;
    const checker = this.#context.checker;
    if (checker === undefined) return undefined;
    const at = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
    if (!ts.isIdentifier(at)) return undefined;
    let symbol = checker.getSymbolAtLocation(at);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const declaration = symbol?.valueDeclaration;
    if (declaration === undefined || !this.#ctx.inProject(declaration.getSourceFile().fileName)) {
      return undefined;
    }
    return unitIdOf(this.#ctx, declaration);
  }
}

/**
 * What takes handed-off work in a file (before the walk): each receiver's unit, a named one's own, or one made for an
 * anonymous handler (a job definition's `handler: async () => …`), added to `handlers` so the walk gives it its calls.
 */
export function receiversOfFile(
  ctx: GraphContext,
  program: TS.Program,
  source: TS.SourceFile,
  handlers: Map<TS.Node, HandlerUnit>,
): PendingReceiver[] {
  const { ts } = ctx;
  if (isBundled(source.text)) return [];
  const context: FileContext = { ts, source, checker: program.getTypeChecker() };
  const path = projectPath(ctx, source.fileName);
  const receivers: PendingReceiver[] = [];
  const used = new Map<string, number>();
  for (const found of receiversOf(context)) {
    let node: TS.Node | undefined;
    for (let at = findNode(ts, source, found.handler.start); at !== undefined; at = at.parent) {
      if (at.getStart(source) === found.handler.start && at.getEnd() === found.handler.end) {
        node = at;
        break;
      }
      if (ts.isSourceFile(at) || at.getStart(source) < found.handler.start) break;
    }
    if (node === undefined) continue;
    const own = namedUnitId(ctx, node) ?? handlers.get(node)?.id;
    if (own !== undefined) {
      receivers.push({ key: found.key, to: own });
      continue;
    }
    const label = found.key.slice(found.key.indexOf(':') + 1);
    const scope = unitNodeAt(ctx, source, node.getStart(source));
    const base = `${scope.node === null ? `${path}#` : `${scope.id}.`}(handler ${cut(label)})`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}~${String(n)}`;
    handlers.set(node, { id, name: cut(label) });
    receivers.push({ key: found.key, to: id });
  }
  return receivers;
}

// Joining (after every file is walked).

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly id: string;
}

/** A path's segments, a leading base (`{NEXT_PUBLIC_BASE_PATH}`, `{BASE_URL}`) and trailing slashes set aside. */
const segmentsOf = (path: string): string[] =>
  path
    .replace(/^\{[^}]*\}/, '')
    .split('/')
    .filter((segment) => segment !== '');

const isValue = (segment: string) => segment.startsWith(':');

/** A route's method serves a call's: the same, `ALL`, or React Router's `loader` (GET) and `action` (any other). */
export const servesMethod = (route: string, call: string): boolean =>
  route === call ||
  route === 'ALL' ||
  (route === 'loader' ? call === 'GET' : route === 'action' && call !== 'GET');

/** Whether a route serves a call's path: segment by segment, a value matching any segment, `*` the rest. */
function serves(route: readonly string[], call: readonly string[]): boolean {
  for (let i = 0; i < route.length; i += 1) {
    const r = route[i] ?? '';
    if (r === '*') return i <= call.length;
    const c = call[i];
    if (c === undefined) return false;
    if (!(isValue(r) || isValue(c) || r === c)) return false;
  }
  return route.length === call.length;
}

export interface JoinedConnections {
  /** Every file's edges, with each joined link's unknown edge replaced, and the joins added. */
  readonly edges: readonly GraphEdge[];
}

/**
 * Links joined to the API's entry points (a convention edge to each it matches, in place of the call's unknown edge),
 * and hand-offs to what takes them (a convention edge from the hand-off's node to each receiver, at the receiver's
 * line). A link that matches nothing stays the unknown call it was.
 */
export function joinConnections(
  parts: readonly FileConnections[],
  entries: readonly GraphNode[],
  edges: readonly GraphEdge[],
  nodeOf: (id: string) => GraphNode | undefined,
): JoinedConnections {
  const trpc = new Map<string, string[]>();
  const graphql = new Map<string, string[]>();
  const http: Route[] = [];
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    map.set(key, [...(map.get(key) ?? []), id]);
  };
  for (const node of entries) {
    if (node.entry?.kind !== 'api-route') continue;
    const space = node.name.indexOf(' ');
    if (space === -1) continue;
    if (node.entry.framework === 'trpc') push(trpc, node.name.slice(space + 1), node.id);
    else if (node.entry.framework === 'graphql') push(graphql, node.name, node.id);
    else {
      http.push({
        method: node.name.slice(0, space),
        segments: segmentsOf(node.name.slice(space + 1)),
        id: node.id,
      });
    }
  }
  const matches = (link: PendingLink): Set<string> => {
    const ids = new Set<string>();
    for (const key of link.keys) {
      if (link.protocol === 'trpc') for (const id of trpc.get(key) ?? []) ids.add(id);
      else if (link.protocol === 'graphql') for (const id of graphql.get(key) ?? []) ids.add(id);
      else {
        const space = key.indexOf(' ');
        const method = key.slice(0, space);
        const call = segmentsOf(key.slice(space + 1));
        for (const route of http) {
          if (servesMethod(route.method, method) && serves(route.segments, call)) {
            ids.add(route.id);
          }
        }
      }
    }
    return ids;
  };

  // Each joined call: its unit, the unknown text, the line → the entry points it reaches.
  const joined = new Map<string, Set<string>>();
  const at = (from: string, target: string, line: number) =>
    `${from}\u0000${target}\u0000${String(line)}`;
  // Beside a resolved call (a wrapper): edges of their own, replacing nothing.
  const beside: GraphEdge[] = [];
  // Where each replacing link is drawn: its own line.
  const drawnAt = new Map<string, number>();
  for (const part of parts) {
    for (const link of part.links) {
      const ids = matches(link);
      if (ids.size === 0) continue;
      if (link.target === null) {
        for (const id of ids) {
          beside.push({
            from: link.from,
            to: id,
            target: null,
            kind: 'call',
            relation: 'calls',
            label: null,
            provenance: 'convention',
            lines: [link.at],
          });
        }
        continue;
      }
      const key = at(link.from, link.target, link.line);
      joined.set(key, ids);
      drawnAt.set(key, link.at);
    }
  }
  // The unit a decision is in: its id up to the `?` (ADR 0028).
  const unitOf = (id: string) => (id.includes('?') ? id.slice(0, id.lastIndexOf('?')) : id);
  const out = new Map<string, GraphEdge>();
  const put = (edge: GraphEdge) => {
    const key = [
      edge.from,
      edge.to ?? `?${edge.target ?? ''}`,
      edge.kind,
      edge.relation ?? '',
      edge.label ?? '',
    ].join('\u0000');
    const known = out.get(key);
    if (known === undefined) {
      out.set(key, edge);
      return;
    }
    const lines = [...new Set([...known.lines, ...edge.lines])].sort((a, b) => a - b);
    const guarded = [...new Set([...(known.guarded ?? []), ...(edge.guarded ?? [])])].sort(
      (a, b) => a - b,
    );
    out.set(key, guarded.length === 0 ? { ...known, lines } : { ...known, lines, guarded });
  };
  for (const edge of edges) {
    if (edge.provenance !== 'unknown' || edge.target === null || joined.size === 0) {
      put(edge);
      continue;
    }
    const target = edge.target;
    const kept: number[] = [];
    for (const line of edge.lines) {
      const key = at(unitOf(edge.from), target, line);
      const ids = joined.get(key);
      if (ids === undefined) {
        kept.push(line);
        continue;
      }
      for (const id of ids) {
        const guardedHere = edge.guarded?.includes(line) === true;
        put({
          from: edge.from,
          to: id,
          target: null,
          kind: edge.kind,
          relation: edge.relation,
          label: edge.label,
          provenance: 'convention',
          lines: [drawnAt.get(key) ?? line],
          ...(guardedHere ? { guarded: [drawnAt.get(key) ?? line] } : {}),
        });
      }
    }
    if (kept.length > 0) {
      const guarded = edge.guarded?.filter((line) => kept.includes(line)) ?? [];
      const rest: GraphEdge = {
        from: edge.from,
        to: edge.to,
        target: edge.target,
        kind: edge.kind,
        relation: edge.relation,
        label: edge.label,
        provenance: edge.provenance,
        lines: kept,
      };
      put(guarded.length === 0 ? rest : { ...rest, guarded });
    }
  }
  for (const edge of beside) put(edge);
  // Hand-offs to their receivers.
  for (const part of parts) {
    for (const receiver of part.receivers) {
      const from = `(handoff ${receiver.key})`;
      const handler = nodeOf(receiver.to);
      if (nodeOf(from) === undefined || handler === undefined) continue;
      put({
        from,
        to: receiver.to,
        target: null,
        kind: 'handoff',
        relation: null,
        label: null,
        provenance: 'convention',
        lines: [handler.place?.line ?? 1],
      });
    }
  }
  return { edges: [...out.values()] };
}
