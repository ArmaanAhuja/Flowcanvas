# 0027 — The graph model: code units and call edges from one TypeScript pass, snapshots as compact blobs

- Status: accepted
- Date: 12 Nov 2026
- Phase: 6, step 1 (spike)

## Context

Phase 6 builds the *core vocabulary* (entry point, code unit, call, decision, data access, async hand-off, external boundary), *provenance on every edge*, *change state on every node* and *versioned snapshots in SQLite*. *Done when:* the schema handles all 4 forks; snapshot save and load under 1 s.

The owner's decisions (decisions log, 12 Nov 2026): Rallly, Documenso, LibreChat and Twenty are held; Excalidraw and Medusa are reported. Kinds not detected yet show 0 with their phase. Built-ins stay out of the graph.

What phase 6 can fill from the code today: **code units** (functions, methods, components, classes) and **call edges** (calls and renders, resolved or unknown), from TypeScript. The other kinds arrive with their phases (entry points 8, data access and external boundaries 10, async hand-offs and decisions later in stage 1).

Phase 5 asks TypeScript about one function at a time. A whole-project graph needs every function's calls: asking per function would take hours on Twenty, and phase 5 found Twenty can't hold every program at once.

## The spike (12 Nov 2026)

One pass over each program: build it, walk every project file once (a file in several programs is walked in the first), resolve each call and JSX site with the type checker, release the program, then the next. Then the snapshot was saved and loaded in SQLite three ways. Laptop, Node 26, the worker's 2.5 GB heap cap, at each fork's pin, no `node_modules`:

| Fork | Programs (inferred) | Files walked | Pass | Peak heap | Nodes | Edges (resolved / unknown) | Built-in calls | Compact snapshot | Save / load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Rallly** | 18 (6) | 1,160 | 5.8 s | 0.85 GB | 3,046 | 17,801 (6,742 / 11,059) | 3,768 | 1.0 MB | 20 / 10 ms |
| **Documenso** | 17 (3) | 2,220 | 13.8 s | 1.70 GB | 4,715 | 37,777 (8,997 / 28,780) | 6,580 | 2.1 MB | 23 / 16 ms |
| **LibreChat** | 16 (6) | 6,150 | 40.1 s | 1.54 GB | 30,379 | 215,471 (43,966 / 171,505) | 84,777 | 15.5 MB | 187 / 187 ms |
| **Twenty** | 74 (36) | 32,458 | 61.1 s | 2.06 GB | 53,047 | 250,461 (80,252 / 170,209) | 60,935 | 20.1 MB | 241 / 240 ms |
| Excalidraw | 14 | 696 | 12.9 s | 0.97 GB | 4,225 | 18,948 | 9,625 | 1.3 MB | 12 / 13 ms |
| Medusa | 182 | 11,829 | 41.4 s | 1.43 GB | 19,211 | 95,102 | 21,901 | 6.3 MB | 85 / 51 ms |

(Peak heap includes the spike holding three encodings of the snapshot at once. Snapshot sizes are uncompressed JSON; gzipped, 0.3–5.1 MB.)

**How the snapshot was stored, Twenty:**

| Encoding | Size | Save | Load |
| --- | --- | --- | --- |
| Rows (a table each for nodes and edges) | — | 432 ms | 749 ms |
| One gzip blob, IDs repeated in every edge | 88 MB JSON, 8.2 MB gzip | 241 ms | 441 ms |
| **One gzip blob, edges referring to nodes by index** | 20 MB JSON, 5.0 MB gzip | 241 ms | 240 ms |

**What else the spike found:**
1. **Twenty fits when programs are walked one at a time** (2.06 GB peak against the 2.5 GB cap), where building every program at once ran out of memory in phase 5.
2. **Many source files are in no `tsconfig.json`:** LibreChat's whole Express backend (`api/server`, `api/app`: 1,342 files) and 983 of Twenty's. Neither the graph nor phase 5's Calls tab saw them. TypeScript's own editors handle this with "inferred projects"; so does the spike, and LibreChat gains 6,000 code units.
3. **Unknown edges outnumber resolved ones** (packages aren't installed: React hooks, Prisma, lodash). That's the honest picture until connectors (phase 10) and is what the graph must hold.

## Decision

### 1. One pass per program, in the TypeScript worker

The graph pass runs in the engine's existing TypeScript worker (ADR 0026), so there's one 2.5 GB cap, not two:
- **Programs one at a time:** each is built, its files walked, then released. A file is walked once, in the first program that includes it.
- **Questions keep priority:** the pass yields between files, so a Calls question waits at most for a program to build (the longest measured: 20 s on Twenty, laptop).
- **When it runs:** after the index's first full pass; again 2 s after edits settle, re-walking the changed files and the files with calls into them (a renamed function's callers are walked again, so their calls stop reaching it). One pass at a time; a change during one runs once more after it.
- **If memory runs short,** the pass stops and the snapshot says it is partial, with how many files were walked.

### 2. Inferred programs for files no tsconfig includes

Grouped by their nearest `package.json`, with the analysis defaults (ADR 0026 §4), `allowJs`, and the workspace's `paths`. In the shared project model, so the Calls tab gains them too.

### 3. The vocabulary (`@flowcanvas/graph-model`)

- **Node kinds:** `entry-point`, `code-unit`, `decision`, `data-access`, `async-handoff`, `external-boundary`. A node has a kind, a name, its place (path, line, column), a change state and, for code units, what it is (function, method, component, class, a file's top level).
- **Edge kinds:** `call` (with relation *calls* or *renders*), and the kinds later phases add (`data`, `handoff`, `boundary`). Every edge has one provenance: `observed`, `resolved`, `convention`, `suggested` or `unknown`, and the lines it happens on.
- **Unknown targets** aren't nodes: an unknown edge carries the call's text instead (`prisma.poll.create`), drawn later as an open stub.
- **Built-ins** aren't in the graph (owner); the snapshot counts them.
- **Change state:** `added`, `removed`, `modified`, `possibly-affected`, `unchanged`, and `analysing` for freshness.

### 4. Identity by file and qualified name, never by line

A node's ID is its file and its qualified name (`apps/web/src/poll.ts#PollService.create`); a file's top level is `#(top level)`. Two declarations with the same name in one file get `~2`, `~3` in source order. Moving code changes a node's place, not its identity, so a diff between snapshots shows it as modified, not removed and added.

### 5. Snapshots: one compact gzip blob per version, keyed by its hash

- **Encoding:** nodes in ID order; edges referring to nodes, and unknown targets to a text table, by index; JSON; gzip.
- **Version:** the SHA-256 of the encoding. An unchanged graph isn't stored again.
- **Where:** a `snapshots` table in the engine's SQLite store, with the time, the counts and whether it's partial. The last 20 are kept (checkpoints and their pinning come in stage 3).
- **Diff:** in `@flowcanvas/graph-model`, between two loaded snapshots: nodes added, removed and modified; edges added and removed.

## Options considered

- **A row per node and edge:** queryable in SQL, but 749 ms to load Twenty on the laptop, too close to 1 s on a workspace's 2 CPUs.
- **Asking the call hierarchy per function** (phase 5's way): exact the same way, but one question per function; hours on Twenty.
- **A second worker for the graph:** questions would never wait, but two 2.5 GB caps don't fit a 4 GiB workspace.
- **Line-based identity:** simpler, but every edit above a function would make it look removed and re-added.

## Consequences

- **The four forks fit the Done when on the laptop** with room to spare (load at most 240 ms). Step 6 proves it in real workspaces (2 CPUs, 4 GiB), where it will be slower.
- **The first graph of a large project takes about a minute** (Twenty, laptop); Graph stats says it's being built until then.
- **Phase 5's Calls tab now sees files no tsconfig includes** (LibreChat's backend).
- **Most edges are unknown until connectors arrive.** That's honest, and phase 10 turns Prisma's into data access.

## Addendum: what building it found (step 3, 12 Nov 2026)

**The engine's pass, laptop, every fork at its pin** (the worker's 2.5 GB cap; graphs checked against the schema, all valid and complete):

| Fork | Pass | Peak heap | Files | Nodes | Edges (resolved / unknown) | Built-in calls |
| --- | --- | --- | --- | --- | --- | --- |
| **Rallly** | 4.1 s | 0.48 GB | 1,168 | 3,327 | 16,394 (7,514 / 8,880) | 3,930 |
| **Documenso** | 9.8 s | 0.95 GB | 2,231 | 4,912 | 35,307 (12,102 / 23,205) | 6,589 |
| **LibreChat** | 36.7 s | 2.08 GB | 6,208 | 34,488 | 164,991 (50,172 / 114,819) | 85,132 |
| **Twenty** | 60.9 s | 1.93 GB | 32,518 | 61,810 | 237,263 (96,719 / 140,544) | 66,376 |

More edges resolve than in the spike: calls to module-level constants and interface members reach their declarations (phase 5's rule), and fewer unknown edges repeat.

**Found and fixed:**
1. **Twenty ran out of memory in the engine** where the spike didn't. The pass went through the questions' service cache, which keeps programs until the heap is 70% full and frees only before building the next; one large program on top of the cached ones passed the cap. The pass now releases every program it built as soon as its files are walked; programs the questions already had stay warm (tested).
2. **TypeScript's references don't follow CommonJS shorthand exports** (`module.exports = { slug }` then `const { slug } = require(…)`), so its call hierarchy finds no callers there: phase 5's Callers misses them in LibreChat's backend. The graph is built forwards (each call resolved to its target), and has them. Answering Callers from the graph is a follow-up for the flow phases.
