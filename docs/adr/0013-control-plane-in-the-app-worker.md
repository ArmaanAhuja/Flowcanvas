# 0013 — The control plane runs inside the app's Worker (Hono + Neon)

- Status: accepted (spike passed)
- Date: 30 Oct 2026
- Phase: 1c (step 1)

## Context

Phase 1c needs a control plane (sign-in, projects, secrets vault, metering) reachable by the web app. The phase 1 plan put a Fastify service on Fly.io, which needs a payment method (upgrade-later 12). The owner chose option A (decisions log, 30 Oct 2026): run it inside the existing `flowcanvas` Worker under `/api`, with a free Neon Postgres database.

## Options considered

1. **In the app Worker, under `/api` (chosen):**
   - free, no new service, same origin as the app (first-party session cookies; the app's CSP `connect-src 'self'` already allows it)
   - the price is moving from Fastify (Node.js) to a framework built on web standards
2. **Fastify on Render's free plan, with Neon.** It sleeps when idle (slow first request), sits on another origin (cross-site cookies), and needs another account.
3. **Fastify on Fly.io (original plan).** Needs a payment method.

## Decision

Option 1.
- `wrangler.jsonc` sets `main` to `services/control-plane/src/api/worker.ts` and `assets.run_worker_first: ["/api/*"]`. Only `/api/*` runs the script; every other request is served from the static files as before.
- **Hono 4.13** builds the API: web-standard `Request`/`Response`, with `app.request()` for tests without a server.
- **`@neondatabase/serverless` 1.2** sends SQL over HTTPS (no long-lived sockets), which suits Workers.
- **Outside effects are injected** (`query`, `now`, `log`), so tests run offline. A canary test proves a failing database never leaks the connection string into responses or logs (`redact()`).
- **Observability logs are on**, recording CPU time per request.
- The Fastify service in `services/control-plane/src` stays until its remaining behaviour (health with build info, log redaction) moves into the Hono API. It's the shape of a future separate service (upgrade-later 12).
- **Update (31 Oct 2026, phase 1c step 3):** done. The Fastify server, its Dockerfile and `tsconfig.build.json` are removed; `/api/health` reports the version, and logging goes through `redact()` with canary tests. Keeping a second, unused server would have meant two APIs to secure and test. A separate service can be rebuilt from git history (`git show 6512034:services/control-plane/Dockerfile`) if upgrade-later 12 is triggered. Outside effects are now `database`, `fetch`, `now` and `log`.

## Spike results (30 Oct 2026)

| Check | Result |
| --- | --- |
| Local `wrangler dev` with `.dev.vars` | `/api/health` 200; `/api/db/ping` 200 against Neon `dev` (4.2 s on the first query, while Neon's idle compute woke; 117 ms after); `/` still the static app with the strict CSP; unknown `/api/*` a JSON 404 |
| Bundle | 18 static files plus the script, 69 KB gzip (free limit 3 MB) |
| Cloudflare preview at `ba4718e` | `/api/health` 200 from the script; `/api/db/ping` 503 "not configured", as expected before the secrets were attached |
| Secrets | The first five `wrangler versions secret put` calls (assets-only Worker) said "Success", but the preview built afterwards at `ba4718e` had no `DATABASE_URL`. Re-set after the first version with a script: version `26f9c237` then answered `/api/db/ping` 200 against Neon `production` (734 ms cold, 63 ms warm), checked through its own version URL. `wrangler versions secret list --latest-version` crashes in Wrangler 4.152 ("Cannot read properties of undefined (reading 'bindings')") both before and after, so it's a Wrangler bug, not proof of missing secrets |

## Consequences

- **Verify secrets by behaviour, not by listing:** call `/api/db/ping` on the version's own URL (`https://<first 8 characters of the version id>-flowcanvas.<subdomain>.workers.dev`).
- **Secrets are set with `wrangler versions secret put`, not `wrangler secret put`.** Branch previews make the newest version differ from the deployed one, and `secret put` refuses to deploy over that. New versions inherit the latest version's secrets.
- **The first database query after Neon has been idle takes seconds** (upgrade-later 22). Sign-in will tolerate it, with a timeout and a clear message.
- **CPU per request is limited to 10 ms** on the free plan (upgrade-later 21). The dashboard's logs show CPU time per request; the vault step (6) checks encryption under it.
- **Local development:** `pnpm exec wrangler dev` serves the built app and the API on 8787. From step 3, Vite's dev server (5173) proxies `/api` to it, so OAuth callbacks on `localhost:5173` work.
