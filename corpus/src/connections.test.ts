import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chainProblems,
  compareConnections,
  connectionBarProblems,
  connectionsOf,
  inConnectionScope,
  CONNECTION_KINDS,
  type ForkConnections,
} from './connections.js';

const GRAPH = {
  nodes: [
    { id: 'src/poll.ts#make', name: 'make' },
    {
      id: '(data prisma polls write)',
      name: 'polls',
      data: { library: 'prisma', table: 'polls', operation: 'write' },
    },
    {
      id: '(service email nodemailer)',
      name: 'Email · nodemailer',
      service: { kind: 'email', library: 'nodemailer', url: null },
    },
    {
      id: '(handoff job:poll.created)',
      name: 'poll.created',
      handoff: { kind: 'job', name: 'poll.created' },
    },
    { id: 'src/server.ts#(entry mutation polls.make)', name: 'mutation polls.make' },
    { id: 'src/form.tsx#Form', name: 'Form' },
    { id: 'src/poll.test.ts#t', name: 't' },
  ],
  edges: [
    {
      from: 'src/poll.ts#make',
      to: '(data prisma polls write)',
      kind: 'data',
      provenance: 'convention',
      lines: [4, 9],
    },
    {
      from: 'src/poll.ts#make',
      to: '(service email nodemailer)',
      kind: 'boundary',
      provenance: 'convention',
      lines: [5],
    },
    {
      from: 'src/poll.ts#make',
      to: '(handoff job:poll.created)',
      kind: 'handoff',
      provenance: 'convention',
      lines: [6],
    },
    {
      from: 'src/form.tsx#Form',
      to: 'src/server.ts#(entry mutation polls.make)',
      kind: 'call',
      provenance: 'convention',
      lines: [12],
    },
    // A resolved call, and a test's write: not counted.
    {
      from: 'src/form.tsx#Form',
      to: 'src/poll.ts#make',
      kind: 'call',
      provenance: 'resolved',
      lines: [3],
    },
    {
      from: 'src/poll.test.ts#t',
      to: '(data prisma polls write)',
      kind: 'data',
      provenance: 'convention',
      lines: [2],
    },
  ],
};

describe('connections against their labels', () => {
  it('reads each connector site in scope as a label writes it, tests aside', () => {
    expect(inConnectionScope(['*'], 'src/poll.test.ts')).toBe(false);
    expect(inConnectionScope(['src/form'], 'src/poll.ts')).toBe(false);
    expect(
      connectionsOf(GRAPH, ['*']).map((s) => `${s.file}:${String(s.line)} ${s.kind} ${s.to}`),
    ).toEqual([
      'src/form.tsx:12 link mutation polls.make',
      'src/poll.ts:4 data prisma polls write',
      'src/poll.ts:5 service email nodemailer',
      'src/poll.ts:6 handoff job:poll.created',
      'src/poll.ts:9 data prisma polls write',
    ]);
  });

  it('meets the bar when every labelled site is found and nothing else is', () => {
    const labels: ForkConnections = { scope: ['*'], sites: connectionsOf(GRAPH, ['*']) };
    expect(connectionBarProblems(compareConnections(labels, GRAPH))).toEqual([]);
  });

  it('says what breaks the bar: a false find, a miss without a reason, recall under 95%, a stale miss', () => {
    const all = connectionsOf(GRAPH, ['*']);
    const [link, write4, email, job, write9] = all as [
      (typeof all)[number],
      (typeof all)[number],
      (typeof all)[number],
      (typeof all)[number],
      (typeof all)[number],
    ];
    const labels: ForkConnections = {
      scope: ['*'],
      sites: [
        link,
        { ...write4, missed: 'should be stale' },
        email,
        { file: 'src/poll.ts', line: 20, kind: 'data', to: 'prisma options read' },
        {
          file: 'src/poll.ts',
          line: 21,
          kind: 'data',
          to: 'prisma options read',
          missed: 'Its model comes from a factory the engine can’t follow.',
        },
        write9,
      ],
    };
    expect(job).toBeDefined();
    const result = compareConnections(labels, GRAPH);
    expect(result.kinds.data).toMatchObject({ labelled: 4, found: 2 });
    expect(connectionBarProblems(result)).toEqual([
      'recall 66.7% is under 95%',
      'false find: src/poll.ts:00006:handoff:job:poll.created',
      'missed without a reason: src/poll.ts:00020:data:prisma options read',
      'labelled as missed, but found: src/poll.ts:00004:data:prisma polls write',
    ]);
  });
});

describe('labels/connections.json', () => {
  const file = JSON.parse(
    readFileSync(new URL('../labels/connections.json', import.meta.url), 'utf8'),
  ) as Record<string, ForkConnections | string>;

  it('labels the four forks, each site in its scope and kind, none twice and none in packages/ee', () => {
    // The owner's scope (15 Nov 2026): all of Rallly and Documenso; phase 8's fixed modules of LibreChat and Twenty.
    const entryScopes = JSON.parse(
      readFileSync(new URL('../labels/entry-points.json', import.meta.url), 'utf8'),
    ) as Record<string, { scope: Record<string, string[]> }>;
    for (const fork of ['rallly', 'documenso', 'librechat', 'twenty']) {
      const labelled = file[fork] as ForkConnections;
      const phase8 = [
        ...new Set(
          Object.values(entryScopes[fork]?.scope ?? {})
            .flat()
            .filter((p) => p !== '*'),
        ),
      ].sort();
      expect([...labelled.scope].sort()).toEqual(
        fork === 'rallly' || fork === 'documenso' ? ['*'] : phase8,
      );
      expect(labelled.sites.length).toBeGreaterThan(0);
      // Each fork holds phase 9's crossing; Documenso and Twenty phases 10 and 11's chains too.
      expect(labelled.chains?.some((c) => c.name.startsWith('Phase 9'))).toBe(true);
      const keys = new Set<string>();
      for (const s of labelled.sites) {
        expect(inConnectionScope(labelled.scope, s.file), `${fork} ${s.file}`).toBe(true);
        expect(CONNECTION_KINDS).toContain(s.kind);
        expect(s.file.startsWith('packages/ee/')).toBe(false);
        const key = `${s.file}:${String(s.line)}:${s.kind}:${s.to}`;
        expect(keys.has(key), `${fork}: duplicate site ${key}`).toBe(false);
        keys.add(key);
      }
    }
    expect(typeof file.about).toBe('string');
  });
});

describe('the Done whens’ chains', () => {
  it('holds when each node is reached from the one before it, and says where one breaks', () => {
    const labels: ForkConnections = {
      scope: ['*'],
      sites: [],
      chains: [
        {
          name: 'submit to its handler',
          path: ['src/form.tsx#Form', 'src/server.ts#(entry mutation polls.make)'],
        },
        {
          name: 'make writes and emails',
          path: ['src/poll.ts#make', '(data prisma polls write)', '(service email nodemailer)'],
        },
        { name: 'not there', path: ['src/poll.ts#gone'] },
      ],
    };
    expect(chainProblems(labels, GRAPH)).toEqual([
      'make writes and emails: (service email nodemailer) isn’t reached from (data prisma polls write)',
      'not there: no node src/poll.ts#gone',
    ]);
  });
});
