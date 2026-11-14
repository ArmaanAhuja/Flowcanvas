// NestJS (Twenty's server; ADR 0030): a controller's methods decorated with an HTTP method are API routes,
// `METHOD /controller-path/method-path`; a class's methods decorated with GraphQL's Query, Mutation or Subscription
// are API routes named by their operation. Decorators are known by the module they're imported from
// (`@nestjs/common`, `@nestjs/graphql`), since the corpus doesn't install packages. A field resolver (ResolveField)
// runs inside a query, so it isn't an entry point. https://docs.nestjs.com/controllers and
// https://docs.nestjs.com/graphql/resolvers
import type * as TS from 'typescript';
import {
  decoratorCall,
  importsOf,
  joinPath,
  positionOf,
  spanOf,
  stringValue,
  type FileContext,
} from './ast.js';
import type { FoundEntry } from './types.js';

const HTTP = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  All: 'ALL',
  Head: 'HEAD',
  Options: 'OPTIONS',
} as const;
const GRAPHQL = { Query: 'query', Mutation: 'mutation', Subscription: 'subscription' } as const;

export function nestEntries(context: FileContext): FoundEntry[] {
  const { ts, source } = context;
  const imports = importsOf(ts, source);
  // A decorator's name in this file → its name in its module, if it's imported from that module.
  const from = (module: string, local: string) => {
    const imported = imports.get(local);
    return imported?.module === module ? imported.name : null;
  };
  const found: FoundEntry[] = [];
  const visit = (node: TS.Node) => {
    if (ts.isClassDeclaration(node)) found.push(...classEntries(context, node, from));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function classEntries(
  context: FileContext,
  node: TS.ClassDeclaration,
  from: (module: string, local: string) => string | null,
): FoundEntry[] {
  const { ts, source } = context;
  const found: FoundEntry[] = [];
  let prefix: { path: string | null } | null = null;
  for (const decorator of ts.getDecorators(node) ?? []) {
    const call = decoratorCall(ts, decorator);
    if (call === null || from('@nestjs/common', call.name) !== 'Controller') continue;
    prefix = { path: pathArgument(context, call.args[0]) };
  }
  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    for (const decorator of ts.getDecorators(member) ?? []) {
      const call = decoratorCall(ts, decorator);
      if (call === null) continue;
      const http = from('@nestjs/common', call.name);
      const graphql = from('@nestjs/graphql', call.name);
      if (prefix !== null && http !== null && http in HTTP) {
        const own = pathArgument(context, call.args[0]);
        const complete = prefix.path !== null && own !== null;
        found.push({
          kind: 'api-route',
          framework: 'nestjs',
          name: `${HTTP[http as keyof typeof HTTP]} ${joinPath(prefix.path ?? ':unknown', own ?? ':unknown')}`,
          at: positionOf(source, member.name),
          complete,
          ...(complete ? {} : { why: 'Its path isn’t a constant the code fixes.' }),
          handler: spanOf(source, member),
        });
      } else if (graphql !== null && graphql in GRAPHQL) {
        // No name given: the method's. A name given that the code doesn't fix: unknown, never the method's.
        const named = operationName(context, call.args);
        const name =
          named === undefined ? (ts.isIdentifier(member.name) ? member.name.text : null) : named;
        found.push({
          kind: 'api-route',
          framework: 'graphql',
          name: `${GRAPHQL[graphql as keyof typeof GRAPHQL]} ${name ?? ':unknown'}`,
          at: positionOf(source, member.name),
          complete: name !== null,
          ...(name === null ? { why: 'Its name isn’t a constant the code fixes.' } : {}),
          handler: spanOf(source, member),
        });
      }
    }
  }
  return found;
}

/** A controller's or method's path: none (`''`), a string the code fixes, or the first of a list. */
function pathArgument(context: FileContext, argument: TS.Expression | undefined): string | null {
  const { ts } = context;
  if (argument === undefined) return '';
  if (ts.isArrayLiteralExpression(argument)) {
    const first = argument.elements[0];
    return first === undefined ? '' : stringValue(context, first);
  }
  if (ts.isObjectLiteralExpression(argument)) {
    const path = argument.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'path',
    );
    return path !== undefined && ts.isPropertyAssignment(path)
      ? stringValue(context, path.initializer)
      : '';
  }
  return stringValue(context, argument);
}

/** GraphQL's `{ name: 'x' }` option, in either argument: undefined when it isn't given, null when it isn't known. */
function operationName(
  context: FileContext,
  args: readonly TS.Expression[],
): string | null | undefined {
  const { ts } = context;
  for (const argument of args) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'name'
      ) {
        return stringValue(context, property.initializer);
      }
    }
  }
  return undefined;
}
