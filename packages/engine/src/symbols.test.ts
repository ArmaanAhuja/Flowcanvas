import { Parser } from 'web-tree-sitter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGrammars, type LanguageId } from './grammars.js';
import { extractSymbols, type FileSymbol } from './symbols.js';

let parser: Parser;
beforeAll(async () => {
  await loadGrammars();
  parser = new Parser();
});
afterAll(() => {
  parser.delete();
});

async function symbolsOf(language: LanguageId, text: string): Promise<FileSymbol[]> {
  parser.setLanguage((await loadGrammars()).get(language) ?? null);
  const tree = parser.parse(text);
  if (tree === null) throw new Error('no tree');
  try {
    return extractSymbols(language, tree);
  } finally {
    tree.delete();
  }
}

/** `kind name` (plus `in container`, and `exported`), for compact expectations. */
const brief = (symbols: FileSymbol[]) =>
  symbols.map(
    (s) =>
      `${s.kind} ${s.name}${s.container ? ` in ${s.container}` : ''}${s.exported ? ' exported' : ''}`,
  );

describe('TypeScript', () => {
  it('finds each kind of declaration at module level', async () => {
    const symbols = await symbolsOf(
      'typescript',
      [
        'export function createPoll(title: string) { return title; }',
        'function* ids() { yield 1; }',
        'export class PollService {',
        '  private cache = new Map();',
        '  constructor() {}',
        '  async findPoll(id: string) { return id; }',
        '  get size() { return 1; }',
        '}',
        'abstract class Repository {}',
        'export interface Poll { id: string }',
        'type PollId = string;',
        'export enum Status { Open, Closed }',
        'export const MAX_OPTIONS = 30;',
        'const formatDate = (date: Date) => date.toISOString();',
        'export const handler = async function named() {};',
        'let counter = 0;',
        'let reset = () => { counter = 0; };',
        'declare function track(event: string): void;',
        'namespace Billing { export function charge() {} }',
      ].join('\n'),
    );
    expect(brief(symbols)).toEqual([
      'function createPoll exported',
      'function ids',
      'class PollService exported',
      'method constructor in PollService',
      'method findPoll in PollService',
      'method size in PollService',
      'class Repository',
      'interface Poll exported',
      'type PollId',
      'enum Status exported',
      'constant MAX_OPTIONS exported',
      'function formatDate',
      'function handler exported',
      'function reset',
      'function track',
      'namespace Billing',
      'function charge in Billing exported',
    ]);
  });

  it('leaves out locals, destructuring and anonymous defaults', async () => {
    const symbols = await symbolsOf(
      'typescript',
      [
        'export function outer() { const inner = () => 1; function helper() {} return inner; }',
        'const { a, b } = load();',
        'const [first] = list;',
        'export default () => 1;',
        'if (x) { const hidden = 1; }',
      ].join('\n'),
    );
    expect(brief(symbols)).toEqual(['function outer exported']);
  });

  it('marks names exported by an export list, but not re-exports', async () => {
    const symbols = await symbolsOf(
      'typescript',
      [
        'const a = 1;',
        'function b() {}',
        'const c = 2;',
        'export { a, b as renamed };',
        "export { c } from './other';",
      ].join('\n'),
    );
    expect(brief(symbols)).toEqual(['constant a exported', 'function b exported', 'constant c']);
  });

  it('gives the 1-based line and column of the name, counting UTF-16 like the editor', async () => {
    const [symbol] = await symbolsOf('typescript', '// é 🙂\n\n  export function  später() {}');
    expect(symbol).toMatchObject({ name: 'später', line: 3, column: 20 });
    // 🙂 is 2 UTF-16 code units (and 4 UTF-8 bytes), so f is at column 26, not 28 or 25.
    const sameLine = await symbolsOf('typescript', 'const s = "🙂"; function f() {}');
    expect(sameLine.find((s) => s.name === 'f')).toMatchObject({ line: 1, column: 26 });
  });

  it('still finds the symbols around a syntax error', async () => {
    const symbols = await symbolsOf(
      'typescript',
      'export function before() {}\nconst broken = (;\nexport function after() {}',
    );
    expect(brief(symbols)).toContain('function before exported');
    expect(brief(symbols)).toContain('function after exported');
  });
});

describe('components (TSX and JSX)', () => {
  it('calls a PascalCase function that returns JSX a component', async () => {
    const symbols = await symbolsOf(
      'tsx',
      [
        'export default function PollPage() { return <main />; }',
        'export const Button = ({ label }: { label: string }) => <button>{label}</button>;',
        'export const Card = forwardRef<HTMLDivElement>((props, ref) => <div ref={ref} />);',
        'const Empty = () => <></>;',
        'export function usePoll() { return <span />; }',
        'export function Helper() { return null; }',
        'export const Theme = createContext(null);',
      ].join('\n'),
    );
    expect(brief(symbols)).toEqual([
      'component PollPage exported',
      'component Button exported',
      'component Card exported',
      'component Empty',
      'function usePoll exported',
      'function Helper exported',
      'constant Theme exported',
    ]);
  });

  it('reads JSX in .js and .jsx files with the JavaScript grammar', async () => {
    const symbols = await symbolsOf(
      'javascript',
      'export function Header() { return <h1>Hi</h1>; }\nmodule.exports = {};',
    );
    expect(brief(symbols)).toEqual(['component Header exported']);
  });

  it('never calls anything a component in a .ts file', async () => {
    const symbols = await symbolsOf('typescript', 'export function Render() { return 1; }');
    expect(brief(symbols)).toEqual(['function Render exported']);
  });
});

describe('Markdown', () => {
  it('lists headings with their parent heading', async () => {
    const symbols = await symbolsOf(
      'markdown',
      [
        '---',
        'title: Self-hosting',
        '---',
        '# Self-hosting',
        '',
        'Intro.',
        '',
        '## With   Docker',
        '',
        '### Environment *variables*',
        '',
        '## Without Docker ##',
        '',
        'Setext title',
        '============',
        '',
        '```md',
        '# not a heading',
        '```',
      ].join('\n'),
    );
    expect(brief(symbols)).toEqual([
      'heading Self-hosting',
      'heading With Docker in Self-hosting',
      'heading Environment *variables* in With Docker',
      'heading Without Docker in Self-hosting',
      'heading Setext title',
    ]);
    expect(symbols[0]).toMatchObject({ line: 4, column: 3 });
  });

  it('reads MDX headings, with components as plain text', async () => {
    const symbols = await symbolsOf(
      'markdown',
      "import { Callout } from './callout';\n\n# Getting started\n\n<Callout>Hi</Callout>\n",
    );
    expect(brief(symbols)).toEqual(['heading Getting started']);
  });
});

describe('other languages', () => {
  it.each([
    ['css', '.poll-option { color: red; } :root { --brand: blue; }'],
    ['json', '{ "scripts": { "dev": "next dev" } }'],
    ['html', '<div id="app"></div>'],
  ] as const)('parses %s but lists no symbols (owner, 9 Nov 2026)', async (language, text) => {
    expect(await symbolsOf(language, text)).toEqual([]);
  });
});
