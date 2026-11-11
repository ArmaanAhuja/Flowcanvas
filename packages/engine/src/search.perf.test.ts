// The engine's half of "symbol search under 100 ms" (build plan, phase 4), at a scale past every corpus fork:
// 100,000 symbols with realistic compound names (Twenty, the largest fork, has 112,855). Timed on its own, in
// CI's performance job, not inside the parallel unit run: there a 2-CPU machine running every package's tests
// at once measured the machine's load (122 ms once, 14 ms here), not the search. The forks themselves are
// measured in real workspaces by workspace/host/src/corpus.docker.test.ts.
//
//   pnpm --filter @flowcanvas/engine test:perf
import { describe, expect, it } from 'vitest';
import { IndexStore } from './store.js';
import type { FileSymbol, SymbolKind } from './symbols.js';

const WORDS = [
  'create',
  'update',
  'delete',
  'get',
  'list',
  'find',
  'use',
  'handle',
  'render',
  'format',
  'poll',
  'user',
  'team',
  'document',
  'recipient',
  'field',
  'signature',
  'invite',
  'calendar',
  'event',
  'option',
  'vote',
  'session',
  'token',
  'email',
  'webhook',
  'schema',
  'router',
  'dialog',
  'button',
  'form',
  'input',
  'settings',
  'billing',
  'plan',
  'limit',
  'cache',
  'store',
  'client',
  'service',
];
const KINDS: SymbolKind[] = ['function', 'component', 'type', 'constant', 'method', 'interface'];

/** A small deterministic generator, so every run times the same names. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function names(count: number): FileSymbol[] {
  const random = seeded(42);
  const pick = () => WORDS[Math.floor(random() * WORDS.length)] ?? 'x';
  const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  return Array.from({ length: count }, (_, i) => {
    const parts = [pick(), title(pick()), ...(random() < 0.5 ? [title(pick())] : [])];
    return {
      name: `${parts.join('')}${i % 7 === 0 ? String(i % 100) : ''}`,
      kind: KINDS[i % KINDS.length] ?? 'function',
      container: null,
      line: (i % 400) + 1,
      column: 14,
      exported: i % 3 === 0,
    };
  });
}

/** What people type: short prefixes, whole words, two words, compound names, and a miss. */
const QUERIES = [
  'c',
  'cr',
  'cre',
  'crea',
  'create',
  'createp',
  'createpoll',
  'create poll',
  'usePoll',
  'use',
  'po',
  'poll',
  'pollOption',
  'handle',
  'handleSubmit',
  'getUser',
  'get user',
  'user',
  'team',
  'dialog',
  'Button',
  'form',
  'formatDate',
  'recipient',
  'sig',
  'signature',
  'webhook',
  'billing plan',
  'limit',
  'router',
  'schema',
  'x',
  'zzzz',
  'documentField',
  'calendar event',
  'token',
  'email',
  'invite',
];

describe('symbol search speed (phase 4: under 100 ms)', () => {
  it('answers in under 100 ms (p95) on 100,000 symbols', { timeout: 120_000 }, () => {
    const store = new IndexStore(':memory:');
    const symbols = names(100_000);
    store.transaction(() => {
      for (let start = 0; start < symbols.length; start += 1000) {
        store.put(
          {
            path: `src/module-${String(start / 1000)}.ts`,
            version: 'a'.repeat(64),
            language: 'typescript',
            status: 'parsed',
            syntaxErrors: false,
            limitation: null,
          },
          symbols.slice(start, start + 1000),
        );
      }
    });
    // A warm-up pass (statements prepared, pages in memory), then three timed passes.
    for (const query of QUERIES) store.search(query);
    const times: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      for (const query of QUERIES) {
        const started = performance.now();
        store.search(query);
        times.push(performance.now() - started);
      }
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length * 0.5)] ?? 0;
    const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
    const max = times.at(-1) ?? 0;
    console.log(
      `search on 100,000 symbols, ${String(times.length)} queries: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`,
    );
    expect(store.search('createpoll').length).toBeGreaterThan(0);
    expect(p95).toBeLessThan(100);
    store.close();
  });
});
