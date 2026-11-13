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
| The Calls tab | TypeScript every time, seconds the first time per package | **phase 7, step 4:** callees, and the callers of functions, components and classes, from what the pass stored (see the addendum); members' callers, and anything while files are changing, from TypeScript |
| Go to definition | TypeScript | **phase 42 (performance), with Find references:** both work on any name, not only calls |
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

## Addendum: the Calls tab (phase 7, step 4, 13 Nov 2026)

**How.** The pass's walk already resolves every call. It now also records each unit's calls in the Calls tab's shape: one entry per callee and relation, each call once, with its site (line and column). Names, kinds and containers follow TypeScript's rules: a built-in is named as the compiler names its symbol (`split`, `Promise`); a call into an installed package is resolved with no place; a call it can't resolve is listed by its text. The store also keeps which files call each place (`calls_into`), so a function's callers are its callers' own stored calls, as TypeScript's incoming calls are.

**When the store answers:** on a function's name (where the Calls tab asks), with the graph up to date with every change (no edit since the last pass began), and every file involved still the text its facts came from. **TypeScript answers:** a member's callers (methods, and properties holding functions, are reached through types and interfaces, which TypeScript follows by implementation), and everything else.

**Measured.** Compared with TypeScript at 710 function names (300 sampled in Rallly, 40 in Documenso, every labelled function in both, callers and callees each): 705 identical. The 5 left are TypeScript's own: 3 built-in rows (its call hierarchy names `Math.max` with no container but `window.matchMedia` with one, and lists some property reads, `el.style`, as calls), and 2 functions passed as values that it lists as calls (`dynamic(() => import(…).then((m) => m.RichTextEditor))`, `{ setView: instance.api.setView }`). The store's answer in those 2 is the more accurate one. Answers took 2.9 ms on average from the store and 7.8 ms from TypeScript on Rallly; 48 ms and 556 ms on Documenso (where members' callers still go to TypeScript). Twenty's pass: 93.6 s (87 to 92 s before), heap 2.09 GB, 97.8 MB stored (29.6 MB before).

**Tried first, and dropped:** asking TypeScript's call hierarchy for every unit during the pass, so the stored answers would be TypeScript's by construction. Twenty's pass went past 10 minutes (from 87 s); Documenso's past 10 minutes too.

**Found on the way:**
- **The live Calls tab dropped calls it couldn't resolve that start where a resolved one does** (`getStripe().subscriptions.update()` starts where `getStripe()` does). It matched calls by where they start; now by the whole callee. Found because the stored answer listed the call and the live one didn't.
- **A class property holding a function was placed at the arrow's start**, not its name, so its stored answers didn't line up with TypeScript's; now at its name, like a constant's.
- **Containers follow TypeScript:** a class, namespace or object literal; an interface for a property holding a function, but none for a method signature; none inside a function.
