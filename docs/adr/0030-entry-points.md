# 0030 — Entry points: detected in the graph pass, by framework, never guessed

- Status: accepted
- Date: 14 Nov 2026
- Phase: 8 (owner's decisions, decisions log 14 Nov 2026)

## Context

Phase 8 lists a project's entry points (screens and their elements, API routes, jobs and cron, events, CLI commands; design brief §23) and opens the flow from each. The owner chose to detect every framework the 4 held forks use, and raised the bar: 100% recall for convention-based kinds, at least 95% per fork for routes registered in code and for event handlers, 100% precision.

The spike read how each fork declares its entry points (`~/.cache/flowcanvas/corpus`, at the pins):

| Fork | Screens | API | Declared by |
| --- | --- | --- | --- |
| Rallly | Next.js app router: `app/**/page.tsx` (75) | Next.js `route.ts` (18), most handing every request to a Hono app (`export const GET = handle(app)`); Hono routes (`new Hono().basePath('/api/private')`, `app.get('/polls', …)`); tRPC procedures (`router({ spaces })`, `listMembers: spaceProcedure.query(…)`, nested across files); server actions (`'use server'`) | Files, and calls on known objects |
| Documenso | React Router through `remix-flat-routes` (`app/routes/**`, 141 files: `_authenticated+/` adds no path, `$id` is a parameter, `_index` an index, `.` a separator); each route's `loader` and `action` run on the server | Hono and tRPC, as Rallly | Files and their exports |
| LibreChat | React Router (`<Route path>`, route objects) | Express: `router.get('/:id', …)` in `api/server/routes/*.js`, mounted with `app.use('/api/auth', routes.auth)` through `routes/index.js`'s `require`s (CommonJS) | Calls, across files |
| Twenty | React Router, paths from enums (`AppPath.…`) | NestJS: `@Controller(ApiPath.Mcp)` and `@Post()` (184 methods); GraphQL `@Query()` and `@Mutation()` methods (594, in 126 resolver files) | Decorators |

Every fork's `package.json` files have scripts (92 to 235); event props (`onClick={…}`) number from about 550 (Rallly) to 6,300 (Twenty).

## Options considered

1. **A separate scan with tree-sitter** (the indexer's parser): fast, but it can't follow an import, an enum's value or a router mounted in another file, which most route paths need.
2. **In the graph pass, with TypeScript's checker** (chosen): the pass already walks every file of every program with the checker in hand, so a constant's value (`ApiPath.Mcp`), an imported router or a mounted path can be resolved where it is, at almost no extra cost.
3. **At run time** (asking the running app its routes): exact for the routes that exist, but needs the app running; that's stage 2's, and it would hide what the code alone says.

## Decision

### 1. Detectors in `@flowcanvas/connectors-web`, run by the pass

One detector per framework: Next.js (pages, route handlers, server actions), React Router (route objects and `<Route>`, and `remix-flat-routes` file names), Express, Hono, tRPC, NestJS (controllers and GraphQL resolvers), React event props, and package.json scripts. Each is a pure function over a file's syntax tree with a small interface to the checker (a constant's value, a symbol's declaration), tested on fixtures. The pass calls them as it walks each file; what one file can't settle (a router mounted elsewhere, a tRPC router nested from another file) is joined after the walk, from what every file reported.

### 2. What an entry point is

- **Kinds:** a screen (a route that renders a page), an element (an event prop on a JSX element: `onClick`, `onSubmit`, …), an API route (an HTTP method and path, a tRPC procedure, a GraphQL operation, a server action, a React Router `loader` or `action`), a CLI command (a package.json script). Jobs, cron and events are phase 11's.
- **Named** as the code names it: a screen by its path (`/settings/profile`, its component muted beside it; owner, 14 Nov), an API route by method and path (`POST /api/private/polls`), a procedure by its full name (`spaces.listMembers`), a GraphQL operation by its name and kind, a script by its package and name.
- **In the graph:** an `entry-point` node (the kind phase 6 defined) at the place it's declared, with an edge to the code that handles it, provenance `convention` (found by the framework's rules, not by the compiler's own resolution).
- **Elements belong to screens** through the graph's `renders` edges: an element is listed under every screen whose component renders, directly or not, the component it's in.

### 3. Handlers without names

Most route handlers are anonymous functions (`app.get('/polls', async (c) => {…})`). For the graph, an anonymous function registered as an entry point's handler becomes a code unit of its own, named after its entry point, and the calls in its body are its calls: its flow is the handler's, not the whole file's. The Calls tab keeps TypeScript's view (an anonymous callback's calls belong to the function or top level around it; owner, 12 Nov), so the pass records the two separately. Where a phase 6 label listed a file's top level as the caller of something now called from a handler, the label changes with it, and says why.

### 4. Never guessed

A path the checker can't settle (built in a loop, joined from a variable whose value isn't constant) is listed with what is known (`GET /api/:unknown`), marked **not fully detected** (the item's support dot, design brief §23), with the reason in the inspector. A mount that can't be followed keeps its routes, without the prefix, marked the same way. Nothing is invented to fill a gap; the report lists every miss.

### 5. Stored, and answered at once

Entry points are stored with the graph (its nodes and edges), so the panel reads the latest version and opens without asking TypeScript (ADR 0029). An `entryPoints` question to the engine answers from it, with the API route `…/index/entry-points`.

## Consequences

- The graph gains entry-point nodes and, for anonymous handlers, code units; snapshots grow accordingly (measured on Twenty in step 3).
- Phase 6's graph labels may change where a handler now owns calls a file's top level owned; each change is checked by reading the code.
- New frameworks are new detectors in the same package (the plugin SDK, from stage 7, will take the same shape).
- Run-time-only routes stay not fully detected until stage 2 observes them.
