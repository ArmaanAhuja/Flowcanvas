# Phase 1c — Sign-in and control plane: report

- Version: `0.4.0`
- Branch: `phase/1c-sign-in-control-plane`; PR: see `docs/STATUS.md`
- Dates: 30–31 Oct 2026
- Status: **in review**. It needs the owner's after-merge checks on staging (below) before acceptance.

## From the build plan

- **Build:** GitHub and Google sign-in; projects list; workspace records; secrets vault; usage metering skeleton; admin view.
- **Done when:** a new user signs in, creates a project and sees it listed; saved secrets never appear in logs.
- **Try it:** sign in with GitHub, create a project, add a secret, confirm the logs show no value.

**Owner decisions (30 Oct 2026, decisions log):**
- The control plane runs in the app's Worker under `/api`, with free Neon Postgres (option A; no Fly.io).
- Sign-in is limited to an allowlist, with the owner as admin.
- Sign-in works on staging and local development only.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| GitHub sign-in | ✅ | `auth/github.test.ts`, `auth/routes.test.ts` (fake GitHub, real SQL and cookies). Owner signed in for real locally (31 Oct) |
| Google sign-in | ✅ | `auth/google.test.ts`, `auth/routes.test.ts`. Google's account chooser reached locally, and the owner completed it (31 Oct) |
| Projects list | ✅ | `projects/*.test.ts`, `Projects.test.tsx`; checked against Neon `dev` |
| Workspace records | ✅ | Created with each project in one statement; migration 0002 backfilled older projects (applied to Neon `dev`) |
| Secrets vault | ✅ | ADR 0015; `vault/*.test.ts` (21 tests); checked against Neon `dev`; owner's manual check (31 Oct) |
| Usage metering skeleton | ✅ | `usage/*.test.ts`; `GET /api/usage`; Usage this month on the page |
| Admin view | ✅ | `admin/*.test.ts`, `Admin.test.tsx`; read-only check against Neon `dev` |
| **Done when:** a new user signs in, creates a project and sees it listed | ✅ local · ⏳ staging | Locally by the owner. On staging after the merge: after-merge check 4 |
| **Done when:** saved secrets never appear in logs | ✅ our logs · ⏳ Cloudflare's | `api/no-leaks.test.ts` (whole flow and failures, canaries in every response, log line and console write; it was shown to fail with redaction off). Cloudflare's own request logs: after-merge check 5 |
| **Try it** | ✅ recorded · ⏳ staging | `e2e/try-it/phase-1c.spec.ts`: signed out against the real API, then the signed-in steps with the API answered by the test (a real sign-in can't run unattended). The real Try it is after-merge checks 4–5 |

## After the merge (owner, on staging)

The order matters. Secrets go in before the database migration, and the migration runs before anyone signs in.

1. **Re-add the Worker secrets** with `pnpm exec wrangler versions secret put <NAME>`:
   - `DATABASE_URL`: staging's Neon branch
   - `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: the **staging** OAuth app's keys, not the local app's
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - `VAULT_KEY`: new for staging, saved in the password manager first

   Rotate the staging GitHub client secret while doing this. Then make the newest version live with `pnpm exec wrangler versions deploy`.
2. **Migrate staging:** `pnpm db:migrate` with the Neon `production` branch's URL, typed at a hidden prompt (0001 if not yet applied, and 0002). Then `pnpm db:allow <owner email> --admin` the same way.
3. **Check** that `/api/db/ping` answers `ok` and `/api/me` says `available`.
4. **Try it on staging:** sign in with GitHub, create a project, and add a secret with a made-up value.
5. **Cloudflare's logs:** in Workers Logs, search for the made-up value; there should be nothing. Then open the sign-in callback's entry. If it shows `code=` or cookies, turn invocation logs off (`wrangler.jsonc`) in a follow-up PR.

Results are recorded here when done.

## How to try it

1. Locally, with `.dev.vars` filled in (`.dev.vars.example`):
   ```fish
   pnpm install && pnpm db:migrate && pnpm dev    # http://localhost:5173
   ```
2. Sign in, create a project, open **Secrets**, save a made-up value, look at **Usage this month** and **Admin**.
3. Tests:
   ```fish
   pnpm test                                       # 347 tests, including no-leaks
   pnpm test:e2e && pnpm --filter @flowcanvas/e2e report    # 6 walkthroughs, 2 for phase 1c
   ```
4. Each step's "Run and check it" section is in `docs/build-steps.md` (phase 1c).

## Evidence (31 Oct 2026)

| Kind | Command | Result |
| --- | --- | --- |
| Format, lint (ESLint and Stylelint), types | `pnpm format:check && pnpm lint && pnpm typecheck` | pass |
| Unit, component, integration (real SQL in PGlite) | `pnpm test` | 347 passed: control-plane 138, ui 66, web 59, tokens 49, figma-tokens 20, corpus 10, graph-model 3, engine 1, workspace-agent 1 |
| Security (canaries) | `no-leaks.test.ts`, vault and route canary tests | pass; with redaction switched off, `no-leaks` fails |
| Build | `pnpm build` | web bundle 131 kB gzip (126 kB at 0.3.0) |
| Walkthroughs (recorded) | `pnpm test:e2e` | 6 passed |
| Visual and accessibility | `pnpm test:visual` | No changes to `packages/ui` in this phase; CI runs it on the PR |
| Against Neon `dev` | throwaway and read-only scripts | projects, vault round trip (ciphertext unreadable, cleaned up), migration 0002, admin queries |

## Deviations from the plan and why

1. **Control plane in the app Worker, not a separate service** (owner, option A; ADR 0013): free, same-origin, no payment method. The earlier Fastify server was retired (upgrade-later 12).
2. **Sign-in on staging and locally only** (owner): OAuth providers only return to registered addresses, so previews say "sign in on staging".
3. **The signed-in walkthrough answers the API inside the test.** A real GitHub or Google sign-in can't run unattended. The API side is proven by `no-leaks.test.ts`, and the real flow by the owner's after-merge check.
4. **The page layout is a stand-in.** Projects, Secrets, Usage and Admin are stacked on the version page. The app shell (Figma 06) comes in phase 2, the project screens (Figma 02–04) in phase 37, the profile and usage page in 36a, and account and admin pages in 76. The owner has seen it and expects the redesign.
5. **No usage allowance or limits:** the meter shows only what was measured. The allowance is a product decision for phase 44a.
6. **Labs choices stay per browser** (upgrade-later 20): there are no Labs switches yet, so there's nothing to store per account. The trigger is now the first Labs switch.

## Decision records added

- 0013 Control plane in the app Worker (Hono and Neon), updated when Fastify was retired
- 0014 Plain SQL migrations, tested with PGlite
- 0015 Secrets vault with envelope encryption

## Known issues and follow-ups

- **Worker secrets are lost on assets-only deploys of `main`.** Re-adding them is after-merge check 1.
- **Cloudflare invocation logs:** unknown whether they record query strings or cookies (after-merge check 5).
- **Previews and reports are public by link** (item 11). They show no user data: previews can't sign in, and reports use fake data.
- **Profile pictures not shown** (item 24), GitHub token not revoked after sign-in (25), Google app in Testing (26), no per-person limits (27), no vault key rotation (28), usage summed on read (29), admin audit log only in Worker logs (30).

## Upgrade-later review (end of phase 1c)

| Item | Status |
| --- | --- |
| 12 Control plane as a separate service | Deferred (owner, option A) |
| 13 Smaller control-plane image | On hold (no image) |
| 20 Labs choices per account | Trigger moved to "the first Labs switch"; none exists yet |
| 22 Neon paid plan | Open; free limits are far away |
| 24–30 | New in this phase |
| Others | Unchanged; triggers not reached |

## Next phase preview

**Phase 1d — Workspace sandbox:**
- one isolated virtual machine per project; clone a repo
- a file and process API, and a terminal in the browser
- outbound network rules, resource limits, sleep when idle and resume
- **Done when:** a fork clones and opens in under 60 s; a workspace sleeps after 10 idle minutes and resumes intact; workspaces can't reach each other
- **Try it:** open Rallly from its GitHub URL, run a command in the terminal, wait for sleep, then resume

It needs a managed sandbox provider (free tier first), and uses the workspace records, vault (`readSecret`) and usage meter from this phase. The "Open demo project" button moved here from 1b.
