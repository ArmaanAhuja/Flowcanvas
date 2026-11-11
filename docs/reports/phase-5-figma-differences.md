# Phase 5: Figma's inspector, its context menu, and what's built, side by side

For the owner's review by eye. Figma is the layout reference; Graphite outranks it on everything visual (CLAUDE.md section 2), and colour values come from the tokens. The screen baselines (`e2e/visual/__screenshots__/screens-code-context-menu-*`, `screens-code-callers-*`, `screens-code-callees-*`) catch changes from what's built; this list says how what's built differs from Figma, and why.

| Screen | Figma | Built |
| --- | --- | --- |
| The inspector's tabs | `06 · Canvas`, right panel: [figma-06.png](phase-2/figma-06.png) (generator: `flowcanvas-screens.js`, `inspectorLLM`) | Every project screen, e.g. [built-callers-dark.png](phase-5/built-callers-dark.png) |
| The Calls tab's contents | Not drawn: Figma names the tab only. The design brief (section on the inspector) calls it "Connections (callers and callees)" | [built-callers-dark.png](phase-5/built-callers-dark.png), [built-callers-light.png](phase-5/built-callers-light.png), [built-callees-dark.png](phase-5/built-callees-dark.png) |
| The right-click menu | `27 · Prompt from a flow or event`, the flow's context menu (generator: `flowcanvas-prompting-screens.js`, `menuBox`) | [built-context-menu-dark.png](phase-5/built-context-menu-dark.png), [built-context-menu-light.png](phase-5/built-context-menu-light.png) |

## Matches

- **The tabs:** Details, Runs, Changes, Calls, in that order; Small, the selected one Small strong in `text/primary` with a 2 px `accent/solid` underline; 16 px apart; a bottom border under the row.
- **The menu:** the shared Menu's look (phase 2): Graphite's popover (`surface/hover`, a subtle border, 8 px radius, the popover shadow), 28 px rows, the highlighted row on `surface/selected`, shortcuts in a key on the right. It opens at the pointer, as Figma's floats beside what was clicked.

## Differences, and why

| Figma | Built | Why |
| --- | --- | --- |
| Runs and Changes show counts ("Runs 12", "Changes 1") | Runs and Changes are shown, dimmed, with "Arrives in a later phase" as their tooltip, and no counts | Runs arrive with tracing (stage 2) and Changes with agent sessions (stage 3); no count is shown that the system didn't derive (CLAUDE.md rule 3) |
| The tab is "Calls"; the design brief says "Connections" | "Calls" | Figma outranks the design brief (CLAUDE.md section 2); the owner chose the Calls tab (decisions log, 12 Nov 2026) |
| The Calls tab's contents aren't drawn | Callers / Callees / References as a segmented switch; the function's name, kind and place; rows with a provenance glyph, the name, "calls" or "renders", the kind and the place; callees grouped as the project's, Unresolved (with why) and Built-in (collapsed) | The owner's decisions 1, 3, 5 and 7 (12 Nov 2026); Graphite's provenance forms (a solid line for resolved, an open stub ending in a hollow circle for unresolved), with the word beside it so meaning never rests on form alone |
| Screen 27's menu has a label row, an icon on every row, sub-labels and a divider | Four rows, no label row, no icons: Go to definition (F12), Find references (Shift+F12), Callers, Callees | It's the Code view's menu, not a flow's: the name under the pointer is the label, already highlighted in the editor; icons would repeat the words. The flow and node menus arrive with the canvas's own (phase 6 onwards) |
| — | A call's other places as "N places: line 11, line 16" under its row, each at least 24 × 24 px | Not in Figma; axe's target-size check (WCAG 2.2) failed the first, tighter version |

Light theme: Figma's inspector is dark only. The light theme's baselines are in `e2e/visual/__screenshots__/screens-code-*-light-linux.png`.
