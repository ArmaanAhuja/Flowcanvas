# Flowcanvas: run it, test it, and what's built

The one place to see how to run Flowcanvas, how to test it, and which features exist so far. It's updated at every build step. Details for each step live in `docs/build-steps.md`; phase status in `docs/STATUS.md`; how it's put together in `ARCHITECTURE.md`.

- **Last updated:** 14 Nov 2026: phase 7 merged and on staging (0.11.0); phase 8 started, branch `phase/8-entry-points`
- **Reviewed:** phase 7, milestone B (14 Nov 2026): re-read in full against the code. At every milestone this doc is re-read in full, and this line names the milestone (`pnpm docs:milestone` checks it).
- **Released (on staging):** `0.11.0`, phase 7 (checked: staging's `/api/health` reports 0.11.0, deployed by CI from `36076f4`)
- **Progress:** phases 1, 1a, 1b, 1c, 2, 3, 4, 5, 6 and 7 are accepted; 1d is in review (until a cloud provider). That's 10 of the build plan's 96 phases accepted; 8 is in progress. Stage 1's goal: see a project's real flows, from code, honestly.

## Where it runs

| Where | What works there | What it's for |
| --- | --- | --- |
| **Staging**, https://flowcanvas.ahujaarmaan7777.workers.dev | Sign-in (allowlist), projects, secrets, usage, admin, What's new, Labs. Projects say "Workspaces run locally for now" | The hosted app, built from `main` |
| **Your own computer**, `pnpm dev` | Everything on staging, **plus workspaces**: Docker containers on your laptop, with a terminal, sleep and resume, and the resource guard. In a project with its workspace running: the Code view and editor (phase 3), search and ⌘K (phase 4), Callers, Callees and references (phase 5), the graph (phase 6), and flows on the canvas with the node inspector (phase 7) | Development, and running workspaces until a cloud provider is connected |
| **Pull-request previews** | Like staging; sign-in says to use staging | Checking a change before it merges |
| **Component catalogue**, https://flowcanvas-catalogue.ahujaarmaan7777.workers.dev | Every design-system component in both themes | Design review |
| **Test reports**, https://flowcanvas-reports.ahujaarmaan7777.workers.dev | Walkthrough videos and traces for each pull request and merge | Seeing what was tested |

**Choosing where projects run** is planned for phase 48a, the local runner. It must be **seamless** for people: the same hosted site, and a project runs either on our cloud workspaces or on their own laptop, their choice (owner, 7 Nov 2026). The approach is recorded in the decisions log: the laptop dials out to us, so it opens no ports. Until then, workspaces run only through `pnpm dev`.

## Run it on your computer

**Needs:**
- Node 26 (`.nvmrc`) and pnpm 12.15 (`corepack enable`)
- Docker 28 or newer, for workspaces
- a `.dev.vars` file in the repository root, copied from `.dev.vars.example`. It holds `DATABASE_URL` (your Neon `dev` branch), `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, `VAULT_KEY` and `WORKSPACE_HOST_TOKEN`. It's git-ignored, and its values are never pasted anywhere.

```fish
pnpm install
pnpm db:status          # shows which database it will use: it must be the dev branch, not production
pnpm db:migrate         # applies any new migrations to that database
pnpm dev                # http://localhost:5173
```

`pnpm dev` starts:
- the web app (Vite)
- the control plane (the Worker in `wrangler dev`, 8787, with its once-a-minute check)
- the workspace host (127.0.0.1:8790, the only thing that talks to Docker)

If the host can't start, its log line says why: the token, Docker, or another `pnpm dev` already running.

**To sign in locally,** your email must be on the dev database's allowlist: `pnpm db:allow you@example.com --admin`.

## Test it

| Command | What it checks | Time |
| --- | --- | --- |
| `pnpm test` | <!-- count:unit -->1,138<!-- /count --> unit and component tests, with no Docker or network | about 30 s |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Lint (with the design-token rules), strict TypeScript, formatting | — |
| `pnpm test:docker` | <!-- count:docker -->49<!-- /count --> tests against real containers: isolation, the network allowlist, clone time, sleep and resume, the guard, no secret kept anywhere; (phase 3) the file list, a save refused after a terminal edit, the journal surviving a restart, a terminal edit reaching the page's events socket in about 160 ms; (phase 4) Rallly indexed in a real workspace with an edit searchable in about 300 ms, and the corpus: all six forks at their pins indexed in real workspaces, Rallly and Documenso held to under 30 s and 100 ms, 21 hand-labelled symbols checked; (phase 5) 20 labelled functions' callers and callees; (phase 6) four forks' graphs, saved and loaded under 1 s; (phase 7) each labelled function's flow and details, at its own node, each answered in under 1 s, 10 hand-labelled Documenso flows drawn exactly as labelled, and callers and callees again from the store, held to the same labels. Needs Docker 28+ and the internet. On CI as four parallel jobs (Twenty, Medusa, LibreChat, the rest); `CORPUS_ONLY=documenso` runs one project | about 4 min (CI, in parallel) |
| `pnpm test:e2e` | <!-- count:walkthroughs -->22<!-- /count --> recorded walkthroughs of each phase's *Try it*, under the production security policy (1 needs a real API: CI, or a running `pnpm dev`) | about 40 s |
| `pnpm test:perf` | The canvas with 500 nodes, panned and zoomed: frame times, long tasks, input to paint. Headless (as on CI) only catches large regressions; `PERF_REAL=1 pnpm test:perf` opens a real window on your GPU for about 30 s, which is what decides. Then (phase 4) symbol search on 100,000 names, run alone: p95 under 100 ms (13.6 ms); and (phase 7) a 60-node flow laid out by ELK, run alone: median under 1 s (56 ms) | about 50 s |
| `pnpm test:visual` | <!-- count:screenshots -->186<!-- /count --> screenshots in both themes against approved baselines, plus accessibility checks (axe): every catalogue story, and the project page's screens (empty, 1280 × 800, 500 nodes, review open, full screen, workspace popover; the Code view, a conflict, quick-open; the index's progress, the command palette; the right-click menu, Callers, Callees; Graph stats; a flow on the canvas, and a function's details) | about 4 min |
| `pnpm --filter @flowcanvas/control-plane test:idle-real` | The 10-minute idle sleep in real time, nothing faked | about 12 min |
| `pnpm size` | After `pnpm build`: the web bundle against its budgets (first load, the project page, the terminal, the editor, the dialogs, ELK's flow layout) | instant |
| `pnpm corpus:fetch` | The six corpus forks at their pins into `~/.cache/flowcanvas/corpus` (outside `/tmp`, kept across restarts), for working on the engine against real projects | about 1 min the first time |
| `pnpm workspace:resources` | Your laptop against Flowcanvas's budget | instant |
| `pnpm docs:check` | The docs against the code: the release, progress and counts here; accepted phases never "still to come", and no text dated to an old phase, anywhere in the repository (code and site text too); every path a doc names; `ARCHITECTURE.md`'s parts naming every package and source folder, and its dependencies as `package.json` has them; upgrade-later triggers that were reached saying what happened; every upgrade-later item and ADR referred to existing. `pnpm docs:update` rewrites the counts. On CI with the unit tests | about 20 s |
| `pnpm docs:milestone` | Before every milestone report, and on CI once a pull request is ready for review: `docs:check`, plus every living doc re-read at this milestone (its **Reviewed** line), every step written up in full, and every commit of the phase named in `docs/build-steps.md` | about 20 s |
| `pnpm workspace:clean` | Removes test leftovers and old workspace images; `--all --yes` removes everything of Flowcanvas's | — |

CI runs the checks (with the bundle budget), Docker (four parallel jobs), visual, canvas performance (headless) and walkthrough jobs on every pull request and every merge to `main`. It deploys each pull request's preview (the app and the catalogue) and staging from `main` itself (since phase 7's merge).

## Features, and how far each is built

✅ built and tested · 🟡 partly built, or works locally only · ⬜ planned (phase)

### Accounts and projects (phase 1c)
- ✅ **Sign in:** with GitHub or Google, limited to an allowlist. A refusal shows which account was checked, partly hidden.
- ✅ **Projects:** create one with an optional GitHub address; the list shows each project's workspace status.
- ✅ **Secrets vault:**
  - per-project secrets, encrypted
  - write-only, listed by name and never shown again
  - kept out of logs (tested with fake secrets)
- ✅ **Usage this month:** running time only, never time asleep.
- ✅ **Admin view:** people and the allowlist.

### Workspaces (phase 1d; your computer only, until a cloud provider)
- 🟡 **A workspace per project:**
  - a locked-down Docker container
  - the repository cloned at its pinned commit if it has one (Rallly opens in about 7 s)
- 🟡 **A terminal in the page,** in the project row, and in the bottom dock on the project page.
- 🟡 **Files and commands** through a typed API. It never reads `.env` files or leaves the project.
- 🟡 **For the editor (phase 3):** the project's file list from git; every read and save carries the file's version, so a save after someone else's change (the terminal, another tab) is refused instead of overwriting it; unsaved changes are kept in a journal in the workspace, outside the project, and survive a restart. A file watcher reports every change (a `sed` in the terminal arrives in about 160 ms) over a WebSocket, checked at every hop; an open page doesn't keep the workspace awake.
- 🟡 **Network rules:** five allowed hosts, through a checking proxy. Workspaces can't reach each other, your laptop or your home network (tested).
- 🟡 **Sleep and resume:**
  - sleep after 10 idle minutes; resume intact (proven in real time)
  - shown with status chips and starting and asleep cards
- 🟡 **The resource guard:** keeps Flowcanvas within your laptop's budget. It refuses, sleeps or stops only its own workspaces.
- 🟡 **Open demo project:** Rallly at its corpus commit, in one click.
- ⬜ **A cloud provider** (when chosen; upgrade-later 33).
- ⬜ **Backups and restore history** (18a).
- ⬜ **Running on your own computer from the hosted site** (48a).

### The project page and the canvas (phase 2)
- 🟡 **A project's own page** (`/p/<id>`) in the app shell, at Figma 06's sizes (tested to within 1/64 px at 1440 × 900 and 1280 × 800):
  - top bar
  - rail
  - left panel
  - canvas
  - right panel
  - bottom dock
  - review bar
- 🟡 **Panels:** they collapse and resize by mouse and keyboard. There's a full-screen canvas, and the review bar opens to 300 px. Your layout is remembered, in pixels.
- 🟡 **Your theme** (dark, light or system) applies on the project page too.
- 🟡 **Compared with Figma 06:** every difference, and why, in `docs/reports/phase-2-figma-06-differences.md`.
- 🟡 **Honest empty states** wherever content doesn't exist yet, each naming the phase it arrives in. The view switch offers Graph and Code (phase 3); Sequence arrives in phase 13.
- 🟡 **The canvas:**
  - scroll pans; Ctrl or ⌘ + scroll, or a pinch, zooms; **F** fits; **V** selects (click, or drag a box); **H** pans (as does Space + drag)
  - a minimap bottom-left and a toolbar bottom-centre, as on Figma 06
  - empty until a flow is opened (phase 7), and it says how to open one
  - the Labs **Canvas stress test** shows 500 example nodes, labelled as examples
- 🟡 **The workspace chip in the top bar** opens its facts (status, machine, since when, this month's usage, any reason) and actions (Open, Sleep now, Resume, Stop). The bottom dock's terminal follows the workspace's state.
- 🟡 **500 nodes are smooth,** measured on real hardware: panning at 120 or 60 fps, with no long tasks. Zooming in close (100% to 200%) still drops occasional frames (the build plan's phase 42, the WebGL renderer, fixes it).

### The editor (phase 3)
- 🟡 **The Code view** (Figma 11): the file tree, tabs, CodeMirror 6 with syntax highlighting (TypeScript, JavaScript, JSON, CSS, HTML, Markdown), save (Ctrl/⌘+S) that never overwrites a change made in the workspace, undo, honest binary and `.env` states, tabs remembered. Quick-open: Ctrl/⌘+P, type part of a file's name.
- 🟡 **Autosave** for when you forget: after 5 s without typing, and on switching file, view or window (a switch in the status bar). Unsaved changes are also kept in the workspace and the browser, so closing the tab loses nothing: reopening restores them, with a note.
- 🟡 **Changes from the terminal** appear in the editor at once; with unsaved changes, a banner offers **Keep mine** or **Load the workspace's version**, and nothing is overwritten silently. A file deleted in the workspace says so (Close, or Save it again). New and deleted files show in the tree.

### Search and the project index (phase 4, accepted, 0.8.0)
- 🟡 **The project index:** every TypeScript, JavaScript, CSS, JSON, HTML, Markdown and MDX file is parsed in the workspace, and every other file is counted. Only changed files are parsed again, and edits are searchable within about a third of a second. Rallly is ready about 3 s after the project opens, and Documenso about 4 s.
- 🟡 **⌘K (Ctrl+K), or Search in the top bar:** symbols (functions, components, classes, methods, interfaces, types, enums, constants, Markdown headings) with their kind and place, then files; `#` for files only. Enter opens the top result, and a symbol opens in the Code view with the cursor on its name.
- 🟡 **Progress:** a chip ("Indexing 61%") with the entry points and on the canvas, and a line in the Code view's status bar, while the first index runs.

### Design system and quality (phases 1a, 1b)
- ✅ **Graphite tokens:**
  - generated from `packages/tokens/source` into CSS, plus TypeScript values for code that needs numbers
  - dark and light themes, following your system's setting or your choice
- ✅ **Components:**
  - Button, Tag, Input, Toggle, Menu, Tooltip, Tabs
  - Panel, Popover, Flow node, Workspace status
  - Top bar, Rail, Review bar, Canvas toolbar
  - Editor tabs, File tree, Breadcrumb, Status bar (phase 3)
  - Search trigger, Quick open, Command palette (phase 4)
  - Context menu, Calls panel, Provenance glyph (phase 5)
  - Graph stats (phase 6)
  - Decision node, Flow stub, Node details (phase 7)
  - all in the catalogue
- ✅ **What's new** (from the CHANGELOG), Labs switches (Canvas stress test; Graph stats, phase 6), and the build's version and commit on the page.
- ✅ **A strict security policy:** no inline scripts or styles, previews per pull request, and telemetry off.

### TypeScript semantics (phase 5, accepted, 0.9.0)
- **What it does:**
  - ✅ **Right-click a function's name** in the Code view: Go to definition (F12), Find references (Shift+F12), Callers, Callees.
  - ✅ **The inspector's Calls tab:** Callers (calls and renders), Callees (the project's, Unresolved with why, Built-in collapsed), References; each row says how it's known, and opens its place.
  - ✅ **Through path aliases, workspace packages and re-exports,** without installing anything; packages that aren't installed are shown as unresolved, never guessed.
  - ✅ **Proof:** `pnpm --filter @flowcanvas/workspace-host exec vitest run src/corpus.docker.test.ts` (20 hand-labelled functions, exact); walkthrough `pnpm --filter @flowcanvas/e2e exec playwright test try-it/phase-5.spec.ts`.
  - **Try it:** `pnpm dev`, open Rallly with its workspace running, Code view, open `apps/web/src/features/poll/mutations.ts`, right-click `createPoll` (line 98) → Callers: the two API route modules, each at its lines.

### The graph model (phase 6, accepted, 0.10.0)
- **What it does:**
  - ✅ **The flow graph** of each project, built in its workspace after indexing and kept up to date: code units and calls, each resolved or unknown, saved as versions in `/workspace/.flowcanvas/graph.db`.
  - ✅ **Labs → Graph stats** in the inspector's Details tab: nodes and edges by kind, how edges are known, built-ins counted apart, build, save and load times.
  - ✅ **Files no tsconfig includes** are understood (LibreChat's Express backend), for the Calls tab too.
  - ✅ **Every later feature names its phase** on the page.
  - ✅ **Proof:** `pnpm --filter @flowcanvas/workspace-host exec vitest run src/corpus.docker.test.ts` (the four forks' graphs, save and load under 1 s, 26 labelled functions); walkthrough `pnpm --filter @flowcanvas/e2e exec playwright test try-it/phase-6.spec.ts`.
  - **Try it:** `pnpm dev`, Labs → Graph stats on, open Rallly with its workspace running, read the Details tab.

### Flows and the inspector (phase 7, accepted, 0.11.0)
- **What it does:**
  - 🟡 **A function's flow on the canvas** (workspaces locally): right-click its name in the Code view → Show flow, ⌘K → Flows, or Show flow on the Calls tab. Opened at 100% on the function, near the top; **F** fits the whole flow. Top to bottom, as Figma 06: each function with its folder, file and line; decisions as diamonds with their conditions (`if`, ternaries, `&&`/`||`/`??`, `switch`, `catch`), outcomes on the edges, a `catch` as a thin red path; unknown calls as one open stub per function; "N more calls not shown" past 60 functions; the name and counts top left. Laid out by ELK in a Web Worker, each edge drawn along the route ELK chose around the nodes.
  - 🟡 **The node inspector:** click a function for its signature, inputs and output, decisions, throws and awaits, and unresolved calls; a decision for its condition and where each outcome leads. Open code (or a double-click) opens its line.
  - ✅ **Worked out once, stored, reused** (ADR 0029): the graph pass stores each file's functions, details and calls in `/workspace/.flowcanvas/facts.db`, so flows and details answer in milliseconds, even after a restart; the Calls tab answers from it too (2.9 ms against 7.8 ms on Rallly; 48 ms against 556 ms on Documenso), with TypeScript for members' callers and for files being edited. The page keeps answers and layouts per graph version, so going back is instant.
  - ✅ **Proof:** 10 Documenso flows, labelled by reading the code, drawn exactly as labelled in real workspaces (`pnpm --filter @flowcanvas/workspace-host exec vitest run src/corpus.docker.test.ts`, row `labelledFlows`: 10 of 10 on CI); walkthrough `pnpm --filter @flowcanvas/e2e exec playwright test try-it/phase-7.spec.ts`; screens of a flow and a function's details in both themes.
  - **Try it:** `pnpm dev`, create a project with Documenso's corpus fork (its address is in `corpus/manifest.json`) and start its workspace; once the graph is built, ⌘K → `deleteFolder` → Show the flow; click getTeam, read the inspector, Open code.

### Coming next
- **Phase 8, entry-point detection:** React event props, pages and routes, Next.js server actions and API routes, Express routes and package.json scripts, listed in the left panel (Figma 06); click one to open its flow.
- **After that:** stage 1 goes on with the links from the UI to the API (phase 9), data and external services (phase 10) and background work (phase 11); stage 2 adds live frames of the running app.
