# Phase 4: Figma 16, Figma 06's search, and what's built, side by side

For the owner's review by eye. Figma is the layout reference; Graphite outranks it on everything visual (CLAUDE.md section 2), and colour values come from the tokens. The screen baselines (`e2e/visual/__screenshots__/screens-code-palette-*`, `screens-project-indexing-*`) catch changes from what's built; this list says how what's built differs from Figma, and why.

| Screen | Figma | Built |
| --- | --- | --- |
| The command palette (⌘K) | `16 · Command palette` (node 24:7101): [figma-16.png](phase-3/figma-16.png) | [built-palette-dark.png](phase-4/built-palette-dark.png) |
| The top bar's search | `06 · Canvas` (top bar): [figma-06.png](phase-2/figma-06.png) | Both images above, top right |
| The index's progress chip | (not in Figma; design brief, "Still indexing": a progress chip, "Indexing 62%") | [built-indexing-light.png](phase-4/built-indexing-light.png), [built-indexing-dark.png](phase-4/built-indexing-dark.png) |

## Matches

- **The palette:**
  - 640 px wide, 10 px radius, panel surface, control border, popover shadow, about 120 px from the top
  - the search row with a 16 px icon
  - groups with Caption headers
  - rows with a 14 px icon, the name in Small, and the place in Mono small
  - the highlighted row on `surface/selected`
  - a footer of key hints
- **The top bar's search:** 200 px wide, a control border, radius 4, the search icon, "Search" and the shortcut in a key, between the view switch and the workspace status.

## Differences, and why

**Graphite and accessibility outrank Figma** (CLAUDE.md sections 2 and 7):

| Figma | Built | Why |
| --- | --- | --- |
| A row shows only an icon for its kind | The kind in words beside the icon ("Function", "Heading") | Graphite: meaning never by an icon or colour alone |
| The place in `text/tertiary`, on every row including the highlighted one | `text/muted` (as quick-open in phase 3), stepping up to `text/secondary` on a highlighted or hovered row | Tertiary is for non-text only (Graphite); WCAG AA: muted text on `surface/selected` failed axe's contrast check |
| The search field's label in `text/tertiary`, 26 px tall | `text/muted`, 28 px tall | Tertiary is for non-text only (Graphite); the 4 px grid |
| Groups Nodes, Commands, Files; footer hints `@` nodes and `>` commands | Symbols and Files; footer hints `#` files only and `esc` close | Phase 4 has symbols and files (decisions log, 9 Nov 2026); nodes (stage 1), commands and routes arrive with their phases |
| The first row is highlighted with no query typed | The first result is highlighted once there are results | There's nothing to open before typing; once there are results, Enter opens the top one (the Try it) |
| A dimmed overlay behind the palette (60%) | No dimming, as quick-open in phase 3 | Unchanged from phase 3's quick-open, which the owner accepted; both are the same frame |

**Not in Figma:**
- **The progress chip** follows the design brief's "Still indexing" state: "Indexing 62%" on the canvas and with the entry points, with the counts ("Indexing 1,240 of 2,031 files…") as its tooltip. In the Code view, which replaces the canvas, the same sentence is in the status bar.
- **The note under the search row** ("Indexing 400 of 1,958 files…", or why symbols aren't available). It's outside the results list because a listbox may hold only options and groups (axe).

Light theme: Figma 16 is dark only. The light theme's baselines are in `e2e/visual/__screenshots__/screens-*-light-linux.png`.
