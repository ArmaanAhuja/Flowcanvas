// The Calls tab from what the graph pass stored (phase 7, ADR 0029), held to TypeScript's own answers: at every
// function's name in a real project, the engine's stored callers and callees equal the semantic service's live ones,
// without asking TypeScript; and TypeScript answers again once anything changes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { WatchEvent } from '@flowcanvas/workspace-agent/protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FactsStore } from './facts.js';
import { Indexer } from './indexer.js';
import type { CallsResult } from './protocol.js';
import { inProcessSemantics } from './semantics/in-process.js';
import type { TypeScript } from './semantics/projects.js';
import { SemanticService } from './semantics/semantic-service.js';
import { startEngineService, type EngineService, type Semantics } from './service.js';
import { SnapshotStore } from './snapshots.js';
import { IndexStore } from './store.js';

vi.setConfig({ testTimeout: 30_000 });
const ts = createRequire(import.meta.url)('typescript') as TypeScript;

const FILES: Record<string, string> = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: { strict: true, jsx: 'react-jsx' },
    include: ['src'],
  }),
  'src/db.ts': [
    'export function save(id: string) {',
    '  return id.length;',
    '}',
    'export const load = (id: string) => save(id);',
    '',
  ].join('\n'),
  'src/poll.ts': [
    "import { load, save } from './db';",
    'export class Poll {',
    '  create(id: string) {',
    '    if (id) save(id);',
    '    return load(id) + Math.max(1, 2);',
    '  }',
    '  remove = (id: string) => save(id);',
    '}',
    'export function makePoll() {',
    '  const poll = new Poll();',
    "  poll.create('a');",
    "  return [1].map(() => save('b'));",
    '}',
    "save('top');",
    '',
  ].join('\n'),
  'src/view.tsx': [
    "import { makePoll } from './poll';",
    'export function Badge() {',
    '  return <span>{String(makePoll())}</span>;',
    '}',
    'export function Page() {',
    '  return <Badge />;',
    '}',
    '',
  ].join('\n'),
};

let root: string;
let store: IndexStore;
let indexer: Indexer;
let facts: FactsStore;
let live: SemanticService;
let service: EngineService;
let emit: (event: WatchEvent) => void;
let ask: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'fc-stored-calls-'));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  store = new IndexStore(':memory:');
  indexer = new Indexer({ root, store });
  facts = new FactsStore(':memory:', { root });
  // One service builds the graph and stores facts; a second, untouched, is TypeScript asked live.
  const building = new SemanticService({ ts, root, files: Object.keys(FILES), facts });
  live = new SemanticService({ ts, root, files: Object.keys(FILES) });
  const semantics = inProcessSemantics(building);
  ask = vi.fn(semantics.ask.bind(semantics));
  semantics.ask = ask as Semantics['ask'];
  service = startEngineService({
    store,
    indexer,
    listFiles: () => Promise.resolve(Object.keys(FILES)),
    watch: (send) => {
      emit = send;
      return Promise.resolve({ close: () => undefined });
    },
    refreshDelayMs: 5,
    graphDelayMs: 5,
    semantics,
    snapshots: new SnapshotStore(':memory:'),
    facts,
  });
  await service.settled();
  await service.graphSettled();
});
afterEach(async () => {
  service.close();
  live.dispose();
  await indexer.close();
  store.close();
  facts.close();
  rmSync(root, { recursive: true, force: true });
});

/** Order aside: the store and TypeScript may list entries and sites in different orders. */
const normal = (result: CallsResult) => ({
  ...result,
  entries: result.entries
    .map((e) => ({
      ...e,
      sites: [...e.sites].sort((a, b) => a.line - b.line || a.column - b.column),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
});

it('answers callers and callees at every function’s name from what the pass stored, as TypeScript does', async () => {
  const names: { path: string; line: number; column: number; name: string }[] = [];
  for (const path of ['src/db.ts', 'src/poll.ts', 'src/view.tsx']) {
    for (const unit of facts.units(path) ?? []) {
      const item = unit.calls?.item;
      if (item?.place != null && unit.details.unit !== 'module') {
        names.push({ ...item.place, name: item.name });
      }
    }
  }
  expect(names.map((n) => n.name).sort()).toEqual(
    ['Badge', 'Page', 'Poll', 'create', 'load', 'makePoll', 'remove', 'save'].sort(),
  );
  for (const { path, line, column, name } of names) {
    // Anywhere on the name, its first and last characters included.
    for (const at of [column, column + name.length - 1]) {
      for (const op of ['callers', 'callees'] as const) {
        const stored = (await service.handle({ op, path, line, column: at })) as CallsResult;
        expect(normal(stored), `${op} of ${name} at ${String(at)}`).toEqual(
          normal(live[op](path, line, at)),
        );
      }
    }
  }
  // Every answer came from the store, but members' callers: TypeScript's (calls reach them through types too).
  expect(ask.mock.calls.map(([op, at]) => `${String(op)} ${JSON.stringify(at)}`).sort()).toEqual(
    names
      .filter((n) => n.name === 'create' || n.name === 'remove')
      .flatMap((n) => [n.column, n.column + n.name.length - 1].map((column) => ({ ...n, column })))
      .map(({ path, line, column }) => `callers ${JSON.stringify({ path, line, column })}`)
      .sort(),
  );
});

it('asks TypeScript once anything changes, until the next pass has taken it in', async () => {
  const at = { path: 'src/db.ts', line: 1, column: 17 };
  writeFileSync(
    join(root, 'src/view.tsx'),
    `${FILES['src/view.tsx'] ?? ''}export const more = () => 1;\n`,
  );
  emit({ type: 'changed', path: 'src/view.tsx', deleted: false, version: null });
  await service.handle({ op: 'callers', ...at });
  expect(ask).toHaveBeenCalledTimes(1);
  await service.settled();
  await service.graphSettled();
  await service.handle({ op: 'callers', ...at });
  expect(ask).toHaveBeenCalledTimes(1);
});
