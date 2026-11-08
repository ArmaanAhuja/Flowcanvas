// Ranking file paths for quick-open (phase 3): the characters typed must appear in order; matches in the file
// name, at the start of a word and next to each other rank higher, and shorter paths win ties.

export interface Match {
  readonly path: string;
  readonly score: number;
  /** Indexes into `path` of the matched characters, to highlight them. */
  readonly positions: readonly number[];
}

const BOUNDARY = /[/._\-\s]/;

/** Scores one path against a query (case-insensitive); undefined if the characters aren't all there in order. */
export function scorePath(query: string, path: string): Match | undefined {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (q === '') return { path, score: 0, positions: [] };
  const lower = path.toLowerCase();
  const nameStart = path.lastIndexOf('/') + 1;
  // Prefer matching inside the file name: try it first, from the right, then the whole path.
  const attempt = (from: number): number[] | undefined => {
    const positions: number[] = [];
    let at = from;
    for (const char of q) {
      const found = lower.indexOf(char, at);
      if (found === -1) return undefined;
      positions.push(found);
      at = found + 1;
    }
    return positions;
  };
  const positions = attempt(nameStart) ?? attempt(0);
  if (positions === undefined) return undefined;
  let score = 0;
  positions.forEach((position, i) => {
    score += 1;
    if (position >= nameStart) score += 2;
    if (position === 0 || BOUNDARY.test(path[position - 1] ?? '')) score += 3;
    if (i > 0 && positions[i - 1] === position - 1) score += 4;
  });
  if (lower.slice(nameStart).startsWith(q)) score += 10;
  score -= path.length / 100;
  return { path, score, positions };
}

/** The best `limit` matches, best first. */
export function rankPaths(query: string, paths: readonly string[], limit = 50): Match[] {
  const matches: Match[] = [];
  for (const path of paths) {
    const match = scorePath(query, path);
    if (match !== undefined) matches.push(match);
  }
  return matches
    .sort(
      (a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1),
    )
    .slice(0, limit);
}
