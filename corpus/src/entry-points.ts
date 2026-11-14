// Phase 8's Done when: the engine's entry points against the hand labels (labels/entry-points.json), per fork and per
// group. A labelled entry point is found when the engine lists it with the same kind, name, file and line; not fully
// detected when the engine lists it at that place marked incomplete, with why (an explained miss); missed otherwise.
// Anything the engine lists in the labelled scope that no label names is a false find. Shapes are structural, so the
// corpus package doesn't depend on the engine.

export const ENTRY_GROUPS = ['convention', 'code'] as const;
export type EntryGroup = (typeof ENTRY_GROUPS)[number];

export interface EntryLabel {
  readonly kind: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly group: EntryGroup;
}

/** Which files each kind is labelled in: `*` for all; `exclude` for folders left out. */
export type EntryScope = Readonly<Record<string, readonly string[]>>;

export interface ForkLabels {
  readonly scope: EntryScope;
  readonly notes: readonly string[];
  readonly entries: readonly EntryLabel[];
}

/** An entry point as the engine lists it (`EntryPointItem`). */
export interface AnsweredEntryPoint {
  readonly kind: string;
  readonly name: string;
  readonly place: { readonly path: string; readonly line: number } | null;
  readonly complete: boolean;
  readonly why: string | null;
}

export interface GroupResult {
  readonly labelled: number;
  readonly found: number;
  /** Listed at the labelled place, marked not fully detected, with why. */
  readonly incomplete: readonly string[];
  readonly missed: readonly string[];
}

export interface EntryPointsResult {
  readonly groups: Readonly<Record<EntryGroup, GroupResult>>;
  /** In scope, named by no label. */
  readonly falseFinds: readonly string[];
}

export function inScope(scope: EntryScope, kind: string, file: string): boolean {
  if ((scope.exclude ?? []).some((folder) => file.startsWith(folder))) return false;
  const files = scope[kind] ?? [];
  return files.some(
    (p) => p === '*' || file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`),
  );
}

const key = (kind: string, name: string, file: string, line: number) =>
  `${kind} | ${name} | ${file}:${String(line)}`;
const place = (kind: string, file: string, line: number) => `${kind} @ ${file}:${String(line)}`;

export function compareEntryPoints(
  labels: ForkLabels,
  answered: readonly AnsweredEntryPoint[],
): EntryPointsResult {
  const listed = answered.filter(
    (e) => e.place !== null && inScope(labels.scope, e.kind, e.place.path),
  );
  const exact = new Set(
    listed.map((e) => key(e.kind, e.name, e.place?.path ?? '', e.place?.line ?? 0)),
  );
  // Incomplete entries by place: several can share one (a route under two unknown mounts).
  const incompleteAt = new Map<string, AnsweredEntryPoint[]>();
  for (const e of listed) {
    if (e.complete || e.why === null || e.place === null) continue;
    const at = place(e.kind, e.place.path, e.place.line);
    incompleteAt.set(at, [...(incompleteAt.get(at) ?? []), e]);
  }
  const explained = new Set<AnsweredEntryPoint>();
  const groupResult = (group: EntryGroup): GroupResult => {
    const mine = labels.entries.filter((l) => l.group === group);
    let found = 0;
    const incomplete: string[] = [];
    const missed: string[] = [];
    for (const l of mine) {
      if (exact.has(key(l.kind, l.name, l.file, l.line))) {
        found += 1;
        continue;
      }
      const there = incompleteAt.get(place(l.kind, l.file, l.line))?.find((e) => !explained.has(e));
      if (there !== undefined) {
        explained.add(there);
        incomplete.push(
          `${key(l.kind, l.name, l.file, l.line)}: listed as ${there.name} — ${there.why ?? ''}`,
        );
      } else missed.push(key(l.kind, l.name, l.file, l.line));
    }
    return { labelled: mine.length, found, incomplete, missed };
  };
  const groups = { convention: groupResult('convention'), code: groupResult('code') };
  const labelled = new Set(labels.entries.map((l) => key(l.kind, l.name, l.file, l.line)));
  const falseFinds = listed
    .filter(
      (e) =>
        !explained.has(e) &&
        !labelled.has(key(e.kind, e.name, e.place?.path ?? '', e.place?.line ?? 0)),
    )
    .map((e) => key(e.kind, e.name, e.place?.path ?? '', e.place?.line ?? 0));
  return { groups, falseFinds };
}

/** Recall in a group: found over labelled (1 when nothing is labelled). */
export const recall = (group: GroupResult) =>
  group.labelled === 0 ? 1 : group.found / group.labelled;

/**
 * The bar (owner, 14 Nov 2026): every convention-based entry point found, at least 95% of the code-registered ones
 * per fork, no false finds, and every miss explained (listed at its place, not fully detected, with why).
 */
export function barProblems(result: EntryPointsResult): string[] {
  const problems: string[] = [];
  const { convention, code } = result.groups;
  if (recall(convention) < 1) {
    problems.push(
      `convention: ${String(convention.found)} of ${String(convention.labelled)} found`,
    );
  }
  if (recall(code) < 0.95) {
    problems.push(`code: ${String(code.found)} of ${String(code.labelled)} found, under 95%`);
  }
  for (const missed of [...convention.missed, ...code.missed])
    problems.push(`missed, unexplained: ${missed}`);
  for (const extra of result.falseFinds) problems.push(`false find: ${extra}`);
  return problems;
}
