# 0005 — Hosting: Cloudflare Workers static assets, free first

- Status: accepted
- Date: 27 Oct 2026
- Phase: 1 (steps 10–12)

## Context

Phase 1 needs the web app on a staging URL and a separate preview URL for every pull request. The original plan was Cloudflare Pages, deployed from GitHub Actions, plus the control plane on Fly.io. During phase 1:
- GitHub Actions jobs couldn't start on the owner's account (an account-level billing lock), so deploys couldn't run from Actions.
- Fly.io requires a payment method.
- The owner set a **free-first policy**: use free tools and tiers now, and defer anything that needs payment to `docs/upgrade-later.md`.

Cloudflare's dashboard also now creates new projects as **Workers** (with static assets) rather than Pages.

## Options considered

1. Cloudflare Pages, deployed from GitHub Actions (blocked: Actions).
2. Cloudflare Pages with Cloudflare's Git integration.
3. **Cloudflare Workers static assets with Workers Builds** (Cloudflare's Git integration for Workers).
4. Other free static hosts (Netlify, Vercel hobby, GitHub Pages: no per-PR previews on Pages).
5. Control plane: Fly.io (paid), Render, Railway or Koyeb free tiers, or local only.

## Decision

- **Web app:** Cloudflare Worker `flowcanvas`, serving `apps/web/dist` as static assets (`wrangler.jsonc`, single-page-app fallback, preview URLs on, Wrangler telemetry off).
  - Workers Builds runs `corepack enable && pnpm install --frozen-lockfile && pnpm build --filter=@flowcanvas/web`.
  - It deploys `main` with `pnpm exec wrangler deploy` (staging: `https://flowcanvas.ahujaarmaan7777.workers.dev`).
  - It uploads other branches with `pnpm exec wrangler versions upload`, which gives preview URLs per version and a branch alias, for example `https://phase-1-project-skeleton-flowcanvas.ahujaarmaan7777.workers.dev`.
  - Security headers (strict CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) come from `apps/web/public/_headers`.
- **Control plane:** not deployed yet. A production Docker image (`services/control-plane/Dockerfile`) is built and run locally to prove it's deployable; Fly.io (or a free alternative) comes in phase 1c.

## Consequences

- Phase 1's Done-when is met at no cost. The trade-off: the preview URL isn't posted on the PR (only a pass/fail check), and the Playwright test runs against previews manually.
- Previews and staging are public URLs until Cloudflare Access is added (`docs/upgrade-later.md` item 11).
- Deferred and tracked in `docs/upgrade-later.md`:
  - deploys and the e2e test from CI once Actions work (items 8, 10)
  - control-plane hosting (item 12)
  - faster image builds (item 12)
