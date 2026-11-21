# Phases 12 and 13: groups and the sequence view beside Figma 06, Figma 08 and the design brief

For the owner's review by eye. Figma is the layout reference; Graphite's tokens outrank it on all visuals (CLAUDE.md section 2).

| Screen | Built |
| --- | --- |
| A large flow opened grouped (Rallly's `POST /api/private/polls`, from the engine) | `e2e/visual/__screenshots__/screens-project-entry-flow-{dark,light}-linux.png` |
| The sequence view of Twenty's `EmailService.send`, the worker's `handle` selected | `e2e/visual/__screenshots__/screens-project-sequence-{dark,light}-linux.png` |
| A group: closed, of tables, selected, open (the catalogue) | `e2e/visual/__screenshots__/canvas-groupnode--*-{dark,light}-linux.png` |
| The sequence view from the code, and with measured spans (the catalogue) | `e2e/visual/__screenshots__/components-sequenceview--*-{dark,light}-linux.png` |

## Matches

- **Groups (design brief, "Flow graph view"; Graphite "Group"):** a stacked card (two offset outlines), its title and its count in caption, a chevron that turns when it opens; the same height as a flow node.
- **Expanding pushes nothing else around** (design brief): an open group is a frame at its card's place, over the canvas; nothing else moves.
- **Sequence (Figma 08):** the flow's name and a muted line beside it ("order from code; no timings yet"), a Step column in Mono, compact rows with a subtle rule, bars to the right, dashed for order from code, the Background group with a clock and its title, the legend at the bottom.

## Differences, and why

| Figma / design brief | Built | Why |
| --- | --- | --- |
| Groups named by role ("Validation · 4") | Named by their folder (`src/platform · 18`) or kind (`Tables · 6`) | Owner, 16 Nov 2026: named from the code, never an inferred category |
| Figma 08's time axis (0, 500 ms, 1.0 s…) | No axis until spans are measured; each bar covers its calls' rows | Without a run there are no timings (design brief: "bars show order only"); the axis returns with phase 29's runs, as the catalogue's "observed" story shows |
| Figma 08's flat list of steps | Rows indented by depth, the outcome a decision leads to before a step's name, failure paths marked in words | The same flow as the graph (phase 13's Done when): its nesting and branches are what the code says |
| One Background group | One per hand-off, each titled by it | A flow can hand off more than once (Twenty's email service) |
| Retries as stacked bars | Not shown | The code doesn't say how often a call is retried: observed runs will (phase 29) |
