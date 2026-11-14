# Phase 8 — Entry-point detection: report

- Version: `0.12.0`
- Branch: `phase/8-entry-points`; PR #22
- Dates: 14 to 15 Nov 2026
- Status: **accepted** by the owner on 15 Nov 2026.

## From the build plan

- **Build:** detect React event props, pages and routes, Next.js server actions and API routes, Express routes, package.json scripts; the entry points panel.
- **Done when:** at least 90% of hand-listed entry points found across the 4 forks.
- **Try it:** the left panel lists screens, routes, jobs and events (Figma 06); click each to open its flow.

**Owner decisions** (decisions log, 14 Nov 2026):
1. **Every framework the four forks use is detected:** Next.js (pages, route handlers, server actions), React Router, Express, Hono, tRPC, NestJS controllers and GraphQL resolvers, React event props, and package.json scripts.
2. **The bar, stricter than the plan's 90%:** 100% recall for convention-based kinds (file and config routes, decorators, scripts); at least 95% per fork for routes registered in code and event handlers; 100% precision; every miss explained here and shown on the page as not fully detected, never guessed.
3. **Labels, option B:** every entry point in Rallly and Documenso; in LibreChat and Twenty, every entry point in a fixed set of modules covering each framework; the event handlers in 5 chosen screens per fork. Written by Claude by reading the code.
4. **A screen is named by its route path,** its component muted beside it.
5. **⌘K gets an Entry points section and `/` for routes** (Figma 16).
6. **Milestone A's answers:** test and story files aren't entry points; an environment base path is written `{NEXT_PUBLIC_BASE_PATH}/…` and counts as found (its value never read); a Hono app served through a rewrite keeps its registered path, marked so; the engine reads `jsconfig.json`.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| React event props | ✅ | `<button> onClick` and the like, listed under their screen; a handler that isn't the project's code (a `useState` setter) says why there's no flow |
| Pages and routes | ✅ | Next.js app and pages routers, React Router (config, flat routes, `route.tsx`), NestJS controllers and GraphQL resolvers |
| Next.js server actions and API routes | ✅ | Route handlers by method; server actions by their exported function |
| Express routes | ✅ | Routers joined across files through `app.use` mounts; a router no mount reaches is never a root |
| Hono and tRPC | ✅ | Hono apps through delegation and factories; tRPC procedures through nested routers, unreadable values listed as `key.*` |
| package.json scripts | ✅ | Each package's scripts as CLI commands |
| The entry points panel | ✅ | React Aria tree, virtualized; groups from the design brief; jobs and events say "Arrives in phase 11."; filter and `/`; Show flow from what handles each |
| **Done when:** at least 90% found | ✅ **above the owner's stricter bar on every fork** | 2,118 hand labels (`corpus/labels/entry-points.json`), compared in real workspaces on CI; table below |
| **Try it** | ✅ recorded | `e2e/try-it/phase-8.spec.ts`: Rallly's groups and counts, a screen opened to its elements, an element with no flow saying why, the filter, Show flow, ⌘K after `/` |

**In real workspaces on CI** (run 43631227043, `ff57c8e`, 2 CPUs and 4 GiB each):

| Fork | Entry points | Convention | Code-registered | Not fully detected | False finds | Each opens its flow at its handler | Slowest flow | Listing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Rallly** | 856 | 279 of 279 | 90 of 93 (96.8%) | 3 | 0 | 267 of 267 | 24 ms | 13 ms |
| **Documenso** | 2,392 | 308 of 308 | 443 of 443 | 0 | 0 | 649 of 649 | 23 ms | 13 ms |
| **LibreChat** | 2,751 | 235 of 235 | 271 of 271 | 0 | 0 | 266 of 266 | 36 ms | 19 ms |
| **Twenty** | 6,567 | 311 of 311 | 178 of 178 | 0 | 0 | 277 of 277 | 48 ms | 44 ms |

Entry points without a handler in the project (scripts, and handlers that are a package's code) aren't counted in "opens its flow": the panel says why for each.

**Every miss, explained:** Rallly's three OAuth integration routes are made by a factory whose base path is its argument (`'/api/integrations'` at its one call). The engine lists them as `/:unknown/…`, marked not fully detected with the reason; it doesn't guess the argument. These are the only misses across the four forks.

**Graphs** (the same run): Rallly 6,723 nodes in 15 s, Documenso 13,666 in 21 s, LibreChat 66,377 in 78 s, Twenty 104,867 in 96 s (saved in 150 ms, loaded in 280 ms). LibreChat's grew from 49 s with `jsconfig.json` (its `~/` imports now resolve). Medusa's is a known issue below.

Like phases 1d to 7, **workspaces run only on the owner's computer** until a cloud provider is connected (upgrade-later 33). CI's walkthrough uses the shared fake workspace answering with the engine's own output for Rallly at its pin.

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173):
1. Create a project with Rallly's corpus fork (`https://github.com/ArmaanAhuja-7777/rallly`; its pin is in `corpus/manifest.json`) and start its workspace. Wait for the graph (about 20 s).
2. The left panel lists **Screens and elements** (65), **API routes** (152), **Jobs and cron** and **Events** ("Arrives in phase 11.") and **CLI commands** (92).
3. Open `/:locale/polls` with its chevron (or arrow right): its elements. Choose `<Popover> onOpenChange`: it says its handler is `setOpen`, React's code, so there's no flow.
4. Press `/`, type `private/polls`, and choose **Show flow** on `POST /api/private/polls`: the flow from its handler on the canvas.
5. Press ⌘K and type `/api/private/polls`: only entry points; choose one to open its flow.

**On staging** (after the merge): What's new shows 0.12.0; entry points need a workspace, so they work locally only for now.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 1,220 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 23 (1 new) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 194 (EntryPointsPanel's stories, and two new screens: the panel and a route's flow) | `pnpm test:visual` |
| Docker (real containers) | 49 (the corpus test now also holds each fork to the entry-point bar and opens every labelled entry point's flow) | `pnpm test:docker` |
| Performance | 3, unchanged | `pnpm test:perf` |
| Bundle | 11 budgets, all within | `pnpm size` |

**Bundle (gzip):** first load 151.4 kB of 160; the project page 110.6 kB of 115 (raised from 110 for its entry-point wiring, 1.6 kB); the panel 3.6 kB and React Aria's virtualizer, shared by both left panels, 22.8 kB, each in its own chunk (see deviations).

**Screens:** `docs/reports/phase-8-figma-differences.md`, with the built screens in `docs/reports/phase-8/`.

## Deviations from plan and why

1. **More frameworks than the plan names** (owner, decision 1): Hono, tRPC, React Router and NestJS, since the forks use them; without them most of their entry points would be missing.
2. **A stricter bar** (owner, decision 2), met on every fork.
3. **Graph format 4:** an entry point's node carries its details, so the panel and ⌘K answer from the stored graph (ADR 0030 §5).
4. **Imports reach a package's source when its exports name unbuilt files** (ADR 0026 addendum): Twenty's `twenty-shared/types` resolved only that way. It costs Medusa's graph time (known issues).
5. **The panel loads in its own chunk** (found at the close): CI's bundle budget caught the page's chunk at 135.8 kB against 110, since the panel brought React Aria's tree and virtualizer into it. Split as the file tree is; the page's budget went to 115 for its 1.6 kB of entry-point wiring, which phase 7's report had foreseen.

## Decision records added

- 0030 entry points (with addenda: the detectors' rules found on the forks, the graph pass, the owner's answers to milestone A, what the hand labels found).
- 0026 addenda: `jsconfig.json`, and built exports followed to their source.

## Known issues and follow-ups

- **Medusa's graph takes about three times as long as in phase 7** (141 s on CI, against 44 s). Measured locally on 15 Nov: 169 s with built exports followed to their source, 65 s without, for 42 more nodes (36,217 against 36,175). Following `dist` exports pulls other packages' whole source into each of Medusa's many programs; the entry pass itself is 2.7 s of it. No test or budget fails (Medusa isn't one of the four forks and the graph builds in the background), but the first graph is slower. A question below.
- **Workspaces run on the owner's computer only** (upgrade-later 33).
- **Jobs, cron and events** are phase 11; the panel says so.
- **Change-state dots on entry points** come with agent sessions (phase 19).

**Upgrade-later review at phase end:** re-read in full; no item's trigger was reached in this phase, and nothing new was deferred.

## Questions for the owner

1. **Medusa's graph time.** Recommended: in phase 9, follow a built export to its source only for the files actually imported (instead of the package's whole source), and hold every fork's graph time to a recorded figure in the Docker test so a regression fails. The alternative is to fix it now, before merging phase 8.

## CI

The draft PR (#22) ran CI on every push.
- **Milestone A** (steps 0 to 3) was green on its last commit after fixes (a filtered lint run had missed workspace-host; the docs counts).
- **Milestone B** (steps 4 to 6) was green on `507e10f` (run 43605623627).
- **Milestone C:** `ff57c8e` was red on the bundle budget only; every other job green. Fixed in `9cd17fb`. The local fast suites now include the build and the budget.
- **The close** (`51ab01b`) was red on one screen: `project-entry-flow` waited for a row the virtualized panel had left out of the page, once the panel loaded lazily. Fixed in the test (`9d00267`), which passed 20 of 20 runs locally.
- **Closing commit:** see the PR's checks.

## Next phase preview

**Phase 9, UI → API connector:**
- **Build:** link `fetch`, axios, tRPC and server-action calls to their route handlers by URL, method and params
- **Done when:** a form submit's flow crosses into the right handler in all 4 forks
- **Try it:** in Rallly, open the "Create poll" submit; the flow continues into the API handler
