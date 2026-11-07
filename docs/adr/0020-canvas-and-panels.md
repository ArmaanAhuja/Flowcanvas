# 0020 — The canvas and the shell's panels: React Flow 12 and react-resizable-panels

- Status: accepted
- Date: 7 Nov 2026
- Phase: 2, step 1

## Context

Phase 2 builds the app shell from Figma 06 and a canvas with pan, zoom, minimap and selection. *Done when:* 500 dummy nodes pan and zoom smoothly, and the layout matches Figma 06. The build plan names React Flow (a WebGL layer comes later). The shell's side regions must collapse and resize, by mouse and keyboard. Everything has to work under our Content-Security-Policy (`style-src 'self'`, no inline styles), which xterm.js didn't without a shim (ADR 0017).

## Options considered

- **Canvas:**
  - **React Flow 12** (`@xyflow/react`, MIT): the build plan's choice. It renders nodes as React components, so our `FlowNode` becomes a node type as it is.
  - A custom SVG or canvas renderer: more work for the same features now, and no WebGL benefit until the WebGL layer.
- **Panels:**
  - **`react-resizable-panels`** (MIT): collapsible, resizable groups with keyboard-operable separators, the APG window-splitter pattern.
  - A hand-made CSS grid with our own drag and keyboard code: fewer dependencies, but resizing, collapse, minimum sizes and keyboard handling are easy to get subtly wrong.

## What the spike found (7 Nov 2026, built app, deployed CSP, 1440 × 900)

- **CSP: no violations, no console errors.**
  - React Flow's styles come from its own static CSS file.
  - The panels write theirs into constructed stylesheets (`adoptedStyleSheets`), which the policy allows (ADR 0017).
  - React Flow's only `innerHTML` uses are in its UMD builds; Vite uses the ESM build, which has none.
- **500 `FlowNode`s, fast pan and zoom (slow motion off):** main-thread frames median 16.7 ms (60 fps), 95th percentile 16.8 ms, worst 33.4 ms, and **no long tasks**. With 0 nodes: 16.7, 16.7 and 16.8 ms.
- **Input to paint was about 35 ms per event at 500 nodes, against 19 at 0.** Headless Chromium paints in software (no GPU), and Playwright waits for each event to be painted. So painting is checked on real hardware (a GPU, in a real window) in step 7.
- **Two measuring traps:**
  - The try-it walkthroughs run with `slowMo: 500`, so input timing must turn it off.
  - `requestAnimationFrame` only shows the main thread, not what's painted.

## Decision

- `@xyflow/react` **12.12.0** and `react-resizable-panels` **4.14.8**, pinned in the catalog.
- Both are releases that had been out for a while, rather than the newest: the panel library publishes every day or two, and its newest was a day old.
- React Flow is loaded with the project page only, never with the projects list.

## Consequences

- `FlowNode` (`packages/ui`) is drawn as a React Flow node type, so the catalogue and the canvas show the same component.
- **Real frame smoothness is measured in step 7** in a real browser window with a GPU on the owner's laptop. CI's headless runs report numbers but fail only on large regressions.
- A WebGL layer, if needed later (thousands of nodes), sits beside React Flow, as the build plan says.

## Addendum (7 Nov 2026, step 4): the layout is saved in pixels, by us

The panel library saves layouts as **percentages** (`useDefaultLayout`). A 320 px panel saved at 1440 wide would come back at another width after a reload at 1280, which goes against Figma's fixed pixel sizes. It also rescales by percentage while the window is resized, even with `groupResizeBehavior: "preserve-pixel-size"`: a 248 px panel became 247.81 px at 1280.

So the shell (`apps/web/src/shell/Shell.tsx`):
- saves each region's **last open size in pixels** and whether it's open (`flowcanvas-shell-layout`)
- checks the saved values against each region's limits when reading them back, and falls back to the defaults
- passes those pixels as the panels' default sizes
- when a panel is reopened, returns it to its last size, not to the minimum
- **puts open panels back at their saved pixels whenever the window resizes**

The library still does what it's good at: dragging, keyboard splitters, limits and collapsing. A sliver of a pixel (1/64 px, the browser's layout unit) can remain because the library sizes panels as flex proportions; the geometry test allows under 0.1 px.

