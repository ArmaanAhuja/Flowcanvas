# Phases 9 to 11 — Connectors: report

- Version: `0.13.0`
- Branch: `phase/9-connectors`; PR #23
- Dates: 15 Nov 2026
- Status: **in review**, waiting for the owner's acceptance.

## From the build plan

Grouped into one branch, report and acceptance (owner, 15 Nov 2026), each phase's *Done when* and *Try it* proven on its own.

- **Phase 9, UI → API connector**
  - **Build:** link `fetch`, axios, tRPC and server-action calls to their route handlers by URL, method and params.
  - **Done when:** a form submit's flow crosses into the right handler in all 4 forks.
  - **Try it:** in Rallly, open the "Create poll" submit; the flow continues into the API handler.
- **Phase 10, Data and external connectors**
  - **Build:** Prisma and raw SQL as data-access nodes; third-party SDK calls (payments, email, storage) as external boundaries.
  - **Done when:** reads and writes show table names; email and payment calls show as boundaries.
  - **Try it:** in Documenso, open "Send document"; see the database writes and the email boundary.
- **Phase 11, Async connectors**
  - **Build:** BullMQ queues and workers, cron, event emitters, WebSockets, timers; drawn as hand-offs to a background lane.
  - **Done when:** a "send email" flow shows enqueue → queue → worker → result.
  - **Try it:** in Twenty, open a job flow and see the background lane.

**Owner decisions** (decisions log, 15 Nov 2026):
1. **The bar, as phase 8's:** 100% precision; at least 95% recall per fork; every miss explained and shown as not fully detected. Labels: every connector site in Rallly and Documenso, and in phase 8's fixed modules of LibreChat and Twenty.
2. **Data libraries beyond the plan's:** Kysely, Mongoose, TypeORM.
3. **Outside services:** email (nodemailer, Resend), payments (Stripe), storage (S3), AI (OpenAI), fixed outside URLs.
4. **Queues beyond BullMQ:** Documenso's job client and Twenty's message queue.
5. **Twenty's GraphQL** is a UI → API link.
6. **An installed package's types** name a value's package where following the code doesn't ("not for phase 41").
7. **The pace:** one report per phase group, phases 9 to 11 grouped, docs once per phase; then option C: finished at this bar, however long it takes.

## Result

| Item | Result | Evidence |
| --- | --- | --- |
| **Phase 9 · Done when:** a form submit crosses into the right handler, all 4 forks | ✅ | Chains in `corpus/labels/connections.json`, held in real workspaces by the Docker corpus test: Rallly's Create poll (`CreatePoll`) → tRPC `polls.make` → its handler; Documenso's document edit form (`sendDocumentWithSubject`) → `document.distribute` → its handler; LibreChat's login (the auth context's `login`, given to `LoginForm` as its `onSubmit`) → `POST /api/auth/login` → `loginController`; Twenty's credit grant form (`handleSubmit`) → GraphQL `grantWorkspaceCredits` → its resolver |
| **Phase 10 · Done when:** reads and writes show table names; email and payment calls are boundaries | ✅ | Every data site labelled with its table and read or write (Rallly 393, Documenso 1,115, Twenty 7); email and payment calls as boundaries (Rallly 52, Documenso 53, Twenty 13); Documenso's chain: `sendDocument` writes `Envelope`, and its signing email reaches `Email · nodemailer` through its job |
| **Phase 11 · Done when:** a send email flow shows enqueue → queue → worker → result | ✅ | Twenty's chain: `EmailService.send` → the `email-queue · EmailSenderJob` hand-off → `EmailSenderJob.handle` → `EmailSenderService.send` (the driver it sends through is chosen at run time, so the flow stops honestly there) |
| **The bar** | ✅ **met on all 4 forks** (see below) | Every label read against an independent scan; 0 false finds; the one miss explained |
| **Phase 9 · Try it** | ✅ recorded | `e2e/try-it/phase-9.spec.ts`: Rallly's `CreatePoll` by ⌘K, its flow crossing into `mutation polls.make` and its handler, badged tRPC |
| **Phase 10 · Try it** | ✅ recorded | `e2e/try-it/phase-10.spec.ts`: Documenso's `sendDocument` with its Prisma writes (`Envelope`, `Recipient`, `DocumentMeta`, `DocumentAuditLog`, `Field`), one inspected; the signing email's runner with `Email · nodemailer` |
| **Phase 11 · Try it** | ✅ recorded | `e2e/try-it/phase-11.spec.ts`: Twenty's `EmailService.send`, the hand-off with its clock, `EmailSenderJob.handle` in the framed Background lane, the hand-off inspected |

The walkthroughs answer with the engine's own flows, cut from each fork's graph at its pin (`e2e/try-it/fixtures/phase-9-rallly.json`, `phase-10-documenso.json`, `phase-11-twenty.json`).

**The bar, in real workspaces on CI** (run 43712385746, `aece166`):

| Fork | Scope | Data | Services | Hand-offs | Links | Missed | False finds | Chains | Graph built |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Rallly** | everything | 393/393 | 52/52 | 19/19 | 105/105 | 0 | 0 | 1 of 1 | 28.7 s |
| **Documenso** | everything (`packages/ee` aside) | 1,115/1,115 | 53/53 | 94/94 | 336/337 | 1, explained | 0 | 3 of 3 | 46.3 s |
| **LibreChat** | phase 8's modules | — | — | 5/5 | — | 0 | 0 | 1 of 1 | 120.6 s |
| **Twenty** | phase 8's modules | 7/7 | 13/13 | — | — | 0 | 0 | 2 of 2 | 198.9 s |

**How the labels were made:** the engine's sites were compared with an independent text scan of the same files (it shares no code with the connectors), and every difference was read in the code. Where the engine was wrong it was fixed, about 25 times, each with a test (ADR 0031 addendum); where the scan was wrong it's noted in the labels (a React state setter named `setInterval`, a tRPC procedure named `stripe`, better-auth's `account`); what the engine still misses is labelled with why. Each engine-only site's source line was checked for the call it claims, and every shared site's table or procedure agreed.

**The miss:** Documenso's email preview app calls `fetch('/api/render')`, whose route (`packages/email/preview/app/routes/api.render.tsx`) isn't detected as an entry point, so the call has no route to join.

**LibreChat's and Twenty's labels are few** (5 and 20) because phase 8's modules are mostly route files that hand their work to services elsewhere. The engine finds far more across those forks (LibreChat 1,311 data and 340 link edges; Twenty 913 and 266), but those sites aren't hand-labelled, as the owner's scope set. Widening the labels there is a question below.

## How to try it

**Locally,** after `pnpm dev` (http://localhost:5173), with each fork's corpus project open and its workspace running:
1. **Rallly:** ⌘K, `CreatePoll`, **Show the flow from CreatePoll**. The flow crosses from the form's submit into `mutation polls.make` (badged tRPC) and its handler.
2. **Documenso:** ⌘K, `sendDocument`, Show its flow: its writes to `Envelope`, `Recipient`, `DocumentMeta`, `DocumentAuditLog` and `Field`; click one to read its table and access. Then ⌘K, `run` (in `send-signing-email.handler.ts`), Show its flow: `Email · nodemailer`.
3. **Twenty:** ⌘K, `send` (EmailService), Show its flow: the `email-queue · EmailSenderJob` hand-off with its clock, and `EmailSenderJob.handle` in the Background lane below; click the hand-off to read it.

**On staging** (after the merge): What's new shows 0.13.0; flows need a workspace, so they work locally only for now.

## Evidence

| Suite | Count | Command |
| --- | --- | --- |
| Unit and component | 1,274 | `pnpm test` |
| Walkthroughs (recorded, production CSP) | 26 (3 new, on the engine's own flows) | `pnpm test:e2e` |
| Visual and accessibility (both themes) | 198 (4 new: the connectors' two screens, both themes) | `pnpm test:visual` |
| Docker (real containers) | 49 (the corpus test holds each fork to the bar and its chains) | `pnpm test:docker` |
| Performance | 3 | `pnpm test:perf` |

**Graph times** (CI, 2 CPUs), against the end of phase 8: Rallly 28.7 s (15.4), Documenso 46.3 s (21.4), LibreChat 120.6 s (78.5), Twenty 198.9 s (96.4), Medusa 96.6 s (140.7, its fix). The connectors roughly double the pass on most forks: each call the project's code doesn't resolve is now followed to its package. The Docker test now holds each fork to these figures plus half, so a regression fails rather than only slowing it (it would have caught Twenty's 418 s file). A question below.

## Deviations from plan and why

1. **Grouped** (owner): one branch, report and acceptance for phases 9 to 11.
2. **More libraries than the plan names** (owner decisions 2 to 5), so every fork's database, queues and API calls are covered.
3. **An installed package's types** (owner): a fallback where following the code reaches nothing; proven by unit tests, since the corpus forks don't install their packages (phase 37 does).
4. **Bundled output is skipped** (ADR 0031 addendum): a file with a line over 10,000 characters is built code; its calls stay unknown.
5. **Step 9.1's close was checked and corrected** (step 9.2): its walkthroughs drew flows written by hand, with files and tables the forks don't have; its labels were the engine's own output, with LibreChat's and Twenty's scopes widened past the owner's; the Done whens' chains weren't held; Twenty's slow build was given more time instead of fixed. All four fixed before this report.

## Decision records added

- 0031 connectors (with an addendum: what the forks taught, bundled output, an installed package's types).

## Known issues and follow-ups

- **Workspaces run on the owner's computer only** (upgrade-later 33).
- **A value handed through a prop isn't followed:** LibreChat's login form gets its submit as `onSubmit`, so the chain starts at the auth context's `login`.
- **Files over 1 MB aren't read** (phase 4's limit): Twenty's generated GraphQL documents (1.5 MB) are one, so calls to the operations in it stay unknown (its sign-in among them).
- **A driver chosen at run time** ends a flow (Twenty's email driver).
- **Flows show 60 nodes;** what's further (Documenso's email from `sendDocument`) is opened from its own flow until expanding arrives in phase 12.

**Upgrade-later review:** re-read; no item's trigger was reached in these phases.

## Questions for the owner

1. **Jobs, cron and events in the entry points panel.** Phase 8's panel says "Arrives in phase 11" for both groups. Phase 11 detects every queue worker, job handler, cron and event handler (they're what hand-offs join to), but doesn't list them in the panel yet. Recommended: list them now, as entry points of those kinds, so a person can open a job's flow from the panel (about an hour, before acceptance); the alternative is to name a later phase in the panel's text.
2. **The graph time the connectors add** (about double on most forks; Twenty 199 s on CI). Recommended: accept for now, held by the Docker test's limits, and cut it in phase 12, which reworks what a flow shows; the alternative is profiling and trimming now.
3. **LibreChat's and Twenty's labels:** keep phase 8's modules (5 and 20 sites, as decided), or widen them to the services those modules call, so more of those forks' connectors are held by hand labels? Recommended: widen in phase 12, where flows are grouped and expanded, rather than delay this acceptance.

## CI

The draft PR (#23) ran CI on every push; the close's run is run 43712385746, `aece166`.

## Next phase preview

**Phases 12 and 13** (grouped, owner):
- **12, Progressive disclosure:** semantic grouping, expand and collapse, unknown stubs, a completeness pill per flow, pinned positions.
- **13, Sequence view:** the same flow as a timeline: order, async hops, retries, failure paths; a Graph / Sequence switch.
