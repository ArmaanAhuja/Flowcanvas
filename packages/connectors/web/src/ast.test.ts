import { describe, expect, it } from 'vitest';
import { stringValue } from './ast.js';
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
