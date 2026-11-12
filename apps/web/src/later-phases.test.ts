// @vitest-environment node
// Whatever the site shows that arrives later says so, naming its phase (owner, 12 Nov 2026), and no such text
// outlives its phase. Found when a catalogue example still showed the Code view as "arriving in a later phase" two
// phases after it shipped: the visual tests proved the example hadn't changed, not that it was still true.
//
// Every visible text in the site and the catalogue (string literals, template text and JSX text, read with
// TypeScript's parser; tests and comments aren't shown, so aren't read) is held to three rules:
// 1. "later" without a number ("a later phase", "coming soon") isn't allowed: name the phase.
// 2. A text saying something arrives names its phase.
// 3. A phase named as still to come hasn't been accepted (docs/STATUS.md).
// The Labs switches' "Finished in phase N" and Graph stats' "arrives in phase N" are numbers, checked the same way.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARRIVES_IN } from '@flowcanvas/graph-model';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LABS_FLAGS } from './labs/flags';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ROOTS = ['apps/web/src', 'packages/ui/src'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every text in a file that can reach the screen, with where it is. */
function visibleTexts(file: string): { text: string; where: string }[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: { text: string; where: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      // Module specifiers and the like aren't shown.
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push({ text: node.text, where: `${relative(repo, file)}:${String(line)}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The phases the owner has accepted, from docs/STATUS.md's table. */
function acceptedPhases(): Set<string> {
  const status = readFileSync(join(repo, 'docs/STATUS.md'), 'utf8');
  const accepted = new Set<string>();
  for (const line of status.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (/^\d+[a-z]?$/.test(cells[1] ?? '') && cells[3] === 'accepted') accepted.add(cells[1] ?? '');
  }
  return accepted;
}

const texts = ROOTS.flatMap((root) => sources(join(repo, root))).flatMap(visibleTexts);
const accepted = acceptedPhases();
const PHASE = /\bphase\s+(\d+[a-z]?)\b/gi;

describe('texts about what arrives later', () => {
  it('reads the accepted phases from docs/STATUS.md', () => {
    // A sanity check that the table was read: phases 1 to 5 were accepted before this test was written.
    for (const phase of ['1', '2', '3', '4', '5']) expect(accepted.has(phase), phase).toBe(true);
  });

  it('never say "later" without naming the phase', () => {
    const vague = texts.filter(({ text }) =>
      /\blater phases?\b|\bcoming soon\b|\bin the future\b/i.test(text),
    );
    expect(vague.map(({ where, text }) => `${where}: ${text}`)).toEqual([]);
  });

  it('name the phase whenever they say something arrives', () => {
    const unnamed = texts.filter(
      ({ text }) =>
        /\barriv(e|es|ing)\b/i.test(text) &&
        !/\bphase\s+\d/i.test(text) &&
        // A number filled in after the text ("arrives in phase {phase}").
        !/\bphase\s*$/i.test(text),
    );
    expect(unnamed.map(({ where, text }) => `${where}: ${text}`)).toEqual([]);
  });

  it('only name phases that haven’t been accepted yet as still to come', () => {
    const stale = texts.flatMap(({ text, where }) =>
      /\barriv|\buntil\b|\bfinished in\b/i.test(text)
        ? [...text.matchAll(PHASE)]
            .map((match) => match[1] ?? '')
            .filter((phase) => accepted.has(phase))
            .map((phase) => `${where}: phase ${phase} is accepted: ${text}`)
        : [],
    );
    const labs = LABS_FLAGS.filter((flag) => accepted.has(flag.phase)).map(
      (flag) => `Labs ${flag.id}: finished in phase ${flag.phase}, which is accepted`,
    );
    const kinds = Object.entries(ARRIVES_IN)
      .filter(([, phase]) => accepted.has(String(phase)))
      .map(
        ([kind, phase]) =>
          `Graph stats ${kind}: arrives in phase ${String(phase)}, which is accepted`,
      );
    expect([...stale, ...labs, ...kinds]).toEqual([]);
  });

  it('show Graph stats in the catalogue with the graph’s own phases, not an old copy', () => {
    // The catalogue (packages/ui) doesn't depend on the graph model, so its example keeps a copy: found still saying
    // decisions arrive in phase 7 once they had.
    const story = readFileSync(
      join(repo, 'packages/ui/src/components/graph-stats/GraphStats.stories.tsx'),
      'utf8',
    );
    const copy = /const ARRIVES_IN = \{([^}]*)\}/.exec(story)?.[1] ?? '';
    const entries: Record<string, number> = Object.fromEntries(
      [...copy.matchAll(/'?([\w-]+)'?:\s*(\d+)/g)].map((m) => [m[1] ?? '', Number(m[2])]),
    );
    expect(entries).toEqual(ARRIVES_IN);
  });
});
