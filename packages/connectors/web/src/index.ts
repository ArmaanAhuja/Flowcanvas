// Framework connectors for web projects (phase 8, ADR 0030): what each framework declares as an entry point.
export * from './types.js';
export { importsOf, stringValue, type FileContext, type TypeScript } from './ast.js';
export { flatRoute, nextAppRoute, type FlatRoute, type NextRoute } from './file-routes.js';
export { nestEntries } from './nestjs.js';
export { exportsOf, flatRouteEntries, nextRouteEntries, type Exported } from './route-files.js';
export {
  joinRouters,
  ROUTER_MESSAGES,
  routersOf,
  type JoinableRouter,
  type Mount,
  type RegisteredRoute,
  type Router,
  type RouterFramework,
} from './routers.js';
export {
  joinReactRouter,
  reactRouterOf,
  type JoinableRoute,
  type JoinableTree,
  type RouteNode,
  type RouteTree,
} from './react-router.js';
export { eventEntries, serverActionEntries, type ElementEntry } from './react.js';
export { projectFile, scriptEntries } from './scripts.js';
export {
  joinTrpc,
  trpcOf,
  type JoinableTrpc,
  type JoinableValue,
  type TrpcFile,
  type TrpcProcedure,
  type TrpcRouter,
  type TrpcValue,
} from './trpc.js';
