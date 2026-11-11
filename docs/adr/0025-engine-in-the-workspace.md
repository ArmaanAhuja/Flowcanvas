# 0025 — The engine in the workspace: a bundled process, its own watcher, and status and search through the API

- Status: accepted
- Date: 11 Nov 2026
- Phase: 4, step 3

## Context

ADRs 0023 and 0024 built the engine as a library. The build plan puts it *inside the workspace* (CLAUDE.md §7: heavy analysis runs in the engine in the workspace, never in the browser's UI thread). It must re-index changed files on save, and the page must get its status and search through the same path as everything else (browser → control plane → host → workspace). The decisions log (9 Nov 2026) adds two rules: indexing is not activity (it never keeps a workspace awake), and "under 100 ms" counts both the engine and the browser.

## Decisions

### 1. The engine is its own process in the workspace, bundled, and copied in when its version changes

- **Bundled:** `packages/engine/scripts/bundle.ts` uses esbuild to bundle `src/main.ts`, with web-tree-sitter and the agent's file list and watcher, into one `main.js`. Beside it go the runtime and grammar `.wasm` files (10 files, about 4.5 MB) and `version.txt`, a SHA-256 over all of them. A workspace has Node but no `node_modules`, so the bundle uses only Node's built-in modules.
- **Copied in:** the host copies the bundle into `/tmp/flowcanvas-engine` (the container's tmpfs) when the version there differs. Each file goes through `docker exec -i … cat` to a temporary name and is renamed into place. `version.txt` goes in last, so an interrupted copy never looks complete.
- **Started:** `docker exec -i <workspace> node /tmp/flowcanvas-engine/main.js` runs as the workspace's own user, with JSON lines over stdin and stdout, like the agent (ADR 0016).
- **One engine per running workspace:** it starts on the first index request and stops with the workspace. If it stops on its own, the next request starts it again. Sleep freezes it with the container.
- **The index:** `/workspace/.flowcanvas/index.db`, in the volume (it survives sleep and restarts), outside the project, in a folder only the workspace user can read (`0700`).

*Rejected:*
- **Baking the engine into the workspace image:** the image's tag is a hash of its Dockerfile (ADR 0016), so every engine change would mean a new image and new workspaces. Copying keeps the engine and the host in step, as the agent already does.
- **Running it inside the agent process:** a long index would hold up file requests and saves. The agent stays small and quick.
- **`docker cp`:** it writes to the container's root filesystem, which is read-only. The tmpfs is reached only through `exec`.

### 2. The engine has its own watcher, and starts it before the first pass

The engine reuses the agent's watcher in-process (`startWatcher`, ADR 0022): folders not files, coalesced, never secret files. Reported changes are gathered for 200 ms and re-indexed in one `refresh`; an `overflow` runs a full pass. This works whether or not a page is open.

**The order matters:** the watcher starts first, then the full pass. A change before the watcher is up is read by the pass; a change after it is reported. The other order leaves a gap in which an edit is missed for good. Found while testing: one Docker run in about ten missed an edit made right after "ready". The gap is real in the old order and a unit test now pins the order, but the failure didn't happen again in later runs, so it isn't proven to be the cause (phase report, known issues).

*Rejected:*
- **Feeding the page's watcher events to the engine through the host:** there's no page watcher while no page is open, so edits made then would wait for the next full pass.

### 3. The protocol is small and checked at every hop

`@flowcanvas/engine/protocol` has no imports, so the control plane bundles it into its Worker.

- **Requests:**
  - `hello`
  - `status`: state, progress, counts by file status, syntax errors, partly read files, the last full pass's time, and a message
  - `search` (`query` up to 100 characters, `limit` 1–100, default 50)
- **Checks:**
  - **The engine** checks requests (`parseEngineRequest`).
  - **The host and the control plane both check answers** (`isEngineResponse`, per request): exact shapes, bounded sizes, project-relative paths only, known kinds, no more results than asked for. The workspace is untrusted.
  - **Errors** say what went wrong in words that are safe to show. An unexpected failure never passes on its details (they could name paths or hold file content).

The host's JSON-lines connection (`lines.ts`) is now shared by the agent and the engine, with each protocol's version, line limit, timeouts and answer check passed in.

### 4. The API: status never counts as activity; search does

- `GET /api/projects/:id/workspace/index/status` and `GET …/index/search?q=&limit=`: the owner only, while the workspace runs.
- **Status never touches `last_active_at`:** the page asks for it while it shows progress, and indexing must not keep a workspace awake (decisions log, 9 Nov 2026).
- **A search does touch it,** like opening a file: it's the person using the project.
- **Logs** have the operation and outcome only, never the query.

### 5. Search ranking

`IndexStore.search`:
- **Matching:** every word must appear in the name. Words of three or more letters use the trigram index; shorter ones scan names.
- **Ranking:**
  1. an exact name, then a prefix, then a match at a word start (`poll` in `createPoll`, `poll_id`), then anywhere
  2. within each, exported first, then by kind, then shorter names, then path and line
- **The candidate limit:** up to 2,000 candidates are ranked. Names starting with the whole query are fetched first, so the candidate limit never cuts off the best matches.
- **Not fuzzy:** letters in order (`crpl` for `createPoll`), as quick-open does for paths, aren't matched (upgrade-later 45).

## Measurements

| | |
| --- | --- |
| Rallly in a real workspace (`host.docker.test.ts`) | indexed 2.4–2.8 s after the first request (the pass itself about 1.0 s); an edit searchable after about 300 ms (5 runs) |
| Search, engine side | 1–2 ms on Rallly; p95 under 100 ms on 100,000 symbols (unit test) |
| The bundle | 10 files, about 4.5 MB; copied once per container |

## Consequences

- **Re-indexing works with or without a page open.** Its cost is one watched folder per project folder (Rallly: 599), on top of each open page's watcher.
- **No new image is needed for engine changes,** only a copy of about 4.5 MB when a workspace starts with a new engine.
- **The Worker never contains the parser or SQLite:** checked with a `wrangler deploy --dry-run` bundle.
