// Where a flow node's text may wrap, and how many lines it takes (phase 7): identifiers and paths have no spaces, so
// without help a long name breaks at any character ("canAccessTeamDocumen" / "t"). They break at word boundaries
// instead: a lowercase or digit before a capital, and after `/`, `_` and `-`; after `.` in a name (`item.created`) but
// not in a path, where it's the file's extension (`route.ts`, not `route.` / `ts`). The canvas's layout sizes each
// node with the same rule, so a wrapped node never spills over the edges routed around it.

/** The text in pieces, each a place a line may end after. */
export function wrapSegments(text: string): string[] {
  const after = text.includes('/')
    ? /(?<=[a-z0-9])(?=[A-Z])|(?<=[/_-])/
    : /(?<=[a-z0-9])(?=[A-Z])|(?<=[._-])/;
  return text.split(after).filter((piece) => piece !== '');
}

/** The node's text area and type, in px (FlowNode.module.css: 216 wide, padding, border, icon and gap). */
export const NODE_TEXT = {
  width: 166,
  /** Body strong (Inter 13/20, 500): a little wider than its average character, so estimates err tall. */
  titleChar: 8,
  titleLine: 20,
  /** Mono small (JetBrains Mono 11/16): every character 0.6 em. */
  locationChar: 6.6,
  locationLine: 16,
  /** Padding and border, top and bottom. */
  chrome: 20,
} as const;

/** Lines `text` takes in `width` px, wrapping between segments, and inside one only when it alone is too long. */
export function linesFor(text: string, charWidth: number, width: number): number {
  let lines = 1;
  let used = 0;
  for (const piece of wrapSegments(text)) {
    const size = piece.length * charWidth;
    if (used > 0 && used + size > width) {
      lines += 1;
      used = 0;
    }
    if (size > width) {
      lines += Math.ceil(size / width) - 1;
      used = size % width;
    } else {
      used += size;
    }
  }
  return lines;
}

/** A flow node's height for its title and location: at least what it renders, never less. */
export function nodeHeight(title: string, location: string): number {
  return (
    NODE_TEXT.chrome +
    linesFor(title, NODE_TEXT.titleChar, NODE_TEXT.width) * NODE_TEXT.titleLine +
    linesFor(location, NODE_TEXT.locationChar, NODE_TEXT.width) * NODE_TEXT.locationLine
  );
}
