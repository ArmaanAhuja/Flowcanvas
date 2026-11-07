# Phase 2: Figma 06 and what's built, side by side (decision A5)

For the owner's review by eye. Figma is the layout reference (decision A5; owner decision 29 Oct 2026: not compared automatically). The visual baselines in `e2e/visual/__screenshots__/screens-*` catch changes from what's built; this list says how what's built differs from Figma, and why.

- **Figma:** `06 · Workspace · after session` (node 24:2554), 1440 × 900: [figma-06.png](phase-2/figma-06.png)
- **Built, empty project:** [built-empty-dark.png](phase-2/built-empty-dark.png)
- **Built, Labs stress test (500 example nodes):** [built-stress-test-dark.png](phase-2/built-stress-test-dark.png)
- **Prototype (slide 6, `docs/reference/screens/Screenshot From 2026-10-26 15-10-39.png`):** cropped to the body, without the top bar and review bar. What it shows matches Figma 06, so it adds no differences.

## The one question for the owner

**Where the review bar goes.** On Figma 06, and only there, it's a 40 px bar **at the top**, under the top bar (y 40), and the body starts at y 80. Every other screen with a review bar (04, 07 to 16, 19, 22 to 30, 32 to 35, 37; 10 has it open, 300 px from the bottom), the Figma generator script (`shell()` adds it after the body, with a top border), and the design brief ("a bottom review bar") put it **at the bottom**. What's built follows those: at the bottom, opening upwards to 300 px.

Recommendation: keep it at the bottom; Figma 06 looks like a one-off edit. If it's meant, all the other screens and the brief change with it.

## Matches (tested)

The geometry walkthrough (`e2e/try-it/phase-2.spec.ts`) checks these to within 0.1 px at 1440 × 900 and 1280 × 800:

| Region | Figma 06 | Built |
| --- | --- | --- |
| Top bar | 40 px | 40 px |
| Rail | 44 px | 44 px |
| Left panel | 248 px | 248 px |
| Canvas | 788 px wide | 788 px wide |
| Right panel | 360 px | 360 px |
| Review bar | 40 px (at the top: see the question) | 40 px, at the bottom; 300 px open |
| Minimap | 140 × 84, 20 px from the canvas's left and bottom | the same |
| Canvas toolbar | centred, 16 px from the bottom | the same |

## Differences, and why

**Left out because the content doesn't exist yet** (honest empty states, owner decision 7 Nov 2026; rule 10, no placeholders):

| Where | Figma 06 shows | Built shows | Arrives with |
| --- | --- | --- | --- |
| Left panel | Entry points with a count, a filter, and screens, API routes, jobs and events | "Entry points appear here once the project is analysed." | Stage 1 (phases 4 onwards) |
| Canvas | Flows, live frames, a breadcrumb with edge counts | "Flows appear here once the project is analysed." (Labs: 500 labelled example nodes) | Flows: stage 1. Live frames: stage 2 |
| Right panel | The inspector (a node's details, runs, changes) and the agent | "Select something on the canvas to see its details here." | Inspector: stage 1. Agent: stage 3 |
| Review bar | Tabs Changed, Affected, Tests, Observed, Unverified with counts; the session; Revert step, Compare, Accept | "No agent session yet." and Show review | Stage 3 |

**Top bar:**

| Figma 06 | Built | Why |
| --- | --- | --- |
| App icon, project name with a menu (chevron) | "Flowcanvas" (a link to your projects), then the project name | There's no project switcher yet; the link is the way back |
| Branch and commit (`main a3f9c21`) | Not shown | Phase 34, the git panel (Figma 13) |
| Search with ⌘K | Not shown | Phase 4 (symbol search) |
| Workspace chip "Running · 4 cores" | Chip with the status only; the machine is in its popover | The machine is a fact in the popover (step 6); the chip stays short |
| Share | Not shown | Phase 77, shared canvases (Figma 19) |
| Avatar | Not shown | The account lives on the projects page for now |
| Not on Figma | Right panel and full-screen buttons | The right panel has no rail button on Figma 06, and the full-screen canvas needs a way in and out |

**Rail:**

| Figma 06 | Built | Why |
| --- | --- | --- |
| Eight tools (overview, entry points, files, search, source control, tests, debugger, terminal, packages) and account and settings at the bottom | Entry points and Terminal | Only tools that work are shown; the rest arrive with their phases |

**Canvas toolbar:**

| Figma 06 | Built | Why |
| --- | --- | --- |
| Select, Pan, Comment, Grid, 100% | Select, Pan, Zoom out, the level, Zoom in, Fit | Comments arrive with phase 77. Zoom buttons and Fit make zoom reachable without a trackpad (keyboard and accessibility); the grid toggle wasn't in the phase's scope |

**Also different:**
- **Bottom dock (terminal):** not on Figma 06 (it's on Figma 12). Closed by default; the Terminal rail button opens it.
- **Labs banner:** "Canvas stress test (Labs): 500 example nodes, not your project's flows." Only with the Labs switch on; it's not on Figma, because Figma shows real flows.
- **Dot grid:** 16 px, `border/subtle`, as in the generator script. It isn't visible in Figma's rendered 06 at this size.

## Not checked

- Pixel-by-pixel comparison with Figma: not done, by decision (29 Oct 2026). The owner reviews by eye.
- The light theme against Figma: Figma 06 is dark only. The light theme uses the same tokens, and its baselines are in `e2e/visual/__screenshots__/screens-*-light-linux.png`.
