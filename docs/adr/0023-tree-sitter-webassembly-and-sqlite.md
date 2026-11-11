# 0023 — Parsing with tree-sitter in WebAssembly, and the index in `node:sqlite`

- Status: accepted
- Date: 9 Nov 2026
- Phase: 4, step 1 (spike)

## Context

Phase 4 builds the indexer: *a tree-sitter parse of every file; symbols into SQLite; symbol search; re-index changed files on save.* *Done when:* both forks (Rallly and Documenso) index in under 30 s, and symbol search answers in under 100 ms. The owner decided that "every file" means every file of a language we ship a grammar for: TypeScript, TSX, JavaScript, JSX, CSS, JSON, HTML and Markdown (decisions log, 9 Nov 2026). MDX is parsed as Markdown, with its components not read (owner, 9 Nov 2026).

The engine runs inside the workspace container (CLAUDE.md §7, process boundaries). That container has a read-only root filesystem, runs as uid 1000, and has 2 CPUs and 4 GiB (ADR 0016, ADR 0019).

## Decisions

### 1. tree-sitter runs as WebAssembly (`web-tree-sitter`), not as a native Node addon

`web-tree-sitter` 0.27.2 (MIT) runs the parser as one `.wasm` file, and each grammar is another `.wasm` file.

- **Nothing is compiled when packages are installed,** so there are no build tools in the image, no native ABI tied to a Node version, and the same files run on the laptop, in CI and in the cloud.
- **The grammars' install scripts are denied** (`allowBuilds: false` in `pnpm-workspace.yaml`). They only build the native bindings, which we don't use. We load the ready-made `.wasm` each package ships.
- **It's fast enough** (measured below): about 30 times under the budget on the larger fork.

*Rejected:*
- **The native `tree-sitter` addon:** faster per file, but it needs node-gyp, a C++ toolchain and a rebuild for every Node major. Speed isn't the problem here.
- **The TypeScript compiler API for everything:** it only reads JS and TS, and is far heavier for "find the symbols". It comes back for name resolution in phase 5.

### 2. Grammar sources

| Language | Package (version, licence) | File |
| --- | --- | --- |
| TypeScript, TSX | `tree-sitter-typescript` 0.23.2, MIT | `tree-sitter-typescript.wasm`, `tree-sitter-tsx.wasm` |
| JavaScript, JSX | `tree-sitter-javascript` 0.25.0, MIT | `tree-sitter-javascript.wasm` |
| CSS | `tree-sitter-css` 0.25.0, MIT | `tree-sitter-css.wasm` |
| JSON | `tree-sitter-json` 0.24.8, MIT | `tree-sitter-json.wasm` |
| HTML | `tree-sitter-html` 0.23.2, MIT | `tree-sitter-html.wasm` |
| Markdown, MDX | `@tree-sitter-grammars/tree-sitter-markdown` 0.3.2, MIT | **built by us** (below) |

Extensions are matched without regard to case: `.ts .mts .cts`, `.tsx`, `.js .mjs .cjs .jsx`, `.css`, `.json`, `.html .htm`, and `.md .mdx` (`packages/engine/src/grammars.ts`).

### 3. We build the Markdown grammar ourselves, reproducibly (owner, 9 Nov 2026)

No published package ships Markdown as WebAssembly (not the grammar's own package, and not `tree-sitter-wasms` 0.1.13). The grammar's package does ship its generated C source (`parser.c` and `scanner.c` for the block and inline layers). So `tools/grammars/build-markdown.sh`:

1. **Downloads pinned inputs and checks each one's SHA-256 before use:**
   - the tree-sitter CLI 0.27.2 (the same version as `web-tree-sitter`)
   - wasi-sdk 34.0 and binaryen 132, the exact toolchain that CLI version names in `crates/loader/{wasi-sdk-version,binaryen-version}`
   - the grammar's npm tarball, whose SHA-256 matches the registry's sha512 integrity
2. **Compiles in a Flowcanvas-labelled container** (`node:26-slim` pinned by digest, the workspace image's base) with **no network**, 2 CPUs and 2 GiB, with every input mounted read-only. Nothing is installed on the machine.
3. **Writes** `tree-sitter-markdown.wasm`, `tree-sitter-markdown-inline.wasm`, the grammar's licence, and `markdown.sha256` to `packages/engine/grammars/`. These are committed.

**The build is reproducible:** two builds produce byte-identical files, and `--check` rebuilds in a temporary folder and compares the checksums. A unit test checks the committed files against `markdown.sha256` on every run.

*Rejected:*
- **Building it inside the workspace image's Dockerfile:** every image build would download about 300 MB of toolchain, and the image would depend on GitHub's availability.
- **Emscripten:** tree-sitter 0.27 compiles grammars with wasi-sdk now. The `emscripten/emsdk` image is 825 MB, against 192 MB plus 117 MB.
- **Listing Markdown without parsing it:** the owner chose to build it.

### 4. The index is SQLite through Node's built-in `node:sqlite`, with FTS5

Node 26's `node:sqlite` (SQLite 3.54.0) is built in, so there's no native addon here either. FTS5 with the `trigram` tokenizer finds a name by any part of it (`pollUs` in `createPollUser`), not only from the start. The database is one file per workspace in the workspace volume, outside the project, under `/workspace/.flowcanvas/`. It runs with WAL and `synchronous = NORMAL`, and the whole index is written in one transaction.

*Rejected:*
- **`better-sqlite3`:** a native addon, which is what decision 1 avoids.
- **An in-memory index only:** it's rebuilt on every wake. The database is also what phases 5 and 6 build on.

## Measurements (the spike)

Run in the workspace image with the workspace's limits (2 CPUs, 4 GiB, read-only root, no network), against each fork at its pin, on one thread.

| | Rallly `8e67a21` | Documenso `d4e6eea` |
| --- | --- | --- |
| Files (git) | 1,959 | 2,986 |
| Parsed (shipped grammars) | 1,472 | 2,510 |
| Not parsed (no grammar: SQL, images, Prisma, fonts…) | 487 | 476 |
| Text parsed | 6.7 MB | 13.7 MB |
| Load the runtime and 8 grammars | 53 ms | 45 ms |
| **Parse every file, plus a symbol query on TS and JS** | **1.6 s** | **3.1 s** |
| Files whose tree has a syntax error (still parsed; tree-sitter recovers) | 10 | 5 |
| Memory (resident) | 130 MB | 147 MB |

Slowest files: a 45 ms Markdown file in Rallly, and Documenso's `package-lock.json` at 116 ms.

**SQLite at 100,000 symbols** (both forks have under 6,000):

| | |
| --- | --- |
| Insert, in one transaction, plus the FTS rebuild | 404 ms |
| Trigram search, top 50, over 500 queries | p50 11 ms, **p95 18 ms**, max 24 ms |
| Prefix search (`LIKE 'x%'`) | p50 0.2 ms, p95 8 ms |
| Memory | 75 MB |

**Image size:** the eight grammars and the runtime come to about 4.2 MB of `.wasm`. Only these files go into the image (step 3), not the packages' native prebuilds.

## Consequences

- **Risk R1** (too slow) is closed: 3.1 s against 30 s on the larger fork, with room for symbol extraction and the database writes.
- **Risk R4** (`node:sqlite` lacks something): FTS5, transactions and WAL all work.
- **Risk R2** (laptop): one thread and under 150 MB, inside the container's limits.
- **Risk R3** (image size): about 4 MB.
- **Upgrading Markdown** means changing the pins in the script, rebuilding, and committing the new files and checksums. Moving the CLI to a new version means taking the wasi-sdk and binaryen versions it names.
- **If a Markdown package ever ships WebAssembly,** we can switch to it and drop the script (upgrade-later).
