// Work handed off to run later or elsewhere (build plan phase 11, owner 15 Nov 2026; ADR 0031): queues and jobs, cron,
// events, timers and WebSockets. Two sides, joined by a key as links are: where work is handed off (a call), and what
// takes it (a handler declared in some file). The key is what the code fixes (a queue's and job's names, an event's
// name); when it isn't fixed, the hand-off is still shown, not fully detected, and joined to nothing.
import type * as TS from 'typescript';
import type { HandoffKind } from '@flowcanvas/graph-model';
import { stringValue, type FileContext } from './ast.js';
import { NEW, isCall, originOf } from './origin.js';
import type { Span } from './types.js';

export interface FoundHandoff {
  readonly kind: HandoffKind;
  /** Whose rules found it. */
  readonly library: string;
  /** What joins it to its handlers; null when the code doesn't fix it. */
  readonly key: string | null;
  /** As shown: the job, queue, schedule or event. */
  readonly name: string | null;
  readonly complete: boolean;
  readonly why?: string;
  /** For a timer: the function it runs, right here (no join needed). */
  readonly runs?: TS.Expression;
}

export interface FoundReceiver {
  readonly key: string;
  readonly library: string;
  /** The function or method that takes the work. */
  readonly handler: Span;
}

export const HANDOFF_MESSAGES = {
  name: 'Its name isn’t a constant the code fixes.',
  queue: 'Its queue isn’t known from the code.',
} as const;

const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']);

/** The name of a job or event as the code fixes it: a string, an enum member, or a class's `.name`. */
function nameOf(context: FileContext, expression: TS.Expression | undefined): string | null {
  const { ts } = context;
  if (expression === undefined) return null;
  const fixed = stringValue(context, expression);
  if (fixed !== null) return fixed;
  // `EmailSenderJob.name`: the class's name.
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'name' &&
    ts.isIdentifier(expression.expression)
  ) {
    const symbol = context.checker?.getSymbolAtLocation(expression.expression);
    const target =
      symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
        ? context.checker?.getAliasedSymbol(symbol)
        : symbol;
    if (target?.declarations?.some(ts.isClassDeclaration) === true)
      return expression.expression.text;
  }
  return null;
}

function property(
  ts: typeof TS,
  object: TS.Expression | undefined,
  name: string,
): TS.Expression | undefined {
  if (object === undefined || !ts.isObjectLiteralExpression(object)) return undefined;
  for (const p of object.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === name
    ) {
      return p.initializer;
    }
  }
  return undefined;
}

const decoratorsOf = (ts: typeof TS, node: TS.Node): readonly TS.Decorator[] =>
  ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];

/** A decorator's call by its name as imported (`Processor`, `OnEvent`), and its arguments. */
function decorator(
  ts: typeof TS,
  node: TS.Node,
  name: string,
): readonly TS.Expression[] | undefined {
  for (const d of decoratorsOf(ts, node)) {
    const call = d.expression;
    if (
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === name
    ) {
      return call.arguments;
    }
  }
  return undefined;
}

/** The queue a NestJS-style queue service was injected for (`@InjectMessageQueue(MessageQueue.emailQueue)`). */
function injectedQueue(context: FileContext, receiver: TS.Expression): string | null | undefined {
  const { ts, checker } = context;
  const at = ts.isPropertyAccessExpression(receiver) ? receiver.name : receiver;
  const symbol = checker?.getSymbolAtLocation(at);
  const declaration = symbol?.valueDeclaration;
  if (declaration === undefined) return undefined;
  const args = decorator(ts, declaration, 'InjectMessageQueue');
  if (args === undefined) return undefined;
  return nameOf(context, args[0]);
}

/** Where work is handed off, at a call. */
export function handoffOf(context: FileContext, call: TS.CallExpression): FoundHandoff | null {
  const { ts } = context;
  const callee = call.expression;
  const [first] = call.arguments;

  // Timers: run here, later.
  if (ts.isIdentifier(callee) && TIMERS.has(callee.text)) {
    const origin = originOf(context, callee);
    if (origin?.module !== null || origin.name !== callee.text) return null;
    return first === undefined
      ? null
      : {
          kind: 'timer',
          library: 'timers',
          key: null,
          name: callee.text,
          complete: true,
          runs: first,
        };
  }
  if (!ts.isPropertyAccessExpression(callee)) {
    // A WebSocket opened: `new WebSocket(url)` is a NewExpression, handled by `socketOf`.
    return null;
  }
  const method = callee.name.text;
  const receiver = callee.expression;

  // Documenso's job client: `jobs.triggerJob({ name: 'send.signing.requested.email', payload })`.
  if (method === 'triggerJob') {
    const name = nameOf(context, property(ts, first, 'name'));
    return {
      kind: 'job',
      library: 'job-client',
      key: name === null ? null : `job:${name}`,
      name,
      complete: name !== null,
      ...(name === null ? { why: HANDOFF_MESSAGES.name } : {}),
    };
  }

  // A NestJS queue service injected for a queue (Twenty's): `add(Job.name, data)`, `addCron({ jobName, … })`.
  if (method === 'add' || method === 'addCron') {
    const queue = injectedQueue(context, receiver);
    if (queue !== undefined) {
      const job =
        method === 'add' ? nameOf(context, first) : nameOf(context, property(ts, first, 'jobName'));
      const complete = queue !== null && job !== null;
      return {
        kind: method === 'addCron' ? 'cron' : 'queue',
        library: 'message-queue',
        key: complete ? `queue:${queue}/${job}` : null,
        name: job === null ? queue : queue === null ? job : `${queue} · ${job}`,
        complete,
        ...(complete
          ? {}
          : { why: queue === null ? HANDOFF_MESSAGES.queue : HANDOFF_MESSAGES.name }),
      };
    }
    // BullMQ: `queue.add('job', data)` on `new Queue('name')`.
    const origin = originOf(context, receiver);
    if (
      method === 'add' &&
      origin?.module === 'bullmq' &&
      origin.name === 'Queue' &&
      origin.steps[0] === NEW
    ) {
      const queue = queueOfNew(context, receiver);
      const job = nameOf(context, first);
      return {
        kind: 'queue',
        library: 'bullmq',
        key: queue === null ? null : `bullmq:${queue}`,
        name: job === null ? queue : queue === null ? job : `${queue} · ${job}`,
        complete: queue !== null,
        ...(queue === null ? { why: HANDOFF_MESSAGES.queue } : {}),
      };
    }
  }

  // Events: `emitter.emit('name', …)` on Node's or NestJS's emitter.
  if (method === 'emit' || method === 'emitAsync') {
    const origin = originOf(context, receiver);
    const emitter =
      origin !== null &&
      origin.module !== null &&
      /^(events|node:events|@nestjs\/event-emitter|eventemitter2|eventemitter3)$/.test(
        origin.module,
      ) &&
      origin.steps.some((step) => step === NEW || isCall(step));
    if (!emitter) return null;
    const name = nameOf(context, first);
    return {
      kind: 'event',
      library: origin.module === '@nestjs/event-emitter' ? 'nest-events' : 'events',
      key: name === null ? null : `event:${name}`,
      name,
      complete: name !== null,
      ...(name === null ? { why: HANDOFF_MESSAGES.name } : {}),
    };
  }
  return null;
}

/** `new WebSocket(url)`: a connection handed to the network, its messages arriving later. */
export function socketOf(context: FileContext, created: TS.NewExpression): FoundHandoff | null {
  const { ts } = context;
  if (!ts.isIdentifier(created.expression) || created.expression.text !== 'WebSocket') return null;
  const origin = originOf(context, created.expression);
  if (origin === null || !(origin.module === null || origin.module === 'ws')) return null;
  const [url] = created.arguments ?? [];
  const name = url === undefined ? null : stringValue(context, url);
  return {
    kind: 'websocket',
    library: origin.module ?? 'WebSocket',
    key: null,
    name,
    complete: true,
  };
}

/** A BullMQ queue's name, from the `new Queue('name')` the receiver comes from. */
function queueOfNew(context: FileContext, receiver: TS.Expression): string | null {
  const { ts, checker } = context;
  const symbol = checker?.getSymbolAtLocation(
    ts.isPropertyAccessExpression(receiver) ? receiver.name : receiver,
  );
  const declaration = symbol?.valueDeclaration;
  const init =
    declaration !== undefined &&
    (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration))
      ? declaration.initializer
      : undefined;
  return init !== undefined && ts.isNewExpression(init)
    ? nameOf(context, init.arguments?.[0])
    : null;
}

const spanOf = (source: TS.SourceFile, node: TS.Node): Span => ({
  start: node.getStart(source),
  end: node.getEnd(),
});

/** What takes handed-off work, declared in a file: job definitions, queue processors, event handlers, BullMQ workers. */
export function receiversOf(context: FileContext): FoundReceiver[] {
  const { ts, source } = context;
  const found: FoundReceiver[] = [];
  const visit = (node: TS.Node): void => {
    // `@Processor(MessageQueue.emailQueue)` class with `@Process(Job.name)` methods.
    if (ts.isClassDeclaration(node)) {
      const processor = decorator(ts, node, 'Processor');
      if (processor !== undefined) {
        const [arg] = processor;
        const queue =
          arg !== undefined && ts.isObjectLiteralExpression(arg)
            ? nameOf(context, property(ts, arg, 'queueName'))
            : nameOf(context, arg);
        for (const member of node.members) {
          const process = decorator(ts, member, 'Process');
          if (process === undefined || !ts.isMethodDeclaration(member) || queue === null) continue;
          const job = nameOf(context, process[0]);
          if (job !== null) {
            found.push({
              key: `queue:${queue}/${job}`,
              library: 'message-queue',
              handler: spanOf(source, member),
            });
          }
        }
      }
      for (const member of node.members) {
        const onEvent = decorator(ts, member, 'OnEvent');
        if (onEvent !== undefined && ts.isMethodDeclaration(member)) {
          const name = nameOf(context, onEvent[0]);
          if (name !== null)
            found.push({
              key: `event:${name}`,
              library: 'nest-events',
              handler: spanOf(source, member),
            });
        }
      }
    }
    // Documenso's job definitions: `{ trigger: { name: 'x' }, handler: async (…) => … }`.
    if (ts.isObjectLiteralExpression(node)) {
      const trigger = property(ts, node, 'trigger');
      const handler = property(ts, node, 'handler');
      const name = nameOf(context, property(ts, trigger, 'name'));
      if (
        name !== null &&
        handler !== undefined &&
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
      ) {
        found.push({ key: `job:${name}`, library: 'job-client', handler: spanOf(source, handler) });
      }
    }
    // BullMQ: `new Worker('queue', processor)`.
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Worker'
    ) {
      const origin = originOf(context, node.expression);
      const [queueArg, processor] = node.arguments ?? [];
      const queue = nameOf(context, queueArg);
      if (
        origin?.module === 'bullmq' &&
        queue !== null &&
        processor !== undefined &&
        (ts.isArrowFunction(processor) || ts.isFunctionExpression(processor))
      ) {
        found.push({
          key: `bullmq:${queue}`,
          library: 'bullmq',
          handler: spanOf(source, processor),
        });
      }
    }
    // Node's emitters: `emitter.on('name', handler)`.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^(on|once|addListener)$/.test(node.expression.name.text)
    ) {
      const origin = originOf(context, node.expression.expression);
      const [eventArg, handler] = node.arguments;
      const name = nameOf(context, eventArg);
      if (
        origin !== null &&
        origin.module !== null &&
        /^(events|node:events|eventemitter2|eventemitter3)$/.test(origin.module) &&
        name !== null &&
        handler !== undefined &&
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
      ) {
        found.push({ key: `event:${name}`, library: 'events', handler: spanOf(source, handler) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
