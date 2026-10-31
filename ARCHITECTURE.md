# Architecture

The system as it is **today** (end of phase 1b). Kept current at the end of every phase. Why things are this way is in `docs/adr/`; what's deferred is in `docs/upgrade-later.md`.

## Parts

| Package | Folder | Runs in | Today |
| --- | --- | --- | --- |
| `@flowcanvas/web` | `apps/web` | The user's browser (static files from Cloudflare) | Version page built from the design system: name, status, build line, account line (sign in with GitHub or Google, who is signed in, sign out; `src/account/`), projects list and create when signed in (`src/projects/`; a stand-in for the phase 2 start screen), each with a write-only Secrets panel (`src/secrets/`), What's new (from `CHANGELOG.md`, parsed at build time), Labs (switches for unfinished features, off by default; `src/labs/`), theme menu, link to the catalogue |
| `@flowcanvas/ui` | `packages/ui` | The browser (consumed as source by Vite, ADR 0007) | Graphite components (Button, Tag, Input, Toggle, Tabs, Panel, Menu, Popover, Tooltip, Flow node), global styles, fonts, theme switching; Storybook catalogue |
| `@flowcanvas/tokens` | `packages/tokens` | Shared (CSS and TypeScript) | Design tokens: DTCG source JSON → generated `css/tokens.css` and typed `vars` / `themeValues`; dark and light themes |
| `@flowcanvas/figma-tokens` | `tools/figma-tokens` | Developer machine / build | Generator: DTCG token JSON (Figma variable export format) → CSS variables + TypeScript |
| `@flowcanvas/control-plane` | `services/control-plane` | Inside the app's Cloudflare Worker under `/api` (ADR 0013); Neon Postgres | Hono API (`src/api/`): health, database ping, GitHub and Google sign-in, sessions, sign-out and the user/admin/same-origin guards (`src/auth/`), projects list and create (`src/projects/`), the secrets vault (`src/vault/`, ADR 0015); schema migrations and runner (`migrations/`, `src/db/`, ADR 0014). The earlier Fastify server was retired in phase 1c step 3 |
| `@flowcanvas/graph-model` | `packages/graph-model` | Shared library (browser and Node) | `BuildInfo` type and `formatBuildInfo()`; becomes the flow graph model in phase 6 |
| `@flowcanvas/engine` | `packages/engine` | Inside each user workspace (later) | Wired-in placeholder package; indexer arrives in phase 4 |
| `@flowcanvas/workspace-agent` | `workspace/agent` | Inside each user workspace VM (later) | Wired-in placeholder package; daemon arrives in phase 1d |
| `@flowcanvas/corpus` | `corpus` | Developer machine / CI | The test corpus: six public forks pinned in `manifest.json`; `pnpm corpus:check` verifies fork, commit, licence and stack through the GitHub API |
| `@flowcanvas/e2e` | `e2e` | Developer machine / CI | Playwright: one recorded walkthrough per phase (`try-it/`, video and trace) against any URL; visual tests (catalogue baselines in both themes, axe) |

Dependencies between packages:
- `web → ui, graph-model`
- `ui → tokens`
- `tokens → figma-tokens` (generator, dev only)
- `e2e → web` (build order only)

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
| `workspaces` | One per project, created in the same statement as the project; state (not created … running, sleeping …) | Records only until phase 1d; migration 0002 backfilled older projects |
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
  - Cloudflare's own request (invocation) logs are outside our code. The owner checks them at phase close; see `docs/STATUS.md`.
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

## Local development

```fish
pnpm install
pnpm dev            # http://localhost:5173: Vite, with /api forwarded to the Worker in `wrangler dev` on 8787
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
pnpm --filter @flowcanvas/ui storybook   # catalogue on http://localhost:6006
pnpm test:visual                         # catalogue baselines in both themes, axe
```
