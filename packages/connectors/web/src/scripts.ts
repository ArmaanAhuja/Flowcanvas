// package.json scripts as CLI commands (ADR 0030): each script, named by its package and its name (`web: dev`),
// at its line. Its flow starts in the project file its command runs (`tsx scripts/seed.ts`), when it runs one; a
// script that runs a tool (`next build`, `vitest`) has no flow of its own, and says so on the page.

import type { FoundEntry } from './types.js';

/** Runners that run a file given as their first file argument. */
const RUNNERS = new Set(['node', 'tsx', 'ts-node', 'bun', 'deno', 'esno', 'vite-node']);
const FILE = /^\.?\.?\/?[\w./@-]+\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/**
 * Each script in a package.json's text. `label` names the package (its `name`, or its folder when it has none).
 * Throws on text that isn't JSON: the caller reports the file as unread, rather than as having no scripts.
 */
export function scriptEntries(text: string, label: string): FoundEntry[] {
  const json = JSON.parse(text) as { scripts?: unknown };
  const scripts = json.scripts;
  if (typeof scripts !== 'object' || scripts === null) return [];
  const block = text.search(/"scripts"\s*:/);
  return Object.entries(scripts as Record<string, unknown>).flatMap(([name, command]) => {
    if (typeof command !== 'string') return [];
    const at = keyPosition(text, name, block);
    const runs = projectFile(command);
    return [
      {
        kind: 'cli-command' as const,
        framework: 'package-json' as const,
        name: `${label}: ${name}`,
        at,
        complete: true,
        ...(runs === null ? {} : { runs }),
      },
    ];
  });
}

/** The first project file a command runs with a known runner (`tsx watch src/main.ts` runs `src/main.ts`). */
export function projectFile(command: string): string | null {
  for (const part of command.split(/&&|\|\||;/)) {
    const words = part
      .trim()
      .split(/\s+/)
      .filter((word) => !/^[A-Z_]+=/.test(word));
    const runner = words.findIndex((word) => RUNNERS.has(word));
    if (runner === -1) continue;
    const file = words.slice(runner + 1).find((word) => !word.startsWith('-') && FILE.test(word));
    if (file !== undefined) return file.replace(/^\.\//, '');
  }
  return null;
}

/** Where a script's key is: its line and column, after the `"scripts"` key. */
function keyPosition(text: string, name: string, from: number): { line: number; column: number } {
  // The name as a key (followed by its colon), not a value that happens to be the same text.
  const key = new RegExp(
    `${JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`,
    'g',
  );
  key.lastIndex = Math.max(0, from);
  const index = key.exec(text)?.index ?? -1;
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split('\n');
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}
