// The living docs held to the code (owner, 13 Nov 2026: RUN-AND-FEATURES said "last updated 8 Nov" five days and
// three phases late, with an old release and old counts). Each check reads files and says what disagrees; nothing
// here writes. Historical records (build-steps entries, reports, the decisions log, ADRs) are true about their own
// dates and aren't checked for staleness, except build-steps' step tables, which say what's still to do.

/** A disagreement between a doc and the code, with where it is. */
export interface Finding {
  readonly where: string;
  readonly problem: string;
}

/** STATUS.md's phases: accepted, and the one in progress (if any), in table order. */
export function phasesFromStatus(status: string): {
  readonly accepted: readonly string[];
  readonly inProgress: readonly string[];
} {
  const accepted: string[] = [];
  const inProgress: string[] = [];
  for (const line of status.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const phase = cells[1] ?? '';
    if (!/^\d+[a-z]?$/.test(phase)) continue;
    if (cells[3] === 'accepted') accepted.push(phase);
    else if (cells[3] === 'in progress') inProgress.push(phase);
  }
  return { accepted, inProgress };
}

const PHASE = /\bphases?\s+((?:\d+[a-z]?)(?:\s*(?:,|and|to)\s*\d+[a-z]?)*)/gi;

/** Every phase a text names: "phase 7", "phases 4, 5 and 6". */
export function phasesNamed(text: string): string[] {
  return [...text.matchAll(PHASE)].flatMap((match) => (match[1] ?? '').match(/\d+[a-z]?/g) ?? []);
}

/**
 * Words that say something is still to come, said of a phase: "arrives in phase 8", "until phase 12", "planned for
 * phase 48a", "phase 30 adds". A phase named that way must not be accepted yet.
 */
const PHASES = String.raw`phases?\s+\d+[a-z]?(?:\s*(?:,|and)\s*\d+[a-z]?)*`;
const STILL_TO_COME = new RegExp(
  String.raw`\b(?:arriv(?:e|es|ing)\b[^.;()]*?\b${PHASES}|until\s+(?:the\s+)?${PHASES}|stand-in\s+(?:for|until)\s+(?:the\s+)?${PHASES}|planned\s+(?:for|in)\s+${PHASES}|coming\s+in\s+${PHASES}|${PHASES}\s+(?:will|adds|brings)\b)`,
  'gi',
);

/** Lines that say an accepted phase is still to come. */
export function stillToCome(text: string, accepted: ReadonlySet<string>, file: string): Finding[] {
  const found: Finding[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    // Only the phases each "still to come" phrase names, not every phase on the line.
    const late = [...line.matchAll(STILL_TO_COME)]
      .flatMap((said) => phasesNamed(said[0]))
      .filter((phase) => accepted.has(phase));
    if (late.length > 0) {
      found.push({
        where: `${file}:${String(index + 1)}`,
        problem: `says phase ${late.join(', ')} is still to come, but it's accepted: ${line.trim().slice(0, 160)}`,
      });
    }
  }
  return found;
}

/** The comments in a TypeScript, JavaScript or CSS file, each with its first line number. */
export function commentsOf(source: string): { readonly text: string; readonly line: number }[] {
  const found: { text: string; line: number }[] = [];
  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  for (const match of source.matchAll(pattern)) {
    // A `//` inside a string or a URL isn't a comment: only those starting a line's code or after whitespace.
    const before = source.slice(Math.max(0, match.index - 1), match.index);
    if (match[0].startsWith('//') && before !== '' && !/\s/.test(before)) continue;
    found.push({
      text: match[0],
      line: source.slice(0, match.index).split('\n').length,
    });
  }
  return found;
}

/** RUN-AND-FEATURES's claims about where the project stands. */
export function runAndFeatures(
  doc: string,
  facts: {
    readonly version: string;
    readonly changelog: string;
    readonly accepted: readonly string[];
    readonly inProgress: readonly string[];
  },
  file = 'docs/RUN-AND-FEATURES.md',
): Finding[] {
  const found: Finding[] = [];
  const at = (needle: RegExp) => {
    const index = doc.split('\n').findIndex((line) => needle.test(line));
    return `${file}:${String(index + 1)}`;
  };
  const released = /\*\*Released \(on staging\):\*\*\s*`([^`]+)`/.exec(doc)?.[1];
  if (released !== facts.version) {
    found.push({
      where: at(/\*\*Released/),
      problem: `says ${String(released)} is released; package.json says ${facts.version}`,
    });
  }
  if (
    !new RegExp(`^## \\[?${facts.version.replace(/\./g, '\\.')}\\]?`, 'm').test(facts.changelog)
  ) {
    found.push({ where: 'CHANGELOG.md', problem: `has no section for ${facts.version}` });
  }
  const progress = /\*\*Progress:\*\*\s*phases ([^.;]+?) are accepted/.exec(doc)?.[1] ?? '';
  const said = new Set(progress.match(/\d+[a-z]?/g) ?? []);
  const missing = facts.accepted.filter((phase) => !said.has(phase));
  const extra = [...said].filter((phase) => !facts.accepted.includes(phase));
  if (missing.length > 0 || extra.length > 0) {
    found.push({
      where: at(/\*\*Progress/),
      problem: `lists the accepted phases as ${[...said].join(', ')}; STATUS.md says ${facts.accepted.join(', ')}`,
    });
  }
  const updated = /\*\*Last updated:\*\*([^\n]*)/.exec(doc)?.[1] ?? '';
  const current = facts.inProgress.length > 0 ? facts.inProgress : facts.accepted.slice(-1);
  if (!current.some((phase) => phasesNamed(updated).includes(phase))) {
    found.push({
      where: at(/\*\*Last updated/),
      problem: `doesn't name phase ${current.join(' or ')}, where the work is: ${updated.trim()}`,
    });
  }
  // Each accepted phase from 4 on has a section of its own saying so (earlier ones are grouped by area).
  const headings = doc.split('\n').filter((line) => line.startsWith('### '));
  for (const phase of facts.accepted.filter((p) => Number.parseInt(p, 10) >= 4)) {
    if (!headings.some((h) => phasesNamed(h).includes(phase) && h.includes('accepted'))) {
      found.push({
        where: file,
        problem: `has no section saying phase ${phase} is accepted`,
      });
    }
  }
  // "Coming next" names what's still to do.
  const next = /### Coming next\n([\s\S]*?)(?=\n## |\n### |$)/.exec(doc)?.[1] ?? '';
  for (const phase of phasesNamed(next).filter((p) => facts.accepted.includes(p))) {
    found.push({
      where: at(/### Coming next/),
      problem: `lists phase ${phase} as coming next, but it's accepted`,
    });
  }
  return found;
}

/** build-steps' step tables: no step still "next", "planned" or "in progress" in an accepted phase. */
export function buildSteps(
  doc: string,
  accepted: ReadonlySet<string>,
  file = 'docs/build-steps.md',
): Finding[] {
  const found: Finding[] = [];
  let phase: string | null = null;
  for (const [index, line] of doc.split('\n').entries()) {
    const heading = /^## Phase (\d+[a-z]?)\b/.exec(line);
    if (heading !== null) {
      phase = heading[1] ?? null;
      continue;
    }
    if (line.startsWith('## ')) phase = null;
    if (phase === null || !accepted.has(phase) || !line.startsWith('|')) continue;
    if (/\*(next|planned|in progress)\*/i.test(line)) {
      found.push({
        where: `${file}:${String(index + 1)}`,
        problem: `phase ${phase} is accepted, but a step still says ${/\*(next|planned|in progress)\*/i.exec(line)?.[0] ?? ''}: ${line.slice(0, 120)}`,
      });
    }
  }
  return found;
}

/** Repository paths a doc names in backticks (`apps/web/src/flow/`), for checking they exist. */
export function pathsNamed(doc: string): { readonly path: string; readonly line: number }[] {
  const roots = /^(apps|packages|services|workspace|tools|docs|e2e|corpus|\.github)\//;
  const found: { path: string; line: number }[] = [];
  for (const [index, line] of doc.split('\n').entries()) {
    // A line about a corpus project names its paths (Rallly's `apps/web/…`), not ours.
    if (/\b(Rallly|Documenso|LibreChat|Twenty|Excalidraw|Medusa)\b/.test(line)) continue;
    for (const match of line.matchAll(/`([^`\s]+)`/g)) {
      const path = (match[1] ?? '').replace(/[:#].*$/, '');
      // Patterns and placeholders aren't paths.
      if (!roots.test(path) || /[*<>{}]|\.\.\./.test(path)) continue;
      found.push({ path, line: index + 1 });
    }
  }
  return found;
}

/** The counts a doc holds between `<!-- count:name -->` and `<!-- /count -->`. */
export function countsIn(doc: string): Map<string, string> {
  return new Map(
    [...doc.matchAll(/<!-- count:([a-z-]+) -->([^<]*)<!-- \/count -->/g)].map((m) => [
      m[1] ?? '',
      m[2] ?? '',
    ]),
  );
}

/** The doc with its counts replaced. */
export function withCounts(doc: string, counts: ReadonlyMap<string, number>): string {
  return doc.replace(/<!-- count:([a-z-]+) -->([^<]*)<!-- \/count -->/g, (whole, name: string) => {
    const value = counts.get(name);
    return value === undefined
      ? whole
      : `<!-- count:${name} -->${value.toLocaleString('en-US')}<!-- /count -->`;
  });
}

/** Days a doc's "Last updated" may trail the latest commit: code is pushed before its docs, within a milestone. */
export const UPDATED_WITHIN_DAYS = 2;

/** A "Last updated" date too far behind the latest commit. */
export function updatedDate(
  doc: string,
  latestCommit: Date,
  file = 'docs/RUN-AND-FEATURES.md',
): Finding[] {
  const line = /\*\*Last updated:\*\*\s*(\d{1,2} [A-Z][a-z]{2} \d{4})/.exec(doc)?.[1];
  const date = line === undefined ? Number.NaN : Date.parse(`${line} UTC`);
  if (Number.isNaN(date))
    return [{ where: file, problem: 'has no "Last updated" date like 13 Nov 2026' }];
  const behind = (latestCommit.getTime() - date) / 86_400_000;
  return behind > UPDATED_WITHIN_DAYS + 1
    ? [
        {
          where: file,
          problem: `was last updated on ${line ?? ''}, ${String(Math.floor(behind))} days before the latest commit`,
        },
      ]
    : [];
}
