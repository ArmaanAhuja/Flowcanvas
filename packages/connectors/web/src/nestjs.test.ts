import { describe, expect, it } from 'vitest';
import { nestEntries } from './nestjs.js';
import { programOf } from './test-program.js';

const ENUM = `export enum ApiPath { Mcp = 'mcp', Rest = 'rest' }`;

describe('nestEntries', () => {
  it('lists a controller’s routes with their full paths, from literals and enum members', () => {
    const file = programOf({
      '/paths.ts': ENUM,
      '/mcp.controller.ts': [
        "import { Controller, Get, Post } from '@nestjs/common';",
        "import { ApiPath } from './paths';",
        '@Controller(ApiPath.Mcp)',
        'export class McpController {',
        '  @Post()',
        '  async handle() {}',
        "  @Get(':id/status')",
        '  status() {}',
        '  helper() {}',
        '}',
      ].join('\n'),
    });
    const found = nestEntries(file('/mcp.controller.ts'));
    expect(found.map((e) => [e.name, e.at.line, e.complete])).toEqual([
      ['POST /mcp', 6, true],
      ['GET /mcp/:id/status', 8, true],
    ]);
    expect(found[0]?.handler).toBeDefined();
  });

  it('lists GraphQL operations by name, whatever wraps the resolver class, and not field resolvers', () => {
    const file = programOf({
      '/apikey.resolver.ts': [
        "import { Mutation, Query, ResolveField, Subscription } from '@nestjs/graphql';",
        "import { MetadataResolver } from '../decorators';",
        '@MetadataResolver(() => ApiKey)',
        'export class ApiKeyResolver {',
        '  @Query(() => [ApiKey])',
        '  apiKeys() {}',
        "  @Mutation(() => ApiKey, { name: 'createOneApiKey' })",
        '  create() {}',
        '  @Subscription(() => Event)',
        '  onEvent() {}',
        '  @ResolveField()',
        '  workspace() {}',
        '}',
      ].join('\n'),
    });
    expect(nestEntries(file('/apikey.resolver.ts')).map((e) => [e.framework, e.name])).toEqual([
      ['graphql', 'query apiKeys'],
      ['graphql', 'mutation createOneApiKey'],
      ['graphql', 'subscription onEvent'],
    ]);
  });

  it('never guesses: a path or a name the code doesn’t fix is marked incomplete', () => {
    const file = programOf({
      '/odd.ts': [
        "import { Controller, Get } from '@nestjs/common';",
        "import { Query } from '@nestjs/graphql';",
        'declare const where: string;',
        '@Controller(where)',
        'export class Odd {',
        "  @Get('x')",
        '  x() {}',
        '  @Query(() => Thing, { name: where })',
        '  method() {}',
        '}',
      ].join('\n'),
    });
    expect(nestEntries(file('/odd.ts')).map((e) => [e.name, e.complete])).toEqual([
      ['GET /:unknown/x', false],
      ['query :unknown', false],
    ]);
  });

  it('ignores decorators of the same name from elsewhere', () => {
    const file = programOf({
      '/other.ts': [
        "import { Controller, Get } from './my-decorators';",
        "@Controller('x')",
        'export class NotNest {',
        '  @Get()',
        '  y() {}',
        '}',
      ].join('\n'),
    });
    expect(nestEntries(file('/other.ts'))).toEqual([]);
  });
});
