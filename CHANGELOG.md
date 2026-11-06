# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
