// The phase 4 corpus test (build plan: "both forks index in under 30 s; symbol search under 100 ms"): each of
// the six corpus forks (corpus/manifest.json) opened at its pin in a real workspace, through the egress proxy,
// and indexed by the engine there. Rallly and Documenso must be ready within 30 s of the first request and
// search within 100 ms (the engine's p95); all six are reported. The hand-labelled symbols
// (corpus/labels/symbols.json, each read from the source) must be found at their exact place and kind.
// Phase 5's Done when, in the same workspaces: callers and callees of the 20 hand-labelled functions
// (corpus/labels/calls.json, 10 in each of the plan's two forks) must match the labels exactly.
// Phase 6's Done when: the flow graph built in each workspace; the plan's four forks (Rallly, Documenso, LibreChat,
// Twenty) ready and complete, snapshots saved and loaded in under 1 s each, and every labelled function found in the
// stored graph with exactly its labelled callers and callees (labels/calls.json and labels/graph.json). Phase 7: each
// labelled function's flow opens through the engine, from its name and from inside it, at its own node.
// Needs Docker 28+ and the internet. Run with `pnpm test:docker`. Everything it creates is removed.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore } from '@flowcanvas/engine';
import { buildImage } from '@flowcanvas/workspace-image';
import {
  GRAPH_FILE,
  type CallsResult,
  type EngineStatus,
  type GraphStatus,
  type SearchResult,
} from '@flowcanvas/engine/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findObjects, remove } from './clean.js';
import { dockerCli } from './docker-cli.js';
import { WorkspaceHost } from './workspaces.js';
import { checkGraph, compareCalls, type CallsLabel } from '../../../corpus/src/calls.js';

interface Repo {
  readonly id: string;
  readonly name: string;
  readonly fork: string;
  readonly commit: string;
}
interface Label {
  readonly name: string;
  readonly kind: string;
  readonly container: string | null;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

const corpus = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../corpus/${file}`, import.meta.url), 'utf8'));
const repos = (corpus('manifest.json') as { repos: Repo[] }).repos;
const labels = corpus('labels/symbols.json') as Record<string, Label[] | undefined>;
const callLabels = corpus('labels/calls.json') as Record<string, CallsLabel[] | undefined>;
const graphLabels = corpus('labels/graph.json') as Record<string, CallsLabel[] | undefined>;
/** Phase 6's four forks (owner, 12 Nov 2026): held to the Done when; Excalidraw and Medusa are reported. */
const GRAPH_HELD = new Set(['rallly', 'documenso', 'librechat', 'twenty']);
/** The Done when: a snapshot saved and loaded in under 1 s each. */
const SNAPSHOT_MS = 1000;
/**
 * A flow or a node's details, asked through a real workspace once its graph is built: from the facts the pass stored,
 * never waiting on TypeScript (owner, 13 Nov 2026: everything snappy). Held to under a second, round trip.
 */
const ANSWER_MS = 1000;
/** A whole-project graph on CI's two CPUs: minutes for the largest; a pass that never ends is still a failure. */
const GRAPH_GIVE_UP_MS = 420_000;

/** The build plan's two forks: held to the targets. The other four are measured and reported. */
const HELD = new Set(['rallly', 'documenso']);
const READY_MS = 30_000;
const SEARCH_P95_MS = 100;
/** Larger forks may take longer; they're reported, not held, but a pass that never ends is still a failure. */
const GIVE_UP_MS = 180_000;

const prefix = `fc-test-${randomBytes(4).toString('hex')}`;
const host = new WorkspaceHost({
  docker: dockerCli,
  prefix,
  image: () => buildImage(),
  log: () => undefined,
});
const report: Record<string, unknown>[] = [];

async function removeWorkspace(ref: string): Promise<void> {
  await host.stop(ref).catch(() => undefined);
  for (const object of (await findObjects(dockerCli)).filter(
    (o) => o.prefix === prefix && o.name.startsWith(ref) && o.kind !== 'image',
  )) {
    await remove(dockerCli, object).catch(() => undefined);
  }
}

const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * 0.95))
  ] ?? 0;

beforeAll(async () => {
  await buildImage();
}, 300_000);

afterAll(async () => {
  console.log(`\nCorpus report (phases 4 and 5)\n${JSON.stringify(report, null, 2)}`);
  for (const object of (await findObjects(dockerCli)).filter((o) => o.prefix === prefix)) {
    await remove(dockerCli, object).catch(() => undefined);
  }
}, 120_000);

describe('the corpus in real workspaces (phases 4, 5 and 6)', { timeout: 900_000 }, () => {
  for (const repo of repos) {
    const held = HELD.has(repo.id);
    it(`${repo.name}: ${held ? 'ready in under 30 s, searched in under 100 ms, callers and callees as labelled' : 'indexed and reported'}`, async () => {
      const workspaceId = randomUUID();
      const ref = host.refFor(workspaceId);
      try {
        const created = await host.create({
          workspaceId,
          repoUrl: `https://github.com/${repo.fork}`,
          commit: repo.commit,
        });
        expect(created.cloned).toBe(true);

        const status = async (): Promise<EngineStatus> => {
          const answer = await host.index(ref, { op: 'status' });
          if (!answer.ok || !('byStatus' in answer.result)) throw new Error('no status');
          return answer.result;
        };
        const search = async (query: string, limit = 50): Promise<SearchResult> => {
          const answer = await host.index(ref, { op: 'search', query, limit });
          if (!answer.ok || !('ms' in answer.result)) throw new Error('no search');
          return answer.result;
        };

        // From the first request: copying the engine in, starting it, listing, parsing and storing.
        const started = Date.now();
        let current = await status();
        while (current.state !== 'ready') {
          expect(current.state, current.message ?? '').not.toBe('failed');
          expect(Date.now() - started).toBeLessThan(GIVE_UP_MS);
          await new Promise((resolve) => setTimeout(resolve, 250));
          current = await status();
        }
        const readyMs = Date.now() - started;

        // The hand-labelled symbols: each found by its name at its exact place, with its kind.
        const expected = labels[repo.id] ?? [];
        const missing: string[] = [];
        for (const label of expected) {
          const { symbols } = await search(label.name, 100);
          const found = symbols.find(
            (s) =>
              s.path === label.path &&
              s.line === label.line &&
              s.name === label.name &&
              s.kind === label.kind &&
              s.column === label.column &&
              s.container === label.container,
          );
          if (found === undefined) {
            missing.push(`${label.kind} ${label.name} at ${label.path}:${String(label.line)}`);
          }
        }

        // Search speed: every prefix of every labelled name (2 letters up), plus a few common words.
        const queries = [
          ...expected.flatMap((label) =>
            Array.from({ length: Math.max(0, label.name.length - 1) }, (_, i) =>
              label.name.slice(0, i + 2),
            ),
          ),
          ...['use', 'get', 'create', 'props', 'handler', 'button', 'schema', 'id', 'e', 'type'],
        ];
        const engineMs: number[] = [];
        const roundTripMs: number[] = [];
        for (let round = 0; round < 2; round += 1) {
          for (const query of queries) {
            const asked = performance.now();
            const result = await search(query);
            roundTripMs.push(performance.now() - asked);
            engineMs.push(result.ms);
          }
        }

        // Phase 5: TypeScript's callers and callees of the labelled functions, exactly as labelled.
        const calls = async (op: 'callers' | 'callees', label: CallsLabel) => {
          const asked = performance.now();
          const answer = await host.index(ref, {
            op,
            path: label.path,
            line: label.line,
            column: label.column,
          });
          if (!answer.ok || !('entries' in answer.result)) throw new Error(`no ${op}`);
          return { result: answer.result, ms: performance.now() - asked };
        };
        // Each labelled function's callers and callees, compared exactly with its labels.
        // `membersMs`: a member's callers, which are TypeScript's even once the graph is built (ADR 0029 addendum).
        const checkCalls = async (differing: string[], ms: number[], membersMs: number[] = ms) => {
          for (const label of callLabels[repo.id] ?? []) {
            const callers: { result: CallsResult; ms: number } = await calls('callers', label);
            const callees = await calls('callees', label);
            (callers.result.target?.container == null ? ms : membersMs).push(callers.ms);
            ms.push(callees.ms);
            const found = compareCalls(label, callers.result.entries, callees.result.entries);
            const problems = [
              callers.result.target?.name === label.name
                ? []
                : [`target ${String(callers.result.target?.name)}`],
              callers.result.complete && callees.result.complete ? [] : ['incomplete answer'],
              found.callers.missing.map((line) => `missing caller: ${line}`),
              found.callers.extra.map((line) => `extra caller: ${line}`),
              found.callees.missing.map((line) => `missing callee: ${line}`),
              found.callees.extra.map((line) => `extra callee: ${line}`),
            ].flat();
            if (problems.length > 0) differing.push(`${label.name}: ${problems.join('; ')}`);
          }
        };
        // Phase 5: asked as soon as the index is ready, so TypeScript answers (the graph is still being built).
        const callsDiffering: string[] = [];
        const callsMs: number[] = [];
        await checkCalls(callsDiffering, callsMs);
        const labelledCalls = callLabels[repo.id]?.length ?? 0;

        // Phase 6: the flow graph, built in the workspace after the index.
        const graphStarted = Date.now();
        let graph: GraphStatus | undefined;
        for (;;) {
          const answer = await host.index(ref, { op: 'graph' });
          if (!answer.ok || !('snapshot' in answer.result)) throw new Error('no graph');
          graph = answer.result;
          if (graph.state === 'ready' || graph.state === 'failed') break;
          expect(Date.now() - graphStarted).toBeLessThan(GRAPH_GIVE_UP_MS);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const graphMs = Date.now() - graphStarted;
        // The stored version, copied out (with its write-ahead log) and loaded: loading decodes it and checks it
        // against the schema, then the labelled functions are found in it.
        const graphDiffering: string[] = [];
        const roots: { readonly label: CallsLabel; readonly id: string }[] = [];
        const sampled = [...(callLabels[repo.id] ?? []), ...(graphLabels[repo.id] ?? [])];
        if (graph.state === 'ready' && graph.snapshot !== null && sampled.length > 0) {
          const copy = mkdtempSync(join(tmpdir(), 'fc-graph-'));
          try {
            for (const suffix of ['', '-wal', '-shm']) {
              await dockerCli([
                'cp',
                `${ref}:${GRAPH_FILE}${suffix}`,
                join(copy, `graph.db${suffix}`),
              ]).catch(() => undefined);
            }
            const store = new SnapshotStore(join(copy, 'graph.db'));
            const loaded = store.load(graph.snapshot.version);
            store.close();
            if (loaded === undefined) throw new Error('the reported version isn’t stored');
            for (const label of sampled) {
              const found = checkGraph(loaded.graph, label);
              if (found.node !== null) roots.push({ label, id: found.node });
              const problems = [
                found.node === null ? ['no node at its place'] : [],
                found.callers.missing.map((line) => `missing caller: ${line}`),
                found.callers.extra.map((line) => `extra caller: ${line}`),
                found.callees.missing.map((line) => `missing callee: ${line}`),
                found.callees.extra.map((line) => `extra callee: ${line}`),
              ].flat();
              if (problems.length > 0) graphDiffering.push(`${label.name}: ${problems.join('; ')}`);
            }
          } finally {
            rmSync(copy, { recursive: true, force: true });
          }
        }

        // Phase 7: each labelled function's flow through the engine, from its name (found in the graph itself) and
        // from a line inside it where it makes a call (TypeScript names the function): both start at its node. Its
        // details, from its name, are about the same node.
        const flowsDiffering: string[] = [];
        const flowMs: number[] = [];
        const detailsMs: number[] = [];
        for (const { label, id } of roots) {
          const inside = label.callees.flatMap((c) => c.lines).find((line) => line !== label.line);
          const places = [
            { line: label.line, column: label.column },
            ...(inside === undefined ? [] : [{ line: inside, column: 1 }]),
          ];
          for (const place of places) {
            const asked = performance.now();
            const answer = await host.index(ref, { op: 'flow', path: label.path, ...place });
            flowMs.push(performance.now() - asked);
            const said = !answer.ok
              ? answer.error.message
              : 'flow' in answer.result
                ? (answer.result.flow?.root ?? answer.result.message)
                : 'not a flow';
            if (said !== id)
              flowsDiffering.push(`${label.name} from line ${String(place.line)}: ${String(said)}`);
          }
          // The inspector's details, from its name: about the same node.
          const asked = performance.now();
          const details = await host.index(ref, {
            op: 'details',
            path: label.path,
            line: label.line,
            column: label.column,
          });
          const named = !details.ok
            ? details.error.message
            : 'details' in details.result
              ? (details.result.details?.id ?? details.result.message)
              : 'not details';
          detailsMs.push(performance.now() - asked);
          if (named !== id) flowsDiffering.push(`${label.name} details: ${String(named)}`);
        }

        // Phase 7 (ADR 0029): asked again now the graph is built, so from what the pass stored: the same labels,
        // without waiting on TypeScript.
        const storedDiffering: string[] = [];
        const storedMs: number[] = [];
        const membersCallersMs: number[] = [];
        if (graph.state === 'ready') await checkCalls(storedDiffering, storedMs, membersCallersMs);

        const row = {
          repo: repo.id,
          files: current.files,
          parsed: current.byStatus.parsed,
          notParsed: current.files - current.byStatus.parsed,
          symbols: current.symbols,
          withSyntaxErrors: current.withSyntaxErrors,
          partlyRead: current.partlyRead,
          readyMs,
          enginePassMs: current.lastFullMs,
          searches: engineMs.length,
          searchEngineP95Ms: p95(engineMs),
          searchRoundTripP95Ms: Math.round(p95(roundTripMs)),
          labels: `${String(expected.length - missing.length)} of ${String(expected.length)}`,
          ...(labelledCalls > 0
            ? {
                calls: `${String(labelledCalls - callsDiffering.length)} of ${String(labelledCalls)}`,
                firstCallsMs: Math.round(callsMs[0] ?? 0),
                callsMaxMs: Math.round(Math.max(...callsMs)),
              }
            : {}),
          graph: graph.state,
          graphMs,
          graphComplete: graph.snapshot?.complete ?? null,
          graphNodes: graph.snapshot?.stats.nodes ?? null,
          graphEdges: graph.snapshot?.stats.edges ?? null,
          graphBuildMs: graph.snapshot?.buildMs ?? null,
          snapshotSaveMs: graph.snapshot?.saveMs ?? null,
          snapshotLoadMs: graph.snapshot?.loadMs ?? null,
          ...(sampled.length > 0
            ? {
                graphLabels: `${String(sampled.length - graphDiffering.length)} of ${String(sampled.length)}`,
              }
            : {}),
          ...(flowMs.length > 0
            ? {
                flows: `${String(flowMs.length - flowsDiffering.length)} of ${String(flowMs.length)}`,
                flowMaxMs: Math.round(Math.max(...flowMs)),
                detailsMaxMs: Math.round(Math.max(...detailsMs)),
              }
            : {}),
          ...(storedMs.length > 0
            ? {
                storedCalls: `${String(labelledCalls - storedDiffering.length)} of ${String(labelledCalls)}`,
                storedCallsMaxMs: Math.round(Math.max(...storedMs)),
                membersCallersMaxMs:
                  membersCallersMs.length > 0 ? Math.round(Math.max(...membersCallersMs)) : null,
              }
            : {}),
        };
        report.push(row);
        console.log(JSON.stringify(row));

        expect(missing).toEqual([]);
        expect(callsDiffering).toEqual([]);
        expect(storedDiffering).toEqual([]);
        if (storedMs.length > 0) expect(Math.max(...storedMs)).toBeLessThan(ANSWER_MS);
        if (GRAPH_HELD.has(repo.id)) {
          expect(graph.state, graph.message ?? '').toBe('ready');
          expect(graph.snapshot?.complete).toBe(true);
          expect(graph.snapshot?.saveMs).toBeLessThan(SNAPSHOT_MS);
          expect(graph.snapshot?.loadMs).toBeLessThan(SNAPSHOT_MS);
          expect(graphDiffering).toEqual([]);
          expect(flowsDiffering).toEqual([]);
          expect(Math.max(...flowMs, ...detailsMs)).toBeLessThan(ANSWER_MS);
        }
        expect(current.byStatus.parsed).toBeGreaterThan(0);
        if (held) {
          expect(readyMs).toBeLessThan(READY_MS);
          expect(p95(engineMs)).toBeLessThan(SEARCH_P95_MS);
        }
      } finally {
        await removeWorkspace(ref);
      }
    });
  }
});
