# 0031 — Connectors: what a call reaches outside the project's code, followed to its library, joined across files

- Status: accepted
- Date: 15 Nov 2026
- Phases: 9, 10 and 11, grouped (owner's decisions, decisions log 15 Nov 2026)

## Context

Until phase 8, a call into a package was an *unknown* edge: `prisma.poll.create`, `transporter.sendMail`, `trpc.polls.make.useMutation`. Phases 9 to 11 turn the ones that matter into what they are:

- **Phase 9, UI → API:** a client call (tRPC, `fetch`, axios, server actions; and Twenty's GraphQL, owner decision 5) continues into the route's handler.
- **Phase 10, data and outside services:** reads and writes with their tables (Prisma, raw SQL; and Kysely, Mongoose, TypeORM, owner decision 2); email, payments, storage, AI and fixed outside URLs as boundaries (owner decision 3).
- **Phase 11, async:** queues and workers (BullMQ; Documenso's job client and Twenty's message queue, owner decision 4), cron, events, timers and WebSockets, drawn as hand-offs to a background lane.

The corpus forks don't install their packages (phase 4), so a library is known only by the module a value is imported from, as written. And every fork reaches its libraries through its own code first: Documenso's `prisma` is `remember('prisma', () => new PrismaClient())` re-exported from `@documenso/prisma`; LibreChat's models come from a factory in CommonJS; Twenty injects repositories with decorators; Rallly's mutations run server actions through `useMutation(mutationOptions(action))`.

## Options considered

1. **Match calls by name** (`*.poll.create`, `*.sendMail`): quick, but it would guess: any object with a `create` method would be a database write.
2. **Resolve into `node_modules`**: exact where the packages are installed, but they aren't in the corpus, and a workspace that hasn't installed yet would show nothing.
3. **Follow each value back through the project's code to its import** (chosen): the checker resolves the project's own declarations (imports, variables, destructuring, class fields, typed parameters, `extends`, a function's returned value), and the trail ends at the package it's imported from, written as the code writes it. A rule then reads that trail.

## Decision

### 1. `originOf`: where a value comes from

`@flowcanvas/connectors-web` gains `originOf(context, expression)`: the module and export a value comes from (`@prisma/client`, `PrismaClient`) and the steps from there (`new`, a call with its string arguments, property names, a callback's parameter). It follows imports into the project, `require`, variables and destructuring (object and CommonJS), class members, typed parameters (a class's `extends`, `typeof import('m')`, a qualified `Prisma.TransactionClient`), a project function's single returned value, a function typed to hand back what it's given (`remember<T>(name, getValue: () => T): T`, read from its declared types; several returned values when all come from one import), `a || b`, and a callback's parameter (`$transaction(async (tx) => …)`). What it can't follow is null: the rule then doesn't match, and the call stays unknown.

### 2. Rules per library, never by name alone

- **Data** (`dataOf`): Prisma (a client's or transaction's model accessor and method; the table from the project's `schema.prisma`, `@@map` included), Kysely (`selectFrom('T')` on a Kysely value or a Prisma client's `$kysely`), raw SQL (tagged templates and `$queryRaw`; the tables the fixed text names; `FOR UPDATE` names none), Mongoose (a model's name, from `mongoose.model('User')` or `models.User`; shown as a model, not guessed into a collection's name), TypeORM (`@Entity('user')` or `{ name: 'user' }` through `Repository<E>` or `@InjectRepository(E)`; a repository getter's last string argument, Twenty's `getRepositoryForWorkspace(id, 'person')`; `@Entity()` with no name says the table isn't known).
- **Outside services** (`serviceOf`): the client's calls of nodemailer, Resend, SendGrid, Postmark, Stripe, S3 (and its presigner), OpenAI and Anthropic; not the constructor or configuration. `fetch` and axios to an absolute URL the code fixes (or a template's fixed start).
- **Links** (`linkOf`): tRPC by the procedure's path (`mutate` on a `useMutation` is the request, not the hook); `fetch` and axios with the app's own paths, through one level of the project's wrappers (`request.post(url)` → `axios.post(url)`) and URL builders (`endpoints.login()`), a value as `:param` and an unknown base as `{NAME}` (phase 8's convention); Apollo by operation and root field, from `gql` text or a generated document object.
- **Mutations through hooks** (`mutationFunction`): `mutation.mutate()` on React Query's `useMutation` (`mutationFn`, `mutationOptions(action)`, v4's function argument) or next-safe-action's `useAction` reaches the function it was given: a convention edge to it, or, for an inline function, the API links it makes (two levels through the project's functions).
- **Hand-offs** (`handoffOf`, `receiversOf`): two halves joined by a key. Sending: Twenty's queue service `add`/`addCron` (its queue from `@InjectMessageQueue`), Documenso's `triggerJob({ name })`, BullMQ's `queue.add`, Node's and NestJS's `emit`, timers, `new WebSocket`. Taking: a `@Processor`'s `@Process` method, a job definition's `handler`, a BullMQ `Worker`, `@OnEvent`, `on(…)`. A timer that only resolves a promise is a pause, not a hand-off.

### 3. In the graph pass

A call the pass can't resolve inside the project is offered to the connectors (`FileConnector`): a table, service or hand-off becomes a node (one per table and operation, per service, per hand-off key) with a `data`, `boundary` or `handoff` edge of `convention` provenance, in place of the unknown stub. A built-in the connectors recognise (`fetch` to a URL, a timer) is a connection; other built-ins are still only counted (owner, 12 Nov 2026). A link is recorded and joined after the pass to its entry point (tRPC path, method and path segment by segment, GraphQL field), replacing that line of the unknown edge (and of the copy through a decision); one that matches nothing stays unknown. A receiver's anonymous handler becomes a unit as an entry point's does (ADR 0030 §3), and each hand-off node is joined to its receivers, at the receiver's line.

### 4. Graph format 5

`GraphNode.data`, `.service` and `.handoff` carry each kind's details (library, table, operation, URL, name, and whether it's fully detected, with why), encoded in the node's details slot by its kind. Guarded lines are kept on data, boundary and hand-off edges too, so a flow draws a guarded write through its decision. The protocol checks each node's details and accepts every edge kind in a flow.

### 5. On the canvas

Each kind has Graphite's icon (data, external service or AI, queue) and says what it is under its name ("write · Prisma"); what isn't fully detected says so, and the inspector says why. A convention edge carries its framework's badge (Graphite: "framework glyph"); a hand-off a clock (design brief: "async hand-off arrow with clock icon"). What a hand-off leads to, and nothing the main flow reaches otherwise, is laid out on its own in a framed Background lane below the main flow.

## Consequences

- Flows cross from a form into its API's handler, on to its tables and outside services, and into the background where work is handed off: the three *Done when*s, proven on the forks by the Docker corpus test against hand labels.
- Unknown edges fall (Rallly: about 70 mutations now reach their server action or API), but the rule set is a list: a library or pattern not on it stays unknown, and is added when a project needs it. Nothing is matched by a name alone.
- `originOf` is the most intricate reader in the engine; each rule it follows has a test, and the labels hold it to the forks.
- The pass does more per call; measured on the forks with the graph times the Docker test records.

## Addendum (15 Nov 2026): what the forks taught, and an installed package's types

Comparing the engine with an independent text scan of each fork's connector sites, and reading every difference in the code, found about 25 rules `originOf` and the pass needed. They're general TypeScript patterns, not one fork's: re-exports of a module the repository doesn't have (Rallly's generated Prisma client) and of a type; a variable set later; a union's one real type; several returns that agree; a function typed to hand back what it's given; React's `cache` and lodash's `memoize` as pass-through wrappers; destructured parameters by their default, declared type, or as a callback's; a parameter typed by its function's declared type; type aliases; a property a type declares; dynamic and namespace imports. And in the pass:

- **Calls into the project's own code** still hand off and link: `jobs.triggerJob` on Documenso's own job client, a wrapper's `request.post(url)`.
- **A connection is drawn at its method's line** (`.selectFrom` in a chain written over lines).
- **Bundled output is skipped:** a file with a line over 10,000 characters is built code; the connectors aren't asked about it (Twenty's 1 MB minified seed bundle took 418 s alone).
- **Declarations built into `dist/types`** reach the source they mirror (`src/index.ts`), so LibreChat's client reaches its data provider.
- **Not fixed by these:** a value the code hands through a prop (LibreChat's login form's `onSubmit`), and a file over the engine's 1 MB read limit (Twenty's 1.5 MB generated GraphQL documents): both stay unknown.

**An installed package's types (owner, 15 Nov 2026).** In a user's workspace the packages are installed, so TypeScript can say what a value is however the code wraps it. Where following the code reaches nothing, the type TypeScript gives the value, when an installed package declares it, names the package and type (`node_modules/stripe`, `@types/nodemailer` for `nodemailer`). Following the code still goes first: it knows a Prisma model's accessor and a Mongoose model's name, which a type doesn't. The corpus forks don't install their packages, so this is proven by unit tests until the workspaces install (phase 37).

## Addendum (15 Nov 2026): what takes handed-off work is an entry point

**Owner, on the report's first question:** list jobs, cron and events in the entry points panel now, before acceptance. Phase 8's panel said "Arrives in phase 11" for both groups.

- **Where:** after the join, each receiver the pass found becomes an `entry-point` node, kind `job`, `cron` or `event` (three new `ENTRY_KINDS`), with a `convention` edge to its handler, so `listEntryPoints`, the `entryPoints` request, the panel and Show flow work as for every other entry point. Its id is `(entry <key>)` (`~2` and on for several receivers of one key); its name is the key as a person reads it (`email-queue · EmailSenderJob`, `send.signing.requested.email`, `user.created`); its place is its handler's.
- **Cron:** a job is cron when the code schedules it: its definition has a schedule (Documenso's `trigger.cron`), or a cron hand-off (Twenty's `addCron`) has its key. Otherwise a job.
- **Not listed:** a receiver in a test or story file (owner, 14 Nov 2026, as phase 8's entry points); it still takes its hand-off. A receiver whose handler isn't in the graph lists nothing, rather than an entry point going nowhere.
- **Graph format 6,** so a stored graph without them is rebuilt rather than read as having none.
- **Proof:** the labels in `corpus/labels/entry-points.json` (Rallly and Documenso whole, phase 8's modules of LibreChat and Twenty, and Twenty's email module for the phase 11 worker), from an independent text scan read in the code, held by the Docker corpus test with every other entry point (every one found, no false finds).

