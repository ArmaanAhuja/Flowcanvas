# 0004 — Node.js 24 LTS

- Status: accepted
- Date: 26 Oct 2026
- Phase: 1 (steps 1, 2)

## Context

Everything runs on Node: tooling, the control plane, and later the engine and workspace agent. On 26 Oct 2026 the development machine had Node 26, but Node 26 was not yet LTS (`lts: false` in the Node release index). Node 24 ("Krypton") was the active LTS line, LTS since 24.11.0. Corepack is no longer bundled with Node 25+.

## Options considered

1. **Node 26** (current, not yet LTS).
2. **Node 24** (active LTS).

## Decision

Target **Node 24 LTS**:
- `.nvmrc` = `24` (read by CI and Cloudflare via `NODE_VERSION`)
- `engines.node` = `>=24.11` with `engineStrict: true`
- `@types/node` 24.x
- Docker base image `node:24-slim`

Newer Node versions on developer machines are fine (`>=`).

## Consequences

- CI and hosted builds use a supported LTS runtime.
- `engineStrict` blocks fresh installs and `--frozen-lockfile` installs on older Node. A plain `pnpm install` on an already-installed repo skips the check.
- On Node 25+, Corepack is installed separately (`npm install -g corepack`); Node 24 still bundles it, so CI and Cloudflare just run `corepack enable`.
- Switching to Node 26 when it becomes LTS is `docs/upgrade-later.md` item 2.

## Addendum (8 Nov 2026): Node 26 LTS

- **The repository moved to Node 26** (upgrade-later 2, PR #17): `.nvmrc` 26, `engines >=26.13`, `@types/node` 26, the workspace image `node:26-slim` pinned by digest.
- **Cloudflare doesn't read `.nvmrc`; it reads its own build variable `NODE_VERSION`,** which overrides it. The first Node 26 build failed on Cloudflare with `ERR_PNPM_UNSUPPORTED_ENGINE`: it still installed 24.22.2 from that variable, and our CI's copy of Cloudflare's build (which reads `.nvmrc`) couldn't see the difference.
- **So a Node change has two more places:** `NODE_VERSION` in the build settings of **both** Cloudflare projects, `flowcanvas` and `flowcanvas-catalogue` (set to the exact version, 26.13.0). The owner changes them; they're account settings.
