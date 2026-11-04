# Architecture

The system as it is **today** (end of phase 1b). Kept current at the end of every phase. Why things are this way is in `docs/adr/`; what's deferred is in `docs/upgrade-later.md`.

## Parts

| Package | Folder | Runs in | Today |
| --- | --- | --- | --- |
| `@flowcanvas/web` | `apps/web` | The user's browser (static files from Cloudflare) | Version page built from the design system: name, status, build line, account line (sign in with GitHub or Google, who is signed in, sign out; `src/account/`), projects list and create when signed in (`src/projects/`; a stand-in for the phase 2 start screen), each with a write-only Secrets panel (`src/secrets/`), What's new (from `CHANGELOG.md`, parsed at build time), Labs (switches for unfinished features, off by default; `src/labs/`), theme menu, link to the catalogue |
| `@flowcanvas/ui` | `packages/ui` | The browser (consumed as source by Vite, ADR 0007) | Graphite components (Button, Tag, Input, Toggle, Tabs, Panel, Menu, Popover, Tooltip, Flow node), global styles, fonts, theme switching; Storybook catalogue |
| `@flowcanvas/tokens` | `packages/tokens` | Shared (CSS and TypeScript) | Design tokens: DTCG source JSON → generated `css/tokens.css` and typed `vars` / `themeValues`; dark and light themes |
| `@flowcanvas/figma-tokens` | `tools/figma-tokens` | Developer machine / build | Generator: DTCG token JSON (Figma variable export format) → CSS variables + TypeScript |
| `@flowcanvas/control-plane` | `services/control-plane` | Inside the app's Cloudflare Worker under `/api` (ADR 0013); Neon Postgres | Hono API (`src/api/`): health, database ping, GitHub and Google sign-in, sessions, sign-out and the user/admin/same-origin guards (`src/auth/`), projects list and create (`src/projects/`), the secrets vault (`src/vault/`, ADR 0015), the workspace lifecycle and `WorkspaceProvider` (`src/workspaces/`); schema migrations and runner (`migrations/`, `src/db/`, ADR 0014). The earlier Fastify server was retired in phase 1c step 3 |
| `@flowcanvas/graph-model` | `packages/graph-model` | Shared library (browser and Node) | `BuildInfo` type and `formatBuildInfo()`; becomes the flow graph model in phase 6 |
| `@flowcanvas/engine` | `packages/engine` | Inside each user workspace (later) | Wired-in placeholder package; indexer arrives in phase 4 |
| `@flowcanvas/workspace-host` | `workspace/host` | Developer machine, started by `pnpm dev` (127.0.0.1:8790) | The local workspace host (ADR 0016): an HTTP API with a token (`src/server.ts`; protocol in `src/protocol.ts`, shared with the control plane), workspaces as Docker containers (`src/workspaces.ts`; the 2-running cap), the egress proxy (`src/egress/proxy.ts`), the laptop budget (`src/resources.ts`) and clean-up (`src/clean.ts`) |
| `@flowcanvas/workspace-image` | `workspace/image` | Developer machine (builds the image); used by the workspace host | The workspace image (`Dockerfile`: Node 24 by digest, pnpm, git, `node` user, telemetry off). Its tag is a hash of the Dockerfile. Also the locked-down `docker run` and network arguments, and the default limits (2 CPUs, 4 GiB, 1,024 processes, 1 GiB `/tmp`, 10 GiB disk measured) |
| `@flowcanvas/workspace-agent` | `workspace/agent` | Inside each workspace (a local Docker container for now, ADR 0016), as the workspace's user | The workspace agent: list, read and write the project's files and run commands, under `/workspace/project` only, never `.env` files (`src/agent.ts`). Its protocol (`src/protocol.ts`: one JSON message per line, versioned, with `parseAgentRequest`) is shared with the host and the control plane |
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
| `projects` | Owner, trimmed name (unique per owner), optional repo URL | |
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
- **The egress proxy** allows only `CONNECT` to port 443 on `github.com` and `codeload.github.com` (step 7 adds more). It resolves the name itself and refuses non-public addresses. It runs with IP forwarding off, and is connected to each workspace's network.
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
- The host opens the pty through the Docker Engine API on its Unix socket; at most 4 per workspace. Closing the WebSocket hangs up the shell. A Durable Object gateway (sessions that survive a reconnect) comes with the cloud provider (upgrade-later 36).

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
- Usage: the time between `running_since` and sleep or stop is written to `usage_records`, split at month boundaries. Asleep costs nothing.
- `sleepIdleWorkspaces()` puts workspaces idle for 10 minutes to sleep; `touchWorkspace()` records activity. Step 8 schedules them.
- The page never sees the provider's own name for a workspace.

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
