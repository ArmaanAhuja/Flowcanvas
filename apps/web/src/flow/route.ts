// An edge drawn along the route ELK chose (phase 7): ELK routes each edge around the nodes, orthogonally; drawing a
// generic step between the two nodes instead ran lines behind other nodes (found in the phase 7 screens). Pure, so the
// path and the label's place are tested without a browser.

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Corner radius where a route turns (px), as React Flow's step edges had; smaller where a segment is short. */
export const CORNER = 8;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** An SVG path through `points`, straight segments joined by rounded corners. */
export function routePath(points: readonly Point[], radius = CORNER): string {
  const [first, ...rest] = points;
  if (first === undefined) return '';
  let path = `M ${String(first.x)} ${String(first.y)}`;
  for (const [index, corner] of rest.entries()) {
    const before = points[index] ?? first;
    const after = rest[index + 1];
    if (after === undefined) {
      path += ` L ${String(corner.x)} ${String(corner.y)}`;
      continue;
    }
    // Round the turn by at most half of either segment, so two turns close together never cross.
    const r = Math.min(radius, distance(before, corner) / 2, distance(corner, after) / 2);
    const inward = (from: Point, toward: Point) => {
      const length = distance(from, toward) || 1;
      return {
        x: from.x + ((toward.x - from.x) / length) * r,
        y: from.y + ((toward.y - from.y) / length) * r,
      };
    };
    const start = inward(corner, before);
    const end = inward(corner, after);
    path += ` L ${String(start.x)} ${String(start.y)} Q ${String(corner.x)} ${String(corner.y)} ${String(end.x)} ${String(end.y)}`;
  }
  return path;
}

/** How far along a route an outcome's label sits: just past where it leaves its decision. */
export const LABEL_OFFSET = 20;

/** The point `offset` px along `points`, or the route's middle when it's shorter than twice that. */
export function pointAlong(points: readonly Point[], offset = LABEL_OFFSET): Point {
  const total = points.slice(1).reduce((sum, p, i) => sum + distance(points[i] ?? p, p), 0);
  let left = Math.min(offset, total / 2);
  for (const [i, p] of points.slice(1).entries()) {
    const from = points[i] ?? p;
    const length = distance(from, p);
    if (left <= length) {
      const t = length === 0 ? 0 : left / length;
      return { x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t };
    }
    left -= length;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}
