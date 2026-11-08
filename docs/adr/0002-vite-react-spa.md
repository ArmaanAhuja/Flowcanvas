# 0002 — Vite + React single-page app for the web client

- Status: accepted
- Date: 26 Oct 2026
- Phase: 1 (step 6)

## Context

The web app is a heavy client-side tool (an infinite canvas, a code editor (Monaco when this was written; CodeMirror 6 since ADR 0021), WebSockets to the gateway) that talks to separate back-end services. It needs fast development feedback and a build that deploys anywhere, ideally as static files on a free host.

## Options considered

1. **Next.js.** Server rendering, routing and API routes built in, but it couples the UI to a Node server or a vendor platform. Server rendering adds little to a canvas tool behind sign-in.
2. **Vite + React single-page app.** Instant dev server with HMR; `vite build` outputs static files; no server of ours needed to serve the UI.
3. **Remix or React Router framework mode.** Similar trade-offs to Next.js.

## Decision

Vite 8 + React 19 single-page app in `apps/web`. The version and commit are injected at build time with Vite's `define` (`__FLOWCANVAS_BUILD__`). Component tests use Vitest + Testing Library in jsdom; end-to-end tests use Playwright against the real build.

## Consequences

- The UI is static files: hosted for free (ADR 0005), with a strict CSP (no inline scripts in the production `index.html`).
- No server-side rendering. Revisit only if a later phase needs it (for example, public share pages in stage 9).
- Back-end features live in services (control plane, gateway), never in the web app.
- One tsconfig currently covers browser code and `vite.config.ts`; splitting it is `docs/upgrade-later.md` item 4.
