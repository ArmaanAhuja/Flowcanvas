# Phase 8: the entry-points panel beside Figma 06 and 16

For the owner's review by eye. Figma is the layout reference; Graphite outranks it on everything visual (CLAUDE.md section 2), and colour values come from the tokens. The screen baselines (`e2e/visual/__screenshots__/screens-project-entry-*`) and the catalogue's EntryPointsPanel stories catch any unintended change; this note is about the intended differences.

| Screen | Figma | Built |
| --- | --- | --- |
| The left panel's entry points, a screen open to its elements | `06 · Canvas`'s left panel: [figma-06.png](phase-2/figma-06.png) (generator: `flowcanvas-screens.js`, `entryPoints`) | [built-entry-points-dark.png](phase-8/built-entry-points-dark.png), [built-entry-points-light.png](phase-8/built-entry-points-light.png) |
| A route found with the filter, its flow from its handler | `06 · Canvas` | [built-entry-flow-dark.png](phase-8/built-entry-flow-dark.png), [built-entry-flow-light.png](phase-8/built-entry-flow-light.png) |

The built screens show Rallly's entry points as the engine reads them at the corpus pin: 65 screens, 152 API routes, 92 commands.

## Matches

- **The header** "Entry points" in Small strong with the total in Caption, and the 28 px **filter** with its `/` hint.
- **Groups in Caption** with their counts on the right; 28 px rows with a 14 px kind icon; routes and commands in Mono small, as Figma's `POST /api/items`.
- **The selected row** on `surface/selected`, in primary text.
- **⌘K's Entry points** section (Figma 16), with the same rows.

## Differences, and why

| Figma | Built | Why |
| --- | --- | --- |
| Screens named like `Item editor` | Named by their route path (`/:locale/polls`), the component muted beside it (`Page`) | Owner, 14 Nov 2026: the code has no names like Figma's; the path is what it has |
| Groups: Screens, API routes, Jobs, Events | Screens and elements, API routes, Jobs and cron, Events, CLI commands | The design brief's groups (§23); jobs and events say "Arrives in phase 11." |
| A change-state dot on some rows (`state/modified/solid`) | None | Change states come with agent sessions (phase 19); Graphite: state dots only where something actually changed |
| A support-level dot on each item (design brief §23) | A dashed circle only where an entry point isn't fully detected, its reason as its label | Never colour alone (Graphite); fully detected is the normal case and says nothing |
| No action shown on rows | **Show flow** on the row the pointer or focus is on, and the current one | The design brief's "Show flow" action, kept out of the way of names |
| Screens as flat rows | A screen opens (chevron, or arrow right) to the elements on it | The owner's "a screen expands to its elements" (phase plan) |
| A short list | Hundreds of rows, virtualized | Real projects (Twenty: 7,000 entry points); only the rows in view are in the page |
