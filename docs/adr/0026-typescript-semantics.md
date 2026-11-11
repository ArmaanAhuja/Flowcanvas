# 0026 — TypeScript semantics: the compiler's language service, per tsconfig, in a capped worker

- Status: accepted
- Date: 12 Nov 2026
- Phase: 5, step 1 (spike)

## Context

Phase 5 builds *a TypeScript compiler API service: definitions, references, type-resolved call edges; callers and callees panel*. *Done when:* callers and callees for 20 hand-picked functions match a manual check.

The owner's decisions (decisions log, 12 Nov 2026):
- **Project code only:** a workspace has no `node_modules` unless the person installs them, and nothing installs by itself. Calls into packages show as unresolved.
- **Rendering counts as a call** ("renders").
- **The Calls tab** in the right panel shows the results.

The engine runs in the workspace, with 2 CPUs and 4 GiB (ADR 0025). Upgrade-later 3 was checked: TypeScript 7's API is still unstable, so this is TypeScript 6.0.3.

## The spike (12 Nov 2026)

Each fork ran at its pin in the workspace image with the workspace's limits and no `node_modules`, using one language service per `tsconfig.json` with a shared document registry:

| | Rallly | Documenso | Twenty |
| --- | --- | --- | --- |
| tsconfigs | 12 | 16 | 38 |
| Every program built | 4.2 s | 7.2 s | **out of memory** at about 3.2 GB, before the server package (the front end alone: 10,686 files, about 1.1 GB) |
| Memory with every program | 0.65 GB | 1.07 GB | — |
| First call hierarchy | 0.15–0.47 s | 0.34–0.46 s | — |
| The same question after an edit | 45–79 ms | — | — |

**What else the spike found:**
1. **TypeScript's call hierarchy includes JSX:** `<CreatePoll />` counts as a call of `CreatePoll`. That's what "renders" needs.
2. **Without `node_modules`, two things break, both in the project's own code:**
   - **`extends`** to a shared config package (`@rallly/tsconfig/next.json`) fails, and with it every option.
   - **Imports of the project's own packages** (`@rallly/ui/button`) don't resolve.
3. **With no options, `jsx` is unset.** TypeScript then resolves a `.tsx` import but leaves the file out of the program, so every use of `Button` from the web app disappeared. Found by a wrong answer: `Button` had callers only inside its own package.
4. **Calls TypeScript can't resolve are simply absent** from its call hierarchy. An example is `prisma.user.findMany()` without the generated client. The owner's decision needs them shown as unresolved.
5. **The answers matched the code:** `getSigningVolume` really has no callers (it's unused), and `TemplateUseDialog`'s three callers render it.
6. **Size:** TypeScript is 9.1 MB of compiler and 3.8 MB of standard library types.

## Decisions

### 1. The language service runs in a worker thread with a heap cap

The engine starts a `worker_threads` worker on the first semantic question, with `resourceLimits.maxOldGenerationSizeMb` at 2,500 (the workspace has 4 GiB, and the indexer and SQLite need the rest).
- **If the worker runs out of memory,** only it dies. Indexing and search keep working, and the answer says "This project is too large to resolve calls in here" rather than being wrong.
- **The next question starts a new worker,** with fewer programs.

*Rejected:*
- **The engine's main thread:** Twenty showed that an out-of-memory crash there would take indexing and search down too.
- **A separate process per question:** it would rebuild programs every time, at seconds per question.

### 2. One program per `tsconfig.json`, built only when a question needs it

- **Which configs:** every `tsconfig.json` in git outside `node_modules`.
- **A file's programs:** the ones whose file list includes it. Where no config includes a file, the nearest config above it.
- **For callers,** the programs that could hold one: the file's own, plus those of packages that depend on its package, directly or transitively. Dependencies are read from each `package.json`'s `dependencies`, `devDependencies` and `peerDependencies` naming another package of the project.
- **For callees, definition and references within a package,** the file's own programs.
- **Memory:** programs share one document registry. When the worker's heap passes 70% of its cap, the least recently used program is released before another is built.

### 3. The project's own packages resolve as project code; packages from npm stay unresolved

- **`extends`:** a read of `…/node_modules/<package>/…` that doesn't exist, where `<package>` is one of the project's own packages (by the `name` in its `package.json`), is served from that package's folder. Config parsing only.
- **Imports:** each program gets `paths` entries for the project's packages, from each `package.json`'s `exports` (subpaths and `*` patterns), else `types`, `typings` or `main`. These resolve to the real source files, so they're the same files as the package's own program. The config's own `paths` take precedence.
- **Packages from npm aren't resolved.** Calls into them are unresolved, as the owner decided.

### 4. Analysis defaults where a config leaves an option unset

These defaults apply only where the config doesn't set an option, and nothing is emitted:
- `jsx: preserve`
- `module: esnext` and `moduleResolution: bundler`
- `target: esnext`
- `allowJs`, `resolveJsonModule`, `esModuleInterop` and `allowImportingTsExtensions`

`noEmit`, `skipLibCheck` and `types: []` always apply.

### 5. What a question returns, and how each answer is known

- **Definition and references:** TypeScript's language service.
- **Callers and callees:** TypeScript's call hierarchy, with each site's place.
  - A site that's a JSX element is **renders**; anything else is **calls**.
  - Every row is **resolved**: the compiler proved its target.
- **Callees TypeScript couldn't resolve:** the engine's own pass over the function's call and JSX sites adds each one whose callee has no declaration (such as `obj[key]()`, or a package with no types), marked **unresolved** with the call's text. Never guessed.
- **Callees in TypeScript's standard library** (`Math.max`, `Promise.all`) are resolved, and marked **built-in** so the page can tell them apart from the project's own code.
- **Positions:** 1-based lines and UTF-16 columns, as in ADR 0024.

### 6. Kept current through the watcher's events

The engine already hears every change (ADR 0025). A changed file's version goes up in every live program that holds it. The language service re-checks only what changed: 45–79 ms in the spike.
- **A new or deleted file, or a changed `tsconfig.json` or `package.json`,** marks the programs it affects for rebuilding on their next use.

### 7. TypeScript ships beside the engine, not inside its bundle

`typescript.js` and its `lib.*.d.ts` files are copied into `dist/workspace/typescript/`, and the worker loads them from there. TypeScript finds its standard library next to itself, and the bundle's startup doesn't pay for 9 MB it doesn't need. The engine's copy grows from about 4.5 MB to about 17.5 MB, copied only when the engine changes (ADR 0025).

## Consequences

- **The plan's two forks fit comfortably,** at 1.07 GB at most for Documenso with every program.
- **Very large projects get calls resolved for the parts that fit,** and an honest message where they don't, rather than an engine that dies. Making them comfortable belongs to the performance phase (42).
- **The first question about a package can take a few seconds** (building its program and its dependents'). Later ones are fast. The Calls tab shows it's working while it waits.
- **Generated code that isn't in git** (Prisma's client) stays unresolved until it's generated, and the page says so.
