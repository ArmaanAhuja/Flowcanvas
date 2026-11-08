# Build steps

A running record of every step to build Flowcanvas, in order. Each step is explained in chat first and added here at the same time. The project owner then decides who does it (owner or Claude). Status: **done** (with commit and who did it), **next** (explained, waiting) or *planned*.

Machine conventions: fish shell, Node from the system (26.x locally; the repo pins 24 LTS), pnpm through Corepack.

---

## Phase 1 — Project skeleton

**Build:** Monorepo (web app, workspace agent, engine, control plane, shared types); React web app deployed to a staging URL; CI with lint, type checks and tests.
**Done when:** The staging URL loads the app; every pull request gets its own preview URL.
**Try it:** Open the staging link; the app loads and shows its version.

### Expected outcome

When phase 1 is done you can:

- Open a **staging URL** in your browser and see a page saying **Flowcanvas**, the version (`0.1.0`) and the commit it was built from. The page is plain and unstyled; the Graphite look arrives in phase 1a.
- Open any **pull request** on GitHub and find a bot comment with that PR's own **preview URL**, showing the PR's commit.
- Run the **control plane** in a Docker container locally and see the same version and commit from its `/health` as JSON. (Deploying it to Fly.io is deferred until phase 1c because it needs a payment method; see `docs/upgrade-later.md` item 12.)
- Run the same app **locally** with one command and see it in your browser at `http://localhost:5173`.
- Run **all checks** (lint, type-check, unit tests, end-to-end test) locally with one command each, and see them run automatically on every PR.

### Run and check it

*Complete. Every row was verified at the end of phase 1 (26–27 Oct 2026).*

```fish
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # all green
pnpm format:check
```

| What to check | How | Expected |
| --- | --- | --- |
| Code quality gates | the commands above | every task "successful"; `format:check` says all files use Prettier style |
| Shared package logic | `pnpm test` | `@flowcanvas/graph-model`: 3 tests passed |
| Web app runs locally | `pnpm dev` → http://localhost:5173 | heading **Flowcanvas** and `0.1.0 · <short commit>` matching `git rev-parse --short HEAD`; `pnpm test` → web: 2 passed |
| Control plane runs locally | `pnpm dev`, then `curl http://127.0.0.1:8080/health` | `{"status":"ok","version":"0.1.0","commit":"<git rev-parse HEAD>"}`; `pnpm test` → control-plane: 3 passed (incl. secret-redaction canary) |
| End-to-end test | `pnpm test:e2e` (first time: `pnpm --filter @flowcanvas/e2e exec playwright install chromium`) | real Chromium opens the production build: `1 passed`; `E2E_EXPECTED_COMMIT=deadbeef00 pnpm test:e2e` must fail |
| PR preview URL | `https://phase-1-project-skeleton-flowcanvas.ahujaarmaan7777.workers.dev` (branch alias, always the latest push) or `https://<first 8 chars of version id>-flowcanvas.ahujaarmaan7777.workers.dev` (one version) | **Flowcanvas** and `0.1.0 · <PR head commit>`; `curl -sI <url>` shows `content-security-policy`; `E2E_BASE_URL=<url> E2E_EXPECTED_COMMIT=(git rev-parse HEAD) pnpm --filter @flowcanvas/e2e test:e2e` → 1 passed |
| Staging (web) | open `https://flowcanvas.ahujaarmaan7777.workers.dev`; `E2E_BASE_URL=https://flowcanvas.ahujaarmaan7777.workers.dev E2E_EXPECTED_COMMIT=(git rev-parse origin/main) pnpm --filter @flowcanvas/e2e test:e2e` | **Flowcanvas** and `0.1.0 · <main's short commit>`; security headers present; 1 passed |
| Control plane in a container | `docker build -f services/control-plane/Dockerfile --build-arg FLOWCANVAS_COMMIT=(git rev-parse HEAD) -t flowcanvas-control-plane .`, then `docker run -d --name flowcanvas-cp -p 127.0.0.1:8095:8080 flowcanvas-control-plane` and `curl http://127.0.0.1:8095/health` | version `0.1.0` and the built commit; `docker exec flowcanvas-cp id -un` → `node`; `docker stop` → exit 0 |

### Steps

| # | Step | Status |
| --- | --- | --- |
| 1 | Tooling and repository | done · `7e59ec1` · Claude |
| 2 | Workspace root | done · `6b074cb` · Claude |
| 3 | Shared TypeScript config and `packages/graph-model` with its first test | done · `f7b99cd` · Claude |
| 4 | Turborepo tasks and caching | done · `5a010d9` · Claude |
| 5 | ESLint and Prettier | done · `d88f916` · Claude |
| 6 | `apps/web`: Vite + React, version and commit injected at build time, test | done · `3e33324` · Claude |
| 7 | `services/control-plane`: Fastify `/health`, tests, log redaction | done · `f03f422` · Claude |
| 8 | Minimal `workspace/agent` and `packages/engine` | done · `c30c1c0` · Claude |
| 9 | Playwright smoke test | done · `9f4245f` · Claude |
| 10 | GitHub Actions CI, open the PR, branch protection | done · `a3247c7` · Claude · CI first ran on GitHub on 31 Oct 2026, after the repository moved (phase 1b step 9); branch protection: upgrade-later item 1 |
| 11 | Cloudflare (Workers static assets): previews per PR, smoke test on preview | done · `6359831` · Claude (repo) + owner (Cloudflare setup) · verified on preview of `be3cf59` |
| 12 | Control-plane Docker image, built and run locally (Fly.io deploy deferred: `docs/upgrade-later.md` item 12) | done · `17b96b7` · Claude · repo image verified (`/health` reports `17b96b7`, non-root, clean shutdown) |
| 13 | ADRs, `ARCHITECTURE.md`, `STATUS.md`, `CHANGELOG.md`, phase report, merge, staging live | done · `1df8872` + merge `9a18708` · Claude · staging verified with Playwright |

### Step 1 — Tooling and repository

**Goal:** pnpm installed reproducibly, the GitHub CLI on the owner's account, reference docs organised, first commit pushed to `main`.

**Node version.** Check https://nodejs.org/en/about/previous-releases (or `https://nodejs.org/dist/index.json`, field `lts`). On 26 Oct 2026, Node 26 was not yet LTS, so the repo pins **Node 24** ("Krypton", LTS since 24.11.0). Switch to 26 once it becomes LTS (ADR 0005).

**pnpm through Corepack.** Node 25+ no longer bundles Corepack, so install it from npm. Corepack reads `packageManager` in `package.json` and runs exactly that pnpm version everywhere.

```fish
npm config set prefix ~/.local          # user-level global installs, no sudo
fish_add_path ~/.local/bin              # persistent PATH entry in fish
npm install -g corepack@latest
corepack enable pnpm
pnpm --version                          # answer Y if asked to download
```

**GitHub CLI on the right account.**

```fish
gh auth login                           # only if the account isn't listed in `gh auth status`
gh auth switch --user ArmaanAhuja-7777
gh auth setup-git                       # plain `git push` uses the active gh account
gh auth status
```

**Folder layout.** Reference docs in `docs/reference/` (`build-plan.md`, `research-report.md`, `design-brief.md`, `design-language-graphite.md`), screenshots in `docs/reference/screens/`, Figma generator scripts in `docs/reference/figma-scripts/`. The build prompt is `CLAUDE.md` at the root, so Claude Code loads it every session.

**`.gitignore`:** build output (`node_modules/`, `dist/`, `build/`, `.turbo/`, `*.tsbuildinfo`), test output (`coverage/`, `playwright-report/`, `test-results/`, `blob-report/`), secrets (`.env`, `.env.*`, but `!.env.example`), tooling (`.wrangler/`, `.DS_Store`, `*.log`, `.idea/`).

**First commit.**

```fish
git init -b main
git add .gitignore CLAUDE.md docs
git status                              # only docs; nothing secret
git commit -m "docs: add product, design and build reference documents"
git remote add origin https://github.com/ArmaanAhuja/Flowcanvas.git
git push -u origin main
```

**Gotchas:** a `403` on push means the wrong `gh` account is active. If `pnpm` isn't found in a new terminal, `~/.local/bin` isn't on PATH. A secret committed once stays in git history even after it's deleted.

### Step 2 — Workspace root

**Goal:** make the repo a pnpm workspace with pinned tool versions and shared editor rules, on the phase branch.

**Concepts:**
- A **workspace** is one repo with many packages, one install, one lockfile, and local cross-package links through `workspace:*`. Docs: https://pnpm.io/workspaces
- The root `package.json` is the control centre, not a shipped package. `"private": true` prevents accidental publishing.
- **`packageManager`** pins pnpm through Corepack.
- **`engines`** + **`engineStrict`** turn a wrong Node version into an error. In pnpm 10+ the setting lives in `pnpm-workspace.yaml`. Docs: https://pnpm.io/settings#enginestrict
- The **lockfile** pins the whole dependency tree. Always commit it; CI uses `--frozen-lockfile`.
- **`.nvmrc`** is the single source of the Node version for CI (`setup-node` reads it).
- **`.editorconfig`** sets indentation, line endings and final newline for every editor. Docs: https://editorconfig.org
- **`"type": "module"`** makes `.js` files ES modules. Every tool we use is ESM-first.

**Branch:**

```fish
git switch -c phase/1-project-skeleton
```

**`package.json`:**

```json
{
  "name": "flowcanvas",
  "version": "0.1.0",
  "private": true,
  "description": "Canvas-first, AI-native development environment (working name)",
  "type": "module",
  "packageManager": "pnpm@12.15.0",
  "engines": {
    "node": ">=24.11"
  },
  "scripts": {}
}
```

**`pnpm-workspace.yaml`:**

```yaml
packages:
  - "apps/*"
  - "services/*"
  - "workspace/*"
  - "packages/*"
  - "packages/connectors/*"
  - "tools/*"
  - "e2e"

engineStrict: true
```

**`.nvmrc`:** `24`

**`.editorconfig`:**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

**Commands:**

```fish
pnpm install                  # "Already up to date … using pnpm v12.15.0"; creates pnpm-lock.yaml (lockfileVersion '9.0')
pnpm ls -r --depth -1         # flowcanvas@0.1.0 (PRIVATE)
```

**Verify:**
- `pnpm --version` prints `12.15.0` inside the repo.
- Set `engines.node` to `">=99"` and run `pnpm install --frozen-lockfile`. Expect `ERR_PNPM_UNSUPPORTED_ENGINE`. Restore `>=24.11` afterwards.

**Gotchas:**
- A plain `pnpm install` on an already-installed repo says "Already up to date" and **skips the engine check**. Only fresh installs and `--frozen-lockfile` (CI) enforce it.
- Trailing commas and comments make `package.json` invalid.
- Always commit `pnpm-lock.yaml`.
- Check `git branch --show-current` before committing.

**Commit:** `chore: set up pnpm workspace root`

### Step 3 — Shared TypeScript config and the first package

**Goal:** one strict TypeScript configuration for the whole repo, and the first real package (`@flowcanvas/graph-model`) that builds, type-checks and has passing tests. It proves the package pattern every later package copies.

**Concepts:**
- **Why TypeScript 6.0.x, not 7.** TypeScript 7 is the native (Go) compiler. Its JavaScript API is published only as `typescript/unstable/*`, and typescript-eslint supports `typescript <6.1`. Phase 5 needs the stable compiler API, so we pin **6.0.3**, the last JavaScript-implemented line. We revisit when TS 7's API is stable (ADR 0004). Docs: https://www.typescriptlang.org/docs/
- **pnpm catalogs.** Shared dependency versions are defined once in `pnpm-workspace.yaml` under `catalog:`. Packages write `"typescript": "catalog:"`, so every package uses the same version and an upgrade is a one-line change. Docs: https://pnpm.io/catalogs
- **`tsconfig.base.json` + `extends`.** Every package inherits the same strict settings and only adds its own paths. Docs: https://www.typescriptlang.org/tsconfig/#extends
- **Strictness flags beyond `strict`:**
  - `noUncheckedIndexedAccess`: `arr[i]` is `T | undefined`.
  - `exactOptionalPropertyTypes`: `{ a?: string }` doesn't accept an explicit `undefined`.
  - `noImplicitOverride`
  - `noFallthroughCasesInSwitch`

  They catch whole classes of runtime bugs at compile time. Docs: https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess
- **`module`/`moduleResolution: nodenext`.** TypeScript follows Node's real ESM rules, so relative imports need the **`.js` extension** (`./build-info.js`) even though the file is `.ts`; the extension names the file that will exist at runtime. The web app overrides this with `bundler` in step 6. Docs: https://www.typescriptlang.org/docs/handbook/modules/theory.html
- **`verbatimModuleSyntax` + `isolatedModules`.** Type-only imports must say `import type` (or `type` inline), so tools that compile one file at a time (Vite, Vitest, esbuild) can safely drop them.
- **`types: []`.** No ambient global types (such as `@types/node`) leak into a package unless it opts in. `graph-model` is pure TypeScript and shouldn't see Node globals.
- **Compiled internal packages.** Each package builds `src/` into `dist/` (JS + `.d.ts`). `exports` points consumers at `dist`, and Turborepo (step 4) builds dependencies first. The alternative, consuming raw `.ts` source, saves a build but forces every consumer (Vite, Node, the Fastify service, Docker images) to transpile other packages' TypeScript. Compiled packages behave the same everywhere. Docs: https://nodejs.org/api/packages.html#package-entry-points
- **Two tsconfigs per package.** `tsconfig.json` type-checks everything, including tests. `tsconfig.build.json` extends it, excludes tests and emits `dist/`.
- **Vitest basics.**
  - `describe` groups tests, `it` is one case, and `expect(x).toBe(y)` asserts.
  - `vitest run` runs once (CI style). Plain `vitest` watches.
  - Test files sit next to the code as `*.test.ts`. Imports come from `'vitest'` explicitly; no globals.
  - Docs: https://vitest.dev/guide/
- **What makes a good unit test:** the normal case, the edge cases (already-short SHA), and the "honest failure" case (no commit known → say "unknown" instead of inventing one, the product's never-fabricate rule in miniature).

**`pnpm-workspace.yaml`** (append):

```yaml

catalog:
  typescript: 6.0.3
  vitest: 5.0.5
```

**Root `package.json`:** add a dev dependency so editors and root commands use the same TypeScript:

```json
  "devDependencies": {
    "typescript": "catalog:"
  }
```

**`tsconfig.base.json`** (repo root):

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

`es2024` is fully supported by Node 24 and current browsers. `declarationMap` lets "go to definition" jump into a package's `.ts` source instead of its `.d.ts`.

**`packages/graph-model/package.json`:**

```json
{
  "name": "@flowcanvas/graph-model",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**`packages/graph-model/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**`packages/graph-model/tsconfig.build.json`:**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

**`packages/graph-model/src/build-info.ts`:**

```ts
export interface BuildInfo {
  readonly version: string;
  readonly commit: string;
}

const SHORT_SHA_LENGTH = 7;

export function formatBuildInfo(info: BuildInfo): string {
  const commit = info.commit.trim();
  const shown = commit === '' ? 'unknown commit' : commit.slice(0, SHORT_SHA_LENGTH);
  return `${info.version} · ${shown}`;
}
```

**`packages/graph-model/src/index.ts`:**

```ts
export { formatBuildInfo, type BuildInfo } from './build-info.js';
```

**`packages/graph-model/src/build-info.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { formatBuildInfo } from './build-info.js';

describe('formatBuildInfo', () => {
  it('shortens a full commit SHA to 7 characters', () => {
    expect(
      formatBuildInfo({ version: '0.1.0', commit: '7e59ec1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e' }),
    ).toBe('0.1.0 · 7e59ec1');
  });

  it('keeps a commit that is already short', () => {
    expect(formatBuildInfo({ version: '0.1.0', commit: 'abc12' })).toBe('0.1.0 · abc12');
  });

  it('says the commit is unknown instead of inventing one', () => {
    expect(formatBuildInfo({ version: '0.1.0', commit: '  ' })).toBe('0.1.0 · unknown commit');
  });
});
```

**Commands:**

```fish
pnpm install                                   # adds typescript 6.0.3 and vitest 5.0.5
pnpm --filter @flowcanvas/graph-model typecheck
pnpm --filter @flowcanvas/graph-model test     # 1 file, 3 tests passed
pnpm --filter @flowcanvas/graph-model build    # dist/ gets index.js, index.d.ts, build-info.js, maps
```

`--filter` runs a script in one workspace package from the repo root. Docs: https://pnpm.io/filtering

**Verify:**
- Type-check prints nothing (silence means success).
- Tests: `Tests 3 passed (3)`.
- `dist/` has no `*.test.*` files.
- `ls -la packages/graph-model/node_modules` shows `typescript` and `vitest` as **symlinks** into `node_modules/.pnpm/…`: pnpm's content-addressed store.
- Break something on purpose: change `'unknown commit'` to `'n/a'`, rerun the tests, see one fail with a diff, then revert.

**Gotchas:**
- Writing `./build-info` without `.js` fails under `nodenext` (`Relative import paths need explicit file extensions`).
- Exporting a type without `type` under `verbatimModuleSyntax` gives error TS1205/TS1484.
- `dist/` is git-ignored. Never edit it.
- `tsc` doesn't delete stale files from `dist/`. If you rename a source file, delete `dist/` before rebuilding (a `clean` task comes later).

**Commit:** `feat(graph-model): add shared TypeScript config and build info formatter`

**Done notes (step 3):** the deliberate-failure check worked (`Expected: "0.1.0 · unknown commit"`, `Received: "0.1.0 · n/a"`). `dist/` stays out of git.

### Step 4 — Turborepo tasks and caching

**Goal:** one command at the root (`pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`) runs that task in every package, in dependency order, in parallel where possible, and skips work whose inputs haven't changed.

**Concepts:**
- **Task graph.** Turborepo reads each package's `package.json` dependencies and the task rules in `turbo.json`, then builds a graph of tasks such as `@flowcanvas/web#build` and `@flowcanvas/graph-model#build`. Docs: https://turborepo.dev/docs/crafting-your-repository/configuring-tasks
- **`dependsOn: ["^build"]`.** The caret means "the `build` task of my **dependencies** first". So `web#typecheck` waits for `graph-model#build`, because `web` imports `graph-model`'s `dist/*.d.ts`. Without the caret (`["build"]`) it would mean "my own build first".
- **Caching.**
  - Before running a task, Turbo hashes its inputs: the package's files, the hashes of its dependencies' tasks, the relevant lockfile entries, `globalDependencies`, and any env vars you declare.
  - If that hash has run before, Turbo **restores the declared `outputs`** (such as `dist/**`) and replays the saved logs instead of running the task ("cache hit, replaying logs", "FULL TURBO").
  - Tasks with no `outputs` (test, typecheck) cache only their logs and success.
  - The local cache lives in `.turbo/` (git-ignored). A shared remote cache can come later.
  - Docs: https://turborepo.dev/docs/crafting-your-repository/caching
- **`globalDependencies`.** Files outside any package that affect every task. `tsconfig.base.json` sits at the root, so without this line, changing it would **not** invalidate the cache and you'd get stale "passing" results.
- **Telemetry is off.** Turborepo sends anonymous usage telemetry by default. Our rule is telemetry off by default, for our tools too: disable it once per machine, and in CI with `TURBO_TELEMETRY_DISABLED=1` (step 10). Docs: https://turborepo.dev/docs/telemetry
- **Running one package.** `pnpm --filter @flowcanvas/graph-model test` runs that package's script directly, without Turbo. `pnpm exec turbo run test --filter=@flowcanvas/graph-model` runs it through Turbo, with its dependencies and cache.

**`pnpm-workspace.yaml`:** add to the catalog (alphabetical):

```yaml
catalog:
  turbo: 2.11.10
  typescript: 6.0.3
  vitest: 5.0.5
```

**Root `package.json`:** scripts and dev dependency:

```json
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "catalog:",
    "typescript": "catalog:"
  }
```

**`turbo.json`** (repo root):

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "globalDependencies": ["tsconfig.base.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {
      "dependsOn": ["^build"]
    }
  }
}
```

- `$schema` gives editor autocomplete and validation.
- `lint` depends on `^build` because type-aware ESLint rules (step 5) need dependencies' types.
- A `dev` task (persistent, uncached) comes in step 6 with the web app.

**Commands:**

```fish
pnpm install
pnpm exec turbo telemetry disable    # once per machine
pnpm build                           # 1 successful, 0 cached
pnpm build                           # again: 1 cached, ">>> FULL TURBO", a few ms
pnpm test                            # Tests 3 passed
pnpm test                            # "cache hit, replaying logs"
pnpm typecheck
pnpm lint                            # "0 total": no package has a lint script yet (step 5)
pnpm exec turbo run build --dry=json # inspect the task graph and cache status without running
```

**Verify:**
- The second `pnpm build` is a full cache hit.
- Delete `packages/graph-model/dist`, then run `pnpm build`. It's still a cache hit, **and `dist/` is back**: Turbo restored the declared outputs from cache.
- Add a blank line to `tsconfig.base.json` and run `pnpm build`. It should be a cache **miss** (proves `globalDependencies`). Revert the change.
- `pnpm exec turbo telemetry status` says you've opted out.

**Gotchas:**
- Forgetting `outputs` on `build` means a cache hit restores **nothing**: logs say success, `dist/` is missing, and the next package fails confusingly.
- Turbo only sees env vars you declare (`env` / `globalEnv`). From step 6 on, any env var that changes a build output (such as the commit SHA) must be declared, or the cache will serve a build with a stale value.
- Running `vitest` directly inside a package bypasses Turbo and its `^build` ordering. If a dependency's `dist/` is stale, build first.

**Commit:** `build: add Turborepo task pipeline`

**Done notes (step 4):**
- Cache hits restore `dist/` (deleted, rebuilt from cache, 8 files back).
- Touching `tsconfig.base.json` causes a cache miss.
- Telemetry status: Disabled.
- Quick-check answer: changing **only a test file** in `graph-model` still invalidates `graph-model#build`. Turbo hashes all files in the package by default, regardless of what `tsc` compiles. It could be narrowed with `"inputs": ["$TURBO_DEFAULT$", "!src/**/*.test.ts"]` on `build`; not done yet, since the build is fast.

### Step 5 — ESLint and Prettier

**Goal:** every package is linted with type-aware rules through `pnpm lint` (via Turbo), and the whole repo has one consistent format enforced by `pnpm format:check`, ready to become CI gates in step 10.

**Concepts:**
- **Linter vs formatter.** ESLint finds *problems* (bugs, unsafe patterns). Prettier only decides *layout* (quotes, wrapping, commas). Keeping them separate means style never shows up as a lint error. `eslint-config-prettier` switches off the few ESLint rules that would fight Prettier. Docs: https://prettier.io/docs/integrating-with-linters
- **Flat config (`eslint.config.js`).**
  - ESLint 9+ uses one JavaScript file that exports an array of config objects. Later objects override earlier ones for the files they match.
  - `defineConfig()` (from `eslint/config`) gives typing and supports `extends` inside an object.
  - `globalIgnores()` excludes paths everywhere.
  - `typescript-eslint`'s older `tseslint.config()` helper is deprecated in favour of `defineConfig()`.
  - Docs: https://eslint.org/docs/latest/use/configure/configuration-files
- **Where ESLint finds the config.** ESLint 10 looks for `eslint.config.js` starting from each linted file's folder and walking up. A package running `eslint .` finds the one root config; there's no per-package copy.
- **Type-aware linting.** `strictTypeChecked` rules use the TypeScript type checker, not just syntax. Examples:
  - `no-floating-promises`: an unawaited promise silently swallows errors.
  - `require-await`
  - `no-unnecessary-condition`
  - `no-non-null-assertion`

  `projectService: true` lets each file use its nearest `tsconfig.json`. Plain `.js` config files have no types, so `disableTypeChecked` turns those rules off for `**/*.js`. Docs: https://typescript-eslint.io/getting-started/typed-linting
- **Which rule sets.** `strictTypeChecked` is the opinionated bug-catching set. `stylisticTypeChecked` covers consistent TypeScript idioms (for example, prefer `interface` for object types). Both are recommended for new projects by the typescript-eslint team. Docs: https://typescript-eslint.io/users/configs
- **Prettier settings.** We keep the defaults except single quotes, 100-column lines and trailing commas everywhere (smaller diffs). `.prettierignore` skips generated files, the lockfile, the reference docs, and Markdown, because the docs' hand-aligned tables would be rewritten. Docs: https://prettier.io/docs/options
- **Why Prettier runs at the root and not through Turbo.** It is fast, has no package dependencies, and one `prettier --check .` covers config files outside packages too (`turbo.json`, `pnpm-workspace.yaml`, workflows later).

**`pnpm-workspace.yaml`:** catalog becomes (Prettier will turn the double quotes into single quotes):

```yaml
catalog:
  '@eslint/js': 10.0.1
  eslint: 10.13.0
  eslint-config-prettier: 10.1.8
  prettier: 3.9.10
  turbo: 2.11.10
  typescript: 6.0.3
  typescript-eslint: 8.72.0
  vitest: 5.0.5
```

**Root `package.json`:** add scripts and dev dependencies:

```json
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@eslint/js": "catalog:",
    "eslint": "catalog:",
    "eslint-config-prettier": "catalog:",
    "prettier": "catalog:",
    "turbo": "catalog:",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:"
  }
```

The config file at the root imports `@eslint/js`, `typescript-eslint` and `eslint-config-prettier`, so they are root dev dependencies. pnpm's strict `node_modules` only lets a file import what its own `package.json` declares.

**`packages/graph-model/package.json`:** add a `lint` script and `eslint` (each package runs its own `eslint` binary):

```json
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "devDependencies": {
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
```

**`eslint.config.js`** (repo root):

```js
// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/', '**/coverage/', '**/.turbo/', 'docs/reference/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
]);
```

- `// @ts-check` makes your editor type-check this JavaScript file, catching config typos.
- Order matters: recommended rules, then strict and stylistic, then parser options, then the `.js` exception, then `prettier` **last** so it can switch off conflicting rules.

**`.prettierrc.json`:**

```json
{
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

**`.prettierignore`:**

```
dist/
coverage/
.turbo/
pnpm-lock.yaml
docs/reference/
*.md
```

**Commands:**

```fish
pnpm install
pnpm format          # rewrites files to Prettier style (pnpm-workspace.yaml gets single quotes)
pnpm format:check    # "All matched files use Prettier code style!"
pnpm lint            # turbo → @flowcanvas/graph-model:lint → eslint . → no problems
```

**Verify:** prove the type-aware rules are really on. Add `packages/graph-model/src/bad.ts`:

```ts
export async function load(): Promise<number> {
  return 1;
}
export function run(): void {
  load();
}
```

`pnpm lint` should report **`@typescript-eslint/require-await`** and **`@typescript-eslint/no-floating-promises`**, both of which need type information. Delete the file and lint is clean again.

**Editor (optional):** install the VS Code extensions "ESLint" (`dbaeumer.vscode-eslint`) and "Prettier" (`esbenp.prettier-vscode`), and turn on "Format on save". You then see the same results as CI while typing.

**Gotchas:**
- `Parsing error: … was not found by the project service` means the file isn't in any `tsconfig.json` `include`. Add it to a tsconfig, or lint it as plain JS.
- Running `eslint` from the root with no config file found means an ESLint version mismatch or a missing root dev dependency.
- If `pnpm format` reformats a file you didn't mean to touch, add it to `.prettierignore`. Don't fight Prettier with manual layout.
- Lint errors are fixed in code. Disable a rule only with a comment that explains why (`// eslint-disable-next-line rule-name -- reason`).

**Commit:** `chore: add ESLint (type-aware) and Prettier`

### Step 6 — The web app (`apps/web`)

**Goal:** a React app, built with Vite, that shows "Flowcanvas", the version and the exact commit it was built from. It runs locally with `pnpm dev` and has component tests. This is the page staging and previews will serve.

**Expected outcome:** `pnpm dev` and open http://localhost:5173: a plain page with the heading **Flowcanvas** and a line like **0.1.0 · d88f916** (your current commit). It's unstyled on purpose; phase 1a applies the Graphite design.

**Concepts:**
- **How Vite works.**
  - In dev, Vite doesn't bundle. The browser loads `index.html`, which imports `/src/main.tsx`, and Vite transforms each file on request (TS/JSX → JS) and serves it as a native ES module. That is why startup is instant and edits hot-reload (HMR) in milliseconds.
  - `vite build` bundles everything with Rolldown (Vite 8's Rust bundler) into `dist/`, with hashed file names for caching.
  - `vite preview` serves that `dist/` locally, so you can check the real production output.
  - Docs: https://vite.dev/guide/why.html and https://vite.dev/guide/
- **`index.html` is the entry point.** It sits at the package root (not in `public/`). Vite follows its `<script type="module">` to find the app.
- **`define`: compile-time constants.** `define: { __FLOWCANVAS_BUILD__: JSON.stringify(buildInfo) }` makes Vite replace every `__FLOWCANVAS_BUILD__` in the source with that literal object at build time. Nothing is fetched at runtime; the version is baked into the bundle. The `declare const` in `vite-env.d.ts` tells TypeScript the global exists and what type it has. Docs: https://vite.dev/config/shared-options.html#define
- **Where the commit comes from.** `vite.config.ts` uses `FLOWCANVAS_COMMIT` if set (CI sets it), otherwise `git rev-parse HEAD`, otherwise an empty string. The shared formatter then shows "unknown commit": we never invent one.
- **Turbo's strict env mode and the cache.** Turbo 2 passes a task only the env vars it declares, and hashes them. `@flowcanvas/web#build` declares `env: ["FLOWCANVAS_COMMIT"]`, and the root `build` script sets it to the current commit (`FLOWCANVAS_COMMIT=$(git rev-parse HEAD) turbo run build`; pnpm runs scripts with `sh`, so `$(…)` works). A new commit therefore means a new hash and a rebuild of `web` only, while `graph-model` stays cached. Without this, a cached bundle could show an **old** commit, which is exactly the "stale value shown as current" mistake the product forbids. Docs: https://turborepo.dev/docs/crafting-your-repository/using-environment-variables
- **Package-specific task (`@flowcanvas/web#build`).** It overrides the generic `build` rule for one package only.
- **The `dev` task.** `persistent: true` (it never exits) and `cache: false` (a running server can't be cached). It still depends on `^build`, so `graph-model` is compiled before Vite starts.
- **`moduleResolution: bundler`.** The web app is bundled by Vite, not run by Node, so it uses bundler resolution: extensionless relative imports (`./App`) are fine here, unlike the `.js` rule in Node packages. `jsx: react-jsx` uses React's automatic JSX runtime (no `import React` needed). `lib` adds `dom` types. Docs: https://www.typescriptlang.org/docs/handbook/modules/reference.html#bundler
- **`types: ["vite/client", "node"]`.** `vite/client` types things like `import.meta.env` and asset imports. `node` is there for `vite.config.ts`, which runs in Node. Trade-off: browser code could type-check a Node-only API like `process`. We accept that for now with one tsconfig, rather than splitting `tsconfig.app.json` and `tsconfig.node.json`, because typescript-eslint's project service picks up a single `tsconfig.json` cleanly.
- **Component tests with Testing Library.**
  - Vitest runs the test in **jsdom**, a simulated browser DOM in Node (`test.environment: 'jsdom'`).
  - `render()` mounts the component. `screen.getByRole('heading', { name: 'Flowcanvas' })` finds it the way a user or screen reader would, and **throws** if it isn't there, so the lookup itself is the assertion.
  - `cleanup` after each test unmounts components, so tests don't leak into each other (automatic only when Vitest globals are on; we keep imports explicit).
  - Docs: https://testing-library.com/docs/react-testing-library/intro/ and https://testing-library.com/docs/queries/about#priority
- **Props over globals for testability.** `App` receives `buildInfo` as a prop. Only `main.tsx` reads the global `__FLOWCANVAS_BUILD__`. Tests pass a fixed value, so they don't depend on whichever commit you're on.
- **Fail loudly at startup.** If `#root` is missing, `main.tsx` throws a clear error instead of rendering nothing silently.

**`pnpm-workspace.yaml`:** the catalog becomes:

```yaml
catalog:
  '@eslint/js': 10.0.1
  '@testing-library/dom': 10.4.2
  '@testing-library/react': 16.3.3
  '@types/node': 24.19.2
  '@types/react': 19.3.0
  '@types/react-dom': 19.3.0
  '@vitejs/plugin-react': 6.1.2
  eslint: 10.13.0
  eslint-config-prettier: 10.1.8
  jsdom: 30.1.3
  prettier: 3.9.10
  react: 19.3.1
  react-dom: 19.3.1
  turbo: 2.11.10
  typescript: 6.0.3
  typescript-eslint: 8.72.0
  vite: 8.3.5
  vitest: 5.0.5
```

`@types/node` is pinned to the 24 line to match the Node version we target, not your local 26.

**Root `package.json`:** scripts become:

```json
  "scripts": {
    "dev": "turbo run dev",
    "build": "FLOWCANVAS_COMMIT=$(git rev-parse HEAD) turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
```

**`turbo.json`:** add two tasks:

```json
    "@flowcanvas/web#build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "env": ["FLOWCANVAS_COMMIT"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    }
```

**`apps/web/package.json`:**

```json
{
  "name": "@flowcanvas/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@flowcanvas/graph-model": "workspace:*",
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@testing-library/dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "eslint": "catalog:",
    "jsdom": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

`"@flowcanvas/graph-model": "workspace:*"` links the local package; `*` means "whatever version is in the workspace".

**`apps/web/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2024", "dom", "dom.iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client", "node"],
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

**`apps/web/index.html`:**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Flowcanvas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`apps/web/vite.config.ts`:**

```ts
/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import type { BuildInfo } from '@flowcanvas/graph-model';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import rootPackage from '../../package.json' with { type: 'json' };

function resolveCommit(): string {
  const fromEnv = process.env.FLOWCANVAS_COMMIT?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const buildInfo: BuildInfo = { version: rootPackage.version, commit: resolveCommit() };

export default defineConfig({
  plugins: [react()],
  define: {
    __FLOWCANVAS_BUILD__: JSON.stringify(buildInfo),
  },
  test: {
    environment: 'jsdom',
  },
});
```

- `/// <reference types="vitest/config" />` lets the same file hold Vitest's `test` options with types.
- The version comes from the **root** `package.json`: the product version, one source of truth.
- `execFileSync('git', [...])` runs git without a shell, so there's no shell-injection surface.
- If git isn't available (for example, a Docker build without `.git`), the commit is empty and the page says "unknown commit".

**`apps/web/src/vite-env.d.ts`:**

```ts
/// <reference types="vite/client" />

declare const __FLOWCANVAS_BUILD__: import('@flowcanvas/graph-model').BuildInfo;
```

**`apps/web/src/App.tsx`:**

```tsx
import { formatBuildInfo, type BuildInfo } from '@flowcanvas/graph-model';

interface AppProps {
  readonly buildInfo: BuildInfo;
}

export function App({ buildInfo }: AppProps) {
  return (
    <main>
      <h1>Flowcanvas</h1>
      <p>{formatBuildInfo(buildInfo)}</p>
    </main>
  );
}
```

**`apps/web/src/main.tsx`:**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Flowcanvas could not start: the #root element is missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App buildInfo={__FLOWCANVAS_BUILD__} />
  </StrictMode>,
);
```

`StrictMode` runs extra development-only checks (for example, double-invoking effects to expose missing cleanups). It has no effect in production.

**`apps/web/src/App.test.tsx`:**

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('shows the product name', () => {
    render(<App buildInfo={{ version: '0.1.0', commit: '7e59ec1a2b3c' }} />);
    expect(screen.getByRole('heading', { name: 'Flowcanvas' })).toBeTruthy();
  });

  it('shows the version and short commit it was built from', () => {
    render(<App buildInfo={{ version: '0.1.0', commit: '7e59ec1a2b3c' }} />);
    expect(screen.getByText('0.1.0 · 7e59ec1')).toBeTruthy();
  });
});
```

**Commands:**

```fish
pnpm install
pnpm format
pnpm lint && pnpm typecheck && pnpm test   # 3 tasks each; tests: graph-model 3 passed, web 2 passed
pnpm build                                 # web: dist/index.html + dist/assets/index-<hash>.js (~220 kB, ~69 kB gzip)
pnpm dev                                   # open http://localhost:5173
pnpm --filter @flowcanvas/web preview      # serves the production build at http://localhost:4173
```

**Run and check it:**
1. `pnpm dev`, open http://localhost:5173. You see **Flowcanvas** and **0.1.0 · <your short commit>** (compare with `git rev-parse --short HEAD`).
2. Edit the `<h1>` text in `App.tsx` and save. The browser updates instantly without a reload (HMR). Revert.
3. `pnpm build`, then `pnpm build` again: the second is "FULL TURBO". Make a commit and build again: only `@flowcanvas/web#build` re-runs, and `dist` now contains the new commit.
4. `pnpm --filter @flowcanvas/web preview`, open http://localhost:4173: the production build, same text.

**Gotchas:**
- **Blank page in the browser?** Open the devtools console. An error such as "#root element is missing" points straight at `index.html`.
- **`__FLOWCANVAS_BUILD__ is not defined` in the browser** means you ran a build that bypassed `vite.config.ts`. Always build through Vite.
- **Port 5173 already in use?** Vite picks the next free port and prints it. Read the terminal.
- **Running `vite build` directly in `apps/web`** skips the root script, so `FLOWCANVAS_COMMIT` isn't set. The config falls back to `git rev-parse`, so the commit is still right, but Turbo's cache wasn't involved.
- **Forgetting `afterEach(cleanup)`** makes the second test see two headings and fail with "Found multiple elements".

**Commit:** `feat(web): add Vite React app showing version and commit`

### Step 7 — The control-plane stub (`services/control-plane`)

**Goal:** the first back-end service. It's a Fastify server with a `GET /health` endpoint that returns its status, version and commit, has tests, and has log redaction from day one, so secrets can never reach logs. It becomes the real control plane (accounts, projects, vault) in phase 1c. For now it proves the service pattern and gives staging a back end to check.

**Expected outcome:** `pnpm dev` now starts **both** apps. `curl http://127.0.0.1:8080/health` returns `{"status":"ok","version":"0.1.0","commit":"<your full commit>"}`, and `pnpm test` shows 3 control-plane tests passing, including one that plants fake secrets and proves they never appear in the logs.

**Concepts:**
- **Fastify.**
  - A fast, schema-friendly Node HTTP framework with first-class TypeScript types.
  - Route handlers can simply `return` a value; Fastify serialises it to JSON.
  - It logs through **pino**, which writes structured JSON log lines (one object per line, easy to search later) and has built-in **redaction**.
  - Docs: https://fastify.dev/docs/latest/Guides/Getting-Started/ and https://getpino.io/#/docs/redaction
- **Why redaction now.** Non-negotiable rule 5: secrets are never logged.
  - `redact` paths (`*.token`, `*.apiKey`, `req.headers.authorization`…) are replaced with `[Redacted]` **before** a line is written. A careless `log.info(config)` can't leak a key.
  - Phase 1c adds the vault; this guard is already in place when it does.
  - The `*` wildcard matches one level of nesting (`config.token`), not every depth. Deeper secrets need their own paths. Keep secrets out of log calls anyway: redaction is the safety net, not the plan.
- **`buildApp()` vs `server.ts`.**
  - `app.ts` builds and returns the app without listening on a port.
  - `server.ts` reads config, calls `listen`, and handles shutdown.
  - Tests import `buildApp` and call routes with **`app.inject()`**, which simulates an HTTP request in-process: no port, no network, fast and deterministic.
  - Docs: https://fastify.dev/docs/latest/Guides/Testing/
- **Dependency injection for testability.** `buildApp` receives `buildInfo` and the `logger` options as arguments. Tests pass a fixed build info and a capture stream (a `Writable` that collects log lines into an array), so they can assert on exactly what would be logged.
- **Canary tests.** Put a fake, unmistakable secret (`CANARY-TOKEN-123`) where a real one could be, then assert it appears nowhere in the output. CLAUDE.md §8 asks for this style of security test on every merge. **Check the test can fail:** remove `redact` and it must go red (verified: it does).
- **Where the version and commit come from at runtime.**
  - The version is read from the package's own `package.json`. `src/` and `dist/` both sit one level below it, so `new URL('../package.json', import.meta.url)` works in dev and in production.
  - All packages share the product version (`0.1.0`, versioned in lockstep).
  - The commit comes from `FLOWCANVAS_COMMIT` (set by the Docker build in step 12), otherwise `git rev-parse HEAD`, otherwise empty ("unknown"), never invented.
- **Bind address.** `127.0.0.1` (loopback) by default. `0.0.0.0` listens on every network interface, which on your laptop exposes the server to anyone on your Wi-Fi (seen in testing: it bound to `192.168.1.14`). The container sets `HOST=0.0.0.0` explicitly, because a container must accept traffic from outside itself. Safe by default; open on purpose.
- **Graceful shutdown.** On `SIGTERM` (sent by Fly.io, Docker or Ctrl+C), `app.close()` stops accepting new connections and lets in-flight requests finish before exiting.
- **Running TypeScript in dev with `tsx`.**
  - Node 24 can strip TypeScript types itself, but it won't map our `./app.js` import specifiers to `app.ts`.
  - `tsx watch src/server.ts` handles that and restarts on every save. Production runs the compiled `dist/server.js` with plain `node`.
  - Docs: https://tsx.is/
- **Top-level `await`** in `server.ts` is allowed because the package is ESM (`"type": "module"`) and the target is ES2024.

**`pnpm-workspace.yaml`:** add to the catalog (alphabetical):

```yaml
  fastify: 5.12.7
  tsx: 4.23.15
```

**`services/control-plane/package.json`:**

```json
{
  "name": "@flowcanvas/control-plane",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "@flowcanvas/graph-model": "workspace:*",
    "fastify": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**`services/control-plane/tsconfig.json`:** same pattern as `graph-model`, plus Node types:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

**`services/control-plane/tsconfig.build.json`:**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

**`services/control-plane/src/build-info.ts`:**

```ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { BuildInfo } from '@flowcanvas/graph-model';

interface PackageJson {
  readonly version: string;
}

function readVersion(): string {
  // src/ and dist/ both sit one level below package.json, so this works in dev and in production.
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as PackageJson;
  return packageJson.version;
}

function readCommit(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.FLOWCANVAS_COMMIT?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function readBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return { version: readVersion(), commit: readCommit(env) };
}
```

**`services/control-plane/src/app.ts`:**

```ts
import type { BuildInfo } from '@flowcanvas/graph-model';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface AppOptions {
  readonly buildInfo: BuildInfo;
  readonly logger?: FastifyServerOptions['logger'];
}

// Log fields that may carry secrets. Values are replaced before a log line is written.
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
];

export function buildApp({ buildInfo, logger = true }: AppOptions): FastifyInstance {
  const app = Fastify({
    logger:
      logger === false ? false : { ...(logger === true ? {} : logger), redact: REDACTED_LOG_PATHS },
  });

  app.get('/health', () => ({
    status: 'ok',
    version: buildInfo.version,
    commit: buildInfo.commit,
  }));

  return app;
}
```

**`services/control-plane/src/server.ts`:**

```ts
import { buildApp } from './app.js';
import { readBuildInfo } from './build-info.js';

const port = Number(process.env.PORT ?? 8080);
// Loopback by default so a dev server is never exposed on the local network; containers set HOST=0.0.0.0.
const host = process.env.HOST ?? '127.0.0.1';

const app = buildApp({ buildInfo: readBuildInfo() });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error, 'control plane failed to start');
  process.exit(1);
}
```

**`services/control-plane/src/app.test.ts`:**

```ts
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const buildInfo = { version: '0.1.0', commit: '7e59ec1a2b3c' };
let app: ReturnType<typeof buildApp> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('returns status, version and commit', async () => {
    app = buildApp({ buildInfo, logger: false });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '0.1.0', commit: '7e59ec1a2b3c' });
  });

  it('returns 404 for unknown routes', async () => {
    app = buildApp({ buildInfo, logger: false });
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});

describe('logging', () => {
  it('never writes secret values to the log', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    app = buildApp({ buildInfo, logger: { stream } });
    await app.ready();

    app.log.info(
      { config: { token: 'CANARY-TOKEN-123', apiKey: 'CANARY-KEY-456' } },
      'loaded config',
    );
    await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer CANARY-AUTH-789' },
    });

    const output = lines.join('');
    expect(output).toContain('loaded config');
    expect(output).not.toMatch(/CANARY-/);
  });
});
```

**Commands:**

```fish
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # 4 tasks each; control-plane: 3 passed
pnpm build                                 # services/control-plane/dist/server.js etc.
pnpm dev                                   # starts web (5173) AND control plane (8080)
```

**Run and check it:**
1. With `pnpm dev` running, in another terminal: `curl http://127.0.0.1:8080/health` returns `{"status":"ok","version":"0.1.0","commit":"<git rev-parse HEAD>"}`. The `pnpm dev` terminal shows a JSON log line for the request.
2. Production mode: `pnpm build`, then `FLOWCANVAS_COMMIT=test123 PORT=8081 pnpm --filter @flowcanvas/control-plane start`, then `curl http://127.0.0.1:8081/health` shows `"commit":"test123"`.
3. Prove the safety net: in `app.ts`, delete `, redact: REDACTED_LOG_PATHS`, run `pnpm --filter @flowcanvas/control-plane test`, and watch "never writes secret values to the log" **fail**. Restore it.
4. The startup log says `Server listening at http://127.0.0.1:8080` (loopback only), not your LAN IP.

**Gotchas:**
- `EADDRINUSE` means port 8080 is taken. Run with `PORT=8090` or stop the other process (`ss -ltnp | grep 8080`).
- Pino logs are JSON lines, which is good for machines. For humans in dev, pipe through `pino-pretty` later if wanted; don't log with `console.log`.
- Forgetting `await app.close()` in tests can leave handles open and make Vitest hang or warn.
- `app.inject()` doesn't open a port. If a test passes but `curl` fails, check `listen()`, `HOST` and `PORT`, not the route.
- Never put real secrets in tests. Use obvious canaries like `CANARY-…`.

**Commit:** `feat(control-plane): add Fastify health endpoint with log redaction`

### Step 8 — Minimal `packages/engine` and `workspace/agent`

**Goal:** give the two remaining packages named in the phase 1 Build line ("web app, workspace agent, engine, control plane, shared types") a real place in the monorepo. From today, lint, type-check, test and build cover them, so they can never quietly rot before their real work starts (agent in phase 1d, engine in phase 4).

**Expected outcome:** `pnpm ls -r --depth -1` lists 6 projects (root + 5 packages). `pnpm test` runs 6 tasks with 10 tests in total, all green.

**Concepts:**
- **Skeleton vs placeholder feature.**
  - CLAUDE.md forbids *placeholder features*: fake UI or fake data in the product.
  - An empty-but-wired *package* is different. It is infrastructure: a name, a build and a test, and the user sees nothing.
  - We keep it to the minimum. Each package exports only its own name, with a comment stating what it will hold and in which phase.
- **Why a test for one constant.** It proves the package is wired in: Turbo finds it, `tsc` builds it, Vitest runs it. Vitest also fails on a package with **no** test files (by design, so a typo in a test path can't pass silently). One honest smoke test is better than `--passWithNoTests`, which would hide that safety.
- **Copying the package pattern.** `engine` and `workspace-agent` reuse `graph-model`'s two tsconfigs unchanged. The folder depth is the same (`../../tsconfig.base.json`), and neither needs Node types yet. The engine and agent will add `"types": ["node"]` when they start touching files and processes.
- **Package names vs folders.** The folder `workspace/agent` holds the package `@flowcanvas/workspace-agent`. Package names are flat and must be unique; folders group by deployment target (`apps/` = browser, `services/` = our cloud, `workspace/` = inside each user's VM, `packages/` = shared libraries).

**Files:** for each of the two packages:

**`packages/engine/package.json`** (and `workspace/agent/package.json` with `"name": "@flowcanvas/workspace-agent"`):

```json
{
  "name": "@flowcanvas/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "devDependencies": {
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**`tsconfig.json` and `tsconfig.build.json`:** identical copies of `packages/graph-model`'s.

**`packages/engine/src/index.ts`:**

```ts
// Analysis engine: indexer, parsers, resolvers and flow builder. It runs inside each workspace. Real code arrives in phase 4.
export const PACKAGE_NAME = '@flowcanvas/engine';
```

**`workspace/agent/src/index.ts`:**

```ts
// In-workspace daemon: file and process API, autosave journal, snapshots. Real code arrives in phase 1d.
export const PACKAGE_NAME = '@flowcanvas/workspace-agent';
```

**`src/index.test.ts`** (engine shown; the agent's uses its own name):

```ts
import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@flowcanvas/engine', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE_NAME).toBe('@flowcanvas/engine');
  });
});
```

**Commands:**

```fish
pnpm install
pnpm format
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # 6 / 6 / 6 / 5 tasks
pnpm ls -r --depth -1                                    # 6 projects
```

`build` is 5 tasks, not 6, because the root package has no build script.

**Run and check it:**
1. `pnpm test` shows `engine: 1 passed`, `workspace-agent: 1 passed`, alongside the other three packages: 10 tests in total.
2. `pnpm exec turbo run build --dry=json`: the plan now includes `@flowcanvas/engine#build` and `@flowcanvas/workspace-agent#build`, running in parallel with `graph-model` because they don't depend on each other.

**Gotchas:**
- If a new package doesn't show up in `pnpm ls -r`, its folder isn't matched by a glob in `pnpm-workspace.yaml`, or its `package.json` is missing or invalid.
- Two packages with the same `name` make pnpm refuse to install. Names must be unique across the workspace.
- `"files": ["dist"]` was expanded to three lines here because that's how Prettier formats `package.json`. Writing it on one line just gets reformatted by `pnpm format`.

**Commit:** `feat: add minimal engine and workspace-agent packages`

### Step 9 — Playwright end-to-end smoke test (`e2e/`)

**Goal:** the first test that opens a **real browser** (Chromium), loads the production build of the web app, and checks what a person would see. The same test later runs against the PR preview URL (step 11) and staging (step 12). This test is how "the staging URL loads the app and shows its version" gets *proved*, not just claimed.

**Expected outcome:** `pnpm test:e2e` builds the web app, serves it, opens Chromium, and prints `✓ … shows the product name and the version it was built from` with `1 passed`. `pnpm --filter @flowcanvas/e2e exec playwright show-report` opens an HTML report of the run.

**Concepts:**
- **Unit vs component vs end-to-end tests.**
  - Unit (graph-model) tests one function.
  - Component (web, Testing Library + jsdom) renders React in a *simulated* DOM.
  - End-to-end (Playwright) drives a *real* browser against a *real* server: real bundling, real HTML, real JavaScript execution.

  E2E is the slowest and most realistic, so we keep few of them and make each count. Docs: https://playwright.dev/docs/intro
- **Locators and auto-waiting.**
  - `page.getByRole('heading', { name: 'Flowcanvas' })` describes *what* to find, and Playwright re-checks it until it's true or a timeout (5 s by default) runs out.
  - So `await expect(locator).toBeVisible()` waits for the app to render. No `sleep`, and no flaky timing.
  - Docs: https://playwright.dev/docs/locators and https://playwright.dev/docs/test-assertions
- **`webServer`.** With no external URL, Playwright starts `vite preview` on `127.0.0.1:4173`, waits until it answers, runs the tests, then stops it. `reuseExistingServer` (locally only) reuses a preview you already have running. Docs: https://playwright.dev/docs/test-webserver
- **One test, any environment.**
  - `E2E_BASE_URL` points the same test at a deployed copy (PR preview, staging); then no local server starts.
  - `E2E_EXPECTED_COMMIT` makes the test demand the **exact** commit. In CI that's the commit being tested, so a preview showing a stale build fails.
  - Without it, the test accepts any 7-character hex commit, which still rejects "unknown commit".
- **Catching JavaScript errors.** `page.on('pageerror', …)` records uncaught exceptions in the page. The test asserts there were none, so a page can't pass by rendering text while throwing in the background.
- **Traces, videos and reports.**
  - `trace: 'retain-on-failure'` and `video: 'retain-on-failure'` keep a full recording (DOM snapshots, network, console) and a video of any **failed** test in `e2e/test-results/`.
  - The HTML report goes to `e2e/playwright-report/`. Both are git-ignored.
  - Phase 1b switches videos on for every run (the "recorded run" requirement).
  - Docs: https://playwright.dev/docs/trace-viewer
- **CI behaviour.** With `CI` set: `forbidOnly` (a forgotten `test.only` fails the run instead of silently skipping the others), 2 retries (absorbs rare network flakiness; repeated failures still fail), and the `github` reporter (annotates failures on the PR).
- **Browsers are separate downloads.** `@playwright/test` is the library; Chromium itself is installed with `playwright install chromium` into `~/.cache/ms-playwright`. **On CachyOS/Arch:** Playwright prints "your OS is not officially supported … downloading fallback build for ubuntu24.04-x64". That build runs fine here (verified). On CI's Ubuntu runner it's officially supported.
- **Wiring into Turbo.**
  - `e2e` lists `@flowcanvas/web` as a dev dependency, so `dependsOn: ["^build"]` builds the web app (and `graph-model`) first.
  - `cache: false`, because the result depends on a live server and browser, not just files.
  - The task declares `E2E_BASE_URL`, `E2E_EXPECTED_COMMIT` and `CI`, because Turbo's strict env mode passes only declared vars.
  - E2E has its own root script, `pnpm test:e2e`, and is **not** part of `pnpm test`, keeping the fast unit loop fast.

**`pnpm-workspace.yaml`:** add to the catalog:

```yaml
  '@playwright/test': 1.64.1
```

**Root `package.json`:** add after `"test"`:

```json
    "test:e2e": "FLOWCANVAS_COMMIT=$(git rev-parse HEAD) turbo run test:e2e",
```

`FLOWCANVAS_COMMIT` is set for the same reason as in `build`: the web build that the test serves must carry the current commit, and the Turbo hash must change with it.

**`turbo.json`:** add the task:

```json
    "test:e2e": {
      "dependsOn": ["^build"],
      "cache": false,
      "env": ["E2E_BASE_URL", "E2E_EXPECTED_COMMIT", "CI"]
    }
```

**`e2e/package.json`:**

```json
{
  "name": "@flowcanvas/e2e",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@flowcanvas/web": "workspace:*",
    "@playwright/test": "catalog:",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:"
  }
}
```

**`e2e/tsconfig.json`:**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "noEmit": true
  },
  "include": ["tests", "playwright.config.ts"]
}
```

`e2e` sits one level below the root, so it's `../tsconfig.base.json`, not `../../`.

**`e2e/playwright.config.ts`:**

```ts
import { defineConfig, devices } from '@playwright/test';

// Point the tests at any deployed copy (PR preview, staging) with E2E_BASE_URL.
// Without it, Playwright serves the local production build of apps/web itself.
const externalBaseUrl = process.env.E2E_BASE_URL;
const localPreviewUrl = 'http://127.0.0.1:4173';
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: isCi
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBaseUrl ?? localPreviewUrl,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command:
            'pnpm --filter @flowcanvas/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
          url: localPreviewUrl,
          reuseExistingServer: !isCi,
          timeout: 30_000,
        },
      }),
});
```

**`e2e/tests/smoke.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';

test('shows the product name and the version it was built from', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');

  await expect(page).toHaveTitle('Flowcanvas');
  await expect(page.getByRole('heading', { name: 'Flowcanvas' })).toBeVisible();

  const expectedCommit = process.env.E2E_EXPECTED_COMMIT?.slice(0, 7);
  const buildLine = expectedCommit ? `0.1.0 · ${expectedCommit}` : /^0\.1\.0 · [0-9a-f]{7}$/;
  await expect(page.getByText(buildLine)).toBeVisible();

  expect(pageErrors).toEqual([]);
});
```

**Commands:**

```fish
pnpm install
pnpm --filter @flowcanvas/e2e exec playwright install chromium   # once per machine; ~150 MB to ~/.cache/ms-playwright
pnpm format
pnpm lint && pnpm typecheck                                      # now 8 tasks each (e2e lint/typecheck depend on the web build)
pnpm test:e2e                                                    # builds web, serves it, runs Chromium: 1 passed
```

**Run and check it:**
1. `pnpm test:e2e` prints `✓ 1 [chromium] › tests/smoke.spec.ts › shows the product name and the version it was built from` and `1 passed`.
2. Demand an exact commit: `E2E_EXPECTED_COMMIT=(git rev-parse HEAD) pnpm test:e2e` passes (fish syntax; in bash use `$(…)`).
3. **Prove it can fail:** `E2E_EXPECTED_COMMIT=deadbeef00 pnpm test:e2e` fails after ~5 s with `waiting for getByText('0.1.0 · deadbee')`. Then open `e2e/test-results/` (a video and a trace of the failure) and `pnpm --filter @flowcanvas/e2e exec playwright show-report`.
4. Against a running server: with `pnpm dev` running, `E2E_BASE_URL=http://localhost:5173 pnpm --filter @flowcanvas/e2e test:e2e` passes without starting its own server. This is exactly how it will test preview URLs.
5. Watch it happen: add `--headed` (`pnpm --filter @flowcanvas/e2e exec playwright test --headed`) to see the browser window, or `--ui` for Playwright's interactive runner.

**Gotchas:**
- `Executable doesn't exist at ~/.cache/ms-playwright/...` means browsers aren't installed. Run the `playwright install chromium` command.
- Port 4173 busy means another `vite preview` is running. Locally it's reused (`reuseExistingServer`). If it's a *different* app on 4173, stop it.
- Never use fixed waits (`page.waitForTimeout`). Assert on what the user would see and let auto-waiting do its job.
- A green unit suite with a red E2E usually means a wiring problem: the build, `define`, `index.html` or the server. Check the trace first.
- Use `pnpm test:e2e` from the root for a correct build; running `playwright test` inside `e2e/` uses whatever `apps/web/dist` happens to exist.

**Commit:** `test(e2e): add Playwright smoke test for version page`

### Step 10 — Continuous integration on GitHub Actions, and the phase PR

**Goal:** every push to a pull request and every push to `main` automatically runs format check, lint, type-check, unit tests, build and the Playwright test on a fresh GitHub machine. Results show on the PR, and the Playwright report is downloadable. Then we push the phase branch and open the phase 1 PR, which is where the preview URL (step 11) will appear.

**Expected outcome:** on GitHub, PR "Phase 1 — Project skeleton" shows two green checks: **Lint, typecheck, unit tests, build** and **End-to-end (Playwright)**. The Actions tab shows each step's log, and the e2e run has a `playwright-report` artifact.

**Concepts:**
- **What CI is for.** Your laptop is one machine with history (installed tools, caches, untracked files). CI runs the same commands on a **clean** machine for every change, so "works on my machine" becomes "works from a fresh clone". It's the gate between a branch and `main`. Docs: https://docs.github.com/en/actions/get-started/understand-github-actions
- **Workflow anatomy.** A workflow (`.github/workflows/ci.yml`) has:
  - **triggers** (`on:`)
  - **jobs**: each runs on its own fresh VM (`runs-on`), and different jobs run in parallel
  - **steps** inside a job, which run in order and share the machine
  - steps that either `uses:` a reusable **action** or `run:` a shell command

  Docs: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- **Triggers.** `pull_request` runs for every push to an open PR. `push` to `main` runs after merges, so `main` is always re-verified.
- **`concurrency` with `cancel-in-progress`.** Pushing again to the same PR cancels the older, now-pointless run. Saves minutes and avoids confusing results.
- **`permissions: contents: read`.** The workflow's `GITHUB_TOKEN` gets only read access by default (least privilege). Step 11 grants extra permission (PR comments) only to the job that needs it.
- **Pinning actions to a commit SHA.** `uses: actions/checkout@3d3c…ba90b1 # v7.0.1`, not `@v7`. A tag can be moved to different code by whoever controls the action's repo, which is a known supply-chain attack path. A full commit SHA can't change. The comment keeps it readable. Docs: https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions
- **Setting up the toolchain in CI.**
  - `pnpm/action-setup` installs the exact pnpm from our `packageManager` field.
  - `actions/setup-node` installs Node from `.nvmrc` (24) and caches pnpm's store between runs (`cache: pnpm`). That's why `pnpm/action-setup` must come **before** it.
  - `pnpm install --frozen-lockfile` fails if `package.json` and the lockfile disagree, instead of quietly changing dependencies. It also enforces `engineStrict` (see step 2).
- **Which commit CI tests and displays.** For `pull_request` events, `actions/checkout` by default checks out a temporary **merge commit** (your branch merged into `main`), which isn't in your branch's history. Our app would then show a SHA nobody recognises, and the e2e test expecting the PR's head commit would fail. We check out `github.event.pull_request.head.sha` instead, so CI tests exactly the commit you pushed, and the page shows the SHA you see on the PR. Trade-off: we don't test the merged result. Keep the branch up to date with `main` before merging (GitHub's "Update branch" button).
- **Two jobs.** `checks` (fast feedback) and `e2e` (needs a browser) run in parallel on separate machines. A failure in one doesn't hide the other's result.
- **Browsers in CI.** `playwright install --with-deps chromium` also installs the Linux libraries Chromium needs (via `apt`). Ubuntu is officially supported, so there's no "fallback build" warning there.
- **Artifacts.** `actions/upload-artifact` saves the Playwright HTML report (and on failure the traces and videos) for 14 days. Download it from the run page. `if: ${{ !cancelled() }}` uploads it even when tests fail, which is exactly when you need it.
- **`timeout-minutes`.** A hung job is killed after 15 minutes instead of burning up to 6 hours of runner time.
- **Turbo telemetry off in CI.** `TURBO_TELEMETRY_DISABLED: 1` (our rule; see step 4).
- **Cost.** Private repos on the free plan get 2,000 Linux runner minutes a month. This workflow uses about 3–5 minutes per push across both jobs.
- **Branch protection: needs a decision.** "Require status checks to pass before merging" is the normal way to make CI a hard gate. **On a free GitHub account it isn't available for private repositories.** The API answers "Upgrade to GitHub Pro or make this repository public". Options:
  1. **GitHub Pro** (about $4/month): full branch protection and rulesets on private repos.
  2. **Make the repository public**: not recommended (proprietary code; the forks' licences).
  3. **No enforcement for now**: CI still runs and shows red or green on every PR, and we follow the rule "merge only when green, never push to `main` directly". Upgrade later.

  Recommendation: option 3 now, option 1 before anyone else joins the project. Docs: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

**`.github/workflows/ci.yml`:**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  TURBO_TELEMETRY_DISABLED: 1

jobs:
  checks:
    name: Lint, typecheck, unit tests, build
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          # Test the commit that was pushed, not GitHub's temporary merge commit.
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  e2e:
    name: End-to-end (Playwright)
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @flowcanvas/e2e exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          E2E_EXPECTED_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: |
            e2e/playwright-report/
            e2e/test-results/
          retention-days: 14
```

- `${{ … }}` are GitHub expressions, evaluated before the step runs.
- `github.event.pull_request.head.sha || github.sha` means "the PR's head commit, or, on a push to `main`, the pushed commit".
- `CI=true` is set automatically on GitHub's runners, so Playwright switches to its CI settings (retries, `forbidOnly`, `github` reporter).

**Commands:** push and open the PR.

```fish
pnpm format:check                       # the workflow file is YAML, so Prettier checks it too
git add .github && git commit -m "ci: add GitHub Actions workflow for checks and e2e"
git push -u origin phase/1-project-skeleton
gh pr create --base main --head phase/1-project-skeleton --title "Phase 1 — Project skeleton" --body "…"
gh pr checks --watch                    # follow both jobs live in the terminal
```

**Run and check it:**
1. Open the PR on GitHub (`gh pr view --web`). The bottom of the conversation tab shows two checks. Click **Details** for live logs per step.
2. Both turn green. Locally, `gh run list` shows the run and `gh run view --log-failed` shows only the failing step's log if something breaks.
3. On the run's summary page, download **playwright-report** and open `index.html`.
4. **Prove CI can fail:** push a commit that breaks formatting (for example an extra blank line in `turbo.json`). The checks job fails at `pnpm format:check` with the file named. Fix and push again, and it goes green. *Optional, but the best way to trust the gate.*

**Gotchas:**
- `ERR_PNPM_OUTDATED_LOCKFILE`: you changed a `package.json` without running `pnpm install` locally. Run it and commit `pnpm-lock.yaml`.
- A job passes locally but fails in CI: look for something your machine has that CI doesn't (an untracked file, a global tool, an env var). This is CI doing its job.
- Workflow changes only run when the YAML is on the branch being pushed; editing it on `main` doesn't affect an open PR until you update the branch.
- If a pinned SHA is mistyped, the job fails at "Set up job" with "Unable to resolve action". Copy SHAs exactly.
- Never print secrets in `run:` steps. GitHub masks registered secrets, but derived values (substrings, base64) aren't masked.

**Commit:** `ci: add GitHub Actions workflow for checks and e2e`

**Done notes (step 10):**
- Workflow committed (`a3247c7`), branch pushed, PR #1 opened: https://github.com/ArmaanAhuja/Flowcanvas/pull/1
- Branch protection: option 3 (not enforced), and the free plan blocked it while the repo was private.
- **Blocked:** GitHub Actions jobs don't start ("account is locked due to a billing issue"), on private *and* public repos. Diagnosis: `gh run view <id>` showed only "workflow file issue"; a one-line probe workflow failed the same way, which ruled out our file; the check-run **annotations** (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`) gave the real reason. Lesson: when a run fails in 0–4 seconds with no steps, look at annotations, not logs.
- Until resolved, run the CI checks locally:

```fish
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

### Step 11 — Cloudflare: a preview URL for every pull request

**Goal:** the web app is deployed automatically by Cloudflare. Every push to a PR branch gets its **own preview URL**, posted on the PR, and `main` becomes the **staging** site. This satisfies half of phase 1's Done-when. GitHub Actions is blocked on the account (`docs/upgrade-later.md` item 8), so Cloudflare builds the repo itself (**Workers Builds**, Cloudflare's Git integration).

**Expected outcome:**
- On PR #1, a Cloudflare check or comment appears with a preview link on `*.workers.dev`.
- It shows **Flowcanvas** and `0.1.0 · <PR head commit>`, with the security headers.
- After merging to `main`, the production URL `https://flowcanvas.<your-subdomain>.workers.dev` is staging.
- The Playwright smoke test passes against the preview from your laptop.

**Concepts:**
- **Workers serving static assets.**
  - Cloudflare's dashboard now creates projects as **Workers**. A Worker can serve a folder of static files with no code of ours, which is all our web app is (`index.html` + one JS bundle).
  - Static asset requests are free and unlimited on the free plan.
  - Older guides use **Cloudflare Pages** for this. Pages still exists, but new projects are steered to Workers, which also leaves room to add server-side code later (the preview proxy, the gateway).
  - Docs: https://developers.cloudflare.com/workers/static-assets/
- **`wrangler.jsonc`.** Wrangler is Cloudflare's CLI. Its config file says what to deploy:
  - `name` must match the Worker name in the dashboard (`flowcanvas`).
  - `assets.directory` points at the built site (`./apps/web/dist`).
  - `not_found_handling: "single-page-application"` serves `index.html` for unknown paths, so client-side routes work on reload.
  - `compatibility_date` pins the runtime behaviour to a date, so Cloudflare upgrades can't change how our Worker behaves.
  - `preview_urls: true` gives every uploaded version its own URL.
  - `workers_dev: true` serves the production deployment on `*.workers.dev`.
  - `send_metrics: false` turns off Wrangler's usage telemetry (our rule: telemetry off).

  JSONC is JSON that allows comments and trailing commas (Prettier adds them; Wrangler accepts them, verified). Docs: https://developers.cloudflare.com/workers/wrangler/configuration/
- **Pinning Wrangler.** The dashboard suggests `npx wrangler deploy`, which downloads whatever Wrangler version is current on the day of the build. We add `wrangler` as a pinned root dev dependency (catalog) and use `pnpm exec wrangler …`, so builds are reproducible.
- **Workers Builds: build, then deploy.** On every push Cloudflare clones the repo and runs three things:
  - the **build command** (install, then build only the web app)
  - the **deploy command**, for the production branch `main`
  - the **non-production branch deploy command**, for every other branch: it uploads a new *version* without making it live, and gives it a **preview URL**

  Cloudflare reports the result on the commit/PR in GitHub. Docs: https://developers.cloudflare.com/workers/ci-cd/builds/
- **Building a pnpm monorepo there.**
  - `SKIP_DEPENDENCY_INSTALL=true` stops Cloudflare's own install (its pnpm may not read our pnpm 12 lockfile).
  - `corepack enable` provides exactly pnpm 12.15.0 (Node 24 still bundles Corepack).
  - `NODE_VERSION=24` pins Node.
  - `pnpm build --filter=@flowcanvas/web` passes `--filter` through to Turbo, so only the web app and its dependency `graph-model` are built.
- **The commit shown on the page.** Cloudflare clones with git history, so `git rev-parse HEAD` in our root `build` script returns the commit being deployed. If a preview ever shows "unknown commit", prefix the build with `FLOWCANVAS_COMMIT=$WORKERS_CI_COMMIT_SHA`.
- **Security headers (`_headers`).** Static assets on Workers honour a `_headers` file in the assets directory. Ours sets a strict **Content-Security-Policy** (only our own scripts, styles and connections; no framing), `nosniff`, a strict `Referrer-Policy` and a `Permissions-Policy`. Vite copies `apps/web/public/*` into `dist/`, so the file lives there. The production `index.html` has no inline scripts or styles (verified), so the strict CSP doesn't block our own code: the Playwright test passes with the CSP applied (verified under `wrangler dev`). Docs: https://developers.cloudflare.com/workers/static-assets/headers/
- **Previews are public links.** Fine while they only show a version string. Protecting them with Cloudflare Access is `docs/upgrade-later.md` item 11; leave "Protect with Cloudflare Access" **off** for now, because it would also block the Playwright test.

**`pnpm-workspace.yaml`:** add to the catalog:

```yaml
  wrangler: 4.152.0
```

**Root `package.json`:** add to `devDependencies`:

```json
    "wrangler": "catalog:"
```

**Supply-chain policies met along the way (pnpm 12):**
- **Minimum release age.** pnpm refuses packages published very recently (within about a day), because malicious releases are usually caught within that window. `wrangler@4.153.0` was only hours old, so pnpm wrote a `minimumReleaseAgeExclude` exemption into `pnpm-workspace.yaml` on its own. We **removed the exemption and pinned 4.152.0** instead (4 days old). The lockfile written during the exempted install was then rejected (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`), which is the policy protecting us from a lockfile that bypassed it. Fix: `git checkout -- pnpm-lock.yaml && pnpm install`. Rule: **never commit a `minimumReleaseAgeExclude`**; pick an older version.
- **Install scripts must be decided.** pnpm 12 fails the install (`ERR_PNPM_IGNORED_BUILDS`) when a dependency wants to run a `postinstall` script that hasn't been approved or denied. `esbuild` and `workerd` (pulled in by Wrangler) both work without theirs (verified: build, deploy dry run, `wrangler dev`, e2e), so we deny them:

```fish
pnpm approve-builds '!esbuild' '!workerd'
```

That writes to `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: false
  workerd: false
```

Least privilege: a package only runs code at install time if we said yes.

**`wrangler.jsonc`** (repo root):

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "flowcanvas",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./apps/web/dist",
    "not_found_handling": "single-page-application",
  },
  "preview_urls": true,
  "workers_dev": true,
  "send_metrics": false,
}
```

**`apps/web/public/_headers`:**

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

**Cloudflare dashboard (owner does this):** on "Set up your application" (Workers & Pages → Create → import the GitHub repo `ArmaanAhuja/Flowcanvas`, granting the Cloudflare app access to **only** this repo):

| Field | Value |
| --- | --- |
| Project name | `flowcanvas` (must equal `name` in `wrangler.jsonc`) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm build --filter=@flowcanvas/web` |
| Deploy command | `pnpm exec wrangler deploy` |
| Enable preview builds | **on** |
| Non-production branch deploy command | `pnpm exec wrangler versions upload` |
| Protect with Cloudflare Access | **off** (for now; `upgrade-later` item 11) |
| Advanced → Path (root directory) | `/` |
| Advanced → API token | "Create new token" (Cloudflare creates a deploy-only token for the build) |
| Advanced → Variables | `NODE_VERSION` = `24`, `SKIP_DEPENDENCY_INSTALL` = `true`, `TURBO_TELEMETRY_DISABLED` = `1`, `COREPACK_ENABLE_DOWNLOAD_PROMPT` = `0`, `WRANGLER_SEND_METRICS` = `false` |

- The dashboard may suggest `npx wrangler preview` as the preview command. That's Cloudflare's newer "Preview deployments" feature, still **open beta** in Wrangler 4.153. We use the stable `versions upload`, which also produces a preview URL per version.
- Push the repo changes **before** the first build runs (or click "Retry build" afterwards), otherwise the build can't find `wrangler.jsonc`.

**Commands (local, verify before pushing):**

```fish
pnpm install
pnpm build --filter=@flowcanvas/web
pnpm exec wrangler deploy --dry-run        # "Read 4 files from the assets directory …/apps/web/dist", no upload
pnpm exec wrangler dev --port 8787         # Cloudflare's runtime locally, WITH _headers applied
curl -sI http://127.0.0.1:8787/ | grep -i content-security-policy
E2E_BASE_URL=http://127.0.0.1:8787 pnpm --filter @flowcanvas/e2e test:e2e   # 1 passed (CSP doesn't break the app)
```

**Run and check it (after Cloudflare builds):**
1. PR #1 shows a Cloudflare check or comment with the preview URL. The Cloudflare dashboard shows the build log and the URLs under the Worker's **Deployments / Versions**.
2. The preview shows **Flowcanvas** and `0.1.0 · <short PR head commit>`.
3. `E2E_BASE_URL=<preview URL> E2E_EXPECTED_COMMIT=(git rev-parse HEAD) pnpm --filter @flowcanvas/e2e test:e2e` passes.
4. `curl -sI <preview URL> | grep -i content-security-policy` shows the header.
5. Push another commit: a new preview URL appears with the new commit.

**Gotchas:**
- **Build fails with `pnpm: command not found` or a lockfile error:** check `SKIP_DEPENDENCY_INSTALL=true` and that the build command starts with `corepack enable`.
- **Build fails with `ERR_PNPM_UNSUPPORTED_ENGINE`:** Cloudflare's `NODE_VERSION` build variable is older than `engines` in `package.json`. Since 8 Nov 2026 it must be `26.13.0`, in **both** Cloudflare projects (ADR 0004 addendum). Cloudflare doesn't read `.nvmrc`.
- **Deploy fails with "Missing entry-point" or "no assets directory":** `wrangler.jsonc` isn't on the branch yet, or the build didn't produce `apps/web/dist`.
- **Name mismatch between dashboard and `wrangler.jsonc`:** Cloudflare warns or fails. Keep both `flowcanvas`.
- **Blank page on the preview:** check the browser console for CSP "Refused to load …" errors.
- **Never put secrets in this Worker's variables.** The browser bundle is public.

**Commit:** `feat(web): deploy to Cloudflare Workers with security headers`

**Done notes (step 11, Cloudflare setup):**
- The first Cloudflare build runs on the production branch `main` and **fails with `ERR_PNPM_NO_PKG_MANIFEST`**. That's expected until phase 1 is merged: `main` only contains the step 1 docs. The same log confirms the environment works (Node 24.22.1 picked up; `SKIP_DEPENDENCY_INSTALL` respected).
- Cloudflare only builds on pushes it sees **after** the repo is connected. A branch pushed earlier needs a new commit (or a manual build in the dashboard) to get its first preview.
- **Preview URL formats (Workers):**
  - *Version preview*: `https://<first 8 characters of the version ID>-flowcanvas.<account-subdomain>.workers.dev`. The full-UUID form shown in some places returns 404.
  - *Branch alias*: `https://<branch-name-with-slashes-as-dashes>-flowcanvas.<account-subdomain>.workers.dev`, always the branch's latest build. For this PR: `https://phase-1-project-skeleton-flowcanvas.ahujaarmaan7777.workers.dev`.
  - *Production (staging)*: `https://flowcanvas.ahujaarmaan7777.workers.dev`, live after the first successful build of `main` (step 13).
  - A brand-new version URL can return 404 for a short while until it propagates.
- **Where to find them:** Cloudflare dashboard → Workers & Pages → `flowcanvas` → Deployments / Versions, or Settings → Domains & Routes (`*-flowcanvas.<subdomain>.workers.dev`). Workers Builds reports pass/fail on the PR as the check **"Workers Builds: flowcanvas"**, but doesn't post the URL there; see `docs/upgrade-later.md` item 10.
- **Verified on `be3cf59`** (both preview URLs): HTTP 200; CSP, `nosniff`, `Referrer-Policy` and `Permissions-Policy` present; the bundle carries commit `be3cf59`; SPA fallback returns 200; Playwright `1 passed` with `E2E_EXPECTED_COMMIT` = the PR head. The e2e test also correctly **failed** against the wrong-format URL (404 page): the test catches a broken deployment.

### Step 12 — The control plane as a Docker image (built and run locally)

**Goal:** package the control plane the way it will run in the cloud, as a small, non-root Docker image that holds only the compiled JavaScript and production dependencies, and prove it works by running it locally. Deploying it to Fly.io needs a payment method, so it's deferred to phase 1c (`docs/upgrade-later.md` item 12). With a working image, that later deploy is essentially `fly deploy`.

**Expected outcome:** `docker build …` produces `flowcanvas-control-plane`. `docker run -p 127.0.0.1:8095:8080 …` serves `{"status":"ok","version":"0.1.0","commit":"<the commit you built>"}` at `http://127.0.0.1:8095/health`. The process runs as user `node`. `docker stop` shuts it down cleanly (log line "shutting down", exit code 0).

**Concepts:**
- **Why a container.** The image bundles the exact Node version, our compiled code and its production dependencies, and runs identically on a laptop, in CI, on Fly.io or anywhere else. Phase 1d's workspace VMs use the same idea. Docs: https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/
- **Multi-stage build.**
  - Stage `build` has everything needed to *build*: pnpm, dev dependencies, TypeScript, Turbo.
  - Stage `runtime` starts again from a clean `node:24-slim` and copies in only the result.
  - Build tools never reach the final image: a smaller image and less attack surface. Verified: no Vitest, TypeScript, tsx or ESLint inside, and `node_modules` is 14 MB.
  - Docs: https://docs.docker.com/build/building/multi-stage/
- **The build context is the repo root.** The control plane depends on the workspace package `@flowcanvas/graph-model`, so Docker needs to see the whole workspace: `docker build -f services/control-plane/Dockerfile .` (note the final `.`).
- **`.dockerignore`.** Like `.gitignore` for the build context: local `node_modules`, `dist`, caches, `.git`, `docs` and **every `.env` file** are never sent into the build. That keeps builds reproducible and secrets out of images. Docs: https://docs.docker.com/build/concepts/context/#dockerignore-files
- **Installing only what's needed.** `pnpm install --filter @flowcanvas/control-plane...` installs the control plane and everything it depends on (the trailing `...`), not the web app or Playwright.
- **`pnpm deploy`.** Copies one workspace package into a standalone folder with its **production** dependencies (`--prod`), resolving `workspace:*` links into real copies (here: the compiled `graph-model`). What it copies from our own package is controlled by `"files"` in `package.json`, so we add `"files": ["dist"]` to the control plane; without it, `src/`, tsconfigs and the Dockerfile ended up in the image. Docs: https://pnpm.io/cli/deploy
- **The commit, baked in at build time.** `--build-arg FLOWCANVAS_COMMIT=…` becomes an `ENV` in the runtime image. The server reports it from `/health`, and git isn't needed inside the image.
- **Container defaults.**
  - `HOST=0.0.0.0` (a container must accept connections from outside itself; on your laptop the default stays `127.0.0.1`; see step 7). `-p 127.0.0.1:8095:8080` still publishes it on loopback only.
  - `NODE_ENV=production`.
  - `USER node`: the official Node image ships an unprivileged user, and running as root inside a container is an unnecessary risk.
- **PID 1 and signals.** `CMD ["node", "dist/server.js"]` (exec form, no shell) makes Node process ID 1, so `docker stop`'s SIGTERM reaches our handler directly. Our handler closes Fastify and exits 0. With a shell form (`CMD node dist/server.js`), the signal would hit the shell instead and Docker would kill the process after 10 seconds.
- **Layer caching.** Each Dockerfile instruction is a cached layer. On this connection the first build took **about 41 minutes**, almost all of it `pnpm install` inside the container with an empty package store. Rebuilds with unchanged dependencies are faster, but because we `COPY . .` before installing, *any* file change re-runs the install today. Fixing that (copy only lockfile and manifests first, `pnpm fetch`, BuildKit cache mounts) is `docs/upgrade-later.md` item 13.
- **No `buildx` on this machine.** Docker 29 here has no `buildx` plugin, so `docker build` uses the legacy builder. It works (verified), but it's deprecated and can't use BuildKit features like cache mounts. Installing it is free (CachyOS/Arch: `sudo pacman -S docker-buildx`) and part of item 13.

**`services/control-plane/Dockerfile`:**

```dockerfile
# Build context: the repository root (the control plane depends on workspace packages).
#   docker build -f services/control-plane/Dockerfile --build-arg FLOWCANVAS_COMMIT=$(git rev-parse HEAD) -t flowcanvas-control-plane .

FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @flowcanvas/control-plane...
RUN pnpm exec turbo run build --filter=@flowcanvas/control-plane
RUN pnpm --filter @flowcanvas/control-plane deploy --prod /out

FROM node:24-slim AS runtime
ARG FLOWCANVAS_COMMIT=""
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    FLOWCANVAS_COMMIT=${FLOWCANVAS_COMMIT}
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

**`.dockerignore`** (repo root):

```
**/node_modules
**/dist
**/.turbo
**/coverage
**/playwright-report
**/test-results
.git
.env
.env.*
docs
```

**`services/control-plane/package.json`:** add after `"type": "module",`:

```json
  "files": [
    "dist"
  ],
```

**Commands:**

```fish
pnpm install                      # the "files" change doesn't alter dependencies, but keeps the lockfile check happy
docker build -f services/control-plane/Dockerfile --build-arg FLOWCANVAS_COMMIT=(git rev-parse HEAD) -t flowcanvas-control-plane .
docker images flowcanvas-control-plane          # ~344 MB (mostly the node:24-slim base)
docker run -d --name flowcanvas-cp -p 127.0.0.1:8095:8080 flowcanvas-control-plane
curl http://127.0.0.1:8095/health               # {"status":"ok","version":"0.1.0","commit":"<full commit>"}
docker logs flowcanvas-cp                       # JSON log lines (pino), incl. the request
docker stop flowcanvas-cp                       # log "shutting down"; exit code 0
docker rm flowcanvas-cp
```

(fish: `(git rev-parse HEAD)`; bash: `$(git rev-parse HEAD)`.) The first build can take a long time on a slow connection. Watch `docker stats` (the NET I/O column) to see that it's still downloading.

**Run and check it:**
1. `curl http://127.0.0.1:8095/health` returns version `0.1.0` and the commit you passed as `FLOWCANVAS_COMMIT`.
2. `docker exec flowcanvas-cp id -un` prints `node` (not root).
3. `docker exec flowcanvas-cp ls /app` shows only `dist`, `node_modules`, `package.json` (plus pnpm's lockfile and workspace file), with no `src/`.
4. `docker exec flowcanvas-cp ls /app/node_modules` shows only `@flowcanvas` and `fastify` at the top level. No dev tools.
5. `docker stop flowcanvas-cp`, then `docker inspect flowcanvas-cp --format '{{.State.ExitCode}}'` prints `0`.

**Gotchas:**
- **`COPY failed` or "no such file" for `packages/...`:** you ran `docker build` from inside `services/control-plane`. Run it from the repo root with `-f`.
- **`ERR_PNPM_OUTDATED_LOCKFILE` in the build:** the lockfile doesn't match `package.json`. Run `pnpm install` locally and commit the lockfile.
- **`curl` can't connect:** check the `-p` mapping (`host:container` = `127.0.0.1:8095:8080`) and `docker logs flowcanvas-cp`.
- **"commit": ""**: the `--build-arg` was missing or empty.
- **Never `COPY` a `.env` file or pass secrets as build args.** They're stored in image layers and visible with `docker history`. Runtime secrets come from the secrets vault (phase 1c) as environment variables at *run* time.

**Commit:** `build(control-plane): add Docker image for deployment`

### Step 13 — Close phase 1: records, review, merge, staging live

**Goal:** finish phase 1 the way every phase will finish:
- write down the decisions (ADRs), the architecture and the status
- check every Done-when item against evidence
- review the upgrade-later list
- merge PR #1 so `main` deploys to the **staging URL**
- verify staging with the same browser test

**Expected outcome:**
- `https://flowcanvas.ahujaarmaan7777.workers.dev` shows **Flowcanvas** and `0.1.0 · <main's commit>`.
- The Playwright test passes against it.
- `docs/STATUS.md` shows phase 1 *in review*, with the open condition that CI must run on GitHub (`docs/upgrade-later.md` item 8) before it can be *accepted*.
- `CHANGELOG.md` has its first release entry, `0.1.0`.

**Concepts:**
- **Architecture Decision Records (ADRs).**
  - A short file per significant choice: *context* (what forced a decision), *options*, *decision*, *consequences*.
  - They're numbered and never edited after acceptance. A later change gets a new ADR that "supersedes" the old one.
  - Six months from now, "why TypeScript 6 and not 7?" has a one-page answer.
  - CLAUDE.md §9 requires one per significant choice.
  - Docs: https://adr.github.io/ and Michael Nygard's original post, https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- **`ARCHITECTURE.md`.** A map of the system as it is *today*: the parts, where each runs, how they talk, and how code gets from a commit to a URL. Unlike ADRs it is kept current (CLAUDE.md §7).
- **`CHANGELOG.md`.** A human-readable list of notable changes per version, in the "Keep a Changelog" format (`Added`, `Changed`, `Fixed`, `Security`…). Versions follow semantic versioning: `0.1.0` is the first pre-1.0 release. Docs: https://keepachangelog.com/en/1.1.0/ and https://semver.org/
- **`docs/STATUS.md`.** One table, one row per phase (planned, in progress, in review, accepted), in the format of CLAUDE.md §13.3.
- **Phase report.** CLAUDE.md §13.2 template: result per Done-when item with evidence, how to try it, test summary, deviations from the plan and why, ADRs added, known issues, next phase preview. Stored at `docs/reports/phase-1.md` (a project record, not a lesson).
- **Merging the PR.**
  - Use a merge commit (`gh pr merge 1 --merge`), which keeps every step's commit in history, so the build-steps table's commit links stay valid.
  - Squash would collapse 40+ commits into one and break those links.
  - Merging is normally gated on green CI. CI can't run while the account is billing-locked, so the gate for this merge is: all checks green **locally** + the Cloudflare preview build green + the Playwright test green against the preview. Record that exception in the report.
- **Staging = the production branch.** Cloudflare Workers Builds deploys `main` with `wrangler deploy` to `flowcanvas.<subdomain>.workers.dev`. Every later merge updates staging automatically.

**What gets written:**
1. `docs/adr/0001-monorepo-pnpm-turborepo.md`
2. `docs/adr/0002-vite-react-spa.md`
3. `docs/adr/0003-typescript-6-strict.md`
4. `docs/adr/0004-node-24-lts.md`
5. `docs/adr/0005-hosting-cloudflare-workers-free-first.md` (Cloudflare static assets + Workers Builds; Fly.io and Actions-based deploys deferred)
6. `docs/adr/0006-supply-chain-defaults.md` (pinned action SHAs, pnpm minimum release age, denied install scripts, telemetry off, loopback default)
7. `ARCHITECTURE.md` (root): packages, runtime locations, request and deploy flow, how the version and commit travel from git to the page and to `/health`
8. `CHANGELOG.md` (root): `0.1.0`
9. `docs/STATUS.md`: phases 1 … 1d with status
10. `docs/reports/phase-1.md`: the phase report
11. `docs/upgrade-later.md`: end-of-phase review (what's due now, what moved)

**Commands (merge and verify staging):**

```fish
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e   # all green locally
gh pr merge 1 --merge                       # merge commit; keeps step history
git switch main && git pull
# wait for Cloudflare's build of main (dashboard → flowcanvas → Builds), then:
curl -sI https://flowcanvas.ahujaarmaan7777.workers.dev | grep -i content-security-policy
E2E_BASE_URL=https://flowcanvas.ahujaarmaan7777.workers.dev E2E_EXPECTED_COMMIT=(git rev-parse HEAD) pnpm --filter @flowcanvas/e2e test:e2e
```

**Run and check it (the phase 1 Done-when, with evidence):**

| Done-when / Try-it | Evidence |
| --- | --- |
| The staging URL loads the app | Open `https://flowcanvas.ahujaarmaan7777.workers.dev`: **Flowcanvas** + `0.1.0 · <main commit>`; the Playwright test passes against it |
| Every pull request gets its own preview URL | PR #1: Cloudflare check "Workers Builds: flowcanvas" plus the branch alias `https://phase-1-project-skeleton-flowcanvas.ahujaarmaan7777.workers.dev`; verified with Playwright. (The URL isn't posted on the PR yet: upgrade-later item 10) |
| Try it: open the staging link; the app loads and shows its version | Same as the first row |
| Build: CI with lint, type checks and tests | Workflow `.github/workflows/ci.yml` committed; **ran green on GitHub on 31 Oct 2026** after the repository moved (phase 1b step 9; upgrade-later item 8 closed). The same checks pass locally |

**Gotchas:**
- **`main` shows the merge commit's SHA, not the last PR commit's.** That's correct: staging runs exactly what's on `main`.
- **A brand-new staging deploy can 404 for a minute.** Retry before debugging.
- **Don't delete the phase branch before Cloudflare finishes building `main`.** The branch alias preview stops updating after deletion, which is expected.

**Commit:** `docs: close phase 1 with ADRs, architecture, status, changelog and report`

**Done notes (step 13):**
- Merged PR #1 as `9a18708` (merge commit, history kept) under the recorded exception: local checks + Cloudflare preview + Playwright green on `1df8872`.
- Cloudflare deployed `main` to staging; verified HTTP 200, security headers, bundle commit `9a18708`, Playwright 1 passed.
- Phase 1 status: **in review**, with all Done-when items met. Becomes **accepted** once CI runs green on GitHub (`docs/upgrade-later.md` item 8).
- Evidence recorded through a follow-up PR (`phase/1-close`), because `main` is changed only through PRs.

**Phase 1 summary: what you can run and check now:**

```fish
# Locally
pnpm install
pnpm dev                                   # http://localhost:5173 (since phase 1c step 3, the API is http://localhost:5173/api/health; the Fastify server on 8080 is retired)
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
# Deployed
open https://flowcanvas.ahujaarmaan7777.workers.dev                       # staging (main)
open https://<branch-with-dashes>-flowcanvas.ahujaarmaan7777.workers.dev  # any PR branch's preview
# Control plane as it will run in the cloud
docker build -f services/control-plane/Dockerfile --build-arg FLOWCANVAS_COMMIT=(git rev-parse HEAD) -t flowcanvas-control-plane .
docker run --rm -p 127.0.0.1:8095:8080 flowcanvas-control-plane          # then: curl http://127.0.0.1:8095/health
```

---

## Phase 1a — Design system in code

**Build:** Graphite tokens (muted palette, Slate scale, text styles, radii, spacing) generated from the Figma variables into CSS variables; base components: Button, Tag, Input, Toggle, Menu, Tooltip, Tabs, Panel, Flow node, in dark and light; component catalogue (Storybook).
**Done when:** Each component matches its Figma counterpart in a side-by-side screenshot test.
**Try it:** Open the component catalogue from the CI report, flip dark and light, compare with the Figma Components page.

### Expected outcome

When phase 1a is done you can:
- Open a **component catalogue (Storybook)** in the browser, locally and at a free Cloudflare URL (the stand-in for "from the CI report" while Actions are blocked).
- Browse all nine components with every variant and state (hover, focus, disabled, selected, changed states), switch **dark ↔ light** with one toggle, and see accessibility checks per component.
- Open a **side-by-side comparison report**: each component's rendering next to its Figma reference, with a pixel-difference score that must stay under an agreed tolerance.
- See the **version page restyled** with Graphite tokens (near-black canvas, Inter and JetBrains Mono), and its existing tests still green.
- Change a colour in the token source, regenerate, and watch every component update. No hard-coded colours, sizes, radii or fonts anywhere in components (enforced by a lint rule).

### Concepts this phase introduces (primers come with each step)

- **Design tokens.** Named design decisions (`surface/canvas`, `state/added/solid`, `radius/node`) stored as data, in the W3C Design Tokens (DTCG) JSON format, and generated into CSS custom properties and typed TypeScript constants. Docs: https://www.designtokens.org/
- **Theming with CSS custom properties.** Dark and light are two sets of values for the same variable names, switched by a `data-theme` attribute on `<html>`, with `prefers-color-scheme` as the default.
- **CSS Modules.** Component-scoped class names, compiled by Vite, with zero runtime cost. They work with our strict CSP: no injected `<style>` tags, unlike CSS-in-JS libraries.
- **Accessible primitives.** Menus and tooltips need keyboard handling, focus management and ARIA. We'll use a well-tested headless primitives library for those parts (choice and ADR in the relevant step) and style it ourselves.
- **Self-hosted fonts.** Inter and JetBrains Mono served from our own origin (Fontsource packages), as the CSP's `font-src 'self'` requires; no Google Fonts requests.
- **Storybook.** A workshop for components in isolation: one "story" per state, controls to tweak props, a dark/light toolbar, and the accessibility addon. Builds to static files, hosted free on Cloudflare.
- **Visual regression testing.** Playwright screenshots each story and compares it to a reference image within a tolerance. Exact pixel equality with Figma is impossible (fonts and anti-aliasing render differently), so the report shows both side by side plus the difference.

### Figma reference and its limits

- The Figma file's **components** are `Tag` (7 tones), `Button` (4 kinds) and `Flow node` (9 states), from `docs/reference/figma-scripts/flowcanvas-screens.js`.
- Input, Toggle, Menu, Tooltip, Tabs and Panel exist in Figma only as parts of **screens**, so their references are crops of those screens.
- **Light theme isn't in Figma** (decision A1). This phase proposes light values for approval before they're used.
- **Token source:** Figma's Variables REST API needs an Enterprise plan, so it isn't free. Free route: a hand-written seed JSON with the decided values (decision A3), checked against the Figma file and the generator scripts' `HEX` map. Reading Figma variables directly can use the Figma connector in Claude Code, or an export plugin.

### On the owner's laptop: the footprint and the resource guard (owner, 4 Nov 2026)

**Everything local workspaces put on the laptop is labelled and listed, and it all comes off when a cloud provider is connected** (upgrade-later 33):

| What | Where | Removed by |
| --- | --- | --- |
| Workspace images `flowcanvas-workspace:<hash>` (about 560 MB each) | Docker images, label `org.flowcanvas.workspace=1` | Old ones: `pnpm workspace:clean`; all: `pnpm workspace:clean --all --yes` |
| Workspace containers, networks and volumes (the projects' files), named `fc-ws-<id>`; the egress proxy `fc-egress` and its network `fc-egress-out` | Docker, same label | `pnpm workspace:clean --all --yes` |
| Test leftovers `fc-test-*` | Docker (the tests remove them; a crashed run might not) | `pnpm workspace:clean` |
| The local workspace host (`workspace/host`) | A Node process, only while `pnpm dev` runs | Stops with `pnpm dev`; the code is retired with the switch |
| `WORKSPACE_HOST_TOKEN` | `.dev.vars` | Delete the line |
| The Docker adapter in the control plane | Code | Replaced by the provider's adapter |

Not ours, and never touched: anything else in Docker (other projects' images, containers and volumes), `node:24-slim` (already on the laptop), and the Playwright image (ADR 0012, still used by the visual tests).

**The resource guard** keeps Flowcanvas within a budget on this laptop (16 cores, 30.8 GiB memory, 950 GiB disk). It runs in the workspace host every 30 seconds.

| Budget or threshold | Value |
| --- | --- |
| Workspaces running at once | 2 (each up to 2 CPUs and 4 GiB, so at most 4 CPUs and 8 GiB together) |
| Flowcanvas's disk (our images plus workspace volumes) | 25 GiB; each workspace's volume 10 GiB |
| Laptop under pressure (whatever causes it) | memory available below 4 GiB, or disk free below 50 GiB, or the 1-minute load above 14 (about 90% of 16 cores) for 2 minutes |

**What it does, in order, until it's back within limits:**
1. Refuse to start or resume a workspace while over budget or under pressure, with a clear message ("Your computer is low on memory, so this workspace can't start").
2. Put idle workspaces to sleep, least recently used first.
3. Stop the least recently used workspaces. Their files are kept in their volumes.
4. Remove what isn't needed: old workspace image tags, stopped Flowcanvas containers, and volumes whose project no longer exists.

**Corrected in step 8a (5 Nov 2026, ADR 0019):**
- Sleeping frees CPU, not memory (a paused workspace keeps its memory). So memory pressure **stops** a workspace, asleep ones first, and load **sleeps** one.
- The host measures and refuses; the control plane's minute tick sleeps and stops, through the lifecycle, so the page and the meter stay right.
- Only old images are removed automatically. Stopped containers and volumes hold people's work, and no volume can be orphaned yet: projects can't be deleted (upgrade-later 39).
- Step 8a's write-up has the table.

It only ever acts on things labelled as Flowcanvas's. It never kills or removes anything else on the laptop. A runaway process inside a workspace is already held by that workspace's own limits. Every action is logged, and from step 9 it's shown on the workspace's card ("Put to sleep to free memory on this computer").

`pnpm workspace:resources` prints the laptop's figures and Flowcanvas's usage against these numbers. Claude also checks them at every step: each step's Risks line includes a "Laptop" line.

### Steps (planned)

| # | Step | Status |
| --- | --- | --- |
| 1 | Token source (DTCG JSON seed) + `tools/figma-tokens` generator → `packages/tokens` (CSS variables + typed TS), with tests | done · `c9ffb4c` · Claude |
| 2 | Light theme proposal: values + contrast checks, **for the owner's approval** | approved by owner · done · `02ae155` · Claude |
| 3 | `packages/ui` foundation: CSS Modules, global styles, self-hosted fonts, theme switching, reduced motion, "no raw values" lint rule | done · `7af36eb` · Claude |
| 4 | Storybook: setup, dark/light toolbar, accessibility addon, local run | done · `5d4aa21` (caption token) + `389286c` · Claude |
| 5 | Button and Tag (the Figma components) | done · `792a45a` · Claude |
| 6 | Input and Toggle | done · `8c1e851` · Claude · input border: option A (upgrade-later 15) |
| 7 | Tabs and Panel | done · `5b88a8e` · Claude |
| 8 | Menu and Tooltip (headless accessible primitives; ADR) | done · `9743475` · Claude · ADR 0008 |
| 9 | Flow node (all change states, selected, analysing) | done · `6fef1f8` · Claude · ADR 0009 · shadow `0358bba` |
| 10 | Figma references + Playwright visual comparison with a side-by-side report | done · `7949c92` + `4a325a0` · exports: owner · tests: Claude |
| 11 | Version page restyled with tokens; Storybook deployed to a free Cloudflare URL | done · `e708c35` `7d94a63` `26df0ee` `de6e08c` · Claude (repo) + owner (Cloudflare catalogue project) · ADR 0010 · verified on previews of `3231df2` |
| 12 | Close phase 1a: ADRs, architecture, status, changelog, report, merge | done · `08b2c62` + merge `ec07da3` (PR #3) · Claude · phase accepted by owner 29 Oct 2026 |

### Step 1a.1 — Design tokens: source, generator and generated package

**Goal:** turn the Graphite design decisions into **data** (a token source in the W3C DTCG format), and build a small generator (`tools/figma-tokens`) that writes them out as **CSS custom properties** and **typed TypeScript** in a new package, `@flowcanvas/tokens`. Every component from step 3 on uses only these tokens.

**Expected outcome:**
- `pnpm --filter @flowcanvas/tokens generate` writes `packages/tokens/css/tokens.css` (126 CSS variables: colours, text styles, spacing, radii, sizes, borders, motion, shadow) and `packages/tokens/src/tokens.generated.ts`.
- `pnpm test` adds 33 tests: 18 for the generator, plus 15 for the tokens package (generated files in sync with the source, and WCAG contrast checks on the palette).
- Hand-editing a generated file, or picking a colour with too little contrast, makes a test fail (verified).

**Concepts:**
- **Design tokens.**
  - Named design decisions (`color.surface.canvas = #0B0C0E`, `radius.node = 6px`, `text.body = Inter 13/20 400`), stored as data rather than scattered through CSS.
  - Designers and code share the names; changing one value changes it everywhere.
  - Docs: https://www.designtokens.org/ (the W3C Design Tokens Community Group format, "DTCG").
- **The DTCG JSON format.**
  - Groups are plain objects; a token is an object with `$value`.
  - `$type` (`color`, `dimension`, `duration`, `fontFamily`, `fontWeight`, `number`, `shadow`, `typography`) can sit on a group and is **inherited** by everything inside it.
  - Dimensions and durations are objects: `{ "value": 6, "unit": "px" }`.
  - A value can **reference** another token with `{font.weight.semibold}`. The generator turns that into `var(--font-weight-semibold)`, so there is one source of truth.
  - Docs: https://www.designtokens.org/tr/drafts/format/
- **Where the values come from.** Figma's Variables API needs a paid Enterprise plan, and the Figma connector's free quota ran out (`docs/upgrade-later.md` item 14). The source is seeded from the `HEX` map and text styles in `docs/reference/figma-scripts/` (the code that created the Figma file), which are identical in all three scripts and match decision A1.
- **Base vs theme files.**
  - `source/base.tokens.json` holds what is the same in every theme: fonts, text styles, spacing, radii, sizes, borders, motion, opacity, shadow.
  - `source/color.dark.tokens.json` holds the dark colours.
  - Step 2 adds `color.light.tokens.json`. The generator refuses themes that don't define exactly the same tokens, so light can never miss a colour.
- **Generated output.**
  - `css/tokens.css`: base variables on `:root`; the default (dark) theme on `:root` **and** `[data-theme='dark']`; later themes on `[data-theme='…']`. Also `color-scheme`, so native controls (scrollbars, form inputs) match.
  - `src/tokens.generated.ts`: `vars` (typed references like `vars.color.surface.canvas` → `'var(--color-surface-canvas)'`) and `themeValues` (resolved values per theme, for places that can't read CSS variables, such as the canvas and WebGL in later phases).
- **Generated files are committed, never edited.** They're committed so reviews show exactly what changed in CSS. A test regenerates them in memory and compares, so a hand edit fails CI (and `generate:check` fails too). They're in `.prettierignore` because their format is the generator's job.
- **Validation in the generator.**
  - Colours must be 6-digit hex.
  - Units: `px`/`rem` for dimensions, `ms`/`s` for durations.
  - Names: lowercase words with dashes.
  - References must resolve.
  - No token may be defined twice.
  - No two token paths may flatten to the same CSS name (`a.b-c` vs `a-b.c`).

  A bad token fails loudly with its path (`color.a: colors must be 6-digit hex values like #0B0C0E`) instead of producing broken CSS.
- **Contrast tests (WCAG AA) on the palette itself.**
  - Text pairs need 4.5:1; meaningful non-text marks (icons, edges, focus rings, state bars) need 3:1.
  - The relative-luminance formula is in the test, so the numbers in the Graphite doc are now enforced, and the light theme (step 2) gets checked automatically.
  - Docs: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **A small CLI with no dependencies.** `node:util`'s `parseArgs` handles the flags. The package's `bin` field makes `figma-tokens` available to other workspace packages after it's built (Turbo builds it first via `^build`). Docs: https://nodejs.org/api/util.html#utilparseargsconfig
- **Reading untrusted JSON safely.** The generator reads JSON as `unknown` and narrows it with type guards (`isRecord`, `isTokenType`) instead of casting. That's how strict TypeScript plus type-aware lint keep untrusted input honest.

**Files:**
- `tools/figma-tokens/`: `package.json`, `tsconfig.json`, `tsconfig.build.json` (same as the control plane's: Node types), `src/parse.ts`, `src/render.ts`, `src/load.ts`, `src/cli.ts`, `src/index.ts`, `src/parse.test.ts`, `src/render.test.ts`
- `packages/tokens/`: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `source/base.tokens.json`, `source/color.dark.tokens.json`, `src/index.ts`, `src/tokens.test.ts`, plus the generated `css/tokens.css` and `src/tokens.generated.ts`
- `.prettierignore`: add the two generated files

**`tools/figma-tokens/package.json`:**

```json
{
  "name": "@flowcanvas/figma-tokens",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "figma-tokens": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**`packages/tokens/package.json`:**

```json
{
  "name": "@flowcanvas/tokens",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./tokens.css": "./css/tokens.css"
  },
  "files": [
    "dist",
    "css"
  ],
  "scripts": {
    "generate": "figma-tokens --base source/base.tokens.json --theme dark=source/color.dark.tokens.json --css css/tokens.css --ts src/tokens.generated.ts",
    "generate:check": "pnpm run generate --check",
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@flowcanvas/figma-tokens": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

**`tools/figma-tokens/src/parse.ts`:**

```ts
// Parses design tokens in the W3C Design Tokens (DTCG) JSON format:
// groups are plain objects, a token is an object with `$value`, and `$type` is inherited from parent groups.

export type TokenType =
  | 'color'
  | 'dimension'
  | 'duration'
  | 'fontFamily'
  | 'fontWeight'
  | 'number'
  | 'shadow'
  | 'typography';

const TOKEN_TYPES: readonly TokenType[] = [
  'color',
  'dimension',
  'duration',
  'fontFamily',
  'fontWeight',
  'number',
  'shadow',
  'typography',
];

export interface Token {
  readonly path: readonly string[];
  readonly type: TokenType;
  readonly value: unknown;
  readonly description?: string;
}

export class TokenError extends Error {
  constructor(path: readonly string[], message: string) {
    super(`${path.length > 0 ? path.join('.') : '(root)'}: ${message}`);
    this.name = 'TokenError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTokenType(value: unknown): value is TokenType {
  return typeof value === 'string' && (TOKEN_TYPES as readonly string[]).includes(value);
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseTokens(document: unknown): Token[] {
  if (!isRecord(document)) {
    throw new TokenError([], 'a token file must contain a JSON object');
  }
  const tokens: Token[] = [];
  walk(document, [], undefined, tokens);
  return tokens;
}

function walk(
  node: Record<string, unknown>,
  path: readonly string[],
  inheritedType: TokenType | undefined,
  out: Token[],
): void {
  const ownType = node.$type;
  if (ownType !== undefined && !isTokenType(ownType)) {
    throw new TokenError(path, `unsupported $type ${JSON.stringify(ownType)}`);
  }
  const type = ownType ?? inheritedType;

  if ('$value' in node) {
    if (type === undefined) {
      throw new TokenError(path, 'token has no $type (set it on the token or a parent group)');
    }
    const description = node.$description;
    out.push({
      path,
      type,
      value: node.$value,
      ...(typeof description === 'string' ? { description } : {}),
    });
    return;
  }

  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) {
      continue;
    }
    if (!NAME_PATTERN.test(key)) {
      throw new TokenError([...path, key], 'names must be lowercase words separated by "-"');
    }
    if (!isRecord(child)) {
      throw new TokenError([...path, key], 'expected a group or a token object');
    }
    walk(child, [...path, key], type, out);
  }
}
```

**`tools/figma-tokens/src/render.ts`:**

```ts
import { TokenError, type Token } from './parse.js';

export interface Theme {
  readonly name: string;
  readonly tokens: readonly Token[];
}

export interface TokenSet {
  /** Tokens that are the same in every theme (type, spacing, radii, motion). */
  readonly base: readonly Token[];
  /** One entry per theme. The first theme is the default. */
  readonly themes: readonly Theme[];
}

const HEADER =
  'Generated by @flowcanvas/figma-tokens from packages/tokens/source. Do not edit by hand: change the source and run `pnpm --filter @flowcanvas/tokens generate`.';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const REFERENCE = /^\{([a-z0-9-]+(?:\.[a-z0-9-]+)*)\}$/;

export function cssVariableName(path: readonly string[]): string {
  return `--${path.join('-')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reference(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = REFERENCE.exec(value);
  return match?.[1];
}

function referenceToCss(target: string, known: ReadonlySet<string>, at: readonly string[]): string {
  if (!known.has(target)) {
    throw new TokenError(at, `reference {${target}} does not point to a token`);
  }
  return `var(${cssVariableName(target.split('.'))})`;
}

function formatMeasure(value: unknown, units: readonly string[], at: readonly string[]): string {
  if (isRecord(value) && typeof value.value === 'number' && typeof value.unit === 'string') {
    if (!units.includes(value.unit)) {
      throw new TokenError(at, `unit must be one of ${units.join(', ')}`);
    }
    return `${String(value.value)}${value.unit}`;
  }
  throw new TokenError(at, `expected { "value": number, "unit": ${units.join(' | ')} }`);
}

function formatFontFamily(value: unknown, at: readonly string[]): string {
  const families = Array.isArray(value) ? value : [value];
  return families
    .map((family) => {
      if (typeof family !== 'string' || family.trim() === '') {
        throw new TokenError(at, 'font family names must be non-empty strings');
      }
      return /\s/.test(family) ? `'${family}'` : family;
    })
    .join(', ');
}

/** Formats a single (non-composite) value as CSS. */
function formatValue(
  type: Token['type'],
  value: unknown,
  known: ReadonlySet<string>,
  at: readonly string[],
): string {
  const target = reference(value);
  if (target !== undefined) {
    return referenceToCss(target, known, at);
  }
  switch (type) {
    case 'color':
      if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
        throw new TokenError(at, 'colors must be 6-digit hex values like #0B0C0E');
      }
      return value.toLowerCase();
    case 'dimension':
      return formatMeasure(value, ['px', 'rem'], at);
    case 'duration':
      return formatMeasure(value, ['ms', 's'], at);
    case 'fontFamily':
      return formatFontFamily(value, at);
    case 'fontWeight':
    case 'number':
      if (typeof value !== 'number') {
        throw new TokenError(at, `expected a number`);
      }
      return String(value);
    case 'shadow': {
      if (!isRecord(value)) {
        throw new TokenError(at, 'expected a shadow object');
      }
      const parts = [
        formatValue('dimension', value.offsetX, known, at),
        formatValue('dimension', value.offsetY, known, at),
        formatValue('dimension', value.blur, known, at),
        formatValue('dimension', value.spread, known, at),
      ];
      const { color } = value;
      // Shadow colours may carry alpha, so they're taken verbatim (e.g. rgba(0, 0, 0, 0.4)) unless they're a reference.
      const colorCss =
        reference(color) !== undefined
          ? formatValue('color', color, known, at)
          : typeof color === 'string'
            ? color
            : undefined;
      if (colorCss === undefined) {
        throw new TokenError(at, 'shadow color must be a string');
      }
      return [...parts, colorCss].join(' ');
    }
    case 'typography':
      throw new TokenError(at, 'typography is a composite token');
  }
}

const TYPOGRAPHY_PARTS: readonly (readonly [string, string, Token['type'] | 'lineHeight'])[] = [
  ['fontFamily', 'font-family', 'fontFamily'],
  ['fontSize', 'font-size', 'dimension'],
  ['fontWeight', 'font-weight', 'fontWeight'],
  ['lineHeight', 'line-height', 'lineHeight'],
  ['letterSpacing', 'letter-spacing', 'dimension'],
];

/** Expands one token into CSS custom property declarations (typography becomes one per part). */
export function declarations(token: Token, known: ReadonlySet<string>): [string, string][] {
  if (token.type !== 'typography') {
    return [[cssVariableName(token.path), formatValue(token.type, token.value, known, token.path)]];
  }
  const { value } = token;
  if (!isRecord(value)) {
    throw new TokenError(token.path, 'expected a typography object');
  }
  return TYPOGRAPHY_PARTS.map(([key, suffix, partType]) => {
    const part = value[key];
    if (part === undefined) {
      throw new TokenError(token.path, `typography is missing ${key}`);
    }
    const css =
      partType === 'lineHeight'
        ? typeof part === 'number'
          ? String(part)
          : formatValue('dimension', part, known, token.path)
        : formatValue(partType, part, known, token.path);
    return [cssVariableName([...token.path, suffix]), css];
  });
}

function checkThemes(set: TokenSet): void {
  const [first, ...rest] = set.themes;
  if (first === undefined) {
    throw new TokenError([], 'at least one theme is required');
  }
  const names = (theme: Theme): string[] =>
    theme.tokens.map((token) => token.path.join('.')).sort();
  const expected = names(first).join('\n');
  for (const theme of rest) {
    if (names(theme).join('\n') !== expected) {
      throw new TokenError(
        [],
        `theme "${theme.name}" must define exactly the same tokens as "${first.name}"`,
      );
    }
  }
}

function knownNames(set: TokenSet): Set<string> {
  const all = [...set.base, ...(set.themes[0]?.tokens ?? [])];
  const known = new Set<string>();
  for (const token of all) {
    const name = token.path.join('.');
    if (known.has(name)) {
      throw new TokenError(token.path, 'defined more than once');
    }
    known.add(name);
  }
  return known;
}

function block(
  selector: string,
  lines: readonly [string, string][],
  extra: readonly string[] = [],
): string {
  const body = [...extra, ...lines.map(([name, value]) => `${name}: ${value};`)]
    .map((line) => `  ${line}`)
    .join('\n');
  return `${selector} {\n${body}\n}\n`;
}

/** Different token paths can flatten to the same CSS name (`a.b-c` and `a-b.c`); refuse that. */
function checkUniqueCssNames(lines: readonly [string, string][]): void {
  const seen = new Set<string>();
  for (const [name] of lines) {
    if (seen.has(name)) {
      throw new TokenError([], `two tokens produce the same CSS variable ${name}`);
    }
    seen.add(name);
  }
}

export function renderCss(set: TokenSet): string {
  checkThemes(set);
  const known = knownNames(set);
  const base = set.base.flatMap((token) => declarations(token, known));
  checkUniqueCssNames([
    ...base,
    ...(set.themes[0]?.tokens ?? []).flatMap((token) => declarations(token, known)),
  ]);
  const parts = [`/* ${HEADER} */\n`, block(':root', base)];
  set.themes.forEach((theme, index) => {
    const lines = theme.tokens.flatMap((token) => declarations(token, known));
    const selector =
      index === 0 ? `:root,\n[data-theme='${theme.name}']` : `[data-theme='${theme.name}']`;
    parts.push(
      block(selector, lines, [`color-scheme: ${theme.name === 'light' ? 'light' : 'dark'};`]),
    );
  });
  return parts.join('\n');
}

interface Tree {
  [key: string]: Tree | string;
}

function insert(tree: Tree, path: readonly string[], leaf: string): void {
  let node = tree;
  path.forEach((key, index) => {
    if (index === path.length - 1) {
      node[key] = leaf;
      return;
    }
    const next = node[key];
    if (typeof next === 'string') {
      throw new TokenError(path, 'a token cannot also be a group');
    }
    node = next ?? (node[key] = {});
  });
}

export function renderTs(set: TokenSet): string {
  checkThemes(set);
  const known = knownNames(set);
  const vars: Tree = {};
  for (const token of [...set.base, ...(set.themes[0]?.tokens ?? [])]) {
    for (const [name] of declarations(token, known)) {
      insert(vars, keyPath(token, name), `var(${name})`);
    }
  }
  const themes: Record<string, Record<string, string>> = {};
  for (const theme of set.themes) {
    const values: Record<string, string> = {};
    for (const token of theme.tokens) {
      for (const [name, value] of declarations(token, known)) {
        values[name] = value;
      }
    }
    themes[theme.name] = values;
  }
  const themeNames = set.themes.map((theme) => `'${theme.name}'`).join(' | ');
  return [
    `// ${HEADER}`,
    '',
    '/** CSS custom property references, e.g. `vars.color.surface.canvas` → `var(--color-surface-canvas)`. */',
    `export const vars = ${JSON.stringify(vars, null, 2)} as const;`,
    '',
    '/** Resolved values per theme, for places that cannot read CSS variables (canvas, WebGL). */',
    `export const themeValues = ${JSON.stringify(themes, null, 2)} as const;`,
    '',
    `export type ThemeName = ${themeNames};`,
    '',
  ].join('\n');
}

/** Object path for a declaration: the token path plus, for typography, the camelCase part name. */
function keyPath(token: Token, cssName: string): string[] {
  if (token.type !== 'typography') {
    return [...token.path];
  }
  const suffix = cssName.slice(cssVariableName(token.path).length + 1);
  const camel = suffix.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return [...token.path, camel];
}
```

**`tools/figma-tokens/src/load.ts`:**

```ts
import { readFile } from 'node:fs/promises';
import { parseTokens, TokenError } from './parse.js';
import type { TokenSet } from './render.js';

export interface TokenSources {
  /** JSON file with tokens shared by every theme. */
  readonly base: string;
  /** Theme name → JSON file. The first entry is the default theme. */
  readonly themes: readonly (readonly [name: string, file: string])[];
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TokenError([], `${file} is not valid JSON: ${(error as Error).message}`);
  }
}

export async function loadTokenSet(sources: TokenSources): Promise<TokenSet> {
  const base = parseTokens(await readJson(sources.base));
  const themes = await Promise.all(
    sources.themes.map(async ([name, file]) => ({
      name,
      tokens: parseTokens(await readJson(file)),
    })),
  );
  return { base, themes };
}
```

**`tools/figma-tokens/src/cli.ts`:**

```ts
#!/usr/bin/env node
// Usage:
//   figma-tokens --base base.tokens.json --theme dark=color.dark.tokens.json --css out.css --ts out.ts [--check]
// --check writes nothing and exits 1 if the outputs are out of date (for CI and tests).

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadTokenSet } from './load.js';
import { renderCss, renderTs } from './render.js';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    theme: { type: 'string', multiple: true },
    css: { type: 'string' },
    ts: { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  process.stderr.write(`figma-tokens: ${message}\n`);
  process.exit(1);
}

const { base, css, ts, check } = values;
if (base === undefined || css === undefined || ts === undefined) {
  fail('--base, --css and --ts are required');
}
const themes = (values.theme ?? []).map((entry): [string, string] => {
  const [name, file] = entry.split('=');
  if (name === undefined || file === undefined || name === '' || file === '') {
    fail(`--theme must look like name=path, got "${entry}"`);
  }
  return [name, file];
});

try {
  const set = await loadTokenSet({ base, themes });
  const outputs: [string, string][] = [
    [css, renderCss(set)],
    [ts, renderTs(set)],
  ];
  if (check) {
    const stale: string[] = [];
    for (const [file, content] of outputs) {
      const current = await readFile(file, 'utf8').catch(() => '');
      if (current !== content) {
        stale.push(file);
      }
    }
    if (stale.length > 0) {
      fail(`out of date: ${stale.join(', ')}. Run the generate script.`);
    }
    process.stdout.write('figma-tokens: generated files are up to date\n');
  } else {
    await Promise.all(outputs.map(([file, content]) => writeFile(file, content)));
    process.stdout.write(`figma-tokens: wrote ${outputs.map(([file]) => file).join(', ')}\n`);
  }
} catch (error) {
  fail((error as Error).message);
}
```

**`tools/figma-tokens/src/index.ts`:**

```ts
export { parseTokens, TokenError, type Token, type TokenType } from './parse.js';
export {
  cssVariableName,
  declarations,
  renderCss,
  renderTs,
  type Theme,
  type TokenSet,
} from './render.js';
export { loadTokenSet, type TokenSources } from './load.js';
```

**`packages/tokens/src/index.ts`:**

```ts
export { themeValues, vars, type ThemeName } from './tokens.generated.js';
```

**`packages/tokens/src/tokens.test.ts`:**

```ts
import { readFile } from 'node:fs/promises';
import { loadTokenSet, renderCss, renderTs } from '@flowcanvas/figma-tokens';
import { describe, expect, it } from 'vitest';
import { themeValues } from './index.js';

const root = new URL('../', import.meta.url);
const file = (path: string) => new URL(path, root);

describe('generated token files', () => {
  it('are up to date with the token source (never edited by hand)', async () => {
    const set = await loadTokenSet({
      base: file('source/base.tokens.json').pathname,
      themes: [['dark', file('source/color.dark.tokens.json').pathname]],
    });
    expect(await readFile(file('css/tokens.css'), 'utf8')).toBe(renderCss(set));
    expect(await readFile(file('src/tokens.generated.ts'), 'utf8')).toBe(renderTs(set));
  });
});

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe.each(Object.entries(themeValues))('%s theme contrast (WCAG AA)', (_theme, values) => {
  const value = (name: string): string => {
    const found = (values as Record<string, string>)[`--color-${name}`];
    if (found === undefined) {
      throw new Error(`missing token --color-${name}`);
    }
    return found;
  };

  it.each([
    ['text-primary', 'surface-canvas'],
    ['text-primary', 'surface-raised'],
    ['text-secondary', 'surface-panel'],
    ['text-on-accent', 'surface-inverse'],
    ['accent-text', 'surface-panel'],
    ['state-added-text', 'state-added-tint'],
    ['state-modified-text', 'state-modified-tint'],
    ['state-removed-text', 'state-removed-tint'],
    ['state-affected-text', 'state-affected-tint'],
    ['state-scope-text', 'state-scope-tint'],
  ])('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(value(fg), value(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['text-tertiary', 'surface-raised'],
    ['edge-default', 'surface-canvas'],
    ['accent-solid', 'surface-raised'],
    ['state-removed-solid', 'surface-canvas'],
  ])('non-text %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(value(fg), value(bg))).toBeGreaterThanOrEqual(3);
  });
});
```

**`tools/figma-tokens/src/parse.test.ts` and `render.test.ts`:** 18 tests covering:
- type inheritance and override
- missing or unsupported `$type`
- name rules, and non-object documents
- `:root` and theme blocks, and later-theme selectors
- typography expansion with references
- font-family quoting, shadows
- invalid hex, invalid units, unresolved references
- mismatched themes, duplicate tokens, CSS-name clashes
- TS output

Full code is in the repository.

**`packages/tokens/source/*.tokens.json`:** see the repository. `base.tokens.json` (fonts, 10 text styles, space 2–32, radius control 4 / node 6 / popover 8 / frame 10, sizes, borders, durations 80/160/240/300/1200 ms, ghost opacity 0.4, popover shadow) and `color.dark.tokens.json` (40 colours from the `HEX` map).

**Commands:**

```fish
pnpm install
pnpm exec turbo run build --filter=@flowcanvas/figma-tokens   # the generator must be built before it can run
pnpm --filter @flowcanvas/tokens generate                     # "wrote css/tokens.css, src/tokens.generated.ts"
pnpm --filter @flowcanvas/tokens generate:check               # "generated files are up to date"
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

**Run and check it:**
1. Open `packages/tokens/css/tokens.css`: `:root` has `--font-family-sans`, `--text-body-font-size: 13px`, `--radius-node: 6px`…; the dark block has `--color-surface-canvas: #0b0c0e` and the state colours.
2. `pnpm --filter @flowcanvas/tokens test`: 15 passed (1 sync + 14 contrast).
3. **Prove the sync guard:** change any value in `css/tokens.css` by hand and run the test. "are up to date with the token source" fails, and `generate:check` prints "out of date". Undo with `generate`.
4. **Prove the contrast guard:** set `color.text.secondary` to `#3A3F47` in the dark source, run `generate`, then test. "text-secondary on surface-panel is at least 4.5:1" fails. Restore it.
5. **One change, everywhere:** change `radius.node` to 8 px in the source, run `generate`, and see both the CSS and `themeValues` update. Restore it.

**Gotchas:**
- **`figma-tokens: command not found`:** the generator isn't built yet. Build `@flowcanvas/figma-tokens` first (Turbo does this automatically for `build`/`test`).
- **Never edit `css/tokens.css` or `src/tokens.generated.ts`.** Edit `source/*.tokens.json` and regenerate.
- **Token names must be lowercase-with-dashes** (`on-accent`, not `onAccent`). The generator rejects the rest with the exact path.
- **Shadow colours are taken verbatim** (they can have alpha, like `rgba(0, 0, 0, 0.4)`); every other colour must be 6-digit hex or a reference.

**Commit:** `feat(tokens): add DTCG token source, generator and generated Graphite tokens`

### Step 1a.2 — Light theme proposal (needs the owner's approval)

**Goal:** define the light theme with exactly the same 40 colour roles as dark, prove it meets the same accessibility bar, and get the owner's approval before anything uses it (decision A1: "propose one in phase 1a for my approval").

**Expected outcome:**
- `packages/tokens/source/color.light.tokens.json` exists.
- The generated CSS gains a `[data-theme='light']` block.
- The token tests grow from 15 to **29**: the sync test plus 14 contrast checks **per theme**.
- A side-by-side preview of both themes for review.

**Concepts:**
- **Same roles, different values.** Components never say "dark" or "light". They use roles (`surface/raised`, `state/added/text`). A theme is just another set of values for the same names, so adding light needs **no component changes**. The generator refuses a theme that misses or adds a role.
- **Inverted lightness, same meaning.**
  - Surfaces step *down* in lightness as they come forward: canvas `#FCFCFD`, panel `#F6F7F9`, nodes `#FFFFFF`.
  - Text is near-black.
  - The change-state hues keep their muted character, but their solids and texts are darker so they read on white, and their tints become pale washes.
- **The primary button in light.** In dark, the primary button is off-white with dark text: the highest-contrast element on a dark screen. An off-white button would disappear on a white screen, so in light, `surface/inverse` is near-black (`#1E2228`) and `text/on-accent` becomes off-white (`#FCFCFD`). Same role ("the one strongest action"), inverted value. **This is the one judgement call to approve.**
- **The accent stays steel blue,** darkened to `#4E6390` so focus rings and selection outlines keep 3:1+ on white (5.98:1). Off-white text on it is 5.83:1, for the source tag on live frames.
- **App preview colours are unchanged.** Live frames show the user's own app, which doesn't change with our theme.
- **Contrast results (WCAG AA), all passing.** Text pairs ≥ 4.5:1: primary on canvas 17.20, secondary on panel 5.58, secondary on selected rows 4.91, on-accent on inverse 15.58, accent text 7.11, the five state text-on-tint pairs 6.44–7.19. Non-text ≥ 3:1: tertiary on nodes 3.35, edges 3.26, accent 5.98, state solids 3.99–5.10.
- **Following the system setting** (`prefers-color-scheme`) and the theme toggle come in step 3. Until then, light is only active where `data-theme="light"` is set.

**Proposed values (dark → light):**

| Token | Dark (current) | Light (proposed) |
| --- | --- | --- |
| `surface/canvas` | `#0B0C0E` | `#FCFCFD` |
| `surface/panel` | `#111317` | `#F6F7F9` |
| `surface/raised` | `#181B20` | `#FFFFFF` |
| `surface/hover` | `#1E2228` | `#EEF0F3` |
| `surface/selected` | `#252A31` | `#E6E9EE` |
| `surface/inverse` | `#E6E8EB` | `#1E2228` |
| `border/subtle` | `#2C323A` | `#E3E6EA` |
| `border/control` | `#383F49` | `#D2D6DC` |
| `border/strong` | `#4A525E` | `#B4BAC3` |
| `text/primary` | `#EDEFF2` | `#16191D` |
| `text/secondary` | `#A3AAB5` | `#5C6470` |
| `text/tertiary` | `#6B7380` | `#868D98` |
| `text/on-accent` | `#0B0C0E` | `#FCFCFD` |
| `accent/solid` | `#7487AD` | `#4E6390` |
| `accent/hover` | `#8496BB` | `#43578A` |
| `accent/tint` | `#182031` | `#E9EDF5` |
| `accent/ring` | `#34405A` | `#B8C4DB` |
| `accent/text` | `#A9B7D3` | `#3D5287` |
| `state/added/solid` | `#6E9C82` | `#4C8063` |
| `state/added/tint` | `#18221D` | `#E6F0EA` |
| `state/added/text` | `#9FC2AD` | `#2E5E43` |
| `state/modified/solid` | `#B39B6B` | `#957A40` |
| `state/modified/tint` | `#24211A` | `#F4EFE2` |
| `state/modified/text` | `#D2BE93` | `#66511F` |
| `state/removed/solid` | `#B07473` | `#A0585A` |
| `state/removed/tint` | `#261B1B` | `#F6E7E7` |
| `state/removed/text` | `#CFA09F` | `#7A393C` |
| `state/affected/solid` | `#8C83B0` | `#7064A0` |
| `state/affected/tint` | `#1F1D29` | `#ECEAF5` |
| `state/affected/text` | `#B5AED3` | `#514585` |
| `state/scope/solid` | `#A97A96` | `#93607F` |
| `state/scope/tint` | `#251C22` | `#F5E8F0` |
| `state/scope/text` | `#C9A3BA` | `#6E3C5B` |
| `edge/observed` | `#A3AAB5` | `#5C6470` |
| `edge/default` | `#6B7380` | `#868D98` |
| `preview/surface` | `#FFFFFF` | `#FFFFFF` |
| `preview/ink` | `#1F2328` | `#1F2328` |
| `preview/muted` | `#6E7781` | `#6E7781` |
| `preview/line` | `#E5E7EB` | `#E5E7EB` |
| `preview/brand` | `#1F2328` | `#1F2328` |

**Files (on approval):**
- `packages/tokens/source/color.light.tokens.json`: the 40 values above, `$type: color`.
- `packages/tokens/package.json`: the `generate` script gains `--theme light=source/color.light.tokens.json`.
- `packages/tokens/src/tokens.test.ts`: the sync test loads both themes. The contrast suite already runs for every theme in `themeValues`.
- Regenerated `css/tokens.css` and `src/tokens.generated.ts`.
- `docs/decisions-log.md`: record the approval.
- `docs/reference/design-language-graphite.md`: replace "Light theme: not yet defined" with the approved values.

**Commands:**

```fish
pnpm --filter @flowcanvas/tokens generate
pnpm --filter @flowcanvas/tokens test        # 29 passed
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

**Run and check it:** open the side-by-side preview (local file, path given in chat) and compare buttons, tags, text, flow nodes in every change state, and surfaces. From step 4 the same comparison lives in Storybook with a theme toggle.

**Commit:** `feat(tokens): add Graphite light theme`


### Step 1a.3 — `packages/ui` foundation

**Goal:** create the component package `@flowcanvas/ui` with everything components will stand on:
- global styles from tokens only
- self-hosted fonts
- theme switching (explicit choice, or following the operating system)
- reduced motion
- a CSS lint rule that rejects raw colours and sizes

The web app uses the global styles from now on, which proves the foundation works in a real build under the strict CSP.

**Expected outcome:**
- `pnpm dev` shows the version page in **Inter** on the Graphite canvas. With the operating system in light mode it shows the **light** theme automatically.
- `pnpm lint` now also runs Stylelint on every CSS file in `packages/ui` and rejects raw values (8 kinds verified).
- 7 new tests: 5 for theme utilities, 2 for the generator's system-preference block.
- No console errors or CSP violations in either theme (verified under Cloudflare's runtime).

**Concepts:**
- **A source package, not a compiled one.**
  - `@flowcanvas/ui` exports its TypeScript and CSS **source** (`"exports": { ".": "./src/index.ts" }`).
  - Its only consumers (the web app, and Storybook from step 4) are built by Vite, which compiles TSX and CSS Modules anyway.
  - Compiling it separately would mean a library build that extracts CSS, for no gain.
  - It's still type-checked, linted and tested like every package.
  - A deliberate exception to ADR 0001's "compiled packages", recorded as ADR 0007 at phase end.
- **CSS custom properties as the theme mechanism.** Components write `var(--color-surface-raised)`. The value depends on which block in `tokens.css` applies:
  - `:root` / `[data-theme='dark']` → dark
  - `[data-theme='light']` → light
  - no `data-theme` + OS in light mode → light, through `@media (prefers-color-scheme: light) { :root:not([data-theme]) … }`

  The last rule is new in the generator this step. "Follow the system" works in pure CSS, so there's no flash of the wrong theme while JavaScript loads. Docs: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme
- **Theme preference.**
  - `useThemePreference()` returns `'dark' | 'light' | 'system'` plus a setter.
  - It sets or removes `data-theme` on `<html>` and remembers the choice in `localStorage`.
  - Storage can be missing or throw (private windows, blocked site data), so reads fall back to `'system'` and writes fail silently.
  - The toggle UI arrives in Storybook (step 4) and the settings screen (phase 36a).
- **Self-hosted fonts (Fontsource).**
  - `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` ship the font files plus `@font-face` CSS, split by alphabet (`unicode-range`) so a browser only downloads what a page uses.
  - They register as **"Inter Variable"** and **"JetBrains Mono Variable"**, so the font tokens list those names first.
  - Licence: SIL Open Font License (free to ship).
  - Serving fonts from our own origin is what the CSP's `font-src 'self'` requires (no Google Fonts).
  - Docs: https://fontsource.org/docs/getting-started/install
- **Vite inlines small files as `data:` URLs, and the CSP blocks that for fonts.**
  - Vite turns assets under 4 kB into inline `data:` URLs. One tiny font subset was inlined, and the browser refused it ("Loading the font 'data:font/woff2…' violates … font-src 'self'").
  - Fix: `build.assetsInlineLimit` returns `false` for `.woff2`, so fonts are always separate files. The CSP stays strict.
  - Docs: https://vite.dev/config/build-options.html#build-assetsinlinelimit
- **Reduced motion.** Under `@media (prefers-reduced-motion: reduce)` every duration token becomes `0ms`. Components animate with tokens, so they jump straight to the same end state. One rule, no per-component work. Docs: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- **One focus style.** `:focus-visible` shows a 2 px accent ring offset from the element, only for keyboard focus (not mouse clicks). Rule from the Graphite accessibility section.
- **Stylelint: "design tokens only", enforced.** Stylelint is ESLint for CSS. Our config uses only built-in rules:
  - no hex colours, no named colours, no `rgb()`/`hsl()`/…
  - no units on font, line-height, letter-spacing, radius, padding/margin/gap/inset, outline width/offset, box-shadow and motion properties, so they must be `var(--…)` or `0`
  - no numeric `font-weight` and no literal `font-family`

  `0`, `transparent`, `inherit` and `currentColor` stay allowed. CLAUDE.md §4 rule 9 ("no hard-coded colours, sizes, radii or fonts") is now a failing lint, not a review comment. Docs: https://stylelint.io/user-guide/rules
- **Testing hooks.** `renderHook` from Testing Library runs a hook inside a tiny test component; `act()` flushes React updates before asserting.

**`pnpm-workspace.yaml`:** add to the catalog:

```yaml
  '@fontsource-variable/inter': 5.3.0
  '@fontsource-variable/jetbrains-mono': 5.3.0
  stylelint: 17.16.0
```

**Root `package.json`:** add `"stylelint": "catalog:"` to `devDependencies` (so editors find it).

**`packages/tokens/source/base.tokens.json`:** the font families become:

```json
"sans": { "$value": ["Inter Variable", "Inter", "system-ui", "sans-serif"] },
"mono": { "$value": ["JetBrains Mono Variable", "JetBrains Mono", "ui-monospace", "monospace"] }
```

then run `pnpm --filter @flowcanvas/tokens generate`.

**`tools/figma-tokens/src/render.ts`:** after pushing each theme block, a non-default `light` theme also gets the system-preference block:

```ts
  set.themes.forEach((theme, index) => {
    const lines = theme.tokens.flatMap((token) => declarations(token, known));
    const selector =
      index === 0 ? `:root,\n[data-theme='${theme.name}']` : `[data-theme='${theme.name}']`;
    const scheme = [`color-scheme: ${theme.name === 'light' ? 'light' : 'dark'};`];
    parts.push(block(selector, lines, scheme));
    // A non-default light theme also follows the operating system's preference, as long as the user
    // hasn't chosen a theme explicitly (data-theme set). Pure CSS, so there's no flash before JS runs.
    if (index > 0 && theme.name === 'light') {
      const inner = block(':root:not([data-theme])', lines, scheme)
        .trimEnd()
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      parts.push(`@media (prefers-color-scheme: light) {\n${inner}\n}\n`);
    }
  });
```

Two generator tests are added: the media block exists with `:root:not([data-theme])` when there is a light theme, and is absent otherwise.

**`stylelint.config.js`** (repo root):

```js
// Component and global CSS may only use design tokens for colour, type, spacing, radius, shadow and motion.
// Raw values are rejected, so a token change reaches every component.
/** @type {import('stylelint').Config} */
export default {
  ignoreFiles: ['**/dist/**', 'packages/tokens/css/**'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
    ],
    'declaration-property-unit-allowed-list': {
      '/^font/': [],
      'line-height': [],
      'letter-spacing': [],
      '/radius$/': [],
      '/^(padding|margin|gap|row-gap|column-gap|inset)/': [],
      '/^outline-(width|offset)$/': [],
      'box-shadow': [],
      '/^(transition|animation)/': [],
    },
    'declaration-property-value-disallowed-list': {
      'font-weight': ['/^\\d/'],
      'font-family': ['/^(?!var\\(|inherit)/'],
    },
  },
};
```

**`packages/ui/package.json`:**

```json
{
  "name": "@flowcanvas/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles/global.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint . && stylelint \"src/**/*.css\""
  },
  "dependencies": {
    "@flowcanvas/tokens": "workspace:*",
    "@fontsource-variable/inter": "catalog:",
    "@fontsource-variable/jetbrains-mono": "catalog:"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "eslint": "catalog:",
    "jsdom": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "stylelint": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

**`packages/ui/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2024", "dom", "dom.iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

**`packages/ui/vitest.config.ts`:**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
```

**`packages/ui/src/styles/global.css`:**

```css
/* Global foundation for every Flowcanvas surface. Import once per app: `import '@flowcanvas/ui/styles.css'`. */
@import '@fontsource-variable/inter';
@import '@fontsource-variable/jetbrains-mono';
@import '@flowcanvas/tokens/tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
}

body {
  background: var(--color-surface-canvas);
  color: var(--color-text-primary);
  font-family: var(--text-body-font-family);
  font-size: var(--text-body-font-size);
  font-weight: var(--text-body-font-weight);
  line-height: var(--text-body-line-height);
  letter-spacing: var(--text-body-letter-spacing);
  -webkit-font-smoothing: antialiased;
}

code,
kbd,
pre,
samp {
  font-family: var(--text-mono-font-family);
  font-size: var(--text-mono-font-size);
  line-height: var(--text-mono-line-height);
}

/* One focus style everywhere: a 2 px accent ring, offset from the element, only for keyboard focus. */
:focus-visible {
  outline: var(--border-width-focus) solid var(--color-accent-solid);
  outline-offset: var(--space-2);
}

/* "Reduce motion": every duration token becomes 0 ms, so components keep the same end states without animating. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-hover: 0ms;
    --duration-panel: 0ms;
    --duration-appear: 0ms;
    --duration-camera: 0ms;
    --duration-shimmer: 0ms;
  }
}
```

**`packages/ui/src/theme.ts`:**

```ts
import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'dark' | 'light' | 'system';

export const THEME_STORAGE_KEY = 'flowcanvas-theme';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

/** Reads the saved preference. Storage can be missing or throw (private mode, blocked site data), so fall back to "system". */
export function readThemePreference(
  storage: Pick<Storage, 'getItem'> | undefined,
): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(
  storage: Pick<Storage, 'setItem'> | undefined,
  preference: ThemePreference,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not being able to remember the choice is fine; the theme still applies for this page.
  }
}

/**
 * Applies a preference to the document. "dark"/"light" set data-theme; "system" removes it, so the
 * CSS follows prefers-color-scheme (see the generated tokens.css).
 */
export function applyThemePreference(root: HTMLElement, preference: ThemePreference): void {
  if (preference === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = preference;
  }
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** React hook: the current preference and a setter that applies and remembers it. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(browserStorage()),
  );

  useEffect(() => {
    applyThemePreference(document.documentElement, preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    saveThemePreference(browserStorage(), next);
    setPreferenceState(next);
  }, []);

  return [preference, setPreference];
}
```

**`packages/ui/src/index.ts`:**

```ts
export {
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY,
  useThemePreference,
  type ThemePreference,
} from './theme';
```

**`packages/ui/src/theme.test.ts`:**

```ts
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY,
  useThemePreference,
} from './theme';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const throwingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('readThemePreference', () => {
  it('returns a saved preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readThemePreference(localStorage)).toBe('light');
  });

  it('falls back to "system" for missing, invalid or unreadable storage', () => {
    expect(readThemePreference(localStorage)).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemePreference(localStorage)).toBe('system');
    expect(readThemePreference(throwingStorage)).toBe('system');
    expect(readThemePreference(undefined)).toBe('system');
  });
});

describe('saveThemePreference', () => {
  it('ignores storage that throws', () => {
    expect(() => {
      saveThemePreference(throwingStorage, 'dark');
    }).not.toThrow();
  });
});

describe('applyThemePreference', () => {
  it('sets data-theme for an explicit choice and removes it for "system"', () => {
    const root = document.documentElement;
    applyThemePreference(root, 'light');
    expect(root.dataset.theme).toBe('light');
    applyThemePreference(root, 'system');
    expect(root.dataset.theme).toBeUndefined();
  });
});

describe('useThemePreference', () => {
  it('applies and remembers a new preference', () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current[0]).toBe('system');

    act(() => {
      result.current[1]('dark');
    });

    expect(result.current[0]).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
```

**`apps/web`:**
- `package.json`: add `"@flowcanvas/ui": "workspace:*"` to `dependencies`.
- `src/main.tsx`: first line `import '@flowcanvas/ui/styles.css';`.
- `vite.config.ts`: add

```ts
  build: {
    // Never inline fonts as data: URLs; the Content-Security-Policy only allows fonts from our own origin.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
```

**Commands:**

```fish
pnpm install
pnpm exec turbo run build --filter=@flowcanvas/figma-tokens && pnpm --filter @flowcanvas/tokens generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build   # 13 / 13 / 12 / 7 tasks
pnpm dev                                                                # http://localhost:5173
```

**Run and check it:**
1. `pnpm dev`, open http://localhost:5173: Inter on the near-black canvas. Devtools → Elements → `<body>` shows `font-family: var(--text-body-font-family)` resolving to "Inter Variable".
2. Switch your OS (or devtools → Rendering → "Emulate CSS prefers-color-scheme: light"): the page turns light without reloading.
3. In the devtools console, run `document.documentElement.dataset.theme = 'dark'`: dark again even with the OS in light. Run `delete document.documentElement.dataset.theme`: follows the OS again.
4. **Prove the lint rule:** add `color: #ff0000;` to any `.css` file in `packages/ui/src` and run `pnpm --filter @flowcanvas/ui lint`: "Disallowed hex color". Remove it.
5. `pnpm build`, then `pnpm exec wrangler dev`: the production build under Cloudflare's runtime with the CSP. The console has no errors, and `E2E_BASE_URL=http://127.0.0.1:8787 pnpm --filter @flowcanvas/e2e test:e2e` passes.

**Gotchas:**
- **Fonts fall back to system fonts:** check the family name. Fontsource variable fonts are "Inter Variable", not "Inter".
- **"violates … font-src 'self'" in the console:** a font was inlined as `data:`; keep the `assetsInlineLimit` rule.
- **Stylelint complains about a legitimate raw value** (for example a 1 px hairline): add a token, or use a narrowly scoped `/* stylelint-disable-next-line rule -- reason */`. Never turn the rule off globally.
- **Never read `localStorage` without `try/catch`.** Some browsers throw on access when site data is blocked.

**Commit:** `feat(ui): add design-system foundation with global styles, fonts, themes and token-only CSS lint`

### Step 1a.4 — Storybook: the component catalogue

**Goal:** a component workshop where every component and token can be seen in isolation, in both themes, with accessibility checks. It builds to static files, so it can be hosted for free later (step 11).

**Expected outcome:**
- `pnpm --filter @flowcanvas/ui storybook` opens the catalogue at http://localhost:6006.
- The sidebar has **Foundations → Tokens**: every colour, the 10 text styles and the spacing scale.
- The toolbar's theme switch flips dark ↔ light.
- The **Accessibility** tab lists axe-core results.
- `pnpm exec turbo run build-storybook` writes a static catalogue to `packages/ui/storybook-static/`.

**Concepts:**
- **Storybook.**
  - A separate dev app for UI components. Each **story** is one state of one component, exported from a `*.stories.tsx` file next to the component.
  - Storybook 10 uses Vite here (`@storybook/react-vite`), so it shares our build setup.
  - It runs on its own port (6006) and never ships inside the product.
  - Docs: https://storybook.js.org/docs
- **Component Story Format (CSF).**
  - A stories file default-exports `meta` (title, component) and named-exports stories (`export const Primary: StoryObj<typeof meta> = { args: { … } }`).
  - `satisfies Meta<typeof Component>` keeps types precise while checking the shape.
  - Docs: https://storybook.js.org/docs/api/csf
- **Addons used:**
  - `@storybook/addon-docs`: docs pages from stories.
  - `@storybook/addon-a11y`: runs **axe-core** on each story and lists violations in the Accessibility tab.
  - `@storybook/addon-themes`: a toolbar switch. `withThemeByDataAttribute` sets `data-theme` on `<html>`, exactly like the app's `useThemePreference`, so stories use the real theme mechanism.

  Docs: https://storybook.js.org/docs/writing-tests/accessibility-testing and https://storybook.js.org/addons/@storybook/addon-themes
- **`.storybook/main.ts` and `.storybook/preview.ts`.**
  - `main.ts` configures Storybook itself: where stories are, addons, framework, and **`core.disableTelemetry: true`**. Storybook collects usage telemetry by default; our rule is telemetry off.
  - `preview.ts` configures how stories render: it imports our global CSS once (fonts and tokens) and adds the theme decorator.
- **Pinning to an older release.** Storybook 10.6.4 had been published about 10 hours earlier, inside pnpm's minimum-release-age window, so every Storybook package is pinned to **10.6.3** (no exemptions; ADR 0006).
- **TypeScript skips dot-folders in globs.** `"include": [".storybook"]` doesn't pick up `.storybook/*.ts`, because wildcard expansion skips names starting with `.`. typescript-eslint then reports "was not found by the project service". Fix: list the files explicitly, `".storybook/*.ts"`.
- **Never lint build output.** Building Storybook writes minified JavaScript to `storybook-static/`. Without an ignore, ESLint lints it and reports nonsense (`'setTimeout' is not defined` at column 400+). `storybook-static/` is ignored by Git, Prettier, ESLint and Stylelint.
- **A decorator applies after the first render.** In tests, wait for `document.documentElement.dataset.theme === 'light'`, not just for the story's content, before reading colours or taking screenshots.

**Finding: captions fail WCAG AA (decision needed).** axe-core reported `color-contrast` (serious) on the Foundations page's captions:
- `text/tertiary` on canvas is **4.08:1 in dark** and **3.26:1 in light**. Text needs 4.5:1, and that includes 11 px captions.
- The Graphite typography table gives captions that colour, while its own colour notes say tertiary is "not for body text".

Options:
- **A.** Captions use `text/secondary`.
- **B. (recommended)** A new `text/muted` token for captions and metadata: dark `#818995`, light `#666E7A`. Both are ≥ 4.5:1 on canvas, panel, raised and hover. Tertiary stays for icons, edges, placeholders and disabled marks, and captions on *selected* rows use secondary.
- **C.** Accept the failure (not recommended; breaks the accessibility standard).

**`pnpm-workspace.yaml`:** add to the catalog:

```yaml
  '@storybook/addon-a11y': 10.6.3
  '@storybook/addon-docs': 10.6.3
  '@storybook/addon-themes': 10.6.3
  '@storybook/react-vite': 10.6.3
  storybook: 10.6.3
```

**`packages/ui/package.json`:**
- scripts: `"storybook": "storybook dev --port 6006 --no-open"` and `"build-storybook": "storybook build --output-dir storybook-static"`
- devDependencies: the five Storybook packages as `catalog:`

**`packages/ui/tsconfig.json`:** `"include": ["src", ".storybook/*.ts", "vitest.config.ts"]`

**`turbo.json`:** add

```json
    "build-storybook": {
      "dependsOn": ["^build"],
      "outputs": ["storybook-static/**"]
    }
```

**Ignores:** `storybook-static/` added to `.gitignore`, `.prettierignore`, ESLint's `globalIgnores` and Stylelint's `ignoreFiles`.

**`packages/ui/.storybook/main.ts`:**

```ts
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: {
    // Telemetry is off by default across the project (CLAUDE.md, non-negotiable rule 5).
    disableTelemetry: true,
  },
};

export default config;
```

**`packages/ui/.storybook/preview.ts`:**

```ts
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';
import '../src/styles/global.css';

const preview: Preview = {
  decorators: [
    // The toolbar's theme switch sets data-theme on <html>, exactly like the app does.
    withThemeByDataAttribute({
      themes: { dark: 'dark', light: 'light' },
      defaultTheme: 'dark',
      attributeName: 'data-theme',
    }),
  ],
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    a11y: { test: 'error' },
  },
};

export default preview;
```

**`packages/ui/src/foundations/Foundations.stories.tsx`:**

```tsx
import { themeValues, vars } from '@flowcanvas/tokens';
import type { Meta, StoryObj } from '@storybook/react-vite';
import styles from './Foundations.module.css';

const colorNames = Object.keys(themeValues.dark).filter((name) => name.startsWith('--color-'));

const textStyles = Object.keys(vars.text) as (keyof typeof vars.text)[];

const spaceSteps = Object.keys(vars.space) as (keyof typeof vars.space)[];

function Colors() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Colour</h2>
      <p className={styles.caption}>Every colour token for the theme selected in the toolbar.</p>
      <div className={styles.swatches}>
        {colorNames.map((name) => (
          <div key={name} className={styles.swatch}>
            <span className={styles.chip} style={{ background: `var(${name})` }} />
            <span className={styles.mono}>{name.slice('--color-'.length)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Typography() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Type</h2>
      {textStyles.map((name) => {
        const style = vars.text[name];
        return (
          <div key={name} className={styles.type}>
            <span className={styles.mono}>{name}</span>
            <span
              style={{
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                letterSpacing: style.letterSpacing,
              }}
            >
              Save item · worker/process.ts:42
            </span>
          </div>
        );
      })}
    </section>
  );
}

function Spacing() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Space</h2>
      <p className={styles.caption}>4 px grid. Inside components 4–12, between groups 16–24.</p>
      {spaceSteps.map((step) => (
        <div key={step} className={styles.space}>
          <span className={styles.mono}>space-{step}</span>
          <span className={styles.bar} style={{ inlineSize: vars.space[step] }} />
        </div>
      ))}
    </section>
  );
}

function Foundations() {
  return (
    <div className={styles.page}>
      <Colors />
      <Typography />
      <Spacing />
    </div>
  );
}

const meta = {
  title: 'Foundations/Tokens',
  component: Foundations,
} satisfies Meta<typeof Foundations>;

export default meta;

export const Tokens: StoryObj<typeof meta> = {};
```

**`packages/ui/src/foundations/Foundations.module.css`:** layout for the token page, using tokens only (Stylelint-clean). Full file in the repository.

**Commands:**

```fish
pnpm install
pnpm --filter @flowcanvas/ui storybook          # http://localhost:6006
pnpm exec turbo run build-storybook             # packages/ui/storybook-static/
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

**Run and check it:**
1. Open http://localhost:6006 and choose **Foundations → Tokens**: colour swatches, the type scale, the spacing bars.
2. Toolbar → theme switch (paintbrush icon) → **light**: the story turns light. Devtools → Elements → `<html data-theme="light">`.
3. **Accessibility** tab: lists axe-core results for the story. Today it shows the caption contrast finding above until the decision is applied.
4. `pnpm exec turbo run build-storybook`, then serve `packages/ui/storybook-static` with any static server (for example `python3 -m http.server 6006` inside that folder): the same catalogue as static files.

**Gotchas:**
- **"was not found by the project service" for `.storybook/*.ts`:** list the files explicitly in `include`.
- **Lint errors in minified code:** something is linting `storybook-static/`; check the ignores.
- **Theme toolbar does nothing:** `withThemeByDataAttribute` must be in `preview.ts` `decorators`, and the global CSS must be imported there.
- **Node 26 prints `DEP0205 module.register() is deprecated` during Storybook builds:** a harmless deprecation warning from Storybook's loader; it's not ours.

**Commit:** `feat(ui): add Storybook catalogue with themes, accessibility checks and token foundations`

**Done notes (step 1a.4):**
- Caption decision: **option B** (owner, 27 Oct 2026). New token `color.text.muted`: dark `#818995`, light `#666E7A`. Used for captions, section labels and metadata; `text.tertiary` is now non-text only (icons, edges, placeholders, disabled marks). Selected rows use `text.secondary` for metadata.
- Token tests: 37 (4 new `text-muted` contrast checks per theme). axe-core on Foundations → Tokens: **0 violations** in dark and light.
- Commits: `5d4aa21` (token), `389286c` (Storybook).

### Step 1a.5 — Button and Tag

**Goal:** the first two real components, matching the Figma component sets:
- **Button:** Kind = Primary, Secondary, Ghost, Danger.
- **Tag:** Tone = Added, Modified, Removed, Affected, Scope, Neutral, Accent.

Each has all its variants and states, token-only CSS, unit tests and Storybook stories, and is accessible in both themes.

**Expected outcome:**
- Storybook shows **Components → Button** (Primary, Secondary, Ghost, Danger, All kinds) and **Components → Tag** (Default, All tones).
- Every control works (kind, size, disabled, tone).
- The Accessibility tab is clean in dark and light.
- `pnpm test` adds 10 `ui` tests (15 total in the package) and 4 token contrast checks.

**Concepts:**
- **Variants as data attributes.**
  - Components set `data-kind="primary"` / `data-size="sm"` / `data-tone="added"`, and the CSS selects on them (`.button[data-kind='primary']`).
  - CSS Module class names are hashed (`_button_x7a2`), so tests can't rely on them, while data attributes are stable.
  - That makes them a clean contract for styling, tests (`button.dataset.kind`) and devtools. The alternative, one class per variant, works too but needs a lookup map.
- **Extending native element props.**
  - `interface ButtonProps extends ComponentPropsWithRef<'button'>` means `Button` accepts everything a `<button>` does (`onClick`, `disabled`, `aria-*`, `ref`…) plus our `kind` and `size`.
  - In React 19, `ref` is a normal prop, so no `forwardRef` is needed.
  - Docs: https://react.dev/reference/react/forwardRef (React 19 note) and https://react-typescript-cheatsheet.netlify.app/docs/advanced/patterns_by_usecase/#wrappingmirroring
- **`type="button"` by default.** A bare `<button>` inside a form *submits* it. Almost every button in a tool UI is an action, not a submit, so the component defaults to `type="button"` and you opt in with `type="submit"`.
- **Primary is the inverse surface,** never blue: off-white with dark text in dark, near-black with off-white text in light. **One primary per view** (Graphite).
- **States:**
  - **Hover** changes only background, border and text colour, in 80 ms (`--duration-hover`), which becomes instant under reduced motion.
  - Primary and danger hovers use **`color-mix()`**, blending two tokens in CSS, so hover colours stay derived from tokens rather than new hex values. Docs: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix
  - **Focus** uses the global `:focus-visible` ring from step 3.
  - **Disabled** uses `cursor: not-allowed` plus a new token `opacity.disabled` (0.5). WCAG exempts disabled controls from contrast.
- **Contrast checked before coding.** Every new pair was computed first and passes AA in both themes:
  - primary hover 12.4 / 10.8
  - danger rest 7.3 / 7.1, danger hover 5.6 / 5.5
  - ghost hover text 13.9 / 15.5
  - neutral tag 6.8 / 5.2, accent tag 8.1 / 6.5

  The pairs that are plain tokens (`text-primary` and `text-secondary` on `surface-hover`, `accent-text` on `accent-tint`) are now in the token contrast tests; the `color-mix()` hovers were checked by hand.
- **Off-grid values from Figma, kept honest.** Figma's button has 10 px side padding and the tag 1 px / 6 px. The spacing scale has no 10, 1 or 6, so the CSS writes `calc(var(--space-8) + var(--space-2))` and similar. It's still tokens only (Stylelint passes), and still exactly what Figma shows.
- **State never by colour alone.** Tags always carry their state in text (`+ added`, `~ modified`, `− removed`, `affected`, `outside selection`), so they read in greyscale and for colour-blind users. Accessibility rule from Graphite.
- **Behaviour tests with Testing Library.**
  - `getByRole('button', { name: 'Accept' })` finds the button the way assistive technology does.
  - `fireEvent.click` simulates a click; `vi.fn()` is a mock function that records calls (`toHaveBeenCalledOnce()`).
  - A disabled button must **not** call `onClick`.
  - `createRef` proves `ref` reaches the real `<button>`.

  Docs: https://vitest.dev/api/vi.html#vi-fn and https://testing-library.com/docs/dom-testing-library/api-events
- **`classNames()` helper.** Joins class names and skips empty values. CSS Module lookups are typed `string | undefined` under `noUncheckedIndexedAccess`, so plain string concatenation could produce `"undefined"`.

**Files:**

**`packages/ui/src/components/button/Button.tsx`:**

```tsx
import type { ComponentPropsWithRef } from 'react';
import { classNames } from '../../class-names';
import styles from './Button.module.css';

/** Primary is the single strongest action in a view; use it at most once per view. */
export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

/** `sm` (28 px) is the default control height; `md` (32 px) is for roomier forms and dialogs. */
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly kind?: ButtonKind;
  readonly size?: ButtonSize;
}

export function Button({
  kind = 'secondary',
  size = 'sm',
  // A bare <button> submits its form; most buttons in a tool UI aren't submit buttons.
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classNames(styles.button, className)}
      data-kind={kind}
      data-size={size}
    />
  );
}
```

**`packages/ui/src/components/button/Button.module.css`:**

```css
.button {
  display: inline-flex;
  gap: var(--space-4);
  align-items: center;
  justify-content: center;
  block-size: var(--size-control-sm);
  padding: 0 calc(var(--space-8) + var(--space-2));
  border: var(--border-width-default) solid transparent;
  border-radius: var(--radius-control);
  font-family: var(--text-small-strong-font-family);
  font-size: var(--text-small-strong-font-size);
  font-weight: var(--text-small-strong-font-weight);
  line-height: var(--text-small-strong-line-height);
  letter-spacing: var(--text-small-strong-letter-spacing);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--duration-hover) ease-out,
    border-color var(--duration-hover) ease-out,
    color var(--duration-hover) ease-out;
}

.button[data-size='md'] {
  block-size: var(--size-control-md);
  padding-inline: var(--space-12);
}

/* Primary: the inverse surface (off-white in dark, near-black in light). Never blue. */
.button[data-kind='primary'] {
  background: var(--color-surface-inverse);
  color: var(--color-text-on-accent);
}

.button[data-kind='primary']:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-surface-inverse) 88%, var(--color-surface-canvas));
}

.button[data-kind='secondary'] {
  background: var(--color-surface-raised);
  border-color: var(--color-border-control);
  color: var(--color-text-primary);
}

.button[data-kind='secondary']:hover:not(:disabled) {
  background: var(--color-surface-hover);
  border-color: var(--color-border-strong);
}

.button[data-kind='ghost'] {
  background: transparent;
  color: var(--color-text-secondary);
}

.button[data-kind='ghost']:hover:not(:disabled) {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.button[data-kind='danger'] {
  background: var(--color-state-removed-tint);
  color: var(--color-state-removed-text);
}

.button[data-kind='danger']:hover:not(:disabled) {
  background: color-mix(
    in srgb,
    var(--color-state-removed-tint) 80%,
    var(--color-state-removed-solid)
  );
}

.button:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}
```

**`packages/ui/src/components/tag/Tag.tsx`:**

```tsx
import type { ComponentPropsWithRef } from 'react';
import { classNames } from '../../class-names';
import styles from './Tag.module.css';

/**
 * Change states (added … scope) use their muted hue; neutral and accent are for non-state labels.
 * The label text must always say the state too ("+ added"), so meaning never depends on colour alone.
 */
export type TagTone =
  'added' | 'modified' | 'removed' | 'affected' | 'scope' | 'neutral' | 'accent';

export interface TagProps extends ComponentPropsWithRef<'span'> {
  readonly tone?: TagTone;
}

export function Tag({ tone = 'neutral', className, ...rest }: TagProps) {
  return <span {...rest} className={classNames(styles.tag, className)} data-tone={tone} />;
}
```

**`packages/ui/src/components/tag/Tag.module.css`:**

```css
/* Figma Tag: 1 px / 6 px padding, 4 px radius, Caption text, tint background with same-hue text. */
.tag {
  display: inline-flex;
  align-items: center;
  padding: calc(var(--space-2) / 2) calc(var(--space-4) + var(--space-2));
  border-radius: var(--radius-control);
  font-family: var(--text-caption-font-family);
  font-size: var(--text-caption-font-size);
  font-weight: var(--text-caption-font-weight);
  line-height: var(--text-caption-line-height);
  letter-spacing: var(--text-caption-letter-spacing);
  white-space: nowrap;
}

.tag[data-tone='added'] {
  background: var(--color-state-added-tint);
  color: var(--color-state-added-text);
}

.tag[data-tone='modified'] {
  background: var(--color-state-modified-tint);
  color: var(--color-state-modified-text);
}

.tag[data-tone='removed'] {
  background: var(--color-state-removed-tint);
  color: var(--color-state-removed-text);
}

.tag[data-tone='affected'] {
  background: var(--color-state-affected-tint);
  color: var(--color-state-affected-text);
}

.tag[data-tone='scope'] {
  background: var(--color-state-scope-tint);
  color: var(--color-state-scope-text);
}

.tag[data-tone='neutral'] {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
}

.tag[data-tone='accent'] {
  background: var(--color-accent-tint);
  color: var(--color-accent-text);
}
```

**`packages/ui/src/class-names.ts`:**

```ts
/** Joins class names, skipping empty values (CSS Module lookups are typed `string | undefined`). */
export function classNames(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}
```

**Tests and stories:**
- `packages/ui/src/components/button/Button.test.tsx`, 5 tests:
  - default secondary/sm/`type="button"`
  - kind, size and submit type
  - `onClick` fires
  - disabled doesn't fire
  - extra `className` kept and `ref` forwarded
- `packages/ui/src/components/tag/Tag.test.tsx`, 3 tests: default neutral tone; change-state tone; attributes such as `title` pass through.
- `packages/ui/src/class-names.test.ts`, 2 tests.
- `Button.stories.tsx`: Primary, Secondary, Ghost, Danger (with controls), and All kinds (both sizes plus disabled).
- `Tag.stories.tsx`: Default (with a tone control) and All tones with the labels used across the Figma screens.
- `packages/ui/src/index.ts` exports `Button`, `Tag` and their types.

Full files are in the repository.

**Tokens:**
- `packages/tokens/source/base.tokens.json`: add `opacity.disabled` = 0.5, then `generate`.
- `packages/tokens/src/tokens.test.ts`: add `text-primary`/`surface-hover`, `text-secondary`/`surface-hover` and `accent-text`/`accent-tint` to the 4.5:1 list.

**Commands:**

```fish
pnpm --filter @flowcanvas/tokens generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test   # ui: 15 passed, tokens: 43 passed
pnpm --filter @flowcanvas/ui storybook                    # http://localhost:6006
```

**Run and check it:**
1. Storybook → **Components → Button → All kinds**: four kinds at 28 px, the same at 32 px, then disabled. Hover each one; Tab through them to see the focus ring.
2. **Primary**: use Controls to change `kind`, `size` and `disabled` and watch the button update.
3. **Components → Tag → All tones**: seven tags with their labels.
4. Toolbar → light theme: the primary button turns near-black, the tags turn into pale washes.
5. **Accessibility** tab on each story: no violations (verified with axe-core in both themes).

**Gotchas:**
- **Forgetting `type="button"` on a plain `<button>` inside a form** makes it submit the form. Use the component, or set the type.
- **Don't pick a hover colour with a new hex value.** Derive it with `color-mix()` from tokens, and check its contrast.
- **A Tag without state text** (just a coloured dot) breaks the "never colour alone" rule.
- **Testing CSS Module class names** breaks when hashes change. Test data attributes and behaviour instead.

**Commit:** `feat(ui): add Button and Tag components with stories and tests`

### Step 1a.6 — Input and Toggle

**Goal:** two form controls that exist in Figma only inside screens: **Input**, from the clone dialog, filters and the secret input; and **Toggle**, from the settings screen. Both are fully accessible: labelled, keyboard-operable, AA contrast in both themes.

**Expected outcome:**
- Storybook shows **Components → Input** (Default, Mono, Invalid, Disabled, In context) and **Components → Toggle** (Off, On, Disabled, Settings rows).
- Tab moves focus between them; Space flips a toggle.
- The Accessibility tab is clean in both themes.
- `ui` tests: 27 (12 new); token tests: 49.

**Concepts:**
- **Sources and conflicts.** Neither control is a Figma *component*, so the references are the screens (clone dialog, settings) plus Graphite's component table.
  - **Radius:** the screens draw inputs at 4 px, Graphite says "6 for nodes and inputs". Graphite ranks above screens (CLAUDE.md §2), so inputs use `--radius-node` (6 px).
- **Input is a field wrapper plus a real `<input>`.**
  - The visible box (border, fill, focus halo) is a `<span>` around a borderless `<input>`, so icons and keyboard hints can sit *inside* the box (`leading` / `trailing`).
  - The wrapper reacts with **`:focus-within`** (true when anything inside has focus): accent border plus a 2 px `accent-tint` halo (new token `border.width.halo`).
  - The inner input turns off its own outline, so focus isn't drawn twice.
  - Docs: https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-within
- **`controlSize` instead of `size`.** `<input size>` is a native attribute (width in characters). Omitting it from the props (`Omit<…, 'size'>`) and naming ours `controlSize` avoids a type clash and confusion.
- **Labels are mandatory.** An input needs an accessible name: a `<label htmlFor>`, a wrapping `<label>`, `aria-label` or `aria-labelledby`. Tests find inputs with `getByRole('textbox', { name: 'Repository URL' })`, which fails if the label is missing. That makes the test an accessibility check too.
- **`aria-invalid`.** `invalid` sets `aria-invalid="true"`, so screen readers announce the error, and shows a `state-removed` border. Colour isn't the only signal: an error message must accompany it in real forms.
- **Placeholders are text.** They use `text/muted` (≥ 4.5:1), never tertiary. Browsers dim placeholders by default (`opacity` < 1), so `::placeholder { opacity: 1 }` keeps the token's exact contrast.
- **Toggle = `<button role="switch" aria-checked>`.**
  - A native button gives focus, Space/Enter and disabled for free.
  - `role="switch"` plus `aria-checked` makes screen readers announce "switch, on/off".
  - It's named with `aria-label` or `aria-labelledby` (the settings row's title).
  - Docs: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/switch_role
- **Controlled vs uncontrolled.**
  - Pass `checked` + `onCheckedChange`, and the parent owns the state (the toggle only *asks* to change).
  - Pass `defaultChecked` (or nothing), and the toggle keeps its own state.
  - That's the same pattern as React's `<input value>` vs `<input defaultValue>`. A test proves a controlled toggle does **not** change unless the parent updates `checked`.
  - Docs: https://react.dev/learn/sharing-state-between-components#controlled-and-uncontrolled-components
- **Contrast fixes against the Figma drawing.**
  - The off knob (it carries the state) is 3.0:1 / 2.75:1 against its track with tertiary, below the 3:1 non-text minimum. It uses `text/secondary` (6.2 / 4.9).
  - The on state already passes (5.4 / 5.8).
  - Position also differs, so state isn't shown by colour alone.
- **New tokens:**
  - `size.toggle.width` 28, `size.toggle.height` 16, `size.toggle.knob` 12
  - `border.width.halo` 2
  - Round shapes use the element's own size as radius (`border-radius: var(--size-toggle-knob)`), since Stylelint forbids raw units including `%`.
- **React renders `data-x={true}` as `data-x="true"`,** not an empty attribute. Tests expect `'true'`; the CSS selector `[data-invalid]` matches either way. (Two first-run test failures came from expecting `''`.)
- **TS2883 "inferred type cannot be named".** An inline decorator in a stories file made the inferred type of `meta` refer to a Storybook-internal type. Fix: annotate explicitly (`const meta: Meta<typeof Input> = …`).
- **Real-browser checks that jsdom can't do:**
  - Tab really focuses the switch, and the focus outline shows.
  - Space really toggles it (`aria-checked` false → true).
  - The focus halo appears on the input.

  These become part of the automated visual and interaction tests in step 10.

**Open question for the owner:** the input border (`border/control`) is **1.6:1** against the input fill (dark and light). WCAG 1.4.11 asks 3:1 for the visual boundary that identifies a control. `border/strong` gives about 2.2:1; `text/tertiary` as a border colour would pass (3.6 / 3.35) but is louder than the Figma look.

**Files:**

**`packages/ui/src/components/input/Input.tsx`:**

```tsx
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { classNames } from '../../class-names';
import styles from './Input.module.css';

/** `md` (32 px) is the default field height; `sm` (28 px) fits filters and dense toolbars. */
export type InputSize = 'sm' | 'md';

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** Named `controlSize` because `size` is already a native <input> attribute (a character count). */
  readonly controlSize?: InputSize;
  /** JetBrains Mono, for values a developer might copy: URLs, paths, branch names, secrets. */
  readonly mono?: boolean;
  /** Marks the value as invalid for assistive technology (aria-invalid) and shows the error border. */
  readonly invalid?: boolean;
  /** Decorative content before the text, usually a 14 px icon. */
  readonly leading?: ReactNode;
  /** Content after the text: an icon, a keyboard hint, a reveal button. */
  readonly trailing?: ReactNode;
}

export function Input({
  controlSize = 'md',
  mono = false,
  invalid = false,
  leading,
  trailing,
  className,
  ...rest
}: InputProps) {
  return (
    <span
      className={classNames(styles.field, className)}
      data-size={controlSize}
      data-mono={mono || undefined}
      data-invalid={invalid || undefined}
      data-disabled={rest.disabled === true || undefined}
    >
      {leading !== undefined && (
        <span className={styles.adornment} aria-hidden="true">
          {leading}
        </span>
      )}
      <input {...rest} className={styles.input} aria-invalid={invalid || undefined} />
      {trailing !== undefined && <span className={styles.adornment}>{trailing}</span>}
    </span>
  );
}
```

**`packages/ui/src/components/input/Input.module.css`:**

```css
/* Graphite input: raised fill, control border, 6 px radius (Graphite "nodes and inputs"; the Figma screens draw 4 px). */
.field {
  display: inline-flex;
  gap: var(--space-8);
  align-items: center;
  inline-size: 100%;
  block-size: var(--size-control-md);
  padding: 0 calc(var(--space-8) + var(--space-2));
  border: var(--border-width-default) solid var(--color-border-control);
  border-radius: var(--radius-node);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  transition:
    border-color var(--duration-hover) ease-out,
    box-shadow var(--duration-hover) ease-out;
}

.field[data-size='sm'] {
  block-size: var(--size-control-sm);
}

.field:hover {
  border-color: var(--color-border-strong);
}

/* Focus: accent border plus a 2 px accent-tint halo (Graphite input "selected / focused"). */
.field:focus-within {
  border-color: var(--color-accent-solid);
  box-shadow: 0 0 0 var(--border-width-halo) var(--color-accent-tint);
}

.field[data-invalid] {
  border-color: var(--color-state-removed-solid);
}

.field[data-disabled] {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.input {
  flex: 1;
  min-inline-size: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: var(--text-small-font-family);
  font-size: var(--text-small-font-size);
  font-weight: var(--text-small-font-weight);
  line-height: var(--text-small-line-height);
  letter-spacing: var(--text-small-letter-spacing);
}

.field[data-mono] .input {
  font-family: var(--text-mono-small-font-family);
  font-size: var(--text-mono-small-font-size);
  line-height: var(--text-mono-small-line-height);
}

/* The field draws the focus state, so the inner input doesn't add the global outline. */
.input:focus-visible {
  outline: none;
}

.input:disabled {
  cursor: not-allowed;
}

/* Placeholders are text, so they use text/muted (4.5:1), not tertiary. */
.input::placeholder {
  color: var(--color-text-muted);
  opacity: 1;
}

.adornment {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--color-text-tertiary);
}
```

**`packages/ui/src/components/toggle/Toggle.tsx`:**

```tsx
import { useState, type ComponentPropsWithRef } from 'react';
import { classNames } from '../../class-names';
import styles from './Toggle.module.css';

export interface ToggleProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'onChange' | 'role' | 'type' | 'value'
> {
  /** Controlled state. Leave undefined to let the toggle manage its own state from `defaultChecked`. */
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
}

/**
 * An on/off switch. Renders a <button role="switch"> so Space and Enter work natively and screen
 * readers announce "on"/"off". Give it a name with `aria-label` or `aria-labelledby`.
 */
export function Toggle({
  checked,
  defaultChecked = false,
  onCheckedChange,
  onClick,
  className,
  ...rest
}: ToggleProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const isOn = isControlled ? checked : uncontrolled;

  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={isOn}
      className={classNames(styles.toggle, className)}
      data-state={isOn ? 'on' : 'off'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        if (!isControlled) {
          setUncontrolled(!isOn);
        }
        onCheckedChange?.(!isOn);
      }}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  );
}
```

**`packages/ui/src/components/toggle/Toggle.module.css`:**

```css
/* Figma settings toggle: 28 × 16 track, 2 px padding, 12 px knob, fully rounded. */
.toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  inline-size: var(--size-toggle-width);
  block-size: var(--size-toggle-height);
  padding: var(--space-2);
  border: 0;
  border-radius: var(--size-toggle-height);
  background: var(--color-surface-selected);
  cursor: pointer;
  transition: background-color var(--duration-panel) ease-out;
}

.knob {
  inline-size: var(--size-toggle-knob);
  block-size: var(--size-toggle-knob);
  border-radius: var(--size-toggle-knob);

  /* Off knob uses text/secondary (Figma: tertiary) so the knob, which shows the state, has ≥ 3:1 against the track. */
  background: var(--color-text-secondary);
  transition:
    transform var(--duration-panel) ease-out,
    background-color var(--duration-panel) ease-out;
}

.toggle[data-state='on'] {
  background: var(--color-accent-solid);
}

.toggle[data-state='on'] .knob {
  background: var(--color-text-on-accent);
  transform: translateX(
    calc(var(--size-toggle-width) - var(--size-toggle-knob) - 2 * var(--space-2))
  );
}

.toggle:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}
```

**Tests and stories:**
- `input/Input.test.tsx`, 6 tests:
  - named by its label
  - change events
  - invalid sets `aria-invalid` and the style hook
  - valid has no `aria-invalid`
  - leading and trailing slots (leading hidden from assistive tech)
  - size, mono and ref forwarding
- `toggle/Toggle.test.tsx`, 6 tests:
  - switch, off by default
  - uncontrolled flips and reports
  - controlled waits for the parent
  - works with parent state
  - disabled does nothing
  - `onClick` can cancel with `preventDefault()`
- `Input.stories.tsx`: Default, Mono, Invalid, Disabled, In context (clone dialog fields, filter with `/` hint, secret input).
- `Toggle.stories.tsx`: Off, On, Disabled, Settings rows (Privacy and runtime, cloud-first wording).
- `packages/ui/src/index.ts` exports `Input`, `Toggle` and their types.
- Tokens: `size.toggle.*` and `border.width.halo` in `base.tokens.json`. The token tests add `text-secondary`/`surface-selected` (4.5:1) and `text-on-accent`/`accent-solid` and `accent-solid`/`surface-panel` (3:1).

**Commands:**

```fish
pnpm --filter @flowcanvas/tokens generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test   # ui: 27, tokens: 49
pnpm --filter @flowcanvas/ui storybook
```

**Run and check it:**
1. **Components → Input → In context:** the clone-dialog fields in JetBrains Mono, a filter with a `/` hint, a masked secret field. Click a field to see the accent border and halo.
2. **Invalid:** the clay border. In devtools, the `<input>` has `aria-invalid="true"`.
3. **Components → Toggle → Settings rows:** click a toggle. Then Tab to one and press Space: it flips, and the focus ring is visible.
4. Switch to light theme and repeat. Accessibility tab: no violations.

**Gotchas:**
- **Every Input needs a name** (label or `aria-label`). `getByRole('textbox', { name })` in tests catches a missing one.
- **Don't build a toggle from a `<div>` with `onClick`.** You lose keyboard support, focus and the screen-reader role. Use the component.
- **A controlled toggle without `onCheckedChange` updating the state looks frozen.** That's by design.
- **`border-radius: 50%` fails Stylelint.** Use the element's size token.

**Commit:** `feat(ui): add Input and Toggle components with stories and tests`

### Step 1a.7 — Tabs and Panel

**Goal:**
- **Tabs:** the inspector tab bar (underline) and the review-bar tabs (pills with count tags), with the full WAI-ARIA keyboard pattern.
- **Panel:** the side-panel container used by the entry-points list, files, source control and settings.

**Expected outcome:**
- Storybook shows **Components → Tabs** (Underline: Details · Runs 12 · Changes 1 · Calls; Pill: Changed 3 · Affected 2 · Tests 3/4 · Observed 5 · Unverified 1).
- It also shows **Components → Panel → Entry points**, matching the Figma left panel.
- Arrow keys, Home and End move between tabs; Tab moves into the panel content.
- `ui` tests: 39 (12 new). axe is clean in both themes.

**Concepts:**
- **The WAI-ARIA tabs pattern.**
  - Roles `tablist` > `tab` (with `aria-selected`, `aria-controls`) and a `tabpanel` (with `aria-labelledby` pointing at its tab).
  - Keyboard: **Left/Right** move between tabs and wrap at the ends; **Home/End** jump to the first or last tab.
  - **Automatic activation:** moving focus also selects. Simple and fine when panels render instantly. (*Manual activation*, select on Enter, is for slow panels.)
  - Docs: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- **Roving tabindex.**
  - Only the selected tab has `tabIndex={0}`; the others have `-1`. Pressing Tab enters the tab list once (on the selected tab) and leaves it with the next Tab; arrows move *within* it.
  - Without this, a keyboard user would have to Tab through every tab.
  - Docs: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_roving_tabindex
- **A focusable tab panel.** The panel has `tabIndex={0}`, so the next Tab after the tab list lands in the content, which can then be scrolled with the keyboard.
  - Found in a real-browser test: before the fix, Tab skipped straight to `<body>`.
  - A unit test now guards it.
- **Moving focus from code.**
  - The component keeps a `Map` of tab elements via **callback refs** (`ref={(el) => …}` is called with the element on mount and `null` on unmount) and calls `.focus()` on the target tab.
  - `useId()` makes unique, SSR-safe ids for `aria-controls` / `aria-labelledby`, so two Tabs on one page never clash.
  - Docs: https://react.dev/reference/react/useId and https://react.dev/learn/manipulating-the-dom-with-refs#how-to-manage-a-list-of-refs-using-a-ref-callback
- **Controlled or uncontrolled** (same pattern as Toggle): `value` + `onValueChange`, or `defaultValue`. `onValueChange` only fires when the selection actually changes.
- **Two looks, one behaviour.**
  - `variant="underline"`: 16 px apart, a hairline under the row, and a 2 px accent bar under the selected tab, drawn with `::after` (absolutely positioned, so it sits on top of the hairline).
  - `variant="pill"`: the selected tab gets `surface-selected`, and counts become `Tag`s in the state's colours (Graphite: "count tag in the state's colours").
- **Panel = one edge, no boxes.**
  - Graphite: panels are `surface-panel` with **one** 1 px subtle edge *toward the canvas* (`edge="end"` for a left panel, `"start"` for a right one), no shadow.
  - Sections are separated by spacing and an 11 px sentence-case label in `text/muted`, never by borders or cards ("fewer boxes").
- **Landmarks and groups.**
  - `<section aria-labelledby>` with an `<h2>` title makes each panel a named **region** landmark, so screen-reader users can jump between panels.
  - Each `PanelSection` is a `role="group"` named by its label.
  - Tests find them with `getByRole('region', { name: 'Entry points' })` and `getByRole('group', { name: 'Screens' })`.
- **No `as` casts or `!` in tests.**
  - `document.activeElement as Element` fails lint (`non-nullable-type-assertion-style`), and `!` is forbidden by the strict rules.
  - A small `focused()` helper checks for `null` and throws a clear error instead, which is better than either shortcut because a failure explains itself.

**Files:**

**`packages/ui/src/components/tabs/Tabs.tsx`:**

```tsx
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { classNames } from '../../class-names';
import { Tag, type TagTone } from '../tag/Tag';
import styles from './Tabs.module.css';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  /** Shown after the label: plain muted text (underline tabs) or a tag (pill tabs). */
  readonly count?: number | string;
  /** Pill tabs only: the tag tone for the count, e.g. "modified" for "Changed 3". */
  readonly countTone?: TagTone;
}

/** `underline`: inspector and panel tabs. `pill`: review-bar tabs with count tags. */
export type TabsVariant = 'underline' | 'pill';

export interface TabsProps {
  readonly items: readonly TabItem[];
  /** Controlled selection. Leave undefined to let Tabs manage it from `defaultValue`. */
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (id: string) => void;
  readonly variant?: TabsVariant;
  /** Names the tab list for assistive technology, e.g. "Inspector". */
  readonly 'aria-label': string;
  /** Renders the content for the selected tab inside a tabpanel. Omit if the content lives elsewhere. */
  readonly renderPanel?: (id: string) => ReactNode;
  readonly className?: string;
}

/**
 * WAI-ARIA tabs with automatic activation: arrow keys move focus and selection together,
 * Home/End jump to the ends, and only the selected tab is in the Tab order ("roving tabindex").
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = 'underline',
  'aria-label': ariaLabel,
  renderPanel,
  className,
}: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? items[0]?.id);
  const selected = value ?? uncontrolled;

  const select = (id: string) => {
    if (value === undefined) {
      setUncontrolled(id);
    }
    if (id !== selected) {
      onValueChange?.(id);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    const item = target === undefined ? undefined : items[target];
    if (item === undefined) {
      return;
    }
    event.preventDefault();
    select(item.id);
    tabRefs.current.get(item.id)?.focus();
  };

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-panel`;

  return (
    <div className={className}>
      <div role="tablist" aria-label={ariaLabel} className={styles.list} data-variant={variant}>
        {items.map((item, index) => {
          const isSelected = item.id === selected;
          return (
            <button
              key={item.id}
              ref={(element) => {
                if (element) {
                  tabRefs.current.set(item.id, element);
                } else {
                  tabRefs.current.delete(item.id);
                }
              }}
              id={tabId(item.id)}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={renderPanel && isSelected ? panelId : undefined}
              tabIndex={isSelected ? 0 : -1}
              className={styles.tab}
              onClick={() => {
                select(item.id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
            >
              <span>{item.label}</span>
              {item.count !== undefined &&
                (variant === 'pill' ? (
                  <Tag tone={item.countTone ?? 'neutral'}>{item.count}</Tag>
                ) : (
                  <span className={styles.count}>{item.count}</span>
                ))}
            </button>
          );
        })}
      </div>
      {renderPanel && selected !== undefined && (
        <div
          role="tabpanel"
          id={panelId}
          // Focusable so Tab moves from the tab list into the content (WAI-ARIA tabs pattern).
          tabIndex={0}
          aria-labelledby={tabId(selected)}
          className={classNames(styles.panel)}
        >
          {renderPanel(selected)}
        </div>
      )}
    </div>
  );
}
```

**`packages/ui/src/components/tabs/Tabs.module.css`:**

```css
.list {
  display: flex;
  align-items: center;
}

/* Underline (inspector, panels): 16 px apart, a hairline under the row, 2 px accent under the selected tab. */
.list[data-variant='underline'] {
  gap: var(--space-16);
  border-block-end: var(--border-width-default) solid var(--color-border-subtle);
}

/* Pill (review bar): compact, the selected tab gets the selected surface. */
.list[data-variant='pill'] {
  gap: var(--space-4);
}

.tab {
  position: relative;
  display: inline-flex;
  gap: var(--space-4);
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: var(--text-small-font-family);
  font-size: var(--text-small-font-size);
  font-weight: var(--text-small-font-weight);
  line-height: var(--text-small-line-height);
  letter-spacing: var(--text-small-letter-spacing);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--duration-hover) ease-out,
    background-color var(--duration-hover) ease-out;
}

.tab:hover {
  color: var(--color-text-primary);
}

.tab[aria-selected='true'] {
  color: var(--color-text-primary);
  font-weight: var(--text-small-strong-font-weight);
}

.list[data-variant='underline'] .tab {
  padding-block: 0 calc(var(--space-8) - var(--border-width-default));
}

.list[data-variant='underline'] .tab[aria-selected='true']::after {
  position: absolute;
  inset: auto 0 calc(-1 * var(--border-width-default));
  block-size: var(--border-width-state-bar);
  background: var(--color-accent-solid);
  content: '';
}

.list[data-variant='pill'] .tab {
  padding: var(--space-4) calc(var(--space-8) + var(--space-2));
  border-radius: var(--radius-control);
}

.list[data-variant='pill'] .tab:hover {
  background: var(--color-surface-hover);
}

.list[data-variant='pill'] .tab[aria-selected='true'] {
  background: var(--color-surface-selected);
}

.count {
  color: var(--color-text-muted);
  font-weight: var(--text-small-font-weight);
}

.panel {
  padding-block-start: var(--space-12);
}
```

**`packages/ui/src/components/panel/Panel.tsx`:**

```tsx
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { classNames } from '../../class-names';
import styles from './Panel.module.css';

/** Which side faces the canvas: the only side with a border (Graphite: "1 px edge toward the canvas only"). */
export type PanelEdge = 'start' | 'end' | 'top' | 'bottom' | 'none';

export interface PanelProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  readonly title: string;
  /** Short text on the right of the header, e.g. a count ("26") or a project name. */
  readonly meta?: ReactNode;
  readonly edge?: PanelEdge;
}

/** A side panel: panel surface, a header naming it, and content arranged in sections. */
export function Panel({ title, meta, edge = 'end', className, children, ...rest }: PanelProps) {
  const titleId = useId();
  return (
    <section
      {...rest}
      aria-labelledby={titleId}
      className={classNames(styles.panel, className)}
      data-edge={edge}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

export interface PanelSectionProps extends ComponentPropsWithRef<'div'> {
  readonly label: string;
  readonly count?: number | string;
}

/**
 * A group inside a panel, introduced by an 11 px sentence-case label. Groups are separated by
 * spacing, not borders or cards (Graphite: "fewer boxes").
 */
export function PanelSection({ label, count, className, children, ...rest }: PanelSectionProps) {
  const labelId = useId();
  return (
    <div
      {...rest}
      role="group"
      aria-labelledby={labelId}
      className={classNames(styles.section, className)}
    >
      <div className={styles.sectionHeader}>
        <span id={labelId}>{label}</span>
        {count !== undefined && <span>{count}</span>}
      </div>
      {children}
    </div>
  );
}
```

**`packages/ui/src/components/panel/Panel.module.css`:**

```css
/* Graphite panel: panel surface, one 1 px subtle edge toward the canvas, no shadow. */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: calc(var(--space-8) + var(--space-2)) var(--space-8) var(--space-12);
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
}

.panel[data-edge='start'] {
  border-inline-start: var(--border-width-default) solid var(--color-border-subtle);
}

.panel[data-edge='end'] {
  border-inline-end: var(--border-width-default) solid var(--color-border-subtle);
}

.panel[data-edge='top'] {
  border-block-start: var(--border-width-default) solid var(--color-border-subtle);
}

.panel[data-edge='bottom'] {
  border-block-end: var(--border-width-default) solid var(--color-border-subtle);
}

.header {
  display: flex;
  gap: var(--space-8);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-8) var(--space-8);
}

.title {
  margin: 0;
  font-family: var(--text-small-strong-font-family);
  font-size: var(--text-small-strong-font-size);
  font-weight: var(--text-small-strong-font-weight);
  line-height: var(--text-small-strong-line-height);
  letter-spacing: var(--text-small-strong-letter-spacing);
}

.meta,
.sectionHeader {
  color: var(--color-text-muted);
  font-family: var(--text-caption-font-family);
  font-size: var(--text-caption-font-size);
  font-weight: var(--text-caption-font-weight);
  line-height: var(--text-caption-line-height);
  letter-spacing: var(--text-caption-letter-spacing);
}

.section {
  display: flex;
  flex-direction: column;
}

.sectionHeader {
  display: flex;
  justify-content: space-between;
  padding: var(--space-12) var(--space-8) var(--space-4);
}
```

**Tests and stories:**
- `tabs/Tabs.test.tsx`, 9 tests:
  - first tab selected with its panel
  - roving tabindex
  - click selects and reports
  - arrows move and wrap
  - Home/End
  - focusable panel
  - counts after labels
  - controlled
  - no report on re-clicking the selected tab
- `panel/Panel.test.tsx`, 3 tests: named region with meta; edge (default `end`, and `start`); labelled sections with counts.
- `Tabs.stories.tsx`: Underline (inspector, with panel content), Pill (review bar).
- `Panel.stories.tsx`: Entry points (mock content, catalogue only).
- `packages/ui/src/index.ts` exports `Tabs`, `Panel`, `PanelSection` and their types.

**Commands:**

```fish
pnpm format && pnpm lint && pnpm typecheck && pnpm test   # ui: 39 passed
pnpm --filter @flowcanvas/ui storybook
```

**Run and check it:**
1. **Components → Tabs → Underline:** click Runs, and the accent bar moves and the panel text changes.
2. Click Details, then use **→ → End → Home** on the keyboard; press **Tab** once more and focus lands in the panel (ring visible).
3. **Tabs → Pill:** review-bar tabs with coloured count tags.
4. **Components → Panel → Entry points:** the panel with its single right edge, filter, and Screens / API routes / Jobs sections.
5. Light theme, then the Accessibility tab: no violations.

**Gotchas:**
- **Every tab in the Tab order** (all `tabIndex=0`) is a common mistake; keyboard users then have to Tab through all of them.
- **`aria-controls` must point to an element that exists.** We only set it on the selected tab, whose panel is rendered.
- **Don't put borders between panel sections.** Use the section label and spacing.
- **A Panel without a title** has no accessible name. `title` is required.

**Commit:** `feat(ui): add Tabs and Panel components with stories and tests`

### Step 1a.8 — Menu and Tooltip on React Aria Components

**Goal:** the two hardest components for accessibility (focus, keyboard, Escape, positioning, screen-reader wiring), built on a tested **headless** library and styled with our tokens, without weakening the strict CSP.

**Expected outcome:**
- Storybook shows **Components → Menu → Event actions** (the Figma event context menu: section heading, items, shortcut, description, separator) and **Components → Tooltip** (quick actions).
- Keyboard works fully: ArrowDown opens, type-ahead jumps, Escape closes and returns focus, and Tab shows tooltips.
- The web app runs under the CSP with **0 violations**.
- `ui` tests: 49 (10 new).

**Concepts:**
- **Headless UI libraries** provide behaviour and accessibility, with no visual styling. We supply all CSS from tokens.
- **Choosing by testing, not by reading.**
  - React Aria, Radix and Base UI each rendered a menu and a tooltip in a production build served with **our exact CSP header**, driven by Playwright.
  - Results: Radix injected a scroll-lock `<style>` (blocked, so the feature silently fails). Base UI's tooltip isn't linked to its trigger (screen readers never hear it). React Aria passed on accessibility, with one injected `<style>`.
  - Decision and full table: ADR 0008.
- **Pre-empting an injected style.**
  - React Aria injects `[data-react-aria-pressable] { touch-action: pan-x pan-y pinch-zoom; }` (removes the double-tap-zoom delay on mobile), unless an element with id `react-aria-pressable-style` already exists. Found by reading its code in our built bundle.
  - We put the same rule in `global.css` (served from our origin, so the CSP allows it), and `preventReactAriaStyleInjection()` adds a `<meta id="react-aria-pressable-style">` before React renders.
  - Verified: 0 violations, 0 injected `<style>`s, `touch-action` still applied.
  - Docs: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src
- **Attributing a CSP violation.**
  - A `securitypolicyviolation` listener (`document.addEventListener('securitypolicyviolation', …)`) records the directive and the source file.
  - Combined with testing each library **alone**, every violation got a name.
  - The first run's "inline script" violation was our own test tooling (injecting axe), a reminder to isolate the test harness from what's being tested.
- **Wrapping a library behind our API.**
  - Product code imports `Menu`, `MenuItem`, `MenuSection`, `MenuSeparator`, `MenuButton`, `MenuTrigger` and `Tooltip` from `@flowcanvas/ui`, never `react-aria-components`.
  - Switching libraries later only touches `packages/ui`.
  - React Aria needs its own pressable trigger, so `MenuButton` is React Aria's `Button` wearing our Button styles (`data-kind`, `data-size`).
  - Tooltips wrap the child in `Focusable`, so our own `Button` works as the trigger.
- **Typing a wrapper's children.**
  - `Focusable` only accepts a single element. Our prop is typed as `ComponentProps<typeof Focusable>['children']`, borrowing the library's own type instead of casting.
  - CSS Module classes are `string | undefined`; with `exactOptionalPropertyTypes` they must go through `classNames()` (returns `string`) before reaching a library's optional `className`.
- **Accessible keyboard shortcuts.**
  - React Aria's `<Keyboard>` slot is wired into the item's `aria-describedby`, so a screen reader hears "Ask about this flow…" (name) and "⌘↵" (description).
  - I first tried `aria-hidden` + `aria-keyshortcuts`. React Aria filters `aria-keyshortcuts` out, so the shortcut would have been hidden from screen readers entirely, and I reverted it. A unit test now checks the description wiring.
  - axe still flags `label-content-name-mismatch` on that item: a heuristic false positive, because the name *is* the visible label (WCAG 2.5.3 satisfied). Recorded in ADR 0008.
  - "@item.created" is a reference, not a shortcut, so it's a `description`.
- **Contrast inside a highlighted row.** `text/muted` passes on the popover but not on `surface-selected`, so a focused item's description and shortcut switch to `text/secondary`.
- **Testing React Aria in jsdom** (all three found by debugging failing tests, not by guessing):
  1. `onAction` is called as `onAction(key, …)`: assert on the first argument, not exact arguments.
  2. Focus returns to the trigger **one frame** after closing: use `waitFor`.
  3. Hover is ignored until a real pointer interaction has happened (a deliberate guard against emulated mouse events after touch): click once before `user.hover()`.

  Use `@testing-library/user-event` (realistic pointer and keyboard sequences) rather than `fireEvent`. Docs: https://testing-library.com/docs/user-event/intro
- **Motion.**
  - Popovers fade and slide 4 px in over `--duration-panel` (160 ms) using React Aria's `data-entering` attribute.
  - Reduced motion sets the duration to 0.
  - axe can flag contrast *during* the fade-in; check after animations end.
- **Tree-shaking keeps cost proportional.** The web app imports `@flowcanvas/ui` but renders no menu or tooltip yet. Its bundle grew 0.26 kB (68.81 → 69.07 kB gzip), not the ~46 kB React Aria costs when used.

**`pnpm-workspace.yaml`:** add to the catalog:

```yaml
  '@testing-library/user-event': 14.6.8
  react-aria-components: 1.22.1
```

**`packages/ui/package.json`:** `react-aria-components` in `dependencies`, `@testing-library/user-event` in `devDependencies` (both `catalog:`).

**Wiring the CSP guard:**
- `packages/ui/src/styles/global.css` gains the `[data-react-aria-pressable]` rule.
- `apps/web/src/main.tsx` calls `preventReactAriaStyleInjection()` before `createRoot`.
- `packages/ui/.storybook/preview.ts` calls it at the top.
- `packages/ui/src/index.ts` exports the components and the guard.

**`packages/ui/src/react-aria-csp.ts`:**

```ts
/**
 * React Aria injects a small <style id="react-aria-pressable-style"> on first use. Our
 * Content-Security-Policy (style-src 'self') blocks injected <style> elements, so the browser
 * refuses it and logs a violation. React Aria skips the injection when an element with that id
 * already exists, and `global.css` carries the same rule, so we add that marker before rendering.
 */
export const REACT_ARIA_PRESSABLE_STYLE_ID = 'react-aria-pressable-style';

/** Call once, before the first React render (app entry and Storybook preview). */
export function preventReactAriaStyleInjection(doc: Document = document): void {
  if (doc.getElementById(REACT_ARIA_PRESSABLE_STYLE_ID) !== null) {
    return;
  }
  const marker = doc.createElement('meta');
  marker.id = REACT_ARIA_PRESSABLE_STYLE_ID;
  doc.head.append(marker);
}
```

**`packages/ui/src/components/menu/Menu.tsx`:**

```tsx
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Header,
  Keyboard,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Popover,
  Separator,
  Text,
  type ButtonProps as AriaButtonProps,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  type PopoverProps,
} from 'react-aria-components';
import { classNames } from '../../class-names';
import buttonStyles from '../button/Button.module.css';
import type { ButtonKind, ButtonSize } from '../button/Button';
import styles from './Menu.module.css';

/** Groups a MenuButton and a Menu: opens on press, Enter, Space or ArrowDown; Escape closes and returns focus. */
export { MenuTrigger };

export interface MenuButtonProps extends Omit<AriaButtonProps, 'className'> {
  readonly kind?: ButtonKind;
  readonly size?: ButtonSize;
  readonly className?: string;
}

/** A trigger for a Menu, styled exactly like Button (React Aria needs its own pressable trigger). */
export function MenuButton({
  kind = 'secondary',
  size = 'sm',
  className,
  ...rest
}: MenuButtonProps) {
  return (
    <AriaButton
      {...rest}
      className={classNames(buttonStyles.button, className)}
      data-kind={kind}
      data-size={size}
    />
  );
}

export interface MenuProps<T> extends Omit<AriaMenuProps<T>, 'className'> {
  readonly className?: string;
  readonly placement?: PopoverProps['placement'];
}

/** A popover menu: arrow keys move, typing jumps to an item, Enter/Space activate, Escape closes. */
export function Menu<T extends object>({
  className,
  placement = 'bottom start',
  ...rest
}: MenuProps<T>) {
  return (
    <Popover placement={placement} offset={4} className={classNames(styles.popover)}>
      <AriaMenu {...rest} className={classNames(styles.menu, className)} />
    </Popover>
  );
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, 'className' | 'children'> {
  /** The item's label; also used for type-to-select. */
  readonly children: string;
  readonly description?: string;
  /**
   * Shown on the right, e.g. "⌘↵". React Aria links it to the item through aria-describedby, so screen
   * readers hear the label as the name and the shortcut as its description. Display only: the
   * shortcut itself is handled elsewhere.
   */
  readonly shortcut?: string;
  /** A decorative 14 px icon before the label. */
  readonly icon?: ReactNode;
}

export function MenuItem({ children, description, shortcut, icon, ...rest }: MenuItemProps) {
  return (
    <AriaMenuItem {...rest} textValue={children} className={classNames(styles.item)}>
      {icon !== undefined && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <Text slot="label" className={styles.label}>
        {children}
      </Text>
      {description !== undefined && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
      {shortcut !== undefined && <Keyboard className={styles.shortcut}>{shortcut}</Keyboard>}
    </AriaMenuItem>
  );
}

export interface MenuSectionProps {
  /** Sentence-case heading for the group, e.g. "item.created · event". */
  readonly title: string;
  readonly children: ReactNode;
}

export function MenuSection({ title, children }: MenuSectionProps) {
  return (
    <AriaMenuSection className={classNames(styles.section)}>
      <Header className={styles.header}>{title}</Header>
      {children}
    </AriaMenuSection>
  );
}

export function MenuSeparator() {
  return <Separator className={classNames(styles.separator)} />;
}
```

**`packages/ui/src/components/menu/Menu.module.css`:**

```css
/* Graphite popover: level 3 (hover surface), 1 px subtle border, 8 px radius, the popover shadow. */
.popover {
  min-inline-size: var(--size-node-width);
  padding: var(--space-4);
  border: var(--border-width-default) solid var(--color-border-subtle);
  border-radius: var(--radius-popover);
  background: var(--color-surface-hover);
  box-shadow: var(--shadow-popover);
  color: var(--color-text-primary);
}

/* Panels and popovers open with opacity + a 4 px slide (Graphite motion); instant under reduced motion. */
.popover[data-entering] {
  animation: popover-in var(--duration-panel) ease-out;
}

@keyframes popover-in {
  from {
    opacity: 0;
    transform: translateY(calc(-1 * var(--space-4)));
  }
}

.menu {
  display: flex;
  flex-direction: column;
  outline: none;
}

.item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0 var(--space-8);
  align-items: center;
  min-block-size: var(--size-row-compact);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-control);
  font-family: var(--text-small-font-family);
  font-size: var(--text-small-font-size);
  font-weight: var(--text-small-font-weight);
  line-height: var(--text-small-line-height);
  cursor: default;
  outline: none;
}

.item[data-focused] {
  background: var(--color-surface-selected);
}

.item[data-disabled] {
  opacity: var(--opacity-disabled);
}

.icon {
  display: inline-flex;
  grid-column: 1;
  color: var(--color-text-tertiary);
}

.label {
  grid-column: 2;
}

.description {
  grid-column: 2;
  color: var(--color-text-muted);
  font-size: var(--text-caption-font-size);
  line-height: var(--text-caption-line-height);
}

.shortcut {
  grid-row: 1;
  grid-column: 3;
  color: var(--color-text-muted);
  font-family: var(--text-mono-small-font-family);
  font-size: var(--text-mono-small-font-size);
  line-height: var(--text-mono-small-line-height);
}

/* Muted text is 4.5:1 on the popover but not on the selected row, so a focused item uses secondary. */
.item[data-focused] .description,
.item[data-focused] .shortcut {
  color: var(--color-text-secondary);
}

.header {
  padding: var(--space-4) var(--space-8);
  color: var(--color-text-muted);
  font-family: var(--text-caption-font-family);
  font-size: var(--text-caption-font-size);
  font-weight: var(--text-caption-font-weight);
  line-height: var(--text-caption-line-height);
}

.section {
  display: flex;
  flex-direction: column;
}

.separator {
  margin: var(--space-4) 0;
  border: 0;
  border-block-start: var(--border-width-default) solid var(--color-border-subtle);
}
```

**`packages/ui/src/components/tooltip/Tooltip.tsx`:**

```tsx
import type { ComponentProps, ReactNode } from 'react';
import {
  Focusable,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type TooltipProps as AriaTooltipProps,
} from 'react-aria-components';
import { classNames } from '../../class-names';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  /** Short supplementary text. Never put essential information or interactive content in a tooltip. */
  readonly content: ReactNode;
  /** One focusable element, e.g. a Button. It gets `aria-describedby` pointing at the tooltip. */
  readonly children: ComponentProps<typeof Focusable>['children'];
  readonly placement?: AriaTooltipProps['placement'];
  /** Milliseconds of hover before showing. Keyboard focus shows it immediately. */
  readonly delay?: number;
}

/** Shows on hover (after a delay) and on keyboard focus; Escape or leaving hides it. */
export function Tooltip({ content, children, placement = 'top', delay = 600 }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay} closeDelay={0}>
      <Focusable>{children}</Focusable>
      <AriaTooltip placement={placement} offset={6} className={classNames(styles.tooltip)}>
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
```

**`packages/ui/src/components/tooltip/Tooltip.module.css`:**

```css
/* A small popover: same surface, border and shadow as menus, Caption text, 4 px radius. */
.tooltip {
  max-inline-size: calc(var(--size-node-width) + var(--space-32));
  padding: var(--space-4) var(--space-8);
  border: var(--border-width-default) solid var(--color-border-subtle);
  border-radius: var(--radius-control);
  background: var(--color-surface-hover);
  box-shadow: var(--shadow-popover);
  color: var(--color-text-primary);
  font-family: var(--text-caption-font-family);
  font-size: var(--text-caption-font-size);
  font-weight: var(--text-caption-font-weight);
  line-height: var(--text-caption-line-height);
}

.tooltip[data-entering] {
  animation: tooltip-in var(--duration-panel) ease-out;
}

@keyframes tooltip-in {
  from {
    opacity: 0;
  }
}
```

**Tests and stories:**
- `react-aria-csp.test.ts`, 2 tests: the marker is added; only once.
- `components/menu/Menu.test.tsx`, 5 tests:
  - opens with items grouped under the heading
  - runs the action and closes
  - keyboard: Enter opens, arrows move, Escape closes and returns focus
  - name = label, shortcut in `aria-describedby`
  - trigger styled like Button
- `components/tooltip/Tooltip.test.tsx`, 3 tests: keyboard focus shows it and links it by `aria-describedby`; hover after delay shows it and leaving hides it; Escape hides it.
- `Menu.stories.tsx`: Event actions (open by default), Closed.
- `Tooltip.stories.tsx`: Default, Quick actions.

**Commands:**

```fish
pnpm install
pnpm format && pnpm lint && pnpm typecheck && pnpm test   # ui: 49 passed
pnpm --filter @flowcanvas/ui storybook
pnpm build && pnpm exec wrangler dev                      # web app under the production CSP
```

**Run and check it:**
1. **Components → Menu → Closed:** focus the Actions button and press ArrowDown (opens on the first item), type `c` (jumps to Comment), press Escape (closes, and focus is back on the button).
2. **Event actions:** compare with the Figma event context menu: heading `item.created · event`, the `⌘↵` shortcut, the description `1 producer · 3 consumers`, the separator.
3. **Components → Tooltip → Quick actions:** hover a button (600 ms delay) or Tab to it (immediate).
4. With `wrangler dev` running, open the app and the devtools console: no CSP errors. In Elements → `<head>`, `<meta id="react-aria-pressable-style">` is present.

**Gotchas:**
- **Never import `react-aria-components` in product code.** Use `@flowcanvas/ui`.
- **Forgetting `preventReactAriaStyleInjection()` in a new entry point** brings back a CSP console error on every load.
- **A tooltip must never hold essential information or controls.** It's supplementary (and invisible on touch).
- **A `<div onClick>` can't be a tooltip trigger.** The child must be focusable.

**Commit:** `feat(ui): add Menu and Tooltip on React Aria Components, CSP-safe`

### Step 1a.9 — Flow node (plus the lighter light-theme shadow)

**Goal:** build the card every flow step is drawn with on the canvas: type icon, title, file and line, and the change, status and selection states from the Figma "Flow node" component (9 variants).

**Expected outcome:**
- Storybook shows **Components → Flow node**:
  - **All states:** the 9 Figma variants in Figma order.
  - **Combinations:** selected + modified, modified + failing, added + analysing, a long title.
  - **All kinds:** 12 node types, one icon each.
- Both themes; axe finds no violations on any story.
- `ui` tests: 60 (11 new).
- Before this step (owner approved): the popover shadow is per theme. Light is now `0 8 24 rgba(16, 24, 40, 0.12)`; dark is unchanged. `shadow.popover` moved from `base.tokens.json` into both theme files (commit `0358bba`).

**Concepts:**
- **Variants in a design tool vs props in code.**
  - Figma's component has nine *mutually exclusive* variants (Default, Selected, Added … Analysing). In the product these are not exclusive: a node can be modified, failing and selected at once.
  - So the code models three **independent** props: `change`, `status` and `selected`.
  - Copying Figma's variant list into one `state` prop would make "modified and failing" impossible to express. Translate the *meaning* of a design, not its file structure.
- **State never by colour alone** (WCAG 1.4.1; https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). Every state has three signals:
  - a hue (state solid at 50% on the border)
  - a shape (2 px state bar, dashed outline for affected or outside selection, strikethrough for removed)
  - text (the tag)
- **Dimming without breaking contrast.**
  - Figma dims removed and analysing nodes with opacity 0.55. That would put the mono location text at about 2.4:1, below the 4.5:1 AA minimum.
  - Instead the title steps down one text level (`text/primary` → `text/secondary`), which looks dimmed and still passes. Recorded in the decisions log.
- **Accessible names for meaningful icons.**
  - Lucide icons render `aria-hidden` by default (decorative).
  - The node-type icon *does* carry meaning, so it gets `role="img"` and `aria-label="Function"`. A screen reader reads "Function, createItem, modified, src/items/create.ts:42".
  - The "~" prefix is wrapped in `aria-hidden`, so it isn't read as "tilde".
- **`aria-busy`** (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy). An analysing node is marked busy, which supports the product rule that stale values are never presented as current.
- **Whitespace in flex containers.** The Tag is `inline-flex`; text runs become flex items and a trailing space inside the symbol `<span>` is dropped ("+added"). A no-break space (` `) survives. Found in the screenshot, not the unit test, which is why we look at the real render.
- **The title row** (corrected in step 10 to match Figma):
  - The tags sit top-right; two tags stack in a column.
  - The title takes the rest of the row (`flex: 1 1 0`) and wraps there, breaking a single very long identifier anywhere (`overflow-wrap: anywhere`) rather than overflowing.
- **Selection ring without layout shift** (corrected in step 10). The border stays 1 px and turns accent. An `inset` box-shadow adds 0.5 px inside it (1.5 px in total, like Figma's inside stroke), and a second box-shadow draws the 3 px accent-tint halo outside. Changing `border-width` would move the content by half a pixel.
- **A shimmer that respects reduced motion.**
  - A pseudo-element's background gradient sweeps across over `--duration-shimmer` (1.2 s, linear).
  - It moves `background-position`, so nothing needs `overflow: hidden`, which would clip the state bar drawn over the border.
  - Under reduced motion it's removed entirely; the tag and dimmed title still say "analysing".
- **Presentational components.** `FlowNode` handles no clicks, focus or keys. The canvas (React Flow, from phase 2) wraps each node in its own focusable, selectable element. Two focus stops per node would break keyboard navigation.
- **Icons:** Lucide, via `lucide-react`; see ADR 0009 for the choice and the type-to-icon table. Icon size and stroke come from tokens (`--size-icon-sm`, `--icon-stroke-width: 2.25` = 1.5 px at 16 px).

**New tokens** (`packages/tokens/source/base.tokens.json`, then `pnpm --filter @flowcanvas/tokens generate`):
- `border.width.node-halo` = 3 px. The 2 px `halo` is now described as the inputs' halo.
- `icon.stroke-width` = 2.25 (number).

**Dependency:** `lucide-react: 1.55.0` in the catalog; `"lucide-react": "catalog:"` in `packages/ui` dependencies. `index.ts` exports `FlowNode` and the types `FlowNodeKind`, `FlowNodeChange`, `FlowNodeStatus`, `FlowNodeProps`.

**`packages/ui/src/components/flow-node/FlowNode.tsx`:**

```tsx
import type { ComponentPropsWithRef } from 'react';
import {
  AppWindow,
  BrainCircuit,
  Code,
  Database,
  File,
  Globe,
  KeyRound,
  Layers,
  ListChecks,
  Route,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { classNames } from '../../class-names';
import { Tag, type TagTone } from '../tag/Tag';
import styles from './FlowNode.module.css';

/** The twelve node types in Graphite, one icon each. */
export type FlowNodeKind =
  | 'ui'
  | 'function'
  | 'route'
  | 'rule'
  | 'data'
  | 'external'
  | 'ai'
  | 'queue'
  | 'config'
  | 'auth'
  | 'error'
  | 'file';

/** What happened to this node in the change under review. Absent means unchanged. */
export type FlowNodeChange = 'added' | 'modified' | 'removed' | 'affected' | 'scope';

/** Live status, independent of the change: a failing test, or analysis still running. */
export type FlowNodeStatus = 'failing' | 'analysing';

export interface FlowNodeProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  /** Short name, e.g. "createItem". */
  readonly title: string;
  /** File and line, e.g. "src/items/create.ts:42". */
  readonly location: string;
  readonly kind?: FlowNodeKind;
  readonly change?: FlowNodeChange;
  readonly status?: FlowNodeStatus;
  readonly selected?: boolean;
}

const KINDS: Record<FlowNodeKind, { readonly icon: LucideIcon; readonly label: string }> = {
  ui: { icon: AppWindow, label: 'UI' },
  function: { icon: Code, label: 'Function' },
  route: { icon: Route, label: 'Route' },
  rule: { icon: ListChecks, label: 'Rule' },
  data: { icon: Database, label: 'Data' },
  external: { icon: Globe, label: 'External service' },
  ai: { icon: BrainCircuit, label: 'AI call' },
  queue: { icon: Layers, label: 'Queue' },
  config: { icon: SlidersHorizontal, label: 'Config' },
  auth: { icon: KeyRound, label: 'Auth' },
  error: { icon: TriangleAlert, label: 'Error' },
  file: { icon: File, label: 'File' },
};

interface Label {
  readonly tone: TagTone;
  /** Visual prefix only; screen readers hear the text ("modified", not "tilde modified"). */
  readonly symbol?: string;
  readonly text: string;
}

const CHANGE_LABELS: Record<FlowNodeChange, Label> = {
  added: { tone: 'added', symbol: '+', text: 'added' },
  modified: { tone: 'modified', symbol: '~', text: 'modified' },
  removed: { tone: 'removed', symbol: '−', text: 'removed' },
  affected: { tone: 'affected', text: 'affected' },
  scope: { tone: 'scope', text: 'outside selection' },
};

const STATUS_LABELS: Record<FlowNodeStatus, Label> = {
  failing: { tone: 'removed', text: 'failing' },
  analysing: { tone: 'neutral', text: 'analysing…' },
};

function StateTag({ label }: { readonly label: Label }) {
  return (
    <Tag tone={label.tone}>
      {/* A no-break space: the Tag is a flex container, which would drop an ordinary trailing space. */}
      {label.symbol !== undefined && <span aria-hidden="true">{`${label.symbol}\u00a0`}</span>}
      {label.text}
    </Tag>
  );
}

/**
 * One step of a flow on the canvas. Presentational only: selection, focus and keyboard handling
 * belong to the canvas that renders it. A change is shown by hue *and* by shape (state bar, dashed
 * outline, strikethrough) *and* by a text tag, so it never depends on colour alone.
 */
export function FlowNode({
  title,
  location,
  kind = 'function',
  change,
  status,
  selected = false,
  className,
  ...rest
}: FlowNodeProps) {
  const { icon: Icon, label: kindLabel } = KINDS[kind];
  return (
    <div
      {...rest}
      className={classNames(styles.node, className)}
      data-change={change}
      data-status={status}
      data-selected={selected || undefined}
      aria-busy={status === 'analysing' || undefined}
    >
      <Icon className={styles.icon} role="img" aria-label={kindLabel} />
      <div className={styles.text}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {change !== undefined && <StateTag label={CHANGE_LABELS[change]} />}
          {status !== undefined && <StateTag label={STATUS_LABELS[status]} />}
        </div>
        <span className={styles.location}>{location}</span>
      </div>
    </div>
  );
}
```

**`packages/ui/src/components/flow-node/FlowNode.module.css`:**

```css
/*
 * Graphite flow node (Figma component "Flow node", 216 px): raised surface, 1 px subtle border,
 * 6 px radius, type icon, Body strong title, Mono small location.
 * Changed: 2 px state bar on the left, border in the state's solid at 50%, tag in the title row.
 * Affected / outside selection: dashed border in the state's solid, no bar.
 */
.node {
  --node-state: transparent;

  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  box-sizing: border-box;
  width: var(--size-node-width);
  padding: var(--space-8) var(--space-8) var(--space-8) var(--space-12);
  border: var(--border-width-default) solid var(--color-border-subtle);
  border-radius: var(--radius-node);
  background: var(--color-surface-raised);
  transition:
    background-color var(--duration-hover) ease-out,
    border-color var(--duration-hover) ease-out;
}

.node:hover {
  background: var(--color-surface-hover);
}

.node:not([data-change], [data-status='failing']):hover {
  border-color: var(--color-border-strong);
}

.icon {
  flex: none;
  width: var(--size-icon-sm);
  height: var(--size-icon-sm);

  /* Centre the icon on the title's first line (20 px line, 16 px icon). */
  margin-block: calc((var(--text-body-strong-line-height) - var(--size-icon-sm)) / 2);
  color: var(--color-text-tertiary);
  stroke-width: var(--icon-stroke-width);
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

/*
 * Tags sit at the end of the title row. The title keeps its natural width, so when title and tags
 * don't fit on one line the tags move below the title instead of the title breaking mid-word.
 */
.titleRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) calc(var(--space-4) + var(--space-2));
}

.title {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--text-body-strong-font-family);
  font-size: var(--text-body-strong-font-size);
  font-weight: var(--text-body-strong-font-weight);
  line-height: var(--text-body-strong-line-height);
  letter-spacing: var(--text-body-strong-letter-spacing);
  color: var(--color-text-primary);
}

/* text/muted, not the Figma's tertiary: the location is text and must pass 4.5:1. */
.location {
  overflow-wrap: anywhere;
  font-family: var(--text-mono-small-font-family);
  font-size: var(--text-mono-small-font-size);
  font-weight: var(--text-mono-small-font-weight);
  line-height: var(--text-mono-small-line-height);
  letter-spacing: var(--text-mono-small-letter-spacing);
  color: var(--color-text-muted);
}

/* ── Change states ─────────────────────────────────────────────── */

.node[data-change='added'] {
  --node-state: var(--color-state-added-solid);
}

.node[data-change='modified'] {
  --node-state: var(--color-state-modified-solid);
}

.node[data-change='removed'],
.node:not([data-change])[data-status='failing'] {
  --node-state: var(--color-state-removed-solid);
}

.node[data-change='added'],
.node[data-change='modified'],
.node[data-change='removed'],
.node:not([data-change])[data-status='failing'] {
  border-color: color-mix(in srgb, var(--node-state) 50%, transparent);
}

/* The state bar: 2 px, inset 8 px from top and bottom, drawn over the left border. */
.node[data-change='added']::before,
.node[data-change='modified']::before,
.node[data-change='removed']::before,
.node:not([data-change])[data-status='failing']::before {
  position: absolute;
  inset-block: calc(var(--space-8) - var(--border-width-default));
  inset-inline-start: calc(-1 * var(--border-width-default));
  width: var(--border-width-state-bar);
  border-radius: calc(var(--border-width-state-bar) / 2);
  background: var(--node-state);
  content: '';
}

.node[data-change='affected'] {
  border-style: dashed;
  border-color: var(--color-state-affected-solid);
}

.node[data-change='scope'] {
  border-style: dashed;
  border-color: var(--color-state-scope-solid);
}

/*
 * Removed nodes and nodes still being analysed are dimmed by stepping text down one level, not by
 * opacity, so the title still passes contrast. Removed is also struck through.
 */
.node[data-change='removed'] .title,
.node[data-status='analysing'] .title {
  color: var(--color-text-secondary);
}

.node[data-change='removed'] .title {
  text-decoration: line-through;
}

/* ── Selected: 1.5 px accent outline plus a 3 px accent-tint halo ── */

.node[data-selected] {
  border-color: var(--color-accent-solid);
  box-shadow:
    0 0 0 calc(var(--border-width-selected) - var(--border-width-default)) var(--color-accent-solid),
    0 0 0
      calc(
        var(--border-width-selected) - var(--border-width-default) + var(--border-width-node-halo)
      )
      var(--color-accent-tint);
}

/*
 * Analysing: a subtle shimmer sweeps across the node. It moves the background rather than the
 * element, so nothing needs clipping (overflow: hidden would also clip the state bar).
 */
.node[data-status='analysing']::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
      90deg,
      transparent 30%,
      color-mix(in srgb, var(--color-text-primary) 6%, transparent) 50%,
      transparent 70%
    )
    0 0 / 300% 100% no-repeat;
  content: '';
  pointer-events: none;
  animation: shimmer var(--duration-shimmer) linear infinite;
}

@keyframes shimmer {
  from {
    background-position: 100% 0;
  }

  to {
    background-position: 0 0;
  }
}

/* No sweep at all under reduced motion; the tag and dimmed title still say "analysing". */
@media (prefers-reduced-motion: reduce) {
  .node[data-status='analysing']::after {
    display: none;
  }
}
```

**`packages/ui/src/components/flow-node/FlowNode.test.tsx`:**

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FlowNode, type FlowNodeKind } from './FlowNode';

afterEach(cleanup);

function node(): HTMLElement {
  const title = screen.getByText('createItem');
  const root = title.closest<HTMLElement>('[data-flow-node]');
  if (root === null) throw new Error('flow node root not found');
  return root;
}

describe('FlowNode', () => {
  it('shows the title and location, unchanged and unselected by default', () => {
    render(<FlowNode data-flow-node title="createItem" location="src/items/create.ts:42" />);
    expect(screen.getByText('src/items/create.ts:42')).toBeTruthy();
    expect(node().dataset.change).toBeUndefined();
    expect(node().dataset.status).toBeUndefined();
    expect(node().dataset.selected).toBeUndefined();
    expect(
      screen.queryByText(/added|modified|removed|affected|outside|failing|analysing/),
    ).toBeNull();
  });

  it('names the node type for screen readers through its icon', () => {
    const kinds: [FlowNodeKind, string][] = [
      ['function', 'Function'],
      ['data', 'Data'],
      ['external', 'External service'],
    ];
    for (const [kind, label] of kinds) {
      render(<FlowNode kind={kind} title={kind} location="a.ts:1" />);
      expect(screen.getByRole('img', { name: label })).toBeTruthy();
      cleanup();
    }
  });

  it.each([
    ['added', '+\u00a0added', 'added'],
    ['modified', '~\u00a0modified', 'modified'],
    ['removed', '−\u00a0removed', 'removed'],
    ['affected', 'affected', 'affected'],
    ['scope', 'outside selection', 'scope'],
  ] as const)('labels the %s change with text, not colour alone', (change, visible, tone) => {
    render(<FlowNode data-flow-node title="createItem" location="a.ts:1" change={change} />);
    expect(node().dataset.change).toBe(change);
    const tag = node().querySelector<HTMLElement>('[data-tone]');
    expect(tag?.textContent).toBe(visible);
    expect(tag?.dataset.tone).toBe(tone);
  });

  it('hides the symbol prefix from screen readers', () => {
    render(<FlowNode data-flow-node title="createItem" location="a.ts:1" change="modified" />);
    const symbol = node().querySelector('[aria-hidden="true"]:not(svg)');
    expect(symbol?.textContent.trim()).toBe('~');
    expect(screen.getByText('modified')).toBeTruthy();
  });

  it('shows a status alongside a change', () => {
    render(
      <FlowNode
        data-flow-node
        title="createItem"
        location="a.ts:1"
        change="modified"
        status="failing"
      />,
    );
    const tones = [...node().querySelectorAll<HTMLElement>('[data-tone]')].map((tag) => [
      tag.textContent,
      tag.dataset.tone,
    ]);
    expect(tones).toEqual([
      ['~\u00a0modified', 'modified'],
      ['failing', 'removed'],
    ]);
  });

  it('marks an analysing node busy, so stale values are never read as current', () => {
    render(<FlowNode data-flow-node title="createItem" location="a.ts:1" status="analysing" />);
    expect(node().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('analysing…')).toBeTruthy();
  });

  it('reflects selection and passes other attributes through', () => {
    render(
      <FlowNode
        data-flow-node
        title="createItem"
        location="a.ts:1"
        selected
        className="extra"
        id="node-1"
      />,
    );
    expect(node().dataset.selected).toBe('true');
    expect(node().id).toBe('node-1');
    expect(node().classList.contains('extra')).toBe(true);
    expect(node().hasAttribute('aria-busy')).toBe(false);
  });
});
```

**`packages/ui/src/components/flow-node/FlowNode.stories.tsx`:**

```tsx
import { vars } from '@flowcanvas/tokens';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlowNode, type FlowNodeKind } from './FlowNode';

const meta = {
  title: 'Components/Flow node',
  component: FlowNode,
  args: { title: 'createItem', location: 'src/items/create.ts:42', kind: 'function' },
  argTypes: {
    kind: {
      control: 'select',
      options: [
        'ui',
        'function',
        'route',
        'rule',
        'data',
        'external',
        'ai',
        'queue',
        'config',
        'auth',
        'error',
        'file',
      ],
    },
    change: {
      control: 'select',
      options: [undefined, 'added', 'modified', 'removed', 'affected', 'scope'],
    },
    status: { control: 'select', options: [undefined, 'failing', 'analysing'] },
  },
} satisfies Meta<typeof FlowNode>;

export default meta;
type Story = StoryObj<typeof meta>;

const column = {
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['16'],
  alignItems: 'flex-start',
} as const;

export const Default: Story = {};

/** The nine variants of the Figma "Flow node" component set, in the same order. */
export const AllStates: Story = {
  render: () => (
    <div style={column}>
      <FlowNode title="Save item" location="app/items/save.tsx:18" kind="ui" />
      <FlowNode title="POST /api/items" location="app/api/items/route.ts:9" kind="route" selected />
      <FlowNode title="validateTitle" location="lib/validate.ts:12" kind="rule" change="added" />
      <FlowNode title="createItem" location="src/items/create.ts:42" change="modified" />
      <FlowNode title="legacyNormalize" location="src/items/legacy.ts:7" change="removed" />
      <FlowNode title="db.items.insert" location="lib/db.ts:41" kind="data" change="affected" />
      <FlowNode title="item.created" location="src/events/items.ts:3" kind="queue" change="scope" />
      <FlowNode title="sendWelcome" location="worker/mail.ts:22" kind="external" status="failing" />
      <FlowNode
        title="AI check (Gemini)"
        location="worker/check.ts:42"
        kind="ai"
        status="analysing"
      />
    </div>
  ),
};

/** Selection and status combine with a change: selection never hides what changed. */
export const Combinations: Story = {
  render: () => (
    <div style={column}>
      <FlowNode title="createItem" location="src/items/create.ts:42" change="modified" selected />
      <FlowNode
        title="createItem"
        location="src/items/create.ts:42"
        change="modified"
        status="failing"
      />
      <FlowNode
        title="validateTitle"
        location="lib/validate.ts:12"
        kind="rule"
        change="added"
        status="analysing"
      />
      <FlowNode
        title="normalizeItemTitleAndStripUnsafeMarkup"
        location="src/items/sanitize/normalize-title.ts:118"
        change="affected"
      />
    </div>
  ),
};

const KINDS: [FlowNodeKind, string, string][] = [
  ['ui', 'Item editor', 'app/items/editor.tsx:1'],
  ['function', 'createItem', 'src/items/create.ts:42'],
  ['route', 'POST /api/items', 'app/api/items/route.ts:9'],
  ['rule', 'validateTitle', 'lib/validate.ts:12'],
  ['data', 'db.items.insert', 'lib/db.ts:41'],
  ['external', 'Stripe charge', 'src/billing/charge.ts:30'],
  ['ai', 'AI check (Gemini)', 'worker/check.ts:42'],
  ['queue', 'item.created', 'src/events/items.ts:3'],
  ['config', 'ITEM_LIMIT', 'config/items.ts:5'],
  ['auth', 'requireSession', 'src/auth/session.ts:14'],
  ['error', 'onSaveError', 'app/items/errors.ts:8'],
  ['file', 'items.csv', 'data/items.csv'],
];

/** One icon per node type (Graphite iconography). */
export const AllKinds: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, max-content)',
        gap: vars.space['12'],
      }}
    >
      {KINDS.map(([kind, title, location]) => (
        <FlowNode key={kind} kind={kind} title={title} location={location} />
      ))}
    </div>
  ),
};
```

**Commands:**

```fish
pnpm install
pnpm --filter @flowcanvas/tokens generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test   # ui: 60 passed
pnpm --filter @flowcanvas/ui storybook                    # http://localhost:6006
```

**Run and check it:**
1. **Components → Flow node → All states:** compare top to bottom with the Figma "Flow node" component set (Default, Selected, Added, Modified, Removed, Affected, Scope, Failing, Analysing). The last one shimmers.
2. Switch the theme toolbar to light and check the same.
3. **Combinations:** a selected node keeps its ochre bar and tag; "failing" and "analysing" tags sit next to the change tag; the long title wraps without overflowing.
4. **All kinds:** twelve different icons.
5. **Accessibility** tab on each story: no violations.
6. Turn on "reduce motion" in your OS: the analysing node stops shimmering but still says "analysing…".
7. **Components → Menu** in light theme: the popover shadow is soft now.

**Gotchas:**
- **Don't make `FlowNode` clickable or focusable.** The canvas owns interaction.
- **Never add a state that is only a colour.** Each new state needs a shape cue and a tag.
- **Don't reach for `opacity` to dim text.** Check the contrast of the result, or step down a text token.
- **Hover quick actions, edge ports, badges and the appear animation are deliberately not here.** They arrive with the canvas and node-action phases.

**Commits:** `feat(tokens): lighter popover shadow in the light theme` · `feat(ui): add Flow node with change states, status, selection and type icons`

### Step 1a.10 — Figma references and visual comparison

**Goal:** prove the components match the Figma design, and stop them drifting later. Two layers:
1. **Figma comparison (human review).** Export the Figma components as PNGs. A Playwright script renders the same variants from Storybook and writes a side-by-side report: Figma | ours | difference.
2. **Visual regression (automatic).** Playwright screenshots every story in both themes and compares it with our own approved baseline. Any unintended pixel change fails the test. The same run checks every story with axe.

**Expected outcome:**
- `pnpm test:visual` passes: every story in dark and light matches its baseline, and axe reports no violations (except the recorded menu-shortcut false positive).
- `pnpm visual:report` writes an HTML report you open in a browser. It shows each Figma component and screen crop next to ours, with a difference overlay and a mismatch percentage. Figma is dark only, so it's compared with dark.

**Concepts:**
- **Reference vs baseline.**
  - A Figma PNG is a *reference*: rendering engines differ (font hinting, anti-aliasing), so exact equality is impossible, and a human judges it.
  - A *baseline* is a screenshot of **our own** component, approved once. Later renders on the same machine and browser must match it within a small tolerance, so regression is automatic.
  - Playwright's `toHaveScreenshot()` does this: https://playwright.dev/docs/test-snapshots
- **Device pixel ratio.** Export from Figma at **2x** and render at `deviceScaleFactor: 2`, so both images have the same pixel density.
- **Image difference.** `pixelmatch` (https://github.com/mapbox/pixelmatch) counts the pixels that differ beyond a colour threshold and draws them in a diff image. Anti-aliasing is ignored.

**Owner task: export the Figma references** (Figma web or desktop, free plan, dark theme as drawn). Settings for every export: **PNG, 2x**, defaults otherwise.

Components page: each variant becomes one file, named after the layer, e.g. `State=Added.png`. Keep these names.

| Layers panel → select | Export into |
| --- | --- |
| Expand **Flow node** → click `State=Default`, Shift-click `State=Analysing` (9 layers) | `docs/reference/figma-exports/flow-node/` |
| Expand **Tag** → `Tone=Added` … `Tone=Accent` (7 layers) | `docs/reference/figma-exports/tag/` |
| Expand **Button** → `Kind=Primary` … `Kind=Danger` (4 layers) | `docs/reference/figma-exports/button/` |

How to export:
1. Select the layers.
2. In the right sidebar (Design tab), scroll to **Export** and click **+**.
3. Set the scale to `2x` and the format to `PNG`.
4. Click **Export N layers**. In the browser, several layers download as a `.zip`; unzip it into the folder.

Screens page crops, one layer each: select the layer in the layers panel (or Ctrl/⌘-click it on the canvas to select deep inside a frame), export at 2x and **rename** the file as shown. Figma has no tooltip, so Tooltip is compared with the Graphite spec only.

| Screen frame | Layer | Save as `docs/reference/figma-exports/screens/…` |
| --- | --- | --- |
| `02 · Clone repository` | the focused `Input` with the repository URL | `input-focused.png` |
| `17 · Settings · privacy` | one `Toggle · on` and one `Toggle · off` | `toggle-on.png`, `toggle-off.png` |
| `06 · Workspace · after session` | `View switch` in the top bar (Graph / Sequence / Code) | `view-switch.png` |
| `06 · Workspace · after session` | `Inspector` (right panel), and its `Tabs` row | `inspector.png`, `inspector-tabs.png` |
| `27 · Prompt from a flow or event` | `Context menu · item.created` | `context-menu.png` |

Check: `ls -R docs/reference/figma-exports` lists 9 + 7 + 4 component PNGs plus the screen exports.

**What was actually exported:** whole screen frames (1440 × 900 at 2x) instead of single layers. That works just as well. The repo keeps one file per screen (`02-clone-repository.png`, `06-workspace-after-session.png`, `17-settings-privacy.png`, `27-prompt-from-flow-or-event.png`), and `screens/crops.json` records where each component sits, in Figma (1x) pixels.

**How it was built** (Claude):

- **Figma variant stories.** Tag, Button and Flow node each gain a `FigmaVariants` story. It renders every Figma variant with the Figma component's default text ("label", "Button", "Node title" / `src/file.ts:42`), and each element is tagged `data-figma="State=Added"`, matching the export's file name. The test then finds each variant by its file name.
- **Serving the catalogue.**
  - `pnpm test:visual` builds Storybook (`storybook-static/`), and Playwright's `webServer` serves it with `vite preview`. That's a static server with no extra dependency.
  - The tests read `storybook-static/index.json`, so every new story is covered automatically.
- **Rendering deterministically** (`openStory`):
  - wait for the theme attribute, the rendered root and `document.fonts.ready`
  - wait for finite animations (popover fade-in) to finish
  - `animations: 'disabled'` freezes the infinite shimmer at its first frame
- **Comparing with Figma** (`figma.spec.ts`):
  - Flatten the transparent Figma PNG onto the canvas token colour.
  - Clip the same-sized area around our element: centred horizontally; vertically from the top edge, moved up only for an effect margin.
  - Run `pixelmatch` with threshold 0.1 and anti-aliasing ignored. Each variant must stay under its budget.
  - Each test writes its rows to disk, and `afterAll` assembles `e2e/visual-report/index.html`. One failing test doesn't lose the others' rows; Playwright restarts the worker after a failure, so in-memory results would be lost.
- **Choosing budgets from measurements.**
  - The first run measured 2–15% mismatch.
  - Looking at the images showed real layout errors in the Flow node: 8 px instead of 10 px gaps, the tag placement, and the selection stroke outside the edge. Those were fixed.
  - What remained is font rasterisation (Figma uses Inter 3, we ship Inter 4: 2–4%) plus a few deliberate differences. Budgets sit just above those; see the decisions log.
  - A threshold picked before looking would either fail on font noise or let real layout bugs through.
- **Regression baselines** (`catalogue.spec.ts`):
  - `toHaveScreenshot()` stores one approved PNG per story and theme in `e2e/visual/__screenshots__/` (62 files, about 1 MB, committed).
  - The first run writes them. Later runs fail on any pixel change, as they did when the Flow node fix landed: 10 failures, exactly the Flow node stories.
  - After reviewing a deliberate change, approve it with `pnpm test:visual:update`.
- **Accessibility in the same pass.**
  - `@axe-core/playwright` runs the WCAG 2.0–2.2 A/AA rules on every story in both themes.
  - The menu-shortcut false positive is filtered (ADR 0008).
  - `@axe-core/playwright` must be imported by name (`import { AxeBuilder }`): its type entry is CommonJS, so the default import doesn't type-check under `nodenext`.

**New dependencies (e2e, dev only):**

| Package | Version | Licence | Purpose |
| --- | --- | --- | --- |
| `pixelmatch` | 8.0.0 | ISC | Pixel difference |
| `pngjs` | 7.0.0 | MIT | PNG reading and writing |
| `@types/pngjs` | 6.0.5 | | Types for `pngjs` |
| `@axe-core/playwright` | 4.13.0 | MPL-2.0 | Accessibility checks; test-only, unmodified, so MPL's file-level terms don't touch our code |

**Root scripts:**
- `test:visual`: `turbo run build-storybook --filter=@flowcanvas/ui && pnpm --filter @flowcanvas/e2e --fail-if-no-match test:visual`. Turbo builds the token package first; the original `pnpm --filter` version broke on a clean checkout (fixed in step 11).
- `test:visual:update`: the same, with `--update-snapshots`.

**Other changes:**
- `e2e/tsconfig.json` adds `"lib": ["es2024", "dom"]` (for `page.evaluate` callbacks) and includes `visual` and the new config.
- `.gitignore` adds `visual-report/` and `playwright-report-visual/`.

**`e2e/playwright.visual.config.ts`:**

```ts
import { defineConfig, devices } from '@playwright/test';

// Visual tests run against the static Storybook build (pnpm test:visual builds it first).
const storybookUrl = 'http://127.0.0.1:6008';
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './visual',
  forbidOnly: isCi,
  // Screenshot baselines are only comparable on the same OS and browser build; {platform} keeps them apart.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-visual' }]],
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
  use: {
    baseURL: storybookUrl,
    // Figma exports are 2x, so we render at 2x too.
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 2,
    viewport: { width: 800, height: 900 },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command:
      'pnpm --filter @flowcanvas/ui exec vite preview --outDir storybook-static --host 127.0.0.1 --port 6008 --strictPort',
    url: storybookUrl,
    reuseExistingServer: !isCi,
    timeout: 30_000,
  },
});
```

**`e2e/visual/storybook.ts`:**

```ts
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];

export const REPO_ROOT = new URL('../../', import.meta.url);

interface IndexEntry {
  readonly id: string;
  readonly type: 'story' | 'docs';
}

/** Every story in the built catalogue, read from Storybook's index (so new stories are covered automatically). */
export function storyIds(): string[] {
  const file = new URL('packages/ui/storybook-static/index.json', REPO_ROOT);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error('Storybook is not built. Run `pnpm test:visual`, which builds it first.');
  }
  const index = JSON.parse(text) as { entries: Record<string, IndexEntry> };
  return Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map((entry) => entry.id);
}

/** Opens one story in the given theme and waits until it is rendered, themed and its fonts are loaded. */
export async function openStory(page: Page, id: string, theme: Theme): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
  await page.waitForFunction(
    (expected) =>
      document.documentElement.dataset.theme === expected &&
      (document.querySelector('#storybook-root')?.childElementCount ?? 0) > 0,
    theme,
  );
  await page.evaluate(() => document.fonts.ready);
  // Let finite animations (popover fade-in) finish; infinite ones (the analysing shimmer) keep running.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
}
```

**`e2e/visual/images.ts`:**

```ts
import { readFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export function readPng(file: URL | Buffer): PNG {
  return PNG.sync.read(Buffer.isBuffer(file) ? file : readFileSync(file));
}

export function writePng(png: PNG): Buffer {
  return PNG.sync.write(png);
}

/** Copies a rectangle out of an image (pixel units). */
export function crop(source: PNG, x: number, y: number, width: number, height: number): PNG {
  const out = new PNG({ width, height });
  PNG.bitblt(source, out, x, y, width, height, 0, 0);
  return out;
}

/** Figma exports are transparent outside the shape; flatten them onto the page background before comparing. */
export function flatten(image: PNG, background: readonly [number, number, number]): PNG {
  const out = new PNG({ width: image.width, height: image.height });
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = (image.data[i + 3] ?? 0) / 255;
    background.forEach((bg, channel) => {
      const fg = image.data[i + channel] ?? 0;
      out.data[i + channel] = Math.round(fg * alpha + bg * (1 - alpha));
    });
    out.data[i + 3] = 255;
  }
  return out;
}

export interface Difference {
  /** Share of pixels that differ beyond pixelmatch's colour threshold (anti-aliasing ignored). */
  readonly ratio: number;
  readonly diff: PNG;
}

export function compare(expected: PNG, actual: PNG): Difference {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `size differs: expected ${String(expected.width)}×${String(expected.height)}, got ${String(actual.width)}×${String(actual.height)}`,
    );
  }
  const { width, height } = expected;
  const diff = new PNG({ width, height });
  const count = pixelmatch(expected.data, actual.data, diff.data, width, height, {
    threshold: 0.1,
  });
  return { ratio: count / (width * height), diff };
}

/** `#0b0c0e` → [11, 12, 14]. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
```

**`e2e/visual/report.ts`:**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';

export interface ReportRow {
  readonly group: string;
  readonly name: string;
  /** Paths relative to the report folder. */
  readonly figma: string;
  readonly ours: string;
  readonly diff?: string;
  readonly ratio?: number;
  readonly budget?: number;
  readonly note?: string;
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Writes a self-contained, static side-by-side report (no scripts, so it opens anywhere). */
export function writeReport(folder: URL, rows: readonly ReportRow[]): URL {
  mkdirSync(folder, { recursive: true });
  const groups = [...new Set(rows.map((row) => row.group))];
  const sections = groups
    .map((group) => {
      const body = rows
        .filter((row) => row.group === group)
        .map((row) => {
          const score =
            row.ratio === undefined
              ? '<td class="muted">review by eye</td>'
              : `<td class="${row.budget !== undefined && row.ratio > row.budget ? 'fail' : 'pass'}">${(row.ratio * 100).toFixed(2)}% <span class="muted">/ ${((row.budget ?? 0) * 100).toFixed(1)}%</span></td>`;
          return `<tr><th>${escape(row.name)}${row.note === undefined ? '' : `<div class="muted">${escape(row.note)}</div>`}</th>
<td><img src="${escape(row.figma)}" alt="Figma"></td><td><img src="${escape(row.ours)}" alt="Ours"></td>
<td>${row.diff === undefined ? '' : `<img src="${escape(row.diff)}" alt="Difference">`}</td>${score}</tr>`;
        })
        .join('\n');
      return `<h2>${escape(group)}</h2><table><thead><tr><th></th><th>Figma</th><th>Ours</th><th>Difference</th><th>Mismatch / budget</th></tr></thead><tbody>${body}</tbody></table>`;
    })
    .join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Figma comparison</title><style>
body{margin:24px;background:#0b0c0e;color:#edeff2;font:13px/20px system-ui,sans-serif}
h1{font-size:20px}h2{font-size:15px;margin-top:32px}table{border-collapse:collapse}
th,td{border-bottom:1px solid #2c323a;padding:8px 12px;text-align:left;vertical-align:top}
img{display:block;max-width:560px;height:auto;zoom:.5}.muted{color:#818995}.pass{color:#9fc2ad}.fail{color:#cfa09f}
</style></head><body><h1>Figma comparison</h1>
<p class="muted">Figma exports (dark, 2x) next to our components rendered at 2x. Red pixels in the difference image differ beyond the colour threshold; anti-aliasing is ignored. Screen crops contain different content, so they are reviewed by eye.</p>
${sections}</body></html>`;
  const file = new URL('index.html', folder);
  writeFileSync(file, html);
  return file;
}
```

**`e2e/visual/figma.spec.ts`:**

```ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { compare, crop, flatten, hexToRgb, readPng, writePng } from './images.js';
import { writeReport, type ReportRow } from './report.js';
import { openStory, REPO_ROOT } from './storybook.js';

// Phase 1a "Done when": each component matches its Figma counterpart in a side-by-side screenshot test.
// Figma is dark only, so everything here is compared in dark; light is covered by the catalogue baselines.

const EXPORTS = new URL('docs/reference/figma-exports/', REPO_ROOT);
const REPORT = new URL('e2e/visual-report/', REPO_ROOT);
const SCALE = 2;

/** The page background the Figma exports are flattened onto: the dark canvas token. */
function canvasColour(): [number, number, number] {
  const css = readFileSync(new URL('packages/tokens/css/tokens.css', REPO_ROOT), 'utf8');
  const match = /--color-surface-canvas:\s*(#[0-9a-f]{6})/i.exec(css);
  if (match?.[1] === undefined) throw new Error('--color-surface-canvas not found in tokens.css');
  return hexToRgb(match[1]);
}

/**
 * Mismatch budgets: the share of pixels allowed to differ from the Figma export. Measured on 27 Oct 2026,
 * then set just above. The floor (2–4%) is font rasterisation: Figma draws Inter 3, we ship Inter 4 (slightly
 * different glyph widths), and Chrome hints differently. A 1–2 px layout error measures 5–15%, so it fails.
 * Higher budgets are deliberate differences, each recorded in docs/decisions-log.md.
 */
const COMPONENTS = [
  {
    folder: 'tag',
    story: 'components-tag--figma-variants',
    budget: 0.06,
    overrides: {},
  },
  {
    folder: 'button',
    story: 'components-button--figma-variants',
    budget: 0.04,
    overrides: {
      // Figma's export of the bordered button is 2 px wider (61 vs 59) than its layout box; ours is 59.
      'Kind=Secondary': 0.07,
    },
  },
  {
    folder: 'flow-node',
    story: 'components-flow-node--figma-variants',
    budget: 0.05,
    overrides: {
      // Tag text (Inter 3 vs 4) plus the location in text/muted instead of tertiary (contrast).
      'State=Added': 0.07,
      'State=Modified': 0.07,
      'State=Failing': 0.07,
      // Figma's selected node is 57 px tall (its 1.5 px stroke rounds the auto height up); ours stays 56.
      'State=Selected': 0.07,
      // Strikethrough (Graphite) and no opacity dimming of the location (contrast).
      'State=Removed': 0.08,
    },
  },
] as const satisfies readonly {
  folder: string;
  story: string;
  budget: number;
  overrides: Readonly<Record<string, number>>;
}[];

const background = canvasColour();

/**
 * Each test writes its rows to disk, so the report is complete even when a test fails (Playwright then
 * restarts the worker and in-memory state is lost).
 */
function record(group: string, rows: readonly ReportRow[]): void {
  mkdirSync(new URL('rows/', REPORT), { recursive: true });
  writeFileSync(new URL(`rows/${group}.json`, REPORT), JSON.stringify(rows));
}

function recordedRows(): ReportRow[] {
  const folder = new URL('rows/', REPORT);
  return readdirSync(folder)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => JSON.parse(readFileSync(new URL(file, folder), 'utf8')) as ReportRow[]);
}

function save(relative: string, png: Parameters<typeof writePng>[0]): string {
  const file = new URL(relative, REPORT);
  mkdirSync(new URL('./', file), { recursive: true });
  writeFileSync(file, writePng(png));
  return relative;
}

for (const { folder, story, budget: defaultBudget, overrides } of COMPONENTS) {
  test(`${folder} matches Figma`, async ({ page }) => {
    await openStory(page, story, 'dark');
    const variants = readdirSync(new URL(`${folder}/`, EXPORTS)).filter((file) =>
      file.endsWith('.png'),
    );
    expect(variants.length).toBeGreaterThan(0);

    const rows: ReportRow[] = [];
    const failures: string[] = [];
    for (const file of variants) {
      const variant = file.replace(/\.png$/, '');
      const budget = (overrides as Readonly<Record<string, number>>)[variant] ?? defaultBudget;
      let figma = flatten(readPng(new URL(`${folder}/${file}`, EXPORTS)), background);

      // Clip an area the size of the Figma export around our component. Horizontally it is centred: widths
      // differ by effects such as the selection halo (equal on both sides) or by font rendering. Vertically
      // it starts at our top edge, moved up by the same effect margin only when Figma's export is taller
      // (a wrapped title makes Figma taller at the bottom, not the top).
      const box = await page.locator(`[data-figma="${variant}"]`).boundingBox();
      if (box === null) throw new Error(`no element with data-figma="${variant}" in ${story}`);
      const width = figma.width / SCALE;
      const height = figma.height / SCALE;
      const effect = Math.max(0, (width - box.width) / 2);
      const top = height > box.height + 1 ? box.y - effect : box.y;
      let ours = readPng(
        await page.screenshot({
          animations: 'disabled',
          clip: { x: box.x + (box.width - width) / 2, y: top, width, height },
        }),
      );

      // Figma's export reserves room for the selection halo but draws it transparent (spread on a drop shadow
      // doesn't export); Graphite and the Figma screens do show it. Compare the node itself, inside that margin.
      const margin = Math.round(effect * SCALE);
      if (margin > 0) {
        const inner = (image: typeof figma) =>
          crop(image, margin, margin, image.width - 2 * margin, image.height - 2 * margin);
        figma = inner(figma);
        ours = inner(ours);
      }

      const { ratio, diff } = compare(figma, ours);
      const sizeNote = `ours ${String(box.width)}×${String(box.height)}, Figma ${String(width)}×${String(height)} (incl. effects)`;
      rows.push({
        group: folder,
        name: variant,
        figma: save(`${folder}/${variant}.figma.png`, figma),
        ours: save(`${folder}/${variant}.ours.png`, ours),
        diff: save(`${folder}/${variant}.diff.png`, diff),
        ratio,
        budget,
        note: sizeNote,
      });
      if (ratio > budget)
        failures.push(`${variant}: ${(ratio * 100).toFixed(2)}% > ${(budget * 100).toFixed(1)}%`);
    }
    record(folder, rows);
    expect(failures).toEqual([]);
  });
}

interface Crop {
  readonly name: string;
  readonly screen: string;
  readonly rect: readonly [number, number, number, number];
  readonly story: string;
}

test('screen crops next to their stories (reviewed by eye)', async ({ page }) => {
  const rows: ReportRow[] = [];
  const { crops } = JSON.parse(readFileSync(new URL('screens/crops.json', EXPORTS), 'utf8')) as {
    crops: Crop[];
  };
  for (const { name, screen, rect, story } of crops) {
    const [x, y, w, h] = rect.map((value) => value * SCALE) as [number, number, number, number];
    const figma = crop(readPng(new URL(`screens/${screen}`, EXPORTS)), x, y, w, h);
    await openStory(page, story, 'dark');
    const ours = readPng(await page.screenshot({ animations: 'disabled' }));
    const slug = story.replace(/^components-/, '');
    rows.push({
      group: 'Screen crops',
      name,
      figma: save(`screens/${slug}.figma.png`, figma),
      ours: save(`screens/${slug}.ours.png`, ours),
      note: `${screen} · story ${story}`,
    });
  }
  record('screens', rows);
  expect(rows).toHaveLength(crops.length);
});

test.afterAll(() => {
  const file = writeReport(REPORT, recordedRows());
  console.log(`Figma comparison report: ${file.pathname}`);
});
```

**`e2e/visual/catalogue.spec.ts`:**

```ts
// Named import: the package's type entry is CommonJS, so its default export doesn't type-check under nodenext.
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openStory, storyIds, THEMES } from './storybook.js';

// Every story in both themes: pixel-compared with its approved baseline, and checked with axe.
// Update baselines deliberately, after reviewing the change: pnpm test:visual:update.
for (const id of storyIds()) {
  for (const theme of THEMES) {
    test(`${id} · ${theme}`, async ({ page }) => {
      await openStory(page, id, theme);

      await expect(page).toHaveScreenshot(`${id}-${theme}.png`, { fullPage: true });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const violations = results.violations
        .map((violation) => ({
          ...violation,
          // Known false positive (ADR 0008): a menu item's shortcut is its description, not part of its name.
          nodes: violation.nodes.filter(
            (node) =>
              !(
                violation.id === 'label-content-name-mismatch' &&
                node.html.includes('role="menuitem"')
              ),
          ),
        }))
        .filter((violation) => violation.nodes.length > 0)
        .map(
          (violation) =>
            `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
        );
      expect(violations).toEqual([]);
    });
  }
}
```

**`docs/reference/figma-exports/screens/crops.json`:**

```json
{
  "$description": "Where each component sits in the full-screen Figma exports, in Figma (1x) pixels: [x, y, width, height]. The exports are 2x. Each crop is shown next to the matching story in the Figma comparison report.",
  "crops": [
    {
      "name": "Input (focused, mono)",
      "screen": "02-clone-repository.png",
      "rect": [477, 325, 486, 48],
      "story": "components-input--mono"
    },
    {
      "name": "Toggle (settings rows)",
      "screen": "17-settings-privacy.png",
      "rect": [352, 140, 728, 470],
      "story": "components-toggle--settings-rows"
    },
    {
      "name": "Tabs (pill: view switch)",
      "screen": "06-workspace-after-session.png",
      "rect": [512, 2, 204, 36],
      "story": "components-tabs--pill"
    },
    {
      "name": "Tabs (underline: inspector)",
      "screen": "06-workspace-after-session.png",
      "rect": [1090, 136, 344, 38],
      "story": "components-tabs--underline"
    },
    {
      "name": "Panel (entry points)",
      "screen": "06-workspace-after-session.png",
      "rect": [44, 40, 248, 540],
      "story": "components-panel--entry-points"
    },
    {
      "name": "Menu (event context menu)",
      "screen": "27-prompt-from-flow-or-event.png",
      "rect": [244, 512, 284, 232],
      "story": "components-menu--event-actions"
    }
  ]
}
```

**Commands:**

```fish
pnpm install
pnpm test:visual              # builds Storybook, then 66 tests: 62 catalogue (31 stories × 2 themes) + 3 Figma + 1 crops
pnpm test:visual:update       # only after reviewing a deliberate visual change
xdg-open e2e/visual-report/index.html                      # the Figma side-by-side report
pnpm --filter @flowcanvas/e2e exec playwright show-report playwright-report-visual   # failures with expected / actual / diff
```

**Results (27 Oct 2026):** 66 passed. Mismatch against Figma:

| Component | Variants |
| --- | --- |
| Tag | 4.3–4.5% (budget 6%) |
| Button | Primary, Ghost, Danger 2.4–2.6% (budget 4%); Secondary 5.9% (budget 7%) |
| Flow node | Default 1.6%, Scope 2.9%, Analysing 3.3%, Affected 4.1% (budget 5%); Selected 5.5%, Added, Modified and Failing about 6% (budget 7%); Removed 7.2% (budget 8%) |

**Run and check it:**
1. Run `pnpm test:visual`. Expect `66 passed`.
2. Open `e2e/visual-report/index.html`. For each Tag, Button and Flow node variant you see Figma | ours | difference (red pixels) and the mismatch against its budget. The screen crops (Input, Toggle settings rows, both Tabs, the entry-points Panel, the context Menu) are shown next to their stories for review by eye.
3. **Prove it catches regressions.** Change a token, for example `--radius-node` in `packages/tokens/source/base.tokens.json` from 6 to 8, then regenerate tokens and run `pnpm test:visual`. Flow node stories fail in both suites. Revert the change and regenerate.

**Gotchas:**
- **Never run `test:visual:update` to make a red run green without opening the report.** That approves the bug.
- **Baselines are per OS** (`-linux`). A different OS writes its own set; CI needs its own (upgrade-later 16).
- **The comparison needs the exact Figma default text.** A variant story with different text measures as a large mismatch.
- **Figma's export bounds include effects** (shadows, halos) even when the effect isn't drawn.

### Step 1a.11 — Menu icons, version page, and the catalogue online

**Goal:**
1. Finish the Menu to match Figma: icons, inline details, the keycap, and pickers with a tick.
2. Restyle the version page with the tokens and components.
3. Put the component catalogue on a free public URL, so phase 1a's *Try it* ("open the component catalogue, flip dark and light, compare with Figma") works from a link.

**Expected outcome:**
- **Version page** (preview URL or `pnpm dev`): "Flowcanvas", a one-line status, `Build 0.1.0 · <commit>`, **Open the component catalogue**, and **Theme: System**. The theme menu ticks the current choice, switches immediately and remembers it after a reload.
- **Catalogue:** `https://flowcanvas-catalogue.ahujaarmaan7777.workers.dev`, once the owner has created the Cloudflare project (below).
- **Tests:** `ui` 62 · `web` 4 · e2e smoke 2 (both under the production CSP) · `pnpm test:visual` 68.

**Concepts:**
- **Render props.** React Aria's `MenuItem` accepts a function as its children: `({ isSelected, selectionMode }) => …`. The item then draws a tick only when it's selected, while React Aria handles the semantics (`role="menuitemradio"`, `aria-checked`). Docs: https://react-spectrum.adobe.com/react-aria/Menu.html#selection
- **Controlled selection.**
  - The theme menu gets `selectedKeys={[theme]}` and `onSelectionChange`. The state lives in `useThemePreference` (step 3), not in the menu.
  - `disallowEmptySelection` stops a second click from unselecting everything.
  - `onSelectionChange` receives a `Selection`: either `'all'` or a `Set` of keys. Narrow it before use.
- **Why the catalogue gets its own origin** (ADR 0010).
  - Storybook's built HTML has inline `<script>` and `<style>` blocks, which our app's CSP forbids.
  - Loosening the CSP on the app's origin would weaken the app.
  - A second Worker gives the catalogue its own origin (`flowcanvas-catalogue.…`). The browser's same-origin policy then keeps anything there away from the app's storage and, later, its sessions.
- **Per-site headers on Workers static assets.**
  - A `_headers` file at the root of the assets folder sets response headers per path.
  - `.assetsignore` lists files not to upload at all (here Storybook's `project.json` metadata).
  - Storybook's `staticDirs` copies both into the build, so they ship with every build.
  - Docs: https://developers.cloudflare.com/workers/static-assets/headers/ and https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets
- **Two Workers from one repo.**
  - Workers Builds runs one project per Worker. Each has its own build command and its own `wrangler.jsonc`, selected with `--config`.
  - Paths inside a config resolve relative to that config file.
- **Best-practice vs WCAG rules in axe.**
  - `region`, `landmark-one-main` and `page-has-heading-one` check a whole page's structure. They are meaningless for one component in isolation, so they are off in Storybook's Accessibility tab.
  - WCAG A/AA rules stay on, and the version page itself is a real page with `<main>` and `<h1>`.

**Files** (full contents of the new ones; the Menu changes are in `packages/ui/src/components/menu/`):

**`apps/web/src/App.tsx`:**

```tsx
import { formatBuildInfo, type BuildInfo } from '@flowcanvas/graph-model';
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuTrigger,
  useThemePreference,
  type ThemePreference,
} from '@flowcanvas/ui';
import styles from './App.module.css';
import { CATALOGUE_URL } from './links';

interface AppProps {
  readonly buildInfo: BuildInfo;
}

const THEMES: readonly { readonly id: ThemePreference; readonly label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

function themeLabel(preference: ThemePreference): string {
  return THEMES.find((theme) => theme.id === preference)?.label ?? 'System';
}

export function App({ buildInfo }: AppProps) {
  const [theme, setTheme] = useThemePreference();
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <h1 className={styles.title}>Flowcanvas</h1>
        <p className={styles.summary}>
          A canvas-first development environment. This build has the Graphite design system; the
          canvas comes in the next phases.
        </p>
        <dl className={styles.facts}>
          <dt className={styles.term}>Build</dt>
          <dd className={styles.build}>{formatBuildInfo(buildInfo)}</dd>
        </dl>
        <div className={styles.actions}>
          <a className={styles.link} href={CATALOGUE_URL}>
            Open the component catalogue
          </a>
          <MenuTrigger>
            <MenuButton aria-label={`Theme: ${themeLabel(theme)}`}>
              Theme: {themeLabel(theme)}
            </MenuButton>
            <Menu
              aria-label="Theme"
              placement="bottom end"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[theme]}
              onSelectionChange={(keys) => {
                const next = keys === 'all' ? undefined : THEMES.find(({ id }) => keys.has(id));
                if (next !== undefined) setTheme(next.id);
              }}
            >
              {THEMES.map(({ id, label }) => (
                <MenuItem
                  key={id}
                  id={id}
                  {...(id === 'system' ? { description: 'follows your OS' } : {})}
                >
                  {label}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        </div>
      </div>
    </main>
  );
}
```

**`apps/web/src/App.module.css`:**

```css
/* The version page: one quiet column, centred on the canvas. */
.page {
  display: grid;
  place-items: center;
  min-block-size: 100dvh;
  padding: var(--space-24);
  box-sizing: border-box;
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
  inline-size: 100%;
  max-inline-size: calc(2 * var(--size-node-width));
}

.title {
  margin: 0;
  font-family: var(--text-title-font-family);
  font-size: var(--text-title-font-size);
  font-weight: var(--text-title-font-weight);
  line-height: var(--text-title-line-height);
  letter-spacing: var(--text-title-letter-spacing);
  color: var(--color-text-primary);
}

.summary {
  margin: 0;
  font-family: var(--text-body-font-family);
  font-size: var(--text-body-font-size);
  font-weight: var(--text-body-font-weight);
  line-height: var(--text-body-line-height);
  color: var(--color-text-secondary);
}

.facts {
  display: flex;
  gap: var(--space-8);
  align-items: baseline;
  margin: 0;
}

.term {
  font-family: var(--text-caption-font-family);
  font-size: var(--text-caption-font-size);
  font-weight: var(--text-caption-font-weight);
  line-height: var(--text-caption-line-height);
  color: var(--color-text-muted);
}

.build {
  margin: 0;
  font-family: var(--text-mono-font-family);
  font-size: var(--text-mono-font-size);
  font-weight: var(--text-mono-font-weight);
  line-height: var(--text-mono-line-height);
  color: var(--color-text-secondary);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-16);
  align-items: center;
  justify-content: space-between;
}

/* Links are underlined text, not accent-coloured: in Graphite the accent means selection and focus only. */
.link {
  border-radius: var(--radius-control);
  font-family: var(--text-small-strong-font-family);
  font-size: var(--text-small-strong-font-size);
  font-weight: var(--text-small-strong-font-weight);
  line-height: var(--text-small-strong-line-height);
  color: var(--color-text-primary);
  text-decoration: underline;
  text-decoration-color: var(--color-border-strong);
  text-underline-offset: var(--space-4);
  transition: text-decoration-color var(--duration-hover) ease-out;
}

.link:hover {
  text-decoration-color: var(--color-text-primary);
}
```

**`apps/web/src/links.ts`:**

```ts
/** The component catalogue (Storybook), deployed from `main` to its own Worker (packages/ui/wrangler.jsonc). */
export const CATALOGUE_URL = 'https://flowcanvas-catalogue.ahujaarmaan7777.workers.dev';
```

**`apps/web/src/App.test.tsx`:**

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { CATALOGUE_URL } from './links';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const buildInfo = { version: '0.1.0', commit: '7e59ec1a2b3c' };

describe('App', () => {
  it('shows the product name', () => {
    render(<App buildInfo={buildInfo} />);
    expect(screen.getByRole('heading', { name: 'Flowcanvas' })).toBeTruthy();
  });

  it('shows the version and short commit it was built from', () => {
    render(<App buildInfo={buildInfo} />);
    expect(screen.getByText('0.1.0 · 7e59ec1')).toBeTruthy();
  });

  it('links to the component catalogue', () => {
    render(<App buildInfo={buildInfo} />);
    const link = screen.getByRole('link', { name: 'Open the component catalogue' });
    expect(link.getAttribute('href')).toBe(CATALOGUE_URL);
  });

  it('follows the system theme by default and switches theme from the menu', async () => {
    const user = userEvent.setup();
    render(<App buildInfo={buildInfo} />);
    expect(document.documentElement.dataset.theme).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Theme: System' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeTruthy();
    expect(localStorage.getItem('flowcanvas-theme')).toBe('light');
  });
});
```

**`e2e/tests/smoke.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';

test('shows the product name and the version it was built from', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');

  await expect(page).toHaveTitle('Flowcanvas');
  await expect(page.getByRole('heading', { name: 'Flowcanvas' })).toBeVisible();

  const expectedCommit = process.env.E2E_EXPECTED_COMMIT?.slice(0, 7);
  const buildLine = expectedCommit ? `0.1.0 · ${expectedCommit}` : /^0\.1\.0 · [0-9a-f]{7}$/;
  await expect(page.getByText(buildLine)).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('switches theme from the menu and links to the component catalogue', async ({ page }) => {
  const cspViolations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      cspViolations.push(message.text());
    }
  });

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open the component catalogue' })).toHaveAttribute(
    'href',
    /^https:\/\/flowcanvas-catalogue\./,
  );

  await page.getByRole('button', { name: /^Theme: / }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // The choice is remembered across reloads.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  expect(cspViolations).toEqual([]);
});
```

**`packages/ui/wrangler.jsonc`:**

```jsonc
// The component catalogue (Storybook), on its own Worker so it gets its own origin and CSP.
// Deployed by Cloudflare Workers Builds; see docs/build-steps.md, step 1a.11.
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "flowcanvas-catalogue",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./storybook-static",
  },
  "preview_urls": true,
  "workers_dev": true,
  "send_metrics": false,
}
```

**`packages/ui/.storybook/public/_headers`:**

```text
# Security headers for the component catalogue (its own Worker and origin, see packages/ui/wrangler.jsonc).
# Storybook's built pages use inline scripts and styles, so this CSP allows 'unsafe-inline'; that's why the
# catalogue never shares an origin with the app. It holds only static demo content: no cookies, no data.
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

**`packages/ui/.storybook/public/.assetsignore`:**

```text
# Not served: Storybook build metadata.
project.json
```

**`packages/ui/.storybook/main.ts`:**

```ts
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // _headers and .assetsignore for the Cloudflare deploy are copied to the build root.
  staticDirs: ['./public'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: {
    // Telemetry is off by default across the project (CLAUDE.md, non-negotiable rule 5).
    disableTelemetry: true,
  },
};

export default config;
```

**`packages/ui/.storybook/preview.ts`:**

```ts
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';
import { preventReactAriaStyleInjection } from '../src/react-aria-csp';
import '../src/styles/global.css';

preventReactAriaStyleInjection();

const preview: Preview = {
  decorators: [
    // The toolbar's theme switch sets data-theme on <html>, exactly like the app does.
    withThemeByDataAttribute({
      themes: { dark: 'dark', light: 'light' },
      defaultTheme: 'dark',
      attributeName: 'data-theme',
    }),
  ],
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    a11y: {
      test: 'error',
      // Page-level best-practice rules don't apply to a component shown on its own (no page landmarks or h1).
      config: {
        rules: [
          { id: 'region', enabled: false },
          { id: 'landmark-one-main', enabled: false },
          { id: 'page-has-heading-one', enabled: false },
        ],
      },
    },
  },
};

export default preview;
```

`apps/web/package.json`: `lint` is now `eslint . && stylelint "src/**/*.css"`; new dev dependencies `stylelint` and `@testing-library/user-event` (catalog).

**Owner task: create the catalogue project in Cloudflare.** Same flow as the app (phase 1, step 11): Workers & Pages → Create → Import a repository → `ArmaanAhuja/Flowcanvas`.

| Field | Value |
| --- | --- |
| Project name | `flowcanvas-catalogue` (must equal `name` in `packages/ui/wrangler.jsonc`) |
| Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm turbo run build-storybook --filter=@flowcanvas/ui` |
| Deploy command | `pnpm exec wrangler deploy --config packages/ui/wrangler.jsonc` |
| Enable preview builds | **on** |
| Non-production branch deploy command | `pnpm exec wrangler versions upload --config packages/ui/wrangler.jsonc` |
| Protect with Cloudflare Access | **off** (upgrade-later item 11) |
| Advanced → Path (root directory) | `/` |
| Advanced → API token | "Create new token" |
| Advanced → Variables | `NODE_VERSION` = `24`, `SKIP_DEPENDENCY_INSTALL` = `true`, `TURBO_TELEMETRY_DISABLED` = `1`, `COREPACK_ENABLE_DOWNLOAD_PROMPT` = `0`, `WRANGLER_SEND_METRICS` = `false`, `STORYBOOK_DISABLE_TELEMETRY` = `1` |

The production deploy runs from `main`, so the catalogue URL works after phase 1a is merged.

- **The first build fails on `main`, and that's expected.** Creating the project builds the production branch at once, and `main` has no `packages/ui` yet, so the deploy reports `Could not read file: packages/ui/wrangler.jsonc`. This happened on 27 Oct 2026; it resolves itself when phase 1a merges.
- **Variable values must be exact.** The third build failed at deploy with `Expected WRANGLER_SEND_METRICS to be "true" or "false", but got "false "`: a trailing space typed into the dashboard. Retype values with no surrounding spaces.
- **Where the preview is:**
  - The deploy log of a branch build ends with the version's preview URL.
  - Stable branch alias: `https://<branch, with / replaced by ->-flowcanvas-catalogue.ahujaarmaan7777.workers.dev`, e.g. `https://phase-1a-design-system-flowcanvas-catalogue.ahujaarmaan7777.workers.dev`.
  - Until `main` deploys, the production URL shows Cloudflare's "Hello world" placeholder.
- **Verified 27 Oct 2026 on the previews of `3231df2`:**
  - catalogue: the CSP header is present, `project.json` returns 404, and three stories render with no console errors
  - app preview: `E2E_BASE_URL=… E2E_EXPECTED_COMMIT=3231df2… pnpm --filter @flowcanvas/e2e test:e2e` gives 2 passed
- **Build through Turbo, not `pnpm --filter`.**
  - The second build (branch `phase/1a-design-system`, 27 Oct 2026) failed: `Rolldown failed to resolve import "@flowcanvas/tokens"`.
  - `@flowcanvas/tokens` is a *compiled* package (its `exports` point at `dist/`), and a clean checkout has no `dist/`.
  - `pnpm --filter … build-storybook` runs only that one script. `turbo run build-storybook` first runs the `^build` tasks it depends on (`turbo.json`).
  - It worked locally only because `dist/` was left over from earlier builds. Reproduced and fixed in a fresh `git clone`.
  - Turbo also exits 1 when `--filter` matches nothing.
  - `pnpm test:visual` uses Turbo for the same reason.
- **`--fail-if-no-match` matters for plain pnpm filters.** That same build's first step reported **Success** although `--filter @flowcanvas/ui` matched nothing ("No projects matched the filters"). pnpm exits 0 when a filter matches nothing; with the flag it exits 1, so a wrong filter fails at the build step with a clear message instead of later, confusingly, at deploy. Until then, use the **preview URL** of the `phase/1a-design-system` branch from the project's Deployments page.

**Commands (local):**

```fish
pnpm install
pnpm turbo run build-storybook --filter=@flowcanvas/ui
pnpm exec wrangler deploy --config packages/ui/wrangler.jsonc --dry-run   # "Read 99 files from the assets directory"
pnpm exec wrangler dev --config packages/ui/wrangler.jsonc --port 8788    # the catalogue in Cloudflare's runtime, headers applied
curl -sI http://127.0.0.1:8788/ | grep -i content-security-policy
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8788/project.json   # 404: not deployed

pnpm build --filter=@flowcanvas/web && pnpm exec wrangler dev --port 8787  # the app, strict CSP
E2E_BASE_URL=http://127.0.0.1:8787 pnpm --filter @flowcanvas/e2e test:e2e  # 2 passed, no CSP violations
pnpm test:visual                                                           # 68 passed
```

**Run and check it:**
1. **App** (`pnpm dev`, or the branch preview URL):
   - The page is centred on the canvas colour.
   - **Theme: System** opens a menu with a tick on System. Choose Light: the page turns light and the button says "Theme: Light".
   - Reload: it stays light.
   - Keyboard: Tab to the button, then Enter, arrows and Enter.
2. **Open the component catalogue:**
   - The link goes to the catalogue URL. It works once the owner's Cloudflare project has deployed `main`; until then, use the branch preview URL.
   - Use the toolbar's theme switch (paintbrush) to flip dark and light, and compare **Components → Flow node → Figma variants** and **Menu → Event actions** with the Figma Components page and screen 27.
3. **Accessibility tab:** 0 violations on component stories.
4. **Headers:** `curl -sI <catalogue URL>` shows the catalogue's CSP; `curl -sI <app URL>` shows the strict one.

**Gotchas:**
- **Don't move the catalogue under the app's domain** to save a project. It would need the app's CSP loosened (ADR 0010).
- **A file in `.storybook/public/` ships to the public catalogue.** Never put anything private there.
- **The theme menu's `onSelectionChange` can receive `'all'`.** Handle it, even though single selection never sends it.
- **Bundle size:** using React Aria's menu on the page added about 50 kB gzipped. Upgrade-later item 18 adds a budget before the canvas arrives.

**Commits:** `feat(ui): menu rows with icons, inline details and a shortcut keycap, as in Figma` · `feat(ui): single-choice menus with a tick, as in Figma's pickers` · `feat(web): restyle the version page with Graphite tokens, theme menu and catalogue link` · `feat(ui): deploy the component catalogue to its own Cloudflare Worker`

### Step 1a.12 — Close phase 1a

**Goal:** leave the phase documented, versioned and reviewable: architecture, changelog, status, report, the upgrade-later review, then a pull request that merges only with the owner's approval.

**What changed:**
- `ARCHITECTURE.md`: the new packages (`tokens`, `figma-tokens`, `ui`), a design-system pipeline diagram, the catalogue deploy path and the security posture.
- `CHANGELOG.md`: release `0.2.0`. The in-app "What's new" panel is built in phase 1b, which seeds it from this file.
- `docs/STATUS.md`: phase 1a **in review**.
- `docs/reports/phase-1a.md`: results per Done-when item, Figma comparison numbers, the by-eye checklist for screen-only components, evidence, deviations, ADRs 0007–0010, known issues, the upgrade-later review and the next phase.
- **Version 0.2.0** in the root `package.json`. The smoke test now reads the version from that file.

**Concept: cache inputs must include everything a build reads.**
- Turbo decides whether to rebuild from a hash of the package's files.
- The web build also reads the **root** `package.json` (for the version), which lives outside the package, so the bump reused the old cached build and the page still said 0.1.0. The updated smoke test caught it.
- Fix: in `turbo.json`, `"@flowcanvas/web#build"` gets `"inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/package.json"]`. The next run reported "cache miss" and the page showed 0.2.0.
- Docs: https://turborepo.com/docs/reference/configuration#inputs

**Run and check it (the phase):**

```fish
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test   # 143 unit/component tests
pnpm build && pnpm test:e2e                                     # 2 passed; page shows 0.2.0 · <commit>
pnpm test:visual                                                # 68 passed; report in e2e/visual-report/index.html
pnpm --filter @flowcanvas/ui storybook                          # catalogue on http://localhost:6006
```

Previews:
- app: `https://phase-1a-design-system-flowcanvas.ahujaarmaan7777.workers.dev`
- catalogue: `https://phase-1a-design-system-flowcanvas-catalogue.ahujaarmaan7777.workers.dev`

After the merge:
- staging: `https://flowcanvas.ahujaarmaan7777.workers.dev`
- catalogue: `https://flowcanvas-catalogue.ahujaarmaan7777.workers.dev`

**Commits:** `chore: release 0.2.0, close phase 1a` (docs, version, Turbo input)


## Phase 1b — See-and-test harness

**From the build plan:**
- **Build:** staging and per-PR preview URLs; "Open demo project" that starts the current stage's forks in workspaces; end-to-end tests that drive the browser app and record video; screenshot comparison against Figma exports; What's new; Labs switches.
- **Done when:** every merged phase produces a link, a test report and a recording without manual steps.
- **Try it:** open the preview link, click Open demo project, watch the recording in the CI report.

**Amended by the owner (29 Oct 2026, decisions log):**
- No automated Figma comparison. Figma is a reference reviewed by eye; visual tests compare against our own approved baselines.
- A six-repo, deliberately varied test corpus.
- The "Open demo project" button moves to phase 1d.
- Reports are published to a Cloudflare Worker.
- What's new and Labs are built from the existing components.
- CI stays on GitHub Actions; the owner clears the billing lock later.

**What we're doing and why:**
- After every change and every merge, CI (the "robot") builds the app, puts it at a link, runs all the tests, records a video of each phase's "Try it" walkthrough, publishes a report and posts the links on the PR. Nobody runs anything by hand.
- This is what lets the owner check every later phase without setup and without taking test results on trust. It also catches anything that breaks an earlier phase on the PR that broke it.
- In the app: **What's new** shows what changed in each build. **Labs** holds switches for half-built features, so they can go live hidden.
- The six test repos are frozen at exact commits, so later analysis is tested on varied, stable real code.

**Expected outcome:**
- Every PR and merge produces a preview link, a published report with videos of the walkthroughs, and a PR comment with both links.
- The app has a What's new panel and Settings → Labs.
- `corpus/manifest.json` pins six repos, and a check verifies each copy.

The CI parts were first verified locally with `act` (billing lock). They ran on GitHub on 31 Oct 2026, after the repository moved (step 9), and the phase was accepted.

### Steps (planned)

| # | Step | Status |
| --- | --- | --- |
| 1 | Retire the Figma comparison test (keep our own baselines and axe); docs | done · see commit below · Claude |
| 2 | Video and trace for every end-to-end test; one walkthrough file per phase (`e2e/try-it/`) | done · see commit below · Claude |
| 3 | `flowcanvas-reports` Worker: publish a run's report with videos at its own URL (owner: Cloudflare API token) | done · see commit below · Claude (code) + owner (token, secrets, `wrangler login`) · ADR 0011 |
| 4a | Visual tests in Playwright's Docker image, locally and in CI (one set of baselines) | done · see commit below · Claude · ADR 0012 |
| 4b | CI workflow: checks, visual, walkthroughs against the deployed preview or staging, publish the report, comment on the PR; verified with `actionlint` and `act` | done · `7b8536e` · Claude (owner: `act`, repo variable) · first GitHub run 31 Oct 2026 (step 9) |
| 5 | What's new: `CHANGELOG.md` turned into data at build time; panel in the app | done · see commit below · Claude |
| 6 | Labs: typed switch list (off by default, marked as preview), Settings → Labs page | done · see commit below · Claude · on the version page until the phase 2 Settings page |
| 7 | Test corpus: six pinned public forks, `corpus/manifest.json`, a check of fork, commit, licence and stack | done · see commit below · Claude (forks created with the owner's approval) |
| 8 | Close phase 1b: docs, report, PR | done · see commit below · Claude · phase in review until Actions runs |
| 9 | Move the repository to `ArmaanAhuja/Flowcanvas` and run CI on GitHub (resolves upgrade-later 8) | done · PR #7, merged as `157b55f` · owner (transfer, Cloudflare reconnect) + Claude (docs, fix, PR, checks) · phases 1 and 1b accepted |

### Step 1b.1 — Retire the Figma comparison test

**Goal:** remove the automated Figma comparison (owner decision, 29 Oct 2026) and everything that existed only for it. Keep the regression check against our own approved screenshots, and axe.

**Why:**
- Figma is now a reference reviewed by eye.
- A test for a dropped requirement is noise. It needs limits re-tuned whenever colours change, and it gives false confidence.
- Deleting the code it needed removes two dependencies to keep updated and patched.

**Concept: removing a test safely.** Search for every reference before deleting, so no helper, dependency, script, ignore rule or doc is left dangling. Here: `git grep -n "pixelmatch\|pngjs\|images.js\|report.js\|figma-exports\|visual-report\|figma.spec"`. Then run the whole suite and confirm the rest still passes.

**What changed:**

| Change | Files |
| --- | --- |
| Deleted the Figma test and its helpers | `e2e/visual/figma.spec.ts`, `images.ts`, `report.ts` |
| Removed dependencies only it used | `pixelmatch`, `pngjs`, `@types/pngjs` (e2e `package.json`, catalog, lockfile) |
| Deleted the three "Figma Variants" stories and their 6 baselines | `Tag`, `Button`, `FlowNode` stories; `e2e/visual/__screenshots__/components-*--figma-variants-*` |
| Dropped the unused ignore rule | `.gitignore` (`visual-report/`) |
| Exports kept as reference images, with a note | `docs/reference/figma-exports/README.md` |
| Docs | `ARCHITECTURE.md` (visual tests, token source) |

**A flake found, and its cause removed:**
- **What happened:** the first run after the change failed one screenshot by 2 pixels: the rounded corners of the Flow node that is both *added* and *analysing* (Combinations, dark).
- **Cause:** the browser draws animated elements (the analysing shimmer) on their own compositor layer, and their anti-aliased edges can differ by a shade between runs. With pixel-exact baselines (`threshold: 0`, since step 1a.12), that shows up as a change.
- **Fix:** rather than loosen the check, `e2e/visual/screenshot.css` (wired in through `stylePath` in `playwright.visual.config.ts`) turns all animations and transitions off while a screenshot is taken.
- **Result:** nothing visible changed (all 58 baselines still matched), and four consecutive runs passed.

```css
/* e2e/visual/screenshot.css */
*,
*::before,
*::after {
  animation: none !important;
  transition: none !important;
}
```

Docs: https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1-option-style-path

**Commands:**

```fish
pnpm install
pnpm lint && pnpm typecheck && pnpm test     # 30 tasks
pnpm test:visual                             # 58 passed (29 stories × 2 themes), each with axe
```

**Run and check it:**
1. `pnpm test:visual` gives 58 passed, with no "Figma comparison report" line.
2. `git grep -n "pixelmatch\|figma.spec"` finds only history in the docs.
3. `docs/reference/figma-exports/` still has your exports, with the README.

**Gotchas:**
- **Playwright never deletes baselines for removed tests.** Remove orphaned PNGs by hand.
- **Don't change `deviceScaleFactor`.** Every baseline would change.
- **A pixel-exact check needs a deterministic render.** Freeze anything animated before blaming the check.

**Commit:** `test(e2e): retire the Figma comparison; keep our own baselines and axe`

### Step 1b.2 — Record every walkthrough, one file per phase

**Goal:** every end-to-end walkthrough produces a **video** and a **trace**, pass or fail. Each phase's "Try it" steps live in one file named after the phase.

**Why:**
- The Done-when needs a recording without manual steps; Playwright used to keep videos only for failures.
- A recording is evidence the owner can check.
- One file per phase is the regression suite the build plan asks for: every walkthrough ever written runs on every change.

**Concepts:**
- **Video** (`video: { mode: 'on' }`): a `.webm` of the browser per test. https://playwright.dev/docs/videos
- **Trace** (`trace: 'on'`): a zip holding the page before and after every action, plus console, network and timings, scrubbed in the Trace Viewer. https://playwright.dev/docs/trace-viewer
- **`test.step()`:** named parts of a test, worded like the "Try it" column. They show in the report and the trace. https://playwright.dev/docs/api/class-test#test-step
- **Projects:** a named group of settings; here `try-it` records everything. https://playwright.dev/docs/test-projects
- **`slowMo`:** a pause after each browser action, 500 ms here, so a 2-second walkthrough becomes a watchable ~5 seconds. It doesn't change what is tested, and it isn't used by the visual suite.
- **HTML report:** each test with its steps, embedded video and trace link. `playwright show-report` serves it locally.

**What changed:**
- `e2e/tests/smoke.spec.ts` is split into `e2e/try-it/phase-1.spec.ts` (app loads, shows version and commit) and `e2e/try-it/phase-1a.spec.ts` (Theme → Light, reload keeps it, Theme → Dark, catalogue link). Both fail on any page error or CSP violation.
- `e2e/try-it/support.ts`: the product version from the root `package.json`, the expected commit from `E2E_EXPECTED_COMMIT`, and `watchForPageProblems()`.
- `e2e/playwright.config.ts`: `testDir: './try-it'`; one project `try-it` with video and trace on, 1280×720, `slowMo` 500.
- `e2e/package.json`: script `report` (`playwright show-report`). `e2e/tsconfig.json` includes `try-it`.

**`e2e/playwright.config.ts`:**

```ts
import { defineConfig, devices } from '@playwright/test';

// Point the tests at any deployed copy (PR preview, staging) with E2E_BASE_URL.
// Without it, Playwright serves the local production build of apps/web itself.
const externalBaseUrl = process.env.E2E_BASE_URL;
const localPreviewUrl = 'http://127.0.0.1:4173';
const isCi = Boolean(process.env.CI);

export default defineConfig({
  // One walkthrough file per phase: the build plan's "Try it" steps, run on every change.
  testDir: './try-it',
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: isCi
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBaseUrl ?? localPreviewUrl,
  },
  projects: [
    {
      // Every walkthrough is recorded, pass or fail, so anyone can watch exactly what was checked.
      name: 'try-it',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        video: { mode: 'on', size: { width: 1280, height: 720 } },
        trace: 'on',
        // A short pause after each browser action, so the video is watchable; it doesn't change what is tested.
        launchOptions: { slowMo: 500 },
      },
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command:
            'pnpm --filter @flowcanvas/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
          url: localPreviewUrl,
          reuseExistingServer: !isCi,
          timeout: 30_000,
        },
      }),
});
```

**`e2e/try-it/support.ts`:**

```ts
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// The product version lives in the root package.json; the page must show exactly that.
export const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/** Short commit the build under test must show, when the run knows it (CI, or a preview check). */
export const expectedCommit = process.env.E2E_EXPECTED_COMMIT?.slice(0, 7);

/**
 * Collects uncaught page errors and Content-Security-Policy violations for the whole walkthrough.
 * Call it before the first navigation; assert that `problems()` is empty at the end.
 */
export function watchForPageProblems(page: Page): { problems: () => string[] } {
  const found: string[] = [];
  page.on('pageerror', (error) => found.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      found.push(`CSP: ${message.text()}`);
    }
  });
  return { problems: () => [...found] };
}
```

**`e2e/try-it/phase-1.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';
import { expectedCommit, version, watchForPageProblems } from './support.js';

// Phase 1 · Try it: open the staging link; the app loads and shows its version.
test('phase 1: the app loads and shows its version', async ({ page }) => {
  const watch = watchForPageProblems(page);

  await test.step('Open the preview link', async () => {
    await page.goto('/');
    await expect(page).toHaveTitle('Flowcanvas');
    await expect(page.getByRole('heading', { name: 'Flowcanvas' })).toBeVisible();
  });

  await test.step('The page shows the version and the commit it was built from', async () => {
    const buildLine = expectedCommit
      ? `${version} · ${expectedCommit}`
      : new RegExp(`^${version.replaceAll('.', '\\.')} · [0-9a-f]{7}$`);
    await expect(page.getByText(buildLine)).toBeVisible();
  });

  expect(watch.problems()).toEqual([]);
});
```

**`e2e/try-it/phase-1a.spec.ts`:**

```ts
import { expect, test } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 1a · Try it: open the component catalogue, flip dark and light, compare with Figma.
// The app side of it: the theme menu and the link to the catalogue (which lives on its own origin).
test('phase 1a: switch theme and open the component catalogue', async ({ page }) => {
  const watch = watchForPageProblems(page);

  await test.step('Open the preview link', async () => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Theme: / })).toBeVisible();
  });

  await test.step('Choose Theme → Light', async () => {
    await page.getByRole('button', { name: /^Theme: / }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
  });

  await test.step('Reload: the choice is remembered', async () => {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  await test.step('Choose Theme → Dark', async () => {
    await page.getByRole('button', { name: 'Theme: Light' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  await test.step('The catalogue link points to the component catalogue', async () => {
    await expect(page.getByRole('link', { name: 'Open the component catalogue' })).toHaveAttribute(
      'href',
      /^https:\/\/flowcanvas-catalogue\./,
    );
  });

  expect(watch.problems()).toEqual([]);
});
```

**Commands:**

```fish
pnpm test:e2e                                  # 2 passed; builds the web app first
pnpm --filter @flowcanvas/e2e report           # opens the report: steps, video and trace per walkthrough
E2E_BASE_URL=https://phase-1b-see-and-test-flowcanvas.ahujaarmaan7777.workers.dev \
  E2E_EXPECTED_COMMIT=(git rev-parse HEAD) pnpm --filter @flowcanvas/e2e test:e2e   # against the branch preview
```

**Run and check it:**
1. `pnpm test:e2e` gives `2 passed`.
2. `pnpm --filter @flowcanvas/e2e report`: open each test. You see its named steps, a video of the browser doing them, and a trace (click it, then scrub the timeline).
3. `e2e/test-results/` has a `video.webm` and a `trace.zip` for **both** tests (about 1 MB in total).
4. Verified 29 Oct 2026 against the branch preview at `1d23c3b`: 2 passed.

**Gotchas:**
- **No video after a passing run:** the mode is `retain-on-failure`, or `video` is set outside the project.
- **Never commit `test-results/` or `playwright-report/`.** They're in `.gitignore`.
- **Keep `slowMo` out of the visual suite.**
- **ESLint must ignore Playwright's output.** With traces always on, `playwright-report/` bundles the trace viewer's JavaScript, and `pnpm lint` failed on it. `eslint.config.js` now ignores `**/playwright-report/`, `**/playwright-report-visual/` and `**/test-results/`. Fixed in a follow-up commit; the step's first commit was pushed with that lint failure, because the commit command didn't stop on the failed check. Chain checks with `&&` before `git commit`.
- **Word steps as the user would say them.** That's what the owner watches.

**Commit:** `test(e2e): record every walkthrough (video and trace), one try-it file per phase`

### Step 1b.3 — The reports site (`flowcanvas-reports`)

**Goal:** publish a test run (walkthrough videos and traces, plus the visual results) as a small site at its own link, which CI can post on PRs (step 4).

**Why:** the Done-when needs a report and recording reachable from a link without manual steps. CI artifacts need a login and expire after 90 days. The owner chose a free Cloudflare Worker.

**Concepts:**
- **Worker versions and preview aliases.** Each `wrangler versions upload` makes a version with its own unchanging URL. `--preview-alias pr-12` gives a readable URL that always shows the latest upload under that name, and `wrangler versions deploy` moves the Worker's main address to a version.
  - Docs: https://developers.cloudflare.com/workers/configuration/previews/
  - Aliases: lowercase letters, digits and dashes, starting with a letter, at most 63 characters together with the Worker name. The 1,000 most recent are kept.
  - Old version URLs' lifetime isn't documented.
- **A separate origin for reports.** Playwright's report and trace viewer need inline scripts, `blob:` media and a service worker. So, like the catalogue, the reports get their own Worker and looser headers, never the app's origin (ADR 0011).
- **API tokens and Actions secrets.** CI deploys with a token that can only edit Workers, stored encrypted as a GitHub secret. Workflows can read it; logs never show it. Docs: https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions
- **The JSON reporter.** Both Playwright configs also write `e2e/reports-data/*.json`. The index page reads the pass and fail counts from it.

**Owner steps (done 29 Oct 2026):**
1. A Cloudflare API token from the "Edit Cloudflare Workers" template, limited to the one account, no zones.
2. `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`. The prompt keeps the value out of shell history and files.
3. `pnpm exec wrangler login`, for publishing from this machine.

**What changed:**
- `e2e/reports.wrangler.jsonc`: Worker `flowcanvas-reports` serving `e2e/report-site/`, previews on.
- `e2e/reports/_headers`: the reports origin's CSP and headers, including `X-Robots-Tag: noindex, nofollow`.
- `e2e/scripts/publish-report.ts`:
  - assembles `report-site/`: an index page, `walkthroughs/` and `visual/`
  - uploads a version with `--alias`
  - optionally deploys it to the main address (`--production`)
  - creates the Worker on the very first publish
  - prints the links, and writes them to `reports-data/links.json` and, in CI, to the job summary
  - `--assemble-only` builds the folder without uploading, for `wrangler dev`
- Both Playwright configs add a JSON reporter. `e2e/package.json` gains `publish-report`; `tsconfig` includes `scripts`; `.gitignore` and `eslint.config.js` ignore `report-site/` and `reports-data/`.
- `docs/adr/0011-test-reports-on-workers.md`, `ARCHITECTURE.md`, and upgrade-later item 11: **reports must be protected before phase 1d**.

**`e2e/reports.wrangler.jsonc`:**

```jsonc
// Test reports and recordings, one version per run (ADR 0011). Published by scripts/publish-report.ts.
{
  "$schema": "../node_modules/wrangler/config-schema.json",
  "name": "flowcanvas-reports",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./report-site",
  },
  "preview_urls": true,
  "workers_dev": true,
  "send_metrics": false,
}
```

**`e2e/reports/_headers`:**

```text
# Security headers for the test-reports site (its own Worker and origin, ADR 0011).
# Playwright's HTML report and trace viewer need inline scripts and styles, blob: media and a service worker,
# so this policy is looser than the app's; that's why reports never share an origin with the app.
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Robots-Tag: noindex, nofollow
```

**`e2e/scripts/publish-report.ts`:**

```ts
/**
 * Publishes the latest test reports as one small site on the `flowcanvas-reports` Worker (ADR 0011):
 * an index page, the walkthroughs report (videos and traces) and, when present, the visual report.
 *
 *   node scripts/publish-report.ts --alias pr-12          a new version, also reachable as pr-12-flowcanvas-reports…
 *   node scripts/publish-report.ts --alias main --production   also make it the Worker's main address
 *   node scripts/publish-report.ts --alias x --assemble-only   build report-site/ only, for `wrangler dev`
 *
 * Needs Wrangler credentials: `wrangler login` locally, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in CI.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { parseArgs } from 'node:util';

const WORKER = 'flowcanvas-reports';
const here = new URL('../', import.meta.url);
const path = (relative: string): string => new URL(relative, here).pathname;

interface Summary {
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
}

interface Section {
  readonly name: string;
  readonly folder: string;
  readonly summary: Summary;
}

function fail(message: string): never {
  console.error(`publish-report: ${message}`);
  process.exit(1);
}

/** Aliases become a DNS label: lowercase letters, digits and dashes, starting with a letter, ≤ 63 with the name. */
function checkAlias(alias: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(alias)) {
    fail(`alias "${alias}" must be lowercase letters, digits and dashes, starting with a letter`);
  }
  if (alias.length + 1 + WORKER.length > 63) {
    fail(`alias "${alias}" is too long (at most ${String(62 - WORKER.length)} characters)`);
  }
  return alias;
}

function readSummary(file: string): Summary {
  const report = JSON.parse(readFileSync(file, 'utf8')) as {
    stats: { expected: number; unexpected: number; flaky: number; skipped: number };
  };
  const { expected, unexpected, flaky, skipped } = report.stats;
  return { passed: expected, failed: unexpected, flaky, skipped };
}

function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function indexPage(
  sections: readonly Section[],
  commit: string,
  branch: string,
  when: string,
): string {
  const rows = sections
    .map(({ name, folder, summary }) => {
      const state = summary.failed > 0 ? 'failed' : 'passed';
      const counts = [
        `${String(summary.passed)} passed`,
        summary.failed > 0 ? `${String(summary.failed)} failed` : '',
        summary.flaky > 0 ? `${String(summary.flaky)} flaky` : '',
        summary.skipped > 0 ? `${String(summary.skipped)} skipped` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<li><a href="${folder}/">${escape(name)}</a><span class="${state}">${escape(counts)}</span></li>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flowcanvas test report · ${escape(commit.slice(0, 7))}</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0b0c0e;color:#edeff2;font:13px/20px system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px;display:grid;gap:16px}h1{margin:0;font-size:20px;line-height:28px}
p{margin:0;color:#a3aab5}code{font:12px/18px ui-monospace,monospace;color:#edeff2}
ul{list-style:none;margin:0;padding:0;border:1px solid #2c323a;border-radius:8px;background:#111317}
li{display:flex;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:1px solid #2c323a}li:last-child{border-bottom:0}
a{color:#edeff2;font-weight:500}.passed{color:#65b186}.failed{color:#e39289}
</style></head><body><main>
<h1>Test report</h1>
<p>Commit <code>${escape(commit)}</code> on <code>${escape(branch)}</code> · ${escape(when)}</p>
<ul>
${rows}
</ul>
<p>Open a report to see each test's steps. Walkthroughs include a video and a trace (click it to step through every action).</p>
</main></body></html>
`;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      alias: { type: 'string' },
      production: { type: 'boolean', default: false },
      // Build report-site/ and stop: for checking the site locally with `wrangler dev`.
      'assemble-only': { type: 'boolean', default: false },
    },
  });
  if (values.alias === undefined) fail('pass --alias <name>, e.g. --alias pr-12');
  const alias = checkAlias(values.alias);

  const sources = [
    {
      name: 'Walkthroughs (try-it)',
      folder: 'walkthroughs',
      report: 'playwright-report',
      data: 'reports-data/walkthroughs.json',
    },
    {
      name: 'Visual and accessibility',
      folder: 'visual',
      report: 'playwright-report-visual',
      data: 'reports-data/visual.json',
    },
  ];
  const site = path('report-site/');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });

  const sections: Section[] = [];
  for (const source of sources) {
    if (!existsSync(path(source.report)) || !existsSync(path(source.data))) continue;
    cpSync(path(source.report), `${site}${source.folder}`, { recursive: true });
    sections.push({
      name: source.name,
      folder: source.folder,
      summary: readSummary(path(source.data)),
    });
  }
  if (!sections.some((section) => section.folder === 'walkthroughs')) {
    fail('no walkthroughs report found; run `pnpm test:e2e` first');
  }

  const commit = process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD');
  // GITHUB_HEAD_REF is set but empty outside pull requests, so an empty value falls through on purpose.
  const headRef = process.env.GITHUB_HEAD_REF;
  const branch =
    headRef !== undefined && headRef !== ''
      ? headRef
      : (process.env.GITHUB_REF_NAME ?? git('rev-parse', '--abbrev-ref', 'HEAD'));
  writeFileSync(`${site}index.html`, indexPage(sections, commit, branch, new Date().toUTCString()));
  cpSync(path('reports/_headers'), `${site}_headers`);

  if (values['assemble-only']) {
    console.log(`Assembled ${site} (not uploaded).`);
    return;
  }

  const config = path('reports.wrangler.jsonc');
  const message = `${branch} @ ${commit.slice(0, 7)}`;
  const uploadVersion = () =>
    spawnSync(
      'wrangler',
      ['versions', 'upload', '--config', config, '--preview-alias', alias, '--message', message],
      { encoding: 'utf8' },
    );
  let upload = uploadVersion();
  // A Worker must exist before it can have versions: the very first publish deploys it once, then uploads.
  if (
    upload.status !== 0 &&
    /does not (yet )?exist|not found|10007/i.test(`${upload.stdout}${upload.stderr}`)
  ) {
    const create = spawnSync('wrangler', ['deploy', '--config', config, '--message', message], {
      encoding: 'utf8',
    });
    if (create.status !== 0)
      fail(`creating the Worker failed:\n${create.stdout}\n${create.stderr}`);
    upload = uploadVersion();
  }
  const output = `${upload.stdout}\n${upload.stderr}`;
  if (upload.status !== 0) fail(`wrangler versions upload failed:\n${output}`);

  const urls = [...new Set(output.match(/https:\/\/[^\s"']+\.workers\.dev/g) ?? [])];
  const aliasUrl = urls.find((url) => url.startsWith(`https://${alias}-${WORKER}.`));
  const versionUrl = urls.find((url) => url !== aliasUrl);
  const versionId = /Worker Version ID:\s*([0-9a-f-]{36})/.exec(output)?.[1];

  let productionUrl: string | undefined;
  if (values.production) {
    if (versionId === undefined)
      fail(`could not read the version ID from Wrangler's output:\n${output}`);
    const deploy = spawnSync(
      'wrangler',
      [
        'versions',
        'deploy',
        `${versionId}@100%`,
        '--config',
        config,
        '--yes',
        '--message',
        message,
      ],
      { encoding: 'utf8' },
    );
    const deployOutput = `${deploy.stdout}\n${deploy.stderr}`;
    if (deploy.status !== 0) fail(`wrangler versions deploy failed:\n${deployOutput}`);
    productionUrl = aliasUrl?.replace(`https://${alias}-`, 'https://');
  }

  const links = { commit, branch, alias, aliasUrl, versionUrl, productionUrl, sections };
  writeFileSync(path('reports-data/links.json'), `${JSON.stringify(links, null, 2)}\n`);
  const lines = [
    `Report for ${message}`,
    aliasUrl ? `  latest for ${alias}: ${aliasUrl}` : '',
    versionUrl ? `  this run:          ${versionUrl}` : '',
    productionUrl ? `  main address:      ${productionUrl}` : '',
  ].filter(Boolean);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Test report\n\n${[aliasUrl, versionUrl, productionUrl]
        .filter(Boolean)
        .map((url) => `- ${String(url)}`)
        .join('\n')}\n`,
    );
  }
}

main();
```

**Commands:**

```fish
pnpm test:e2e && pnpm test:visual                              # produce both reports (+ JSON summaries)
pnpm --filter @flowcanvas/e2e publish-report --alias local-check --assemble-only
pnpm exec wrangler dev --config e2e/reports.wrangler.jsonc --port 8789   # check the site locally, headers applied
pnpm --filter @flowcanvas/e2e publish-report --alias local-check         # publish (uses your wrangler login)
```

**Run and check it (verified 29 Oct 2026, commit `600cfa1`):**
1. The publish prints:
   - `latest for local-check: https://local-check-flowcanvas-reports.ahujaarmaan7777.workers.dev`
   - `this run: https://23dca4f5-flowcanvas-reports.ahujaarmaan7777.workers.dev`
2. The index shows "Walkthroughs (try-it): 2 passed" and "Visual and accessibility: 58 passed", with the commit and branch.
3. Walkthroughs → phase 1a: the video plays; the trace opens online with the named steps (Open the preview link, Choose Theme → Light, …).
4. `curl -sI <link>` shows the reports CSP and `x-robots-tag`.
5. The Worker's main address `https://flowcanvas-reports.ahujaarmaan7777.workers.dev` exists, created by the first publish; from step 4 it shows the latest report from `main`.

**Gotchas:**
- **"You cannot upload a new version of a Worker that does not yet exist."** The first publish must deploy. The script matched "does not exist" but Wrangler says "does not **yet** exist", so the first try failed; the pattern now allows both.
- **One known console message:** "Framing '' violates … frame-src 'self'" comes from an empty placeholder frame in the trace viewer. Nothing visible is affected, so the policy stays strict.
- **Never paste the token into a command, a file or chat.** Use `gh secret set`'s prompt.
- **Reports are public by link.** Put them behind Access before phase 1d (upgrade-later 11).

**Commit:** `feat(e2e): publish test reports and recordings to their own Worker`

### Step 1b.4a — Visual tests in Playwright's Docker image

**Goal:** screenshots identical on every machine and in CI, so one set of approved baselines works everywhere (upgrade-later 16).

**Why:** baselines taken on CachyOS differ from Ubuntu's by 1–2% of pixels (font smoothing). With the pixel-exact check, CI would fail every screenshot.

**Concepts:**
- **Docker images as a fixed environment.** Playwright publishes an image with Ubuntu, the matching browsers and fonts (`mcr.microsoft.com/playwright:v1.64.1-noble`). The same image gives the same pixels anywhere. https://playwright.dev/docs/docker
- **Running a container as yourself.** `--user "$(id -u):$(id -g)"` makes files written into the mounted repo (screenshots, reports) yours, not root's. `-e HOME=/tmp` gives that user a writable home.
- **Mounting the repo at the same path,** so pnpm's links in `node_modules` resolve, and the installed packages are reused. Host and image are both x86-64 Linux; never run `pnpm install` inside, which would overwrite yours.
- **One script, two modes.** In CI the job already runs inside the image (`FLOWCANVAS_IN_PLAYWRIGHT_IMAGE=1`), so the script runs the tests directly instead of starting Docker inside Docker.

**What changed:**
- `e2e/scripts/visual.sh` (new):
  - starts the image (the tag follows `@playwright/test` in the catalog)
  - runs as you, mounts the repo, passes arguments such as `--update-snapshots` to Playwright
- `e2e/playwright.visual.config.ts`: the Storybook server starts with `node node_modules/vite/bin/vite.js preview` in `packages/ui`, because the image has Node but no pnpm.
- `e2e/package.json`: `test:visual` is `sh scripts/visual.sh`. Root `test:visual`/`test:visual:update` still build Storybook with Turbo first.
- **52 of 58 baselines retaken in the image.** They differ only in text smoothing; checked side by side.
- `docs/adr/0012-visual-tests-in-playwright-docker.md`, `ARCHITECTURE.md`; upgrade-later 16 closed.

**`e2e/scripts/visual.sh`:**

```sh
#!/bin/sh
# Runs the visual tests inside Playwright's official Docker image, on every machine and in CI, so screenshots
# are rendered by the same Linux, browser and fonts everywhere and the approved baselines match pixel for pixel.
# Arguments are passed to `playwright test` (e.g. --update-snapshots).
set -eu
cd "$(dirname "$0")/.."

# Already inside the image (CI's container job, or the docker run below): run the tests directly.
if [ "${FLOWCANVAS_IN_PLAYWRIGHT_IMAGE:-}" = 1 ]; then
  exec ./node_modules/.bin/playwright test --config playwright.visual.config.ts "$@"
fi

# The image version always follows the @playwright/test version in the catalog.
version=$(sed -n "s/^  '@playwright\/test': //p" ../pnpm-workspace.yaml)
image="mcr.microsoft.com/playwright:v${version}-noble"
root=$(cd .. && pwd)

# Reuses the installed node_modules (same Linux platform), runs as you so files aren't owned by root,
# and mounts the repo at the same path so pnpm's links resolve.
exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI -e FLOWCANVAS_IN_PLAYWRIGHT_IMAGE=1 \
  -v "$root:$root" -w "$root/e2e" \
  "$image" sh scripts/visual.sh "$@"
```

**Commands:**

```fish
docker pull mcr.microsoft.com/playwright:v1.64.1-noble   # once, about 3.6 GB on disk (pnpm test:visual pulls it if missing)
pnpm test:visual            # 58 passed, inside the image
pnpm test:visual:update     # only after reviewing a deliberate visual change
```

**Run and check it (29 Oct 2026):**
1. `pnpm test:visual` gives 58 passed. The run shows no Docker output, but `docker ps` during the run shows the Playwright container.
2. Two repeat runs: 58 passed each.
3. `stat -c %U e2e/visual/__screenshots__/*.png | sort -u` gives your user, not `root`.

**Gotchas:**
- **"Cannot connect to the Docker daemon":** start Docker (`systemctl start docker`), and make sure your user is in the `docker` group.
- **Screenshots or reports owned by root:** the container ran without `--user`. Fix with `sudo chown -R $USER e2e`.
- **Upgrading Playwright** changes the image tag; review and re-approve the baselines.
- **Don't run `pnpm install` inside the container.** It shares your `node_modules`.

**Commit:** `test(e2e): run visual tests in the Playwright Docker image`

### Step 1b.4b — The CI workflow

**Goal:** on every PR and every push to `main`, GitHub Actions does everything with no manual steps:
1. checks
2. visual tests (in the Playwright image)
3. walkthroughs against the **deployed** preview, or staging on `main`
4. publishing the report
5. one PR comment with the links

Until the billing lock is lifted, the workflow is verified locally.

**Concepts:**
- **Jobs, `needs:` and artifacts.** Jobs run on fresh machines; `needs:` orders them; artifacts carry files between them (both reports go to `publish`). https://docs.github.com/actions/writing-workflows
- **Container jobs.** `container:` runs a job inside the Playwright image, the same one as `pnpm test:visual` locally (ADR 0012). A first step checks the tag matches `@playwright/test` in the catalog.
- **Testing what's deployed.** Cloudflare builds the preview while CI runs. `e2e/scripts/wait-for-deploy.ts` reads the page's JavaScript bundle until it contains this commit, with a 10-minute limit, then the walkthroughs run against that URL.
  - The branch preview address is the branch name lowercased, with every run of other characters turned into `-`, then `-flowcanvas.<subdomain>.workers.dev`.
  - The subdomain comes from the repo variable `CLOUDFLARE_WORKERS_SUBDOMAIN`.
- **`if: ${{ !cancelled() }}`** runs `publish` even when tests failed, so failures get a report too. `cancel-in-progress` only for PRs, so every merge to `main` gets its report.
- **Least privilege.** The workflow is read-only. Only `publish` gets `pull-requests: write`, and only it sees the Cloudflare secrets. Fork PRs have no secrets, so publishing and commenting are skipped instead of failing.
- **One updating comment.** `gh pr comment --edit-last --create-if-none` edits CI's previous comment instead of adding one per push.
- **`actionlint`** checks workflow syntax, expressions and shell scripts without running anything. https://github.com/rhysd/actionlint
- **`act`** runs workflow jobs locally in Docker, from the **committed** state of the commit under test. Uncommitted edits aren't used, exactly as on GitHub. https://nektosact.com

**What changed:**
- `.github/workflows/ci.yml` rewritten with four jobs: `checks`, `visual`, `walkthroughs`, `publish`. Every action is pinned to a commit SHA; `actions/download-artifact` v8.0.2 is new.
- `e2e/scripts/wait-for-deploy.ts` (new).
- `e2e/scripts/publish-report.ts` also writes `reports-data/comment.md`. `PREVIEW_URL` adds the preview link.
- Owner: `act` installed (`sudo pacman -S act`, 0.2.89); repo variable `CLOUDFLARE_WORKERS_SUBDOMAIN` set.

**`.github/workflows/ci.yml`:**

```yaml
name: CI

# On every pull request and every push to main: checks, visual tests, walkthroughs against the deployed
# preview (or staging), then one published report with videos, linked from the PR (phase 1b).

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  # Cancel superseded PR runs; let every main run finish so each merge gets its report.
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

env:
  TURBO_TELEMETRY_DISABLED: 1
  # Test the commit that was pushed, not GitHub's temporary merge commit.
  COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}

jobs:
  checks:
    name: Lint, typecheck, unit tests, build
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ env.COMMIT }}
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  visual:
    name: Visual and accessibility (catalogue)
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    # Same image as `pnpm test:visual` on every machine, so the approved screenshots match (ADR 0012).
    # Keep the tag equal to @playwright/test in pnpm-workspace.yaml (checked below).
    container:
      image: mcr.microsoft.com/playwright:v1.64.1-noble
      options: --ipc=host --init
    env:
      FLOWCANVAS_IN_PLAYWRIGHT_IMAGE: 1
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ env.COMMIT }}
      - name: Image matches the Playwright version
        run: |
          expected="v$(sed -n "s/^  '@playwright\/test': //p" pnpm-workspace.yaml)-noble"
          grep -q "mcr.microsoft.com/playwright:${expected}" .github/workflows/ci.yml \
            || { echo "Update the container image in ci.yml to playwright:${expected}"; exit 1; }
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:visual
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: ${{ !cancelled() }}
        with:
          name: report-visual
          path: |
            e2e/playwright-report-visual/
            e2e/reports-data/visual.json
          retention-days: 14

  walkthroughs:
    name: Walkthroughs (try-it) on the deployed app
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    container:
      image: mcr.microsoft.com/playwright:v1.64.1-noble
      options: --ipc=host --init
    outputs:
      url: ${{ steps.deploy.outputs.url }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ env.COMMIT }}
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Cloudflare builds the preview (PRs) or staging (main) at the same time; wait for this exact commit.
      - name: Wait for the deployment of this commit
        id: deploy
        working-directory: e2e
        env:
          CLOUDFLARE_WORKERS_SUBDOMAIN: ${{ vars.CLOUDFLARE_WORKERS_SUBDOMAIN }}
          HEAD_REF: ${{ github.head_ref }}
        run: |
          if [ "$GITHUB_EVENT_NAME" = pull_request ]; then
            node scripts/wait-for-deploy.ts --branch "$HEAD_REF" --commit "$COMMIT"
          else
            node scripts/wait-for-deploy.ts --url "https://flowcanvas.${CLOUDFLARE_WORKERS_SUBDOMAIN}.workers.dev/" --commit "$COMMIT"
          fi
      - name: Walkthroughs
        run: pnpm --filter @flowcanvas/e2e test:e2e
        env:
          E2E_BASE_URL: ${{ steps.deploy.outputs.url }}
          E2E_EXPECTED_COMMIT: ${{ env.COMMIT }}
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: ${{ !cancelled() }}
        with:
          name: report-walkthroughs
          path: |
            e2e/playwright-report/
            e2e/reports-data/walkthroughs.json
          retention-days: 14

  publish:
    name: Publish report and comment
    needs: [visual, walkthroughs]
    # Also after failures, so a failing run still gets a report; never for cancelled runs.
    if: ${{ !cancelled() }}
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ env.COMMIT }}
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          pattern: report-*
          path: e2e
          merge-multiple: true
      # Secrets aren't available to pull requests from forks; skip publishing there instead of failing.
      - name: Publish the report
        if: ${{ env.CLOUDFLARE_API_TOKEN != '' }}
        working-directory: e2e
        env:
          PREVIEW_URL: ${{ needs.walkthroughs.outputs.url }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          if [ "$GITHUB_EVENT_NAME" = pull_request ]; then
            pnpm publish-report --alias "pr-$PR_NUMBER"
          else
            pnpm publish-report --alias main --production
          fi
      - name: Comment on the pull request
        if: ${{ github.event_name == 'pull_request' && env.CLOUDFLARE_API_TOKEN != '' && github.event.pull_request.head.repo.full_name == github.repository }}
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: gh pr comment "$PR_NUMBER" --edit-last --create-if-none --body-file e2e/reports-data/comment.md
```

**`e2e/scripts/wait-for-deploy.ts`:**

```ts
/**
 * Waits until a deployed copy of the web app serves a given commit, so tests never run against the
 * previous deployment while Cloudflare is still building (it starts at the same time as CI).
 *
 *   node scripts/wait-for-deploy.ts --branch phase/1b-see-and-test --commit <sha>   the branch's preview
 *   node scripts/wait-for-deploy.ts --url https://flowcanvas.<sub>.workers.dev --commit <sha>   e.g. staging
 *
 * The subdomain comes from CLOUDFLARE_WORKERS_SUBDOMAIN. Prints the URL, and writes `url=` to GITHUB_OUTPUT in CI.
 */
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const WORKER = 'flowcanvas';

function fail(message: string): never {
  console.error(`wait-for-deploy: ${message}`);
  process.exit(1);
}

/**
 * Cloudflare's branch alias for a Workers Builds preview: lowercase, every run of other characters becomes a
 * dash, trimmed, and short enough that `<alias>-flowcanvas` fits a 63-character DNS label.
 */
function branchAlias(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 62 - WORKER.length)
    .replace(/-+$/, '');
}

/** The commit the deployment was built from, read from its JavaScript bundle (the version line embeds it). */
async function servesCommit(base: string, shortCommit: string): Promise<boolean> {
  const page = await fetch(base, { cache: 'no-store' });
  if (!page.ok) return false;
  const html = await page.text();
  const scripts = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  for (const script of scripts) {
    if (script === undefined) continue;
    const bundle = await fetch(new URL(script, base), { cache: 'no-store' });
    if (bundle.ok && (await bundle.text()).includes(shortCommit)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      branch: { type: 'string' },
      commit: { type: 'string' },
      timeout: { type: 'string', default: '600' },
    },
  });
  if (values.commit === undefined || !/^[0-9a-f]{7,40}$/.test(values.commit)) {
    fail('pass --commit <sha>');
  }
  const shortCommit = values.commit.slice(0, 7);
  let base = values.url;
  if (base === undefined) {
    const subdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN;
    if (values.branch === undefined || subdomain === undefined || subdomain === '') {
      fail('pass --url, or --branch with CLOUDFLARE_WORKERS_SUBDOMAIN set');
    }
    base = `https://${branchAlias(values.branch)}-${WORKER}.${subdomain}.workers.dev/`;
  }

  const deadline = Date.now() + Number(values.timeout) * 1000;
  console.log(`Waiting for ${base} to serve ${shortCommit}…`);
  for (;;) {
    try {
      if (await servesCommit(base, shortCommit)) break;
    } catch (error) {
      console.log(`  not reachable yet (${(error as Error).message})`);
    }
    if (Date.now() > deadline) {
      fail(
        `${base} still doesn't serve ${shortCommit} after ${values.timeout} s. Check the Cloudflare build.`,
      );
    }
    await sleep(10_000);
  }
  console.log(`${base} serves ${shortCommit}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `url=${base}\n`);
}

await main();
```

**Commands (local verification):**

```fish
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12          # no output = no problems
# A sample PR event for this branch (head.sha = the pushed commit under test)
act pull_request -j checks -e pr-event.json -P ubuntu-24.04=catthehacker/ubuntu:act-24.04 \
  --var CLOUDFLARE_WORKERS_SUBDOMAIN=ahujaarmaan7777 --artifact-server-path /tmp/act-artifacts
act pull_request -j visual …          # same flags
act pull_request -j walkthroughs …    # waits for the branch preview at that commit
# The publish job's script, with the same inputs:
PREVIEW_URL=<preview> pnpm --filter @flowcanvas/e2e publish-report --alias pr-test
```

**Results (29 Oct 2026, commit `7b8536e`):**

| Check | Result |
| --- | --- |
| `actionlint` | no problems |
| `act` checks | all steps pass: install, format, lint, types, unit tests, build |
| `act` visual | version check, install inside the image, `pnpm test:visual`: 58 passed |
| `act` walkthroughs | waited until the preview served `7b8536e` (2 s, already built), then 2 passed against it |
| publish path | `https://pr-test-flowcanvas-reports.ahujaarmaan7777.workers.dev` live; `comment.md` lists the preview, report and run links and both suites' results |
| Fails when it should | `wait-for-deploy` with a commit that isn't deployed exits 1 after the limit; the version check failed on a commit whose workflow lacked the image |

**Not verifiable locally** (done in upgrade-later 8, before phase 1b is accepted):
- **`upload-artifact`** fails under `act` with "Unexpected end of JSON input". `act`'s local artifact server doesn't speak the protocol `upload-artifact` v7 uses, so the artifact hand-off to `publish` can't run locally.
- **The real PR comment** needs a PR and the Actions token.

**Gotchas:**
- **`act` tests the committed state** of the commit under test. Commit (and push, for the walkthroughs' preview) before running it.
- **A Playwright upgrade must also change the container tag** in `ci.yml`; the version check fails the run until it does.
- **Branch names map to preview addresses** by the alias rule above. If Cloudflare ever changes it, pass `--url` to `wait-for-deploy`.

**Commit:** `ci: test the deployed preview, publish reports and comment on PRs`

### Step 1b.5 — What's new

**Goal:** an in-app panel listing what changed in this build and how to try it, generated from `CHANGELOG.md` so it can never disagree with the changelog.

**Concepts:**
- **Build-time data with a Vite virtual module.**
  - A plugin answers `import releases from 'virtual:changelog'` by reading and parsing the root `CHANGELOG.md` during the build. The app ships plain data with no runtime fetch, and the dev server reloads when the changelog changes.
  - TypeScript learns the module's type from `src/changelog/virtual-changelog.d.ts`.
  - Docs: https://vite.dev/guide/api-plugin#virtual-modules-convention
- **Ambient module declarations and types.** Inside `declare module '…' { }`, a relative `import` statement isn't allowed. `tsc` let it pass, but ESLint's type-aware rules then saw the module as untyped. An inline `import('./parse').ChangelogRelease` type works for both.
- **Parsing a known format** ([Keep a Changelog](https://keepachangelog.com)):
  - releases (`## [x.y.z] — date — title`), sections (`### Added`), bullet or numbered items, wrapped lines
  - `Unreleased` is skipped, because it isn't in any build
  - inline `**bold**` and `` `code` `` become React elements, **never HTML**, so changelog text can't inject markup (a test checks this)
- **Guard tests that keep docs honest:** the newest changelog release must equal the root `package.json` version, and every release needs a date and content. Bumping the version without a changelog entry fails `pnpm test`.
- **Cache inputs again.** `CHANGELOG.md` lives outside `apps/web`, so it's an explicit Turbo input of `@flowcanvas/web#build` and `#test` (the version-bump lesson from 1a).
- **A reusable Popover** (`@flowcanvas/ui`): a non-modal React Aria `Dialog` in a `Popover`, named by its title. Opens from its trigger (`PopoverButton`) by click, Enter or Space; Escape or an outside click closes it, and focus returns to the trigger. Long content scrolls inside it.
- **The accessibility check caught a real bug.** axe flagged `scrollable-region-focusable`: keyboard users couldn't scroll a long popover, because nothing inside could take focus. The scroll area is now focusable (`tabIndex={0}`) and shows the focus ring (WCAG 2.1.1).
- **"Changed since you last looked."** The latest release's version is stored in `localStorage` (`flowcanvas-whats-new-seen`) when the panel opens; reading and writing tolerate blocked storage. Until then, the button shows a small dot in the *modified* hue (Graphite keeps the accent for selection), and its accessible name says "(new changes)".

**What changed:**

| Area | Files |
| --- | --- |
| Parser and tests (8, incl. the guard on the real changelog) | `apps/web/src/changelog/parse.ts`, `parse.test.ts` |
| Vite plugin and type | `apps/web/vite.config.ts` (`changelog()`), `src/changelog/virtual-changelog.d.ts` |
| Panel content and seen memory | `apps/web/src/whats-new/WhatsNew.tsx`, `.module.css`, `seen.ts`, `WhatsNew.test.tsx` |
| Version page: "What's new" button with dot and popover | `apps/web/src/App.tsx`, `App.module.css`, `App.test.tsx` |
| Popover component, tests, stories (6 baselines) | `packages/ui/src/components/popover/` |
| Changelog: a **Try it** section for 0.2.0; tokens wording updated | `CHANGELOG.md` |
| Walkthrough | `e2e/try-it/phase-1b.spec.ts` |
| Turbo inputs | `turbo.json` |

**Commands:**

```fish
pnpm test                    # web 18 · ui 66 · all packages
pnpm test:e2e                # 3 walkthroughs (phase 1, 1a, 1b), recorded
pnpm test:visual             # 64 passed (incl. Popover stories), axe on each
pnpm dev                     # open http://localhost:5173 and click "What's new"
```

**Run and check it:**
1. `pnpm dev` and open the app. **What's new** shows a small amber dot.
2. Click it: "What's new in 0.2.0" with "Phase 1a: design system in code · 2026-10-28", then **Try it** (numbered), **Added**, **Changed**, **Security**, and **Earlier releases** (0.1.0, folded).
3. Press Escape: focus returns to the button and the dot is gone. Reload: it stays gone.
4. Edit `CHANGELOG.md` while `pnpm dev` runs: the panel updates.
5. Verified 29 Oct 2026: walkthroughs pass under `wrangler dev` with the production CSP; screenshots checked in both themes.

**Gotchas:**
- **Every release needs a changelog entry** with the same version as `package.json`, or `pnpm test` fails.
- **Write "Try it" steps in the user's words.** They're what the panel shows first.
- **The changelog is rendered as text,** with only bold and code. Links and HTML are shown literally, by design.

**Commit:** `feat(web): What's new panel built from the changelog`

### Step 1b.6 — Labs

**Goal:** unfinished features can go live behind a switch: off by default, marked **Preview**, and switchable by the owner to try them early, while normal use is unaffected and `main` stays shippable.

**Concepts:**
- **Feature flags.** `<LabsFeature id="…">` renders its contents only while that switch is on. Half-built work merges and deploys but stays invisible.
- **One typed registry** (`apps/web/src/labs/flags.ts`).
  - Each switch has an id, label, description of what is unfinished, and the phase that finishes it.
  - A test enforces the rules: unique kebab-case ids, sentence-case labels, a real description, a phase number.
  - When a feature is finished, delete its entry and wrappers.
- **React context** (`LabsProvider`, `useLabs`) holds switch states once for the app. https://react.dev/learn/passing-data-deeply-with-context
- **Testing without a fake product feature.** The provider takes a `flags` list, so tests inject a test-only switch and the real registry stays empty. The panel then says honestly "No previews right now".
- **Stored per browser for now** (`localStorage`, key `flowcanvas-labs`). Only known switches that are on are read back; junk and blocked storage mean "everything off". Per account after sign-in: upgrade-later 20.
- **Accessible switches.** Each `Toggle` is named by its row's label (`aria-labelledby`) and described by its description (`aria-describedby`), so a screen reader hears "Canvas minimap, switch, off, Shows … Finished in phase 2."

**Where it lives:** the build plan says "Settings → Labs". There's no Settings page until the app shell (phase 2), so for now a **Labs** button on the version page opens a Popover with the switches, styled as Figma 17 settings rows.

**What changed:**

| Area | Files |
| --- | --- |
| Registry (empty), storage, provider, `LabsFeature`, panel | `apps/web/src/labs/flags.ts`, `storage.ts`, `LabsProvider.tsx`, `LabsPanel.tsx`, `LabsPanel.module.css` |
| Tests (6): off by default and marked Preview; on shows the feature and is remembered; off hides it; honest empty state; storage tolerance; registry rules | `apps/web/src/labs/labs.test.tsx` |
| Version page: `LabsProvider` around the app; **Labs** popover | `apps/web/src/App.tsx`; `App.test.tsx` (+1) |
| Walkthrough: open Labs, it says no previews, Escape closes | `e2e/try-it/phase-1b.spec.ts` |
| Docs | `ARCHITECTURE.md`; upgrade-later 20 |

**Commands:**

```fish
pnpm --filter @flowcanvas/web test     # 25 passed
pnpm test:e2e                          # 4 walkthroughs, recorded
pnpm dev                               # click Labs
```

**Run and check it:**
1. `pnpm dev`, then click **Labs**: "No previews right now. Unfinished features appear here as switches, off by default, so you can try them early."
2. **Adding a switch later** (for example in phase 2): add an entry to `LABS_FLAGS`, and wrap the feature in `<LabsFeature id="…">`. The switch then appears in Labs, off, with a **Preview** tag; turning it on shows the feature and is remembered in this browser.
3. Verified 29 Oct 2026: 4 walkthroughs pass locally and under `wrangler dev` with the production CSP; the panel was checked by eye in dark.

**Gotchas:**
- **Never ship a switch on by default.** If it's ready for everyone, delete the switch.
- **Don't rename a switch id.** Stored choices would be lost; add a new one instead.
- **Labs isn't access control.** Anyone can turn a switch on, so never hide something unsafe behind it.

**Commit:** `feat(web): Labs switches for unfinished features`

### Step 1b.7 — The test corpus

**Goal:** six real, deliberately varied open-source apps, frozen at exact commits, which every phase from 1d on is tested against. Plus an automatic check that they stay as pinned.

**Owner decisions (29 Oct 2026):**
- **public forks**, not private copies
- **LibreChat instead of Inbox Zero** (licence)
- Claude created the forks

**Concepts:**
- **Why pin a test repo to a commit.** The originals change every day. If tests followed them, a failure could mean "our code broke" or "their code changed", and you couldn't tell which. A pinned commit is a fixed target, re-pinned on purpose.
- **Forks.** `POST /repos/{owner}/{repo}/forks` (with `default_branch_only`) copies a repo on GitHub's side in seconds, with no download. `gh repo fork` run from inside our repo got confused by our own git remote and silently did nothing; the API call doesn't depend on the current folder.
- **Reading licences, not just badges.** GitHub's `license` field said `NOASSERTION` for three repos. Reading the files showed:
  - **Inbox Zero:** AGPL plus extra commercial restrictions (replaced).
  - **Twenty:** mostly AGPL, with some Enterprise-licensed files and some MIT packages.
  - **Medusa:** MIT, plus Enterprise Edition materials.

  Documenso, licensed AGPL, also has a commercial `packages/ee`. Rule: never enable those parts.
- **Evidence over memory.** Each repo's stack was confirmed from its own `package.json` files at the pinned commit. Four guesses were wrong about *where* a dependency lives (for example, Documenso's Prisma is in the root `package.json`), so the manifest records the file that proves each part.
- **A licence fingerprint.** The SHA-256 of each licence file at the pin. If a re-pin brings a changed licence, the check fails and someone reads it before moving on.
- **Checking through the API, not by cloning.** `pnpm corpus:check` makes about 35 small API calls; nothing is cloned. `GITHUB_TOKEN` raises the rate limit: locally `GITHUB_TOKEN=(gh auth token)`, in CI the workflow's token.
- **Testable network code.** `checkRepo()` takes a small `GitHubApi` interface, so the unit tests replace GitHub with fixed answers and cover every failure without the network.

**The corpus** (`corpus/manifest.json`, pinned to each default branch at 2026-10-15T00:00:00Z):

| Repo | Fork | Commit | Licence | Why |
| --- | --- | --- | --- | --- |
| Rallly | ArmaanAhuja-7777/rallly | `8e67a21` | AGPL-3.0 | Small Next.js + tRPC + Prisma: the baseline |
| Documenso | ArmaanAhuja-7777/documenso | `d4e6eea` | AGPL-3.0 (+ commercial `ee`) | React Router, Hono, PDFs, email, BullMQ and Inngest jobs |
| LibreChat | ArmaanAhuja-7777/LibreChat | `9adabde` | MIT | Express + MongoDB, AI providers, OAuth; React on Vite |
| Twenty | ArmaanAhuja-7777/twenty | `c3ba140` | AGPL-3.0 (+ Enterprise files, MIT packages) | NestJS, TypeORM, GraphQL, BullMQ; large monorepo |
| Excalidraw | ArmaanAhuja-7777/excalidraw | `4c37956` | MIT | Client-only Vite + React, canvas, real-time collaboration |
| Medusa | ArmaanAhuja-7777/medusa | `0b97a96` | MIT (+ Enterprise Edition) | Express-based framework, MikroORM, modules, workflows |

**What changed:**
- New workspace package `@flowcanvas/corpus`:
  - `manifest.json`
  - `src/manifest.ts`: types, and structural rules checked offline
  - `src/check.ts`: the per-repo check and the GitHub client
  - `scripts/check-corpus.ts`: the command-line tool
  - `src/check.test.ts`: 10 offline tests, including every failure case and the real manifest's rules
- `pnpm-workspace.yaml` includes `corpus`; root script `corpus:check`.
- CI's checks job runs `pnpm corpus:check` with the workflow token.
- Docs: the decisions log, the build-plan amendment (LibreChat), `CLAUDE.md` rule 8 (public forks, never copy code, never enable commercial parts), upgrade-later 11 and ADR 0011 (the reports deadline is relaxed), `ARCHITECTURE.md`.

**`corpus/src/check.ts`:**

```ts
import { createHash } from 'node:crypto';
import type { CorpusRepo } from './manifest.ts';

/** Minimal GitHub API access, so tests can replace the network with fixed answers. */
export interface GitHubApi {
  /** Parsed JSON for an API path, or undefined for 404. */
  readonly json: (path: string) => Promise<unknown>;
  /** A file's raw content at a commit, or undefined if it doesn't exist. */
  readonly raw: (repo: string, file: string, commit: string) => Promise<string | undefined>;
}

export interface CheckResult {
  readonly repo: string;
  readonly ok: boolean;
  readonly lines: readonly string[];
}

function dependencies(packageJson: string): Set<string> {
  const parsed = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined>;
  return new Set([
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {}),
    ...Object.keys(parsed.peerDependencies ?? {}),
  ]);
}

/** Checks one pinned repo: the fork, the commit, the licence and the stack evidence. */
export async function checkRepo(repo: CorpusRepo, api: GitHubApi): Promise<CheckResult> {
  const lines: string[] = [];
  let ok = true;
  const pass = (text: string) => lines.push(`  ✓ ${text}`);
  const failWith = (text: string) => {
    ok = false;
    lines.push(`  ✗ ${text}`);
  };

  const info = (await api.json(`repos/${repo.fork}`)) as
    { fork?: boolean; private?: boolean; parent?: { full_name?: string } } | undefined;
  if (info === undefined) {
    failWith(`fork ${repo.fork} not found`);
    return { repo: repo.id, ok, lines };
  }
  if (info.fork === true && info.parent?.full_name?.toLowerCase() === repo.upstream.toLowerCase()) {
    pass(`${repo.fork} is a fork of ${repo.upstream}`);
  } else {
    failWith(`${repo.fork} is not a fork of ${repo.upstream}`);
  }
  if (info.private === false) pass('public');
  else failWith('fork must be public (decisions log, 29 Oct 2026)');

  const compare = (await api.json(`repos/${repo.fork}/compare/${repo.commit}...${repo.branch}`)) as
    { status?: string } | undefined;
  if (compare?.status === 'ahead' || compare?.status === 'identical') {
    pass(`commit ${repo.commit.slice(0, 7)} is on ${repo.branch}`);
  } else {
    failWith(
      `commit ${repo.commit.slice(0, 7)} is not on ${repo.branch} (${compare?.status ?? 'not found'})`,
    );
  }

  const licence = await api.raw(repo.fork, repo.licence.file, repo.commit);
  const digest =
    licence === undefined ? undefined : createHash('sha256').update(licence).digest('hex');
  if (digest === repo.licence.sha256) pass(`${repo.licence.file} unchanged (${repo.licence.spdx})`);
  else
    failWith(
      `${repo.licence.file} ${licence === undefined ? 'missing' : 'changed'}: review the licence before re-pinning`,
    );

  for (const evidence of repo.stack) {
    const file = await api.raw(repo.fork, evidence.file, repo.commit);
    if (file === undefined) {
      failWith(`${evidence.file} missing`);
      continue;
    }
    const present = dependencies(file);
    const missing = evidence.packages.filter((name) => !present.has(name));
    if (missing.length === 0) pass(`${evidence.file}: ${evidence.packages.join(', ')}`);
    else failWith(`${evidence.file}: missing ${missing.join(', ')}`);
  }
  return { repo: repo.id, ok, lines };
}

/** The real GitHub REST API; uses GITHUB_TOKEN when set (higher rate limit), anonymous otherwise. */
export function gitHubApi(token = process.env.GITHUB_TOKEN): GitHubApi {
  const headers = (accept: string): Record<string, string> => ({
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'flowcanvas-corpus-check',
    ...(token !== undefined && token !== '' ? { Authorization: `Bearer ${token}` } : {}),
  });
  const get = async (path: string, accept: string): Promise<Response | undefined> => {
    const response = await fetch(`https://api.github.com/${path}`, { headers: headers(accept) });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub API ${String(response.status)} for ${path}`);
    return response;
  };
  return {
    json: async (path) => (await get(path, 'application/vnd.github+json'))?.json(),
    raw: async (repo, file, commit) =>
      (
        await get(`repos/${repo}/contents/${file}?ref=${commit}`, 'application/vnd.github.raw')
      )?.text(),
  };
}
```

**Commands:**

```fish
pnpm install
pnpm --filter @flowcanvas/corpus test                 # 10 passed (offline)
GITHUB_TOKEN=(gh auth token) pnpm corpus:check        # 6 of 6 repos pass
```

**Run and check it (verified 29 Oct 2026):**
1. `pnpm corpus:check` prints, for each repo:
   - ✓ fork of the original
   - ✓ public
   - ✓ commit on its branch
   - ✓ licence unchanged
   - ✓ each stack file and its packages

   It ends with "6 of 6 repos pass."
2. Open any fork on GitHub, for example https://github.com/ArmaanAhuja-7777/rallly, and look at the pinned commit with `/commit/8e67a21…`.
3. To see a failure, change one character of a `sha256` in `manifest.json`, then run the check again: "LICENSE changed: review the licence before re-pinning". Revert afterwards.

**Gotchas:**
- **Never copy a corpus repo's code into this repository.** AGPL could then apply to our code.
- **Re-pinning is a deliberate change.** Update `commit`, re-check the stack evidence, and read the licence if its hash changes.
- **Never enable commercial or enterprise parts** of a corpus repo.
- **Forks you push to are public.** Never put secrets or real data in them.

**Commit:** `feat(corpus): six pinned public test repos with a fork, commit, licence and stack check`

### Step 1b.8 — Close phase 1b

**Goal:** leave the phase versioned, documented and reviewable: version 0.3.0, the changelog (which feeds What's new), the report, status and architecture, everything re-run on a fresh clone, and a PR. The phase stays **in review** until GitHub Actions can prove the Done-when.

**What changed:**
- Root `package.json`: version **0.3.0**.
- `CHANGELOG.md`: `[0.3.0] — 2026-10-29 — Phase 1b`, with **Try it** first, then Added, Changed and Security. The guard test checks that the newest entry equals the version, and What's new shows it.
- `docs/reports/phase-1b.md`: results per Done-when item (two marked ⚠ until Actions runs), evidence, deviations, ADRs 0011–0012, known issues, the upgrade-later review and the next phase.
- `docs/STATUS.md` (1b **in review**) and `ARCHITECTURE.md` (end of phase 1b, version 0.3.0).

**Run and check it (the whole phase):**

```fish
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test     # 178 unit/component tests
pnpm build && pnpm test:e2e                                        # 4 recorded walkthroughs
pnpm test:visual                                                   # 64, in Playwright's Docker image
GITHUB_TOKEN=(gh auth token) pnpm corpus:check                     # 6 of 6
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12   # workflow lint
```

**A last flake, fixed at its cause:**
- **What happened:** after the fresh-clone run passed, a repeat run failed one screenshot by 4 pixels, at the end of the "Release notes" button text on the Popover story, with reddish values.
- **Cause:** subpixel (LCD) text smoothing, which Chrome turns on or off per compositor layer, so it can differ between runs.
- **Fix:** `launchOptions: { args: ['--disable-lcd-text'] }` in `e2e/playwright.visual.config.ts` gives grey smoothing always.
- **Result:** 58 baselines retaken, identical to the eye; three consecutive runs passed 64 of 64 (ADR 0012).

**Commits:** `chore: release 0.3.0, close phase 1b` · `test(e2e): grey text smoothing for deterministic screenshots`

### Step 1b.9 — Move the repository and run CI on GitHub

**Goal:** get GitHub Actions running, so the CI workflow from step 4b proves phase 1b's Done-when on GitHub itself. The old account's billing lock stopped every job, so the owner moved the repository to their other account (decisions log, 31 Oct 2026).

**Concepts:**
- **Repository transfer** moves a repository to another owner and keeps its history, issues, PRs, stars, Actions secrets and webhooks. Old web and git URLs redirect, until someone creates a repository at the old name. The new owner has one day to accept. https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository
- **Who pays for Actions:** the repository's owner. Public repositories get standard runners free, so the old account's lock no longer matters. https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions
- **Workers Builds is tied to a GitHub App installation**, which belongs to an account. After a transfer, the Cloudflare app must be installed on the new account and each Worker's Git connection redone. https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/

**Owner (in the browser):**
1. GitHub → the repository → Settings → General → Danger zone → **Transfer ownership**, to `ArmaanAhuja`, new name `Flowcanvas`. Accept from the new account (within one day).
2. Install **Cloudflare Workers and Pages** on `ArmaanAhuja` for this repository only; remove the old account's installation.
3. Cloudflare → Workers & Pages → each Worker → Settings → Build → Git repository → reconnect. The form fills in Cloudflare's defaults (`pnpm run build`, `npx wrangler deploy`, `npx wrangler preview`); replace them with:

   | Field | `flowcanvas` | `flowcanvas-catalogue` |
   | --- | --- | --- |
   | Build command | `corepack enable && pnpm install --frozen-lockfile && pnpm build --filter=@flowcanvas/web` | `corepack enable && pnpm install --frozen-lockfile && pnpm turbo run build-storybook --filter=@flowcanvas/ui` |
   | Deploy command | `pnpm exec wrangler deploy` | `pnpm exec wrangler deploy --config packages/ui/wrangler.jsonc` |
   | Preview command | `pnpm exec wrangler versions upload` | `pnpm exec wrangler versions upload --config packages/ui/wrangler.jsonc` |
   | Enable Preview builds | on | on |
   | Advanced → root directory | `/` | `/` |
   | Advanced → variables | `NODE_VERSION=24`, `SKIP_DEPENDENCY_INSTALL=true`, `TURBO_TELEMETRY_DISABLED=1`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, `WRANGLER_SEND_METRICS=false` | the same, plus `STORYBOOK_DISABLE_TELEMETRY=1` |

**Claude:**

```fish
git remote set-url origin https://github.com/ArmaanAhuja/Flowcanvas.git
gh api repos/ArmaanAhuja/Flowcanvas/actions/secrets --jq '.secrets[].name'      # CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
gh api repos/ArmaanAhuja/Flowcanvas/actions/variables --jq '.variables[].name'  # CLOUDFLARE_WORKERS_SUBDOMAIN
```

Then repository links in the docs updated, and this branch (`chore/move-repo`) opened as a PR to run the whole workflow on GitHub.

**Verify:** on the PR, every CI job passes on GitHub (checks, visual in Docker, walkthroughs against the PR preview, publish), and one PR comment carries the preview and report links. After merge, the `main` run tests staging and moves the reports' main address. Then the upgrade-later 8 steps are complete.

**Gotchas:**
- Don't accept Cloudflare's default commands on reconnect: `pnpm run build` without `corepack enable` and an install fails, and `npx wrangler preview` is the beta preview feature we don't use.
- Commit and PR links in older docs point at the old address and still work through GitHub's redirect; never create a repository named `Glassbox` on the old account, or the redirect breaks.

**First run on GitHub (PR #7):** all four jobs passed (checks, visual 64 passed, walkthroughs 4 passed against the PR preview, publish), and the PR comment appeared with the preview and report links.

**A bug only GitHub could show:** the comment named commit `1c83d3e`, not the branch head `e0589159` that was tested. On pull requests `GITHUB_SHA` is GitHub's temporary merge commit, and `publish-report.ts` read it; under `act` the two are the same. Fix: the script reads the workflow's `COMMIT` (the tested head) first.

- **`.dev.vars` almost committed.** `main` didn't ignore `.dev.vars` yet (that rule was added on the phase 1c branch), and `git add -A` picked it up. GitHub's push protection rejected the push, so nothing left the laptop; the file was removed from the commit and the ignore rule added to `main`. Never click the "allow secret" links push protection offers. Stage named paths, and check `git show --stat HEAD` before pushing.

**After the merge:** the `main` run (https://github.com/ArmaanAhuja/Flowcanvas/actions/runs/41183867839) passed all four jobs; the walkthroughs ran against staging once it served `157b55f`, and the reports' main address moved to `157b55f`. Phases 1 and 1b accepted (decisions log, 31 Oct 2026).

**Commits:** `docs: move the repository to ArmaanAhuja/Flowcanvas` · `fix(e2e): label the report with the tested commit, not the PR merge commit` · `docs: accept phases 1 and 1b after CI ran on GitHub`

## Phase 1c — Sign-in and control plane

**From the build plan:**
- **Build:** GitHub and Google sign-in; projects list; workspace records; secrets vault; usage metering skeleton; admin view.
- **Done when:** a new user signs in, creates a project and sees it listed; saved secrets never appear in logs.
- **Try it:** sign in with GitHub, create a project, add a secret, confirm the logs show no value.

**Owner decisions (30 Oct 2026, decisions log):**
- the control plane in the app Worker under `/api`, with free Neon Postgres
- an allowlist, with the owner as admin
- sign-in on staging and local development only

**Why this phase matters:** everything from 1d on is per user and per project (workspaces, saved agent keys, usage limits), and this is the first time the product holds sensitive data. Hence the vault and the "never in logs" acceptance test.

**Expected outcome:**
- At the staging link: sign in with GitHub or Google (allowlisted), and see a projects list.
- Create a project; add a secret, then shown by name only and never readable back; a workspace-hours meter.
- An admin page.
- Canary tests prove secret values never reach logs, responses or pages.

### Steps (planned)

| # | Step | Status |
| --- | --- | --- |
| 0 | Owner accounts: Neon database, GitHub OAuth apps (staging + local), Google OAuth client; keys stored as Worker secrets and in `.dev.vars` | done · owner · `.dev.vars` checked by name and format; Worker secrets verified by `/api/db/ping` on version `26f9c237`, and inherited by the next preview (`9ae581e`) |
| 1 | Spike: Hono and Neon on the Workers free plan; ADR | done · `ba4718e` · Claude · ADR 0013 |
| 2 | Database schema and migrations | done · see commit below · Claude · ADR 0014 · applied to Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) |
| 3 | GitHub sign-in, sessions, sign out; Fastify server retired | done · see commit below · Claude · owner: one real sign-in by hand (below) |
| 4 | Google sign-in, allowlist, admin role | done · see commit below · Claude · owner: one real Google sign-in by hand |
| 5 | Projects list and create | done · see commit below · Claude · checked against Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) |
| 6 | Secrets vault, Project secrets page, canary tests | done · see commit below · Claude · ADR 0015 · owner: local VAULT_KEY |
| 7 | Usage metering skeleton and workspace records | done · see commit below · Claude · migration 0002 applied to Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) |
| 8 | Admin view | done · see commit below · Claude · read-only check against Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) |
| 9 | Logs and redaction across everything; walkthroughs | done · see commit below · Claude · owner: Cloudflare logs check at phase close |
| 10 | Close the phase (0.4.0) | done · see commit below · Claude · owner: after-merge checks on staging |

### Step 1c.0 — Account setup (owner)

**Goal:** the outside services phase 1c needs, set up on free plans, with every key stored only where it belongs: Cloudflare Worker secrets (staging) and the git-ignored `.dev.vars` (local). Never in the repo, a shell command line or chat.

**Concepts:**
- **Two environments, two sets of keys.** Staging and local development get separate OAuth apps and separate database branches, so a leaked local key can't touch staging, and local experiments can't damage staging data.
- **Callback (redirect) URLs.** After you approve, GitHub and Google send the browser back to a registered address with a one-time code. GitHub's OAuth app form now accepts up to 10 redirect URIs, but we still use **two GitHub apps** (staging and local): each has its own client secret, so a leaked local secret can't be used against staging, and either can be revoked alone. Leave **Allow wildcard matching** off (exact addresses only, so codes can't be sent anywhere else), **Enable Device Flow** off, and **Expire user access tokens** on: we only use GitHub's token once, at sign-in, to read who you are, then issue our own session.
- **Neon branches.** A Neon project has a default branch, named `production` in new projects (used for staging), and can have a `dev` branch (local): separate copies of the database, both free. Create `dev` from `production` with "Branch data and schema".
- **Where secrets live:**
  - **On Cloudflare:** `pnpm exec wrangler versions secret put NAME` prompts for the value and stores it encrypted on a new Worker version, without deploying. Use `versions secret put`, not `secret put`, because branch previews make the newest version differ from the live one.
  - **Secrets only attach to a Worker version that has a script.** The first attempt, on the assets-only Worker, said "Success" but attached nothing.
  - **Check by behaviour:** `/api/db/ping` on the new version's own URL (`https://<first 8 characters of the version id>-flowcanvas.ahujaarmaan7777.workers.dev`) answers `{"database":"ok"}`. `wrangler versions secret list --latest-version` crashes in Wrangler 4.152 (a Wrangler bug), so it can't be used.
  - **Locally:** `.dev.vars` holds the values and is git-ignored. Run `cp .dev.vars.example .dev.vars` **once**, before filling it in; running it again overwrites your values.

**Callback URLs:**

| Environment | GitHub | Google |
| --- | --- | --- |
| Staging | `https://flowcanvas.ahujaarmaan7777.workers.dev/api/auth/callback/github` | `https://flowcanvas.ahujaarmaan7777.workers.dev/api/auth/callback/google` |
| Local | `http://localhost:5173/api/auth/callback/github` | `http://localhost:5173/api/auth/callback/google` |

**Google Cloud steps** (Google Auth Platform, current console):
1. Use a **dedicated `flowcanvas` project**, not an existing one (for example a "Gemini Project"), so keys, quotas and the consent-screen name belong to Flowcanvas alone.
2. Google Auth Platform → **Get started**:
   - app name `Flowcanvas`, your support email
   - audience **External**
   - contact email, then accept the policy
3. **Data Access** → *Add or remove scopes*: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. All three are non-sensitive, so no verification is needed.
4. **Audience**: publishing status stays **Testing**; **Test users** → add your Google address. Only test users can sign in, which matches the allowlist.
5. **Branding**: no logo (uploading one triggers Google's brand verification); leave the domain fields empty while testing.
6. **Clients** → *Create client* → **Web application** `Flowcanvas`:
   - JavaScript origins: the staging and `http://localhost:5173` addresses
   - redirect URIs: the two Google callbacks above

   Copy the client secret when it's shown; Google may show it only once. Don't download the JSON into the repo.

**Don't use Neon's "Set up this app on Neon" agent prompt.** It installs the `neon` CLI, runs `neon init`/`neon deploy` in the repo, writes connection strings into `.env.local`, and asks an agent to wire the database into the app. That would bypass our plan: keys go only into Worker secrets and `.dev.vars`, and the database code is written and reviewed in step 1. Copy the connection strings from the dashboard instead (**Connect** button).

**Values to store:**

| Name | Staging (Worker secret) | Local (`.dev.vars`) |
| --- | --- | --- |
| `DATABASE_URL` | Neon `production` branch connection string (pooled) | Neon `dev` branch connection string (pooled). **Check the host differs from production's** (`pnpm db:status` prints it); until 2 Nov 2026 local used production by mistake |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | "Flowcanvas (staging)" OAuth app | "Flowcanvas (local)" OAuth app |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the Google client | the same Google client |

### Step 1c.1 — Spike: the API inside our Worker, talking to Neon

**Goal:** prove decision 1A before building on it. One Worker serves the app's static files *and* a Hono API under `/api`, the API reaches Neon, and a request fits the free plan's CPU limit.

**Concepts:**
- **A spike:** a small, real experiment answering a risky question first. The result goes into an ADR (0013).
- **Static assets plus a script in one Worker.** `assets.run_worker_first: ["/api/*"]` sends only `/api/*` to the script. https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- **Hono:** a web-standards framework that runs on Workers; `app.request()` tests it without a server. https://hono.dev
- **Neon's serverless driver:** SQL over HTTPS. https://neon.com/docs/serverless/serverless-driver
- **Dependency injection for testability.** `createApi({ query, now, log })` lets tests replace the database, clock and logger, so they run offline and deterministically.
- **Redaction with a canary.** A fake connection string with a recognisable password; the test fails if it appears in any response or log line.
- **Cold starts.** Neon's free compute sleeps when idle, so the first query took 4.2 s, then 117 ms.

**What changed:**
- `pnpm-workspace.yaml` catalog: `hono` 4.13.13, `@neondatabase/serverless` 1.2.0 (both MIT, more than two weeks old); added to `services/control-plane`.
- `services/control-plane/src/api/`:
  - `app.ts`: `createApi()` with `/api/health`, `/api/db/ping` and a JSON 404
  - `redact.ts`: removes connection strings and bearer tokens
  - `worker.ts`: the Worker's entry point
  - `app.test.ts`: 6 tests, including the canary
- `wrangler.jsonc`: `main`, `run_worker_first: ["/api/*"]`, `observability.enabled`.
- `docs/adr/0013-control-plane-in-the-app-worker.md`.

**`services/control-plane/src/api/app.ts`:**

```ts
import { neon } from '@neondatabase/serverless';
import { Hono } from 'hono';
import { describeError } from './redact.js';

/** Values Cloudflare passes to the Worker: Worker secrets on Cloudflare, `.dev.vars` under `wrangler dev`. */
export interface ApiBindings {
  readonly DATABASE_URL?: string;
}

/** Outside effects the API needs, passed in so tests can replace them. */
export interface ApiDependencies {
  /** Runs one SQL statement against the database at `databaseUrl`. */
  readonly query: (
    databaseUrl: string,
    text: string,
  ) => Promise<readonly Record<string, unknown>[]>;
  readonly now: () => number;
  readonly log: (message: string) => void;
}

/** Neon's serverless driver sends SQL over HTTPS, which suits Workers (no long-lived sockets). */
const neonQuery: ApiDependencies['query'] = async (databaseUrl, text) =>
  neon(databaseUrl).query(text) as Promise<Record<string, unknown>[]>;

const defaults: ApiDependencies = {
  query: neonQuery,
  now: () => Date.now(),
  log: (message) => {
    console.error(message);
  },
};

/** The control plane's HTTP API, mounted under /api in the app's Worker (decisions log, 30 Oct 2026). */
export function createApi(overrides: Partial<ApiDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const api = new Hono<{ Bindings: ApiBindings }>().basePath('/api');

  api.get('/health', (c) => c.json({ status: 'ok', service: 'control-plane' }));

  // Proves the Worker can reach its database; never echoes the connection string, even on errors.
  api.get('/db/ping', async (c) => {
    const databaseUrl = c.env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl === '') {
      return c.json({ database: 'not configured', fix: 'Set the DATABASE_URL secret' }, 503);
    }
    const started = deps.now();
    try {
      await deps.query(databaseUrl, 'select 1 as ok');
      return c.json({ database: 'ok', roundTripMs: deps.now() - started });
    } catch (error) {
      deps.log(`database ping failed: ${describeError(error)}`);
      return c.json({ database: 'unreachable' }, 503);
    }
  });

  api.notFound((c) => c.json({ error: 'not found' }, 404));
  return api;
}
```

**`services/control-plane/src/api/redact.ts`:**

```ts
/**
 * Removes secret-shaped text from anything about to be logged or returned: database connection strings
 * (which embed a password) and bearer tokens. Errors from drivers can quote the URL they failed on.
 */
export function redact(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, 'postgresql://[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]');
}

/** A short, safe description of an unknown error for logs. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return redact(`${error.name}: ${error.message}`);
  return redact(String(error));
}
```

**`services/control-plane/src/api/worker.ts`:**

```ts
import { createApi } from './app.js';

/**
 * The Worker's script. wrangler.jsonc sends only /api/* here (`run_worker_first`); every other request is
 * served from the app's static files, as before.
 */
export default createApi();
```

**`wrangler.jsonc`:**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "flowcanvas",
  // The control plane's API (Hono), mounted under /api (decisions log, 30 Oct 2026; ADR 0013).
  "main": "./services/control-plane/src/api/worker.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./apps/web/dist",
    "not_found_handling": "single-page-application",
    // Only /api/* runs the script; everything else is served straight from the static files.
    "run_worker_first": ["/api/*"],
  },
  // Request logs, including CPU time per request (free plan allowance), to watch the 10 ms CPU limit.
  "observability": {
    "enabled": true,
  },
  "preview_urls": true,
  "workers_dev": true,
  "send_metrics": false,
}
```

**Commands:**

```fish
pnpm install
pnpm --filter @flowcanvas/control-plane test           # 9 passed (6 new)
pnpm build --filter=@flowcanvas/web                    # wrangler dev serves this build
pnpm exec wrangler dev --port 8787                     # reads .dev.vars; shows each value as (hidden)
curl http://127.0.0.1:8787/api/health                  # {"status":"ok","service":"control-plane"}
curl http://127.0.0.1:8787/api/db/ping                 # {"database":"ok","roundTripMs":…}
```

**Run and check it (30 Oct 2026):**
1. Locally: health 200, and the database ping 200 against Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) (4.2 s cold, then 117 ms). `/` is still the app, with its CSP.
2. Preview `https://phase-1c-sign-in-control-plane-flowcanvas.ahujaarmaan7777.workers.dev/api/health` gives 200 from the script; `/api/db/ping` gave 503 "not configured" until the staging secrets were set on a version with a script.
3. After the owner re-set the secrets, version `26f9c237`'s own URL answered `/api/db/ping` 200 against Neon `production` (734 ms cold, 63 ms warm).
4. **New uploads inherit secrets.** The preview built from the next push (`9ae581e`) also answered `{"database":"ok"}`, so secrets are set once.

**Gotchas:**
- **`wrangler dev` serves `apps/web/dist`,** so build the web app first.
- **Don't log errors from the database driver raw:** they can quote the connection string. Use `describeError()`.
- **The first request after Neon idles is slow.** That's not a bug.

**Commit:** `feat(control-plane): spike the API in the app Worker with Hono and Neon`

### Step 1c.2 — Database schema and migrations

**Goal:** the tables phase 1c stands on, as versioned migration files, applied by a small runner the same way locally and on staging, and tested against a throwaway Postgres.

**Concepts:**
- **Migrations:** numbered SQL files applied once, in order, recorded in `schema_migrations` with a SHA-256. Never edit an applied file; add a new one. The runner refuses edited files, unknown versions, bad names and duplicate numbers, and rolls a failing file back completely.
- **Plain SQL, not an ORM** (ADR 0014): visible, reviewable, nothing added to the Worker bundle; Postgres constraints enforce the rules.
- **Constraints as the last line of defence:** `check`, `unique`, `references … on delete cascade`.
- **Sessions as hashes:** the database stores the SHA-256 of the session token, never the token.
- **Envelope encryption, shaped in the schema:** `project_keys` holds each project's data key encrypted by a master key in a Worker secret; `project_secrets` holds only ciphertext and IV.
- **PGlite:** Postgres compiled to WebAssembly, in the test process. A fresh database per test, offline, in milliseconds. https://pglite.dev
- **Transactions:** each migration runs between `begin` and `commit`; on any error, `rollback` leaves no trace.
- **No personal data in the repo:** the allowlist is filled by `pnpm db:allow`, because migrations are public.

**What changed:**
- `services/control-plane/migrations/0001_initial.sql`: 9 tables (see `ARCHITECTURE.md`, "Data model").
- `src/db/migrations.ts` (runner), `src/db/migration-files.ts` (loads the folder), `scripts/db.ts` (status, migrate, allow).
- `src/db/schema.test.ts`: 13 tests (runner safety, plus every rule: lower-case unique emails, unique identities, 32-byte session hashes with valid expiry, trimmed project names unique per owner, secret name pattern, 12-byte IVs, cascading user deletion, usage periods, allowlist).
- `@electric-sql/pglite` 0.5.10 (dev only).
- Scripts:
  - `db:status`, `db:migrate`, `db:allow` in the package (run with `tsx`, reading `../../.dev.vars`) and at the root
  - `tsconfig.json` now type-checks `scripts/`; `tsconfig.build.json` emits `src` only
- Docs: ADR 0014, `ARCHITECTURE.md` (data model), upgrade-later 23 (automatic staging migrations with a lock and backups).

**`services/control-plane/migrations/0001_initial.sql`:**

```sql
-- 0001 — Phase 1c: accounts, sessions, projects, workspace records, secrets vault, usage.
-- Never edit this file once applied anywhere; add a new numbered migration instead.

-- People who may sign in while in private development (decisions log, 30 Oct 2026). Filled by
-- `pnpm db:allow`, never by a migration: the repository is public, so no emails live in it.
create table sign_in_allowlist (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  role text not null default 'member' check (role in ('member', 'admin')),
  added_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email like '%_@_%'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  avatar_url text check (avatar_url is null or avatar_url like 'https://%'),
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  last_signed_in_at timestamptz
);
create unique index users_email_key on users (email);

-- One row per external account (GitHub, Google) linked to a user.
create table identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null check (provider in ('github', 'google')),
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 200),
  username text,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);
create index identities_user_id_idx on identities (user_id);

-- The browser holds a random session token; only its SHA-256 hash is stored, so a database leak
-- doesn't hand out live sessions.
create table sessions (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  check (expires_at > created_at)
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100 and name = btrim(name)),
  repo_url text check (repo_url is null or repo_url like 'https://%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

-- One cloud workspace per project. Records only for now; the machines arrive in phase 1d.
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects (id) on delete cascade,
  state text not null default 'not_created'
    check (state in ('not_created', 'creating', 'running', 'sleeping', 'resuming', 'stopped', 'failed')),
  region text,
  machine_size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Envelope encryption: each project has its own data key, stored only encrypted (wrapped) by a master
-- key that lives in a Worker secret, never in the database. key_version names which master key.
create table project_keys (
  project_id uuid primary key references projects (id) on delete cascade,
  wrapped_key bytea not null check (octet_length(wrapped_key) between 32 and 64),
  wrap_iv bytea not null check (octet_length(wrap_iv) = 12),
  key_version integer not null check (key_version > 0),
  created_at timestamptz not null default now()
);

-- Secret values are write-only: stored as AES-GCM ciphertext under the project's data key, never in
-- plain text, never returned by the API.
create table project_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (name ~ '^[A-Z_][A-Z0-9_]{0,127}$'),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 65552),
  iv bytea not null check (octet_length(iv) = 12),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

-- Usage metering skeleton: measured amounts per user, e.g. workspace seconds (phase 1d onward).
create table usage_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  workspace_id uuid references workspaces (id) on delete set null,
  kind text not null check (kind in ('workspace_seconds', 'storage_byte_hours')),
  quantity bigint not null check (quantity >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index usage_records_user_period_idx on usage_records (user_id, started_at);
```

**`services/control-plane/src/db/migrations.ts`:**

```ts
import { createHash } from 'node:crypto';

/** The two things the runner needs from a database connection; Neon and PGlite both fit. */
export interface MigrationDatabase {
  /** Runs SQL that may contain several statements (a migration file). */
  readonly exec: (sql: string) => Promise<void>;
  /** Runs one parameterised statement and returns its rows. */
  readonly query: <Row>(sql: string, params?: readonly unknown[]) => Promise<Row[]>;
}

export interface Migration {
  /** e.g. "0001_initial". */
  readonly version: string;
  readonly sql: string;
}

export interface MigrationReport {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Turns migration files into an ordered list, refusing badly named or duplicate-numbered files. */
export function orderMigrations(files: readonly { name: string; sql: string }[]): Migration[] {
  const numbers = new Set<string>();
  return files
    .map(({ name, sql }) => {
      const match = NAME.exec(name);
      if (match?.[1] === undefined) {
        throw new Error(`migration file "${name}" must be named NNNN_lowercase_words.sql`);
      }
      if (numbers.has(match[1])) throw new Error(`two migrations are numbered ${match[1]}`);
      numbers.add(match[1]);
      return { version: name.replace(/\.sql$/, ''), sql };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * Applies pending migrations in order, each in its own transaction, recording version and checksum.
 * Refuses to run if an applied migration's file has changed since (never edit applied migrations).
 */
export async function migrate(
  db: MigrationDatabase,
  migrations: readonly Migration[],
): Promise<MigrationReport> {
  await db.exec(`create table if not exists schema_migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const rows = await db.query<{ version: string; checksum: string }>(
    'select version, checksum from schema_migrations',
  );
  const done = new Map(rows.map((row) => [row.version, row.checksum]));

  for (const migration of migrations) {
    const recorded = done.get(migration.version);
    if (recorded !== undefined && recorded !== checksum(migration.sql)) {
      throw new Error(
        `migration ${migration.version} changed after it was applied; add a new migration instead`,
      );
    }
  }
  const known = new Set(migrations.map((migration) => migration.version));
  for (const version of done.keys()) {
    if (!known.has(version))
      throw new Error(`database has migration ${version}, which this code doesn't know`);
  }

  const applied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.version)) continue;
    await db.exec('begin');
    try {
      await db.exec(migration.sql);
      await db.query('insert into schema_migrations (version, checksum) values ($1, $2)', [
        migration.version,
        checksum(migration.sql),
      ]);
      await db.exec('commit');
    } catch (error) {
      await db.exec('rollback');
      throw new Error(`migration ${migration.version} failed and was rolled back`, {
        cause: error,
      });
    }
    applied.push(migration.version);
  }
  return { applied, alreadyApplied: [...done.keys()].sort() };
}
```

**Commands:**

```fish
pnpm install
pnpm --filter @flowcanvas/control-plane test     # 22 passed (13 new, offline with PGlite)
pnpm db:status                                   # 0001_initial  pending | applied
pnpm db:migrate                                  # Applied: 0001_initial   (then: Up to date)
pnpm db:allow you@example.com --admin            # owner: lets you sign in, as admin (needed from step 3)
```

Staging, when the phase merges (the URL is typed into a hidden prompt, never into history):

```fish
read -s -P 'Neon production URL: ' DATABASE_URL; DATABASE_URL=$DATABASE_URL pnpm db:migrate; set -e DATABASE_URL
```

**Run and check it (30 Oct 2026):** against Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) (AWS ap-southeast-1):
1. `db:status` showed `pending`.
2. `db:migrate` showed `Applied: 0001_initial`.
3. `db:status` showed `applied`.
4. `db:migrate` again showed `Up to date: nothing to apply.`

**Gotchas:**
- **Never edit an applied migration.** The runner refuses it; write `0002_…` instead.
- **Don't put emails or other personal data in migrations.** Use `db:allow`.
- **Run the db scripts with `tsx`,** not `node`: the package's imports name `.js` files that only exist after a build.
- **`--env-file-if-exists` doesn't override an exported `DATABASE_URL`.** That's how staging is targeted on purpose, and also how it could happen by accident. The command always prints the host first.

**Commit:** `feat(control-plane): schema migrations, runner and PGlite tests`

### Step 1c.3 — GitHub sign-in, sessions, sign out

**Goal:** on the version page, **Sign in with GitHub** takes an allowlisted person to GitHub and back, signed in, with their name and **Sign out**. Anyone else is turned away with a clear message. Also retire the old Fastify server (ADR 0013), so the control plane has one API.

**Concepts:**
- **OAuth web flow.** The app sends the browser to GitHub with its client ID and a registered return address. GitHub asks the person, then returns the browser to that address with a one-time `code`. The server swaps the code (plus its client secret) for a GitHub token, reads who the person is, and issues its **own** session. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- **`state`** is a random value sent to GitHub and also kept in a cookie. The callback must bring the same value back. That stops another site from finishing a sign-in into your browser (login CSRF).
- **PKCE** (RFC 7636): the server keeps a random *verifier* and sends GitHub only its SHA-256 (the *challenge*). The exchange must include the verifier, so an intercepted code is useless alone. https://www.rfc-editor.org/rfc/rfc7636
- **Session cookie attributes.** `HttpOnly` (page scripts can't read it), `Secure` (HTTPS only, and `http://localhost`), `SameSite=Lax` (not sent on other sites' background requests or form posts, but sent when GitHub sends you back), and the **`__Host-` prefix** (browsers only accept it with `Secure`, `Path=/` and no `Domain`, so no other site or subdomain can set it). https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes
- **Only a hash is stored.** The session token is 32 random bytes; the database keeps its SHA-256. A database leak can't be replayed as live sessions.
- **One registered address.** `APP_ORIGIN` names where sign-in works: staging in `wrangler.jsonc` `vars`, overridden to `http://localhost:5173` by `pnpm dev`. Branch previews have other addresses, so `/api/me` says `staging-only` and the page links to staging (decision 3A).

**What changed:**

| File | What |
| --- | --- |
| `services/control-plane/src/auth/crypto.ts` | Random tokens (base64url), SHA-256, the PKCE challenge, a constant-time compare |
| `services/control-plane/src/auth/github.ts` | Authorize URL (`read:user user:email`, PKCE S256, `allow_signup=false`), code exchange, profile with the **primary verified** email |
| `services/control-plane/src/auth/accounts.ts` | `signIn` (allowlist decides entry and role on every sign-in; find by provider ID, else link by verified email, else create), `createSession`, `sessionUser` (also refreshes `last_seen_at`), `endSession` |
| `services/control-plane/src/auth/routes.ts` | `GET /api/me`, `GET /api/auth/github`, `GET /api/auth/callback/github`, `POST /api/auth/sign-out` |
| `services/control-plane/src/db/database.ts` | The `Database` interface (one parameterised statement) and its Neon implementation. Neon's HTTP driver has no interactive transactions, so writes that belong together are one SQL statement |
| `services/control-plane/src/api/app.ts` | Mounts the auth routes; `Cache-Control: no-store` on every API answer; `/api/health` includes the version; dependencies are now `database`, `fetch`, `now`, `log` |
| `services/control-plane/src/test/database.ts` | PGlite with the real migrations, for tests |
| removed | Fastify `src/app.ts`, `server.ts`, `build-info.ts`, their test, the `Dockerfile`, `tsconfig.build.json`; the `fastify` and `graph-model` dependencies |
| `services/control-plane/package.json`, `turbo.json` | `dev` runs `wrangler dev` on 8787 with `APP_ORIGIN=http://localhost:5173`; Turbo builds the web app first (Wrangler refuses to start without `apps/web/dist`) |
| `apps/web/vite.config.ts` | `/api` forwarded to 8787, keeping the `Host` header |
| `apps/web/src/account/` | `session.ts` (load, sign out, problem messages), `Account.tsx` and its CSS: the **Account** row |
| `wrangler.jsonc` | `vars.APP_ORIGIN` = staging |

**Callback problems** come back as `/?sign-in=<code>`, and the page shows one sentence for each:
- `cancelled`: you clicked Cancel on GitHub
- `expired`: the state didn't match, or the 10-minute cookie was gone
- `no-verified-email`: GitHub has no verified primary email for you
- `not-allowed`: that email isn't on the allowlist
- `unavailable`: sign-in was tried on a preview
- `failed`: anything else; the details go to the log, redacted

Unknown codes show the `failed` sentence; the address text is never echoed onto the page.

**Tests (all offline):**

| File | Proves |
| --- | --- |
| `auth/crypto.test.ts` (4) | RFC 7636's own PKCE example; token shape and uniqueness |
| `auth/github.test.ts` (7) | Scopes and PKCE in the authorize URL; GitHub's "200 with error" handled; primary *verified* email only; errors never contain the code |
| `auth/accounts.test.ts` (9, PGlite) | Not allowlisted: nothing stored. First sign-in creates the user with the allowlist role; the next finds the same user and refreshes name and role; a second provider with the same email links to the same user. Only the token's SHA-256 is stored; unknown and expired tokens are ignored; sign-out deletes the row |
| `auth/routes.test.ts` (16, PGlite + fake GitHub) | The whole flow with real cookies: a `__Host-` cookie with the right attributes, state and PKCE checked, `/api/me` with the user. Plus forged state, missing cookie, cancel, not allowlisted, unverified email, previews, a missing secret, `no-store`, session replaced on re-sign-in, sign-out (with a foreign `Origin` refused). Canary client secret, code and GitHub token never in logs, responses or the database |
| `account/Account.test.tsx` (8) and `App.test.tsx` (+1) | Every account state, sign out (and its failure), problem messages, the address cleaned, unknown codes not echoed |

**Run and check it:**

```fish
pnpm install
pnpm --filter @flowcanvas/control-plane test     # 55 passed
pnpm --filter @flowcanvas/web test               # includes the 8 Account tests
pnpm dev                                         # open http://localhost:5173
```

Owner, by hand (a real GitHub sign-in can't run in CI without a real account and password):
1. Run `pnpm db:allow <your GitHub primary email> --admin` once, if you haven't.
2. `pnpm dev`, open http://localhost:5173. The **Account** row says **Sign in with GitHub**.
3. Click it, then approve "Flowcanvas (local)" on GitHub. You're back on the page with your name, your email and "· admin", and **Sign out**.
4. Reload the page: you're still signed in. In devtools → Application → Cookies, `__Host-fc_session` is HttpOnly and Secure, and `document.cookie` in the console doesn't show it.
5. Click **Sign out**: the row shows **Sign in with GitHub** again.
6. Optional: sign in with a GitHub account whose email isn't allowlisted. The page says the account isn't on the allowlist.

Checked by Claude in Chromium (31 Oct 2026), against `pnpm dev` with the Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) database:
- `/api/me` → `available`
- the button reached github.com's sign-in page
- Chrome stored `__Host-fc_oauth` on `http://localhost` (HttpOnly, Secure, Lax)
- a forged callback showed the "expired" sentence and cleared the cookie

**Gotchas:**
- **Vite's proxy shorthand rewrites `Host`.** `proxy: { '/api': 'http://…' }` sets `changeOrigin`, so the Worker sees `127.0.0.1:8787`, decides it's a preview, and won't offer sign-in. Use the object form with `changeOrigin: false`.
- **`wrangler dev` refuses to start without `apps/web/dist`.** Turbo builds the web app before the control plane's `dev`.
- **A leftover `wrangler dev` holds port 8787.** The new one then fails, or you test old code. Find it with `ss -ltnp | grep 8787` and stop that PID.
- **No profile pictures yet:** the CSP only allows images from our own origin (upgrade-later 24).
- **Secrets on previews disappeared after PRs #7 and #8.** Each new Worker version copies its secrets from the newest version. Merging those PRs deployed `main`, which has no script until phase 1c merges, as static-files-only versions, and secrets can't attach to those. Previews built afterwards had no `DATABASE_URL` (`/api/me` said `not-configured`). Fix: put the five secrets again with `pnpm exec wrangler versions secret put NAME`. Until 1c merges, any merge to `main` breaks the chain again. **At phase close, check staging's secrets** (`/api/db/ping` on staging), because `main`'s first deploy with a script starts from a version without them.
- **"The `redirect_uri` is not associated with this application"** on GitHub means the app's keys and the return address don't match. Here, `.dev.vars` held the **staging** app's client ID and secret, and the staging app only accepts the staging callback. Fix: put the **local** app's ID and secret in `.dev.vars` (and restart `pnpm dev`, since Wrangler reads it at startup). To check which app an ID belongs to, compare it with the Client ID shown on each OAuth app's page; the ID isn't secret.
- **GitHub signs in whichever account the browser is signed in to,** and after the first approval it doesn't ask again. To test another GitHub account, sign out at github.com first. An account whose primary verified email isn't allowlisted comes back with the "not on the allowlist" sentence and no session, so there's nothing to sign out of (owner check, 31 Oct 2026).
- **At phase close:** check that the Worker secrets hold the **staging** app's keys, and generate a new staging client secret, because the old one was stored in a local file.
- **Request logs:** Cloudflare's request logs may record the callback URL, including the one-time `code`. With PKCE the code is useless without the verifier, which never leaves the cookie. Step 9 checks everything the logs record.

**Commit:** `feat(control-plane): GitHub sign-in with sessions; retire the Fastify server`

### Step 1c.4 — Google sign-in, allowlist, admin role

**Goal:** **Sign in with Google** next to GitHub. A person who uses both with the same verified email gets one Flowcanvas account. Routes can require a signed-in user, or an admin.

**Concepts:**
- **OpenID Connect (OIDC)** is OAuth plus a standard way to learn who signed in. With the scopes `openid email profile`, Google's **userinfo** endpoint returns `sub` (a stable account ID), `email`, `email_verified` and `name`. https://developers.google.com/identity/openid-connect/openid-connect
- **Why userinfo, not the ID token.** Google also returns an *ID token* (a signed JWT). Using it means checking its signature against Google's published keys, its audience and its expiry. Calling userinfo with the token we just received, over TLS from Google's own endpoint, gives the same facts without any of that code. One more request per sign-in.
- **`prompt=select_account`** makes Google, and GitHub when several accounts are signed in, show an account picker, instead of silently using the account already signed in. That was the confusion in step 3.
- **Linking by verified email.** The `identities` table links each external account to a user. A Google account with the same **verified** email as an existing user is linked to that user, not made into a second one. This is safe only because both providers verify the email. Unverified emails are refused (`no-verified-email`).
- **Guards (middleware).** `requireUser` reads the session cookie and gives the route `c.get('user')`, or answers 401. `requireAdmin` runs after it and answers 403 unless the allowlist made the user an admin. The projects (step 5) and admin (step 8) routes use them. https://hono.dev/docs/guides/middleware

**What changed:**

| File | What |
| --- | --- |
| `services/control-plane/src/auth/google.ts` | Authorize URL (`openid email profile`, PKCE S256, `prompt=select_account`), code exchange, userinfo with the **verified** email only |
| `services/control-plane/src/auth/providers.ts` | One `OAuthProvider` shape for GitHub and Google: keys, authorize URL, `identify` (the provider's token never leaves it) |
| `services/control-plane/src/auth/routes.ts` | `/api/auth/:provider` and `/api/auth/callback/:provider`. The sign-in cookie records which provider started, and a callback for another provider is refused. `/api/me` also lists `providers` (those with both keys set) |
| `services/control-plane/src/auth/guards.ts` | `requireUser`, `requireAdmin` |
| `services/control-plane/src/auth/cookies.ts` | Cookie names and attributes, shared by routes and guards |
| `services/control-plane/src/auth/github.ts` | Adds `prompt=select_account` |
| `apps/web/src/account/` | One link per configured provider. Problem messages no longer name GitHub. **Sign out** is a text button that lines up with the text (owner's screenshot) |

**Tests:**
- **`google.test.ts` (6):** the grant includes the PKCE verifier; Google's error is named without the code or secret; only verified emails count; a missing name falls back to the email's name part; a missing `sub` fails clearly.
- **`routes.test.ts` (now 25, fake GitHub and Google):**
  - Google's authorize URL, sign-in, an unverified email, and an email not on the allowlist
  - **the same verified email on GitHub and Google is one user with two identities**
  - a callback for the wrong provider is refused
  - `/api/me` lists only providers with both keys, or `not-configured` when there are none
  - unknown providers answer 404
  - Google's secret, code and token are canaries: never logged
- **`guards.test.ts` (5):** no session or an unknown one gets 401; a signed-in user reaches the route; an admin passes `requireAdmin`; a member gets 403.
- **`Account.test.tsx` (9):** both links, only the configured ones, the new message wording.

**Run and check it:**

```fish
pnpm --filter @flowcanvas/control-plane test
pnpm --filter @flowcanvas/web test
pnpm dev                                         # http://localhost:5173
```

Owner, by hand:
1. The **Account** row shows **Sign in with GitHub** and **Sign in with Google**.
2. **Sign in with Google**, using an account that is both a **test user** in Google Auth Platform → Audience and on the allowlist. You come back signed in.
3. If that Google account has the same email as your GitHub account, it's the **same** Flowcanvas account: same name row, and still admin.
4. **Sign out**, then sign in with GitHub. GitHub now shows its account picker when several GitHub accounts are signed in.

Checked by Claude (31 Oct 2026), against the owner's running `pnpm dev`: `/api/me` listed `github` and `google`, and **Sign in with Google** reached Google's "Sign in to continue to Flowcanvas" page. That means Google accepted the client ID and the local return address (a mismatch would show "Error 400: redirect_uri_mismatch").

**Gotchas:**
- **Google only lets test users in while the app is in *Testing*** (step 0). Anyone else sees "Access blocked" on Google's side, before our allowlist runs. A Google sign-in needs both: a test user in Google, and the email on our allowlist (upgrade-later 26).
- **`wrangler dev` reloads on code changes** but reads `.dev.vars` only at startup.

**Commit:** `feat(control-plane): Google sign-in, one account across providers, user and admin guards`

### Step 1c.5 — Projects list and create

**Goal:** a signed-in person creates a project (a name, and optionally a repository address) and sees it in their list. Nobody sees anyone else's projects. This is the first half of the phase's *Done when*.

**Concepts:**
- **Authorization by query, not by check.** Every projects query includes `where owner_id = <the signed-in user>`, taken from the session (`c.get('user')`) and never from the request. A forged project ID or owner in a request has nothing to act on.
- **Validate at the edge, enforce in the database.** `parseNewProject` gives readable messages (and names the field). The schema's checks (`0001_initial.sql`: trimmed, 1–100 characters, unique per owner) stay as the backstop. Both count *code points*, so a name in Hindi or Japanese fits the same 100 as one in English.
- **`on conflict do nothing … returning`** makes a duplicate name come back as "no row", so there's no database error code to parse (Neon and PGlite word their errors differently).
- **Changes need our own `Origin`.** The same-origin check from sign-out is now the shared guard `requireSameOrigin`. Creating also requires `content-type: application/json` (415 otherwise): a cross-site form can't send that type without a CORS preflight, which we don't allow. Bodies are capped at 4 KB.
- **No credentials in URLs.** A repository address with a username or token (`https://ghp_…@github.com/…`) is refused with a reason, so it's never stored or shown. Private repositories connect another way later.

**What changed:**

| File | What |
| --- | --- |
| `services/control-plane/src/projects/projects.ts` | `parseNewProject`, `listProjects` (own projects only, newest first), `createProject` |
| `services/control-plane/src/projects/routes.ts` | `GET /api/projects`, `POST /api/projects` (201; 400 with `field`; 409 for a duplicate name; 403, 413, 415) |
| `services/control-plane/src/auth/guards.ts` | `requireSameOrigin`, now used by sign-out and project creation |
| `services/control-plane/src/test/sessions.ts` | `signedInAs(db, email, role)` for route tests |
| `apps/web/src/projects/` | `api.ts` (list, create, readable problems), `Projects.tsx` (form, list, empty and error states) and its CSS |
| `apps/web/src/App.tsx`, `account/Account.tsx` | The Projects section shows only when signed in (`onSessionChange`) |

**Design note for the owner's review:** the design brief puts projects on the **Start screen** ("Recent projects": type and support badges, last opened, a canvas thumbnail; plus "Clone from URL", "Upload folder" and "New project"). That screen comes with the app shell (phase 2) and with workspaces (phase 1d). This step adds a plain Projects section to the version page, built from the design system's Input and Button, so the *Done when* can be shown now.

**Tests:**
- **`projects/projects.test.ts` (8, PGlite):**
  - trimming and name limits; names in other scripts; https only
  - a token in the address refused
  - newest first; nobody sees another person's projects
  - duplicate names refused per person only
- **`projects/routes.test.ts` (9):**
  - 401 when signed out; empty, then the created project listed
  - per-person lists; 400 with the field; 409
  - a foreign `Origin` gets 403; 415, 400 and 413 for bad bodies
  - a pasted token never stored or echoed; database failures logged without the canary
- **`Projects.test.tsx` (6) and `App.test.tsx` (+1):**
  - empty state, list, create (newest first, form cleared)
  - the name is required before any request
  - the API's reason shown next to the field it names (`aria-invalid`, `aria-describedby`)
  - load failure; Projects hidden when signed out

**Checked against Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) (31 Oct 2026):** a throwaway script created a test user and two projects through the same functions, got `duplicate-name` for a repeated name, listed them newest first with ISO dates, then deleted the user and its allowlist row (0 left).

**Run and check it:**

```fish
pnpm --filter @flowcanvas/control-plane test
pnpm --filter @flowcanvas/web test
pnpm dev                                         # http://localhost:5173, signed in
```

Owner, by hand:
1. Signed in, the page shows **Projects** with "No projects yet".
2. Create "Rallly" with `https://github.com/lukevella/rallly`. It appears at the top, and the form clears.
3. Create "Rallly" again: "You already have a project with that name."
4. Try `https://abc@github.com/x/y` as the address: it's refused with the reason, and nothing is created.
5. Reload: the list is still there. Sign out: the section disappears.

**Gotchas:**
- **React 19's types deprecate `FormEvent`;** a form's submit handler takes `SubmitEvent<HTMLFormElement>`.
- **typescript-eslint flags `[...text].length`.** Counting code points is deliberate here, to match Postgres; `Array.from(text).length` says the same thing explicitly.

**Commit:** `feat: projects list and create for signed-in people`

### Step 1c.6 — Secrets vault, project secrets, canary tests

**Goal:** each project can hold secrets (environment-variable values). They're saved encrypted, listed by name only, can be replaced or deleted, and are never shown, logged or returned. This is the second half of the phase's *Done when*.

**Concepts:**
- **AES-GCM** is authenticated encryption: it hides the value and detects any change to the ciphertext. Each encryption needs a fresh random IV (nonce); reusing one with the same key breaks it. https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt#aes-gcm
- **Envelope encryption.** A master key (`VAULT_KEY`, a Worker secret) encrypts ("wraps") a random data key per project. The data key encrypts that project's values. The database holds only wrapped keys and ciphertext, so a database copy alone decrypts nothing. https://cloud.google.com/kms/docs/envelope-encryption
- **Additional authenticated data (AAD)** is extra text that must match when decrypting but isn't stored in the ciphertext. Here it's the project and the secret's name, so a ciphertext moved to another row fails to open.
- **Write-only values.** No API route returns a value, so the page can't leak one even by mistake. To change a value, save it again under the same name ("rotate").
- **Canary tests** plant a recognisable fake value (`CANARY-…`) and assert it never appears in responses, logs or any database row.

**Design:** ADR 0015.

**What changed:**

| File | What |
| --- | --- |
| `services/control-plane/src/vault/crypto.ts` | Master key import (32 bytes, base64; errors never echo it), wrap and unwrap a data key, encrypt and decrypt a value with AAD, hex helpers |
| `services/control-plane/src/vault/vault.ts` | Name and value rules (`^[A-Z_][A-Z0-9_]{0,127}$`, 1 byte to 64 KB), data key created on first use (safe if two requests race), `listSecrets` (names, who added, when), `putSecret` (created or replaced), `deleteSecret`, `readSecret` (for phase 1d's workspace and the tests) |
| `services/control-plane/src/vault/routes.ts` | `GET /api/projects/:id/secrets`; `PUT …/secrets/:name` with `{ value }` (201 created, 200 replaced; the answer has only the name); `DELETE …/secrets/:name`. Another person's project, or a malformed ID, answers like a missing one (404). A missing `VAULT_KEY` answers 503 with the fix |
| `services/control-plane/src/projects/projects.ts` | `ownsProject` |
| `apps/web/src/secrets/` | API client and the **Secrets** panel: masked list with who added and when, two-click delete, a form whose button says **Replace NAME** for an existing name, and a value field that browsers and password managers shouldn't save |
| `apps/web/src/projects/Projects.tsx` | A **Secrets** toggle on each project |
| `.dev.vars.example` | `VAULT_KEY` |

**Tests:**
- **`vault/crypto.test.ts` (5):**
  - a bad master key is refused without being echoed
  - round trip; a fresh IV every time
  - moved or renamed ciphertext won't open
  - another master key, or another project, can't unwrap
- **`vault/vault.test.ts` (9, PGlite):**
  - name and value rules
  - listed by name only
  - **the canary appears nowhere in the database, as text or as hex**
  - replace (rotate); one 48-byte data key per project
  - a different master key fails; a copied ciphertext fails; delete
- **`vault/routes.test.ts` (7):**
  - 201 then 200; names only
  - **the canary never appears in any response or log line**, including failed saves, a missing key and a database outage
  - 401 when signed out; 404 for other people's projects; per-field 400; 413; the 503 fix message; a foreign `Origin` gets 403; delete
- **`ProjectSecrets.test.tsx` (5), `Projects.test.tsx` (+1):**
  - masked list; save clears the value and the canary isn't in the page
  - Replace; errors next to their field; two-click delete; the toggle opens the panel

**Checked against Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) (31 Oct 2026):** a throwaway script, with a test key and user, saved then replaced a value and read it back. Stored sizes were 41-byte ciphertext, 12-byte IV and 48-byte wrapped key; the value wasn't readable as text. It then deleted everything (0 left).

**Owner: create the local master key** (fish). It goes straight from `openssl` into the git-ignored `.dev.vars`, and the value is never printed:

```fish
printf '\nVAULT_KEY=%s\n' (openssl rand -base64 32) >> .dev.vars
grep -c '^VAULT_KEY=' .dev.vars        # 1 (counts the line; doesn't show it)
```

Then restart `pnpm dev`, because Wrangler reads `.dev.vars` only at startup. Losing this local key only loses local test secrets.

**Staging's key comes at phase close,** with the other Worker secrets. Generate it, **save it in your password manager first**, then `pnpm exec wrangler versions secret put VAULT_KEY` and paste it at the prompt. If the staging key is lost, every saved staging secret is lost with it.

**Run and check it:**

```fish
pnpm --filter @flowcanvas/control-plane test     # includes 21 vault tests
pnpm --filter @flowcanvas/web test
pnpm dev                                         # http://localhost:5173, signed in
```

Owner, by hand:
(Any name works: `MY_TEST_SECRET` is just an example. Nothing here connects to Stripe or any other service; you're only checking that a value can be stored and never shown back.)
1. On a project, click **Secrets**. It says "No secrets yet."
2. Save `MY_TEST_SECRET` with any made-up value. It's listed as `MY_TEST_SECRET ••••••••`, "Added by <you>", and the value field is empty again.
3. Type `MY_TEST_SECRET` again with a new value: the button says **Replace MY_TEST_SECRET**.
4. Try the name `my_test_secret`: you get the naming rule next to the Name field.
5. **Delete**, then **Delete MY_TEST_SECRET**: gone.
6. In devtools → Network, the `PUT` response contains only the name and `created` or `replaced`. In the terminal running `pnpm dev`, the value never appears.

**Gotchas:**
- **With only Node's types, `CryptoKey` is a value, not a type.** `AesKey` is derived from `crypto.subtle.importKey` instead, so it means the same in Workers and Node.
- **Bytes go to Postgres as hex** (`decode($1, 'hex')`), so Neon's HTTP driver and PGlite agree.

**Commit:** `feat: secrets vault with envelope encryption, write-only project secrets`

### Step 1c.7 — Workspace records and usage metering skeleton

**Goal:** every project has its cloud workspace record from the moment it's created, and the control plane can record and sum usage per person. Phase 1d's machines then only update the record and write usage; phase 44a builds limits and billing on the sums.

**Concepts:**
- **A data-modifying CTE** (`with p as (insert … returning *), w as (insert … select from p)`) runs two inserts as one statement, so both happen or neither does. Neon's HTTP driver sends one statement per request, so this replaces a multi-call transaction. https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-MODIFYING
- **A backfill migration** fixes existing rows when a rule changes. Migration 0002 gives projects created before this step their workspace record. Applied migrations are never edited (ADR 0014), so this is a new file.
- **Metering:** measure raw amounts (seconds, byte-hours) over periods, and sum them per billing period when needed. Each record must fall within one UTC month, so a monthly sum never has to split a record. The recorder splits at the boundary instead.

**What changed:**

| File | What |
| --- | --- |
| `services/control-plane/migrations/0002_workspace_for_every_project.sql` | Backfills a `not_created` workspace for every existing project |
| `services/control-plane/src/projects/projects.ts` | `createProject` inserts the project and its workspace in one statement; projects carry `workspace: { id, state }` |
| `services/control-plane/src/usage/usage.ts` | `monthPeriod` (UTC calendar month), `recordUsage` (refuses negative, fractional or impossible amounts, records crossing a month, more workspace seconds than the period has, and another person's workspace), `usageSummary` (this month's sums, a real 0 when nothing's recorded) |
| `services/control-plane/src/usage/routes.ts` | `GET /api/usage` (signed in only): `{ usage: { periodStart, resetsAt, workspaceSeconds, storageByteHours } }` |
| `apps/web/src/projects/` | Each project's line says its workspace state in words ("Workspace not created yet") |
| `apps/web/src/usage/` | **Usage this month**: workspace time ("2 h 5 min") and the reset date (shown in UTC, because the period is UTC) |

**Tests:**
- **`usage/usage.test.ts` (5, PGlite):**
  - the month period, including across a year end
  - a real 0 and the reset date before anything is recorded
  - sums this month only, per person and per kind
  - refuses six kinds of impossible record, and stores nothing
  - refuses another person's workspace; usage with no workspace is allowed
- **`usage/routes.test.ts` (3):** 401 when signed out; only the signed-in person's sums, with `no-store`; a database failure answers 503 without details, and is logged
- **`projects/projects.test.ts` (+1):** the workspace is created with the project, `not_created`, exactly once (a duplicate name creates none)
- **`db/schema.test.ts` (+1):** a project made before 0002 gets its workspace when 0002 runs
- **`Usage.test.tsx` (4), `Projects.test.tsx`, `App.test.tsx`:** time formatting; the measured time and reset date; a real 0; the error; the workspace state on each project; usage only for a signed-in person

**Applied to Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) (31 Oct 2026):** `pnpm db:migrate` applied 0002. A count afterwards showed 1 project, 1 workspace and none missing. Staging is migrated at phase close.

**Run and check it:**

```fish
pnpm --filter @flowcanvas/control-plane test     # 123 tests
pnpm --filter @flowcanvas/web test               # 52 tests
pnpm db:status                                   # 0002_workspace_for_every_project applied
pnpm dev                                         # http://localhost:5173, signed in
```

Owner, by hand (optional; the tests cover it):
1. Each project's line ends with "Workspace not created yet".
2. Under the projects, **Usage this month** says "Workspace time: 0 min. Resets <the 1st of next month>."

**Gotchas:**
- **Pull, then `pnpm db:migrate`.** Without 0002, projects created earlier have no workspace and drop out of the list.
- **Postgres `bigint` and `sum()` come back as strings** from drivers. The sums are cast to `float8` so they arrive as numbers; exact up to 2^53, far beyond any month's seconds.
- **No allowance or limit yet.** The meter shows only what was measured; inventing a free allowance now would be a product decision (phase 44a).

**Commit:** `feat(control-plane): workspace record with every project, usage metering skeleton`

### Step 1c.8 — Admin view

**Goal:** the admin can see who has signed in and how much each person uses, and manage the allowlist from the app instead of `pnpm db:allow`. Counts only: the admin view never shows project names, repository addresses or secrets.

**Concepts:**
- **Authorisation on the server, every time.** The page hides the Admin section from members, but that's only for clarity. Each `/api/admin` request checks the session and the role (`requireUser`, then `requireAdmin`), so calling the API directly gets 403.
- **Revoking access means ending sessions.** A session stays valid until it expires (30 days), whatever the allowlist says. Removing an email therefore deletes that person's sessions in the same statement, and they're signed out everywhere at once.
- **Lockout protection.** An admin can't demote or remove their own entry (409). Another admin has to do it, so the app can't be left with nobody able to manage it by accident.
- **Data minimisation:** an admin needs to know *how much*, not *what*. The queries return counts and sums, and a test checks that a project's name and address never appear.

**What changed:**

| File | What |
| --- | --- |
| `services/control-plane/src/admin/admin.ts` | `parseEmail` (trimmed, lower case, ≤ 254), `listPeople` (role, providers, project count, workspace seconds this month, last sign-in, still allowed), `listAllowlist` (role, added, signed up yet), `allowEmail` (add, or change the role; a signed-up person's role changes at once), `disallowEmail` (remove and end their sessions in one statement; their data stays) |
| `services/control-plane/src/admin/routes.ts` | `GET /api/admin`, `PUT /api/admin/allowlist/:email` with `{ role }` (201 added, 200 changed), `DELETE /api/admin/allowlist/:email` (204). Admins only; changes need our own `Origin`; 409 for your own entry. Logs the acting admin's user ID, never the email |
| `apps/web/src/admin/` | The **Admin** section: people with their counts; the allowlist with **Make admin** or **Make member**, a two-click **Remove**, and a form with an **Admin** switch. Your own entry shows "You" and no actions |
| `apps/web/src/App.tsx` | Keeps the whole session (not just "signed in"), and shows Admin only to admins |

**Tests:**
- **`admin/admin.test.ts` (4, PGlite):**
  - email parsing
  - people listed with counts and usage; **the project's name and address don't appear**
  - add, then change a role, including for someone already signed in
  - removal ends their session and keeps their data; removing twice reports nothing removed
- **`admin/routes.test.ts` (6):**
  - 401 signed out; 403 for members on every route
  - the view, with `no-store`
  - add, change and remove; **log lines never contain the email**
  - a removed person's next request gets 401
  - no self-demotion or self-removal (409)
  - bad email, bad role, and a foreign `Origin` refused
- **`Admin.test.tsx` (6), `App.test.tsx` (+1):** people's counts; no actions on your own entry; allow as admin; the field error; two-click remove; a load error; admins only

**Checked against Neon via `.dev.vars` (the `production` branch; see "1 Nov" in the decisions log) (31 Oct 2026):** a read-only script ran `listPeople` and `listAllowlist` and printed only roles and counts: 2 people, 2 allowlist entries.

**Run and check it:**

```fish
pnpm --filter @flowcanvas/control-plane test     # 133 tests
pnpm --filter @flowcanvas/web test               # 59 tests
pnpm dev                                         # http://localhost:5173, signed in as the admin
```

Owner, by hand:
1. Under Usage, the **Admin** section lists everyone who has signed in, with providers, project count, workspace time and last sign-in.
2. In **Allowlist**, your own email says "You" and has no buttons.
3. Allow a made-up address such as `test-person@example.com`. It appears as "Member · hasn't signed in yet". Click **Make admin**, then **Make member**.
4. **Remove**, then **Remove test-person@example.com**: it's gone.
5. Optional: sign in with your second account in another browser, remove it here, then reload there. It's signed out.

**Gotchas:**
- **A data-modifying CTE runs even if nothing reads it.** `allowEmail` updates `users.role` in a CTE that the final `select` doesn't use. Postgres still runs it, which keeps the role change in one statement.
- **The email goes in the path, URL-encoded** (`/allowlist/ada%40example.com`). Hono decodes it, and `parseEmail` lower-cases it, so `Ada@Example.com` and `ada@example.com` are the same entry.

**Commit:** `feat: admin view with people, usage and allowlist management`

### Step 1c.9 — Logs and redaction across everything; the walkthrough

**Goal:** prove the phase's *Done when*, "saved secrets never appear in logs", for the whole control plane at once, not route by route. Also make leaking hard even for code written later, and record the phase's Try it as a walkthrough.

**Concepts:**
- **Defence in depth for logs.**
  - First, routes log short messages and never raw requests or error objects.
  - Second, every line passes through `redact()` on its way out (in `createApi`), so a mistake in a future route is still caught.
  - Third, a test plants canaries and checks everything.
- **Over-redaction is the safe failure.** The patterns also hide harmless text, such as `state: running` or any email address. Losing a little log detail beats leaking a token.
- **A mutation check proves a test can fail.** With `redact()` switched off, `no-leaks.test.ts` fails on the leaked database password; with it on, it passes. A leak test that can't fail proves nothing.
- **Playwright `page.route`** answers the page's requests from inside the test, so the signed-in steps can be recorded without a real GitHub sign-in. https://playwright.dev/docs/mock

**What changed:**

| File | What |
| --- | --- |
| `services/control-plane/src/api/redact.ts` | Also removes GitHub and Google tokens; OAuth `code`, `state`, verifier, client secret and tokens (query strings, form bodies, JSON); our `__Host-fc_*` cookies; email addresses |
| `services/control-plane/src/api/app.ts` | Wraps `log` so every line is redacted. `onError` answers uncaught errors with a plain 500 and logs only a redacted description |
| `services/control-plane/src/api/no-leaks.test.ts` | The phase's acceptance test (below) |
| `e2e/try-it/phase-1c.spec.ts` | The phase 1c walkthrough (below) |

**Tests:**
- **`api/app.test.ts` (+4):**
  - each new redaction pattern; ordinary messages untouched
  - a route that logs raw text is still redacted
  - an uncaught error answers 500 and logs nothing private
- **`api/no-leaks.test.ts`: the phase's acceptance test.**
  - **Flow:** a fake GitHub sign-in, then create a project; save and replace a secret; list secrets, projects, usage, the admin view and `/api/me`.
  - **Failures:** a missing vault key, a bad name, an oversized value, a database outage on every route, a GitHub that echoes what it was sent, then sign out.
  - **Canaries:** the secret value, the rotated value, the OAuth client secret, the code, the GitHub token and the database password. None may appear in any response (body and headers), any log line or anything written to the console. The email may not appear in logs or the console.
- **`e2e/try-it/phase-1c.spec.ts` (2 walkthroughs):**
  1. **Real API:** signed out, the page offers sign-in or says where it works, and `/api/projects`, `/api/usage`, `/api/admin` and `/api/projects/x/secrets` answer 401 with `no-store`. Skipped only where there's no API. Locally, `vite preview` forwards `/api` to `pnpm dev` if it's running.
  2. **Real page, API answered by the test:** projects, usage and admin shown; create a project; save a secret. Afterwards it's listed by name and masked, the field is empty, and the value appears neither in the page nor in any response.

**Why the signed-in walkthrough uses a fake API:** a real sign-in needs a GitHub or Google account and only works on staging, so it can't run unattended. Instead:
- the API's side is proven by `no-leaks.test.ts`
- the page's side by walkthrough 2
- the real sign-in, and Cloudflare's own request logs, by the owner's check at phase close

**Run and check it:**

```fish
pnpm --filter @flowcanvas/control-plane test     # 138 tests, including no-leaks
pnpm test:e2e                                    # 6 walkthroughs, 2 for phase 1c
pnpm --filter @flowcanvas/e2e report             # watch the recordings
```

**Owner, at phase close** (on staging, after merge):
1. Sign in with GitHub, create a project, and add a secret with a made-up value.
2. In the Cloudflare dashboard, go to Workers & Pages → `flowcanvas` → Observability → Logs, and search for the made-up value. There should be no results.
3. Open the `GET /api/auth/callback/github` entry. If its URL shows `code=` or it lists request headers with cookies, turn invocation logs off in `wrangler.jsonc` (`"observability": { "enabled": true, "logs": { "invocation_logs": false } }`). Cloudflare's docs don't say what these logs record or redact, so we check by looking.

**Gotchas:**
- **`getByLabel('Value')` also matched "Value hidden"** (the masked dots' label). Use `{ exact: true }`.
- **`vite preview` uses the dev server's proxy too** (`preview.proxy` defaults to `server.proxy`). So a local walkthrough reaches the real local API when `pnpm dev` is running.

**Commit:** `feat(control-plane): redact every log line, no-leaks acceptance test, phase 1c walkthrough`

### Step 1c.10 — Close the phase (0.4.0)

**Goal:** release 0.4.0 and write the phase report. Then open the PR, and after the merge make staging work: secrets, database and the real Try it.

**What changed:**
- `package.json` version `0.4.0`. The version page and What's new show it. The guard test keeps the newest changelog entry equal to it.
- `CHANGELOG.md`: the 0.4.0 entry, with Try it first (shown in What's new).
- `docs/reports/phase-1c.md`: the report, including the after-merge checks in order.
- `docs/STATUS.md`: 1c in review. `docs/upgrade-later.md`: item 20's trigger moved to the first Labs switch. `ARCHITECTURE.md`: the version example.

**Evidence (31 Oct 2026):**
- 347 tests pass, the format, lint and type checks pass, the build passes (web bundle 131 kB gzip), and all 6 walkthroughs pass.
- CI runs the same checks, plus visual tests in Docker, on the PR.

**Owner, after the merge (staging), in this order:**

1. **Wait for staging to deploy `main`:** Cloudflare → Workers & Pages → `flowcanvas` → Deployments shows the merge commit.
2. **Put the Worker secrets,** one at a time. Each command prompts for the value, so it's never typed on the command line:
   ```fish
   pnpm exec wrangler versions secret put DATABASE_URL          # Neon production branch URL
   pnpm exec wrangler versions secret put GITHUB_CLIENT_ID      # the STAGING OAuth app
   pnpm exec wrangler versions secret put GITHUB_CLIENT_SECRET  # a NEW secret, generated on the staging OAuth app
   pnpm exec wrangler versions secret put GOOGLE_CLIENT_ID
   pnpm exec wrangler versions secret put GOOGLE_CLIENT_SECRET
   pnpm exec wrangler versions secret put VAULT_KEY             # new; in the password manager first
   pnpm exec wrangler versions deploy                           # pick the newest version, 100%
   ```
   To create the staging vault key, run `openssl rand -base64 32`, save the output in the password manager, then paste it at the `VAULT_KEY` prompt. Afterwards, clear the terminal.
3. **Migrate staging and allow yourself** (fish; the URL is typed at a hidden prompt):
   ```fish
   read -s -P 'Neon production URL: ' DATABASE_URL; DATABASE_URL=$DATABASE_URL pnpm db:status; DATABASE_URL=$DATABASE_URL pnpm db:migrate; DATABASE_URL=$DATABASE_URL pnpm db:allow <your email> --admin; set -e DATABASE_URL
   ```
4. **Check** that `https://flowcanvas.ahujaarmaan7777.workers.dev/api/db/ping` says `"database":"ok"`, and that the page offers sign-in.
5. **Try it on staging:** sign in with GitHub, create a project, and add a secret with a made-up value.
6. **Cloudflare's logs:** Workers & Pages → `flowcanvas` → Observability → Logs (or Events).
   - Search for the made-up value: there should be no results.
   - Open the `GET /api/auth/callback/github` entry. If it shows `code=` or a `cookie` header, tell Claude: invocation logs get turned off in a follow-up PR.

**Commit:** `chore: release 0.4.0, close phase 1c`

## Phase 1d — Workspace sandbox

**From the build plan:**
- **Build:** one isolated virtual machine per project; clone a repo; file and process API; terminal in the browser; outbound network rules; resource limits; sleep when idle and resume.
- **Done when:** a fork clones and opens in under 60 s; a workspace sleeps after 10 idle minutes and resumes intact; workspaces can't reach each other.
- **Try it:** open Rallly from its GitHub URL, run a command in the terminal, wait for sleep, then resume.
- **Also here:** the "Open demo project" button, moved from 1b (decisions log, 29 Oct 2026).

**Owner decisions (4 Nov 2026, decisions log):**
- **Workspaces run in local Docker containers for now.** The chosen cloud provider, E2B, turned out to need a $5 payment before it would issue an API key, so the cloud provider will be chosen and connected later (upgrade-later 33).
- **When it closes, this phase goes to "in review", not "accepted",** and phase 2 goes ahead. The phase is accepted once a cloud provider is connected and the *Done when* checks pass on staging.

**Why this phase matters:** everything after it runs inside these machines: the editor's files (phase 3), the analysis engine, live frames and the agents. It's also the first time the product runs code it didn't write, so isolation and limits come before features.

**Why containers are only a stand-in:** a container shares the host's kernel, so it isolates less than a VM does. The build plan asks for VMs. Everything goes through our own `WorkspaceProvider` interface, so connecting a cloud provider later replaces one adapter and nothing else. Until then, the local setup gets as close as containers allow: a non-root user, dropped capabilities, Docker's seccomp profile, a network of its own for each workspace, and limits.

**Expected outcome (locally, with `pnpm dev`):**
- A project has an **Open** button. It starts the project's own container and clones its repository in under 60 seconds.
- A **terminal** in the page runs commands inside that container.
- A status chip says Starting, Running, Sleeping or Resuming (Figma 29). After 10 idle minutes the workspace sleeps (it's paused, with memory and processes frozen). **Resume** brings it back with files and running processes intact.
- **Open demo project** opens Rallly in one click.
- Tests prove that two workspaces can't reach each other, and that secrets never reach logs.
- **On staging,** projects honestly say "Workspaces run locally for now" until a cloud provider is connected. Nothing is faked.

**Concepts this phase introduces** (each gets a primer in its step):
- Containers vs VMs: namespaces, cgroups, seccomp, capabilities: https://docs.docker.com/engine/security/
- The Docker Engine API, and why its socket is root-equivalent: https://docs.docker.com/engine/api/
- `docker pause` and the cgroup freezer: https://docs.docker.com/reference/cli/docker/container/pause/
- Internal networks and an egress proxy: https://docs.docker.com/engine/network/drivers/bridge/
- WebSockets and Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
- Terminals: ptys and xterm.js: https://xtermjs.org/

**Design references:**
- Figma 29, workspace status (chip, plus the Starting, Sleeping and Resuming cards).
- Figma 18, terminal (minimal for now).
- Design brief: "Cloud workspace screens (29–33)" and "18. Terminal and run manager".
- They sit on the version page until the phase 2 app shell.

**Scope:**
- **In:**
  - our own `WorkspaceProvider` interface, with a Docker adapter
  - a **local workspace host** (`workspace/host`): a small Node service on 127.0.0.1, protected by a token, and the only thing that talks to Docker
  - the lifecycle in the control plane
  - clone; the file and process API; the terminal
  - network rules; CPU, memory, process-count and time limits
  - sleep after 10 idle minutes, and resume
  - usage metering (`workspace_seconds`)
  - the status chip and cards; Open demo project
- **Out:**
  - a cloud sandbox provider (later, upgrade-later 33)
  - the editor (phase 3)
  - the app's dev server as a live frame (stage 2)
  - backups and restore history (18a)
  - agents in the workspace (stage 3)
  - project secrets as environment variables in the workspace: only if simple and safe here, otherwise a later phase, decided in step 5

**How the pieces talk:**
browser → Worker (`/api`, in `wrangler dev`) → local workspace host (127.0.0.1, token) → Docker → workspace container (runs `workspace/agent`). The Worker never touches the Docker socket. The host accepts only a fixed set of operations: no image names, mounts or flags come from requests.

### Steps (planned)

| # | Step | Status |
| --- | --- | --- |
| 0 | Docker on the dev machine: works without sudo (checked: Docker 29.9.2, cgroup v2, `hello-world` ran) | done (Claude, 4 Nov) |
| 1 | Spike: the Worker in `wrangler dev` reaching a loopback host. Clone timing for Rallly; pause and resume intact; two containers on separate internal networks; how the host talks to the agent (`docker exec` stdio or the bridge address). ADR 0016 | done (Claude, 4 Nov) |
| 2 | Workspace image (`workspace/image`): Node 24, pnpm, git, non-root user; CPU, memory, process and disk limits | done (Claude, 4 Nov) |
| 3 | `WorkspaceProvider` interface; lifecycle and states in the control plane, tested with a fake provider | done (Claude, 4 Nov) |
| 4 | Local workspace host and Docker adapter; a minimal egress proxy (GitHub only); open a project: create the container and clone the repo; timed. Also the 2-workspace cap, `pnpm workspace:clean` and `pnpm workspace:resources` | done (Claude, 4 Nov) |
| 5 | File and process API (the agent in the container): typed, versioned, owner only | done (Claude, 4 Nov) |
| 6 | Terminal (ADR 0017), in three parts: | |
| 6.1 | Terminal sessions on the host: a pty through Docker's API, a WebSocket endpoint | done (Claude, 4 Nov) |
| 6.2 | The Worker's WebSocket relay (owner, origin, running checks) and the adapter; Vite forwards WebSockets | done (Claude, 4 Nov) |
| 6.3 | The terminal on the page: xterm.js, token colours, the CSP shim; a walkthrough under the deployed CSP | done (Claude, 4 Nov) |
| 7 | Network rules: the egress proxy's full allowlist and address checks; limits; the isolation test | done (Claude, 5 Nov) |
| 8 | Sleep after 10 idle minutes and resume intact; usage metering writes workspace seconds | done (Claude, 5 Nov) |
| 8a | The resource guard: laptop pressure and Flowcanvas's budget checked every 30 s; refuse, sleep, stop, clean up (owner, 4 Nov) | done (Claude, 5 Nov) |
| 9 | Status chip and cards (Figma 29); Open demo project (Rallly); staging's "Workspaces run locally for now". In three parts: | |
| 9.1 | Pinned clones (migration 0004) and the demo endpoint | done (Claude, 5 Nov) |
| 9.2 | `WorkspaceStatus` chip in the design system, with catalogue stories and baselines | done (Claude, 5 Nov) |
| 9.3 | The project's workspace panel: chip, actions, starting and sleeping cards, notices, staging; Open demo project; walkthrough | done (Claude, 6 Nov) |
| 10 | Security tests (canary secrets, isolation), walkthrough, timing; Docker tests in CI if the runners allow | done (Claude, 6 Nov) |
| 11 | Close the phase as **in review** (0.5.0): report, and what waits for the cloud provider | done (Claude, 6 Nov; staging migration by the owner) |

### How each Done-when item is proven

| Item | Now (Docker, locally and in CI) | Waits for the cloud provider |
| --- | --- | --- |
| A fork clones and opens in under 60 s | A timed test opens Rallly. It records the time and fails above 60 s | The same test against staging |
| Sleeps after 10 idle minutes, resumes intact | Lifecycle tests with a fake clock and fake provider. A Docker test with a short idle limit: write a file, start a process, sleep, resume, check both. One real 10-minute run at phase close | The same live test on the provider |
| Workspaces can't reach each other | A Docker test starts two workspaces. One tries the other's address, the host and the private and metadata ranges, and every attempt must fail | Repeated on the provider, whose network differs |

### Risks and questions (checked at every step)

Each step's write-up ends with a **Risks** line saying what changed. The phase report closes each one, or hands it to the provider step.

| # | Risk or question | How we keep it in check | Status |
| --- | --- | --- | --- |
| R1 | **Containers aren't VMs:** they share the host's kernel, so a kernel bug could let code escape | Non-root user, all capabilities dropped, `no-new-privileges`, Docker's seccomp profile, no Docker socket inside, limits. Only the owner uses it. A gVisor runtime is an optional hardening (upgrade-later 34). Real VMs come with the cloud provider | open until real VMs (the cloud provider, R8) or gVisor (upgrade-later 34). **Step 7:** the network side is proven by the isolation test; the kernel is still shared. Step 1: the locked-down flags didn't get in the way of git. **Step 2:** every flag is set in one place (`runArgs`) and checked from inside a real container (`pnpm test:docker`) |
| R2 | **The Worker in `wrangler dev` has to reach the local host** | The step 1 spike checks it before anything is built on it. The fallback is calling the host from Vite's proxy | **closed (step 1):** works, 3–4 ms per call |
| R3 | **"Can't reach each other" is now our job,** not a provider's | Each workspace gets its own internal network with no route out. The internet goes only through an egress proxy with an allowlist. Measured in step 1; the test comes in step 7 | **closed locally (step 7):** the isolation test tries the other workspace (both ways), the proxy's other sides, this computer's own addresses, the metadata address, DNS and IPv6, directly and through the proxy, and fails when the gateway isolation is removed. Repeated on the cloud provider (R8). **Step 1:** internal networks alone still let a container reach the host. The isolated gateway mode (Docker 28+) closes that, and is now required (ADR 0016) |
| R4 | **`docker pause` keeps memory in use,** and a host restart loses paused processes | It's fine for a few local workspaces. After a restart, a workspace shows as stopped with its files kept (in a volume), never as lost. The cloud provider brings real snapshots | open: step 8a (the memory a paused workspace holds; the guard stops one under pressure). **Step 8:** the real tick put a workspace to sleep after 10 idle minutes; after resume its file was there and the same process was still counting (Docker test). **Step 1:** pause and resume take about 50 ms each way; the same process carried on, and files were kept |
| R5 | **Under 60 s for Rallly** depends on the clone and the home connection | Step 1 times a real clone. A shallow clone (`--depth 1`) and a prebuilt image keep it short. Dependencies install after "open", in the background, outside the 60 s | **closed (step 4):** 8.9 s through the egress proxy (clone 7.0 s), checked by a Docker test that fails above 60 s. Repeated on the cloud provider later (R8) |
| R6 | **The Docker socket is root-equivalent,** so whatever drives it is powerful | Only the host touches it. The host listens on 127.0.0.1 only and needs a token (`WORKSPACE_HOST_TOKEN` in `.dev.vars`). It takes no image names, mounts or flags from requests. Canary tests cover the token | open: step 10. **Step 4:** the host takes only fixed operations on checked names, needs the token (compared in constant time), refuses browsers (Origin, Host); the adapter sends the token only to loopback addresses; tests check it's never logged or shown |
| R7 | **Untrusted code runs on the owner's laptop:** a cloned repo or a terminal command could mine crypto or attack the home network | Limits (step 2); egress only through the proxy, with the home network and metadata ranges blocked (step 7); sleep when idle (step 8); only allowlisted people can open workspaces | **closed locally (step 8):** idle workspaces sleep after 10 minutes (the tick), and time nobody could use isn't metered. Abuse detection is phase 43. **Step 7:** egress only through the proxy, to five allowlisted hosts, with tunnel limits; the home network and metadata address unreachable (tested). **Step 2:** CPU, memory, process and `/tmp` limits are enforced (tested). Disk is measured, not capped (upgrade-later 35) |
| R9 | **Workspaces could overload the owner's laptop** | The resource guard (step 8a): 2 workspaces at most, a 25 GiB disk budget, and pressure thresholds that refuse, sleep, stop and clean up, acting only on Flowcanvas's own things. `pnpm workspace:resources`, and a "Laptop" line in every step's Risks | **closed locally (step 8a):** the guard refuses under pressure, and the tick stops (memory) or sleeps (load) the least recently used workspace; only Flowcanvas's own things are touched (tested, ADR 0019). **Step 4:** the 2-running cap is enforced by the host (tested), and `pnpm workspace:resources` and `pnpm workspace:clean` exist |
| R8 | **The phase can't be fully accepted yet:** the *Done when* items are proven locally, not on staging | The phase is "in review" in STATUS. Upgrade-later 33 holds the provider step, and the phase report lists exactly which checks wait for it. Later phases that need workspaces on staging say so in their plans | open: until the provider is connected |

### Step 1d.0 — Docker on the dev machine (done)

**Goal:** Docker runs containers for the owner's user without sudo, so the local workspace host can use it.

**Checked by Claude (4 Nov 2026):**
- `docker version`: server 29.9.2
- cgroup v2, with Docker's built-in seccomp profile
- `docker run --rm hello-world`: printed "Hello from Docker!"
- the user is in the `docker` group

**Concepts:**
- **The `docker` group is root-equivalent.** Anyone who can use the Docker socket can start a container that mounts `/` and so control the machine. That's why only our host process talks to Docker, never the Worker or the browser (R6). https://docs.docker.com/engine/security/#docker-daemon-attack-surface

**Earlier attempt:** the plan first used E2B, but creating an API key needed a $5 payment. The owner chose local Docker instead (decisions log, 4 Nov 2026). The `E2B_API_KEY` line was removed from `.dev.vars.example`. If one was added to `.dev.vars`, it can stay or go; nothing reads it.

**Risks:** R1–R8 are set; nothing is built yet.

### Step 1d.1 — Spike: Docker workspaces end to end (done by Claude)

**Goal:** before building anything, check that the plan works on real containers: the clone time, pause and resume, isolation, and how the pieces talk. The answers shape ADR 0016.

**Concepts:**
- **Internal networks and the gateway mode.**
  - A Docker `--internal` network has no route to the internet, but the host still has an address on it (the gateway), so a container can reach anything on the host that listens on all interfaces.
  - Docker 28 added `gateway_mode_ipv4=isolated`. The host gets no address on the network, so the container's only neighbours are its own subnet.

  https://docs.docker.com/engine/network/drivers/bridge/
- **The cgroup freezer.** `docker pause` freezes every process in the container's cgroup. Nothing runs, but memory and open files stay as they were, so `docker unpause` carries on exactly where it stopped. https://docs.docker.com/reference/cli/docker/container/pause/
- **Why stdio and not a port.** With the isolated gateway mode, even the host can't connect to the container's address. `docker exec -i` gives a pipe into the container without opening any port. One long-lived stream is fast (under a millisecond per message); a new `docker exec` per call costs about 105 ms.
- **Testing reachability safely.** To learn whether packets reach the host, connect to a closed port. "Connection refused" means they arrive and the host's kernel answered; "Network is unreachable" means there's no route. No test service has to be exposed.

**What was run** (throwaway files in the scratchpad, not in the repo):
1. A spike image: `node:24-slim` plus git, curl, ping and netcat, running as the `node` user.
2. **Clone:** a container with `--cap-drop ALL --security-opt no-new-privileges --cpus 2 --memory 2g --pids-limit 512`. It shallow-fetched the pinned Rallly commit from the owner's fork.
3. **Pause and resume:** a counter process and a file. Pause for 5 s, resume, compare the PID, the counter and the file. Timed `pause` and `unpause`.
4. **Isolation:** two containers, each on its own internal network. Each tried the other (TCP and ping), the internet, GitHub, the metadata address and the host. Then the same again with the isolated gateway mode.
5. **Worker to host:** a throwaway Worker under `wrangler dev` called a token-checked Node server on 127.0.0.1.
6. **Host to agent:** 200 messages over one `docker exec -i` stream.

**Results:**

| Check | Result |
| --- | --- |
| Clone Rallly (52 MB, 1,947 files) | 6.2 s (start 0.5 s, clone 5.8 s); 7.0 s and 7.5 s in two more runs |
| Pause and resume | About 50 ms each way; same PID (38); the counter froze, then carried on; the file kept; 7 MiB while paused |
| Internal networks: each other, internet, metadata | All blocked |
| Internal networks: the host | **Reachable**. Fixed with the isolated gateway mode, where everything outside the container's own subnet is unreachable |
| Worker → 127.0.0.1 with a token | 200, 3–4 ms |
| One `docker exec -i` stream | p50 0.68 ms, p99 1.22 ms |

**Decisions (ADR 0016):**
- Every workspace network is `--internal` with the isolated gateway mode, so Docker 28 or newer is required.
- The host talks to the agent over `docker exec -i` JSON lines.
- The internet is reached only through an egress proxy. A minimal one moves into step 4, because the clone needs GitHub.

**Run and check it:** there's nothing to run in the repo yet. To repeat the key isolation check:
```fish
docker network create --internal -o com.docker.network.bridge.gateway_mode_ipv4=isolated fc-try
docker run --rm --network fc-try --cap-drop ALL node:24-slim node -e "require('net').connect(80,'172.17.0.1').on('error',e=>console.log(e.code))"
# ENETUNREACH: no route to the host
docker network rm fc-try
```

**Gotchas:**
- Without the gateway mode, an internal network looks isolated but still reaches your laptop's services (databases, dev servers). The isolation test in step 7 checks the host, not only other workspaces.
- The spike's first host-reachability attempt started a test listener on all interfaces. Claude Code's safety check blocked it, rightly. The closed-port probe gives the same answer without exposing anything.

**Docs:** ADR 0016; ARCHITECTURE ("Workspaces"); this write-up; the risk statuses above.

**Risks:**
- R2 closed.
- R3: the gap found (host reachable) is closed by the gateway mode; the test comes in step 7.
- R4 and R5: measured, well within limits.
- R1, R6, R7 and R8 unchanged.

**Commit:** `docs: phase 1d spike results; ADR 0016 local Docker workspaces`

### Step 1d.2 — The workspace image and its limits (done by Claude)

**Goal:** one image every workspace starts from, and one place that decides how its container is started and limited, proven from inside a real container.

**Concepts:**
- **Pinning by digest.** `node:24-slim` is a moving tag; `node:24-slim@sha256:…` is one exact image. Rebuilding gives the same base until we choose to move it. https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier
- **Content-addressed tags.** The image is tagged with a hash of its Dockerfile (`flowcanvas-workspace:b6722cf7e5d0`). Any change to the file means a new tag, so a stale image can never be mistaken for a current one, and there's no version number to forget to bump.
- **Capabilities.** Linux splits root's powers into about 40 capabilities (changing file owners, binding low ports, tracing processes and so on). `--cap-drop ALL` removes all of them, and `no-new-privileges` stops a program from regaining them through setuid binaries. The test reads `CapEff` and `NoNewPrivs` from `/proc/self/status` to prove it. https://man7.org/linux/man-pages/man7/capabilities.7.html
- **cgroup limits.** `--cpus`, `--memory` and `--pids-limit` become files in the container's cgroup (`cpu.max`, `memory.max`, `pids.max`). The kernel enforces them: a process over the memory limit is killed (exit 137), and a fork over the process limit fails. https://docs.kernel.org/admin-guide/cgroup-v2.html
- **A read-only root.** With `--read-only`, the only writable places are the workspace volume (`/workspace`, home directory included) and a size-capped tmpfs `/tmp`. That shrinks what untrusted code can change, and it's why the disk limit only has to watch one volume.
- **Unit tests vs Docker tests.** `pnpm test` must run anywhere, including CI's checks job, so it only tests the argument builder. Tests that need Docker are named `*.docker.test.ts` and run with `pnpm test:docker`.

**Files:**

| File | What it is |
| --- | --- |
| `workspace/image/Dockerfile` | `node:24-slim` by digest; `git`, `ca-certificates`, `procps`; pnpm 12.15.0 with `--ignore-scripts`; `/workspace` owned by `node`, `HOME=/workspace/.home`; telemetry off (`DO_NOT_TRACK`, `NEXT_TELEMETRY_DISABLED`, npm notices); `USER node`; `CMD sleep infinity` (the agent comes in step 5) |
| `workspace/image/.dockerignore` | `*`: the build needs nothing from the folder |
| `workspace/image/src/spec.ts` | `imageTag()`; `WORKSPACE_LIMITS` (2 CPUs, 4 GiB with no swap, 1,024 processes, 1 GiB `/tmp`, 10 GiB disk); `networkCreateArgs()` (internal, isolated gateway); `runArgs()`. Names must match `^[a-z0-9][a-z0-9_.-]{0,62}$`, so none can be read as a flag. Limits must be positive and finite, the image must be ours, and the image goes last |
| `workspace/image/src/docker.ts` | `imageExists()`, `buildImage()` (skips when the tag exists) |
| `workspace/image/scripts/build-image.ts` | `pnpm workspace:image [--force]` |
| `workspace/image/src/spec.test.ts` | 15 unit tests: the tag, the Dockerfile (digest, Node major from `.nvmrc`, pnpm from `packageManager`, user, telemetry), the network arguments, every flag, overrides, refusals |
| `workspace/image/src/image.docker.test.ts` | 10 tests in real containers (below) |
| `package.json`, `turbo.json` | `workspace:image` and `test:docker` |

**What the Docker tests prove** (`pnpm test:docker`, 12 s once the image exists):
- Node 24, pnpm 12.15.0 and git are installed.
- The container runs as uid 1000, `CapEff` and `CapPrm` are 0, and `NoNewPrivs` is 1. There's no Docker socket inside.
- `/etc` and `/usr` are read-only; `/workspace`, its home directory and `/tmp` are writable.
- Files in the volume survive replacing the container.
- `/tmp` stops at its size ("No space left on device").
- Going over the memory limit kills the process (exit 137), and swap equals memory.
- At the process limit, forks fail ("Cannot fork"), with at most the limit running.
- `cpu.max` is `200000 100000` (2 CPUs).
- No route to the host's Docker bridge, the internet or the metadata address (`ENETUNREACH`).

**Run and check it:**
```fish
pnpm workspace:image          # "Built flowcanvas-workspace:<hash> in …" (about a minute the first time), then "up to date"
pnpm test                     # includes the 15 unit tests; needs no Docker
pnpm test:docker              # 10 passed; leaves no fc-test-* containers, volumes or networks
docker run --rm (docker images -q flowcanvas-workspace | head -1) sh -c 'node -v; pnpm -v; id'
```

**Gotchas:**
- **Zero-filled memory doesn't count.** The first memory test allocated a zeroed 256 MB buffer under a 64 MB limit, and it survived: Linux maps untouched zero pages lazily. Filling the buffer with 1s makes the pages real, and the kernel kills the process.
- **At the process limit, the shell itself can't fork.** Counting with `pgrep` inside the same script fails, so the test counts from the host (`docker stats --format {{.PIDs}}`).
- **Disk limits depend on the storage driver.** On this machine (overlayfs on btrfs), `--storage-opt size=200M` is accepted but a 400 MB write still succeeds, and local volumes have no quotas. The host measures the volume instead (step 8; upgrade-later 35).
- **Apt packages aren't pinned to versions,** only the base image is. Rebuilding with `--force` may get newer git or procps from Debian's security updates, which is what we want for now.

**Docs:** this write-up; ARCHITECTURE (parts table, "Workspaces", local commands); upgrade-later 35; STATUS; the risk statuses above.

**Risks:**
- R1: the lock-down is in one function and proven from inside a container.
- R7: CPU, memory, process and `/tmp` limits are enforced; disk is measured, not capped (item 35).
- The others are unchanged.

**Commit:** `feat(workspace): workspace image, locked-down container settings and Docker tests`

### Step 1d.3 — `WorkspaceProvider` and the lifecycle (done by Claude)

**Goal:** the control plane knows each workspace's state and moves it safely between states. It does that through one interface that a Docker adapter (step 4) and, later, a cloud provider plug into. Tested with a fake provider, so no Docker is needed.

**Concepts:**
- **A state machine in the database.** The workspace's state lives in Postgres, and only a fixed set of moves is allowed (diagram in ARCHITECTURE, "Workspace lifecycle"). The page reads it, so it always shows the control plane's view, never a guess.
- **Compare-and-set with a version number** (optimistic concurrency). Every change is `update … set state = $new, version = version + 1 where id = $id and version = $versionWeRead`. If two requests race, only one matches the version; the other gets no row back and answers 409. Neon's HTTP driver has no multi-statement transactions, so one-statement changes are how we stay correct. https://www.postgresql.org/docs/current/sql-update.html
- **Calling something slow between two statements.** `open` first moves to `creating` (which claims the workspace), then calls the provider (seconds), then moves to `running`. A request that arrives in between sees `creating` and is told to wait. If the first request dies part-way, `creating` would stay forever, so after 5 minutes (`STUCK_MS`) opening again is allowed.
- **Errors with a safe sentence.** A provider throws `ProviderError(kind, userMessage)`. The kind decides what happens to the state, and the message is what the page shows and the database stores. Anything else, such as a raw error that could quote a token or path, is replaced with a plain sentence. Only a redacted description goes to the log.
- **Dependency injection for the provider.** `ApiDependencies.workspaceProvider(env)` decides what runs workspaces. Tests pass the fake; step 4 passes the Docker adapter when the local host is configured; staging passes nothing, and the API honestly says so.

**Files:**

| File | What it is |
| --- | --- |
| `services/control-plane/migrations/0003_workspace_lifecycle.sql` | `provider`, `provider_ref`, `version`, `state_changed_at`, `running_since`, `last_active_at`, `failure` (≤ 300 characters); a check that `running_since` is set exactly while running; an index on running workspaces by last activity |
| `src/workspaces/provider.ts` | `WorkspaceProvider` (`create`, `start`, `pause`, `resume`, `stop`; every method safe to call twice); `ProviderError` with kinds `unavailable`, `gone`, `refused`, `failed` |
| `src/workspaces/lifecycle.ts` | `loadWorkspace`, `openWorkspace` (create, start again, or resume), `sleepWorkspace`, `resumeWorkspace`, `stopWorkspace`, `touchWorkspace`, `sleepIdleWorkspaces`; usage recorded on sleep and stop, split at month ends |
| `src/workspaces/routes.ts` | `GET /api/projects/:id/workspace`; `POST …/open`, `/sleep`, `/resume`, `/stop` (same origin); statuses 409, 502 and 503 with the sentence to show; logs by IDs only |
| `src/test/fake-provider.ts` | In-memory provider for tests: `failNext`, `holdNext` (to create races), `lose` |
| `src/workspaces/lifecycle.test.ts` | 24 tests against real SQL (PGlite) with a test clock |
| `src/workspaces/routes.test.ts` | 9 tests through the whole API |
| `src/api/app.ts`, `src/projects/routes.ts`, `src/projects/projects.ts` | `workspaceProvider` dependency (none by default); routes mounted; `isUuid` shared |

**What the tests prove:**
- **Open:**
  - first time: create with the repository
  - already running: nothing more happens
  - asleep: resume instead of creating another
  - stopped: start again, same files
  - stopped but lost by the provider: create again
- **Failures:**
  - a failed clone shows "failed" with its sentence, and can be tried again
  - "host down" or "laptop busy" leaves the state as it was
  - an unexpected error never reaches the page or the database (canary)
- **Races:**
  - a second open while the first is starting is refused, and only one create happens
  - a crashed start can be taken over after 5 minutes
  - two sleeps with the same stale view record usage only once
- **Usage:**
  - only running time counts (60 s, an hour asleep, then 30 s is 90 s)
  - a run across midnight on 31 October is two records (60 s and 60 s)
- **Sleep and resume:**
  - resume when lost while asleep: "stopped", with a message saying the files are kept
  - resume refused: stays asleep with the reason
  - pause fails: stays running
  - stop works from running or sleeping, and a lost one counts as stopped
  - moves that make no sense are refused
- **Idle:** asleep at exactly 10 idle minutes, counted from the last activity.
- **Database:** the check constraint refuses "running" without a start time, and the reverse.
- **Routes:**
  - the whole cycle works
  - with no provider, "Workspaces run locally for now"
  - problems map to statuses
  - checks for same origin, signed in and own project
  - only the four actions exist
  - the provider's name for the workspace never appears in a response
  - log lines use IDs only

**Run and check it:**
```fish
pnpm test                                                   # 395 tests; control-plane 171
pnpm --filter @flowcanvas/control-plane exec vitest run src/workspaces   # the 33 new ones
pnpm db:status                                              # dev branch: 0001–0003 applied
```
There's nothing to click yet. With no provider configured, `POST /api/projects/<id>/workspace/open` answers 503 "Workspaces run locally for now". Step 4 connects the local host.

**Gotchas:**
- **Hono's regex route parameters aren't anchored when mounted.** `/:action{open|sleep|resume|stop}` also matched `/open/extra` inside the full API (alone, it didn't). It's now four explicit routes, and the test checks `/open/extra` and `/xopen` are 404 with no provider call.
- **Usage is written when a workspace stops running.** If the server died between the state change and the usage insert, that run would go uncounted (never overcounted). A very long active session is only counted when it sleeps; step 8 adds periodic records.
- **Migration 0003 is on the dev branch only.** Staging's database gets it at phase close (after-merge checks).

**Docs:** this write-up; ARCHITECTURE (data model, "Workspace lifecycle", the control plane's row); STATUS.

**Risks:**
- R8: the lifecycle is provider-neutral, so the cloud provider only adds an adapter.
- The others are unchanged.
- **Laptop:** 22 of 30 GiB available, 581 GB disk free, load 6.2 (tests running). Flowcanvas has one 559 MB image and no containers, volumes or networks.

**Commit:** `feat(control-plane): workspace lifecycle behind WorkspaceProvider, migration 0003`

### Step 1d.4 — The local workspace host: opening a project for real (done by Claude)

**Goal:** opening a project starts its own container and clones its repository through the egress proxy, driven by the control plane through the provider interface. Plus the two commands for the owner's laptop (`pnpm workspace:resources`, `pnpm workspace:clean`) and the 2-workspace cap.

**Concepts:**
- **A loopback service with a token.** The host listens on 127.0.0.1 only, so nothing else on the network can reach it. Every request needs `Authorization: Bearer <WORKSPACE_HOST_TOKEN>`, compared as SHA-256 digests with `timingSafeEqual`, so timing reveals nothing about the token. https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- **Why the host also refuses browsers.** A web page you visit can send requests to `http://127.0.0.1:8790`. It can't read the answers (CORS), but a POST could still act. Browsers always add an `Origin` header to such requests, and a "DNS rebinding" page arrives with its own Host name. Refusing both, plus the token, closes that door. https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin
- **An HTTP CONNECT proxy.** For HTTPS, git and curl ask the proxy to `CONNECT github.com:443`, then speak TLS straight through it. The proxy sees only the host name, never the content. It checks the name against the allowlist, resolves it itself, and connects to an address it checked, so a DNS answer pointing at `10.x` or `127.0.0.1` is refused (DNS rebinding again). https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/CONNECT
- **`net.BlockList`.** Node's built-in list of address ranges. One surprise: it matches every IPv4 address against the IPv4-mapped IPv6 range `::ffff:0:0/96`, so that range blocked the whole IPv4 internet. IPv4-mapped addresses are now refused by a separate check. https://nodejs.org/api/net.html#class-netblocklist
- **Node's type stripping.** The proxy runs inside its own container from the read-only mounted `proxy.ts`. Node 24 runs TypeScript directly by removing the types, so the file can't use TypeScript-only syntax (enums, parameter properties) or import our other files. https://nodejs.org/api/typescript.html
- **A shared protocol module.** `workspace/host/src/protocol.ts` holds the paths, error kinds and limits. The host and the control plane's adapter both import it, so they can't drift apart. One Docker test runs the real host process and drives it through the real adapter.

**Files:**

| File | What it is |
| --- | --- |
| `workspace/host/src/protocol.ts` | `v1` paths, error kinds, `CreateRequest`/`CreateResponse`, `MESSAGE_MAX` (300). Built to `dist` for the control plane |
| `workspace/host/src/server.ts` | The HTTP API: health, create, the four actions. Token, Origin and Host checks; 4 KB body limit; errors as `{ error: { kind, message } }`; unexpected errors become a plain sentence |
| `workspace/host/src/workspaces.ts` | `WorkspaceHost`: create (proxy, network, volume, container, clone), start, pause, resume, stop. One operation at a time per workspace. The 2-running cap. Public GitHub addresses only for now. The clone is https only, `--depth 1`, with a 120 s limit, and its failures are logged by exit code only |
| `workspace/host/src/egress/proxy.ts` | The egress proxy: CONNECT to 443 on `github.com` and `codeload.github.com` only; public addresses only; plain HTTP refused |
| `workspace/host/src/docker-cli.ts`, `errors.ts` | Running `docker` with argument arrays; "Docker isn't running" as `unavailable`; `HostError` and its statuses |
| `workspace/host/src/resources.ts`, `scripts/resources.ts` | The laptop's figures (MemAvailable, free disk on Docker's root, load, cores, Flowcanvas's running and asleep workspaces, images and volumes) and `assess()` against the budget |
| `workspace/host/src/clean.ts`, `scripts/clean.ts` | `planClean()`: by default test leftovers and old images; `--all --yes` everything of ours. Never anything else |
| `workspace/host/src/main.ts` | Started by `pnpm dev`. Without a token, or without Docker 28+, it says what to fix and exits quietly, so the rest of `pnpm dev` still runs |
| `workspace/image/src/spec.ts` | Now also labels, the proxy variables (`HTTPS_PROXY`, `GIT_TERMINAL_PROMPT=0`), `egressNetworkCreateArgs()`, `egressRunArgs()` (locked down, 256 MB, IP forwarding off) |
| `workspace/image/Dockerfile` | `curl` added (new tag `c728f54c03be`) |
| `services/control-plane/src/workspaces/local-host.ts` | The `docker-local` provider: talks only to loopback URLs; 180 s for create, 30 s for the rest; maps "can't connect" to "The workspace host isn't running…" and 401 to "Add WORKSPACE_HOST_TOKEN…"; passes only known kinds and bounded sentences |
| `services/control-plane/src/api/app.ts`, `src/auth/guards.ts`, `package.json` | The provider comes from the bindings. `pnpm dev` passes `WORKSPACE_HOST_URL=http://127.0.0.1:8790`; staging has none |
| `.dev.vars.example` | `WORKSPACE_HOST_TOKEN` and how to make one |
| `package.json` | `workspace:clean`, `workspace:resources`; every `workspace:*` script uses `run` (see Gotchas) |

**Tests:**
- **Host unit tests (41):**
  - `workspaces.test.ts` (15, against a fake Docker): the create sequence and the exact clone command; idempotent create; GitHub-only refusals before any Docker call; the cap; clean-up after a failed clone; the clone's timeout; replacing a changed proxy and reattaching networks; every action's states; "gone" answers; foreign names refused; one operation at a time
  - `server.test.ts` (11): token, Origin, Host, routes, body limits, error mapping, the token never logged
  - `egress/proxy.test.ts` (8): public and special addresses, targets, refusals without resolving, DNS rebinding, plain HTTP
  - `resources.test.ts` (5), `clean.test.ts` (3)
- **Control-plane adapter (12):** loopback only, the missing token, paths and headers, unreachable host, error pass-through and refusals, the token never in errors.
- **Docker tests (`pnpm test:docker`, 23 in total):**
  - workspace-image (10)
  - workspace-host (9): **Rallly opens in 8.9 s (clone 7.0 s), and the test fails above 60 s**; opening again keeps the clone; through the proxy only GitHub works, example.com gets 403, going around the proxy has no route, plain HTTP gets 403; the proxy's IP forwarding is 0; pause and resume keep a running process; stop and start keep the files; the cap refuses a third; no route to another workspace, the host, the home router or the metadata address; the log has the clone time and no addresses
  - control-plane (4): the real host process driven through the adapter (create, sleep, resume, stop, start), its refusals passed through, a wrong token explained, the token never printed

**Run and check it:**
```fish
grep -c '^WORKSPACE_HOST_TOKEN=' .dev.vars      # 1 (Claude added it; to make your own, see .dev.vars.example)
pnpm test                                       # 455 tests, no Docker needed
pnpm test:docker                                # 23 Docker tests; needs the internet; prints "Rallly: opened in … ms"
pnpm workspace:resources                        # five "ok" lines with your laptop's figures
pnpm workspace:clean                            # removes test leftovers and old images; "Nothing to remove." when clean
pnpm dev                                        # the log shows "[workspace-host] Listening on http://127.0.0.1:8790"
```
There's still no button: the page gets **Open** in step 9. Signed in locally, `POST /api/projects/<id>/workspace/open` now opens a real workspace.

**Gotchas:**
- **pnpm 12 has a built-in `clean` command.** The first version of the script was called `clean`, and `pnpm --filter … clean` ran pnpm's own command, which deletes every `node_modules` folder. No code or data was lost: `pnpm install --frozen-lockfile` restored them from the lockfile in a second. The script is now `docker-clean`, and every root `workspace:*` script says `run` explicitly, so a script name can never be mistaken for a pnpm command.
- **Killing `pnpm` doesn't kill what it started.** The first control-plane Docker test stopped only `pnpm`, and left `tsx` and the host running. The test now starts the host in its own process group (`detached`) and stops the whole group. (A `pkill -f` during the live check also matched the shell running it; processes are now stopped by PID.)
- **A well-formed error isn't always the right one to show.** With a wrong token, the host's answer was "Wrong or missing token." The adapter now turns any 401 into the actionable "Add WORKSPACE_HOST_TOKEN to .dev.vars…". The end-to-end Docker test caught it; the unit test hadn't, because its fake answered differently.
- **Docker containers have IP forwarding on.** The proxy is attached to every workspace network, so it runs with `net.ipv4.ip_forward=0` (and IPv6 forwarding off), and a test checks it.

**Docs:** this write-up; ADR 0016 (browser refusals, the shared proxy's forwarding); ARCHITECTURE (parts, "Workspaces", local commands); the laptop table; STATUS; `.dev.vars.example`; the risk statuses above.

**Risks:**
- R5 closed: 8.9 s.
- R3: isolation checked again through the real host (the full test comes in step 7).
- R6: the host's and the adapter's checks are in place.
- R9: the cap and the two commands exist.
- R1, R4, R7 and R8 unchanged.
- **Laptop:** 24.2 of 30.8 GiB memory available, 580.7 GiB disk free, load 6.5 during tests. Flowcanvas uses 0.5 GiB (one image); no containers, networks or volumes left.

**Commit:** `feat(workspace): local workspace host, egress proxy and the Docker provider`

### Step 1d.5 — The file and process API (done by Claude)

**Goal:** the control plane can list, read and write a project's files and run commands in its workspace. It does this through a small agent inside the workspace, over a typed, versioned protocol, for the project's owner only.

**Concepts:**
- **An agent inside the sandbox.** The control plane can't touch files in a container directly, and it shouldn't. The agent is a small Node program running *inside* the workspace, as the workspace's own user, so it can only do what that user can. Everything it answers is checked again outside, because code in the workspace could tamper with it.
- **JSON lines over stdio.** Each message is one line of JSON: `{ "v": 1, "id": 7, "body": {...} }`. The `id` matches each answer to its question, so a slow command doesn't block a quick read, and `v` rejects a mismatched agent. It's the same idea as the Language Server Protocol, which comes later. https://jsonlines.org/
- **Delivering code without a mount.** The workspace's locked-down settings allow only the workspace volume and `/tmp`. The host copies the built agent into `/tmp` through `docker exec -i … cat` (content on stdin, never on a command line) and starts it. `/tmp` is a tmpfs, so a restarted container gets a fresh copy, which is always the current build.
- **Path containment.** `resolve(root, path)` and a prefix check catch `../`. Links need more: `realpath` follows them, and the result is checked again. Writes use `O_NOFOLLOW`, so even a link created after the checks can't redirect them. https://man7.org/linux/man-pages/man2/open.2.html
- **No shell.** Commands are argument lists (`["git", "status"]`) passed to `spawn` directly, so `$(…)`, `;` and backticks mean nothing. Each command gets its own process group, so a time-out stops everything it started (`kill(-pid)`).
- **Secrets stay out (CLAUDE.md rule 5).** `.env`, `.env.*` and `.dev.vars*` (except `.example`, `.sample`, `.template`) are listed with `secret: true`, and can never be read or written through the API, even through a link. A command in the terminal could still print one; that's the person's own action in their own workspace, and it's never logged.

**Files:**

| File | What it is |
| --- | --- |
| `workspace/agent/src/protocol.ts` | `AGENT_PROTOCOL` 1, `PROJECT_ROOT`, `LIMITS` (1 MiB files, 5,000 entries, commands up to 2 minutes with 1 MiB of output each); `AgentRequest` (`hello`, `list`, `read`, `write`, `exec`) and results; error codes; `parseAgentRequest` (for untrusted requests) and `isAgentResponse` (for untrusted answers); `isSecretFile`. No imports, so the Worker can bundle it |
| `workspace/agent/src/agent.ts` | `createAgent({ root })`: the five operations with the containment rules above; `answer()`; `serve()` over line streams |
| `workspace/agent/src/main.ts`, `files.ts` | The entry point inside the workspace; the built files the host copies in |
| `workspace/host/src/agents.ts` | `dockerAgent()` (copy in, `docker exec -i`); `Agents`: one connection per workspace, a hello and version check, ids, per-request time limits (the command's own plus 15 s), reconnect after the agent stops, fail waiting requests when it does |
| `workspace/host/src/workspaces.ts`, `server.ts`, `protocol.ts`, `docker-cli.ts` | `WorkspaceHost.agent()` (running workspaces only; "asleep" and "not running" refused); stop ends the agent; `POST /v1/workspaces/:ref/agent` (checked with `parseAgentRequest`, 2 MiB body); `input` for docker commands |
| `services/control-plane/src/workspaces/file-routes.ts` | `GET /files`, `GET /file`, `PUT /file`, `POST /exec` under `/api/projects/:id/workspace`. Owner only, running only, same origin for changes. Each counts as activity. Statuses per error code. Logs the operation and outcome only |
| `services/control-plane/src/workspaces/provider.ts`, `local-host.ts` | `WorkspaceProvider.agent()`; the adapter posts to the host and checks the answer; `WORKSPACES_UNAVAILABLE` moved here to avoid a circular import |

**Tests:**
- **Agent (18, against a temporary folder):**
  - list order and secret flags
  - text and binary reads
  - `.env` refused, even through a link (canary)
  - `..`, absolute paths and links out refused
  - folders and big files refused
  - writes with folders made as needed and base64
  - writes refused for `.env`, outside the project and through a link
  - the size limits, including 3-byte characters
  - commands: exit code, cwd, no shell, a time-out that kills child processes, the output cap, a missing program
  - malformed requests, hello, the line protocol and version check
- **Host (11 new):**
  - the connections run against the real built agent: reuse, side-by-side requests, reconnect, waiting requests failed, a lying agent refused
  - `WorkspaceHost.agent()` states
  - the route: a checked request, a malformed one answered without reaching the agent, the 1 MiB limit
- **Control plane (15 new):**
  - the four routes and the requests they build
  - error codes mapped to statuses
  - checked before forwarding
  - counted as activity
  - logs without paths, content or commands (canary)
  - running, owner and origin checks
  - the adapter's answer check
- **Docker (4 new, 27 in total):**
  - against the real Rallly clone: list, read and write (owned by uid 1000); `.env` refused (canary); a link to `/etc/passwd` and `../.home` refused
  - commands: `node -v`, `id -u` and `pwd` in a subfolder, and `git ls-remote` through the proxy
  - after a stop and start, the agent is copied in again and reads the note back
  - through the real host process: an empty workspace says "no project files yet"

**Run and check it:**
```fish
pnpm test               # 492 tests, no Docker needed
pnpm test:docker        # 27 Docker tests; Rallly opens in about 8.4 s, then the agent's checks run against it
```
Signed in locally, with a project open, the page itself can't use these yet (no UI until step 9 and the editor in phase 3). The routes answer `/api/projects/<id>/workspace/files` and so on.

**Gotchas:**
- **`read` with no path read the project folder.** A missing `path` defaulted to `''` for both list and read. `read` now requires one, and `list` still defaults to the top of the project. The route test caught it.
- **A path through a file.** Writing `package.json/x` first failed with a generic error. The nearest existing "folder" is now checked to really be a folder ("Part of that path is a file.").
- **Circular imports.** The file routes needed a constant from `routes.ts`, which mounts them. It worked only because the constant was read at request time, so it moved to `provider.ts`.
- **A step 4 test edit hadn't applied.** The wrong-token Docker test should have checked the actionable message, but only its import had changed. That left a lint error in the step 4 commit (CI runs only on PRs and `main`, so nothing failed). Both are fixed. From now on, the full `pnpm lint` runs as the last thing before each commit.

**Docs:** this write-up; ARCHITECTURE (parts, "Files and commands"); ADR 0016 (how the agent is delivered); STATUS.

**Risks:**
- R1 and R7: the agent runs as the workspace user and is treated as untrusted; commands have time and output limits.
- R6: the routes are owner only and same origin, the host checks the request again, and the token is unchanged.
- The others are unchanged.
- **Laptop:** all five checks ok (24.3 GiB memory available, 580.8 GiB disk free, load 6.4 during tests). Flowcanvas uses 0.5 GiB; no containers or agent processes left behind.

**Commit:** `feat(workspace): workspace agent with the file and process API`

### Phase 1d so far — run and check it (after step 9)

**1. Automated tests** (no sign-in needed):
```fish
pnpm install
pnpm test                 # 597 tests, no Docker needed (the same as CI's checks); about 75 s
pnpm test:e2e             # 10 recorded walkthroughs: the phase's Try it, the terminal under the production
                          # CSP, the demo project, sleep and resume, and staging's "Workspaces run locally"
pnpm test:docker          # 42 tests against real containers; needs Docker 28+ and the internet.
                          # The first run builds the workspace image (about a minute).
                          # Look for "Rallly: opened in … ms" in the output.
pnpm workspace:resources  # your laptop against the budget: five "ok" lines
pnpm workspace:clean      # removes test leftovers and old images ("Nothing to remove." when clean)
```

**2. The real thing, with the buttons (step 9).**
1. Restart `pnpm dev` (the host, the Worker's script and the page all changed). The dev database already has migration 0004.
2. Open http://localhost:5173 and sign in. Under **Projects**, click **Open demo project**.
3. **Rallly (demo)** appears first, with "https://github.com/ArmaanAhuja-7777/rallly · pinned at 8e67a21":
   - The chip says **Starting…**, and a card says "Cloning github.com/ArmaanAhuja-7777/rallly at 8e67a21. Usually under 15 seconds." The first time ever, building the image adds about a minute.
   - Within about 10 s the chip says **Running · 2 cores**, with **Sleep**, **Stop** and **Terminal**.
4. **Terminal** opens a shell. Try `git log --oneline -1`: it's `8e67a21`, not the fork's newer head.
5. **Sleep** shows the asleep card: since when, the machine, the resume time, and no claim that it was idle. **Resume** brings it back.
6. Leave it running and don't type for 11 minutes (the page checks every 30 s). It goes to sleep by itself, and the card says "Put to sleep after 10 minutes without activity."
7. **Stop**, then **Open**: it starts again with its files ("Starting it again with its files").

**3. The file and process API, from the console.** These have no buttons yet (the editor is phase 3). In the browser's developer console, signed in, on the app's own page. The browser sends your session cookie and the `Origin` header itself, so the API's checks apply exactly as they will for the page.
1. Start everything: `pnpm dev` (restart it if it was already running before step 6: Vite's WebSocket forwarding is new). The terminal should show `[workspace-host] Listening on http://127.0.0.1:8790 (Docker …)`. If it says `Not started: …`, it tells you what to fix: the token, Docker, or another `pnpm dev` already running.
2. Open http://localhost:5173, sign in, and create a project named `Rallly` with the repository `https://github.com/ArmaanAhuja-7777/rallly`.
3. Open the developer console (F12 → Console) and paste:
   ```js
   const { projects } = await (await fetch('/api/projects')).json();
   const id = projects.find((p) => p.name === 'Rallly').id;
   const ws = (path, method = 'GET', body) =>
     fetch(`/api/projects/${id}/workspace${path}`, {
       method,
       headers: body ? { 'content-type': 'application/json' } : {},
       body: body && JSON.stringify(body),
     }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
   ```
4. Then try these one at a time, and compare with what you should see:

   | Paste | You should see |
   | --- | --- |
   | `await ws('/open', 'POST')` | after about 10 s, `workspace: { state: 'running' }` (the first time ever, about a minute more for the image) |
   | `await ws('/files')` | Rallly's top-level folders and files, folders first |
   | `await ws('/file?path=package.json')` | the file's `content`, `encoding: 'utf8'` |
   | `await ws('/exec', 'POST', { command: ['git', 'log', '--oneline', '-3'] })` | `exitCode: 0` and three commits in `stdout` |
   | `await ws('/exec', 'POST', { command: ['sh', '-c', 'echo SECRET=1 > .env'] })` | `exitCode: 0` (makes a test `.env`) |
   | `await ws('/file?path=.env')` | `status: 403`, "Secrets live in the project's vault…" (never the content) |
   | `await ws('/file?path=../.home/.bashrc')` | `status: 403`, "That path is outside the project." |
   | Reload the page | Rallly says **Workspace running** and has a **Terminal** button (from step 6). Click it: "Connected to the workspace.", then a shell in `/workspace/project`. Try `ls`, `git log --oneline -3`, `node -v`; `exit` ends it, and **Start a new terminal** opens another |
   | In the terminal: `curl -sS https://example.com`, then `getent hosts github.com; echo $?` | `CONNECT tunnel failed, response 403`, then `2`: only the allowlisted hosts, and no DNS out (step 7 has more to try, including `pnpm install`) |
   | `await ws('/sleep', 'POST')` | `state: 'sleeping'`; then `await ws('/files')` gives 409 "Open the workspace first." |
   | `await ws('/resume', 'POST')` | `state: 'running'` again, in well under a second |
   | `await ws('/stop', 'POST')` | `state: 'stopped'`; `await ws('/open', 'POST')` starts it again with the files kept |
   | `await (await fetch('/api/usage')).json()` | `workspaceSeconds` above 0, and rising while a workspace runs (live, step 8) |
   | Open it (`await ws('/open', 'POST')`), type in its terminal, then leave it alone for 11 minutes and reload | **Workspace sleeping** (`docker ps --filter label=org.flowcanvas.workspace=1` says `Paused`). The tick runs once a minute, so it sleeps 10 to 11 minutes after your last typing. `await ws('/resume', 'POST')` brings it back with the terminal's files and processes as they were. Usage counts the time up to the sleep, not the time asleep |
5. In a terminal, `docker ps --filter label=org.flowcanvas.workspace=1` shows `fc-ws-<id>` and `fc-egress`, and `pnpm workspace:resources` counts it.
6. When you're done: `await ws('/stop', 'POST')`. `pnpm workspace:clean --all` lists everything of Flowcanvas's on the laptop; `--all --yes` removes it, **including the workspace's files**.

**If something's off:**
- `503 "The workspace host isn't running…"`: `pnpm dev` isn't running, or its host didn't start; its log line says why.
- `503 "Add WORKSPACE_HOST_TOKEN…"`: the line is missing from `.dev.vars`, or `pnpm dev` was started before it was added. Restart `pnpm dev`.
- `503 "Workspaces run locally for now"`: you're on staging; that's expected until a cloud provider is connected.
- `503 "2 workspaces are already running…"`: put one to sleep or stop it (the laptop budget).

### Step 1d.6 — The terminal (ADR 0017)

Three checks came first (details in ADR 0017):
1. Docker's Engine API gives a real pty that can be resized, with no native modules.
2. A Worker under `wrangler dev` can relay a WebSocket to the host, provided both sides set `binaryType = 'arraybuffer'` (otherwise binary frames arrive as `Blob`s and go on as the text `[object Blob]`).
3. xterm.js 6 injects `<style>` elements, which our CSP blocks. They're moved into constructed stylesheets instead of loosening the CSP.

The Durable Object gateway is deferred to the cloud provider (upgrade-later 36): locally, the host already holds the session.

#### 6.1 — Terminal sessions on the host (done by Claude)

**Goal:** the workspace host can open a shell on a pty inside a running workspace, and carry it over a WebSocket with the same checks as its other routes.

**Concepts:**
- **A pty (pseudo-terminal)** is what makes a program believe it's talking to a terminal: line editing, colours, Ctrl-C, full-screen programs and a size. Docker can create one for an exec (`Tty: true`). The Engine API then switches the HTTP connection to a raw two-way stream, which is the terminal. https://docs.docker.com/reference/api/engine/version/v1.47/#tag/Exec
- **The Docker Engine API over its Unix socket.** It's the same API the `docker` CLI uses. The CLI can't hand us a pty without a real terminal on its own side, so the host makes these few calls itself (`src/engine.ts`). Only checked names and fixed bodies go in.
- **The WebSocket upgrade.** A WebSocket starts as an HTTP request with `Upgrade: websocket`. The host checks it like any other request (no `Origin`, the right `Host`, the token) *before* accepting it. A refusal is a plain HTTP answer with the usual JSON error. https://github.com/websockets/ws#multiple-servers-sharing-a-single-https-server
- **The wire format.** Binary frames are terminal bytes; text frames are JSON control messages. Only `resize` goes in, and `exit` and `error` come out. Anything else is answered with an error and never typed into the shell.

**Files:**

| File | What it is |
| --- | --- |
| `workspace/host/src/engine.ts` | The Engine API client: JSON calls and the upgraded stream, over `DOCKER_HOST` (when `unix://`) or `/var/run/docker.sock` |
| `workspace/host/src/terminal.ts` | `openTerminal()`: `bash -l` as uid 1000, `TERM=xterm-256color`, the starting size, resize, exit code. `relayTerminal()`: bytes both ways in frames of at most 64 KiB, control messages, the exit message, hanging up the shell when the page goes away. `checkSize()` (2–500 columns, 2–200 rows) and `parseControl()` |
| `workspace/host/src/workspaces.ts` | `WorkspaceHost.terminal()`: running only; works in `/workspace/project` (or `/workspace` without a repository); at most 4 per workspace |
| `workspace/host/src/server.ts` | The upgrade handler for `GET /v1/workspaces/:ref/terminal?cols=&rows=` (`ws`, 64 KiB frames), sharing `refusal()` with the other routes |
| `workspace/host/src/protocol.ts` | `PATHS.terminal()` |
| `pnpm-workspace.yaml`, `workspace/host/package.json` | `ws` 8.21.0 (MIT, already in the tree through Wrangler) and `@types/ws` 8.18.2 |

**Tests:**
- **Server (7 new):** over real WebSockets, against an echoing fake shell: bytes both ways, resize, the exit code, unknown control messages answered and never typed, the shell hung up when the page closes, the caller checked before accepting (token, Origin, size, path), the host's refusal passed on.
- **Host (4 new):** the exec settings (pty, bash, user, project folder, size), `/workspace` without a project, the cap of 4 and its release, asleep, stopped and foreign refused.
- **Docker (1 new, 28 in total):** a real shell in the Rallly workspace through the real server: `answer-42`, `node`, `/workspace/project`, a resize seen by `stty size` (`40 120`), and `exit 3` reported as code 3.

**Run and check it:**
```fish
pnpm --filter @flowcanvas/workspace-host test     # 61 tests
pnpm test:docker                                  # 28; includes the real shell
```
Nothing to click until 6.3.

**Gotchas:**
- **The fake Docker's `test -d` knew only exact paths,** so a cloned project didn't look like a folder. It now treats a path with anything under it as a folder.
- **Closing a terminal's stream is how a shell hangs up.** No separate kill is needed. Docker closes the pty, and bash gets `SIGHUP`.

**Risks:**
- R1 and R7: the shell runs as the workspace user inside the same limits; 4 at most per workspace.
- R6: the WebSocket gets the same token, Origin and Host checks as everything else.
- **Laptop:** unchanged (all ok); no containers left after the tests.

**Commit:** `feat(workspace): terminal sessions on the host through the Docker Engine API`

#### 6.2 — The Worker's WebSocket relay (done by Claude)

**Goal:** the browser opens `wss://<app>/api/projects/:id/workspace/terminal`. The Worker checks who's asking, opens the terminal on the workspace host, and carries frames both ways.

**Concepts:**
- **WebSockets in Workers.** A Worker accepts a browser's WebSocket by creating a `WebSocketPair`. It returns one end in a `101 Switching Protocols` response and keeps the other. It opens a WebSocket *out* with an ordinary `fetch` and an `Upgrade: websocket` header, and the response's `webSocket` is the connection. Both ends need `accept()`. https://developers.cloudflare.com/workers/runtime-apis/websockets/
- **`binaryType`.** With our compatibility date, a Worker receives binary frames as `Blob`s unless `binaryType` is `'arraybuffer'`. Sent on as is, a Blob becomes the text `[object Blob]`. The relay sets it on both ends, and a test checks it.
- **Cross-site WebSocket hijacking.** WebSockets aren't covered by CORS: any site can open one to us, and the browser attaches the visitor's cookies. The only defence is checking `Origin` before accepting, which `requireSameOrigin` does here, exactly as for other changes. https://owasp.org/www-community/attacks/Cross-site_WebSocket_hijacking
- **The relay only trusts one direction.** From the browser it passes byte frames of at most 64 KiB, and resize messages it re-checks and re-writes. Anything else gets an error message back and goes nowhere. From the workspace, everything comes back as it is.

**Files:**

| File | What it is |
| --- | --- |
| `services/control-plane/src/workspaces/terminal-routes.ts` | `GET /api/projects/:id/workspace/terminal?cols=&rows=`: same origin, a WebSocket, a valid size, the owner, running, then `provider.terminal()`, `acceptWebSocket()` and `relay()`. Typing counts as activity at most every 30 s. Logs who opened it, never what's typed |
| `services/control-plane/src/workspaces/provider.ts` | `terminal()` and the minimal `TerminalSocket` type, which both a Workers WebSocket and a test fake satisfy |
| `services/control-plane/src/workspaces/local-host.ts` | The adapter's `terminal()`: an upgrade `fetch` with the token; the host's refusal passed on |
| `services/control-plane/src/workspaces/routes.ts`, `src/api/app.ts` | The route mounted; `acceptWebSocket` injectable (`WebSocketPair` exists only in Workers) |
| `workspace/host/src/protocol.ts` | `TERMINAL_LIMITS`, `checkSize`, `parseControl` moved here, so the Worker and the host apply the same rules |
| `apps/web/vite.config.ts` | `ws: true`, so `pnpm dev` forwards the WebSocket to the Worker |
| `services/control-plane/src/test/fake-provider.ts` | `FakeSocket`, and `terminal()` on the fake provider |
| `services/control-plane/src/test/terminal-worker.ts`, `terminal-worker.wrangler.jsonc` | A test-only Worker with its own config, never deployed: the real relay and adapter in workerd, without sign-in |

**Tests:**
- **Relay (10, fake sockets):**
  - connects at the right size, with both sides accepted and set to `arraybuffer`
  - bytes both ways, and resizes re-checked and re-written
  - nothing else from the browser goes on: plain text, bad sizes, other types, padded messages, frames over 64 KiB, non-frames
  - either side closing closes both
  - typing counts as activity at most every 30 s
  - logs never include what's typed or shown (canary)
  - the workspace's refusal is passed on
  - refused before any WebSocket: not running, wrong origin, no session, not the owner, not a WebSocket, a bad size
- **Adapter (2):** the upgrade request (path, size, token); refusals and an unreachable host.
- **Docker (1 new, 29 in total):** the **real relay in workerd** (`wrangler dev` with the test Worker), against the real host and a real container: `relayed-42`, a resize seen by `stty` (`43 132`), and `exit 5` reported as code 5.

**Run and check it:**
```fish
pnpm test          # 513 tests
pnpm test:docker   # 29; includes the relay in workerd
```
The page part (6.3) comes next; then the terminal can be clicked.

**Gotchas:**
- **`wrangler dev` finds the nearest `wrangler.jsonc` by itself.** Started inside `services/control-plane` with a script path, it still used the repository's config. That config serves the app's files for everything outside `/api/*`, so the test's request got `index.html` and never reached the Worker. The test Worker has its own config now.
- **Editing control-plane files reloads a running `pnpm dev`.** Wrangler watches them and restarts workerd (seen at 22:03, during this step). That's expected, and it doesn't affect the workspace host or Vite.

**Risks:**
- R6: the WebSocket is checked (origin, session, owner, running) before it's accepted.
- R1 and R7: only bounded bytes and checked resizes reach the shell.
- **Laptop:** unchanged; no test containers or processes left.

**Commit:** `feat(control-plane): terminal WebSocket relay to the workspace host`

#### 6.3 — The terminal on the page (done by Claude)

**Goal:** a project whose workspace is running has a **Terminal** button. It opens a real shell in the page, styled by the design tokens, under the production CSP with no violations.

**Concepts:**
- **xterm.js** is the terminal emulator VS Code uses. It draws a terminal from the bytes it's given, and hands back what's typed (`onData`) and size changes (`onResize`). The **fit** add-on works out how many columns and rows fit the box. https://xtermjs.org/docs/
- **Why xterm and our CSP clashed, and the fix.** xterm puts some of its CSS in `<style>` elements, and `style-src 'self'` blocks those, with a violation for each. Loosening the CSP wasn't an option (ADR 0017). Instead:
  1. xterm is given a stand-in `document` (`documentOverride`) whose `createElement('style')` returns an inert `<template>`.
  2. A `MutationObserver` copies the text xterm writes into each one into a **constructed stylesheet** (`document.adoptedStyleSheets`), which CSP doesn't block. That's safe: only our scripts can make one, and `script-src 'self'` already limits scripts to ours.
  3. **xterm 6.0.0 has a bug:** its scroll area always uses the real `document` (operator precedence in `this._document ?? typeof window … ? window.document : null`). So the real document's `createElement` is swapped for the duration of the one synchronous `terminal.open()` call, then put back.

  https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets
- **Colours from the tokens.** xterm needs colour values, not CSS variables, so `terminalTheme()` reads the tokens' computed values (background `surface/canvas`, text `text/primary`, selection `accent/tint`, ANSI red, green, yellow, magenta and blue from the state and accent text colours). The font comes from the mono text style.
- **CSS containment.** xterm gives its screen a fixed pixel width. Without `contain: inline-size`, that width propped its box open, so the terminal could never get narrower, and the page grew a horizontal scroll. https://developer.mozilla.org/en-US/docs/Web/CSS/contain
- **Loading on demand.** xterm is about 85 KB gzipped, so `React.lazy` loads it only when someone opens a terminal. The main bundle stays at 133 KB.
- **Faking a WebSocket in Playwright.** `page.routeWebSocket` answers the page's WebSocket inside the test, the same way `page.route` answers HTTP, so the walkthrough can run on any deployed copy. https://playwright.dev/docs/api/class-websocketroute

**Files:**

| File | What it is |
| --- | --- |
| `apps/web/src/terminal/WorkspaceTerminal.tsx` | The terminal: xterm with the tokens' theme and font, the fit add-on and a `ResizeObserver`; the WebSocket (`terminalUrl`: `wss` on https, the page's own origin); bytes out as binary frames, resizes as JSON; output written; exit and notices shown as sentences (`role="status"`); **Start a new terminal**; everything closed on unmount |
| `apps/web/src/terminal/adopt-styles.ts` | `styleFreeDocument()`, `withoutInlineStyles()`, `adoptInjectedStyles()` (above) |
| `apps/web/src/terminal/theme.ts` | `terminalTheme()`, `terminalFont()` from the tokens; without a token, xterm keeps its own value |
| `apps/web/src/terminal/WorkspaceTerminal.module.css` | Tokens only; `contain: inline-size`; the focus ring around the screen while typing |
| `apps/web/src/projects/Projects.tsx` | **Terminal** / **Close terminal** next to **Secrets**, for running workspaces; the terminal loaded with `React.lazy` |
| `apps/web/vite.config.ts` | `vite preview` sends the production headers from `public/_headers` (the CSP and the rest), so local walkthroughs match Cloudflare |
| `apps/web/package.json`, `pnpm-workspace.yaml` | `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 (MIT, December 2025) |
| `e2e/try-it/phase-1d.spec.ts` | The walkthrough (below) |

**Tests:**
- **Component (8):**
  - the address (`ws`/`wss`, same origin, size)
  - `arraybuffer` frames; the status line
  - typing sent as bytes and resizes as JSON; output written
  - the exit code shown, and a new terminal started
  - a connection that never opened explained
  - notices shown without ending
  - colours and font from the tokens
  - everything closed on unmount
- **Shim (9):**
  - existing, added and nested sources copied
  - rewrites followed, removals dropped
  - stopping restores the document's sheets and leaves others alone
  - no `adoptedStyleSheets`: does nothing
  - the stand-in document makes templates and is the real document for everything else
  - `withoutInlineStyles` swaps only during its call, and restores even on a throw
- **Walkthrough (`pnpm test:e2e`, recorded), under the production CSP:**
  - the running project offers **Terminal**, connects, and shows the workspace's greeting
  - `echo hello from the walkthrough` is typed and answered
  - xterm's own rule applies (`.xterm-rows span` computes to `inline-block`), with no `<style>` element and at least one constructed sheet
  - a narrower window sends a resize
  - `exit` shows "The terminal ended (exit code 0)", and a new terminal starts
  - **no page errors and no CSP violations**

**Run and check it:**
```fish
pnpm test                # 530 tests
pnpm test:e2e            # 7 walkthroughs; the terminal one is "phase 1d: a terminal in the workspace…"
pnpm --filter @flowcanvas/e2e report      # the recordings
```
For real, follow "Phase 1d so far — run and check it" above: open the workspace, reload, click **Terminal**.

**Gotchas:**
- **A browser's `ArrayBuffer` from another realm.** In jsdom, the bytes in a `MessageEvent` failed `instanceof ArrayBuffer`. The check is now by tag (`[object ArrayBuffer]`), which is right in any realm.
- **`vi.mock` is hoisted** above everything in the file, so the fake xterm class lives in `vi.hoisted()`.
- **The temporary page is narrow** (about 400 px), so the terminal is too, until the phase 2 app shell. The walkthrough shrinks the window to 360 px to test resizing.
- **xterm's scroll area bug** (above) meant `documentOverride` alone still left one `<style>`. The walkthrough's "no `<style>`" check is what caught it.

**Docs:** this write-up and the run guide; ADR 0017; ARCHITECTURE ("Terminal"); STATUS.

**Risks:**
- The CSP is unchanged and has no violations.
- R6: same-origin WebSocket only.
- **Laptop:** all five checks ok (22.0 GiB memory available, 580.7 GiB disk free, load 4.8).

**Commit:** `feat(web): terminal in the page with xterm.js under the strict CSP`

### Step 1d.7 — Network rules and the isolation test (done by Claude)

**Goal:** a workspace can reach exactly what cloning and installing need, through the egress proxy, and nothing else. In particular it can't reach another workspace, this computer or the home network, and that's proven by a test that fails when isolation breaks. This is the third *Done when* item.

**What a workspace can reach (measured, not guessed):**
- **The allowlist** (`ALLOWED` in `workspace/host/src/egress/proxy.ts`, each host with its reason):

  | Host | Why | Evidence |
  | --- | --- | --- |
  | `github.com` | cloning, git dependencies | step 4 |
  | `codeload.github.com` | GitHub tarball dependencies (`github:` specifiers) | step 4 |
  | `registry.npmjs.org` | npm and pnpm installs | Rallly's `pnpm install`: 2,163 packages in 2 min 7 s through the proxy, nothing else needed. Documenso's and LibreChat's lockfiles |
  | `registry.yarnpkg.com` | Yarn installs | Excalidraw's `yarn.lock` names it 1,444 times; it's Yarn Berry's default registry (Twenty, Medusa) |
  | `binaries.prisma.sh` | Prisma's schema engine, for `prisma generate` and `migrate` | Rallly's `pnpm db:generate` failed with `403` from the proxy until it was added |

  Twenty and Medusa ship their own Yarn release (`yarnPath`), so Yarn itself needs no extra host.
- **Not allowed, on purpose:**
  - Google Fonts. Rallly's web app uses `next/font/google`, which only matters once the app's dev server runs (stage 2).
  - Telemetry endpoints, such as Next.js telemetry (rule 5: telemetry off).
  - Anything a project's own code calls at run time. That's a per-project choice for later (upgrade-later 37).

**Concepts:**
- **Why an allowlist and not a blocklist.** A blocklist has to name every bad place, and you can never finish the list. An allowlist names the few good ones, so a new trick still lands on "refused". Code from a repository we don't control runs in the workspace, so it gets the second.
- **Why DNS matters.** If a workspace could look names up on the internet, it could leak data inside the lookups themselves (DNS tunnelling), even with no TCP route out. A Docker `--internal` network's DNS answers only for containers on that network and forwards nothing. The test checks `getent hosts github.com` fails inside the workspace. https://docs.docker.com/engine/network/#dns-services
- **Reading connection errors.**
  - `ENETUNREACH` (no route) and `EHOSTUNREACH` (nobody at that address) mean the packet went nowhere.
  - `ECONNREFUSED` means a machine answered "nothing on that port". So it counts as **reached**: the address is reachable.
  - The isolation test passes only on no route, no host or a timeout.
- **Proxy limits.** These keep one workspace from starving the proxy, which every workspace shares:
  - 64 open tunnels per workspace and 256 in total; past that, `429`
  - 10 s to send the `CONNECT` request (a slow-loris defence)
  - 60 s idle timeout on a tunnel
- **A test that can't fail proves nothing (mutation check).** After the isolation test passed, its key protection (the network's isolated gateway mode) was removed for one run. The test then failed exactly where it should: this computer's address on the workspace's network answered (`ECONNREFUSED`). Then the code was put back.

**What the isolation test checks** (`workspace/host/src/host.docker.test.ts`, "workspaces can't reach each other…"):
1. **Workspace to workspace, both directions,** on ports 22, 80, 443, 3000, 5173 and 8080: unreachable. Not even the other's name resolves.
2. **The proxy:** reachable on its own network on port 3128 only (port 22 refuses). Its addresses on other workspaces' networks, and on its way out, are unreachable.
3. **This computer:**
   - every one of its own IPv4 addresses (home network, Docker bridges, VPN) on ports 22, 8790 (the workspace host) and 5173 (Vite)
   - Docker's default bridge
   - the cloud metadata address
   - the internet directly

   All unreachable.
4. **No DNS out, and no IPv6** apart from loopback.
5. **Through the proxy:** the other workspace (by address and by name), the host's bridge, `localhost` and the proxy itself are all `403`.
6. **Allowed hosts:** each one answers through the proxy, and `example.com` is `403`. Plain HTTP is `403`, and going around the proxy has no route.

**Files:**

| File | What changed |
| --- | --- |
| `workspace/host/src/egress/proxy.ts` | `ALLOWED` (host → reason); `LIMITS`; per-workspace and total tunnel counts; the header deadline, checked every `headersMs / 4` (Node checks only every 30 s by default); an idle timeout; an injectable `dial` for tests. Fixed: if the upstream failed after the tunnel opened, the proxy wrote an HTTP `502` into the TLS stream; now it closes the connection |
| `workspace/host/src/egress/proxy.test.ts` | +7 tests (below) |
| `workspace/host/src/host.docker.test.ts` | The isolation test above (5 tests in place of 1); every allowed host checked through the proxy |
| `workspace/host/src/workspaces.ts` | A comment brought up to date |

**Tests:**
- **Unit (16 in the proxy, 7 new):**
  - the allowlist is exactly these five hosts, each with a reason, on 443 only
  - a real tunnel both ways, to the public address after skipping a private one
  - `502` when the upstream refuses
  - the 3rd tunnel from one workspace is `429`, and a slot frees when one closes
  - a connection that never finishes its `CONNECT` is closed (`408`)
  - an idle tunnel is closed
- **Docker:** 33 in all, 4 new.

**Run and check it:**
```fish
pnpm test            # 539 tests
pnpm test:docker     # 33 tests; look for "workspaces can't reach each other, the host or the home network"
```
By hand, in a workspace's **Terminal** (see "Phase 1d so far — run and check it"):

| Type | You should see |
| --- | --- |
| `curl -sI https://registry.npmjs.org/ \| head -1` | `HTTP/2 200` |
| `curl -sS https://example.com` | `CONNECT tunnel failed, response 403` |
| `curl -sS --noproxy '*' -m 5 https://github.com` | fails: no route out except the proxy |
| `getent hosts github.com; echo $?` | `2`: no DNS out |
| `pnpm install` in `/workspace/project` (Rallly) | about 2 minutes, then `Done`. It needs about 2.4 GiB in the workspace's volume |

**Gotchas:**
- **The host loads `@flowcanvas/workspace-image` from `dist`, not `src`.** The first mutation check edited the source, so the test ran against unchanged code and "passed". Editing the built file made it fail as it should. Rebuilding (`pnpm --filter @flowcanvas/workspace-image build`) restored it. `pnpm test:docker` builds first, through turbo.
- **A paused socket never closes.** In a test, a client socket with no `data` listener never reads the server's `408` and end, so it never emits `close`. Add `socket.resume()`.
- **A workspace's root is read-only,** so `docker cp` into it fails ("rootfs is marked read-only"). Write into `/tmp` through `docker exec -i … sh -c 'cat > /tmp/file'` instead.

**Docs:** this write-up; the run guide; risks R1, R3 and R7; ADR 0016; ARCHITECTURE ("Workspaces"); upgrade-later 37; STATUS.

**Risks:**
- **R3 closed** locally: proven by the isolation test, and checked by the mutation run. It's repeated on the cloud provider (R8).
- R7: the network half is done; sleep when idle is step 8.
- R1 unchanged.
- **Laptop:** all five checks ok (22.2 GiB memory available, 581.3 GiB disk free, load 0.96). The install spike used 2.4 GiB of the 25 GiB budget and was removed afterwards.

**Commit:** `feat(workspace): egress allowlist for installs, proxy limits and the isolation test`

### Step 1d.8 — Sleep after 10 idle minutes, resume intact; metering (done by Claude, ADR 0018)

**Goal:** a running workspace that nobody has used for 10 minutes goes to sleep by itself, and comes back exactly as it was. Its time is metered fairly: running counts, asleep doesn't, and time nobody could use isn't charged. This is the second *Done when* item.

**What was already there (step 3), and what this step adds:**
- **Already there:**
  - `sleepIdleWorkspaces()`
  - `touchWorkspace()`, called on terminal typing (at most every 30 s) and on file and command requests
  - usage records written on sleep and stop
- **New:**
  - **something that runs the check every minute**
  - a fair rule for time that nothing put to sleep
  - a usage total that's current while a workspace runs

**Concepts:**
- **Cron Triggers.** A Worker can have a `scheduled` handler, which Cloudflare runs on a cron schedule (`* * * * *` is every minute). The free plan allows 5 triggers per account, at 10 ms of CPU per run. Waiting for the database isn't CPU. https://developers.cloudflare.com/workers/configuration/cron-triggers/
- **Why `pnpm dev` needs a ticker.** `wrangler dev` never runs Cron Triggers by itself (it says so when it starts). It runs the handler when you request `/cdn-cgi/local/scheduled`. So `services/control-plane/scripts/dev.ts` starts `wrangler dev` with the same arguments as before, and requests that address once a minute. It passes Ctrl-C on to Wrangler, and exits when Wrangler does.
- **"Idle" means the person isn't doing anything,** not that the computer isn't. Output alone (a dev server printing logs) doesn't keep a workspace awake, because anything that keeps one awake costs money and has to justify it. A long `pnpm install` left alone is frozen by sleep and carries on after resume, so nothing is lost. More signals come with live frames and agents (upgrade-later 38).
- **Metering, and why there are no extra writes.**
  - Records are written only when a workspace sleeps or stops, as before.
  - `/api/usage` adds the **live** seconds of workspaces running now.
  - The alternative, a tick that writes records for long-running workspaces, races a person pressing Sleep and can count the same seconds twice.
- **Metered until it sleeps, or would have** (`meteredUntil` in `src/workspaces/policy.ts`): the earlier of now and the last activity + 10 minutes. If you shut the laptop with a workspace running, nothing could put it to sleep. With this rule the night isn't counted, only the 10 minutes after you last typed.

**Files:**

| File | What it is |
| --- | --- |
| `services/control-plane/src/workspaces/policy.ts` | `IDLE_SLEEP_MS` (moved from the lifecycle, which re-exports it) and `meteredUntil()`; shared by the lifecycle and the meter without an import cycle |
| `services/control-plane/src/workspaces/lifecycle.ts` | Rows carry `last_active_at`; sleep and stop record run time up to `meteredUntil` |
| `services/control-plane/src/usage/usage.ts` | `usageSummary()` adds live seconds (one query; from the later of the start and the month's start, up to `meteredUntil`) |
| `services/control-plane/src/api/scheduled.ts` | The `scheduled` handler: no provider, nothing done; otherwise `sleepIdleWorkspaces()`, with failures logged redacted |
| `services/control-plane/src/api/app.ts` | `resolveDependencies()`, so the API and the tick share defaults and the redacting log |
| `services/control-plane/src/api/worker.ts` | Exports `fetch` and `scheduled` |
| `wrangler.jsonc` | `triggers.crons: ["* * * * *"]` |
| `services/control-plane/scripts/dev.ts`, `package.json` | The ticker around `wrangler dev`; the `dev` script runs it |
| `docs/adr/0018-idle-sleep-tick-and-metering.md` | The choices above and the ones rejected |

**Tests:**
- **Lifecycle and meter (5 new, PGlite, a clock the tests move):**
  - live seconds while running, then the same seconds once asleep, never double
  - capped at the last activity + 10 minutes when nothing put it to sleep
  - a workspace lost while "running" is recorded the same way
  - running since last month counts only this month's part
  - another person's workspace isn't counted
- **The tick (4 new):**
  - sleeps an idle workspace, and leaves one that's 1 s short
  - does nothing at all where no provider is configured (not even open the database)
  - says so when `DATABASE_URL` is missing
  - logs a failure without throwing, and never the connection string
- **Docker, the *Done when* (1 new, `local-host.docker.test.ts`):**
  - the real workspace host and Docker, with the real lifecycle and tick
  - a file written, and a process counting in memory
  - 9 min 59 s on: still running; 10 min: asleep (Docker says `paused`), 600 s metered
  - an hour later, resume: the file is there, the same process is alive and still counting, and the hour asleep cost nothing
- **By hand:** the ticker ran for 70 s on a spare port. Wrangler logged `GET /cdn-cgi/local/scheduled 200 OK` at the minute, and Ctrl-C stopped Wrangler with it (the port was free afterwards).

**Run and check it:**
```fish
pnpm test            # 548 tests
pnpm test:docker     # 34 tests; look for "sleeps after 10 idle minutes and resumes intact"
```
For real: restart `pnpm dev` (its control-plane script changed). Then, in "Phase 1d so far — run and check it", follow the new row about waiting 10 minutes.

**Gotchas:**
- **`pkill -f` matches its own shell** when the pattern is in the same command line, and kills the command. It happened again in this step. It only stopped a probe on a spare port, but the rule stands: stop processes by PID, or let `timeout` end them.
- **Wrangler's debug log** (`WRANGLER_LOG=debug`) can print local variables, so its output was deleted unread apart from the line that was needed.
- **You can't `docker exec` into a paused container,** so "frozen while asleep" can't be read from inside. The test proves the process kept its memory by its counter carrying on after resume.

**Docs:** this write-up; the run guide; risks R4 and R7; ADR 0018; ARCHITECTURE ("Workspace lifecycle"); upgrade-later 38; STATUS.

**Risks:**
- R4: pause and resume are proven with the real tick (memory kept, process intact). The cost of a paused workspace's memory is still open, and step 8a's guard handles it.
- R7: closed locally.
- New, watch at phase close: Cloudflare's branch previews with a `triggers` block. Triggers apply on deploy, so the PR's preview build shows whether `versions upload` warns.
- **Laptop:** all five checks ok (21.6 GiB memory available, 579 GiB disk free, load 0.93). The tests' workspaces were removed afterwards.

**Commit:** `feat(control-plane): idle workspaces sleep after 10 minutes (scheduled tick); fair, live metering`

### Step 1d.8a — The resource guard (done by Claude, ADR 0019)

**Goal:** Flowcanvas stays within its budget on your laptop, whatever else is running. When the laptop is short of memory or disk, or busy for minutes, Flowcanvas refuses new workspaces with a clear sentence, and stops or sleeps its own to make room. It never touches anything else on the laptop.

**Two corrections to the plan** (in "On the owner's laptop", written before steps 3 to 8):
1. **Sleeping doesn't free memory.** `docker pause` freezes processes *with* their memory; that's why resume is intact. So:
   - under memory pressure, the guard **stops** a workspace (files kept), asleep ones first, since they hold memory nobody's using
   - under load, it **sleeps** one
   - under disk pressure, only clean-up helps
2. **The host measures; the control plane acts.** The database holds each workspace's state and usage. If the host paused or stopped containers itself, the page and the meter would disagree with Docker. So:
   - the host refuses starts, and removes old images
   - the control plane's minute tick (step 8) changes workspaces through the lifecycle, with a reason the person will see

**Concepts:**
- **Load average** is roughly how many processes want a CPU, averaged over a minute. Above the number of cores, work is queuing. It lags: after something stops, it falls over a minute or two. So the guard waits for 2 minutes of high readings before acting, and one low reading starts the wait again. https://man7.org/linux/man-pages/man5/proc_loadavg.5.html
- **`MemAvailable`** (`/proc/meminfo`) is what can be used without swapping, including cache the kernel can drop. It's the honest "free memory" figure. https://man7.org/linux/man-pages/man5/proc_meminfo.5.html
- **Measure cheaply, often; expensively, rarely.** Memory, free disk and load are file reads, taken every 30 s. Flowcanvas's own disk use needs `docker system df --verbose`, which sizes every volume (about 4 s here), so it's measured every 5 minutes, and again right after a clean-up.
- **One change per tick.** Stopping one workspace may be enough. The host measures again within 30 s, so the next tick acts only if it wasn't.
- **A test hook that can't leak into real use.** Real memory pressure can't be made safely on your laptop. With a test prefix only, `WORKSPACE_HOST_TEST_PRESSURE=memory` makes the host *report* pressure, and under the real `fc` prefix the host refuses to start with it.

**What happens, by pressure:**

| Pressure | Host (every 30 s) | Control plane (every minute) |
| --- | --- | --- |
| Memory under 4 GiB available | Refuses to create or start; still lets a sleeping one resume (it holds its memory already) | Stops the least recently used workspace, asleep ones first: "Stopped to free memory on this computer. Its files are kept: open it to start it again." |
| Load above 14.4 for 2 minutes | Refuses to create, start or resume | Puts the least recently used running workspace to sleep: "Put to sleep because this computer was very busy. Resume it when you need it." |
| Disk under 50 GiB free | Refuses to create or start; removes old workspace images | Nothing (no one's files are deleted) |
| Flowcanvas over 25 GiB | The same | Nothing |

The notice is cleared when you next open the workspace. Step 9 shows it on the workspace's card.

**Files:**

| File | What it is |
| --- | --- |
| `workspace/host/src/guard.ts` | `ResourceGuard` (samples, sustained load, disk every 5 min, logs only changes, keeps its last answer if measuring fails); `evaluate()`; the sentences; `removeOldImages()` |
| `workspace/host/src/resources.ts` | Readings split into `readSystem()` (cheap) and `readFlowcanvasDisk()` (slow); `BUDGET.loadSustainedMs` |
| `workspace/host/src/protocol.ts` | `Pressure`, `PRESSURE_KINDS`, `PATHS.pressure` |
| `workspace/host/src/workspaces.ts`, `server.ts`, `main.ts` | Refusals in `#checkRoom`; `GET /v1/pressure`; the guard started with the host; the test hook (test prefixes only) |
| `services/control-plane/src/workspaces/provider.ts`, `local-host.ts` | Optional `pressure()`: only known kinds pass |
| `services/control-plane/src/workspaces/lifecycle.ts` | Sleep and stop take a notice; `relievePressure()`; `RELIEF_NOTICES` |
| `services/control-plane/src/api/scheduled.ts` | The tick: idle sleep, then the guard |
| `docs/adr/0019-resource-guard.md` | The split, and the options rejected |

**Tests:**
- **Host (unit, 15 new):**
  - each limit and its sentence
  - load counted only after 2 minutes, and forgotten when it drops
  - disk measured every 5 minutes, and again after a clean-up
  - clean-up on disk or budget pressure
  - logging only changes
  - the last answer kept when measuring fails
  - only old images removed (current kept, one in use skipped, never a container or volume)
  - refusals per kind for create, start and resume
  - sleep and stop still allowed under pressure
  - `GET /v1/pressure` behind the token
- **Control plane (unit, 10 new):**
  - nothing without pressure, or for disk alone
  - memory stops the least recently used, asleep first, with the notice and usage recorded
  - load sleeps one per tick
  - a failed change is logged
  - a provider without a guard does nothing
  - opening clears the notice
  - the tick runs the guard
  - the adapter keeps only known kinds, and says when the host is down
- **Docker (2 new):**
  - a real host told it's short of memory refuses to open a workspace with its sentence, and nothing is created in Docker; the tick then stops a running workspace with the notice (Docker: `exited`), and its volume is kept
  - the test hook is refused for real workspaces
- **By hand:** the real guard on this laptop reported no pressure (first check 4.4 s, because of the disk measurement).

**Run and check it:**
```fish
pnpm test               # 573 tests
pnpm test:docker        # 36 tests; look for "under memory pressure"
pnpm workspace:resources  # the same numbers the guard uses
```
Restart `pnpm dev` (the host changed). Under real pressure its log says `[workspace-host] guard: under pressure: memory`, then `guard: back within limits`.

**Gotchas:**
- **The control plane uses the host's protocol from `dist`.** After changing `workspace/host/src/protocol.ts`, run `pnpm --filter @flowcanvas/workspace-host build`, or the control plane doesn't see the new types. `pnpm test` and `pnpm dev` build it first, through turbo.
- **A text pattern can match more than you meant.** A clean-up script's "remove the `let output` line" matched one inside a test too; it stopped because it checks each replacement matches once.

**Docs:** this write-up; the corrections in "On the owner's laptop"; risk R9; ADR 0019; ARCHITECTURE; the deletion requirement in ADR 0019; STATUS.

**Risks:**
- R9: closed locally (the guard, tested). The numbers can be tuned in `BUDGET`.
- **Laptop:** all five checks ok (22.7 GiB memory available, 579 GiB disk free, load under 4). The tests' workspaces were removed.

**Commit:** `feat(workspace): resource guard keeps Flowcanvas within its laptop budget`

### Step 1d.9 — Workspace status on the page, and Open demo project

Split into three parts: the demo needs the corpus pin to be honoured, which nothing did yet.

#### 9.1 — Pinned clones and the demo endpoint (done by Claude)

**Goal:** **Open demo project** opens Rallly at the commit the corpus pins (rule 8), with one click, and never the fork's moving head.

**Why this came first:** the fork's `main` had moved on to `10b90ef`, while the corpus pins `8e67a21`. Every clone so far took the branch head, so the demo would have opened code the corpus doesn't describe.

**Concepts:**
- **Fetching one commit by its SHA.** `git clone` follows a branch. To get exactly one commit, shallow:
  1. `git init`
  2. `git remote add origin <url>`
  3. `git fetch --depth 1 origin <sha>`
  4. `git checkout --detach <sha>`

  GitHub serves any commit reachable from the repository this way. It ends **detached** (on a commit, not a branch), which is honest: it isn't any branch's head. https://git-scm.com/docs/git-fetch
- **One source for the pin.** The control plane reads Rallly's fork and commit from `corpus/manifest.json` (bundled into the Worker as JSON). The corpus tests and the demo can't disagree.
- **Find or create, then open.** `POST /api/projects/demo` makes the demo project the first time (`Rallly (demo)`, pinned) and finds the same one after. The page then opens it through the usual `/workspace/open`, so there's one open path. Where workspaces can't run (staging), it refuses before making anything.

**Files:**

| File | What changed |
| --- | --- |
| `services/control-plane/migrations/0004_pinned_commit.sql` | `projects.repo_commit`: a full lower-case SHA, and only with an address (both checked by the database). **Applied to the dev database** (`ep-square-leaf…`); staging at phase close |
| `services/control-plane/src/projects/demo.ts` | `demoProject()` from the manifest; `ensureDemoProject()` |
| `services/control-plane/src/projects/projects.ts` | `repoCommit`; each project's workspace now has `stateChangedAt` and `failure` (for the cards); `findPinnedProject()` |
| `services/control-plane/src/projects/routes.ts` | `POST /api/projects/demo`; `GET /api/projects` adds `workspacesAvailable` |
| `services/control-plane/src/workspaces/{provider,local-host,lifecycle}.ts` | The commit is passed to `create`, so a lost workspace is made again at the same commit |
| `workspace/host/src/{protocol,workspaces,server}.ts` | `CreateRequest.commit` (checked: 40 lower-case hex, with a repository); the pinned clone |

**Tests:**
- **Host:** the pinned clone's exact git commands (https-only rules on each); short, branch-name, upper-case, flag-like and repository-less commits refused before Docker; the server refuses a non-string commit
- **Control plane:**
  - the demo is the manifest's fork and pin
  - made once (201), then found (200, same project)
  - another project with its name: 409
  - staging: 503, nothing made
  - another origin: 403
  - the database refuses a bad SHA, and a pin without an address
  - the lifecycle passes the pin to the provider
- **Docker:** the *Done when* timing test now opens Rallly at its pin. `HEAD` is `8e67a21`, with one commit of history. **7.0 s** (clone 5.6 s), faster than the branch head.

**Gotchas:**
- **A fork's branch moves; a pin doesn't.** Anything that claims to be "the corpus" has to use the commit, not the branch.
- **A migration the code needs must reach the dev database before `pnpm dev` restarts,** or listing projects fails on the missing column. `pnpm db:status` shows the target host first.

**Commit:** `feat(workspace): pinned clones and the Open demo project endpoint`

#### 9.2 — The workspace status chip (done by Claude)

**Goal:** the top-bar chip from the design brief ("a small dot plus text"), built once in the design system with every state, before any screen uses it (components first).

**What it looks like** (`packages/ui/src/components/workspace-status/`):
- The Figma top bar's status: a 6 px dot, a 6 px gap, Mono small text in `text/secondary`.
- `detail` adds "· 2 cores".

| State | Words | Dot |
| --- | --- | --- |
| `not_created`, `sleeping`, `stopped` | Not started, Sleeping, Stopped | neutral (`text/tertiary`, Figma's sleeping dot) |
| `creating`, `resuming` | Starting…, Resuming… | an open ring (`text/secondary`) |
| `running` | Running | green (`state/added/solid`): Graphite's runtime "pass" |
| `failed` | Couldn't start | coral red (`state/removed/solid`): Graphite's "fail" |

**Deviation from Figma, for review:** Figma colours *Starting…* with `accent/solid`. Graphite keeps the accent for selection and focus only, and Graphite outranks Figma (CLAUDE.md, sources), so a changing state is an open ring instead. It differs from idle by shape as well as by its words.

**Concepts:**
- **State never by colour alone** (WCAG 1.4.1). The words always say the state, so the dot is `aria-hidden` and only repeats them. https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- **Tokens only, even for a circle.** Stylelint refuses `50%` for a radius. A radius of half the size or more makes a circle, so the smallest radius token (4 px) draws a 6 px dot exactly.

**Tests:**
- **Unit (4):**
  - every state in words
  - the detail
  - each state's tone, with the dot hidden from screen readers
  - attributes and `data-state` passed through
- **Visual:** 4 new baselines (`Default`, `AllStates`, both themes), checked by eye, with axe. No existing baseline changed.

```fish
pnpm --filter @flowcanvas/ui test     # 70 tests
pnpm test:visual                      # 68 checks; the chip's are "components-workspacestatus--…"
pnpm --filter @flowcanvas/ui storybook  # Components → WorkspaceStatus
```

**Commit:** `feat(ui): WorkspaceStatus chip with every workspace state`

#### 9.3 — The workspace on the page, and Open demo project (done by Claude)

**Goal:** every project shows where its workspace is and what you can do with it, and **Open demo project** opens Rallly at its pin in one click. Staging says plainly that workspaces run locally for now, and offers nothing that can't work.

**What each project row shows** (`apps/web/src/projects/ProjectWorkspace.tsx`, until the phase 2 top bar):

| Workspace | Chip | Actions | Card or line |
| --- | --- | --- | --- |
| Not started | Not started | **Open** | — |
| Starting | Starting… | — | "Starting *name*": "Cloning github.com/… at 8e67a21. Usually under 15 seconds." (or "Starting it again with its files" after a stop), with an indeterminate strip |
| Running | Running · 2 cores | **Sleep**, **Stop**; **Terminal** | — |
| Asleep | Sleeping | **Stop**, **Resume** | "This workspace is asleep": the reason if it wasn't asked for, then "Its files and running processes are kept as they were, and asleep costs nothing." Facts: asleep since, machine, resume time |
| Resuming | Resuming… | — | "Resuming *name*": "Waking it with its files and running processes as they were." |
| Stopped | Stopped | **Open** | the guard's reason, if it stopped it |
| Couldn't start | Couldn't start | **Try again** | the failure, in words |

A refusal (the 2-workspace cap, the guard's pressure) is shown as the API said it, and the workspace stays as it was.

**Concepts:**
- **Polling, and why it isn't activity.** While a workspace is starting or resuming, the page asks every 3 s; while it runs, every 30 s. So an idle sleep or the guard's stop shows without a reload. It's a `GET`, and only typing and file or command requests count as activity. So watching the page doesn't keep a workspace awake.
- **Showing a request in flight truthfully.** "Starting…" appears from the click, because we did ask for it. The answer then replaces it with what the control plane recorded.
- **No made-up progress.** The host doesn't report progress during a clone, so the strip is indeterminate (`role="progressbar"` with no value). Under reduce-motion it's only the track: a still segment would read as a percentage.
- **Never claim what isn't known.** A sleep can be idle, the guard's, or the person's own. The page can't tell them apart from the state alone, so the idle check and the guard leave a notice (`failure`), and the card says why only when there's a notice. The brief's "went to sleep after 10 minutes idle" would be false after pressing **Sleep**.

**Deviations from Figma 32 and 33, for the owner's review:**
- **Left out, because the system doesn't have it yet:** the starting card's step list ("Restoring snapshot", "Installing dependencies…") and progress meter; the asleep card's "Last backup" and "Last checkpoint"; "Everything is saved: …checkpoints, canvas layout and the agent session" (backups are phase 18a, agents stage 3).
- **Resume is a secondary button,** not primary: several projects can be asleep at once, and Graphite allows one primary per view (the form's **Create project**).
- **Placement:** the cards sit inside each project's row on the version page, not centred on a dimmed canvas. The canvas and top bar come in phase 2, and the chip's popover (machine, uptime, Sleep now) with the top bar.
- **Starting dot:** see 9.2 (a ring, not the accent).

**Files:**

| File | What it is |
| --- | --- |
| `apps/web/src/projects/ProjectWorkspace.tsx`, `.module.css` | `useWorkspace()` (record, action in flight, the API's sentence, polling) and `ProjectWorkspace` (chip, actions, cards); tokens only |
| `apps/web/src/projects/Projects.tsx`, `.module.css` | **Open demo project** (or staging's sentence), one panel per row, the pinned commit after the address, toggles grouped on the right |
| `apps/web/src/projects/api.ts` | `Workspace`, `ProjectList` (`workspacesAvailable`), `workspaceAction()`, `fetchWorkspace()`, `fetchDemoProject()` |
| `services/control-plane/src/workspaces/lifecycle.ts` | The idle check leaves "Put to sleep after 10 minutes without activity."; a sleep the person asks for leaves none |
| `e2e/try-it/phase-1d.spec.ts`, `phase-1c.spec.ts` | Two new walkthroughs (below); 1c's fake API and step brought up to date |

**Tests:**
- **Component (16, of which 10 new):**
  - staging: one sentence and no buttons
  - Open: Starting… with the clone line and an indeterminate bar, then Running with Terminal, Sleep and Stop
  - a guard refusal shown as said, with the workspace left as it was
  - asleep: the reason, real facts only (no "backup" or "checkpoint"), and Resume
  - a requested sleep never called idle
  - stopped and failed, with their reasons, Open and Try again
  - the demo made, listed first, pinned, and opened in one click (exactly three requests)
  - the demo's 409 explained
  - polling at 3 s and 30 s, and not while asleep (fake timers)
- **Control plane (1 new):** the idle sleep's notice, and none for a requested sleep
- **Walkthroughs (2 new, recorded, under the production CSP, no page errors):**
  - *Open demo project*: listed first and pinned, starting, running with a terminal, Sleep (no idle, backup or checkpoint claims), Resume
  - *Staging*: the sentence, and no demo or Open buttons
- **By eye:** screenshots of every state in both themes, checked against Figma 32 and 33 (layout and copy differences above).

**Run and check it:** "Phase 1d so far — run and check it", section 2, now uses the buttons.
```fish
pnpm test        # 596 tests (corrected in step 10: the run this figure came from was the one where the corpus task failed)
pnpm test:e2e    # 9 walkthroughs
```

**Known issue:** one full `pnpm test` run of six had one failing task. Five reruns of the whole suite, and five of the web and host suites alone, all passed. That run's output didn't record which test failed. *Step 10 narrowed it down:* that run counted 586 tests against 596 in every clean run, and the only package with exactly 10 tests is the corpus. Its tests are pure, so the likely cause is Vitest's worker failing to start under the full parallel load. To watch in CI.

**Docs:** this write-up; the run guide; ARCHITECTURE ("Workspaces on the page"); STATUS.

**Risks:**
- R8 unchanged: on staging, the page now says so instead of offering buttons that fail.
- **Laptop:** all five checks ok (21.7 GiB memory available, 578 GiB disk free, load 8.1 from this step's own test runs, under the 14.4 limit); no test workspaces left.

**Commit:** `feat(web): workspace status, starting and asleep cards, and Open demo project`

### Step 1d.10 — Security tests, the Try it, the real 10-minute run, Docker in CI (done by Claude)

**Goal:** prove the phase's promises the way a skeptic would. Secrets planted everywhere they could pass are kept nowhere. One workspace reaches nothing else. The *Try it* works as written. Idle sleep works in real time. And the Docker tests run in CI, not only on your laptop.

**Concepts:**
- **Canaries.** A canary is a made-up secret with an unmistakable marker (`CANARY-…`), planted where a real one could be. The test then searches every place a secret could end up. Finding nothing proves something only if the canary demonstrably passed through, so each test also checks that it did (for example, the owner's own shell does show their own `.env`).
- **"Kept nowhere," for a workspace,** means not in:
  - the host's log lines
  - Docker's stored logs (turned off: `--log-driver none`)
  - a container's settings and environment (`docker inspect`)
  - any process environment the workspace can read
  - the answers to other requests

  The owner's own command output and shell are theirs: they come back to them and are kept nowhere else.
- **Defence in depth for the host's sentences.** The control plane shows the host's error sentences to the person. A buggy host that echoed its request would have shown the token. Now any sentence containing the token is replaced with "an answer we didn't expect". A mutation check confirmed it: with the filter off, the test fails on `hostToken in responses`.
- **Faking time in a walkthrough.** Playwright's `page.clock` replaces the page's timers, so "wait for sleep" takes no time: the page's 30-second check runs when the test says. The real wait is proven separately. https://playwright.dev/docs/clock
- **CI isn't the laptop.** GitHub's runners have far less than 50 GiB free, so the guard would read disk pressure and refuse every workspace. The CI job sets `WORKSPACE_HOST_TEST_PRESSURE=none`, which only test hosts (`fc-test-` prefixes) accept; the real prefix refuses it, which is tested. Turbo hides undeclared variables from tasks, so `test:docker` now passes it through. A run with `memory` proved it arrives (5 tests failed, as they should).

**What's new:**

| Where | What it proves |
| --- | --- |
| `workspace/host/src/no-leaks.docker.test.ts` (6, real Docker) | The host's token, a `.env`, a command's argument and output, and terminal input: none kept in the host's logs, other answers, Docker's logs (workspace and proxy), `docker inspect`, or any process environment in the workspace |
| `services/control-plane/src/api/no-leaks.test.ts` (+1) | Through the workspace routes, the demo and the minute check, including a host that echoes everything it's sent, token included: nothing reaches logs, the console or answers |
| `services/control-plane/src/workspaces/local-host.ts` | The token filter on the host's sentences |
| `workspace/host/src/host.docker.test.ts` | The probe of this computer's own addresses now includes the Worker's port 8787 (with 22, 5173 and 8790) |
| `e2e/try-it/phase-1d.spec.ts` (+1) | **Try it, as written:** create Rallly from its GitHub address, Open, run a command in the terminal, wait for sleep (the page notices by itself), Resume |
| `services/control-plane/scripts/idle-real.ts` (`pnpm --filter @flowcanvas/control-plane test:idle-real`) | The 10-minute idle sleep in **real time**, nothing faked: the real host, lifecycle and minute check, Rallly at its pin, a file and a counting process |
| `.github/workflows/ci.yml` (job `docker`), `turbo.json` | `pnpm test:docker` on every PR and every push to `main`, after checking Docker is 28 or newer |
| `workspace/host/src/main.ts` | The test hook takes `none` (test prefixes only) |
| `services/control-plane/vitest.config.ts`, `tsconfig.json` | At most 6 test workers (the finding below) |

**The real 10-minute run** (`test:idle-real`, alone on the laptop, 6 Nov): **passed.**
- Asleep after **10.02** idle minutes (the check runs once a minute), and Docker says `paused`.
- **600 s** metered.
- After 30 s asleep it resumed: the file was there, the same process was alive and still counting.
- The host never printed its token.

The first attempt was spoiled by my own load. With the full unit suite running alongside, the test host's guard saw memory below 4 GiB at 7.2 minutes and correctly **stopped** the workspace for memory (422 s metered: the time it actually ran). That led to the next finding.

**Finding: our own `pnpm test` starved the laptop.** Measured with a sampler reading `MemAvailable` every 0.5 s:

| Run | Lowest memory available | Time |
| --- | --- | --- |
| `pnpm test`, before | **1.3 GiB** (from 18.8: about 17.5 GiB used at once) | — |
| control-plane tests alone, Vitest's default (15 workers) | 6.1 to 4.0 GiB | 83 s |
| control-plane tests alone, 4 workers | 13.9 GiB | 86 s |
| control-plane tests alone, **6 workers** | 12.3 GiB | **68 s** |
| `pnpm test`, after (control plane at 6 workers) | **11.4 GiB** | 75 s |

Most control-plane tests start their own in-process Postgres (PGlite). With a worker per core, that's about 18 GiB at once, and it's slower too, because the workers fight over cores. `services/control-plane/vitest.config.ts` now sets `maxWorkers: 6`.

**Also seen:** your own workspace (`fc-ws-2f78…`), opened with **Open demo project**, went to sleep by itself under your `pnpm dev`. That's the real minute check end to end.

**Run and check it:**
```fish
pnpm test                                             # 597 tests
pnpm test:docker                                      # 42 tests, including "no secret is kept anywhere"
pnpm test:e2e                                         # 10 walkthroughs, including "phase 1d · Try it"
pnpm --filter @flowcanvas/control-plane test:idle-real  # about 12 minutes, in real time
```

**Gotchas:**
- **Check that a mutation actually breaks something.** My first mutation (`token !== token`) is always false, so it rejected every message, and the test rightly passed. The useful one lets everything through (`token === token`).
- **`vitest -t` skips the tests a later one depends on.** Filtering to one isolation test skipped the test that creates the workspace, so it "failed" with no container to probe from. Run the file.
- **The flaky task, narrowed down:** the run that reported 586 tests was missing exactly the corpus package's 10 (596 in every clean run). The 586 in the step 9 docs is corrected.

**Docs:** this write-up; the run guide's counts; the step 9.3 known issue; ARCHITECTURE ("Security checks"); STATUS.

**Risks:**
- R6 (the Docker socket is root-equivalent): closed locally. The token is checked and never kept or shown, even when a host echoes it, and nothing from requests reaches Docker's arguments.
- R1 unchanged (the kernel is shared until real VMs).
- New: whether GitHub's runners have Docker 28 or newer. The `docker` job checks it first, and the PR at phase close shows the answer.
- R9, now covering our own tools too: the test suite's peak memory is capped (above).
- **Laptop:** all five checks ok after the step (23.0 GiB memory available, 578 GiB disk free); the test objects were removed. Your own workspace (`fc-ws-2f78…`) was left as your `pnpm dev` put it: asleep.

**Commit:** `test(workspace): no secret kept anywhere, Try it walkthrough, real-time idle run, Docker tests in CI`

### Step 1d.11 — Close the phase as in review (done by Claude)

- **Release:** version `0.5.0`. The CHANGELOG entry is also the in-app What's new: what was added, the security work, and the test change.
- **Report:** `docs/reports/phase-1d.md`, with each *Done when* item's evidence, the deviations, the ADRs, known issues and what waits for the cloud provider.
- **Status:** `docs/STATUS.md` says **in review**.
- **Upgrade-later review:** 33–39 are this phase's, each with a trigger; none is due before phase 2; 32 is still open.
- **Staging's database** (owner): migrations 0003 and 0004, *before* the merge. They only add columns and tables, so the code staging runs now keeps working, and the new code finds what it reads.
- **The PR:** CI includes the new `docker` job, which shows whether GitHub's runners have Docker 28 or newer. Merge only when everything is green.

**Commit:** `docs: phase 1d report, 0.5.0, in review`

**Found by the PR: Cloudflare's preview build had failed since step 4.**
- **What happened:** Cloudflare builds only the web app's task (`pnpm build --filter=@flowcanvas/web`), then bundles the Worker. From step 4 on, the Worker imports `@flowcanvas/workspace-host/protocol` and `@flowcanvas/workspace-agent/protocol`, which resolve to those packages' `dist/`. That task never built them.
- **Why nobody saw it:** on a laptop, `dist/` is always there from earlier builds. Every commit from `f1af4dc` failed, and the phase had no PR, where Cloudflare's checks show.
- **The fix:** `turbo.json` makes `@flowcanvas/web#build` also build those two packages. Reproduced from a fresh state, the bundle failed with `Could not resolve "@flowcanvas/workspace-host/protocol"` before the fix and succeeded after (356 KiB, the same as before).
- **So it can't happen silently again:** CI's checks now run Cloudflare's exact build on the fresh checkout, then `wrangler versions upload --dry-run`, before anything else builds a package.
- **Gotcha:** a build that works on your machine may rely on outputs left from an earlier build. Check deployable builds from a clean state.

**Staging's database (owner, 6 Nov):** `pnpm db:migrate` on the production branch (`ep-raspy-frost…`, not the dev branch) applied `0003_workspace_lifecycle` and `0004_pinned_commit`.

**Also found by the PR: my test-worker cap was too high for CI.** The step 10 cap (6 workers) is right for the laptop's 16 cores, but CI's runner has 4. Six workers there made each in-process Postgres start too slowly, and 21 setup hooks timed out (10 s). Every failure was a timeout, and all in the control plane. The cap is now *at most 6, and never more than the cores minus one* (`availableParallelism()`, which follows the CPUs a process may use). Checked pinned to 4 cores (233 pass, 68 s) and to 2 (233 pass, 157 s); the laptop still gets 6.

**After the merge, `main`'s CI failed the same way** (3 setup hooks timed out at 10 s, with 3 workers on CI's 4 cores), so capping workers was treating the symptom. **The cause:** every test started its own in-process Postgres. Starting PGlite is almost all the cost (about 0.8 s each here, measured; the migrations take next to nothing), and on a busy 4-core runner it nears the 10 s limit. **The fix** (follow-up PR, `services/control-plane/src/test/`):
- Each test file starts and migrates **one** Postgres once, and every test gets its own `clone()` of it (about 0.2 s, measured; just as fresh and independent).
- Each test's databases are **closed when it ends** (`setup.ts`, a Vitest setup file). Without that, the faster clones piled up: the full suite's low point fell to 5.8 GiB.

| Full `pnpm test` | Lowest memory available | Time |
| --- | --- | --- |
| Before step 10 | 1.3 GiB | — |
| Workers capped at 6 (step 10) | 11.4 GiB | 75 s |
| One migrated Postgres per file, cloned per test, closed after each test | **19.0 GiB** (about 6 GiB used) | **17 to 20 s** |

Checked: control-plane tests pinned to 4 cores, 6 runs out of 6 passed after the change (one run of 15 had failed before it, cause not captured); pinned to 2 cores, passed; 5 full runs in a row passed; the Docker tests pass.

**`main` failed once more after #13, and this one explained itself.** The same three tests failed on both `main` runs, and each is the **first test in its file**: three files, three workers. So it wasn't per-test setup any more, but the first PGlite in each fresh worker process, which also compiles its WebAssembly from cold (1.1 s locally against 0.8 s for later ones; past 10 s on a cold, busy runner). The PR runs had passed, so it was close to the limit either way. **The fix** (second follow-up PR): the setup file prepares the migrated template once per test file, in a `beforeAll` allowed 60 s. Each test's clone keeps the normal 10 s limit, so a slow per-test setup would still fail. Passes pinned to 16, 4 and 2 cores.

**Still open:** one rare failing control-plane test, about 1 run in 15, with its name not yet captured. *Hunt (7 Nov):* 20 more runs at low priority with full output kept, plus 8 before them, all passed. Likely the same slow start under load that #13 and #14 fixed. If it recurs, CI's log names it.

**CI's Docker job, first run:** GitHub's `ubuntu-24.04` runner has **Docker 28.0.4**. All 42 Docker tests ran and passed (Rallly opened in 3.1 s there).

## Phase 2 — Canvas and app shell

**From the build plan:**
- **Build:** a React Flow canvas with pan, zoom, minimap and selection; the app shell from Figma 06 (top bar, rail, side panels, review bar) with placeholder content; panels that dock and collapse.
- **Done when:** 500 dummy nodes pan and zoom smoothly; the layout matches Figma 06.
- **Try it:** pan, zoom and collapse panels; compare with Figma 06.

**Owner decisions (7 Nov 2026, decisions log):**
- **Honest empty states, not placeholders** (rule 10). The 500 dummy nodes appear only in the catalogue, the performance test, and a Labs switch labelled as a preview.
- **Docked panels collapse and resize;** moving them is upgrade-later 40.
- **The projects list stays at `/`;** a project opens at `/p/<id>`.

**Expected outcome:** opening a project takes you to its own page, laid out like Figma 06:
- **Top bar:** the project, its workspace chip with its popover (Sleep, Stop, the machine, usage), the view switch (Graph now; Sequence and Code disabled until their phases), and search (disabled until phase 4).
- **Rail:** tools open their panels. **Terminal** opens the real terminal in the bottom dock.
- **Canvas:** pan (Space + drag), zoom (Ctrl + scroll, pinch), fit (F), select, a minimap, zoom controls, and a dot grid.
- **Right panel and review bar:** collapse and resize them, or collapse everything for a full-screen canvas. Your layout is remembered.

Both themes; 1440 × 900, checked at 1280 × 800.

**Sizes (Figma generator script, `shell()`; they win over the brief):**

| Region | Figma | Brief |
| --- | --- | --- |
| Top bar | 40 px | 44 px |
| Rail | 44 px | 48 px |
| Left panel | 248 px | 260 px |
| Right panel | 360 px | 360 px |
| Review bar | 40 px; 300 px open | 40 px; about 280 px open |
| Dot grid | 16 px, `border/subtle` | — |

**Concepts this phase introduces** (each gets a primer in its step):
- React Flow: nodes, edges, the viewport, custom node types: https://reactflow.dev/learn
- Resizable, collapsible panels, and the separator pattern for keyboard users: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
- Client-side routing with the History API: https://developer.mozilla.org/en-US/docs/Web/API/History_API
- Measuring smoothness: frame times with `requestAnimationFrame`: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

**Scope:**
- **In:**
  - the five regions, built from design-system components shown in the catalogue first
  - collapse and resize, by mouse and keyboard
  - the canvas basics
  - `FlowNode` as a React Flow node
  - the workspace chip's popover, and the terminal in the bottom dock
  - honest empty states
  - the 500-node performance test
- **Out:**
  - real flows (phase 4 onwards)
  - the editor (phase 3)
  - the Sequence and Code views
  - search (phase 4)
  - the agent panel's content (stage 3)
  - movable panels (upgrade-later 40)
  - the start screen

### Steps (planned)

| # | Step | Status |
| --- | --- | --- |
| 0 | Record 1d's after-merge checks; the decisions; upgrade-later 40; branch | done (Claude, 7 Nov) |
| 1 | Spike: React Flow and `react-resizable-panels` under the strict CSP; a first frame-time measurement with 500 nodes. ADR 0020 | done (Claude, 7 Nov) |
| 2 | The project page (`/p/:id`) and the shell skeleton at Figma's sizes, with the geometry test | done (Claude, 7 Nov) |
| 3 | Shell components in the design system: top bar, rail, collapsible panel, review bar (catalogue and baselines) | done (Claude, 7 Nov) |
| 4 | Panels: collapse, resize, keyboard control; the layout remembered per browser; full-screen canvas | done (Claude, 7 Nov) |
| 5 | The canvas: dot grid, pan, zoom, minimap, selection, zoom controls, fit; `FlowNode` as a node type | done (Claude, 7 Nov) |
| 6 | Real content: project, workspace chip and popover, the terminal in the bottom dock; empty states | done (Claude, 7 Nov) |
| 7 | The 500-node performance test, with its numbers | done (Claude, 7 Nov; real window with the owner's approval) |
| 8 | Baselines, the Try it walkthrough, and the Figma 06 differences list (decision A5) | done (Claude, 7 Nov) |
| 9 | Close: report, 0.6.0, PR | done (Claude, 7 Nov) |

### How each Done-when item is proven

| Item | Test |
| --- | --- |
| 500 dummy nodes pan and zoom smoothly | Playwright drives scripted pan and zoom over 500 nodes and records frame times. Target on the laptop: median 60 fps, 95th percentile under 25 ms. On CI (no GPU) it reports and fails only on a large regression |
| The layout matches Figma 06 | A geometry test of every region at 1440 × 900 and 1280 × 800; visual baselines in both themes; the owner's side-by-side review with the differences list |
| Try it | A recorded walkthrough: pan, zoom, collapse every panel, restore, reload (layout kept) |

### Risks (checked at every step)

| # | Risk | How we keep it in check | Status |
| --- | --- | --- | --- |
| R1 | A library injects inline styles, which our CSP blocks (as xterm.js did) | Step 1 checks both under the deployed CSP before anything is built on them | **closed (step 1):** no violations; React Flow uses a static CSS file, the panels constructed stylesheets |
| R2 | 500 nodes aren't smooth (React Flow renders DOM nodes) | Measured in step 1. Memoised node components keep each frame light. A WebGL layer is the build plan's later answer | **mostly closed (step 7):** in a real window, panning and overview zoom at the target, 0 long tasks. Zooming in close is still at p95 about 33 ms: a known issue, fixed by the build plan's phase 42 (the WebGL renderer). **Step 1:** main thread at 60 fps with 500 nodes, worst frame 33 ms, no long tasks |
| R3 | Frame times on CI aren't meaningful (no GPU, shared cores) | Laptop numbers decide; CI only catches large regressions | **closed (step 7):** `PERF_REAL=1` on the laptop decides; CI's `perf` job runs it headless with loose limits |
| R4 | Laptop: Chromium in the performance test | Light; checked every step | **closed (step 9):** all five checks ok in every step |

### Step 2.1 — Spike: React Flow and the panels under our CSP; 500 nodes (done by Claude, ADR 0020)

**Goal:** before building on two new libraries, prove they work under our Content-Security-Policy, and get a first measure of 500 nodes.

**Concepts:**
- **What our CSP blocks, and what it doesn't.**
  - `style-src 'self'` blocks `<style>` elements and `style="…"` attributes in markup.
  - It allows stylesheet files from our own origin, styles set from script (`element.style.x = …`, which is how React applies `style={…}`), and *constructed stylesheets* (`new CSSStyleSheet()`, `adoptedStyleSheets`).
  - So the question for each library is whether it creates style elements.
  - https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src
- **Main thread versus painting.**
  - `requestAnimationFrame` fires once per main-thread frame, so its timing shows JavaScript and layout.
  - The picture is painted later, by the compositor. In headless Chromium that happens in software, with no GPU.
  - A page can tick at 60 fps on the main thread and still paint slowly. Long tasks (`PerformanceObserver` `longtask`, over 50 ms) show main-thread blocking.
  - https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming
- **Release age.** For a dependency that publishes daily, take a release that has been out for a while: it has had time to be reported if broken or compromised.

**What was done:**
1. Added `@xyflow/react` 12.12.0 (24 Sep) and `react-resizable-panels` 4.14.8 (20 Oct) to the catalog and the web app. Both are MIT, with no install scripts; React Flow brings `zustand`, `classcat` and `@xyflow/system`.
2. **Read their built code** for style injection:
   - React Flow: none in the ESM build. `innerHTML` appears only in its UMD builds, which Vite doesn't use.
   - The panels: constructed stylesheets only.
3. **A temporary spike page** (`#spike`, never committed): 500 `FlowNode`s in React Flow, with a minimap, controls and a dot grid, inside resizable panels. It was built, then checked by Playwright under the production headers.

**Results:**
- **CSP violations: none. Console errors: none.** React Flow's own stylesheet loads (the minimap is positioned).
- **Frames:**

  | Fast pan and zoom (300 moves, 40 wheel steps) | Median, p95, worst frame | Long tasks | Input time |
  | --- | --- | --- | --- |
  | 0 nodes | 16.7, 16.7, 16.8 ms | none | 6.4 s |
  | 500 nodes | 16.7, 16.8, 33.4 ms (60 fps) | none | 11.8 s |

  The main thread handles 500 nodes easily. The longer input time comes from Playwright waiting for each event to be painted, in software. Step 7 measures painting in a real window with a GPU.

**Gotchas:**
- **The try-it walkthroughs run with `slowMo: 500`** (half a second before each action, so the videos can be followed). The first timings measured that pause: 40 mouse moves took 20 s even on the plain projects page. Turn it off for anything timed.
- **A sorting script reordered the catalog.** Adding entries by sorting the whole list moved existing lines and dropped a blank line. Insert only the new lines, and check `git diff` shows just them.

**Docs:** this write-up; ADR 0020; risks R1 (closed) and R2.

**Risks:**
- R1 closed. R2: main thread proven, painting in step 7.
- **Laptop:** all five checks ok (24.1 GiB memory available, 578 GiB disk free, load 0.7).

**Commit:** `build(web): React Flow 12 and react-resizable-panels, checked under the CSP (ADR 0020)`

### Step 2.2 — The project page and the shell skeleton (done by Claude)

**Goal:** a project opens on its own page, `/p/<id>`, and the page is laid out exactly at Figma 06's sizes, proven by a test that measures every region.

**Concepts:**
- **Client-side routing with the History API.**
  - `history.pushState` changes the address without a reload, and the `popstate` event fires on back and forward.
  - A link keeps a real `href`, so it can still be opened in a new tab, copied, or announced as a link; only a plain left click is handled in the page.
  - Cloudflare (`not_found_handling: single-page-application`) and `vite preview` serve `index.html` for any path, so a reload at `/p/<id>` works.
  - Two routes don't justify a routing library (ADR 0020).
  - https://developer.mozilla.org/en-US/docs/Web/API/History/pushState
- **Landmarks.** The shell's regions are `header` (banner), `nav` ("Tools"), two `aside`s ("Left panel", "Right panel"), `main` ("Canvas") and `footer` ("Review"), so screen-reader users can jump between them. https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/
- **Layout from tokens.** A CSS grid whose tracks are tokens: `size.bar` (40), `size.rail` (44), and new `size.panel.left` (248), `size.panel.right` (360) and `size.panel.review-open` (300), added to `packages/tokens/source/base.tokens.json` and generated, never typed into components (rule 9).
- **Loading the canvas only when needed.** The project page is loaded with `React.lazy`, so React Flow (step 5) never weighs down the projects list.

**Files:**

| File | What it is |
| --- | --- |
| `apps/web/src/routing/route.ts` | `parseRoute`, `useRoute`, `navigate`, `linkTo`, `projectPath` |
| `apps/web/src/shell/Shell.tsx`, `.module.css` | The five regions as landmarks, at token sizes (step 4 makes the sides resizable) |
| `apps/web/src/project/ProjectPage.tsx`, `.module.css` | Loads the project, then shows the shell. "Opening the project…", "There's no such project, or it isn't yours.", or the API's reason (signed out), each with a way back. Honest empty states (`EMPTY`). The workspace chip only where workspaces can run |
| `apps/web/src/App.tsx` | Picks the page from the route (`Home`, `ProjectPage`, `NotFound`) |
| `apps/web/src/projects/Projects.tsx` | Each project's name links to its page (the row's **Open** still starts the workspace) |
| `packages/tokens/source/base.tokens.json` (+ generated) | `size.panel.left`, `size.panel.right`, `size.panel.review-open` |

**Tests:**
- **Router (5):**
  - the routes, and anything else not found (including a malformed address)
  - a project address parses back to the same project
  - links, back and forward without reloading
  - a link has a real `href`, and a plain click stays in the app
- **Project page (5):**
  - loading, then all six landmarks and the chip
  - the honest empty states
  - no chip where workspaces can't run
  - a missing project, with a way back
  - signed out, with the API's reason
- **Walkthrough (`phase-2.spec.ts`):**
  - the name in the list opens the page
  - **every region's position and size equal Figma 06's at 1440 × 900 and 1280 × 800**
  - a reload lands on the same page
  - no page errors or CSP violations

**Run and check it:**
```fish
pnpm test        # 607 tests
pnpm test:e2e    # 11 walkthroughs (1 needs a real API and runs in CI only), including "phase 2: a project opens in the app shell…"
pnpm dev         # then click a project's name on http://localhost:5173
```

**Gotchas:**
- **`eslint --fix` after Prettier can leave formatting off.** Run Prettier last, and `pnpm format:check` before committing.

**Docs:** this write-up; STATUS.

**Risks:**
- **Laptop:** all five checks ok (24.1 GiB memory available, 578 GiB disk free; the load read 11.6 just after the full suite, under the 14.4 limit).

**Commit:** `feat(web): a project's own page in the app shell, at Figma 06's sizes`

### Step 2.3 — The shell's components in the design system (done by Claude)

**Goal:** the shell's pieces exist as design-system components, with every state in the catalogue and checked in both themes, before any screen uses them (CLAUDE.md, "components first").

**What's new** (`packages/ui`, catalogue section "Shell"):

| Component | Figma 06 | Notes |
| --- | --- | --- |
| `TopBar` | 40 px, 0/12 px padding, 12 px gaps | `start` (project, branch), `middle` (view switch, centred), `end` (search, status, share, avatar) |
| `Rail`, `RailButton` | 44 px wide; 32 px buttons, radius 6, 18 px icons, 4 px apart | Tools at the top, Account and Settings at the bottom. A button's name is its accessible name and its tooltip; `aria-pressed` while its panel is open. Inactive icons in `text/tertiary` (icons are non-text) |
| `ReviewBar` | 40 px; pill tabs with count tags; caption summary; actions | No tabs before a session, just the summary ("No agent session yet."). The summary shortens with an ellipsis rather than wrap |
| `Tabs`: `segmented` | the view switch: raised track, 2 px inset, the selected item lifted | For Graph / Sequence / Code |
| `Tabs`: disabled items | — | `disabled` and `hint`: shown, never selected, skipped by the arrow keys. Same disabled treatment as the other controls (`--opacity-disabled`) |

**Concepts:**
- **The accessible name comes from the content.** A tab containing `<span>Changed</span><span>3</span>` is named "Changed3": nothing separates the words. A space between them (invisible in a flex row) makes it "Changed 3" for screen readers. This fixed every tab with a count; an old test had captured `Runs12` as correct and now says `Runs 12`. https://www.w3.org/TR/accname-1.2/
- **Toggle buttons for panels.** A rail tool is a button with `aria-pressed`: pressed while its panel is open. https://www.w3.org/WAI/ARIA/apg/patterns/button/
- **Text never in `text/tertiary`** (CLAUDE.md, tokens). It's for icons, edges and placeholders. So a disabled label uses its usual colour at `--opacity-disabled`, like the other controls.

**Tests:**
- **Unit (8 new):**
  - TopBar groups
  - Rail names, pressed state and clicks
  - ReviewBar empty (no tab list) and with tabs and actions
  - disabled tabs: hint, never selected, skipped by the arrows
  - counts named as words apart, in both variants
- **Visual:** 8 new baselines (TopBar, Rail, ReviewBar empty and after a session; both themes), checked by eye, with axe. No existing baseline changed.
  - *Caught by eye:* at 800 px the review bar's summary wrapped onto four lines and spilled out of the bar. Now it stays on one line and shortens.

**Run and check it:**
```fish
pnpm test                               # 614 tests
pnpm test:visual                        # 76 checks; the new ones start with "shell-"
pnpm --filter @flowcanvas/ui storybook  # Shell → TopBar, Rail, ReviewBar
```

**Docs:** this write-up.

**Risks:**
- **Laptop:** all five checks ok.

**Commit:** `feat(ui): TopBar, Rail and ReviewBar for the app shell; Tabs gains segmented and disabled items`

### Step 2.4 — Panels that collapse, resize and remember (done by Claude; ADR 0020 addendum)

**Goal:** every side region collapses and resizes, by mouse and keyboard; the canvas can go full screen; and your layout is remembered per browser, at exact pixel sizes.

**What you can do now** (on a project's page):
- **Rail:**
  - **Entry points** opens and closes the left panel.
  - **Terminal** opens the bottom dock (300 px). It shows the real terminal when the workspace runs; otherwise it says to open the workspace, or, on staging, that workspaces run locally.
- **Top bar:**
  - **Right panel** toggles the inspector.
  - **Full-screen canvas** collapses everything but the canvas, and **Leave full screen** restores exactly what was open.
- **Separators:**
  - Drag one to resize.
  - Or Tab to it and use the arrow keys: each is a keyboard splitter with a name, such as "Resize the left panel".
  - Panels stop at their limits: left 180–480 px, right 280–640, dock 120–600; the canvas keeps at least 320 px.
- **Review bar:** **Show review** opens it to 300 px, with its honest empty state.
- **Reload:** your sizes and what was open come back.

**Concepts:**
- **The window-splitter pattern.** A separator with `role="separator"`, a name, and a value, moved with the arrow keys. https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
- **`inert`.** A collapsed panel is `inert`: still in the page, but skipped by Tab and hidden from screen readers. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert
- **A context for the shell.** `useShell()` lets the rail and the top bar open and close regions without passing callbacks through every layer. Each panel's open state comes from its real size, so dragging one shut counts as closing it. https://react.dev/learn/passing-data-deeply-with-context
- **Pixels, not percentages** (ADR 0020 addendum):
  - The library saves percentages, so a saved 320 px panel would change width with the window.
  - So the shell saves pixels itself, and puts open panels back at their pixels when the window resizes.
  - `localStorage` is wrapped: blocked or broken storage just means the defaults.
- **Sub-pixel layout.** Browsers place boxes in 1/64 px units. Panels sized as flex proportions can be a sliver off a whole pixel, which is invisible, so the geometry test allows under 0.1 px.
- **Testing without layout.** jsdom does no layout and has no `ResizeObserver`, so the web tests get a stand-in that reports nothing (`src/test/setup.ts`). Sizes, dragging and keyboard resizing are tested in the browser.

**Files:**

| File | What changed |
| --- | --- |
| `apps/web/src/shell/Shell.tsx`, `.module.css` | Resizable groups (left, centre with canvas and dock, right); `useShell()`; the pixel layout and its storage; full screen; the review bar opening to 300 px; zero-width separators with an accent focus ring |
| `apps/web/src/project/ProjectPage.tsx`, `.module.css` | The top bar (`TopBar`, the view switch, status, panel and full-screen toggles), the rail (working tools only), the review bar, the dock (terminal or why not), panel headings |
| `packages/ui/src/components/rail/Rail.module.css` | The rail draws its own edge inside its 44 px (it measured 45 with the shell's border) |
| `tools/figma-tokens/src/render.ts`, `packages/tokens` | `baseValues`: theme-independent token values for code that needs numbers (`--size-panel-left: 248px`) |
| `apps/web/src/test/setup.ts`, `vite.config.ts` | The `ResizeObserver` stand-in for jsdom |
| `apps/web/package.json` | `@flowcanvas/tokens` and `lucide-react` used directly |

**Tests:**
- **Unit:**
  - the saved layout: defaults at Figma's sizes, read back, out-of-range or malformed entries, broken JSON, blocked storage
  - the page: the review bar's detail, only the views that exist, only working tools on the rail
  - the generator's `baseValues`
- **Walkthrough "panels collapse, resize by mouse and keyboard, and keep their layout"** (8 steps):
  - the rail collapses and reopens the left panel, and a collapsed panel is `inert`
  - the keyboard resizes it; dragging resizes it to 320 px
  - the right panel toggles
  - the dock opens with its message
  - full screen and back, exactly as before
  - the review bar opens to 300 and closes to 40
  - after a reload the left panel is still 320 px
- **Geometry:** every region within 0.1 px of Figma 06's sizes, at 1440 × 900 and 1280 × 800, including after the window resizes.
- **Visual:** the rail's two baselines (its edge), checked by eye. Nothing else changed.

**Run and check it:**
```fish
pnpm test        # 621 tests
pnpm test:e2e    # 11 pass (+1 that runs only in CI)
pnpm dev         # open a project: try the rail, the separators (drag, or Tab and arrows), full screen, reload
```

**Gotchas, all caught by the geometry test:**
- **The rail measured 45 px:** the component was 44 and the shell added a border. In Figma the stroke is inside, so now the component draws its own edge.
- **A collapsed panel measured 1 px:** its border can't shrink. Collapsed regions draw no edge.
- **Percentages in a pixel design:** see the ADR addendum.

**Docs:** this write-up; ADR 0020 addendum.

**Risks:**
- **Laptop:** all five checks ok.

**Commit:** `feat(web): shell panels collapse, resize by mouse and keyboard, and keep pixel layouts`

### Step 2.5 — The canvas (done by Claude)

**Goal:** a real canvas: pan, zoom, fit, selection, a minimap and a toolbar, with our `FlowNode` as its nodes, styled entirely from Graphite tokens. It stays honestly empty until the project is analysed; the Labs **Canvas stress test** fills it with 500 labelled example nodes.

**How it behaves** (Figma 06, and the design brief's interactions):

| Do | Result |
| --- | --- |
| Scroll | Pans |
| Ctrl or ⌘ + scroll, or pinch | Zooms (5% to 200%) |
| **Select (V)** and drag on the background | Selects a box of nodes; a click selects one |
| **Pan (H)**, or Space + drag with either tool | Moves the view |
| **F**, or the toolbar's Fit | Fits the selection, or everything if nothing is selected |
| Toolbar zoom out and in | Steps the zoom; the level shows between them |

- **Placement (Figma 06, over the brief):**
  - the toolbar bottom-centre, 16 px up
  - the minimap bottom-left, 20 px from the left and 16 from the bottom, 140 × 84 px
- **Nodes can be selected, not dragged or connected.** Flows come from the code (stage 1), not from drawing.
- **Empty:** "Flows appear here once the project is analysed.", with Fit disabled and no minimap.
- **The Labs switch "Canvas stress test"** shows 500 example nodes under a banner: "Canvas stress test (Labs): 500 example nodes, not your project's flows." Rule 10 allows mock data only in Labs, tests and the catalogue.

**Concepts:**
- **React Flow basics.** Nodes and edges are data. Node types are React components, here our `FlowNode`, and the viewport is a transform (x, y, zoom). Selection lives in the nodes, so React Flow must hold them (`useNodesState`): with nodes as plain props and no `onNodesChange`, a click selected nothing. https://reactflow.dev/learn/concepts/terms-and-definitions
- **Theming a library with tokens.** Only `@xyflow/react/dist/base.css` (layout) is imported. Every colour comes from React Flow's `--xy-*` variables, set to tokens on the canvas:
  - the dot grid in `border/subtle`
  - edges in `edge/default` at the new `border.width.edge` (1.25 px)
  - selection in the accent
  - the minimap in `border/strong`, with a translucent mask
- **Our own shortcuts.** React Flow's `useKeyPress` stopped reporting F after a box selection, found by the walkthrough and reproduced in isolation. The canvas listens for F, V and H itself (`isCanvasShortcut`): never while typing (inputs, text areas including the terminal's, editable text), and never with Ctrl, ⌘ or Alt, so ⌘F still searches the page.
- **A floating toolbar gets a shadow.** Graphite keeps shadows for things that float. The toolbar floats over the canvas, so it uses the popover shadow token, as Figma does.

**Files:**

| File | What it is |
| --- | --- |
| `apps/web/src/canvas/FlowCanvas.tsx`, `.module.css` | The canvas: `FlowNode` as the node type (invisible handles anchor edges), tools, zoom, fit, minimap, toolbar, empty state, banner; `isCanvasShortcut` |
| `apps/web/src/canvas/examples.ts` | 500 example nodes in a 25-column grid, each column a chain, all named `example…` |
| `apps/web/src/labs/flags.ts` | The first Labs switch: **Canvas stress test** (phase 2) |
| `apps/web/src/project/ProjectPage.tsx` | The project's canvas: empty, or the examples while the switch is on |
| `packages/ui/src/components/canvas-toolbar/` | `CanvasToolbar`, `ToolbarButton` (a tool with `aria-pressed`, or an action), `ToolbarDivider`, `ToolbarText`; story and test |
| `packages/tokens/source/base.tokens.json` | `size.minimap.width` / `height` (140 × 84), `border.width.edge` (1.25 px) |

**Tests:**
- **Unit:**
  - the example nodes: 500, chained, all examples
  - the banner's words
  - shortcuts: anywhere on the page, never while typing, never with modifiers or repeats
  - the toolbar's roles, pressed states and actions
  - Labs lists the switch, off by default
- **Walkthroughs (`phase-2.spec.ts`):**
  - *"the canvas is honest when empty"*: the message, Fit disabled, no minimap, no nodes
  - *"Try it: pan, zoom and select on the canvas"* (500 examples):
    - the banner
    - the minimap at Figma's place and size
    - zoom from the toolbar and with Ctrl + scroll; scroll pans without zooming
    - the Pan tool by its key
    - click and box selection
    - F fits the selection; Space + drag pans
  - no page errors or CSP violations
- **Visual:** the toolbar's 2 baselines, checked by eye. The canvas in both themes and the minimap were checked by eye too (see Gotchas).

**Run and check it:**
```fish
pnpm test        # 627 tests
pnpm test:e2e    # 13 pass (+1 that runs only in CI)
pnpm dev         # open a project; turn on Labs → Canvas stress test on the home page to see 500 examples
```

**Gotchas:**
- **Selection needs state.** Controlled nodes without `onNodesChange` can't be selected.
- **A wide graph fitted to the screen leaves empty bands** above and below. A test's box selection must start next to the nodes, not in the band.
- **Caught by eye:** the minimap looked empty. Its mask (opaque) covered the nodes, and they were nearly the panel's colour. Now the mask dims instead of hides, and the nodes use `border/strong`.
- **Caught by the Figma check:** the minimap first sat 16 px from the left; Figma says 20.

**Docs:** this write-up; `docs/RUN-AND-FEATURES.md`.

**Risks:**
- **Laptop:** all five checks ok.

**Commit:** `feat(web): the canvas — pan, zoom, fit, selection, minimap and toolbar, from tokens`

### Step 2.6 — The workspace in the top bar, and a dock that follows it (done by Claude)

**Goal:** the project page shows the workspace's real state everywhere, and acts on it from the top bar. Every region holds real content or an honest empty state.

**What's new:**
- **The top bar's chip opens a popover** (brief 29: "click for machine size, uptime … and Sleep now"; Figma 37's workspace popover):
  - **Facts:**
    - the status
    - the machine (2 cores · 4 GiB · this computer)
    - "Running since", "Asleep since" or "Stopped since"
    - this month's usage, read when it opens
    - a recorded reason, such as the guard's
  - **Actions for the state:** Open or Try again, Sleep now, Resume, Stop. A refusal shows the API's sentence.
  - **Left out, because they don't exist yet:** last backup (18a), region and "change where it runs" (48a).
  - Its accessible name says what it is, for example "Workspace: Running".
- **One workspace record for the page.** The chip, the popover and the dock follow it, with 1d's polling (3 s while changing, 30 s while running), so an idle sleep or the guard's change shows here without a reload.
- **The dock follows it:** a terminal while running; "Open the workspace to use a terminal here." otherwise; on staging, that workspaces run locally.

**Concepts:**
- **Lifting state up.** The workspace's state moved from the chip into `ReadyProject`, which owns `useWorkspace()` and passes it down, so the top bar and the dock can't disagree. https://react.dev/learn/sharing-state-between-components
- **Modal popovers hide the page.** While a React Aria popover is open, everything outside it is hidden from screen readers, so a test can't find the chip by role until the popover closes. That's correct, and the test now closes it first.
- **A screenshot during an animation lies.** The first capture showed the right panel over the popover. It was the 240 ms fade-in, checked with `elementFromPoint` and a second capture: the popover is on top.

**Files:**

| File | What it is |
| --- | --- |
| `apps/web/src/project/WorkspacePopover.tsx`, `.module.css` | The chip as a popover trigger; the facts, the reason, the actions |
| `apps/web/src/project/ProjectPage.tsx` | `ReadyProject` owns the workspace state; the top bar, the popover and the dock use it |

**Tests:**
- **Unit (4 new):**
  - the facts, including this month's usage, with no backup, region or move
  - Sleep now: the request, the popover offering Resume, the chip saying Sleeping
  - the actions for a stopped workspace, with its reason
  - no chip on staging
- **Walkthrough (new):** the popover's facts; Sleep now, after which the chip says Sleeping and the dock says there's no shell; Resume from the popover, after which the dock connects a terminal. No page errors.
- **By eye:** the popover in both themes, settled.

**Run and check it:**
```fish
pnpm test        # 631 tests
pnpm test:e2e    # 15 walkthroughs (with pnpm dev running, the API-backed one runs too)
pnpm dev         # open a project: click the workspace chip in the top bar
```

**Docs:** this write-up; `docs/RUN-AND-FEATURES.md`.

**Risks:**
- **Laptop:** all five checks ok.

**Commit:** `feat(web): the workspace popover in the top bar; the dock follows the workspace`

### Step 2.7 — 500 nodes, measured on real hardware (done by Claude; ADR 0020 addendum)

**Goal:** prove the *Done when* "500 dummy nodes pan and zoom smoothly" where it counts, on a real screen with a GPU, and fix what the measurements show.

**The test** (`e2e/perf/canvas.perf.spec.ts`, its own config `playwright.perf.config.ts`, with no slow motion or recording since both distort timing):
- **Two scenes:** all 500 nodes on screen, and 100% zoom.
- **Three gestures each:** Space + drag to pan, scroll to pan, Ctrl + scroll to zoom.
- **Measured per gesture:**
  - frame times (median, p95, worst)
  - long tasks (main thread blocked over 50 ms)
  - the share of inputs taking over 16 ms to paint (Event Timing)
- **It records the GPU that drew it:** "Intel Arc", or SwiftShader headless.
- **Target (plan):** median 60 fps, p95 under 25 ms. Zooming in close has its own **named** limit (p95 under 60 ms), recorded as a known issue rather than hidden.
- **Run:**
  - `PERF_REAL=1 pnpm test:perf`: real window, on the laptop
  - `pnpm test:perf`: headless
  - CI's new `perf` job runs headless, regressions only

**Concepts:**
- **Frames versus painting versus input.**
  - `requestAnimationFrame` shows the main thread's frames.
  - Long tasks show the main thread blocked.
  - Event Timing shows input to the next *painted* frame, which is what a person feels.
  - The browser reports only inputs over a threshold, so the test also counts every input and reports a *share*: a p95 of two slow events is just their maximum.
  - https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming
- **Refresh steps.** On a 120 Hz screen, frame times come in steps of 8.3 ms (8.3, 16.7, 25.0, 33.3). So "p95 25.0 ms" means a frame missed two refreshes.
- **Re-renders are the first suspect.** A component that reads the viewport re-renders on every frame of a pan, and fresh option objects make the library redo work.
- **Level of detail.** At low zoom, text can't be read, so don't paint it.

**Measured** (all 500 nodes, 1440 × 900; median / p95 frame in ms):

| | Before (step 5 code) | After, run 1 | After, run 2 |
| --- | --- | --- | --- |
| All on screen, the three gestures | p95 50, **60 long tasks** | 8.4 or 16.7 / 16.8–25.0, 0 long tasks | 8.3–8.4 / 8.4–16.8, 0 long tasks |
| 100%: drag and scroll to pan | p95 42, 25 long tasks | 16.6 / 20.8–21.0, 0 long tasks | 8.3 / 8.4–16.6, 0 long tasks |
| 100%: zoom closer | (in the line above) | 16.7 / **33.3**, 0 long tasks | 8.4 / **33.3**, 0 long tasks |

- Run 1 failed the 25 ms bar on one gesture at exactly 25.0 ms (load from other apps; the bar wasn't widened).
- Run 2 met the target in every gesture but close zoom.
- Under 1% of inputs took over 16 ms to paint.
- Headless (software rendering) was 60 fps with p95 16.7–16.8 everywhere; the limits there only catch large regressions.

**What changed** (ADR 0020 addendum, with what was tried and rejected):
- The canvas doesn't re-render while the view moves: only `ZoomControls` reads the viewport, and React Flow's options are constants.
- Level of detail below 40% zoom (`data-detail="low"`, CSS only): nodes paint as shapes, and screen readers still read them.
- Only visible nodes are rendered.

**Known issue (fixed by the build plan's phase 42, the WebGL renderer with level of detail):** zooming in close is at about 33 ms p95. The GPU redraws node text at each zoom step, the DOM's limit and the case for the build plan's WebGL layer.

**Files:** `e2e/perf/canvas.perf.spec.ts`, `e2e/playwright.perf.config.ts`; `apps/web/src/canvas/FlowCanvas.tsx` (`ZoomControls`, `DetailLevel`, the constants); `packages/ui/src/components/flow-node/FlowNode.module.css` (level of detail); `.github/workflows/ci.yml` (job `perf`); `test:perf` scripts.

**Run and check it:**
```fish
PERF_REAL=1 pnpm test:perf   # opens a Chromium window for about 30 s; numbers in the output and e2e/reports-data/canvas-perf.json
pnpm test:perf               # headless, as on CI
```

**Gotchas:**
- **Measure the right thing.** `requestAnimationFrame` alone hid painting, and a p95 of two slow events was meaningless. Count all inputs.
- **Measure gestures separately.** The combined number hid that panning was fine and only close zoom wasn't.
- **Runs vary with what else the laptop is doing.** Run twice and report both.

**Docs:** this write-up; ADR 0020 addendum; risks R2 and R3; `docs/RUN-AND-FEATURES.md`.

**Risks:**
- **Laptop:** all five checks ok. The real window was opened with the owner's approval.

**Commit:** `perf(web): 500 nodes pan and zoom smoothly — measured on real hardware`


### Step 2.8 — Baselines, the Try it walkthrough, and the Figma 06 differences list (done by Claude)

**Goal:** prove "the layout matches Figma 06" three ways: geometry (already tested since step 2), approved screenshots of the screens in both themes, and a list of every difference from Figma 06 for the owner to review by eye (decision A5).

**What was added:**
- **Screen baselines** (`e2e/visual/screens.spec.ts`): the project page from the production build, with a fake API, a fixed clock, locale and time zone, in both themes. Each is pixel-compared and checked with axe:
  - empty project, at 1440 × 900 and 1280 × 800
  - the Labs stress test (500 example nodes)
  - the review open
  - the full-screen canvas
  - the workspace popover
- **The visual config has two projects:** `catalogue` (Storybook, as before) and `screens` (the web app's `vite preview`, with the production CSP). `pnpm test:visual` builds both first. CI's job keeps its name, "Visual and accessibility (catalogue)", because main's ruleset requires a check by that exact name (renaming it blocked the merge of PR #15 until it was put back).
- **The differences list:** `docs/reports/phase-2-figma-06-differences.md`, with Figma 06 and our screenshots in `docs/reports/phase-2/`.
- **The Try it walkthrough** (`e2e/try-it/phase-2.spec.ts`, from steps 2 to 6) is recorded on every run: pan, zoom, select, collapse every panel, restore, reload with the layout kept.

**Found and fixed: the theme didn't follow you onto a project's page.** The theme preference was applied by the projects list only, so a project's page showed the system theme even if you'd chosen dark or light. It's now applied at the app's root, with a unit test that failed before the fix ("applies the chosen theme on a project's page too").

**Concepts:**
- **Screens need a frozen world.** A screenshot is pixel-exact only if nothing varies: `page.clock.setFixedTime` for "Asleep since", a fixed `locale` and `timezoneId` for date formats, a fake API, and a wait until React Flow's fit animation stops. https://playwright.dev/docs/clock
- **Baselines catch change; they don't prove a match.** A baseline is what we approved, not Figma. The match with Figma is the geometry test plus the owner's review against the differences list.
- **Several web servers in one config.** Playwright's `webServer` takes a list, and each project gets its own `baseURL`. https://playwright.dev/docs/test-webserver#multiple-web-servers

**Found in Figma:** on Figma 06 only, the review bar is at the top (y 40). Every other screen, the generator script and the brief put it at the bottom, which is what's built. **Owner, 7 Nov: it stays at the bottom** (decisions log).

**Run and check it:**
```fish
pnpm test:visual          # 90: 78 catalogue stories and 12 screens, in Playwright's Docker image
pnpm test:e2e             # 15 walkthroughs, recorded (videos in e2e/test-results)
```
Then open `docs/reports/phase-2-figma-06-differences.md` and compare `docs/reports/phase-2/figma-06.png` with `built-empty-dark.png`.

**Results:**
- `pnpm test`: 632 passed (631 and the theme test)
- `pnpm test:visual`: 90 passed (78 catalogue, 12 screens), axe clean
- `pnpm test:e2e`: 15 passed
- lint, typecheck and format clean

**Docs:** this write-up; the differences list; the decisions log (close zoom accepted as a known issue); RUN-AND-FEATURES.

**Risks:**
- R4 (laptop): all five checks ok. The visual run uses one Docker container, which is removed when it ends.

**Commit:** `test(visual): the project page's screens in both themes; Figma 06 differences; the theme follows you onto a project`

### Step 2.9 — Close the phase: report, 0.6.0, the two due upgrades, PR (done by Claude)

**Goal:** finish phase 2 so it can be reviewed and accepted: the two upgrade-later items that were due, the report, the release, and the pull request.

**Upgrade-later 4, the web app's TypeScript settings split:**
- `apps/web/tsconfig.json` is now a **solution file** that only lists three projects:
  - `tsconfig.app.json`: the browser code. DOM and Vite's types, **no Node**, tests excluded.
  - `tsconfig.node.json`: `vite.config.ts`, `scripts/`, and the changelog parser they share with the app. Node, no DOM.
  - `tsconfig.test.json`: all of `src` with Node too, because tests run in Node under Vitest (one reads `CHANGELOG.md` from disk).
- `pnpm typecheck` runs `tsc -b --noEmit`, which checks all three. Each needs `composite` (required for project references) and keeps its build info in `node_modules/.cache`.
- **Proven:** a throwaway `process.env.HOME` in browser code fails the typecheck ("Cannot find name 'process'"). Under the old settings it passed, because Node's types applied everywhere.
- **Concept, project references:** one folder, several sets of rules, each file checked under the rules of where it runs. ESLint's project service and Vite both understand the solution file. https://www.typescriptlang.org/docs/handbook/project-references.html

**Upgrade-later 18, the bundle-size budget:**
- `apps/web/scripts/bundle-size.ts` (run with `pnpm size` after a build), with no new dependency:
  - **first load** is what `dist/index.html` loads: its script, preloads and stylesheets
  - each **lazy chunk** is counted by name: the project page, the terminal
  - everything is measured gzipped, as a browser downloads it
- Budgets are set about 10% above today's sizes: first load 149.4 kB of 160 (with 0.6.0's changelog in it), the project page 82.3 of 95, the terminal 86.0 of 95.
- Over budget, it fails and names the part. To raise a budget, change it in the script, in the same commit, and say why.
- **CI** runs it after the build, and writes the table to the job's summary page.
- **Proven:** with the project page's budget set to 50 kB, it failed with exit 1, "Over budget: ProjectPage".

**Release:** `0.6.0` in `package.json` and `CHANGELOG.md` (What's new shows it); `docs/reports/phase-2.md`; `docs/STATUS.md` says "in review".

**Phase 2 — run and check it (fresh clone):**
```fish
git clone https://github.com/ArmaanAhuja/Flowcanvas && cd Flowcanvas
corepack enable && pnpm install
cp .dev.vars.example .dev.vars          # then fill in your own values (never paste them anywhere)
pnpm db:status && pnpm db:migrate       # must say the dev branch
pnpm dev                                # http://localhost:5173
```
1. Sign in and click a project's name: its page opens at `/p/<id>`. Compare it with `docs/reports/phase-2/figma-06.png`.
2. **Labs → Canvas stress test:** 500 example nodes and a banner saying they're examples.
3. Scroll to pan, Ctrl + scroll to zoom, **F** to fit; click or drag a box to select.
4. Collapse the panels from the rail and the top bar, and try full screen. Drag a panel's edge. Reload: the layout is kept.
5. Click the workspace chip; open the workspace, then **Terminal** in the rail.

**What proves it:**
```fish
pnpm test               # 632
pnpm test:e2e           # 15 walkthroughs, recorded; phase 2's five among them
pnpm test:visual        # 90 screenshots and axe, in Playwright's Docker image
PERF_REAL=1 pnpm test:perf   # the 500 nodes in a real window (opens a browser for about 30 s)
pnpm size               # after pnpm build: the bundle budgets
```

**Risks, closed:**
- R2 is accepted with a known issue: close zoom, fixed by phase 42 (owner, 7 Nov).
- R4 (laptop): all five checks ok throughout.

**Commit:** `chore(release): phase 2 report, 0.6.0, in review; web TypeScript split and bundle budget`

**Found at the PR:** the headless `perf` job failed on CI with `ENOENT: reports-data/canvas-perf.json`. That folder is git-ignored, so it existed on the laptop but not on a fresh checkout. The test now creates it (`mkdirSync`, recursive), checked by running it with the folder removed. **Gotcha:** a test that writes files must create their folders, because CI starts from a clean clone.

**Commit:** `fix(e2e): the performance test creates its results folder, missing on a fresh checkout`

**Found at the merge:** GitHub refused the merge ("the base branch policy prohibits the merge") with every check green. Main's ruleset requires checks **by job name**, and step 8 had renamed the visual job, so the required one never reported. The name is back, with a comment in `ci.yml`. **Gotcha:** renaming a required CI job needs the ruleset changed in the same go (Settings → Rules).

**Commit:** `fix(ci): keep the visual job's name, a required check on main`

## Phase 3 — Open a repo and edit

**From the build plan:**
- **Build:** CodeMirror 6 in the browser (the plan said Monaco; ADR 0021) with the buffer synced to the workspace; tabs, save, undo, quick-open; autosave journal every few seconds; file watcher.
- **Done when:** edits survive closing the tab and reopening; an edit made in the terminal appears in the editor.
- **Try it:** edit a file in Rallly, close the tab, reopen it: the change is still there.

**Owner decisions (7 Nov 2026, decisions log):**
- **Saving:** Ctrl/⌘+S at once; autosave after 5 s without typing and on switching file, leaving the view or the window losing focus; the journal every 2 s and on hiding the tab; an "Autosave: on/off" switch, on by default.
- **The Code view** (Figma 11); the editor card on the canvas is phase 7.
- **Syntax highlighting only;** no error count until phase 33.

**Expected outcome:** on a project's page, the **Code** switch opens the Code view, laid out like Figma 11:
- a file tree in the left panel
- tabs, with a dot on unsaved files
- a breadcrumb, the editor, and a status bar (line and column, indentation, encoding, language, autosave)
- **Ctrl/⌘+S** saves, **Ctrl/⌘+P** opens a file by name, undo works, and autosave catches what you forget
- close the browser tab mid-edit and reopen it: your changes are there
- `sed` in the terminal: the open file updates in front of you

**Concepts this phase introduces** (each gets a primer in its step):
- CodeMirror 6: state, views, transactions and extensions: https://codemirror.net/docs/guide/
- Shadow DOM, where each editor lives so its styles stay within our CSP: https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM
- Content-Security-Policy for styles and workers: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
- File watching with inotify, and its limits: https://man7.org/linux/man-pages/man7/inotify.7.html
- Optimistic concurrency (versioned writes): https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests
- IndexedDB, for the browser's copy of the journal: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- Saving when a page goes away (`visibilitychange`, `pagehide`, `fetch` with `keepalive`): https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API

**Scope:**
- **In:** the Code view; the file tree; CodeMirror 6 with syntax highlighting; tabs, save, undo, quick-open; autosave and the journal; the file watcher and changes on disk; honest states (binary, too large, secret file, workspace asleep).
- **Out:** language servers (phase 33); global search (phase 4); the editor card on the canvas (phase 7); git markers and the git panel (phase 34); inline agent diffs (stage 3); split view; backups and restore history (phase 20a).

### Steps (planned)

| # | Step | Status |
| --- | --- | --- |
| 0 | Record the decisions; this plan; branch | done (Claude, 7 Nov) |
| 1 | Spike: an editor under our CSP, and its size (Monaco, CodeMirror 6 and Ace compared; CodeMirror 6 chosen); the watcher's cost with Rallly's `node_modules`. ADR 0021 | done (Claude, 7 Nov) |
| 2 | Agent: file list, versioned read and write, conflicts, journal operations | done (Claude, 7 Nov) |
| 3 | The watcher and the events channel: agent → host → control plane WebSocket | done (Claude, 7 Nov) |
| 4 | UI components: EditorTabs, FileTree, StatusBar, Breadcrumb (catalogue and baselines) | done (Claude, 8 Nov) |
| 5 | The Code view: tree, CodeMirror in a shadow root, tabs, save, undo; binary, large and secret states; canvas shortcuts through shadow roots | done (Claude, 8 Nov) |
| 6 | Saving: autosave, the journal (workspace and IndexedDB), restore on reopen | done (Claude, 8 Nov) |
| 7 | Changes on disk (reload or banner) and quick-open | done (Claude, 8 Nov) |
| 8 | Walkthrough, screen baselines, Figma 11 differences, editor bundle budget | done (Claude, 8 Nov) |
| 9 | Close: report, 0.7.0, PR | done (Claude, 8 Nov) |

### How each Done-when item is proven

| Item | Test |
| --- | --- |
| Edits survive closing the tab and reopening | Docker test: the journal written and read back in a real container. Walkthrough: type, close the page, open a new one, the text is back |
| An edit made in the terminal appears in the editor | Docker test: `sed -i` in a real container produces a watcher event with the new version. Walkthrough: the event updates a clean buffer; an unsaved one shows "Changed on disk" |
| Tabs, save, undo, quick-open, autosave | Component and unit tests; walkthrough |
| Never lose work | Unit tests: save failures, workspace asleep, the IndexedDB fallback |
| Secrets | Canary: a `.env` never appears in the tree, quick-open, the journal or events |
| Looks like Figma 11 | Screen baselines in both themes, axe, and the differences list |

CI's walkthroughs use a fake workspace (staging has none until upgrade-later 33); the real-container half is proven by Docker tests and by the owner on `pnpm dev`, as in 1d.

### Risks (checked at every step)

| # | Risk | How we keep it in check | Status |
| --- | --- | --- | --- |
| R1 | The editor breaks our CSP | Step 1 spike before anything is built on it | **closed (step 1):** Monaco needed `style-src-attr 'unsafe-inline'`; CodeMirror 6 in a shadow root has 0 violations under the unchanged policy (owner chose it, ADR 0021). Step 5's walkthrough fails on any violation |
| R2 | The editor's size | Lazy chunk with its own budget; only the languages a web project needs | **mostly closed (step 1):** CodeMirror 6 with TypeScript is 147 kB gzipped (Monaco 705). The budget is set in step 8 |
| R3 | **Laptop:** inotify's limit is shared with the whole computer; watching `node_modules` could exhaust it | Watch without `node_modules`, `.git` and build output; measure in the spike | **closed (step 3):** the watcher skips them; Rallly is 599 folders (0.1% of 524,288); a cap of 20,000 per watcher, with a visible error beyond it |
| R4 | Lost edits (disconnect, sleep, closed tab) | Journal every 2 s and on page hide, an IndexedDB copy, tests for each case | **closed (step 6):** two copies (the workspace, every 2 s and on close; the browser, within 300 ms), restore on open, autosave; the Try it walkthrough proves it |
| R5 | Silent overwrites when disk and editor disagree | Versioned writes; conflicts shown, never resolved silently | **closed (step 7):** saves never overwrite an unseen change; changes never replace unsaved text; the person chooses (Keep mine, or Load the workspace's version); tested both ways, mutation-checked |

### Step 3.1 — Spike: which editor, under our CSP; and the watcher's cost (done by Claude; ADR 0021)

**Goal:** before building on an editor, prove it runs under our Content-Security-Policy and is light enough for many editors on the canvas; and measure what a file watcher costs on the owner's laptop.

**Concepts:**
- **Content-Security-Policy (CSP):** a header that tells the browser what a page may load and run. Ours allows scripts, styles, images, fonts and connections only from our own site, and no inline code or styles. It's our main defence against cross-site scripting: even if an attacker's text slipped into the page as HTML, it couldn't run. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP
- **`style-src-elem` versus `style-src-attr`:** `<style>` elements and `style="…"` attributes are checked separately. Setting `element.style.top` from a script (the CSS object model) and constructed stylesheets (`new CSSStyleSheet()`, `adoptedStyleSheets`) are allowed, because only our own scripts can do them.
- **Shadow DOM:** a separate DOM tree attached to an element. Styles inside don't leak out, page styles don't leak in, and CSS variables and fonts still pass through. https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM
- **inotify:** how Linux reports file changes. One watch per folder, from a pool shared by the whole computer. https://man7.org/linux/man-pages/man7/inotify.7.html

**What happened:**
1. **Monaco** (the plan's choice) under our policy: broken, with 70 violations. Routing its `<style>` elements into constructed stylesheets and loading its worker from our own site removed all but the `style="…"` attributes, which it puts on every line it draws (`viewLine.js:135`, via `innerHTML`). It only worked with `style-src-attr 'unsafe-inline'`. That needed the owner's decision.
2. **The owner:** "it's not necessary to be fixated on one or make it look like VS Code; explore what's best suited for us."
3. **Monaco, CodeMirror 6 and Ace** were compared on the same tests under the unchanged policy (figures in ADR 0021). CodeMirror 6 had 0 violations with each editor in a shadow root (its styling library only uses constructed stylesheets there), was about a fifth of Monaco's size, used a third of its memory for 21 editors, and typed fastest.
4. **The owner chose CodeMirror 6** and asked for the replacement to be complete:
   - Monaco and Ace are removed from the dependencies (none left in the lockfile).
   - The CodeMirror packages we use are in the catalog, all MIT.
   - CLAUDE.md, the build plan, the decisions log, this plan and RUN-AND-FEATURES say CodeMirror 6. The research report and ADR 0002 carry dated notes.
5. **The watcher:** Rallly's code is 599 folders (0.1% of the laptop's 524,288 inotify watches), and `node_modules` must be skipped. `sed -i` was noticed in a median of 3.6 ms in a workspace container. Watch folders, not files.

**Gotchas:**
- **`style-mod` only uses constructed stylesheets in a shadow root.** On the main document it writes a `<style>` element, which our CSP blocks, and the editor looks unstyled with just one violation reported.
- **Events from inside a shadow root are retargeted.** A `window` listener sees the host element as `event.target`, so the canvas shortcuts must look at `event.composedPath()[0]` (step 5, with a test).
- **Spike measurements are headless (software rendering):** they compare the editors with each other; they aren't real-world times.

**Risks:**
- R1 and R2 are closed or mostly closed (see the table).
- R3 (inotify) is understood: watch without `node_modules`.
- **Laptop:** all five checks ok. Two measuring containers ran read-only, with no network, labelled `org.flowcanvas.role=measure`, and were removed. The sleeping workspace wasn't touched.

**Commit:** `build(web): CodeMirror 6 replaces Monaco as the editor, checked under the CSP (ADR 0021)`

### Step 3.2 — The workspace agent: file list, versions, conflict-safe saves, the journal (done by Claude)

**Goal:** give the editor what it needs from the workspace, before any editor code exists: a list of the project's files, a version with every read and save so nothing is silently overwritten, and a journal that keeps unsaved changes safe in the workspace.

**Agent protocol 2** (`workspace/agent/src/protocol.ts`; the host copies the agent in on every connection, so the host and agent always match):

| Operation | What it does |
| --- | --- |
| `files` | Every file of the project, from `git ls-files` (tracked and untracked, not ignored, not deleted), or a walk that skips `node_modules`, `.git` and build output when it isn't a repository. Never `.env` files. Up to 50,000 |
| `read` | As before, plus `version`: the SHA-256 of the bytes |
| `write` | As before, plus `version`. With `baseVersion` it's conflict-safe: refused with `conflict` if the file isn't that version any more. `null` means the file mustn't exist yet |
| `journal-put` | Keeps an unsaved buffer (with the version it was edited from and a rising `revision`); an older revision never replaces a newer one |
| `journal-list`, `journal-get` | What's unsaved, and the content |
| `journal-drop` | Removes an entry after a save, unless it has newer edits than that save |

**Where the journal lives:** `/workspace/.flowcanvas/journal`, in the workspace's volume (so it survives sleep, stop and start) but outside the project, so git, the dev server and the file list never see it. One file per buffer, named by a hash of its path, written whole and renamed into place, with mode 600 in a 700 folder.

**Control plane routes** (`services/control-plane/src/workspaces/file-routes.ts`), owner only, while running, same-origin for changes:
- `GET /tree`
- `PUT /file` with `baseVersion` (a conflict answers **409**)
- `GET /journal`
- `GET`, `PUT` and `DELETE /journal/entry`

The logs record the operation and outcome only, never paths or content (tested with a canary).

**Concepts:**
- **Optimistic concurrency.** Instead of locking a file while you edit, remember which version you started from, and refuse the save if it changed. HTTP does the same with `If-Match`. https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests
- **Content hashes as versions.** The same bytes always give the same SHA-256, so a version means "exactly this content", whatever the clock or the file system says.
- **Write, then rename.** `rename()` replaces a file in one step, so a crash leaves the old entry or the new one, never half of one.
- **Serialising per key.** Two saves of the same file at once could both pass the version check. The agent runs them one after the other, so exactly one wins (tested).

**Tests:**
- **Agent (34, 16 new):** versions; conflicts after a change, a new file and a deletion; two saves from one version where exactly one wins; the file list with and without git; the journal (restart, revisions, drops, limits, damaged entries, secrets, paths).
- **Mutation-checked:** removing the conflict check fails 4 tests, and each revision guard fails its own.
- **Routes (3 new):** the operations each route sends, 409 for a conflict, same-origin and malformed requests refused, the journal never logged.
- **Docker (3 new, in a real Rallly workspace):**
  - the file list comes from git and has no `.env`
  - **a `sed -i` in the terminal makes a save from the old version fail, keeping the terminal's change**
  - the journal is outside the project (git doesn't see it), mode 600, and survives the workspace stopping and starting

**Results:** `pnpm test` 651 passed; `pnpm test:docker` 45 passed; lint and typecheck clean.

**Gotchas:**
- **The control plane reads the agent's protocol from `dist/`.** After changing `protocol.ts`, build the agent (`pnpm --filter @flowcanvas/workspace-agent build`); turbo does this before tests in CI.
- **Tests with the protocol version written in as a literal broke on the bump.** They use `AGENT_PROTOCOL` now.
- **Narrowing by a field name.** `'entries' in result` stopped meaning "a folder listing" once the journal list also had `entries`; TypeScript caught it.
- **One Docker run left `fc-test-*` containers behind.** A clean full run afterwards left none. To watch; `pnpm workspace:clean` removes them, and nothing else.

**Risks:**
- R4 (lost edits): the journal exists and is proven to survive a restart.
- R5 (silent overwrites): conflict-safe saves exist and are proven against a terminal edit.
- **Laptop:** all five checks ok. The Docker runs used test workspaces only, and your sleeping workspace wasn't touched.

**Commit:** `feat(workspace): file list, versioned conflict-safe saves and the journal (agent protocol 2)`

### Step 3.3 — The file watcher, and its channel to the page (done by Claude; ADR 0022)

**Goal:** an edit made anywhere in the workspace (the terminal, another tab, later an agent) reaches the page within a moment, so the editor can show it (step 7). This is the workspace half of the *Done when* "an edit made in the terminal appears in the editor".

**How it fits together:**

| Hop | What | File |
| --- | --- | --- |
| Watcher | `main.js --watch`: watches the project's folders (not `node_modules`, `.git` or build output), reports `ready`, `changed` (path, deleted, new version), `overflow` and `error`; never `.env` files | `workspace/agent/src/watch.ts` |
| Host | `host.watch(ref)` starts one per open page (4 at most per workspace) and ends them when the workspace stops; `/v1/workspaces/:ref/events` relays checked events; when the page goes, stdin is ended and the process killed after 2 s | `workspace/host/src/workspaces.ts`, `events.ts`, `server.ts` |
| Control plane | `GET /api/projects/:id/workspace/events` (same-origin, owner only): checks each event again and sends it on; nothing goes the other way; **not activity** | `services/control-plane/src/workspaces/events-routes.ts` |

**Concepts:**
- **inotify, folders not files.** Linux reports changes per watched folder. Watching a file breaks when a program replaces it (`sed -i`, most editors' "atomic save"), because the watch follows the old file. https://man7.org/linux/man-pages/man7/inotify.7.html
- **Coalescing.** One save can raise several notifications. The watcher waits 50 ms, then reports each path once, and only if its content really changed.
- **Overflow.** A `git checkout` or `pnpm install` can change thousands of files. Past 500 at once, the watcher sends one `overflow` and quietly catches up, and the page reloads what it shows.
- **Defence in depth.** The workspace runs code we don't control, so its events are checked twice (host and control plane) before a page trusts them: relative paths only, never `..`, ignored folders or secret files, well-formed versions.
- **Cost.** A page left open mustn't keep a workspace awake (CLAUDE.md section 7), so the events channel never counts as activity.

**Measured (Docker test, a real Rallly workspace):** watching **599 folders**. `sed -i` to the event arriving at the page's socket: **162 ms**, about 100 ms of which is Docker starting `sed`.

**Tests:**
- **Watcher (11 new):**
  - edits, the `sed -i` style replace (twice), new and deleted folders
  - silence for `.env`, `node_modules` and same-content rewrites
  - a large file without a version; overflow, then keeping up; too many folders
  - the event checker refusing every misleading event
  - mutation-checked: removing the secret filter or the dedupe fails its test
- **Host (6 new):** events relayed and bad lines dropped (logged once, never the line); the watcher ended when the page closes and the page closed when the watcher ends; refusals; the cap of 4, asleep, stopped, and ended on stop.
- **Control plane (9 new):** events checked and relayed one way; not activity; both sides closed; logs without file names; owner, same-origin and WebSocket only; the local host's upgrade with the token.
- **Docker (1 new, the Done-when half):** `sed -i` produces the right event with the right version, `.env` and `node_modules` stay silent, and **no watcher is left after the page closes**. The check is shown to find the watcher while the page is open, so its silence afterwards means something.

**Results:** `pnpm test` 677 passed; `pnpm test:docker` 46 passed, with no test containers left; lint and typecheck clean.

**Gotchas:**
- **`pgrep -f "main.js --watch"` matched itself.** The pattern is also in the command line of the `sh -c` running pgrep, so the watcher looked like it was still running. Match from the start (`^node /tmp/…`), and prove the check can see the process while it runs.
- **Copying the agent in is now atomic** (write, then rename). The request agent and a watcher can be copied in at the same moment, and neither may start from a half-written file.
- **Prettier reflows code, so text-based edit scripts miss.** An edit that silently didn't apply made a rerun prove nothing; it was caught by checking the script's result. For code, edit exact lines read from the file.

**Risks:**
- R3 (inotify): closed for Rallly, at 599 folders and a cap of 20,000 per watcher with a visible error beyond it.
- **Laptop:** all five checks ok (load 12.3 of 14.4 right after a unit-test run, so the heavy suites ran one at a time). Test workspaces only; nothing was left behind.

**Commit:** `feat(workspace): the file watcher and its events WebSocket, checked at every hop (ADR 0022)`

### Step 3.4 — The editor's components in the design system (done by Claude)

**Goal:** build the Code view's pieces in `packages/ui` first, with their variants, catalogue stories, screenshot baselines and accessibility checks, before any screen uses them (CLAUDE.md section 10, components first).

| Component | What | Built on | Accessibility |
| --- | --- | --- | --- |
| `EditorTabs` | Open files: the shown one on the canvas surface, a neutral dot for unsaved changes, a close button (shown on hover or focus), middle click closes, scrolls sideways and keeps the shown tab in view | Our own markup | A `nav` of buttons; the shown one is `aria-current`; "unsaved changes" is in the name ("process.ts, unsaved changes"), not only the dot. Not ARIA tabs, because a tab list may hold only tabs |
| `FileTree` | The project's files from the flat list `/tree` gives (`buildTree`): folders first, names ignoring case, numbers in order; reveals and selects the shown file; dots for unsaved files | React Aria `Tree` in a `Virtualizer` (only rows in view are in the page) | The WAI-ARIA tree grid: arrows move and open or close, Enter opens, levels announced, "unsaved changes" as a labelled image |
| `Breadcrumb` | A path above the editor; long ones cut in the middle (`apps / … / polls / create / poll-form.tsx`), whole on hover | Semantic `nav` and `ol` | The last segment is `aria-current="location"`; chevrons hidden |
| `StatusBar` | Items on the left (line and column, indentation, encoding, language), extras on the right (the autosave switch) | A plain bar | A named group, deliberately not a live region (it changes with every cursor move) |

**New token:** `size.editor-tab` = 36 px (Figma 11's tab height, on the 4 px grid).

**Concepts:**
- **Components first.** A component is built and reviewed alone, in every state, then used. Problems are cheaper to see in the catalogue than in a busy screen.
- **The tree-grid pattern.** A tree whose rows can also be acted on. React Aria implements the keyboard model and the ARIA attributes, which are easy to get subtly wrong. https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/
- **Virtualisation.** Only the visible rows exist in the page; the rest are computed when scrolled into view. That keeps 50,000 files fast. https://react-spectrum.adobe.com/react-aria/Virtualizer.html
- **Label in name (WCAG 2.5.3).** An accessible name that differs from the visible text must start with it, so "process.ts, unsaved changes" is fine for a tab showing "process.ts".

**Figma 11 differences (for the step 8 list):**
- **Spacing onto Graphite's 4 px grid:** tab padding 14 → 12 and gap 6 → 8; tree indent 14 → 12; breadcrumb sides 20 → 16; status bar 26 → 28 tall.
- **Text in `text/muted`, not Figma's `text/tertiary`,** which Graphite keeps for icons and lines (contrast).
- **The tab and tree dots are neutral:** they mean "unsaved". Figma's amber and green show git change state, which arrives with change capture (stage 3).
- **No error count in the status bar** until phase 33 (owner, 7 Nov); the autosave switch is there instead.
- **No flow tag on the breadcrumb yet** (`flow · Save item`): flows arrive in stage 1.

**Tests:**
- 17 new unit tests:
  - the tree model's order and nesting, and 50,000 paths in under a second
  - the tree's mouse and keyboard behaviour, reveal and selection, the unsaved label, and the empty state
  - the tabs' names, current tab, close, middle click, keyboard reach, and keeping the shown tab in view
  - the breadcrumb's middle cut and current location
  - the status bar not being a live region
- **Mutation-checked:** disabling the reveal fails 2 tests.
- **16 new screenshot baselines** (8 stories in both themes), all passing axe.

**Results:** `pnpm test` 694 passed; `pnpm test:visual` 106 passed (78 catalogue stories plus the 16 new, and 12 screens); lint, typecheck and format clean; the bundle unchanged (nothing uses the components yet).

**Gotchas:**
- **jsdom has no layout:** the virtualiser renders no rows unless the test gives elements a size (`clientWidth` and `clientHeight`), and there's no `scrollIntoView`. Both are stubbed in the tests, never guarded in the component.
- **`rowHeight` is deprecated** in this React Aria version; it's `rowSize`. Lint caught it.
- **Baselines for new stories only:** `--update-snapshots=missing` creates missing ones and never overwrites an approved one.
- **One unexplained visual failure.** The first full run ended with 105 passed and a failure exit, and its log wasn't kept; two full runs after it passed 106 of 106. To watch.

**Risks:**
- **Laptop:** all five checks ok. The visual runs use one Docker container at a time.

**Commit:** `feat(ui): EditorTabs, FileTree, Breadcrumb and StatusBar for the Code view, catalogued with baselines`

### Step 3.5 — The Code view: open, edit and save files in CodeMirror (done by Claude)

**Goal:** the **Code** switch works. The project's files are on the left; a file opens in CodeMirror with its tab, path and status; Ctrl/⌘+S saves it from the version it was opened at; and a change made in the workspace meanwhile is never overwritten.

**What a person can do now** (`pnpm dev`, a running workspace):
- **Code** in the top bar, or **Files** on the rail, shows the project's files: folders first, `.env` files never listed.
- **Click a file** to open it in a tab, with its path above and the cursor, indentation, encoding and language below. Binary files say what they are, and refused files (`.env`) say why, in the workspace's words.
- **Type,** and the tab and the tree row get a dot ("unsaved changes" in their names). Undoing back to the saved text clears it.
- **Ctrl/⌘+S saves** ("Saving…", then "Saved"). If the file changed in the workspace since it was opened (the terminal, another tab), the save is refused, a message says so, and the changes stay in the editor.
- **Closing a tab** with unsaved changes saves it first; if that fails, the tab stays open.
- **Open tabs and the view are remembered** per project in this browser.
- **F, V and H typed in the editor are letters,** never canvas shortcuts.

**Code** (`apps/web/src/code/`):

| File | What |
| --- | --- |
| `api.ts` | The file list, reads (text with a version, binary, or a refusal), saves (`saved`, `conflict` or `failed`) |
| `languages.ts` | The language by extension, each parser loaded on demand; the indentation a file uses |
| `editor-setup.ts` | Each file's `EditorState` (text, undo history, keys: Mod-s, Tab indents, search); the theme and highlighting from tokens |
| `CodeEditor.tsx` | One `EditorView` in an open shadow root; switching files swaps the state |
| `useCodeFiles.ts` | Open files, unsaved tracking (against the saved text), saving from the opened version, remembering tabs |
| `FilesPanel.tsx`, `CodeView.tsx` | The left panel and the Code view (Figma 11) |

Also: `ProjectPage.tsx` (the view switch, the rail's Files button; Files and the editor load lazily); `FlowCanvas.tsx` (`isCanvasShortcut` uses `event.composedPath()[0]`).

**Concepts:**
- **An `EditorState` per file.** CodeMirror keeps a document, its selection and its undo history in one immutable state. Keeping one per file and swapping it into a single view gives every tab its own undo, cheaply. https://codemirror.net/docs/guide/#state
- **Not re-rendering while typing.** The latest state per file lives in a React ref. React state changes only when something shown changes (a dot, the status, another file), so typing in a large file doesn't re-render the page.
- **Esc, then Tab.** Tab indents in the editor (as code editors do), so keyboard users leave with Esc then Tab, CodeMirror's built-in escape. The status bar's description says so.
- **Code splitting by intent.** The page downloads what you use: the editor's core with the Code view, each language with its first file, the file tree with Files. The bundle budget enforces it. https://vite.dev/guide/features#dynamic-import

**Found and fixed on the way:**
1. **The file tree stopped responding after the first file.** With selection on, React Aria turns a click into a selection change once something is selected, and the "replace" behaviour selects on every arrow key instead. The tree now has no selection: a click or Enter acts, arrows only move, and the open file is in the row's name ("open in the editor") and styled by `data-current`. React Aria drops `aria-current`, so the name carries it. Regression tests cover both cases.
2. **Tree rows didn't update** when the open file or its unsaved state changed: React Aria caches rows by item until its `dependencies` prop changes. Caught by the real-browser walkthrough, not by jsdom; regression test added.
3. **A labelled dot inside a tree row was never announced:** a row's accessible name is its `textValue`. "Unsaved changes" is now in that name.
4. **CodeMirror was in the project page's chunk** (82 → 271 kB) **and the file tree in the first load** (+25 kB). The bundle budget caught both before anything shipped. The fixes: a dynamic `import()`, `sideEffects` in `packages/ui`, a lazy Files panel, and named chunk groups. The first load ended at 143 kB, below phase 2's 149.
5. **The token test caught Prettier rewriting generated files.** Generated files are exactly what the generator writes, and are never formatted by hand.

**New budgets** (`apps/web/scripts/bundle-size.ts`): `codemirror` 130 kB (114 now); `lang` 85 (73 for all, each loading alone); `FilesPanel` 30 (25).

**New tokens:** `color.syntax.keyword`, `string`, `number`, `comment` and `plain`. First set to Figma 11's colours; on 8 Nov 2026 the owner chose the quiet palette (keywords and strings `text/secondary`, keywords semibold, comments `text/muted`), so green and amber keep meaning "added" and "modified" (decisions log).

**Tests:**
- **Unit:** 711 passed in all, 17 new:
  - the file API's mapping
  - languages and indentation
  - the Code view through the page (open, edit, Ctrl+S from the opened version and then the new one, undo clearing the dot, a conflict keeping the text, binary and `.env` states, remembered tabs, workspace not running)
  - canvas shortcuts from a shadow root
  - the tree's regressions
- **Walkthrough (new, `e2e/try-it/phase-3.spec.ts`):** in a real browser under the production CSP, against a fake workspace with real versions and real conflict checks. It opens a file, types (including F, V and H), saves, is refused after a "terminal" change with the text kept, and shows a binary file, with no CSP violations. All 16 walkthroughs pass.
- **Visual:** 106 passed. 14 baselines were re-approved after reviewing each diff: the rail's Files button and Code enabled (12 screens), and the syntax tokens on the tokens page (2).

**Run and check it:**
```fish
pnpm dev            # open a project with a running workspace, then Code
pnpm test           # 711
pnpm test:e2e       # 16, the phase 3 walkthrough among them
pnpm build && pnpm size
```

**Risks:**
- R1 (CSP): closed in the page too, with 0 violations in the walkthrough.
- R2 (size): within the new budgets.
- R5 (overwrites): the page refuses to overwrite, and keeps the text.
- **Laptop:** all five checks ok.

**Commit:** `feat(web): the Code view — files, CodeMirror in a shadow root, tabs, conflict-safe saves; lazy editor chunks`

### Step 3.6 — Autosave, the journal, and restoring unsaved changes (done by Claude; ADR 0022 addendum)

**Goal:** the phase's *Done when*: edits survive closing the tab and reopening. Plus the owner's autosave: for when you forget to save.

**What a person sees** (`pnpm dev`, a running workspace):
- **Autosave** is on (a switch in the status bar, remembered per browser). The file is written 5 s after you stop typing, and at once when you switch file, leave the Code view, or leave the window.
- **Close the tab mid-edit and reopen it:** the file opens with your changes, marked unsaved, and a note says "Restored unsaved changes from 14:02."
- **Open the project in another browser:** files with unsaved changes in the workspace open there too, restored.
- **If the file changed in the workspace after your edit,** the restored changes are shown with a message that the file changed since. They're never saved over the newer file.
- **Windows-style files keep their `\r\n` line breaks** when saved.

**Code:**
- `apps/web/src/code/journal.ts`: the workspace journal through the API; the browser's copy in IndexedDB (an in-memory one for tests); `nextRevision`; `newest`
- `useCodeFiles.ts`: autosave, the two journals, restore on open, flush on leaving, hide and close handlers
- `CodeView.tsx`: the autosave switch, the restored note
- `editor-setup.ts`: line breaks kept

**Concepts:**
- **`visibilitychange` and `pagehide`:** the last moments a page can act before it's hidden or closed. https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- **`fetch` with `keepalive`:** a request the browser finishes even after the page is gone, up to 64 KiB. https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#keepalive
- **IndexedDB:** the browser's own database, which works when the network doesn't. https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- **Debounce versus throttle:** autosave waits for a pause (each keystroke restarts the wait); the journal writes at most every 2 s while you type.

**Found and fixed on the way:**
1. **Restored changes were autosaved the moment you arrived in the Code view:** the view switch flushed on every change of view, not only when leaving. Found by the other-browser walkthrough; a regression test fails with the old line.
2. **CRLF files would have been converted to `\n` on save** (a step 5 gap). `doc.toString()` always uses `\n`; `state.sliceDoc()` keeps the file's separator. A test failed before the fix.
3. **A tab closed right after typing** relied on the close-time writes alone. The browser's copy is now written within 300 ms of each edit.
4. **The walkthrough can't observe `keepalive` requests** (Playwright can't intercept them), so it checks that the workspace got the 2-second write or that the page sent the close-time one, and that reopening restores either way.

**Tests:**
- **Unit:** 727 in all, 16 new.
  - **Autosave:** after the pause, the wait restarting, on switching file, off (remembered) with the journal still writing, CRLF kept.
  - **The journal:** both copies with rising revisions, dropped when undone back, keepalive on `pagehide`.
  - **Restore:** reopening with the changes and saving from their base; files from another tab; the newer copy winning; a stale restore shown as a conflict and never written; a copy equal to the file dropped.
  - **On the page:** the restored note, the autosave switch, and no save on arriving.
- **Mutation-checked:** saving a stale restore against the disk version, or not marking it as a conflict, fails the test.
- **Walkthrough (new, the phase's Try it):** edit, close the tab at once, reopen: the change is there, unsaved, with the note; autosave writes it after 5 s; a fresh browser restores from the workspace. It passed three times in a row, and all 17 walkthroughs pass.
- **Visual:** 106 passed, unchanged.

**Bundle:** the project page is 93.1 of 95 kB (the journal code). The editor's chunks are unchanged.

**Run and check it:**
```fish
pnpm dev     # open a file in the Code view, type, close the tab at once, reopen the project
pnpm test:e2e -- try-it/phase-3.spec.ts
```

**Risks:**
- R4 (lost edits): closed in the browser; the walkthrough proves the Done when.
- **The project page's budget is nearly full:** the next feature that adds to it should load lazily.
- **Laptop:** all five checks ok.

**Commit:** `feat(web): autosave, the journal in the workspace and the browser, and restoring unsaved changes`

### Step 3.7 — Changes in the workspace reach the editor; quick-open (done by Claude; ADR 0022 addendum)

**Goal:** the phase's other *Done when*: an edit made in the terminal appears in the editor. Never silently overwrite either side. Plus quick-open (Ctrl/⌘+P), from the build plan.

**What a person can do now** (`pnpm dev`, a running workspace, the Code view):
- **Edit a file in the terminal** (`sed`, `git checkout`, anything): an open file without unsaved changes shows the new text within a moment.
- **If you have unsaved changes there,** a banner says the file changed while you were editing, with **Keep mine** (your text replaces theirs, knowingly) or **Load the workspace's version** (your changes go). The same banner resolves a refused save and a stale restore.
- **Delete a file in the terminal** and its tab says so: **Close**; or, with unsaved changes, **Save it again** or **Close…**, which asks first (owner, 8 Nov).
- **New and deleted files** appear and disappear in the tree.
- **Ctrl/⌘+P** opens any file by typing part of its name: letters in order, best matches first, Enter opens. The browser's print dialog doesn't appear.

**Files:**

| File | What |
| --- | --- |
| `apps/web/src/code/events.ts` | The events WebSocket (reconnects; a re-check after a reconnect); `versionOf` (SHA-256 in the browser) |
| `apps/web/src/code/useCodeFiles.ts` | `onDiskEvent` (follow, conflict, deleted, overflow), `keepMine`, `loadDisk`, `discard`; own-save echoes; changes during a save checked after it |
| `apps/web/src/code/CodeView.tsx` | The conflict and deleted banners with their buttons |
| `apps/web/src/code/FilesPanel.tsx` | Lists again on request, and reports its listing |
| `apps/web/src/project/ProjectPage.tsx` | Events while running; the tree refresh; Ctrl/⌘+P; quick-open fetched in the background |
| `apps/web/src/code/QuickOpenDialog.ts` | Quick-open by name, so it's its own chunk |
| `packages/ui/src/components/quick-open/` | `QuickOpen` (React Aria Modal, Dialog, Autocomplete, SearchField, ListBox) and `fuzzy.ts` (ranking), with tests and a story |

**Concepts:**
- **Optimistic concurrency, seen from the page.** The page knows the version it last saw. A change event with another version means someone else wrote, unless it's the version the page itself just wrote, which it knows because it hashes what it sends.
- **Races between a request and an event.** An event can overtake the answer to the request that caused it. Here an event during a save waits for the save's answer before it's judged.
- **Fuzzy matching:** the typed letters in order, with bonuses for the file name, word starts and runs, so `pform` finds `poll-form.tsx`.
- **Autocomplete with virtual focus:** the field keeps keyboard focus while arrow keys move through the results (`aria-activedescendant`). https://react-spectrum.adobe.com/react-aria/Autocomplete.html

**Found and fixed on the way:**
1. **A change by someone else during our save was hidden by the save's answer:** the conflict it raised was replaced by "Saved". Changes during a save are now checked after its answer. Found by mutation-testing the echo rule; regression test added.
2. **The echo rule had no test that could fail:** the echo test sent its event after the save's answer, where another check also covers it. A new test holds the answer back, and fails without the rule.
3. **Quick-open's first letters were lost on first use:** it loaded on the keypress, so letters typed before it appeared went nowhere, or into the editor. It's now fetched in the background once the workspace runs. Found by the screen test.
4. **`import('@flowcanvas/ui')` pulled quick-open into the first load** (143 → 159 kB, within 1 kB of the budget). A tiny module that imports it by name keeps it in its own chunk. Found by the bundle budget.
5. **The page's focus ring inside quick-open's field:** replaced by the search row's accent border (still a visible focus indicator).
6. **A closed tab's browser-copy timer wasn't cleared** (a step 6 slip): one helper now removes a tab with all three timers.

**Tests:**
- **Unit:** 747 in all, 20 new.
  - **events:** what passes the check; reconnecting with a re-check; not connecting while asleep; `versionOf` equal to Node's SHA-256, including non-ASCII text and `\r\n`
  - **useCodeFiles:** following the disk; echoes, including one before the answer; a conflict that autosave never overwrites, then Keep mine; Load the workspace's version dropping the journal; deleted with and without changes, Save it again, discard; overflow re-checking; a change during a save
  - **quick-open:** ranking (and 50,000 paths in under 0.5 s), the dialog's focus, typing, Enter, Escape, empty states
- **Mutation-checked:** removing the echo rule, the unsaved-text rule, or the deferral during a save fails its test.
- **Walkthrough (new, the Done when in a real browser under the production CSP):** the terminal edits a file and the editor shows it; with unsaved changes, the banner and Load the workspace's version; Ctrl+P, "pack", Enter; the terminal deletes a file, and Close. It passed twice.

**Run and check it:**
```fish
pnpm dev     # Code view, open a file; in the dock's terminal: sed -i 's/a/b/' <that file>
pnpm test:e2e -- try-it/phase-3.spec.ts
```

**Risks:**
- R5 (silent overwrites): closed in both directions. Saves never overwrite a change they haven't seen; changes never replace unsaved text.
- **Laptop:** all five checks ok.

**Commit:** with step 8.

### Step 3.8 — Screen baselines, quick-open's story, and the Figma 11 and 16 differences (done by Claude)

**Goal:** the screens a person sees in phase 3 are approved and protected, and every way they differ from Figma is listed for the owner.

**What a person can do now:** review `docs/reports/phase-3-figma-differences.md`, with Figma 11 and 16 beside the built screens in `docs/reports/phase-3/`.

**Files:**
- `e2e/visual/screens.spec.ts`:
  - three Code view screens in both themes: a file open, a restored change in conflict, quick-open
  - a running workspace in its fake, with files and versions
  - a quiet events socket
- `packages/ui/src/components/quick-open/QuickOpen.stories.tsx`: the story, baselined in both themes.
- `apps/web/scripts/bundle-size.ts`: a `QuickOpenDialog` budget of 14 kB (11.8 now).

**Concepts:**
- **A screen test waits like a person:** for the editor's text, the tree, the language in the status bar, and the search field's focus before typing. A screenshot taken any earlier would vary.
- **Review each baseline before approving it:** each new screen was viewed. One wasn't approved as it stood (the focus ring in quick-open) and was fixed first.

**Found and fixed on the way:** quick-open's lost first letters, and the focus ring (step 3.7, items 3 and 5).

**Tests:** 8 new baselines (3 screens and 1 story, in both themes), each repeated twice before approval, all passing axe. The full visual suite ran once before pushing (see the milestone report).

**Bundle:** first load 147.2 kB (143.0 at step 6: React Aria parts that quick-open shares with menus moved into the shared chunk); project page 94.6 of 110; quick-open 11.8 of 14.

**Run and check it:**
```fish
pnpm test:visual    # 114: 80 catalogue stories, 15 screens, in both themes, with axe
```
Then compare `docs/reports/phase-3/figma-11.png` with `built-code-view-dark.png`, and `figma-16.png` with `built-quick-open-dark.png`.

**Risks:**
- **The first load is at 147.2 of 160 kB.** The next shared component should be checked for what it adds.
- **Laptop:** all five checks ok.

**Commit:** `feat(web): an edit in the workspace reaches the editor; conflicts and deleted files resolved by the person; quick-open; Code view baselines`

### Step 3.9 — Close the phase: report, 0.7.0, the upgrade-later review, PR (done by Claude)

**Goal:** finish phase 3 so it can be reviewed and accepted.

**What a person can do now:**
- read the report (`docs/reports/phase-3.md`) and the Figma differences
- see 0.7.0 in What's new
- review the pull request: its preview, test report and recordings

**Files:**
- `docs/reports/phase-3.md`
- `CHANGELOG.md` (0.7.0, which What's new reads)
- `package.json` (0.7.0)
- `docs/STATUS.md` (in review)
- `docs/upgrade-later.md` (item 2 due)
- `docs/RUN-AND-FEATURES.md`

**Concepts:**
- **Release notes for people:** the changelog says what someone can now do, not which files changed.
- **The upgrade-later review checks triggers against facts, not memory.** Node 26's status came from nodejs.org on the day.

**Found and fixed on the way:**
- **Upgrade-later 2 (Node 26 LTS) is due.** Node 26 became LTS on 28 Oct 2026. It changes the workspace image, CI, `.nvmrc` and Cloudflare's build, so it's its own pull request right after this phase merges, keeping this one focused.
- The rest of the review found nothing due, and nothing was added this phase.

**Tests (all run once before pushing):**
- format, lint and typecheck: clean
- unit: 747 passed
- walkthroughs: 18 passed
- visual: 114 passed
- Docker: 46 passed, with no test containers left behind
- bundle: every budget within

**Run and check it (phase 3, fresh clone):**
```fish
git clone https://github.com/ArmaanAhuja/Flowcanvas && cd Flowcanvas
corepack enable && pnpm install
cp .dev.vars.example .dev.vars          # then fill in your own values (never paste them anywhere)
pnpm db:status && pnpm db:migrate       # must say the dev branch
pnpm dev                                # http://localhost:5173
```
1. Sign in, open a project, and open its workspace. Click **Code**.
2. Open a file, type a line, close the browser tab at once, and open the project again: the line is there, with a note.
3. Wait 5 seconds: "Saved".
4. In the **Terminal**, change the file (`sed -i 's/a/b/' <file>`): the editor shows it.
5. Type, then change it in the terminal again: **Keep mine** or **Load the workspace's version**.
6. Press **Ctrl/⌘+P**, type part of a name, and press Enter.
7. `rm` an open file: its tab says it was deleted.

**What proves it:**
```fish
pnpm test               # 747
pnpm test:e2e           # 18, phase 3's three among them (the Try it, terminal edits, saving and conflicts)
pnpm test:visual        # 114
pnpm test:docker        # 46 (the watcher, versions and the journal in real containers)
pnpm build && pnpm size
```

**Risks:**
- **Laptop:** all five checks ok.

**Commit:** `chore(release): phase 3 report, 0.7.0, in review`

## Phase 4 — Indexer

**From the build plan:**
- **Build:** engine inside the workspace; tree-sitter parse of every file; symbols into SQLite; symbol search; re-index changed files on save.
- **Done when:** both forks index in under 30 s; symbol search under 100 ms.
- **Try it:** press ⌘K and jump to any function in Rallly.

**Decisions (decisions log, 9 Nov 2026):**
- **Every file of a language we ship a grammar for:** TS, TSX, JS, JSX, CSS, JSON, HTML and Markdown. Others are listed and counted.
- **Both forks:** Rallly and Documenso.
- **⌘K** is the command palette (Symbols and Files); Ctrl/⌘+P stays files.
- **A symbol opens in the Code view at its line.**
- **100 ms** in the engine and in the browser.

**Expected outcome:**
- When a workspace opens, the engine indexes the project in the background, and the page says so ("Indexing 1,240 of 2,031 files…").
- **⌘K**, or the top bar's **Search ⌘K**, opens the command palette. Type part of a name to find functions, components, classes, types and constants, with their kind and file. Enter opens the Code view at that line.
- Saving a file, or changing it in the terminal, updates its symbols within a moment.

**Concepts this phase introduces** (each with a primer in its step):
- tree-sitter, incremental parsing into a syntax tree: https://tree-sitter.github.io/tree-sitter/
- WebAssembly, the parser and its grammars as portable binaries: https://developer.mozilla.org/en-US/docs/WebAssembly
- SQLite and full-text search (FTS5) in Node 26's built-in `node:sqlite`: https://nodejs.org/api/sqlite.html and https://www.sqlite.org/fts5.html
- Content hashes for incremental work: only changed files are parsed again

**Scope:**
- **In:** the engine process in the workspace; parsing; symbol extraction; the SQLite index; search; re-indexing on change; indexing status; the command palette with Symbols and Files; the top-bar search field.
- **Out:**
  - name resolution and call graphs (phase 5)
  - the graph model (phase 6)
  - global text search across code (a later phase)
  - commands, nodes and screens in the palette (their phases)
  - other languages' grammars (later waves)

### Steps (planned)

| # | Step | Milestone | Status |
| --- | --- | --- | --- |
| 0 | The plan and decisions; branch | A | done (Claude, 9 Nov) |
| 1 | Spike: tree-sitter as WebAssembly and its grammars in the workspace image; `node:sqlite` with FTS5; Rallly's parse time; CPU and memory. ADR 0023 | A | done (Claude, 9 Nov) |
| 2 | The engine: parse every file, extract symbols, store them in SQLite; incremental by content hash | A | *next* |
| 3 | The engine's API (status, search) through the host and control plane; re-indexing on watcher events | B | *planned* |
| 4 | UI: the command palette in the design system (Symbols and Files); the top-bar search field | B | *planned* |
| 5 | The page: ⌘K, jumping to a symbol, indexing status | C | *planned* |
| 6 | Corpus tests (Rallly and Documenso under 30 s, all six reported), performance tests, the walkthrough, baselines, the Figma differences | C | *planned* |
| 7 | Close: report, 0.8.0, PR | C | *planned* |

### How each Done-when item is proven

| Item | Test |
| --- | --- |
| Both forks index in under 30 s | Docker corpus test: Rallly and Documenso at their pins, a cold index timed in a real workspace (2 CPUs, 4 GiB) |
| Symbol search under 100 ms | The engine's query p95 over hundreds of queries on Rallly; the browser's keypress to results |
| Try it | Walkthrough: ⌘K, a function's name, Enter, the Code view at that line |
| Symbols are right | Unit tests on fixtures for each kind; corpus spot checks against hand-picked Rallly functions |
| Re-index on save | Docker test: `sed` adds a function, and search finds it within a second |

### Risks (checked at every milestone)

| # | Risk | How we keep it in check | Status |
| --- | --- | --- | --- |
| R1 | tree-sitter in WebAssembly is too slow for 30 s on Documenso | Measured in the spike on both forks before building on it | **closed:** 3.1 s on Documenso, 1.6 s on Rallly (ADR 0023) |
| R2 | **Laptop:** indexing uses the workspace's CPU and memory | Measured in the spike; within the container's limits; the resource guard still applies | **measured:** one thread, under 150 MB; re-checked in step 6 |
| R3 | The workspace image grows by the grammars | Measured; only the eight grammars | **measured:** about 4.2 MB of `.wasm`; confirmed when step 3 adds them to the image |
| R4 | `node:sqlite` lacks something we need | The spike tests FTS5, transactions and speed | **closed:** FTS5 trigram p95 18 ms at 100,000 symbols |

### Step 4.1 — Spike: tree-sitter as WebAssembly, the eight grammars, `node:sqlite` with FTS5 (done by Claude; ADR 0023)

**Goal:** prove, before building on it, that tree-sitter can parse every file of both forks well inside 30 s in a workspace's limits, that `node:sqlite` can answer symbol searches well inside 100 ms, and that every grammar we ship loads. Settle where each grammar comes from.

**What a person can do now:**
- **Load all eight grammars and parse any file** with `@flowcanvas/engine`'s `loadGrammars()` and `languageOf(path)`. Nothing is visible in the app yet; the engine arrives in step 2 and the page in step 5.
- **Rebuild the Markdown grammar** and check it matches what's committed: `tools/grammars/build-markdown.sh --check`.

**Files:**

| File | What |
| --- | --- |
| `tools/grammars/build-markdown.sh` | Builds the Markdown grammar (block and inline) as WebAssembly from its C source. Pinned, checksummed inputs; a container with no network; `--check` compares a fresh build |
| `packages/engine/grammars/` | The built `tree-sitter-markdown.wasm` and `tree-sitter-markdown-inline.wasm`, their `markdown.sha256`, and the grammar's licence |
| `packages/engine/src/grammars.ts` | `GRAMMAR_FILES` (where each grammar's `.wasm` is), `languageOf(path)`, `limitationOf(path)` (`mdx-components`), `loadGrammars()` (once per process) |
| `packages/engine/src/grammars.test.ts` | Extensions, limitations, each grammar parsing a sample, the committed checksums |
| `packages/engine/package.json`, `tsconfig.json` | `web-tree-sitter` and the five grammar packages; Node's types; `grammars/` is published with `dist/` |
| `pnpm-workspace.yaml` | The six packages in the catalog; the grammars' install scripts denied (`allowBuilds: false`) |
| `docs/adr/0023-tree-sitter-webassembly-and-sqlite.md` | The decisions and the measurements |

**Concepts:**
- **tree-sitter:** a parser generator. A grammar becomes a C parser that builds a concrete syntax tree quickly, recovers from syntax errors (a half-typed file still gives a tree), and can re-parse incrementally after an edit. https://tree-sitter.github.io/tree-sitter/
- **WebAssembly (`.wasm`):** a portable binary format any JavaScript runtime runs at near-native speed. Here the parser's runtime is one `.wasm` file and each grammar is another, so nothing is compiled when packages install. https://developer.mozilla.org/en-US/docs/WebAssembly
- **wasi-sdk:** clang set up to compile C to WebAssembly. tree-sitter 0.27's CLI uses it (and binaryen's `wasm-opt` to shrink the result) to turn a grammar's `parser.c` and `scanner.c` into a `.wasm`. https://github.com/WebAssembly/wasi-sdk
- **Queries:** tree-sitter's pattern language, which picks nodes out of a tree, for example `(function_declaration name: (identifier) @name)`. Step 2 uses them to extract symbols. https://tree-sitter.github.io/tree-sitter/using-parsers/queries/
- **`node:sqlite` and FTS5:** SQLite built into Node 26, so there's no native addon. FTS5 is SQLite's full-text index; its `trigram` tokenizer matches any three or more letters inside a name. https://nodejs.org/api/sqlite.html and https://www.sqlite.org/fts5.html
- **Reproducible builds:** the same pinned inputs always give byte-identical outputs, so anyone can check that a committed binary is what the script makes. https://reproducible-builds.org/

**Found and fixed on the way:**
1. **No package ships Markdown as WebAssembly** (not the grammar's package, not `tree-sitter-wasms`). The owner chose to build it ourselves; the script does it reproducibly. Two builds are byte-identical.
2. **tree-sitter 0.27 no longer uses Emscripten:** it downloads wasi-sdk and binaryen at build time. The script downloads the exact versions the CLI names, checks their SHA-256, and points the CLI at them, so the container needs no network. This avoids an 825 MB Emscripten image.
3. **188 `.mdx` files in the forks,** which the agreed list didn't cover. Asked; the owner chose parsing them as Markdown, marked as partly read (decisions log, 9 Nov 2026).
4. **The grammar packages have native-build install scripts** (node-gyp). Denied, since we load their `.wasm`.
5. **Docker on this laptop can't mount anything under `/home`** (it can under `/tmp`). The spike ran from copies in the scratchpad. Step 3 copies the engine into the workspace, as the agent already is (ADR 0016), so nothing depends on a mount.

**Tests:**
- **Unit:** 25 in `@flowcanvas/engine`, 24 new:
  - **`languageOf`:** 10 paths, including `.mts`, `.mjs`, `.jsx`, `README.MD` and `.mdx`
  - **no grammar:** 6 paths (Prisma, SQL, PNG, `Dockerfile`, `.gitignore`, a dot in a folder name)
  - **`limitationOf`:** 5 paths (MDX, and four with nothing to say)
  - **loading:** every grammar loads, and a sample of each parses to the right root with no errors
  - **loaded once per process**
  - **our Markdown build** matches its recorded checksums
- **Mutation-checked:** dropping the case-insensitive match fails `README.MD`; changing one character of a recorded checksum fails the checksum test.
- **Spike measurements** (in the workspace image: 2 CPUs, 4 GiB, read-only root, no network; ADR 0023):

  | | Rallly | Documenso |
  | --- | --- | --- |
  | Files parsed | 1,472 of 1,959 | 2,510 of 2,986 |
  | Parse and query time | 1.6 s | 3.1 s |
  | Memory | 130 MB | 147 MB |

  `node:sqlite` with 100,000 symbols: insert 0.4 s; trigram search p95 18 ms.

**Run and check it:**
```fish
pnpm --filter @flowcanvas/engine test     # 25 tests: grammars load and parse; checksums match
tools/grammars/build-markdown.sh --check  # optional: rebuilds Markdown (about 300 MB of downloads, 1.5 min)
```

**Risks:**
- R1 (speed): closed.
- R4 (`node:sqlite`): closed.
- R2 (laptop): measured; re-checked in step 6.
- R3 (image size): about 4.2 MB; confirmed in step 3.
- **Laptop:** load stayed under 3 during the spike (8 cores). Every container was labelled and removed with `--rm`. 577 GB free disk.

**Commit:** `feat(engine): tree-sitter grammars as WebAssembly, with a reproducible Markdown build` (with this step's docs).
