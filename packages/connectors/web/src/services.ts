// Calls that leave the project for an outside service (build plan phase 10, owner 15 Nov 2026; ADR 0031): email,
// payments, storage, AI, and a fixed outside URL. Known by the package the receiver comes from (`originOf`); a URL by
// what the code fixes of it. A relative URL is the app's own API (phase 9's links), never a boundary.
import type * as TS from 'typescript';
import type { ServiceKind } from '@flowcanvas/graph-model';
import { stringValue, type FileContext } from './ast.js';
import { NEW, isCall, originOf, type Origin } from './origin.js';

export interface FoundService {
  readonly kind: ServiceKind;
  /** The package (`nodemailer`, `stripe`), or `fetch`/`axios` for a URL. */
  readonly library: string;
  /** For `http`: the URL's fixed start (`https://api.github.com/user`); null otherwise. */
  readonly url: string | null;
  readonly complete: boolean;
  readonly why?: string;
}

/** Each package, what it reaches, and which of its calls do: a method on an instance (`send`), or any call. */
interface ServiceRule {
  readonly kind: ServiceKind;
  readonly module: RegExp;
  /** Calls that reach the service: the method's name; undefined for any call on the package's objects. */
  readonly methods?: ReadonlySet<string>;
}

const RULES: readonly ServiceRule[] = [
  { kind: 'email', module: /^nodemailer$/, methods: new Set(['sendMail']) },
  { kind: 'email', module: /^resend$/, methods: new Set(['send', 'create']) },
  { kind: 'email', module: /^@sendgrid\/mail$/, methods: new Set(['send', 'sendMultiple']) },
  { kind: 'email', module: /^postmark$/ },
  { kind: 'payments', module: /^stripe$/ },
  { kind: 'storage', module: /^@aws-sdk\/client-s3$/, methods: new Set(['send']) },
  { kind: 'storage', module: /^@aws-sdk\/s3-request-presigner$/ },
  { kind: 'storage', module: /^@aws-sdk\/lib-storage$/, methods: new Set(['done']) },
  { kind: 'ai', module: /^openai$/ },
  { kind: 'ai', module: /^@anthropic-ai\/sdk$/ },
];

/** A function given a URL: `fetch(url)`, `axios(url)`, `axios.get(url)`, `axios.post(url, …)`. */
const AXIOS_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'request',
]);

export const SERVICE_MESSAGES = {
  url: 'Its URL isn’t one the code fixes.',
} as const;

/**
 * A call to an outside service, or null. An instance's calls count (`transporter.sendMail`, `stripe.customers.create`);
 * the package's constructor and its configuration don't (`new Stripe(key)`, `createTransport(…)`).
 */
export function serviceOf(context: FileContext, call: TS.CallExpression): FoundService | null {
  const { ts } = context;
  const callee = call.expression;
  const http = httpOf(context, call);
  if (http !== undefined) return http;
  const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  const origin = originOf(
    context,
    ts.isPropertyAccessExpression(callee) ? callee.expression : callee,
  );
  const module = origin?.module ?? null;
  if (origin === null || module === null) return null;
  for (const rule of RULES) {
    if (!rule.module.test(module)) continue;
    if (rule.methods !== undefined) {
      if (method === null || !rule.methods.has(method) || !isInstance(origin)) continue;
    } else if (method === null ? origin.steps.length > 0 : !isInstance(origin)) {
      // A function of the package called directly (`getSignedUrl(…)`), or a method on one of its instances.
      continue;
    }
    return { kind: rule.kind, library: module, url: null, complete: true };
  }
  return null;
}

/** An instance of the package's client (`new Stripe(…)`, `createTransport(…)`), or something reached from one. */
function isInstance(origin: Origin): boolean {
  return origin.steps.some((step) => step === NEW || isCall(step));
}

/**
 * `fetch` or axios to a URL outside the app: an absolute URL the code fixes (its whole text, or the fixed start of a
 * template). Undefined when the call isn't `fetch` or axios at all; null when it is but the URL is the app's own (a
 * relative path, phase 9) or not fixed enough to know.
 */
function httpOf(context: FileContext, call: TS.CallExpression): FoundService | null | undefined {
  const { ts } = context;
  const callee = call.expression;
  let library: string | null = null;
  if (ts.isIdentifier(callee)) {
    const origin = originOf(context, callee);
    if (origin?.module === null && origin.name === 'fetch') library = 'fetch';
    else if (origin?.module === 'axios' && origin.steps.length === 0) library = 'axios';
  } else if (ts.isPropertyAccessExpression(callee) && AXIOS_METHODS.has(callee.name.text)) {
    const origin = originOf(context, callee.expression);
    // `axios.get`, or an instance from `axios.create(…)`.
    if (origin?.module === 'axios') library = 'axios';
  }
  if (library === null) return undefined;
  const [first] = call.arguments;
  if (first === undefined) return null;
  const url = fixedStart(context, first);
  if (url === null || !/^https?:\/\//i.test(url)) return null;
  return { kind: 'http', library, url, complete: true };
}

/** A URL's text when the code fixes it, or the fixed start of a template (`https://api.x.com/${path}` → its start). */
function fixedStart(context: FileContext, expression: TS.Expression): string | null {
  const { ts } = context;
  const whole = stringValue(context, expression);
  if (whole !== null) return whole;
  if (ts.isTemplateExpression(expression) && expression.head.text !== '')
    return expression.head.text;
  return null;
}
