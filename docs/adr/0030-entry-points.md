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

## Addendum (14 Nov 2026, step 2): rules found while measuring the detectors on the forks

Each rule below came from a miss on a fork, was fixed in the detector, and is covered by a fixture test. None widens what counts as found: a part the rules don't reach is still marked not fully detected.

- **Constants are folded.** A path is a string the checker can settle: literals, templates, `+`, `.replace`/`replaceAll`/`toLowerCase`/`toUpperCase`/`trim`, enum members, single-literal types and `const` initializers, across files (Twenty's NestJS paths and settings routes).
- **Duplicate routers.** Express and Hono routers are found by how they're made (`express()`, `express.Router()`, `Router()` in ES and CommonJS, `new Hono()`, `basePath`), then joined from the roots through `use`/`route` mounts, so a router mounted twice is listed under each mount.
- **Route-file loaders and actions** are API routes named `loader /path` and `action /path`, beside the screen the same file renders.
- **React Router routes are followed wherever the code builds them:** arrays, spreads, objects (with shorthand properties), `<Route>` elements and fragments, `?:`, `&&`/`||`/`??` (a route behind a flag is still a route), variables, `export default` objects, `filter`/`map`/`flatMap`/`concat`/`slice`, `createRoutesFromElements`, and functions, with each parameter bound to its caller's argument. A function whose result has the same type as its argument and isn't otherwise followed is read as passing its routes through (LibreChat's `stripIds`). Following stops after 12 steps; children don't count towards that.
- **Lazy routes** (`lazy: …`) are screens at their path; their component is named when the engine resolves the import.
- **Server actions** are named `server action <name>`: every function or call chain a `'use server'` file exports (an action client's chain, `authActionClient.metadata(…).action(async …)`, has the function given to its last call as its handler; a chain without one is marked not fully detected), and every function marked `'use server'` in its own body. Plain values exported from such a file aren't actions (Next.js refuses them). Rallly: 71 actions in 23 files, matching a text count of their exports.

## Addendum (14 Nov 2026, step 3): in the graph pass

- **Format.** An entry point's node carries its details (`GraphNode.entry`: kind, framework, complete, why, and for an element the unit it's in): graph format 4, snapshot store format 4 (older snapshots are dropped, and the next pass makes a new one).
- **Ids.** An entry point's node is `<file>#(entry <name>)`, `~2` for a second with the same name in the file. An anonymous handler's unit is named in its scope like any unit (`<file>#PollPage.(handler <button> onClick)`, `<file>#(handler GET /:id)`, from what the file alone knows), and its display name becomes its entry point's full name once joined (`GET /api/polls/:id`).
- **Keys across files** are a declaration's file and the offset of its name, resolved by the checker in the file that refers to it. A file records the files its keys point into; a change there walks it again, so a key never goes stale.
- **Handlers.** A handler written as a function is its own unit, named or made (§3). A name is followed to its unit; a constant made by a call given a function (`useCallback(() => …)`, `form.handleSubmit(async …)`) is followed to that function, which runs when the entry point is used. A name that isn't the project's code (a prop, a `useState` setter, a library's handler) is reached by its text, with provenance unknown. A script reaches the top level of the project file it runs, when it names one; others reach nothing.
- **Route files** are found by package: a Next.js app router is `app/` or `src/app/` in a package that depends on `next`; `remix-flat-routes` routes are `app/routes/` in a package that depends on it. A route handler handing every request to a Hono app (`export const GET = handle(app)`) isn't listed: the Hono app's own routes are.
- **CommonJS mounts.** A property naming another value (`module.exports = { v1: router }`) is followed to that value, which TypeScript doesn't do itself (LibreChat's agents routers).
- **Unmounted routers.** An Express `Router()` that no followed mount reaches is mounted somewhere the code isn't followed (LibreChat's files routers, made at run time by `initialize()`): its routes are listed under `/:unknown`, not fully detected, never as a root. An `express()` app is a root. Every Hono app is `new Hono()`, so an unmounted one stays a root. Each route keeps the parts of its path that are known (`/:unknown/api/auth/session`).
- **tRPC.** A plain object in a router is a router of its own (tRPC's nested routes; Documenso's `analytics: {…}`, which took its procedures from 134 to 286). A key's value that can't be read, or a name that holds neither a router nor a procedure, is listed as `key.*`, not fully detected: never dropped. A shorthand property (`router({ polls })`) is followed to its variable (the checker gives the property itself), so Rallly's routers are named under their keys (`polls.close`), not taken for roots.
- **Asked for** (§5): `entryPoints` answers a page of one kind (at most 200, in name order, then file and line) and every kind's count, from lists worked out once per version; API `…/index/entry-points`.
- **Phase 6's labels.** Where an anonymous handler now owns calls the Calls tab gives a file's top level or a component, the label keeps the Calls tab's view and adds the graph's own lists with why (`calls.json`, `graph`: Rallly's createPoll, Documenso's normalizeBrandingColors and SignaturePad, each read at the pin). The graph's check leaves out an entry point's edge to its handler, which isn't a call between code; step 4's labels hold those.
- **Measured** (laptop, whole pass): Rallly 872 entry points in 8.6 s; Documenso 2,239 in 19 s; LibreChat 3,648 in 66 s; Twenty 7,331 in 104 s, its graph 10% more nodes (105,965) and 2% more edges than phase 7's (R1).

## Addendum (14 Nov 2026, step 4): the owner's answers to milestone A

- **Test and story files aren't entry points:** nothing is detected in `*.test.*`, `*.spec.*`, `__tests__/` or `*.stories.*` files (LibreChat: 896 fewer, mostly elements in tests). Their code stays in the graph.
- **A base path from an environment variable is named, never read:** `pathValue` writes it `{NEXT_PUBLIC_BASE_PATH}`, through a default (`|| '/'`, `?? ''`), a string method and `const`s, for `process.env.X`, `import.meta.env.X` and `env('X')`/`getEnv('X')`; the route is fully detected. Documenso's incomplete routes went from 64 to 0.
- **A rewrite is marked:** a Next.js route handler that calls a Hono app's `fetch` itself (not `handle(app)`) marks that app's routes with why: they keep the paths the app registers (Rallly's `POST /v1/polls`).

## Addendum (14 Nov 2026, step 5): what the hand labels found

The labels (`corpus/labels/entry-points.json`, 2,118 entry points) were built without the detectors, and every difference was read in the code. These were the engine's, each fixed with a fixture test that fails without it:

- **A route handler written as `route.tsx`** (Documenso's OG images) wasn't a route: Next.js takes any page extension.
- **A route handler handing requests to Hono through a factory** (Rallly's `const { handler } = OAuthIntegration(…)`) was listed: the handler is followed through constants and a function's returned object to Hono's `handle`.
- **A router a function makes and returns** (LibreChat's `app.use('/api/files', await routes.files.initialize())`) was taken for unmounted: the mount follows the function to the router its `return` names. LibreChat's code-registered routes went from 84% to 100%.
- **A renamed destructuring of a shorthand export** (`const { avatar: agentAvatar } = require(…)` against `module.exports = { v1: router, avatar }`): TypeScript stops at the shorthand; followed to its variable (the rule removed in step 3, needed after all, now with its test).
- **A route whose component only redirects** (LibreChat's `PromptsRedirect`, Twenty's `LegacySettingsPathRedirect`: every value returned is a `<Navigate>`) is a redirect, not a screen.
- **A NestJS path array** (`@Controller([…/apiKeys, …/metadata/apiKeys])`): a route under each, not the first only.
- **Two packages with one name** (Twenty's two app templates): the second was dropped; both are kept, and the first resolves imports of the name.
- **A named catch-all** (`*path`, `*relativePath`) is written `*`, as the notation says.

The rest of the differences were the labelling scripts' own mistakes (a comment's apostrophe read as a string, a type argument read as a tag, decorators spanning lines), each fixed in the script. At the pins, every fork's labels match the engine's entry points exactly, apart from Rallly's three OAuth routes: their base path is a factory's argument, so the engine lists them under `/:unknown`, not fully detected, with why.
