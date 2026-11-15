import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';
import { HANDOFF_MESSAGES, handoffOf, receiversOf } from './handoffs.js';
import { programOf } from './test-program.js';

function senders(files: Record<string, string>, path: string) {
  const context = programOf(files)(path);
  const { ts, source } = context;
  const out: unknown[][] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const hit = handoffOf(context, node);
      if (hit !== null) out.push([hit.kind, hit.key, hit.name, hit.why ?? null]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const QUEUES = "export enum MessageQueue { emailQueue = 'email-queue' }";

describe('handoffOf and receiversOf', () => {
  it('joins a NestJS queue’s add and addCron to the processor’s @Process method (Twenty)', () => {
    const files = {
      '/queues.ts': QUEUES,
      '/email-sender.job.ts': [
        "import { MessageQueue } from './queues';",
        'declare function Processor(q: string): ClassDecorator;',
        'declare function Process(j: string): MethodDecorator;',
        '@Processor(MessageQueue.emailQueue)',
        'export class EmailSenderJob {',
        '  @Process(EmailSenderJob.name)',
        '  async handle() {}',
        '}',
      ].join('\n'),
      '/email.service.ts': [
        "import { MessageQueue } from './queues';",
        "import { EmailSenderJob } from './email-sender.job';",
        'declare function InjectMessageQueue(q: string): ParameterDecorator;',
        'export class EmailService {',
        '  constructor(@InjectMessageQueue(MessageQueue.emailQueue) private readonly queue: { add(j: string, d: unknown): void; addCron(o: unknown): void }) {}',
        '  send() {',
        '    this.queue.add(EmailSenderJob.name, {});',
        "    this.queue.addCron({ jobName: EmailSenderJob.name, data: {}, options: { repeat: { pattern: '* * * * *' } } });",
        '  }',
        '}',
      ].join('\n'),
    };
    expect(senders(files, '/email.service.ts')).toEqual([
      ['queue', 'queue:email-queue/EmailSenderJob', 'email-queue · EmailSenderJob', null],
      ['cron', 'queue:email-queue/EmailSenderJob', 'email-queue · EmailSenderJob', null],
    ]);
    const context = programOf(files)('/email-sender.job.ts');
    const [receiver] = receiversOf(context);
    expect(receiver?.key).toBe('queue:email-queue/EmailSenderJob');
    expect(context.source.text.slice(receiver?.handler.start, receiver?.handler.end)).toMatch(
      /^@Process|^async handle/,
    );
  });

  it('joins a job client’s triggerJob to the definition with that trigger’s name (Documenso)', () => {
    const files = {
      '/definition.ts': [
        "const ID = 'send.signing.requested.email';",
        'export const DEF = { id: ID, trigger: { name: ID }, handler: async () => {} };',
      ].join('\n'),
      '/send.ts': [
        'declare const jobs: { triggerJob(o: unknown): Promise<void> };',
        'declare const dynamic: string;',
        "await jobs.triggerJob({ name: 'send.signing.requested.email', payload: {} });",
        'await jobs.triggerJob({ name: dynamic, payload: {} });',
      ].join('\n'),
    };
    expect(senders(files, '/send.ts')).toEqual([
      ['job', 'job:send.signing.requested.email', 'send.signing.requested.email', null],
      ['job', null, null, HANDOFF_MESSAGES.name],
    ]);
    expect(receiversOf(programOf(files)('/definition.ts')).map((r) => r.key)).toEqual([
      'job:send.signing.requested.email',
    ]);
  });

  it('finds events, BullMQ queues and workers, and timers', () => {
    const files = {
      '/e.ts': [
        "import { EventEmitter } from 'node:events';",
        "import { Queue, Worker } from 'bullmq';",
        'const bus = new EventEmitter();',
        "const mail = new Queue('mail');",
        "bus.on('poll.created', async () => {});",
        "new Worker('mail', async () => {});",
        "bus.emit('poll.created', {});",
        "await mail.add('welcome', {});",
        'setTimeout(() => {}, 1000);',
      ].join('\n'),
    };
    expect(senders(files, '/e.ts')).toEqual([
      ['event', 'event:poll.created', 'poll.created', null],
      ['queue', 'bullmq:mail', 'mail · welcome', null],
      ['timer', null, 'setTimeout', null],
    ]);
    expect(
      receiversOf(programOf(files)('/e.ts'))
        .map((r) => r.key)
        .sort(),
    ).toEqual(['bullmq:mail', 'event:poll.created']);
  });
});
