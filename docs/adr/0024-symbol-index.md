# 0024 — The symbol index: what a symbol is, how it's stored, and how it stays current

- Status: accepted
- Date: 9 Nov 2026
- Phase: 4, step 2

## Context

ADR 0023 chose tree-sitter in WebAssembly and `node:sqlite`. This record covers what the engine extracts and stores, and how it keeps the index in line with the files without re-parsing everything. The build plan asks for *symbols into SQLite; symbol search; re-index changed files on save*, and ⌘K must "jump to any function in Rallly".

## Decisions

### 1. Symbols are read from syntax alone

`packages/engine/src/symbols.ts`.

**TypeScript and JavaScript (with TSX and JSX):**
- **What counts:** declarations at module level (and inside `namespace`s), plus class methods.
- **What doesn't:** locals and functions nested in functions. ⌘K is for finding where something is defined, and nested helpers would multiply the list without helping.
- **Kinds:** `function`, `component`, `class`, `method`, `interface`, `type`, `enum`, `constant`, `namespace`.
- **Variables:**
  - `const f = () => …` and `const f = function () {}` are functions.
  - `let` and `var` holding a function are functions too. Other `let`/`var` values aren't symbols.
  - Other `const` values are constants.
  - Destructuring declares no single name, so it's skipped.
- **A component** is a PascalCase function whose body contains JSX, in a TSX, JSX or JS file. A PascalCase `const` wrapping such a function in a call (`forwardRef(…)`, `memo(…)`) is also one. This is React's own convention, read from the tree. Nothing is guessed from imports.
- **`exported`** is true for `export …` declarations, for names listed in `export { … }` without `from`, and for members exported from a namespace.

**Markdown and MDX:** headings (ATX and setext), each with its parent heading as its container. Closing `#`s and repeated spaces are dropped.

**CSS, JSON and HTML** are parsed and counted, with no symbols (owner, 9 Nov 2026).

**Positions:**
- the 1-based line and column of the name
- the column is in UTF-16 code units, which is how web-tree-sitter and CodeMirror both count, so a jump lands on the name even after an emoji

*Rejected:*
- **tree-sitter's bundled `tags.scm` queries:** they tag every call and reference too, which is phase 5's job, and they don't tell components from functions.
- **Every function in the file:** too many entries, most of them closures.

### 2. The store

`packages/engine/src/store.ts`:
- **`files` table:** one row per path, with its version, language, status, whether its tree has syntax errors, and any limitation.
- **`symbols` table:** each symbol, deleted with its file.
- **`symbol_names`:** an external-content FTS5 table, kept in step by triggers.
- **Status:**

  | Status | Meaning |
  | --- | --- |
  | `parsed` | Read and parsed; may still have syntax errors, since tree-sitter recovers and the rest of the file keeps its symbols |
  | `no-grammar` | No grammar for this file type |
  | `too-large` | Over 1 MB, the agent's file limit (lockfiles, bundles) |
  | `binary` | A NUL byte in its first 8 KB |
  | `unreadable` | Couldn't be read: a link, a non-file or an error |

  Every file is counted, so the page can say honestly what wasn't parsed and why.
- **Format:** the database's `user_version` holds `INDEX_FORMAT`. An index written in another format is dropped and rebuilt rather than migrated. It's a cache that rebuilds in seconds, and an unchanged file would otherwise keep symbols extracted by old rules. Raise `INDEX_FORMAT` whenever the schema or the extraction rules change.
- **Settings:** WAL, `synchronous = NORMAL`, foreign keys on. Each batch is one transaction.

### 3. Incremental by content

`packages/engine/src/indexer.ts`:
- **A file's version is the SHA-256 of its bytes,** the same as the agent's file version (ADR 0022). A file whose version is already indexed isn't parsed again, and a rewrite with the same bytes changes nothing.
- **`sync(files)`** takes the whole file list (the agent's, from git). It drops paths no longer listed, then inspects the rest in batches of 100 and parses only new or changed files. Files it doesn't read (no grammar) are recorded once and left alone.
- **`refresh(changes)`** takes the watcher's changed and deleted paths (ADR 0022) and re-checks only those.
- **Runs are queued:** one at a time, so a refresh never writes in the middle of a sync. A failed run doesn't block the next.
- **Between batches the indexer yields,** so the engine process can answer a search while it indexes (step 3).

### 4. What is never indexed

`indexable(path)`:
- **secret files,** by the agent's rule (`isSecretFile`: `.env`, `.env.*` except example, sample and template, `.dev.vars`). Not even their names are stored. Rallly's `apps/web/.env.test` is skipped by this rule.
- **anything in the ignored folders** (`node_modules`, `.git`, build output)
- **any path that is absolute, has `.`, `..` or empty segments, or is over the path limit**
- **links,** which are never followed (`lstat`), so a file outside the project is never read through one

## Measurements

The real engine, cold and then unchanged, in the workspace image with the workspace's limits (2 CPUs, 4 GiB, read-only root, no network):

| | Rallly | Documenso |
| --- | --- | --- |
| Files checked | 1,958 | 2,986 |
| Parsed | 1,472 | 2,508 |
| Not parsed | 486 no grammar | 476 no grammar, 2 too large |
| Symbols | 5,633 | 9,886 |
| Syntax errors (still parsed) / MDX partly read | 10 / 45 | 5 / 143 |
| **Cold index** | **1.8 s** | **3.4 s** |
| Again, nothing changed | 52 ms | 85 ms |
| Peak memory (resident) | 155 MB | 166 MB |
| Database | 1.8 MB | 3.5 MB |

## Consequences

- **The 30 s target is met with a wide margin** on both forks. Step 6's corpus test enforces it in a real workspace.
- **Symbol kinds are syntactic.** A "component" is the convention, not proof that React renders it. Phase 5 adds resolution.
- **Search (step 3) reads `symbol_names`.** Trigram search needs at least three letters, so shorter queries use the name index (`COLLATE NOCASE` prefix).
