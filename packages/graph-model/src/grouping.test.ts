// Grouping a large flow (phase 12; owner, 16 Nov 2026): named from the code, at most 8 groups, the root on its own.
import { describe, expect, it } from 'vitest';
import type { Flow, FlowEdge } from './flow.js';
import { MAX_FLOW_GROUPS, folderTitle, semanticGrouping } from './grouping.js';
import type { GraphNode } from './model.js';

const unit = (path: string, name: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id: `${path}#${name}`,
  kind: 'code-unit',
  name,
  place: { path, line: 1, column: 1 },
  unit: 'function',
  change: 'unchanged',
  ...extra,
});
const edge = (from: string, to: string, kind: FlowEdge['kind'] = 'call'): FlowEdge => ({
  from,
  to,
  kind,
  relation: kind === 'call' ? 'calls' : null,
  label: null,
  provenance: 'resolved',
  lines: [1],
  sites: 1,
});
const flowOf = (nodes: GraphNode[], edges: FlowEdge[] = []): Flow => ({
  root: nodes[0]?.id ?? 'none',
  nodes,
  // Every node reached from the root unless the test says otherwise.
  edges: edges.length > 0 ? edges : nodes.slice(1).map((node) => edge(nodes[0]?.id ?? '', node.id)),
  unknown: [],
  cut: [],
  hidden: 0,
  byProvenance: { observed: 0, resolved: 0, convention: 0, suggested: 0, unknown: 0 },
});
const titles = (flow: Flow, max?: number) =>
  semanticGrouping(flow, max === undefined ? undefined : { maxGroups: max }).groups.map((g) => [
    g.title,
    g.count,
  ]);

describe('semanticGrouping', () => {
  it('groups functions by their folder, named by its last two parts; the root on its own', () => {
    const flow = flowOf([
      unit('apps/web/src/send.ts', 'send'),
      unit('packages/lib/document/a.ts', 'a'),
      unit('packages/lib/document/b.ts', 'b'),
      unit('packages/lib/email/c.ts', 'c'),
      unit('packages/lib/email/d.ts', 'd'),
    ]);
    const result = semanticGrouping(flow);
    expect(titles(flow)).toEqual([
      ['lib/document', 2],
      ['lib/email', 2],
    ]);
    expect(result.standaloneNodeIds).toEqual(['apps/web/src/send.ts#send']);
    expect(result.groups[0]?.id).toBe('group:main:dir:packages/lib/document');
  });

  it('gives tables, outside services and hand-offs their own groups, by kind', () => {
    const data = (table: string): GraphNode => ({
      id: `(data prisma ${table} write)`,
      kind: 'data-access',
      name: table,
      place: null,
      unit: null,
      change: 'unchanged',
      data: { library: 'prisma', table, operation: 'write', complete: true, why: null },
    });
    const service: GraphNode = {
      id: '(service email nodemailer)',
      kind: 'external-boundary',
      name: 'Email · nodemailer',
      place: null,
      unit: null,
      change: 'unchanged',
      service: { kind: 'email', library: 'nodemailer', url: null, complete: true, why: null },
    };
    const flow = flowOf([unit('a/root.ts', 'root'), data('Envelope'), data('Recipient'), service]);
    expect(titles(flow)).toEqual([['Tables', 2]]);
    // A group of one is shown as its node.
    expect(semanticGrouping(flow).standaloneNodeIds).toEqual([
      'a/root.ts#root',
      '(service email nodemailer)',
    ]);
  });

  it('keeps a decision in its function’s group, never a category of its own', () => {
    const root = unit('src/app/route.ts', 'POST');
    const check = unit('src/lib/check.ts', 'check');
    const other = unit('src/lib/other.ts', 'other');
    const decision: GraphNode = {
      id: 'src/lib/check.ts#check?1',
      kind: 'decision',
      name: '!user',
      place: { path: 'src/lib/check.ts', line: 3, column: 3 },
      unit: null,
      change: 'unchanged',
    };
    const flow = flowOf([root, check, other, decision]);
    expect(titles(flow)).toEqual([['src/lib', 3]]);
  });

  it('splits the largest folder into its subfolders while it fits in 8: the finest grouping that does', () => {
    // 59 nodes over 12 folders in 3 areas: the areas fit, then the largest area's 4 subfolders (6 groups), then the
    // next area's two largest subfolders that still fit (8), the rest staying in that area's folder.
    const nodes = [unit('apps/web/root.ts', 'root')];
    for (const area of ['auth', 'billing', 'mail']) {
      for (const sub of ['one', 'two', 'three', 'four']) {
        for (let i = 0; i < 5; i += 1)
          nodes.push(unit(`src/${area}/${sub}/f${String(i)}.ts`, `f${String(i)}`));
      }
    }
    const flow = flowOf(nodes.slice(0, 60));
    const result = semanticGrouping(flow);
    expect(titles(flow)).toEqual([
      ['auth/one', 5],
      ['auth/two', 5],
      ['auth/three', 5],
      ['auth/four', 5],
      ['billing/one', 5],
      ['billing/two', 5],
      ['src/billing', 10],
      ['src/mail', 19],
    ]);
    // Every node but the root is in a group or on its own: none lost.
    expect(result.nodeToGroup.size + result.standaloneNodeIds.length).toBe(60);
  });

  it('never makes more than the most groups, however many folders there are', () => {
    const nodes = [unit('root.ts', 'root')];
    for (let f = 0; f < 10; f += 1) {
      for (let i = 0; i <= f % 3; i += 1)
        nodes.push(unit(`top${String(f)}/x${String(i)}.ts`, `x${String(i)}`));
    }
    for (const most of [1, 4, MAX_FLOW_GROUPS]) {
      const result = semanticGrouping(flowOf(nodes), { maxGroups: most });
      expect(result.groups.length + result.standaloneNodeIds.length - 1).toBeLessThanOrEqual(most);
    }
    // At one, it's the folder they share: the project's root.
    expect(titles(flowOf(nodes), 1)).toEqual([['Project root', 19]]);
  });

  it('groups what runs in the background apart from the main lane', () => {
    const root = unit('src/email/service.ts', 'send');
    const a = unit('src/email/helper.ts', 'helper');
    const b = unit('src/email/format.ts', 'format');
    const handoff: GraphNode = {
      id: '(handoff queue:email-queue/EmailSenderJob)',
      kind: 'async-handoff',
      name: 'email-queue · EmailSenderJob',
      place: null,
      unit: null,
      change: 'unchanged',
      handoff: { kind: 'queue', library: 'message-queue', name: 'x', complete: true, why: null },
    };
    const worker = unit('src/email/job.ts', 'handle');
    const sender = unit('src/email/sender.ts', 'deliver');
    const flow = flowOf(
      [root, a, b, handoff, worker, sender],
      [
        edge(root.id, a.id),
        edge(root.id, b.id),
        edge(root.id, handoff.id, 'handoff'),
        edge(handoff.id, worker.id, 'handoff'),
        edge(worker.id, sender.id),
      ],
    );
    const result = semanticGrouping(flow);
    expect(result.groups.map((g) => [g.id, g.count])).toEqual([
      ['group:main:dir:src/email', 2],
      ['group:background:dir:src/email', 2],
    ]);
  });

  it('names a folder by its last two parts, or the project’s root', () => {
    expect(folderTitle('packages/lib/server-only/document')).toBe('server-only/document');
    expect(folderTitle('src')).toBe('src');
    expect(folderTitle('')).toBe('Project root');
  });

  it('is empty for an empty flow', () => {
    const result = semanticGrouping(flowOf([]));
    expect(result.groups).toEqual([]);
    expect(result.standaloneNodeIds).toEqual([]);
  });
});
