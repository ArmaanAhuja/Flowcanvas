# Phase 2 — Canvas and app shell: report

- Version: `0.6.0`
- Branch: `phase/2-canvas-app-shell`; PR: see `docs/STATUS.md`
- Dates: 7 Nov 2026
- Status: **in review**, waiting for the owner's acceptance.

## From the build plan

- **Build:** a React Flow canvas with pan, zoom, minimap and selection; the app shell from Figma 06 (top bar, rail, side panels, review bar) with placeholder content; panels that dock and collapse.
- **Done when:** 500 dummy nodes pan and zoom smoothly; the layout matches Figma 06.
- **Try it:** pan, zoom and collapse panels; compare with Figma 06.

**Owner decisions (decisions log, 7 Nov 2026):**
- **Honest empty states, not placeholders** (rule 10). The 500 dummy nodes appear only in the performance test, the catalogue and the Labs switch **Canvas stress test**, labelled as examples.
- **Docked panels collapse and resize.** Moving them is upgrade-later 40.
- **The projects list stays at `/`;** a project opens at `/p/<id>`.
- **Close zoom is accepted as a known issue** (below), fixed by the build plan's phase 42.
- **The review bar stays at the bottom,** although Figma 06 alone shows it at the top.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| React Flow canvas: pan, zoom, minimap, selection | ✅ | `apps/web/src/canvas/FlowCanvas.tsx`. Scroll pans; Ctrl or ⌘ + scroll, or a pinch, zooms; Space + drag pans; **F** fits; **V** selects (click, or drag a box); **H** pans. Minimap bottom-left, toolbar bottom-centre. Walkthrough "phase 2 · Try it: pan, zoom and select on the canvas"; unit tests in `canvas/shortcuts.test.ts` and `canvas/examples.test.ts` |
| The app shell from Figma 06 | ✅ | Top bar, rail, left panel, canvas, right panel, bottom dock, review bar (`apps/web/src/shell/Shell.tsx`), built from catalogue components (TopBar, Rail, ReviewBar, CanvasToolbar, segmented Tabs) |
| Placeholder content | ✅ as honest empty states | Each region says what will appear and when (owner decision). The workspace chip, its popover and the terminal in the dock are real |
| Panels that dock and collapse | ✅ | Collapse, resize by mouse and keyboard (the APG window splitter), a full-screen canvas, the review bar opening to 300 px, the layout kept per browser in pixels. Walkthrough "panels collapse, resize by mouse and keyboard, and keep their layout" |
| **Done when:** 500 dummy nodes pan and zoom smoothly | ✅ with one known issue | `e2e/perf/canvas.perf.spec.ts`, in a real window on the owner's laptop (Intel Arc, 120 Hz): panning and overview zoom at a median of 8.3 ms per frame, p95 8.4 to 16.8 ms, **no long tasks**, under 1% of inputs over 16 ms to paint. **Known issue:** zooming in close (100% to 200%) has a p95 of 33.3 ms (target under 25), accepted by the owner. CI's `perf` job runs it headless for regressions |
| **Done when:** the layout matches Figma 06 | ✅ | **Geometry:** every region within 0.1 px of Figma's sizes at 1440 × 900 and 1280 × 800 (walkthrough "a project opens in the app shell, laid out like Figma 06"). **Screens:** 12 approved baselines in both themes, with axe (`e2e/visual/screens.spec.ts`). **By eye:** the owner's review with `docs/reports/phase-2-figma-06-differences.md` |
| **Try it** | ✅ recorded | `e2e/try-it/phase-2.spec.ts`: five walkthroughs, recorded on every run |

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173), signed in:
1. Click a project's name. Its page opens at `/p/<id>`, in the app shell.
2. Turn on **Labs → Canvas stress test**. 500 example nodes appear, with a banner that says they're examples.
3. **Pan:** scroll, or hold Space and drag. **Zoom:** Ctrl or ⌘ + scroll, or the toolbar's − and +. Press **F** to fit.
4. **Select:** click a node, or drag a box around several. Press **F** to fit the selection.
5. **Collapse panels:** the rail's **Entry points** button, the top bar's **Right panel** button, and **Full-screen canvas**. Drag a panel's edge, or focus it and use the arrow keys.
6. Reload: the layout is as you left it.
7. Click the workspace chip: its facts and actions. Open it, then click **Terminal** in the rail: the terminal is in the bottom dock.
8. Compare with Figma 06 using `docs/reports/phase-2-figma-06-differences.md`.

**On staging** (after the merge): the same page and canvas. There's no workspace chip, and the dock says "Workspaces run locally for now" (no workspaces there until a cloud provider, upgrade-later 33).

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 632 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 15 (5 new) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 90: 78 catalogue stories, 12 screens | `pnpm test:visual` |
| Canvas performance | 1 (6 scenes) | `PERF_REAL=1 pnpm test:perf` (real window); `pnpm test:perf` headless, also in CI |
| Docker (real containers) | 42 | `pnpm test:docker` (unchanged this phase) |
| Bundle size | 4 budgets | `pnpm size`, also in CI |

**Bundle (gzip):** first load 149.4 kB (budget 160; it includes the changelog for What's new); the project page 82.3 kB (95), loaded when a project opens; the terminal 86.0 kB (95), loaded when the dock opens one.

**Screens:** Figma 06 and what's built are side by side in `docs/reports/phase-2/`; the baselines are `e2e/visual/__screenshots__/screens-*`.

## Deviations from plan and why

1. **Empty states instead of placeholder content** (owner decision; rule 10, no placeholders).
2. **Fewer tools than Figma 06** in the rail and the top bar: only what works. Each missing one is listed with the phase that brings it in the differences list.
3. **The canvas toolbar** has zoom out, zoom in and fit instead of comment and grid. Comments arrive with phase 77, and the zoom buttons make zoom reachable without a trackpad.
4. **Two buttons not on Figma 06:** the right panel and the full-screen canvas, in the top bar, because they need a way in and out.
5. **The review bar is at the bottom,** as on every other Figma screen and in the brief (owner decision).
6. **Nodes don't drag.** Positions will come from the layout engine (phase 7, ELK); dragging nodes isn't in this phase's scope.

## Decision records added

- 0020 the canvas and panels: React Flow 12 and `react-resizable-panels`, checked under our CSP, with two addenda (layouts kept in pixels; what the performance work found)

## Known issues and follow-ups

- **Close zoom isn't fully smooth:** p95 33 ms between 100% and 200%, where nodes enter and leave the page. The test holds it to its own named limit, so it can't get worse unnoticed. Fixed by the build plan's **phase 42** (the WebGL renderer with level of detail).
- **Found and fixed in step 8:** your theme choice wasn't applied on a project's page. It's now applied at the app's root, with a test.
- **Movable panels:** upgrade-later 40.
- **Fixed at the PR:** CI's headless performance job failed on its first run because the test wrote its results into `e2e/reports-data/`, which is git-ignored and so missing on a fresh checkout. The test now creates it. The frame times on CI were within limits (16.7 ms median, no long tasks).

**Upgrade-later review at phase end:**
- **Closed this phase:** 4 (the web app's TypeScript settings split into browser, Node and tests; Node APIs no longer type-check in browser code) and 18 (the bundle-size budget, in CI).
- **The file was cleaned up** (owner, 7 Nov): it now holds only gaps we left, not build-plan items. 27 entries.
- None of the rest is due before phase 3.

## After the merge (owner)

No database migrations this phase. On staging, check:
1. A project's name opens its page at `/p/<id>`, and a reload there stays on it.
2. The canvas says "Flows appear here once the project is analysed."
3. What's new shows 0.6.0.

## Next phase preview

**Phase 3, open a repo and edit:**
- Monaco in the browser, with the buffer synced to the workspace
- tabs, save, undo and quick-open
- an autosave journal every few seconds, and a file watcher

**Done when:** edits survive closing the tab and reopening it, and an edit made in the terminal appears in the editor.
