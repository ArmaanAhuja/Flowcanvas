// The connectors in a real graph pass (phases 9 to 11, ADR 0031), on a small app shaped like the corpus forks (no
// node_modules): a Prisma schema and client, a tRPC router and a form calling it, a route handler and a fetch to it,
// a job definition and a call that triggers it, an email, an outside URL and a timer.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildFlow,
  indexGraph,
  listEntryPoints,
  validateGraph,
  type GraphNode,
  type HandoffKind,
} from '@flowcanvas/graph-model';
import { SemanticService } from './semantic-service.js';

vi.setConfig({ testTimeout: 20_000 });

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'app', private: true, dependencies: { next: '15' } }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      jsx: 'preserve',
      module: 'esnext',
      moduleResolution: 'bundler',
    },
  }),
  'prisma/schema.prisma': 'model Poll {\n  id String @id\n  @@map("polls")\n}\n',
  'src/db.ts':
    "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();",
  'src/mailer.ts':
    "import { createTransport } from 'nodemailer';\nexport const mailer = createTransport({});",
  'src/jobs.ts': [
    "import { mailer } from './mailer';",
    'export const SEND = {',
    "  trigger: { name: 'poll.created.email' },",
    '  handler: async () => {',
    '    await mailer.sendMail({});',
    '  },',
    '};',
    'export const jobs = { triggerJob: async (_: { name: string }) => {} };',
  ].join('\n'),
  'src/server.ts': [
    "import { initTRPC } from '@trpc/server';",
    "import { prisma } from './db';",
    "import { jobs } from './jobs';",
    'const t = initTRPC.create();',
    'export const appRouter = t.router({',
    '  polls: t.router({',
    '    make: t.procedure.mutation(async () => {',
    '      const poll = await prisma.poll.create({ data: {} });',
    "      await jobs.triggerJob({ name: 'poll.created.email' });",
    "      await fetch('https://hooks.example.com/notify');",
    '      setTimeout(remind, 1000);',
    '      return poll;',
    '    }),',
    '  }),',
    '});',
    'export function remind() {}',
  ].join('\n'),
  'src/trpc.ts':
    "import { createTRPCReact } from '@trpc/react-query';\nexport const trpc = createTRPCReact();",
  'src/app/api/polls/route.ts':
    'export async function GET() {\n  return Response.json([]);\n}\nexport async function POST() {\n  return Response.json({});\n}',
  // The project's own job client and request wrapper: calls into them resolve, and still hand off and link.
  'src/job-client.ts': [
    'class JobClient {',
    '  async triggerJob(options: { name: string }) {',
    '    return options;',
    '  }',
    '}',
    'export const jobsClient = new JobClient();',
  ].join('\n'),
  'src/request.ts': [
    "import axios from 'axios';",
    'export async function post(url: string, data?: unknown) {',
    '  return (await axios.post(url, data)).data;',
    '}',
  ].join('\n'),
  'src/close.ts': [
    "import { prisma } from './db';",
    "import { jobsClient } from './job-client';",
    "import { post } from './request';",
    'export async function closePoll() {',
    '  await prisma.poll',
    '    .update({ data: {} });',
    "  await jobsClient.triggerJob({ name: 'poll.closed' });",
    "  await post('/api/polls', {});",
    '}',
  ].join('\n'),
  'src/form.tsx': [
    "import { trpc } from './trpc';",
    'export function CreatePoll() {',
    '  const makePoll = trpc.polls.make.useMutation();',
    '  const submit = async () => {',
    '    await makePoll.mutateAsync({});',
    "    await fetch('/api/polls');",
    '  };',
    '  return <form onSubmit={submit} />;',
    '}',
  ].join('\n'),
};

let root: string;
let service: SemanticService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fc-connections-'));
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  service = new SemanticService({ ts, root, files: Object.keys(FILES) });
});
afterEach(() => {
  service.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe('the connectors in the graph pass', () => {
  it('draws tables, services, hand-offs and links as nodes, joined across files, the graph valid', async () => {
    const pass = await service.graph(() => Promise.resolve());
    if (pass === null) throw new Error('no pass');
    const { graph } = pass;
    expect(validateGraph(graph)).toEqual([]);
    // Built-ins the connectors recognise are still counted as built-ins (and listed so in the Calls tab): the
    // server's fetch and setTimeout, the form's fetch, Response.json.
    expect(pass.builtInCalls).toBeGreaterThanOrEqual(4);
    const node = (id: string) => graph.nodes.find((n) => n.id === id);
    const edge = (from: string, to: string) =>
      graph.edges.find((e) => e.from.startsWith(from) && e.to === to);

    // Phase 10: the write to Poll's table (its @@map), the email and the outside URL.
    expect(node('(data prisma polls write)')?.data).toMatchObject({
      table: 'polls',
      complete: true,
    });
    expect(edge('src/server.ts#', '(data prisma polls write)')).toMatchObject({
      kind: 'data',
      provenance: 'convention',
    });
    expect(node('(service email nodemailer)')?.name).toBe('Email · nodemailer');
    expect(node('(service http fetch https://hooks.example.com/notify)')?.name).toBe(
      'hooks.example.com',
    );

    // Phase 11: the job handed off, joined to its definition's handler, which sends the email.
    const job = '(handoff job:poll.created.email)';
    expect(node(job)?.handoff).toMatchObject({ kind: 'job', name: 'poll.created.email' });
    const handler = graph.edges.find((e) => e.from === job)?.to ?? '';
    expect(handler).toMatch(/^src\/jobs\.ts#.*\(handler poll\.created\.email\)$/);
    expect(edge(handler, '(service email nodemailer)')?.kind).toBe('boundary');
    // What takes the job is an entry point (owner, 15 Nov 2026): named by the job, at its handler, reaching it.
    const jobEntry = node('(entry job:poll.created.email)');
    expect(jobEntry).toMatchObject({
      kind: 'entry-point',
      name: 'poll.created.email',
      place: { path: 'src/jobs.ts', line: 4 },
      entry: { kind: 'job', framework: 'job-client', complete: true, why: null, within: null },
    });
    expect(edge('(entry job:poll.created.email)', handler)).toMatchObject({
      kind: 'call',
      provenance: 'convention',
    });
    // Listed for the panel, which opens its flow from the handler.
    // poll.closed has no definition here, so nothing takes it and it lists nothing.
    expect(listEntryPoints(indexGraph(graph)).job.map((e) => [e.name, e.handler?.id])).toEqual([
      ['poll.created.email', handler],
    ]);
    // A timer runs a named function: through its hand-off node.
    const timer = graph.nodes.find((n) => n.handoff?.kind === 'timer');
    expect(graph.edges.find((e) => e.from === timer?.id)?.to).toBe('src/server.ts#remind');

    // Phase 9: the form's mutate reaches the tRPC procedure's entry point, its fetch the route's.
    const entry = (name: string) =>
      graph.nodes.find((n) => n.kind === 'entry-point' && n.name === name);
    const make = entry('mutation polls.make');
    const get = entry('GET /api/polls');
    expect(edge('src/form.tsx#CreatePoll', make?.id ?? '')).toMatchObject({
      kind: 'call',
      provenance: 'convention',
    });
    expect(edge('src/form.tsx#CreatePoll', get?.id ?? '')).toBeDefined();
    // Their unknown stubs are gone; the hook that only prepares the mutation stays a call to a package.
    expect(
      graph.edges
        .filter((e) => e.from.startsWith('src/form.tsx') && e.provenance === 'unknown')
        .map((e) => e.target),
    ).toEqual(['trpc.polls.make.useMutation']);

    // Through the project's own code: the job client's triggerJob hands off; the wrapper's post reaches the route; a
    // chained call is drawn at its method's line (6, `.update`), not the chain's start (5).
    const close = 'src/close.ts#closePoll';
    expect(edge(close, '(data prisma polls write)')?.lines).toEqual([6]);
    expect(edge(close, '(handoff job:poll.closed)')).toMatchObject({ kind: 'handoff', lines: [7] });
    expect(edge(close, entry('POST /api/polls')?.id ?? '')).toMatchObject({
      provenance: 'convention',
      lines: [8],
    });

    // Done when (phase 9): the form's flow crosses into the handler, and on to the table and the job.
    // From the submit handler, as the form's onSubmit entry point opens it.
    const flow = buildFlow(indexGraph(graph), 'src/form.tsx#CreatePoll.submit');
    const ids = flow?.nodes.map((n) => n.id) ?? [];
    expect(ids).toContain(make?.id);
    expect(ids).toContain('(data prisma polls write)');
    expect(ids).toContain(job);
  });
});

describe('which route method serves a call', () => {
  it('is the same method, ALL, or React Router’s loader for GET and action for the rest', async () => {
    const { servesMethod } = await import('./connection-pass.js');
    expect(servesMethod('POST', 'POST')).toBe(true);
    expect(servesMethod('ALL', 'DELETE')).toBe(true);
    expect(servesMethod('loader', 'GET')).toBe(true);
    expect(servesMethod('loader', 'POST')).toBe(false);
    expect(servesMethod('action', 'POST')).toBe(true);
    expect(servesMethod('action', 'GET')).toBe(false);
    expect(servesMethod('GET', 'POST')).toBe(false);
  });
});

describe('bundled output', () => {
  it('is a file with a line over 10,000 characters, which the connectors skip', async () => {
    const { isBundled } = await import('./connection-pass.js');
    expect(isBundled(`const a = 1;\n${'x'.repeat(10_001)}\n`)).toBe(true);
    expect(isBundled(`const a = 1;\n${'x'.repeat(9_999)}\n`)).toBe(false);
  });
});

describe('what takes handed-off work, as entry points', () => {
  it('is a job, cron when the code schedules it, or an event; each receiver one; none without its handler', async () => {
    const { joinConnections } = await import('./connection-pass.js');
    const unit = (id: string, line: number): GraphNode => ({
      id,
      kind: 'code-unit',
      name: id.slice(id.indexOf('#') + 1),
      place: { path: id.slice(0, id.indexOf('#')), line, column: 3 },
      unit: 'method',
      change: 'unchanged',
    });
    const handoff = (key: string, kind: HandoffKind): GraphNode => ({
      id: `(handoff ${key})`,
      kind: 'async-handoff',
      name: key,
      place: null,
      unit: null,
      change: 'unchanged',
      handoff: { kind, library: 'message-queue', name: key, complete: true, why: null },
    });
    const nodes = new Map(
      [
        unit('src/email.job.ts#EmailSenderJob.handle', 12),
        unit('src/clean.job.ts#CleanJob.handle', 8),
        unit('src/a.listener.ts#A.onCreated', 5),
        unit('src/b.listener.ts#B.onCreated', 9),
        unit('src/sweep.ts#(handler internal.sweep)', 6),
        unit('src/__tests__/bus.test.ts#(handler user.created)', 4),
        handoff('queue:email-queue/EmailSenderJob', 'queue'),
        handoff('queue:cron-queue/CleanJob', 'cron'),
      ].map((n) => [n.id, n]),
    );
    const { edges, entries } = joinConnections(
      [
        {
          links: [],
          receivers: [
            {
              key: 'queue:email-queue/EmailSenderJob',
              library: 'message-queue',
              to: 'src/email.job.ts#EmailSenderJob.handle',
            },
            {
              key: 'queue:cron-queue/CleanJob',
              library: 'message-queue',
              to: 'src/clean.job.ts#CleanJob.handle',
            },
            {
              key: 'event:user.created',
              library: 'nest-events',
              to: 'src/a.listener.ts#A.onCreated',
            },
            // Scheduled by its definition (Documenso's `trigger.cron`): cron, with no hand-off to say so.
            {
              key: 'job:internal.sweep',
              library: 'job-client',
              to: 'src/sweep.ts#(handler internal.sweep)',
              scheduled: true,
            },
            // A test's listener takes its event, but isn't an entry point (owner, 14 Nov 2026).
            {
              key: 'event:user.created',
              library: 'events',
              to: 'src/__tests__/bus.test.ts#(handler user.created)',
            },
            // Its handler isn't in the graph (its file in no program): no entry point, rather than one going nowhere.
            { key: 'job:gone', library: 'job-client', to: 'src/gone.ts#run' },
          ],
        },
        {
          links: [],
          receivers: [
            {
              key: 'event:user.created',
              library: 'nest-events',
              to: 'src/b.listener.ts#B.onCreated',
            },
          ],
        },
      ],
      [],
      [],
      (id) => nodes.get(id),
    );
    expect(
      entries.map((e) => [e.id, e.name, e.entry?.kind, e.entry?.framework, e.place?.line]),
    ).toEqual([
      [
        '(entry queue:email-queue/EmailSenderJob)',
        'email-queue · EmailSenderJob',
        'job',
        'message-queue',
        12,
      ],
      ['(entry queue:cron-queue/CleanJob)', 'cron-queue · CleanJob', 'cron', 'message-queue', 8],
      ['(entry event:user.created)', 'user.created', 'event', 'nest-events', 5],
      ['(entry job:internal.sweep)', 'internal.sweep', 'cron', 'job-client', 6],
      ['(entry event:user.created)~2', 'user.created', 'event', 'nest-events', 9],
    ]);
    expect(validateGraph({ nodes: [...nodes.values(), ...entries], edges })).toEqual([]);
    expect(
      edges
        .filter((e) => e.from.startsWith('(entry'))
        .map((e) => [e.from, e.to, e.provenance, e.lines]),
    ).toEqual([
      [
        '(entry queue:email-queue/EmailSenderJob)',
        'src/email.job.ts#EmailSenderJob.handle',
        'convention',
        [12],
      ],
      ['(entry queue:cron-queue/CleanJob)', 'src/clean.job.ts#CleanJob.handle', 'convention', [8]],
      ['(entry event:user.created)', 'src/a.listener.ts#A.onCreated', 'convention', [5]],
      ['(entry job:internal.sweep)', 'src/sweep.ts#(handler internal.sweep)', 'convention', [6]],
      ['(entry event:user.created)~2', 'src/b.listener.ts#B.onCreated', 'convention', [9]],
    ]);
  });
});
