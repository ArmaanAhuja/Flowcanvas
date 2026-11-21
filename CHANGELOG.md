# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.14.0] — 2026-11-16 — Phases 12 and 13: progressive disclosure and sequence view

A large flow now opens as a few groups named from the code (its folders, its tables, its outside services and hand-offs) that open in place without moving anything else, and any flow can be read in order as a sequence: the calls in the order the code makes them, nested, each hand-off's work after it (phases 12 and 13). Workspaces still run on your own computer (`pnpm dev`).

### Try it

1. Open Twenty's corpus project with its workspace running; ⌘K `PartnerProfilePage` and **Show the flow**: 60 nodes open as 8 or fewer groups and nodes, each group named by its folder (`src/platform · 18`). Open one: its members are drawn in its frame, and nothing else moves. Press the completeness pill: the edges known less surely than resolved stand out.
2. Switch to **Sequence** in the top bar: the same flow as rows, in the code's order, nested; a decision's branches on the rows they lead to; each hand-off's work in a Background group. Without a run there are no timings, and it says so. Click a row: the inspector shows that node.

### Added

- **Progressive disclosure (phase 12):** a flow of 25 nodes or more opens grouped, at most 8 groups and nodes besides its root: functions by their folder, as deep as fits; tables, outside services and hand-offs each a group; a decision in its function's group; a group of one shown as its node. A group opens in place, its members drawn in its frame over the canvas; nothing else moves, on the canvas or the screen. Open ends are counted per group. The completeness pill, pressed, makes weak edges stand out.
- **Sequence view (phase 13):** the Graph / Sequence switch; the flow as a waterfall (Figma 08): depth first in the code's call order, nested, a parent's bar covering its calls', branches and failure paths (a catch's) said in words, open ends as rows, each hand-off's work in its own Background group; selecting a row selects its node.

### Decisions

- **Groups named from the code** (owner, 16 Nov: "go ahead for all 4"): folders and kinds, never an inferred category; an open group drawn over the canvas so nothing else moves (design brief: "pushes nothing else around").
- **A faster process** (owner, 21 Nov): no screenshots and no Figma matching (axe accessibility checks kept, on the catalogue and in every walkthrough); one brief CHANGELOG entry per milestone, the other docs frozen; tests in small steps with one combined test of the changes at each milestone; CI runs the walkthroughs only when the web app changes and the Docker corpus only when the engine does.
- **The project page's budget 115 → 120 kB** for a large flow's grouping, needed whenever a flow is shown; the sequence view loads on its own.
- **Medusa's corpus check** finds its pin among `develop`'s commits when GitHub can't build the comparison ("this diff is taking too long to generate").

## [0.13.0] — 2026-11-15 — Phases 9 to 11: connectors

Flows now cross from a form into the API that serves it, show each read and write with its table, each email, payment, storage or AI call as an outside service, and work handed to a queue or job in a Background lane below the main flow (phases 9 to 11). Workspaces still run on your own computer (`pnpm dev`).

### Try it

1. Open Rallly's corpus project with its workspace running; ⌘K `CreatePoll` and **Show the flow**: the form's submit continues into `mutation polls.make` and its handler.
2. In Documenso, ⌘K `sendDocument`: its writes (`Envelope`, `Recipient`…); click one to read its table. Then `run` (the signing email's runner): `Email · nodemailer`.
3. In Twenty, ⌘K `send` (EmailService): the email queue's hand-off, with a clock, and its worker in the Background lane.
4. In the left panel, open **Jobs and cron** or **Events**: each worker, job handler, scheduled job and event listener, with Show flow (Documenso's 36, Twenty's 125).

### Added

- **UI → API links (phase 9):** tRPC, `fetch` and axios (through the project's wrappers), Apollo GraphQL, and mutations run through hooks, joined to the API's entry points.
- **Reads, writes and outside services (phase 10):** Prisma, Kysely, raw SQL, Mongoose and TypeORM with their tables; nodemailer, Resend, SendGrid, Postmark, Stripe, S3, OpenAI, Anthropic and fixed outside URLs.
- **Hand-offs (phase 11):** BullMQ, Twenty's message queue, Documenso's job client, NestJS and Node events, timers, WebSockets; the framed Background lane; a clock on each hand-off; a framework badge on each convention edge.
- **Jobs, cron and events in the entry points panel (phase 11; owner):** every queue worker, job handler and event listener, named by its queue, job or event; a job is cron when the code schedules it. Test files' listeners aren't listed.
- **The inspector** for tables, services and hand-offs.
- **An installed package's types** name a value's package where following the code doesn't (owner).

### Changed

- **Graph format 6:** data, service and hand-off nodes carry their details, and what takes handed-off work is an entry point; stored graphs are rebuilt once.
- **The project page's chunk** stays within its budget; the canvas lays out the Background lane on its own, below the main flow.

### Fixed

- **Medusa's graph** builds in about 90 s on CI again (141 s at 0.12.0): the pass keeps its last program until the next is built.
- **The workspace popover** keeps focus after Sleep now, so Escape closes it.

## [0.12.0] — 2026-11-15 — Phase 8: entry points

See where a project can be entered: its pages, its API routes, the event handlers on its screens and its commands, found in the code, listed in the left panel, each opening the flow from what handles it. Every framework the test projects use is read (Next.js, React Router, Express, Hono, tRPC, NestJS and GraphQL, React's event props, package.json scripts), and anything the code doesn't fix is shown as not fully detected, with why, never guessed. Workspaces still run on your own computer (`pnpm dev`).

### Try it

1. Open a project with its workspace running; once its graph is built, the left panel lists its **entry points**: screens and elements, API routes, and CLI commands, with their counts (jobs and events arrive in phase 11).
2. **Open a screen** (arrow right, or its chevron) to see the event handlers on it.
3. **Show flow** on any entry point (or Enter on its row): the flow from what handles it, on the canvas. An entry point handled by code that isn't the project's (a prop, a library's function) says so.
4. **Filter** the list (press `/`), or press **⌘K** and type `/` to search only entry points.

### Added

- **Entry points found in the code**, by framework, joined across files: a router mounted in another file, a tRPC router nested from another, a route's component, a base path read from an environment variable (written by its name, its value never read).
- **The entry-points panel** in the left panel (Figma 06), and ⌘K's Entry points with `/` for routes (Figma 16).
- **A flow from any entry point**, starting at its handler; an inline handler (`onClick={() => …}`) is a function of its own in the flow, named after its entry point, with its own details in the inspector.
- **Held to hand labels:** 2,118 entry points in the four test projects, every convention-based one found, at least 95% of the rest, nothing listed that isn't one.

### Changed

- **JavaScript projects with a `jsconfig.json`** are understood like TypeScript ones: their path aliases resolve, for the Calls tab and flows too.
- **Workspace packages built to `dist/`** are followed to their source when the build isn't committed.

### Fixed

- **The canvas no longer shifts 2 px** under the top bar when a node is selected.


## [0.11.0] — 2026-11-14 — Phase 7: flows and the inspector

Pick any function and see where it leads: every function it calls, and theirs, laid out top to bottom on the canvas, with the conditions that decide each branch. Click a node to read what its code reveals, and open its code at that line. Every line on the canvas says how it's known, and calls that can't be resolved are shown as such, never guessed. Workspaces still run on your own computer (`pnpm dev`).

### Try it

1. Open a project with its workspace running, and find a function with **⌘K** (or open its file in the Code view).
2. **Show its flow:** choose it under Flows in ⌘K, right-click its name and choose **Show flow**, or use **Show flow** in the Calls tab.
3. Read the canvas: each function with its file and line; small diamonds for the `if`, `switch`, ternaries and `catch` that decide a call, with their outcomes on the lines; one open stub per function for the calls that can't be resolved; the counts at the top left.
4. Click a function: the inspector's **Details** show its signature, inputs and output, its decisions, what it throws and awaits, and its unresolved calls. **Open code** goes to its line.

### Added

- **Flows on the canvas:** downstream from any function, up to 60 functions, then a stub saying how many more there are; laid out by ELK off the page's main thread.
- **Decisions in the graph:** the conditions that guard each call, so a flow shows when a call happens, not only that it can.
- **The node inspector** for functions and decisions, from what the engine read in the workspace.
- **Three ways in:** ⌘K's Flows, the right-click menu, and the Calls tab.
- **Faster answers:** each file's functions, details and calls are stored when the graph is built, so flows and details answer in milliseconds, and the Calls tab answers from them too, asking TypeScript only for the callers of a class's members.
- **Design system:** decision nodes, open stubs, the node inspector and the Calls tab's Show flow, in the catalogue.

### Changed

- **Flow nodes** show their folder, file and line, as in the designs, and long names wrap at their words.

### Fixed

- **A call that always happens** is drawn even when a guarded call to the same function shares its line.
## [0.10.0] — 2026-11-12 — Phase 6: the graph model

Each project's code becomes a flow graph inside its workspace: every function, method, component and class, and every call between them, each marked as proven by the compiler or not known, never guessed. Each version of the graph is saved and can be compared with the last. It's what the canvas will draw from the next phase. Workspaces still run on your own computer (`pnpm dev`).

### Try it

1. Open **Labs** and turn on **Graph stats**.
2. Open a project with its workspace running. The inspector's **Details** tab shows its graph: nodes and edges by kind, how each edge is known, and how long it took to build, save and load.
3. Edit a file: the graph is brought up to date within seconds.

### Added

- **The flow graph:** code units and their calls, built in the workspace after the project is indexed and brought up to date as files change; every edge says how it's known.
- **Versions of the graph,** saved in the workspace and compared with each other (what changed is the basis for the live canvas later).
- **Labs → Graph stats** in the inspector's Details tab: every kind listed, those not detected yet with the phase they arrive in.
- **Files no tsconfig includes** (like an untyped Express backend) are now understood, for the graph and for Callers and Callees.
- **Design system:** Graph stats, and a provenance glyph for all five ways an edge can be known, in the catalogue.

### Changed

- **Whatever isn't built yet says which phase it arrives in:** entry points (phase 8), flows (phase 7), the Sequence view (phase 13), the Runs and Changes tabs (phases 30 and 23), agent sessions (phase 19) and their review (phase 32).

### Security

- **Asking for the graph never keeps a workspace awake.**
- **Every answer about the graph is checked exactly** by the workspace host and the API before it reaches the page.

## [0.9.0] — 2026-11-12 — Phase 5: TypeScript semantics

Right-click a function in the Code view to see who calls it and what it calls, as TypeScript itself resolves them. Every row says how it's known, and calls TypeScript can't resolve (a package that isn't installed, a function passed in at run time) are shown as unresolved, never guessed. Workspaces still run on your own computer (`pnpm dev`).

### Try it

1. Open a project with its workspace running, and open a file in the Code view.
2. Right-click a function's name and choose **Callers**. The right panel's **Calls** tab lists every function that calls it, or renders it if it's a component, with where.
3. Click a row to open that place. Switch to **Callees** to see what it calls: the project's own, then unresolved calls, then built-ins.

### Added

- **The Code view's right-click menu:** Go to definition (F12), Find references (Shift+F12), Callers and Callees, about the name under the pointer.
- **The inspector's tabs** (Details, Runs, Changes, Calls), with **Calls** working now:
  - **Callers:** who calls or renders it, each with its kind and place; a caller outside any named function is named by its file ("route.ts (top level)")
  - **Callees:** the project's, then **Unresolved** (with why), then **Built-in** (collapsed)
  - **References:** every place it's used, the definition marked
  - a call made from several places lists each one
- **TypeScript in the workspace:** one program per `tsconfig.json`, through path aliases, workspace packages and re-exports, without installing anything; it follows your edits.
- **Design system:** Context menu and Calls panel, in the catalogue.

### Fixed

- **The status bar showed the previous file's line** after switching files in the Code view.

### Security

- **TypeScript never reads `.env` files,** files outside the project, or links that lead out of it.
- **TypeScript runs in its own worker with a memory cap,** so a very large project gets an honest "too large" instead of stopping the workspace's index.


## [0.8.0] — 2026-11-11 — Phase 4: the indexer

Every project is indexed inside its workspace, so you can jump to any function, component or heading by typing part of its name. The index follows your edits as you make them. Workspaces still run on your own computer (`pnpm dev`).

### Try it

1. Open a project with its workspace running. While it indexes, a chip says how far it has got ("Indexing 61%").
2. Press **⌘K** (Ctrl+K), or click **Search** in the top bar.
3. Type part of a function's name, such as `createpoll` in Rallly, and press **Enter**: the Code view opens the file with the cursor on the name.

### Added

- **The command palette (⌘K):**
  - **Symbols:** functions, components, classes, methods, interfaces, types, enums, constants and Markdown headings, each with its kind and place
  - **Files**
  - `#` searches files only
  - Enter opens the top result
- **Search** in the top bar opens the palette.
- **The project index:**
  - every TypeScript, JavaScript, CSS, JSON, HTML, Markdown and MDX file is parsed in the workspace, and every other file is counted
  - only changed files are parsed again
  - edits are searchable within about a third of a second
- **The index's progress:** a chip with the entry points and on the canvas, and a line in the Code view's status bar, while it indexes.
- **Design system:** Command palette and Search trigger, in the catalogue.

### Fixed

- **Quick-open lost the letters "v", "h" and "f"** when opened from the Graph view: the canvas took them as its shortcuts.
- **Quick-open's rows are read out properly** by screen readers ("poll-form.tsx, apps/web/src/components"), and a highlighted row's folder text is readable (WCAG AA).

### Security

- **`.env` files are never read or indexed,** not even their names.
- **Every answer from the workspace is checked twice,** by the workspace host and by the API, before it reaches the page.
- **Asking how far indexing has got never keeps a workspace awake.**

## [0.7.0] — 2026-11-08 — Phase 3: open a repo and edit

A project's files open in an editor in the page, and every change is kept safe: saved when you forget, kept when the tab closes, and never overwritten when the workspace changes underneath. Workspaces still run on your own computer (`pnpm dev`); on staging the Code view says so.

### Try it

1. Open a project with its workspace running, and click **Code**.
2. Open a file from the tree and type a line.
3. Close the browser tab at once, then open the project again: your line is still there, with a note.
4. Change the file in the terminal: the editor shows it.

### Added

- **The Code view:**
  - the project's files in a tree
  - files in tabs, with their path and a status bar (cursor, indentation, encoding, language)
  - syntax highlighting for TypeScript, JavaScript, JSON, CSS, HTML and Markdown
- **Saving:**
  - Ctrl/⌘+S
  - autosave 5 seconds after you stop typing, and when you switch file, view or window, with a switch in the status bar
  - unsaved changes kept in the workspace and in your browser, and restored when you come back
- **Changes made in the workspace** (the terminal, another tab) appear in open files. With unsaved changes you choose: **Keep mine** or **Load the workspace's version**. A file deleted in the workspace says so.
- **Quick-open:** Ctrl/⌘+P, then type part of a file's name.
- **Design system:** Editor tabs, File tree, Breadcrumb, Status bar and Quick-open, in the catalogue; code colours from the tokens.

### Changed

- **The editor is CodeMirror 6, not Monaco.** It runs under the strict security policy unchanged, and is about a fifth of the size.
- **Faster pages:** the editor, each language, the file tree and quick-open download only when used. The first load stays at 147 kB.

### Security

- **Saves never overwrite a change they haven't seen,** and changes from the workspace never replace unsaved text.
- **`.env` files never appear** in the tree, quick-open, the journal or change events.
- **Every change event is checked** at the host, the control plane and the page.

## [0.6.0] — 2026-11-07 — Phase 2: canvas and app shell

A project now opens on its own page, laid out like the Figma design: a top bar, a rail of tools, side panels, the canvas and a review bar. The canvas is empty until a project is analysed (the next stage); the Labs switch **Canvas stress test** fills it with 500 example nodes.

### Try it

1. Click a project's name: its page opens at `/p/<id>`.
2. Turn on **Labs → Canvas stress test**.
3. Scroll to pan, Ctrl or ⌘ + scroll to zoom, and press **F** to fit. Click a node, or drag a box to select several.
4. Collapse the side panels from the rail and the top bar, or go full screen. Reload: your layout is kept.

### Added

- **A project's own page** in the app shell, at the Figma design's sizes (tested to within 0.1 px at 1440 × 900 and 1280 × 800).
- **The canvas:**
  - pan, zoom, fit, selection, a minimap and a toolbar
  - keyboard shortcuts: **F** fit, **V** select, **H** pan, and Space + drag
  - 500 nodes pan smoothly on a laptop: 120 frames a second, with no long tasks
- **Panels:**
  - collapse and resize, by mouse or keyboard
  - a full-screen canvas, and the review bar opens to 300 px
  - your layout is remembered in this browser
- **The workspace in the top bar:** the chip opens its facts (status, machine, since when, this month's usage) and actions. The bottom dock's terminal follows the workspace.
- **Design system:** Top bar, Rail, Review bar and Canvas toolbar, and segmented Tabs with disabled items, in the catalogue.
- **Honest empty states** wherever content doesn't exist yet.

### Fixed

- Your theme choice (dark or light) now applies on a project's page too, not only on the projects list.

### Changed

- **Checks:** screenshots of the project page in both themes are compared with approved ones, the web bundle has a size budget in CI, and the canvas's speed is measured on every pull request.

## [0.5.0] — 2026-11-06 — Phase 1d: workspace sandbox (in review)

Workspaces run on the owner's computer, in Docker, until a cloud provider is connected. On staging, projects say "Workspaces run locally for now", and no button offers what can't work there.

### Try it

On your own computer, with `pnpm dev` (Docker 28 or newer):

1. Click **Open demo project**. Rallly appears first, pinned to the corpus commit, and its chip goes from **Starting…** to **Running · 2 cores** in about 10 seconds.
2. Click **Terminal** and run `git log --oneline -1`: it's `8e67a21`.
3. Leave it alone for 11 minutes. It goes to sleep by itself ("Put to sleep after 10 minutes without activity."), and asleep costs nothing.
4. Click **Resume**: the files and running processes are as they were.

### Added

- **A workspace for every project:**
  - a locked-down container of its own: no root, no extra privileges, 2 CPUs, 4 GiB of memory
  - its repository cloned at a pinned commit when there is one
  - files and commands through a typed API that never reads `.env` files or leaves the project
- **A terminal in the page** (xterm.js), relayed by the Worker, under the strict Content-Security-Policy.
- **Sleep and resume:**
  - a workspace sleeps after 10 idle minutes (a check every minute) and resumes intact
  - usage counts running time only, never time asleep or with the computer off
- **Workspace status on each project:** a status chip (also in the component catalogue), Open, Sleep, Stop and Resume, and the starting and asleep cards. Only recorded facts are shown.
- **Open demo project:** the stage's demo (Rallly, at its corpus commit) in one click.
- **The resource guard on the computer:** it refuses new workspaces when memory, disk or the processor is short, and stops or sleeps Flowcanvas's own workspaces to make room. It never touches anything else.

### Security

- **The network:** a workspace reaches only five hosts (GitHub, the npm and Yarn registries, Prisma's engines), through a proxy that checks every address. It can't reach other workspaces, the computer it runs on, the home network or cloud metadata, and it has no DNS of its own. Tests try each of these and must fail to connect.
- **Secrets:** made-up secrets planted in the host's token, a project's `.env`, commands and the terminal are kept nowhere: not in logs, Docker's settings or any process inside the workspace. The control plane never shows a message from the host that contains the host's token.
- **In CI:** the Docker tests run on every pull request.

### Changed

- The control plane's tests use at most 6 workers. A full `pnpm test` used to take about 17.5 GiB of memory at once; now it leaves more than 11 GiB free, and it's faster.

## [0.4.0] — 2026-10-31 — Phase 1c: sign-in and control plane

### Try it

1. On staging, **sign in with GitHub or Google** (your email must be on the allowlist). Your name appears under Account, with Sign out.
2. **Create a project.** It's listed with "Workspace not created yet"; cloud workspaces arrive in the next phase.
3. Open its **Secrets** and save one with a made-up value. It's listed by name only, masked, and can never be shown again; replace it by saving the same name.
4. As an admin, look at **Admin**: everyone who has signed in, and the allowlist you can change from here.

### Added

- **Sign-in with GitHub and Google**, one account across both, limited to an allowlist while in private development. Sessions last 30 days; only a hash of the session token is stored.
- **Projects:** create and list your own projects; each has its cloud workspace record from the start.
- **Secrets vault:** project secrets encrypted with a key per project (envelope encryption, AES-256-GCM). Values are write-only: no page or API ever returns one.
- **Usage this month:** measured workspace time and the reset date (0 until workspaces run). Limits and plans come later.
- **Admin view:** people with their project count and usage (counts only, never project contents), and the allowlist: add, change role, remove (which signs that person out everywhere).
- **Control plane** inside the app's Worker under `/api` (Hono), with Neon Postgres, plain SQL migrations and in-process Postgres (PGlite) for tests.

### Security

- Every log line is redacted on its way out: connection strings, tokens, sign-in codes, cookies and email addresses. A canary test runs the whole flow, failures included, and checks every response and log line.
- Requests that change something must come from Flowcanvas itself; admin routes check the role on every request; API answers are never cached.
- Sign-in only works on staging and local development; branch previews say so.

## [0.3.0] — 2026-10-29 — Phase 1b: see-and-test harness

### Try it

1. Open **What's new** on this page: the dot means changes you haven't seen. Read this build's notes, then close it; the dot stays gone after a reload.
2. Open **Labs**: unfinished features will appear here as switches, off by default. Nothing is in preview yet, and it says so.
3. Open the latest **test report** (linked on each pull request): watch the walkthrough videos and open a trace to step through every action.

### Added

- **Recorded walkthroughs:** one Playwright file per phase (`e2e/try-it/`), worded like the build plan's Try it steps; every run records a video and a trace.
- **Test reports online:** each run is published to its own Worker (`flowcanvas-reports`), with an index, the walkthroughs (videos, traces) and the visual results; one link per pull request.
- **CI workflow:** checks, visual tests in Playwright's Docker image, walkthroughs against the deployed preview once it serves the exact commit, published report and one updating PR comment. It runs once GitHub Actions is available on the account; verified locally with `act` and `actionlint`.
- **What's new:** release notes in the app, generated from this changelog at build time, with Try it first and a dot for unseen changes.
- **Labs:** switches for unfinished features, off by default and marked Preview.
- **Popover** component in `@flowcanvas/ui`.
- **Test corpus:** six public forks pinned to exact commits (Rallly, Documenso, LibreChat, Twenty, Excalidraw, Medusa), with a check of fork, commit, licence and stack.

### Changed

- Visual tests compare our own approved screenshots, pixel for pixel, inside Playwright's Docker image on every machine. The automated comparison with Figma exports is retired; Figma is a reference reviewed by eye.

### Security

- The reports site has its own origin and headers, kept out of search engines.
- CI gives write access and the Cloudflare token only to the publishing job, and pull requests from forks never receive secrets.
- The test corpus never enters this repository, and its commercial or enterprise parts are never enabled.

## [0.2.0] — 2026-10-28 — Phase 1a: design system in code

### Try it

1. Choose **Theme → Light** on this page; reload, and it stays light.
2. Open the **component catalogue** from the link here, and flip **dark and light** with the paintbrush in its toolbar.
3. In the catalogue, look at **Flow node**, **Tag**, **Button** and **Menu**: the Signal colours, the change states and the event menu.

### Added

- `@flowcanvas/tokens`: the Graphite tokens (colours, Slate scale, text styles, spacing, radii, sizes, motion, shadows) as DTCG JSON, generated into CSS variables and typed TypeScript, in a dark theme and a new light theme. Contrast is checked by tests.
- `tools/figma-tokens`: the generator, reading the Figma variables export format.
- `@flowcanvas/ui`: Button, Tag, Input, Toggle, Tabs, Panel, Menu (icons, details, shortcuts, single-choice picker), Tooltip and Flow node (change states, failing and analysing status, selection, 12 node-type icons), with self-hosted Inter and JetBrains Mono, theme switching and reduced motion.
- Component catalogue (Storybook) with dark/light switch and accessibility checks, deployed to its own Cloudflare Worker.
- Visual tests: every story in both themes against approved baselines, axe on every story, and a side-by-side comparison with the Figma components within measured budgets.
- Version page rebuilt with the design system: theme menu (System / Dark / Light, remembered) and a link to the catalogue.
- **Signal palette** for the five change states and the selection accent (owner decision): clearer, colour-blind-friendlier hues on the unchanged greys, in dark and light.

### Changed

- Product version 0.2.0. The web build now rebuilds when the root version changes.

### Security

- The app keeps its strict CSP: React Aria's injected style is pre-empted. The catalogue, which needs inline scripts, is isolated on its own origin with its own headers.
- Storybook telemetry disabled; Storybook's build metadata is not deployed.

## [0.1.0] — 2026-10-27 — Phase 1: project skeleton

### Added

- Monorepo: pnpm 12 workspaces with catalogs, Turborepo 2 task pipeline, strict TypeScript 6, type-aware ESLint, Prettier.
- `@flowcanvas/web`: Vite + React app showing the product name, version and the commit it was built from.
- `@flowcanvas/control-plane`: Fastify service with `GET /health` (status, version, commit), JSON logs with secret redaction, graceful shutdown, and a production Docker image.
- `@flowcanvas/graph-model`: shared `BuildInfo` formatter that never invents a commit.
- `@flowcanvas/engine` and `@flowcanvas/workspace-agent`: packages wired into build, lint and test, ahead of their real work.
- Tests: unit (Vitest), component (Testing Library + jsdom), end-to-end (Playwright in Chromium), including a secret-redaction canary test.
- CI workflow for GitHub Actions (format, lint, typecheck, unit tests, build, e2e).
- Hosting on Cloudflare Workers static assets: a preview URL per pull request and staging from `main`.

### Security

- Strict Content-Security-Policy and security headers on the web app.
- Control plane binds to loopback by default and runs as a non-root user in its container.
- Actions pinned to commit SHAs; pnpm minimum release age respected; install scripts explicitly decided; telemetry off for Turborepo and Wrangler.
