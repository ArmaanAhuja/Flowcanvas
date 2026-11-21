// Whether the person's Node fits the project's `engines.node` (build plan v2, phase 3), so "Rallly needs Node 24; you
// have 26" is said before an install fails on it. Only the common forms are understood (`24`, `24.x`, `>=20.9.0`,
// `^20 || ^22`, `>=18 <23`); anything else is "can't tell" (null), never a guess.
type Version = readonly [number, number, number];

function parse(text: string): { version: Version; parts: number } | undefined {
  const match = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(text.trim());
  if (match === null) return undefined;
  const numbers = [match[1], match[2], match[3]].filter(
    (part) => part !== undefined && /^\d+$/.test(part),
  );
  return {
    version: [Number(match[1]), Number(match[2] ?? 0) || 0, Number(match[3] ?? 0) || 0],
    parts: numbers.length,
  };
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function comparator(text: string, have: Version): boolean | undefined {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(text);
  const target = match?.[2] === undefined ? undefined : parse(match[2]);
  if (match === null || target === undefined) return undefined;
  const { version, parts } = target;
  const order = compare(have, version);
  // The first version past what was named: `24` and `24.x` mean up to (not including) 25.
  const next: Version =
    parts <= 1 ? [version[0] + 1, 0, 0] : parts === 2 ? [version[0], version[1] + 1, 0] : version;
  switch (match[1]) {
    case '>=':
      return order >= 0;
    case '>':
      return parts === 3 ? order > 0 : compare(have, next) >= 0;
    case '<=':
      return parts === 3 ? order <= 0 : compare(have, next) < 0;
    case '<':
      return order < 0;
    case '^':
      return order >= 0 && have[0] === version[0];
    case '~':
      return order >= 0 && compare(have, parts === 1 ? next : [version[0], version[1] + 1, 0]) < 0;
    default:
      return parts === 3 ? order === 0 : order >= 0 && compare(have, next) < 0;
  }
}

/** true, false, or null when the range isn't one of the forms understood. */
export function nodeFits(range: string, version: string): boolean | null {
  const have = parse(version)?.version;
  if (have === undefined) return null;
  let any = false;
  for (const alternative of range.split('||')) {
    const parts = alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return null;
    const results = parts.map((part) => comparator(part, have));
    if (results.some((result) => result === undefined)) return null;
    if (results.every(Boolean)) any = true;
  }
  return any;
}
