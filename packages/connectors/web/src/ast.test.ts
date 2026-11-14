import { describe, expect, it } from 'vitest';
import type * as TS from 'typescript';
import { joinPath, pathValue, stringValue } from './ast.js';
import { programOf } from './test-program.js';

describe('stringValue', () => {
  const file = programOf({
    '/paths.ts': "export enum AppPath { SettingsCatchAll = 'settings/*', Api = 'api' }",
    '/a.ts': [
      "import { AppPath } from './paths';",
      "const ROOT = AppPath.SettingsCatchAll.replace('/*', '');",
      "const version = 'v1';",
      'let changes = "x";',
      'declare const fromEnv: string;',
      'export const values = [',
      '  ROOT,',
      '  `/${AppPath.Api}/${version}`,',
      "  '/api' + '/' + version,",
      "  'ABC'.toLowerCase(),",
      '  changes,',
      '  fromEnv,',
      '  `/${fromEnv}`,',
      '];',
    ].join('\n'),
  });

  it('evaluates pure string operations on what the code fixes, and nothing else', () => {
    const context = file('/a.ts');
    const { ts, source } = context;
    const array = (source.statements.at(-1) as import('typescript').VariableStatement)
      .declarationList.declarations[0]?.initializer;
    if (array === undefined || !ts.isArrayLiteralExpression(array)) throw new Error('no array');
    expect(array.elements.map((element) => stringValue(context, element))).toEqual([
      'settings',
      '/api/v1',
      '/api/v1',
      'abc',
      null,
      null,
      null,
    ]);
  });
});

describe('pathValue and joinPath (owner, 14 Nov 2026)', () => {
  it('names a base path read from an environment variable, through defaults, methods and constants', () => {
    const file = programOf({
      '/server.ts': [
        'declare function env(name: string): string | undefined;',
        "const basePath = (env('NEXT_PUBLIC_BASE_PATH') ?? '').replace(/\\/$/, '');",
        "export const a = basePath || '/';",
        'export const b = process.env.API_PREFIX;',
        "export const c = process.env['API_PREFIX'];",
        "export const d = '/api';",
        'declare function other(name: string): string;',
        "export const e = other('X');",
      ].join('\n'),
    });
    const context = file('/server.ts');
    const values = context.source.statements
      .filter(
        (s) => context.ts.isVariableStatement(s) && s.getText(context.source).startsWith('export'),
      )
      .map((s) => {
        const declaration = (s as TS.VariableStatement).declarationList.declarations[0];
        return declaration?.initializer === undefined
          ? null
          : pathValue(context, declaration.initializer);
      });
    expect(values).toEqual([
      '{NEXT_PUBLIC_BASE_PATH}',
      '{API_PREFIX}',
      '{API_PREFIX}',
      '/api',
      null,
    ]);
  });

  it('starts a path with a base path from a variable, which brings its own slash', () => {
    expect(joinPath('{NEXT_PUBLIC_BASE_PATH}', '/api/auth', 'session')).toBe(
      '{NEXT_PUBLIC_BASE_PATH}/api/auth/session',
    );
    expect(joinPath('', '/api/', ':id')).toBe('/api/:id');
  });
});
