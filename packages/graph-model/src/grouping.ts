// Grouping a large flow for progressive disclosure (phase 12, ADR 0032; owner, 16 Nov 2026): named from the code, never
// an inferred category. A function is grouped by its folder, as deep as fits in 8 groups; tables, outside services and
// hand-offs are each a group of their kind; a decision is in its function's group. The flow's root is always shown on
// its own, and so is a group of one. The background lane (phase 11) is grouped apart.
import { backgroundOf, type Flow } from './flow.js';
import type { GraphNode } from './model.js';

/** At most this many groups (and nodes shown on their own, the root aside): the plan's "8 or fewer groups". */
export const MAX_FLOW_GROUPS = 8;

export type GroupKind = 'function' | 'ui' | 'data' | 'queue' | 'external';

export interface SemanticGroup {
  /** Stable across layouts of the same flow: `group:<lane>:<key>`. */
  readonly id: string;
  /** The folder (its last two parts), or the kind: "Tables", "Outside services", "Hand-offs". */
  readonly title: string;
  readonly kind: GroupKind;
  readonly lane: 'main' | 'background';
  readonly count: number;
  /** In the flow's order. */
  readonly nodeIds: readonly string[];
}

export interface SemanticGroupingResult {
  readonly groups: readonly SemanticGroup[];
  /** Each grouped node's group. */
  readonly nodeToGroup: ReadonlyMap<string, string>;
  /** Shown on their own: the root, and each group of one. */
  readonly standaloneNodeIds: readonly string[];
}

const KINDS = {
  tables: { title: 'Tables', kind: 'data' },
  services: { title: 'Outside services', kind: 'external' },
  handoffs: { title: 'Hand-offs', kind: 'queue' },
} as const satisfies Record<string, { title: string; kind: GroupKind }>;

type Lane = SemanticGroup['lane'];

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const parentOf = (dir: string) => (dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '');
const within = (dir: string, folder: string) =>
  folder === '' || dir === folder || dir.startsWith(`${folder}/`);

/** A folder as a group's title: its last two parts, or the project's root. */
export function folderTitle(dir: string): string {
  if (dir === '') return 'Project root';
  return dir.split('/').slice(-2).join('/');
}

/** A decision's function: its id up to the `?` (ADR 0028). */
const unitOf = (id: string) => (id.includes('?') ? id.slice(0, id.lastIndexOf('?')) : id);

/** The deepest folder all of these are in. */
function deepestShared(dirs: readonly string[]): string {
  let shared = dirs[0] ?? '';
  for (const dir of dirs) while (!within(dir, shared)) shared = parentOf(shared);
  return shared;
}

interface FolderGroup {
  readonly lane: Lane;
  readonly dir: string;
  readonly ids: string[];
  /** Split as far as it can be (or only what's directly in its folder). */
  done: boolean;
}

/**
 * Groups a flow's nodes (the root aside) into at most `maxGroups` groups and nodes shown on their own. Folders top
 * down: each lane's functions start in their deepest shared folder, and the largest group is split into its
 * subfolders (what's directly in it staying) while the groups stay within `maxGroups`: the finest grouping that fits.
 */
export function semanticGrouping(
  flow: Flow,
  options?: { readonly maxGroups?: number },
): SemanticGroupingResult {
  const maxGroups = options?.maxGroups ?? MAX_FLOW_GROUPS;
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const background = backgroundOf(flow);
  const kindOf = new Map<string, { lane: Lane; kind: keyof typeof KINDS }>();
  const dirs = new Map<string, { lane: Lane; dir: string }>();
  for (const node of flow.nodes) {
    if (node.id === flow.root) continue;
    const lane: Lane = background.has(node.id) ? 'background' : 'main';
    if (node.data !== undefined) kindOf.set(node.id, { lane, kind: 'tables' });
    else if (node.service !== undefined) kindOf.set(node.id, { lane, kind: 'services' });
    else if (node.handoff !== undefined) kindOf.set(node.id, { lane, kind: 'handoffs' });
    else {
      // A decision is in its function's folder; anything else in its own.
      const owner: GraphNode =
        node.kind === 'decision' ? (byId.get(unitOf(node.id)) ?? node) : node;
      dirs.set(node.id, { lane, dir: dirOf(owner.place?.path ?? '') });
    }
  }
  const kindGroups = new Set([...kindOf.values()].map((k) => `${k.lane}:${k.kind}`)).size;
  const folders = new Map<string, FolderGroup>();
  for (const lane of ['main', 'background'] as const) {
    const ids = [...dirs].filter(([, d]) => d.lane === lane).map(([id]) => id);
    if (ids.length === 0) continue;
    const dir = deepestShared(ids.map((id) => dirs.get(id)?.dir ?? ''));
    folders.set(`${lane}:${dir}`, { lane, dir, ids, done: false });
  }
  for (;;) {
    const next = [...folders.values()]
      .filter((g) => !g.done)
      .sort((a, b) => b.ids.length - a.ids.length)[0];
    if (next === undefined) break;
    // Its subfolders, one level down; what's directly in it stays in it.
    const children = new Map<string, string[]>();
    for (const id of next.ids) {
      const dir = dirs.get(id)?.dir ?? '';
      const rest = next.dir === '' ? dir : dir.slice(next.dir.length + 1);
      const child =
        dir === next.dir
          ? next.dir
          : `${next.dir === '' ? '' : `${next.dir}/`}${rest.split('/')[0] ?? ''}`;
      children.set(child, [...(children.get(child) ?? []), id]);
    }
    // Room for this many more groups; what's directly in the folder isn't a subfolder.
    const room = maxGroups - kindGroups - folders.size;
    const subfolders = [...children].filter(([child]) => child !== next.dir);
    if (subfolders.length === 0 || room < 1) {
      next.done = true;
      continue;
    }
    // All of them when they fit; otherwise the largest that do, the rest staying in the folder (and it's done).
    const whole = children.size - 1 <= room;
    const out = whole
      ? subfolders
      : subfolders.sort((a, b) => b[1].length - a[1].length).slice(0, room);
    folders.delete(`${next.lane}:${next.dir}`);
    const moved = new Set(out.flatMap(([, ids]) => ids));
    const staying = next.ids.filter((id) => !moved.has(id));
    if (staying.length > 0) {
      folders.set(`${next.lane}:${next.dir}`, {
        lane: next.lane,
        dir: next.dir,
        ids: staying,
        done: true,
      });
    }
    for (const [, ids] of out) {
      // A subfolder goes as deep as its nodes share.
      const dir = deepestShared(ids.map((id) => dirs.get(id)?.dir ?? ''));
      folders.set(`${next.lane}:${dir}`, { lane: next.lane, dir, ids, done: false });
    }
  }

  const keyOf = new Map<string, string>();
  for (const [id, { lane, kind }] of kindOf) keyOf.set(id, `${lane}:${kind}`);
  for (const group of folders.values()) {
    for (const id of group.ids) keyOf.set(id, `${group.lane}:dir:${group.dir}`);
  }
  const members = new Map<string, string[]>();
  for (const node of flow.nodes) {
    const key = keyOf.get(node.id);
    if (key !== undefined) members.set(key, [...(members.get(key) ?? []), node.id]);
  }
  const groups: SemanticGroup[] = [];
  const standalone = byId.has(flow.root) ? [flow.root] : [];
  const nodeToGroup = new Map<string, string>();
  for (const [key, ids] of members) {
    if (ids.length === 1) {
      standalone.push(...ids);
      continue;
    }
    const [lane, kind] = key.split(':') as [Lane, string];
    const folder = kind === 'dir' ? key.slice(`${lane}:dir:`.length) : null;
    const components = ids.filter((member) => byId.get(member)?.unit === 'component').length;
    const id = `group:${key}`;
    groups.push({
      id,
      title: folder === null ? KINDS[kind as keyof typeof KINDS].title : folderTitle(folder),
      kind:
        folder === null
          ? KINDS[kind as keyof typeof KINDS].kind
          : components * 2 > ids.length
            ? 'ui'
            : 'function',
      lane,
      count: ids.length,
      nodeIds: ids,
    });
    for (const member of ids) nodeToGroup.set(member, id);
  }
  return { groups, nodeToGroup, standaloneNodeIds: standalone };
}
