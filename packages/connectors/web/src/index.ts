// Framework connectors for web projects (phase 8, ADR 0030): what each framework declares as an entry point.
export * from './types.js';
export { type FileContext, type TypeScript } from './ast.js';
export { flatRoute, nextAppRoute, type FlatRoute, type NextRoute } from './file-routes.js';
export { nestEntries } from './nestjs.js';
export { exportsOf, flatRouteEntries, nextRouteEntries, type Exported } from './route-files.js';
export {
  joinRouters,
  routersOf,
  type JoinableRouter,
  type Mount,
  type RegisteredRoute,
  type Router,
  type RouterFramework,
} from './routers.js';
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
