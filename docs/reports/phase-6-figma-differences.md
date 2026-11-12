# Phase 6: Graph stats beside Figma's inspector

For the owner's review by eye. Figma is the layout reference; Graphite outranks it on everything visual (CLAUDE.md section 2), and colour values come from the tokens. The screen baselines (`e2e/visual/__screenshots__/screens-project-graph-stats-*`) and the catalogue's `Shell/GraphStats` stories catch changes from what's built; this list says how what's built differs from Figma, and why.

| Screen | Figma | Built |
| --- | --- | --- |
| Labs → Graph stats, in the inspector's Details tab | Not in Figma. The nearest is `06 · Canvas`'s inspector: [figma-06.png](phase-2/figma-06.png) (generator: `flowcanvas-screens.js`, `inspectorLLM`), which shows a selected node's details | [built-graph-stats-dark.png](phase-6/built-graph-stats-dark.png), [built-graph-stats-light.png](phase-6/built-graph-stats-light.png) |

## Matches

- **The inspector's frame and tabs** (phase 5): Details selected, Runs and Changes dimmed, Calls.
- **Figma's inspector type:** a Heading for the title line (here the totals), Small for names, Caption for what each means, Mono small for values, 12 px between groups.
- **Provenance by form, not colour,** with Graphite's four line forms (solid with a check mark, solid, dotted, open stub), as Figma's edges draw them.

## Differences, and why

| Figma | Built | Why |
| --- | --- | --- |
| Details shows a selected node | With nothing selected, and the Labs switch on, Details shows the project's graph | Owner, 12 Nov 2026: Graph stats in the Details tab when nothing is selected. Nothing on the canvas is selectable until the flow builder (phase 7) |
| — | "Labs · preview" above it | CLAUDE.md rule 10: an unfinished feature behind Labs is marked as a preview |
| — | Every kind listed, zeros with "arrives in phase N" | Owner, 12 Nov 2026: kinds not detected yet show 0 and their phase, so nothing looks missing or made up |
| — | Calls into TypeScript's library as one line under the counts | Owner, 12 Nov 2026: built-ins stay out of the graph and are counted apart |
| Values in Figma's inspector are left-aligned beside their labels | Counts right-aligned, in tabular figures | Numbers in a column read and compare better aligned (Graphite: Mono for values) |

Light theme: Figma's inspector is dark only. The light theme's baseline is `screens-project-graph-stats-light-linux.png`.
