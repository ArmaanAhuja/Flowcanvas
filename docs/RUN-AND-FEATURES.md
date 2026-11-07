# Flowcanvas: run it, test it, and what's built

The one place to see how to run Flowcanvas, how to test it, and which features exist so far. It's updated at every build step. Details for each step live in `docs/build-steps.md`; phase status in `docs/STATUS.md`; how it's put together in `ARCHITECTURE.md`.

- **Last updated:** 7 Nov 2026, phase 2 step 7 (branch `phase/2-canvas-app-shell`)
- **Released (on staging):** `0.5.0`, phase 1d
- **Progress:** phases 1, 1a, 1b and 1c are accepted; 1d is in review; phase 2 is in progress. That's 5 of the build plan's 96 phases. Stage 0's goal: open a repository in a workspace, see it on a canvas, edit it, and answer "what calls this?"

## Where it runs

| Where | What works there | What it's for |
| --- | --- | --- |
| **Staging**, https://flowcanvas.ahujaarmaan7777.workers.dev | Sign-in (allowlist), projects, secrets, usage, admin, What's new, Labs. Projects say "Workspaces run locally for now" | The hosted app, built from `main` |
| **Your own computer**, `pnpm dev` | Everything on staging, **plus workspaces**: Docker containers on your laptop, with a terminal, sleep and resume, and the resource guard. The project page with the app shell (phase 2) | Development, and running workspaces until a cloud provider is connected |
| **Pull-request previews** | Like staging; sign-in says to use staging | Checking a change before it merges |
| **Component catalogue**, https://flowcanvas-catalogue.ahujaarmaan7777.workers.dev | Every design-system component in both themes | Design review |
| **Test reports**, https://flowcanvas-reports.ahujaarmaan7777.workers.dev | Walkthrough videos and traces for each pull request and merge | Seeing what was tested |

**Choosing where projects run** is planned for phase 48a, the local runner. It must be **seamless** for people: the same hosted site, and a project runs either on our cloud workspaces or on their own laptop, their choice (owner, 7 Nov 2026). The approach is recorded in the decisions log: the laptop dials out to us, so it opens no ports. Until then, workspaces run only through `pnpm dev`.

## Run it on your computer

**Needs:**
- Node 24 (`.nvmrc`) and pnpm 12.15 (`corepack enable`)
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
| `pnpm test` | 631 unit and component tests, with no Docker or network | about 20 s |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Lint (with the design-token rules), strict TypeScript, formatting | — |
| `pnpm test:docker` | 42 tests against real containers: isolation, the network allowlist, clone time, sleep and resume, the guard, no secret kept anywhere. Needs Docker 28+ and the internet | about 1 min |
| `pnpm test:e2e` | 15 recorded walkthroughs of each phase's *Try it*, under the production security policy (1 needs a real API: CI, or a running `pnpm dev`) | about 40 s |
| `pnpm test:perf` | The canvas with 500 nodes, panned and zoomed: frame times, long tasks, input to paint. Headless (as on CI) only catches large regressions; `PERF_REAL=1 pnpm test:perf` opens a real window on your GPU for about 30 s, which is what decides | about 30 s |
| `pnpm test:visual` | Screenshots of every catalogue story in both themes against approved baselines, plus accessibility checks (axe) | about 2 min |
| `pnpm --filter @flowcanvas/control-plane test:idle-real` | The 10-minute idle sleep in real time, nothing faked | about 12 min |
| `pnpm workspace:resources` | Your laptop against Flowcanvas's budget | instant |
| `pnpm workspace:clean` | Removes test leftovers and old workspace images; `--all --yes` removes everything of Flowcanvas's | — |

CI runs the checks, Docker, visual, canvas performance (headless) and walkthrough jobs on every pull request and every merge to `main`.

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
- 🟡 **Network rules:** five allowed hosts, through a checking proxy. Workspaces can't reach each other, your laptop or your home network (tested).
- 🟡 **Sleep and resume:**
  - sleep after 10 idle minutes; resume intact (proven in real time)
  - shown with status chips and starting and asleep cards
- 🟡 **The resource guard:** keeps Flowcanvas within your laptop's budget. It refuses, sleeps or stops only its own workspaces.
- 🟡 **Open demo project:** Rallly at its corpus commit, in one click.
- ⬜ **A cloud provider** (when chosen; upgrade-later 33).
- ⬜ **Backups and restore history** (18a).
- ⬜ **Running on your own computer from the hosted site** (48a).

### The project page and the canvas (phase 2, in progress)
- 🟡 **A project's own page** (`/p/<id>`) in the app shell, at Figma 06's sizes (tested to within 1/64 px at 1440 × 900 and 1280 × 800):
  - top bar
  - rail
  - left panel
  - canvas
  - right panel
  - bottom dock
  - review bar
- 🟡 **Panels:** they collapse and resize by mouse and keyboard. There's a full-screen canvas, and the review bar opens to 300 px. Your layout is remembered, in pixels.
- 🟡 **Honest empty states** wherever content doesn't exist yet. The view switch offers Graph; Sequence and Code show as coming later.
- 🟡 **The canvas:**
  - scroll pans; Ctrl or ⌘ + scroll, or a pinch, zooms; **F** fits; **V** selects (click, or drag a box); **H** pans (as does Space + drag)
  - a minimap bottom-left and a toolbar bottom-centre, as on Figma 06
  - honestly empty until the project is analysed (stage 1)
  - the Labs **Canvas stress test** shows 500 example nodes, labelled as examples
- 🟡 **The workspace chip in the top bar** opens its facts (status, machine, since when, this month's usage, any reason) and actions (Open, Sleep now, Resume, Stop). The bottom dock's terminal follows the workspace's state.
- 🟡 **500 nodes are smooth,** measured on real hardware: panning at 120 or 60 fps, with no long tasks. Zooming in close (100% to 200%) still drops occasional frames (the build plan's phase 42, the WebGL renderer, fixes it).

### Design system and quality (phases 1a, 1b)
- ✅ **Graphite tokens:**
  - generated from `packages/tokens/source` into CSS, plus TypeScript values for code that needs numbers
  - dark and light themes, following your system's setting or your choice
- ✅ **Components:**
  - Button, Tag, Input, Toggle, Menu, Tooltip, Tabs
  - Panel, Popover, Flow node, Workspace status
  - Top bar, Rail, Review bar, Canvas toolbar
  - all in the catalogue
- ✅ **What's new** (from the CHANGELOG), Labs switches (the first: Canvas stress test), and the build's version and commit on the page.
- ✅ **A strict security policy:** no inline scripts or styles, previews per pull request, and telemetry off.

### Coming next
- **Rest of phase 2:** baselines and the Figma 06 differences list; closing the phase (0.6.0).
- **Phase 3:** the editor (Monaco), synced to the workspace, with autosave.
- **Phase 4:** the indexer: every file parsed, symbols searchable in under 100 ms.
- **Phase 5:** TypeScript call graphs: callers and callees.
- **After that:** stage 1 draws real flows from code, and stage 2 adds live frames of the running app.
