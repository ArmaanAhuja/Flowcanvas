# Architecture

The system as it is **today** (end of phase 1b). Kept current at the end of every phase. Why things are this way is in `docs/adr/`; what's deferred is in `docs/upgrade-later.md`.

## Parts

| Package | Folder | Runs in | Today |
| --- | --- | --- | --- |
| `@flowcanvas/web` | `apps/web` | The user's browser (static files from Cloudflare) | Version page built from the design system: name, status, build line, account line (sign in with GitHub or Google, who is signed in, sign out; `src/account/`), projects list and create when signed in (`src/projects/`; a stand-in for the phase 2 start screen), each with a write-only Secrets panel (`src/secrets/`) and, while its workspace runs, a terminal (`src/terminal/`, ADR 0017), What's new (from `CHANGELOG.md`, parsed at build time), Labs (switches for unfinished features, off by default; `src/labs/`), theme menu, link to the catalogue. **A project's page** at `/p/<id>` (phase 2, ADR 0020): the app shell (`src/shell/`, panels kept in pixels), the canvas (`src/canvas/`, React Flow), the workspace chip and the dock (`src/project/`). **The Code view** (phase 3, `src/code/`): files from the workspace, CodeMirror 6 in a shadow root (ADR 0021), conflict-safe saves, autosave, the journal in the workspace and IndexedDB, live changes from the workspace's watcher, quick-open (ADR 0022). The editor's core, each language, the file tree and quick-open each load only when used (`scripts/bundle-size.ts` budgets every part) |
| `@flowcanvas/ui` | `packages/ui` | The browser (consumed as source by Vite, ADR 0007) | Graphite components (Button, Tag, Input, Toggle, Tabs, Panel, Menu, Popover, Tooltip, Flow node), global styles, fonts, theme switching; Storybook catalogue |
| `@flowcanvas/tokens` | `packages/tokens` | Shared (CSS and TypeScript) | Design tokens: DTCG source JSON → generated `css/tokens.css` and typed `vars` / `themeValues`; dark and light themes |
| `@flowcanvas/figma-tokens` | `tools/figma-tokens` | Developer machine / build | Generator: DTCG token JSON (Figma variable export format) → CSS variables + TypeScript |
| `@flowcanvas/docs-check` | `tools/docs-check` | Developer machine / CI | `pnpm docs:check`: the living docs held to the code (release, progress, counts, phases still to come, paths, packages); `pnpm docs:update` rewrites the counts (phase 7, owner's request) |
| `@flowcanvas/control-plane` | `services/control-plane` | Inside the app's Cloudflare Worker under `/api` (ADR 0013); Neon Postgres | Hono API (`src/api/`): health, database ping, GitHub and Google sign-in, sessions, sign-out and the user/admin/same-origin guards (`src/auth/`), projects list and create (`src/projects/`), the secrets vault (`src/vault/`, ADR 0015), the workspace lifecycle and `WorkspaceProvider` (`src/workspaces/`); schema migrations and runner (`migrations/`, `src/db/`, ADR 0014). The earlier Fastify server was retired in phase 1c step 3 |
| `@flowcanvas/graph-model` | `packages/graph-model` | Shared library (browser and Node) | `BuildInfo` and `formatBuildInfo()`; the flow graph model (phase 6) and the flow builder (phase 7) |
| `@flowcanvas/engine` | `packages/engine` | Inside each user workspace: `/tmp/flowcanvas-engine/main.js`, copied in and started by the host | The indexer (phase 4): tree-sitter in WebAssembly with eight grammars (`src/grammars.ts`; Markdown built by `tools/grammars/build-markdown.sh`), symbols (`src/symbols.ts`) in `node:sqlite` with FTS5 (`src/store.ts`) at `/workspace/.flowcanvas/index.db`, indexed incrementally by content hash (`src/indexer.ts`); its own watcher and status and search (`src/service.ts`); bundled by `scripts/bundle.ts`; protocol in `src/protocol.ts` (ADRs 0023–0025) |
| `@flowcanvas/workspace-host` | `workspace/host` | Developer machine, started by `pnpm dev` (127.0.0.1:8790) | The local workspace host (ADR 0016): an HTTP API with a token (`src/server.ts`; protocol in `src/protocol.ts`, shared with the control plane), workspaces as Docker containers (`src/workspaces.ts`; the 2-running cap), the egress proxy (`src/egress/proxy.ts`), the laptop budget (`src/resources.ts`), clean-up (`src/clean.ts`), and (phase 3) the file watcher's events WebSocket (`src/events.ts`: one `main.js --watch` per open page, every event checked; ADR 0022) |
| `@flowcanvas/workspace-image` | `workspace/image` | Developer machine (builds the image); used by the workspace host | The workspace image (`Dockerfile`: Node 26 by digest, pnpm, git, `node` user, telemetry off). Its tag is a hash of the Dockerfile. Also the locked-down `docker run` and network arguments, and the default limits (2 CPUs, 4 GiB, 1,024 processes, 1 GiB `/tmp`, 10 GiB disk measured) |
| `@flowcanvas/workspace-agent` | `workspace/agent` | Inside each workspace (a local Docker container for now, ADR 0016), as the workspace's user | The workspace agent: list, read and write the project's files and run commands, under `/workspace/project` only, never `.env` files (`src/agent.ts`). Since protocol 2 (phase 3): every read and write returns the file's version (SHA-256), writes can be conflict-safe (`baseVersion`, refused with `conflict` if the file changed), `files` lists the project from git (or a walk that skips `node_modules`, `.git` and build output), and the journal keeps unsaved editor buffers in `/workspace/.flowcanvas/journal`, outside the project. Its protocol (`src/protocol.ts`: one JSON message per line, versioned, with `parseAgentRequest`) is shared with the host and the control plane; the host copies the agent in on every connection, so both always match |
| `@flowcanvas/corpus` | `corpus` | Developer machine / CI | The test corpus: six public forks pinned in `manifest.json`; `pnpm corpus:check` verifies fork, commit, licence and stack through the GitHub API |
| `@flowcanvas/e2e` | `e2e` | Developer machine / CI | Playwright: one recorded walkthrough per phase (`try-it/`, video and trace) against any URL; visual tests (catalogue baselines in both themes, axe) |

Dependencies between packages:
- `web → ui, graph-model`
- `ui → tokens`
- `tokens → figma-tokens` (generator, dev only)
- `e2e → web` (build order only)
- `control-plane → workspace-host` (its `protocol` only) and `workspace-agent` (its `protocol` only); both are pure modules the Worker bundles
- `workspace-host → workspace-image, workspace-agent`

## Design system

```
packages/tokens/source/*.tokens.json   (DTCG; the source of truth for tokens; Figma is a reference only, decisions log 29 Oct 2026)
        │  pnpm --filter @flowcanvas/tokens generate   (tools/figma-tokens; a test fails if the output is stale)
        ▼
packages/tokens/css/tokens.css  +  src/tokens.generated.ts
        │  imported by packages/ui/src/styles/global.css
        ▼
packages/ui components (CSS Modules; Stylelint rejects raw colours, sizes, fonts, radii, motion)
        ├─► apps/web            (strict CSP)
        └─► Storybook catalogue (own Worker and origin, ADR 0010)
```

- **Themes:** `data-theme="dark|light"` on `<html>`, or none to follow the OS (`prefers-color-scheme`). Pure CSS, chosen with `useThemePreference()`.
- **Accessible behaviour** (menus, tooltips, focus, keyboard) comes from React Aria Components (ADR 0008). Its one injected style is pre-empted, so the strict CSP holds.
- **Icons** come from Lucide (ADR 0009).
- **Proof:**
  - `tokens` tests check WCAG contrast in both themes.
  - `ui` tests check behaviour and accessibility.
  - `pnpm test:visual` compares every story in both themes, pixel for pixel, with approved baselines of our own rendering, and runs axe on each (`e2e/visual/`). It runs inside Playwright's Docker image on every machine and in CI, so the baselines match everywhere (ADR 0012). Figma is not compared automatically; the owner reviews against it by eye.

## Data model (control plane, Neon Postgres)

Defined by `services/control-plane/migrations/*.sql` (ADR 0014); applied with `pnpm db:migrate`.

| Table | Holds | Notes |
| --- | --- | --- |
| `sign_in_allowlist` | Emails allowed to sign in, with role | Filled by `pnpm db:allow`, never in migrations (public repo) |
| `users` | Email (lower case, unique), name, avatar, role | Deleting a user cascades to everything they own |
| `identities` | GitHub or Google account linked to a user | Unique per (provider, provider user id) |
| `sessions` | SHA-256 hash of the session token, expiry | The token itself is never stored |
| `projects` | Owner, trimmed name (unique per owner), optional repo URL, optional pinned commit (`repo_commit`, 0004: a full SHA, only with a URL) | The demo project is the corpus's Rallly fork at its pin (`src/projects/demo.ts`; `POST /api/projects/demo`) |
| `workspaces` | One per project, created in the same statement as the project; state, provider and its name for the workspace, `version`, when the state changed, running since, last active, failure sentence | Migration 0002 backfilled older projects; 0003 added the lifecycle columns. `running_since` is set exactly while running (a check constraint) |
| `project_keys` | Each project's data key, encrypted by a master key held in a Worker secret | Envelope encryption |
| `project_secrets` | Secret values as AES-GCM ciphertext and IV; environment-variable-style names | Write-only; never returned |
| `usage_records` | Measured amounts (workspace seconds, storage) over periods | Metering skeleton; each record sits within one UTC month |
| `schema_migrations` | Applied migrations and their checksums | Written by the runner |

## Tooling

- **pnpm 12** workspaces with catalogs (one version per dependency).
- **Turborepo 2**: task graph and cache for `build`, `typecheck`, `test`, `lint`, `dev`, `test:e2e` and `build-storybook`. Always build through Turbo, so dependencies build first.
- **TypeScript 6.0**, strict, shared `tsconfig.base.json`.
- **ESLint 10** (type-aware typescript-eslint), **Stylelint 17** (tokens only) and **Prettier 3**.
- **Storybook 10**: the component catalogue, with the accessibility and theme addons.
- **Vitest 5** for unit and component tests; **Playwright** (Chromium) for end-to-end tests.
- Node **24 LTS**.

## How the version and commit travel

```
git commit ──► root package.json "version" (0.4.0; a Turbo input of the web build)
           └─► commit SHA
                 ├─ web build:     FLOWCANVAS_COMMIT (root `build` script, or Cloudflare's clone) → Vite `define` __FLOWCANVAS_BUILD__ → page text "0.4.0 · abc1234"
                 └─ control plane: GET /api/health reports the version (root package.json, bundled by Wrangler); the commit is on the page
```

If no commit is known, every surface shows "unknown commit". A commit is never invented.

## From commit to URL

```
push to a PR branch ──► Cloudflare Workers Builds ──► build web ──► wrangler versions upload ──► preview URLs
                                                                       • <version-id-8>-flowcanvas.<subdomain>.workers.dev
                                                                       • <branch>-flowcanvas.<subdomain>.workers.dev (branch alias)
merge to main       ──► Cloudflare Workers Builds ──► build web ──► wrangler deploy ──► staging: flowcanvas.<subdomain>.workers.dev
push / merge        ──► Cloudflare Workers Builds (project flowcanvas-catalogue) ──► turbo run build-storybook ──► previews per branch,
                        catalogue from main: flowcanvas-catalogue.<subdomain>.workers.dev (packages/ui/wrangler.jsonc)
push / PR           ──► GitHub Actions CI (.github/workflows/ci.yml): checks · visual in the Playwright image ·
                        walkthroughs against the PR preview (or staging on main) once it serves the commit ·
                        publish to flowcanvas-reports + one PR comment. Runs on GitHub since 31 Oct 2026 (repository
                        moved to ArmaanAhuja/Flowcanvas; upgrade-later 8 closed)
test runs           ──► e2e/scripts/publish-report.ts ──► Worker flowcanvas-reports (ADR 0011): one version per run,
                        alias per PR (pr-<n>-flowcanvas-reports.<subdomain>.workers.dev), main address = latest from main
control plane       ──► part of the app's Worker (wrangler.jsonc `main`), deployed with the app above; schema changes by `pnpm db:migrate`
```

## Security posture (phase 1b)

- Static UI with a strict Content-Security-Policy (`apps/web/public/_headers`); no inline scripts or styles anywhere in the app (React Aria's injected style is pre-empted).
- The catalogue runs on its own origin with a looser CSP that Storybook needs (`packages/ui/.storybook/public/_headers`, ADR 0010); it has no cookies or data.
- Control plane: API answers are `Cache-Control: no-store`. **Logging rules (phase 1c):**
  - Routes log a short message with `describeError()`, never a request, body, cookie or error object.
  - `createApi` passes every log line through `redact()` on its way out, whatever the caller wrote. It removes connection strings, bearer tokens, GitHub (`gh*_`) and Google (`ya29.`) tokens, OAuth `code`, `state`, verifier, client secret and tokens, our `__Host-fc_*` cookies, and email addresses.
  - People are named in logs by user ID only.
  - `api.onError` answers anything a route didn't catch with a plain 500, and logs only a redacted description (Hono's default would print the whole error).
  - `no-leaks.test.ts` runs the whole flow, failures included, with canaries, and checks every response, log line and console write.
  - Cloudflare's own request (invocation) logs are **off** (`wrangler.jsonc`): they recorded full URLs, including the sign-in callback's OAuth `code` (1 Nov 2026). Workers Logs keeps only our own redacted lines; request counts and CPU time are in the Worker's Metrics tab.
- No secrets in the repository, image layers or front-end environment.
- Telemetry off for Turborepo, Wrangler and Storybook.
- Supply-chain defaults: ADR 0006.

## Sign-in and sessions (phase 1c)

```
"Sign in with GitHub | Google" ──► GET /api/auth/:provider
     sets __Host-fc_oauth = provider.state.verifier (HttpOnly, Secure, SameSite=Lax, 10 min) ──► provider's authorize page
                                                              (state, PKCE S256 challenge, prompt=select_account)
provider ──► GET /api/auth/callback/:provider?code&state
     provider and state must match the cookie ──► code + verifier exchanged for the provider's token
         GitHub: /user, /user/emails (primary verified email) · Google: OIDC userinfo (email_verified)
     verified email on sign_in_allowlist? ──► user + identity (linked by provider id, else by the same verified email)
     new random session token ──► SHA-256 stored in sessions; token in __Host-fc_session (30 days) ──► redirect to /
     the provider's token is dropped: never stored or logged
GET /api/me ──► { user, signIn: available | staging-only | not-configured, providers }
guarded routes ──► requireUser (401 without a live session; c.get('user')) ──► requireAdmin (403 unless admin)
changes (POST …) ──► requireSameOrigin (403 unless Origin is our own); JSON only; small bodies
GET/POST /api/projects ──► always scoped to c.get('user').id (owner_id), never to IDs from the request
POST /api/auth/sign-out (Origin must be our own) ──► session row deleted, cookie cleared
```

- **One address signs in:** `APP_ORIGIN` (`wrangler.jsonc` `vars`: staging; `pnpm dev` overrides it with `http://localhost:5173`). GitHub returns only to registered addresses, so branch previews answer `staging-only` (decisions log, 30 Oct 2026).
- **Problems come back as `/?sign-in=<code>`** (`cancelled`, `expired`, `no-verified-email`, `not-allowed`, `unavailable`, `failed`); the page maps each to a sentence and removes it from the address.

## Secrets vault (phase 1c, ADR 0015)

```
VAULT_KEY (Worker secret / .dev.vars) ──wraps──► project_keys.wrapped_key (one AES-256 data key per project)
                                                   └──encrypts──► project_secrets.ciphertext (AES-GCM, fresh IV,
                                                                  AAD = secret:<project>:<name>)
PUT /api/projects/:id/secrets/:name { value } ──► 201 created | 200 replaced (answer: name only)
GET /api/projects/:id/secrets ──► names, who added, when: never values
DELETE /api/projects/:id/secrets/:name
readSecret() ──► only for the project's workspace (phase 1d)
```

## Workspace records and usage (phase 1c)

```
POST /api/projects ──► one SQL statement inserts the project and its workspace (state not_created)
GET  /api/projects ──► each project with { workspace: { id, state } }
recordUsage()      ──► usage_records (phase 1d's workspaces call it; refuses negative or impossible amounts,
                       records crossing a month boundary, and other people's workspaces)
GET  /api/usage    ──► this UTC month's sums for the signed-in person, and when they reset
```

Nothing records usage until workspaces run (phase 1d), so the meter reads a real 0. The free allowance, limits and the graceful pause come with plans (phase 44a).

## Admin view (phase 1c)

```
GET    /api/admin                    ──► people (role, providers, project count, workspace time this month,
                                         last sign-in, still allowed?) and the allowlist; counts only
PUT    /api/admin/allowlist/:email   ──► add, or change the role ({ role }); a signed-up person's role changes now
DELETE /api/admin/allowlist/:email   ──► remove, and end that person's sessions; their data stays
```

Every route runs `requireUser` then `requireAdmin`; changes also need `requireSameOrigin`. An admin can't demote or remove themselves (409), so the allowlist can't be left without an admin by accident. Changes are logged by the acting admin's user ID, never by email. `pnpm db:allow` still works for the first admin, before anyone can sign in.

## Workspaces (phase 1d, ADR 0016)

For now, workspaces are local Docker containers. A cloud provider replaces the adapter later (upgrade-later 33).

```
browser ──► Worker /api ──HTTP 127.0.0.1 + token──► workspace host (workspace/host) ──► Docker
                                                        │ docker exec -i (JSON lines)
                                                        ▼
                                  container: our image, non-root, no capabilities, limits
                                  network: own --internal net, isolated gateway mode (Docker 28+)
                                  internet: only via the egress proxy (allowlist)
                                  files: one named volume per workspace
```

- The control plane sees only `WorkspaceProvider`. The workspace host is the only code that touches Docker, and it takes no image, mount or flag from a request.
- Sleep is `docker pause`; resume is `docker unpause` (about 50 ms each way, processes intact).
- Containers run as uid 1000 with no capabilities, `no-new-privileges`, a read-only root filesystem, a 1 GiB `/tmp`, no logs and `--init` (`workspace/image/src/spec.ts`). Only the workspace volume can grow, and Docker can't cap it on every storage driver (not on btrfs), so the host measures it (step 8; upgrade-later 35).
- Staging has no workspace host, so it shows "Workspaces run locally for now".
- **The host's API** (`workspace/host/src/protocol.ts`, `v1`): `GET /v1/health`, `POST /v1/workspaces` `{ workspaceId, repoUrl }` → `{ ref, cloned, cloneMs }`, `POST /v1/workspaces/:ref/{start,pause,resume,stop}` → 204. Errors are `{ error: { kind, message } }` with the same kinds as `ProviderError`. It refuses requests without the token (401) and anything with an `Origin` header or a Host other than 127.0.0.1 or localhost (403), so web pages can't drive it.
- **Names:** a workspace's container, network and volume are all `fc-ws-<workspace id>`. The proxy is `fc-egress` on `fc-egress-out`. Everything is labelled `org.flowcanvas.workspace=1`, with `org.flowcanvas.prefix` and `org.flowcanvas.role`; tests use their own `fc-test-<hex>` prefix.
- **The egress proxy** allows only `CONNECT` to port 443 on five hosts, each with its reason in `ALLOWED` (`src/egress/proxy.ts`): `github.com` and `codeload.github.com` (clones, git and tarball dependencies), `registry.npmjs.org` and `registry.yarnpkg.com` (installs), `binaries.prisma.sh` (Prisma's engines). It resolves the name itself and refuses non-public addresses. It runs with IP forwarding off, and is connected to each workspace's network. Limits: 64 open tunnels per workspace and 256 in all (then `429`), 10 s to send `CONNECT`, 60 s idle.
- **What a workspace can't reach** (the isolation test in `host.docker.test.ts`): another workspace, by address or name, either way; the proxy's other sides; any of this computer's addresses; the cloud metadata address; the internet except through the proxy; DNS outside its own network; IPv6 (none, apart from loopback).
- **Opening a project:** create or wake the container, then a shallow clone (`--depth 1`, https only) into `/workspace/project`; opening again keeps the files. The adapter (`services/control-plane/src/workspaces/local-host.ts`) only talks to loopback addresses, and only passes known error kinds and bounded sentences through.

## Files and commands (phase 1d, step 5)

```
GET  /api/projects/:id/workspace/files?path=src      ──► { path, entries: [{ name, type, size, secret }], truncated }
GET  /api/projects/:id/workspace/file?path=a.ts      ──► { path, size, encoding: utf8 | base64, content }
PUT  /api/projects/:id/workspace/file?path=a.ts      { content, encoding }  (same origin, ≤ 1 MiB)
POST /api/projects/:id/workspace/exec                { command: [...], cwd, timeoutMs ≤ 120 s }  (same origin)
        │ parseAgentRequest, owner only, running only (409 "Open the workspace first."), counts as activity
        ▼
WorkspaceProvider.agent ──► host POST /v1/workspaces/:ref/agent ──► docker exec -i … node /tmp/flowcanvas-agent/main.js
                                                                     (JSON lines, protocol 1, hello on connect)
```

- **The agent** is copied into the workspace's `/tmp` (a tmpfs) by the host and started with `docker exec -i`. A restarted container gets a fresh copy, and no mount is needed. It runs as the workspace's user, so the host and the control plane check its answers (`isAgentResponse`) like any untrusted input.
- **What it can reach:** `/workspace/project` only. Paths are resolved and links followed, then checked to still be inside. Writes never follow a link (`O_NOFOLLOW`). `.env`-style files (`isSecretFile`) are listed, marked `secret`, and never read or written (CLAUDE.md rule 5).
- **Commands** run without a shell, from an argument list, in their own process group. They stop at their time limit, and each output is capped at 1 MiB. Long-running and interactive programs are the terminal's job (step 6).
- **Logs** name the operation and the outcome only, never paths, content or commands.

## Terminal (phase 1d, step 6, ADR 0017)

```
xterm.js ──wss /api/projects/:id/workspace/terminal?cols=&rows= (same origin; cookie)──► Worker relay
         binary frames: bytes        text frames: JSON control (resize in; exit, error out)
Worker   ──ws, bearer token──► host /v1/workspaces/:ref/terminal ──Engine API exec (Tty)──► bash -l (uid 1000)
```

- The Worker checks origin, session, owner and running before accepting, sets `binaryType = 'arraybuffer'` on both ends, passes only bounded bytes and re-checked resizes from the browser, and counts typing as activity (at most every 30 s).
- The page (`apps/web/src/terminal/`) runs xterm.js, loaded on demand, with colours and font from the tokens. xterm's `<style>` elements become inert templates whose text goes into constructed stylesheets (`adopt-styles.ts`), so the CSP stays `style-src 'self'` with no violations. `vite preview` sends the production headers from `public/_headers`.
- The host opens the pty through the Docker Engine API on its Unix socket; at most 4 per workspace. Closing the WebSocket hangs up the shell. A Durable Object gateway (sessions that survive a reconnect) comes with the cloud provider (upgrade-later 33).

## Project index (phase 4, ADRs 0023–0025)

```
GET /api/projects/:id/workspace/index/status          ──► { state, done, total, files, byStatus, symbols, … }  (not activity)
GET /api/projects/:id/workspace/index/search?q=&limit=  ──► { symbols: [{ path, name, kind, container, line, column, exported }], ms }  (activity)
        │ parseEngineRequest, owner only, running only; isEngineResponse checks the answer
        ▼
WorkspaceProvider.index ──► host POST /v1/workspaces/:ref/index ──► docker exec -i … node /tmp/flowcanvas-engine/main.js
                                                                     (JSON lines, engine protocol 1, hello on connect)
inside the workspace: the agent's watcher (in process) ──► refresh ──► /workspace/.flowcanvas/index.db (node:sqlite, FTS5)
```

- **The engine** is a bundle (`main.js` plus the tree-sitter runtime and eight grammars as `.wasm`, about 4.5 MB). The host copies it into the workspace's `/tmp` when its `version.txt` differs, and starts it on the first index request, one per running workspace. It stops with the workspace.
- **On start,** it starts its watcher, then indexes every file the agent lists (git's files, never secret ones). After that, reported changes are re-indexed within about 300 ms, whether or not a page is open; an overflow runs a full pass.
- **Every file is counted** by what happened to it (parsed, no grammar, too large, binary, unreadable). Symbols come from syntax alone: TS/JS declarations and Markdown headings.
- **The workspace is untrusted:** the host and the control plane both check each answer's exact shape. Logs never contain the query.
- **The page** (`apps/web/src/symbols/`): ⌘K and the top bar's search open the command palette (`packages/ui`). Symbols come from the engine, a search per keystroke, with the one typed past cancelled and late answers dropped; files are ranked in the browser. Enter opens the top result, which the palette marks itself until the arrow keys are used. A symbol opens in the Code view at its line (`useCodeFiles.open(path, at)`). The status is polled only while indexing, and shows as a chip with the entry points and on the canvas, and in the Code view's status bar. Quick-open and the palette share one lazy chunk (`SearchDialogs`).
- **TypeScript's answers** (phase 5, ADR 0026): `GET …/index/{definition,references,callers,callees}?path=&line=&column=`.
  - **Where:** a worker thread in the engine (`packages/engine/src/semantics/`), started on the first question and capped at 2,500 MB, so running out of memory ends only it.
  - **How:** one language service per `tsconfig.json`, built when a question needs it (the file's programs, plus its package's dependents' for callers), and released least recently used first.
  - **Without `node_modules`:** the project's own packages resolve as project code (`extends` through a virtual `node_modules`, imports through `paths` from each `package.json`'s `exports`). Packages from npm stay unresolved.
  - **Answers:** each caller or callee is *resolved* or *unresolved* (never guessed), *calls* or *renders*, and built-ins are marked.
  - **Callees beyond TypeScript's hierarchy:** the engine scans the function's own body (not named functions inside it, as the hierarchy counts them). A call the compiler can't resolve is *unresolved*, with its text (arguments shortened). A call it resolves to something the hierarchy doesn't model is listed by what the name is: built-ins, module-level constants and interface or class members are *resolved*; parameters and locals are *unresolved* (ADR 0026 addendum).
  - **What it reads:** only inside the project (never secret files, never through a link out, nothing over 1 MB) and TypeScript's own lib (whatever its size: `lib.dom.d.ts` is 2.3 MB).
  - **Shipping:** TypeScript ships beside the engine as one archive the host unpacks.
  - **The page** (`apps/web/src/symbols/useCalls.ts`, `src/project/Inspector.tsx`): the Code view catches F12, Shift+F12 and right-clicks on the editor's host (CodeMirror is in a shadow root) and finds the place under the pointer. The right-click menu is `ContextMenu` (`packages/ui`). Answers fill the inspector's Calls tab (`CallsPanel`), which a new question brings into view; late answers are dropped. A row opens its place in the Code view.
- **The flow graph** (phase 6, ADR 0027): `@flowcanvas/graph-model` holds the vocabulary (six node kinds, five edge kinds, five provenances, change states), the rules, a canonical compact encoding, the diff and stats; plain data, used by the engine, the protocol and the page.
  - **Built** in the TypeScript worker: one pass over every program (and inferred programs for files no tsconfig includes), one at a time and released after, yielding to questions; code units with their calls, resolved or unknown, built-ins counted apart; (phase 7, ADR 0028) the decisions guarding those calls (`if`, ternaries, `&&`/`||`/`??`, `switch`, `catch`), joined by branch edges labelled with their outcomes, while call edges stay as they were. Then incrementally: changed files and those with calls into them. Checked against the schema in the worker, once, before it's saved.
  - **When:** after the first index; 2 s after edits settle; one pass at a time.
  - **Kept** in `/workspace/.flowcanvas/graph.db` (its own SQLite file): versions by SHA-256 of their encoding (graph format 2, with a table of paths), compressed with zstd, the last 20; loading checks the bytes against the SHA-256 rather than the schema again. Each version is loaded straight back to time it, and the latest is kept decoded and indexed in the engine (about 60 MB for Twenty).
  - **Asked for** with the engine's `graph` request: the state, and the latest version's counts and timings; `GET …/index/graph` through the API (not activity).
  - **Shown** by Labs → Graph stats (`apps/web/src/graph/`, `packages/ui` `GraphStats`), in the inspector's Details tab, asked for only while its switch is on.
- **Flows and node details** (phase 7, ADR 0028):
  - **A flow** (`buildFlow`, `packages/graph-model/src/flow.ts`) is built in the engine's main process from the latest version, in milliseconds: breadth-first from a code unit, through the decisions guarding its calls, to 60 nodes, saying where it stopped and how many nodes aren't shown; unknown calls grouped per node; the completeness pill's counts; whether the graph has caught up with the files. A function's name is found in the graph by its place; from anywhere else, the worker names the code unit by the pass's own rules (`unitNodeAt`). A flow too large for one message is shown with fewer nodes, and says so.
  - **Details** (`packages/engine/src/semantics/details.ts`): signature, typed inputs and output, decisions and their conditions, thrown errors, awaited calls, unknown calls, writes to module state.
  - **Stored by the pass** (ADR 0029, the owner's "compute once, store, reuse"): each file's code units (their ranges) and details, in `/workspace/.flowcanvas/facts.db` (`FactsStore`), one compressed row per file with the hash of its text. The worker writes rows as it walks; the engine reads one file's when asked and checks the hash against the file. Flows from inside a function and details answer from it; a file changed since is answered by TypeScript in the worker. Each unit's calls are stored too, in the Calls tab's shape, with an index of which files call each place (`calls_into`): the Calls tab's callees, and the callers of non-members, come from them when the graph is up to date and the files are unchanged (`storedCalls` in `service.ts`).
  - **Asked for** with the engine's `flow` and `details` requests; `GET …/index/flow` and `…/index/details` through the API (activity), with TypeScript's longer timeouts.
  - **On the page** (`apps/web/src/flow/`): `useFlow` asks for a flow, lays it out with ELK (`layoutFlow`, layered, top to bottom) in a Web Worker loaded the first time a flow opens (`elk.ts`), and keeps layouts and details by graph version (ADR 0029). The canvas draws `DecisionNode` and `FlowStub` nodes and edges by provenance (`canvas/flow-parts.tsx`); the inspector's Details shows `FlowInspector` (`NodeDetails` for a function). Opened from the Code view's right-click menu, ⌘K's Flows section, and the Calls tab.
- **Proof:** `workspace/host/src/corpus.docker.test.ts` indexes all six corpus forks in real workspaces, and checks the callers and callees of 20 hand-labelled functions in Rallly and Documenso exactly (`corpus/labels/calls.json`, `corpus/src/calls.ts`); (phase 6) the graphs of four forks and 26 labelled functions in them; (phase 7) each labelled function's flow and details, at its own node; `packages/engine/src/search.perf.test.ts` times search on 100,000 names, run alone in CI's performance job.

## Workspace lifecycle (phase 1d, step 3)

```
not_created ─open─► creating ─► running ─sleep─► sleeping ─resume─► resuming ─► running
stopped / failed ─open─► creating        running / sleeping ─stop─► stopped
GET  /api/projects/:id/workspace                      ──► { workspace: { id, state, stateChangedAt, failure }, available }
POST /api/projects/:id/workspace/{open,sleep,resume,stop}  (same origin) ──► { workspace } or { error, problem, workspace }
```

- `src/workspaces/lifecycle.ts` drives every change. Each one is a compare-and-set on `version`, so two requests at once can't both act; the loser gets 409 "changed in the meantime". The provider is called between two such statements.
- `WorkspaceProvider` (`src/workspaces/provider.ts`): `create`, `start`, `pause`, `resume`, `stop`. Failures are `ProviderError`s whose kind maps to a status: `unavailable` and `refused` → 503 (left as it was), `failed` → 502 (state `failed`), `gone` → 409 (state `stopped`). Any other error becomes a plain sentence, and only a redacted description is logged.
- The provider comes from `ApiDependencies.workspaceProvider(env)`. Undefined means none can run here (staging for now), and `open` answers "Workspaces run locally for now".
- **Usage** (ADR 0018):
  - The time between `running_since` and sleep or stop is written to `usage_records`, split at month boundaries. Asleep costs nothing.
  - A workspace is metered only until `meteredUntil` (`src/workspaces/policy.ts`): now, or its last activity + 10 minutes, whichever is earlier.
  - `/api/usage` adds the live seconds of workspaces running now, so the total is current without extra writes.
- **Idle sleep** (ADR 0018):
  - `touchWorkspace()` records activity: typing in a terminal (at most every 30 s), and file and command requests.
  - The Worker's `scheduled` handler (`src/api/scheduled.ts`) runs `sleepIdleWorkspaces()` every minute: a Cron Trigger in `wrangler.jsonc`, and `scripts/dev.ts` under `pnpm dev`, since Wrangler doesn't run Cron Triggers locally.
  - With no provider (staging) it does nothing.
- **The resource guard** (ADR 0019, local only):
  - The host's `ResourceGuard` (`workspace/host/src/guard.ts`) samples memory, free disk and load every 30 s, and Flowcanvas's own disk every 5 minutes, against `BUDGET`.
  - Under pressure the host refuses to create or start a workspace, and refuses to resume one only when the laptop is busy. It removes old workspace images when disk is short, and answers `GET /v1/pressure`.
  - After the idle check, the tick runs `relievePressure()`, one workspace per tick: memory stops the least recently used (asleep first); load sleeps the least recently used running one. A notice is stored in `failure`.
  - A cloud provider has no `pressure()`.
- The page never sees the provider's own name for a workspace.

## Workspaces on the page (phase 1d, step 9)

- `GET /api/projects` returns `{ projects, workspacesAvailable }`. Each project carries `repoCommit` and its workspace's `state`, `stateChangedAt` and `failure`.
- `apps/web/src/projects/ProjectWorkspace.tsx`: `useWorkspace()` holds the record, sends `open | sleep | resume | stop`, and polls `GET …/workspace` every 3 s while starting or resuming and every 30 s while running (a GET is not activity). `ProjectWorkspace` shows the `WorkspaceStatus` chip (`packages/ui`), the actions, and the starting and asleep cards. Only recorded facts appear: no backups, checkpoints or progress figures until they exist.
- `failure` is the person-facing reason for any change they didn't ask for: a failed start, the guard (ADR 0019), or the idle sleep (ADR 0018). A requested sleep has none.
- **Open demo project:** `POST /api/projects/demo` (find or make the corpus fork at its pin), then the usual `…/workspace/open`. Where `workspacesAvailable` is false (staging), the page shows one sentence and no workspace buttons.

## Security checks for workspaces (phase 1d, step 10)

- **Canaries, never kept:** `workspace/host/src/no-leaks.docker.test.ts` (host logs, other answers, Docker's logs, `docker inspect`, process environments in the workspace) and `services/control-plane/src/api/no-leaks.test.ts` (the API, including a host that echoes its token).
- **Host sentences:** the adapter (`local-host.ts`) drops any host sentence containing the token.
- **Isolation:** `workspace/host/src/host.docker.test.ts`: the other workspace, the proxy's other sides, this computer's addresses (ports 22, 5173, 8787, 8790), metadata, DNS, IPv6, directly and through the proxy.
- **In CI:** job `docker` runs `pnpm test:docker` with `WORKSPACE_HOST_TEST_PRESSURE=none`, which only test hosts accept. The real 10-minute run is `test:idle-real`, run by hand.

## Local development

```fish
pnpm install
pnpm dev            # http://localhost:5173: Vite, with /api forwarded to the Worker in `wrangler dev` on 8787,
                    # and the workspace host on 127.0.0.1:8790 (needs WORKSPACE_HOST_TOKEN and Docker)
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
pnpm --filter @flowcanvas/ui storybook   # catalogue on http://localhost:6006
pnpm test:visual                         # catalogue baselines in both themes, axe
pnpm workspace:image                     # build the workspace image (phase 1d), skipped if up to date
pnpm test:docker                         # tests against real containers; needs Docker 28+ and the internet
pnpm workspace:resources                 # the laptop's figures and Flowcanvas's share, against the budget
pnpm workspace:clean                     # test leftovers and old images; --all --yes removes every workspace
```
