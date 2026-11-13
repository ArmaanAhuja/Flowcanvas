# 0029 — Compute once, store, reuse: the facts store, and where caching applies

- Status: accepted
- Date: 13 Nov 2026
- Phase: 7 (owner's direction, decisions log 13 Nov 2026)

## Context

The owner wants every action to feel instant, by working things out once and reusing them rather than computing them again (decisions log, 13 Nov 2026). Milestone A of phase 7 measured the opposite in one place: a flow opened from inside a function, or a node's details, asks TypeScript, whose first question about a package builds its programs: 7.9 s on Twenty and 1.2 s on LibreChat on CI. The graph pass has already had every one of those programs in hand.

## Decision

### 1. The rule

For every feature: what a person would wait for is worked out ahead, where the work is already being done (the graph pass, in the background), and stored, keyed so it can't be stale: a version, or the hash of the text it came from. Live work is only for what changed since, and nothing stale is shown as current (CLAUDE.md rule 3).

### 2. The facts store (done)

- **What:** for each file, each code unit's range (where it starts and ends; a constant's from its name) and the inspector's details for it, worked out by the pass while it has the file's program (`fileFacts`).
- **Where:** `/workspace/.flowcanvas/facts.db`, its own SQLite file beside the index and the graph: one row per file, its units as compressed JSON, with the SHA-1 of the file's text (less a byte-order mark).
- **Written** by the worker as the pass walks, in a transaction at each pause; nothing is held in memory. Removed with their file; after a whole-project pass, only the files it walked keep rows.
- **Read** by the engine: one file's row when asked, the last 64 kept decoded and forgotten after each pass (the worker may have rewritten any of them). Every read checks the file's text against the row's hash: a file changed in any way (an edit, a checkout, while the engine was stopped) is answered by TypeScript instead, as before.
- **Used for:** the code unit at a place (a flow from inside a function) and a node's details.

**Measured** (laptop): Twenty's pass 86.9 s with the store against 91.8 s without (within its variation), a heap peak of 2.03 GB (the worker's cap is 2.5 GB), 29.6 MB stored; Documenso 2.3 MB. A lookup takes 0.04 ms, 12 ms at most (the first decode of a file). Answers are the same as TypeScript's at every place of a test file (one test compares all of them).

To afford it, two changes from milestone A: a file's exports are read once per file, not once per unit (that was quadratic); and signatures are built from types as written, the checker printing only inferred ones (printing whole signatures was half of the details' time).

### 3. Where it applies, and when

| What a person does | Before | Now, or when |
| --- | --- | --- |
| Search, ⌘K | SQLite index, updated per changed file | already so (phase 4) |
| The graph, Graph stats | stored versions, updated per changed file, loaded at start | already so (phase 6) |
| A flow from a function's name | the latest graph, in memory | already so (phase 7, milestone A) |
| A flow from inside a function; a node's details | TypeScript, seconds the first time per package | **the facts store** (this ADR) |
| The Calls tab; Go to definition | TypeScript every time, seconds the first time per package | **phase 7, milestone B:** from the graph and the facts store (each call's exact place stored with its unit), TypeScript for a changed file only |
| Opening the same flow, node or calls again | asked again | **phase 7, milestone B:** the page keeps answers and ELK layouts per graph version, so going back is instant |
| Find references | TypeScript | **phase 42 (performance):** an index of every use is larger than calls; measured then |
| Entry points, UI → API links, connectors, background work (phases 8–11) | — | worked out in the graph pass and stored in the graph, like calls |
| Runtime values (phase 30) | — | stored per run, masked |
| Re-analysis after an agent step (stage 3) | — | incremental, as the pass already is |
| A workspace starting | prebuilt image | the build plan's prebuilt stack caches, with a cloud provider |

## Options considered

- **Keep the facts in the worker's memory:** no new file, but gone after every restart, and Twenty's pass reached 2.25 GB of the worker's 2.5 GB holding them.
- **Send them to the engine with the graph:** one string of tens of MB through the worker's message, and the engine holding all of it.
- **Cache TypeScript's answers as they're asked:** the first question per package would stay slow, which is what the owner asked to fix.
- **Keep TypeScript's programs warm:** gigabytes on large projects (phase 6 released them to fit Twenty at all).
- **Track changed files instead of hashing:** misses changes made while the engine is stopped; the hash check costs one small file read per answer.

## Consequences

- Flows from anywhere and node details answer in milliseconds once a project's first pass is done, and after restarts.
- The pass does a little more work and writes a second file; the engine reads a file per answer to check its hash.
- Types shown in details come from the pass that stored them: a file whose types depend on another changed file, without calling into it, keeps its stored types until the next whole-project pass. Calls into changed files are walked again, as for the graph.
