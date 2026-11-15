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
