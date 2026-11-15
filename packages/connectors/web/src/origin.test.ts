import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';
import { originOf, packageOf, type Origin } from './origin.js';
import { programOf } from './test-program.js';

/** The origin of the receiver of the call on the file's line marked `// here`. */
function originAt(files: Record<string, string>, path: string): Origin | null {
  const context = programOf(files)(path);
  const { ts, source } = context;
  const line = source.text.split('\n').findIndex((l) => l.includes('// here'));
  let found: TS.CallExpression | undefined;
  const visit = (node: TS.Node): void => {
    if (
      found === undefined &&
      ts.isCallExpression(node) &&
      source.getLineAndCharacterOfPosition(node.getStart(source)).line === line
    ) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found === undefined) throw new Error('no call marked // here');
  const callee = found.expression;
  return originOf(context, ts.isPropertyAccessExpression(callee) ? callee.expression : callee);
}

describe('originOf', () => {
  it('follows an import from the project to the package it comes from, with each step', () => {
    expect(
      originAt(
        {
          '/db.ts':
            "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();",
          '/poll.ts':
            "import { prisma } from './db';\nexport const make = () => prisma.poll.create({}); // here",
        },
        '/poll.ts',
      ),
    ).toEqual({ module: '@prisma/client', name: 'PrismaClient', steps: ['new', 'poll'] });
  });

  it('follows a class to what it extends, and a typed constructor parameter to an instance of it', () => {
    expect(
      originAt(
        {
          '/prisma.service.ts':
            "import { PrismaClient } from '@prisma/client';\nexport class PrismaService extends PrismaClient {}",
          '/users.ts': [
            "import { PrismaService } from './prisma.service';",
            'export class Users {',
            '  constructor(private readonly prisma: PrismaService) {}',
            '  all() { return this.prisma.user.findMany(); } // here',
            '}',
          ].join('\n'),
        },
        '/users.ts',
      ),
    ).toEqual({ module: '@prisma/client', name: 'PrismaClient', steps: ['new', 'user'] });
  });

  it('follows require, destructuring and a factory’s returned object (CommonJS)', () => {
    expect(
      originAt(
        {
          '/models.js': [
            "const mongoose = require('mongoose');",
            "function createModels() { return { User: mongoose.models.User || mongoose.model('User', {}) }; }",
            'module.exports = createModels();',
          ].join('\n'),
          '/user.js': "const { User } = require('./models');\nUser.findOne({}); // here",
        },
        '/user.js',
      ),
    ).toMatchObject({ module: 'mongoose', name: 'default' });
  });

  it('follows a callback’s parameter to the call it’s given to', () => {
    expect(
      originAt(
        {
          '/db.ts':
            "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();",
          '/t.ts': [
            "import { prisma } from './db';",
            'await prisma.$transaction(async (tx) => {',
            '  await tx.poll.update({}); // here',
            '});',
          ].join('\n'),
        },
        '/t.ts',
      ),
    ).toEqual({
      module: '@prisma/client',
      name: 'PrismaClient',
      steps: ['new', '$transaction', '(param)', 'poll'],
    });
  });

  it('knows fetch as a global, and says nothing of what it can’t follow', () => {
    expect(originAt({ '/f.ts': "fetch('/api/polls'); // here" }, '/f.ts')).toEqual({
      module: null,
      name: 'fetch',
      steps: [],
    });
    expect(
      originAt({ '/g.ts': 'declare const x: any;\nx.poll.create(); // here' }, '/g.ts'),
    ).toBeNull();
  });
});

describe('originOf through a function typed to hand back what it’s given', () => {
  it('follows remember<T>(name, () => T): T to the value the factory makes', () => {
    expect(
      originAt(
        {
          '/remember.ts':
            'export function remember<T>(name: string, getValue: () => T): T {\n  return (globalThis as any)[name] ?? getValue();\n}',
          '/db.ts': [
            "import { PrismaClient } from '@prisma/client';",
            "import { remember } from './remember';",
            "const client = remember('prisma', () => new PrismaClient());",
            'export { client as prisma };',
          ].join('\n'),
          '/use.ts': "import { prisma } from './db';\nprisma.envelope.findMany(); // here",
        },
        '/use.ts',
      ),
    ).toEqual({ module: '@prisma/client', name: 'PrismaClient', steps: ['new', 'envelope'] });
  });
});

describe('originOf through assignments and pass-through wrappers', () => {
  it('follows a lazily set variable to what it’s assigned (`let client: Stripe | undefined`)', () => {
    expect(
      originAt(
        {
          '/service.ts': [
            "import Stripe from 'stripe';",
            'let client: Stripe | undefined;',
            'export function getStripe() {',
            "  if (!client) client = new Stripe('k');",
            '  return client;',
            '}',
          ].join('\n'),
          '/use.ts':
            "import { getStripe } from './service';\ngetStripe().prices.retrieve('p'); // here",
        },
        '/use.ts',
      ),
    ).toEqual({ module: 'stripe', name: 'default', steps: ['new', 'prices'] });
  });

  it('follows React’s cache to the function it wraps', () => {
    expect(
      originAt(
        {
          '/ssr.ts': [
            "import { cache } from 'react';",
            "import { createServerSideHelpers } from '@trpc/react-query/server';",
            'export const helper = cache(async () => createServerSideHelpers({}));',
          ].join('\n'),
          '/page.ts':
            "import { helper } from './ssr';\nconst trpc = await helper();\ntrpc.calendars.list.prefetch(); // here",
        },
        '/page.ts',
      ),
    ).toEqual({
      module: '@trpc/react-query/server',
      name: 'createServerSideHelpers',
      steps: ['(_)', 'calendars', 'list'],
    });
  });
});

describe('originOf through several returns and type aliases', () => {
  it('follows a function with a return per case when every one comes from one import', () => {
    expect(
      originAt(
        {
          '/mailer.ts': [
            "import { createTransport } from 'nodemailer';",
            'declare const provider: string;',
            'const getTransport = () => {',
            "  if (provider === 'smtp') return createTransport({ host: 'x' });",
            "  if (provider === 'resend') return createTransport({ service: 'r' });",
            '  return createTransport({});',
            '};',
            'export const mailer = getTransport();',
          ].join('\n'),
          '/send.ts': "import { mailer } from './mailer';\nmailer.sendMail({}); // here",
        },
        '/send.ts',
      ),
    ).toMatchObject({ module: 'nodemailer', name: 'createTransport' });
  });

  it('follows a parameter typed with an alias to the type it names', () => {
    expect(
      originAt(
        {
          '/q.ts': [
            "import type { ExpressionBuilder } from 'kysely';",
            'type EnvelopeBuilder = ExpressionBuilder;',
            "export const sub = (eb: EnvelopeBuilder) => eb.selectFrom('Recipient'); // here",
          ].join('\n'),
        },
        '/q.ts',
      ),
    ).toEqual({ module: 'kysely', name: 'ExpressionBuilder', steps: ['new'] });
  });
});

describe('originOf through dynamic and namespace imports', () => {
  it('names the export a property of a whole module is', () => {
    expect(
      originAt(
        {
          '/s.ts': [
            'export async function sign() {',
            "  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');",
            '  return getSignedUrl({}, {}); // here',
            '}',
          ].join('\n'),
        },
        '/s.ts',
      ),
    ).toEqual({ module: '@aws-sdk/s3-request-presigner', name: 'getSignedUrl', steps: [] });
    expect(
      originAt(
        {
          '/n.ts':
            "import * as presigner from '@aws-sdk/s3-request-presigner';\npresigner.getSignedUrl.call(null); // here",
        },
        '/n.ts',
      ),
    ).toEqual({ module: '@aws-sdk/s3-request-presigner', name: 'getSignedUrl', steps: [] });
  });
});

describe('originOf through type re-exports, declared properties and destructured callback parameters', () => {
  it('follows a type re-exported from a package the repository lacks', () => {
    expect(
      originAt(
        {
          '/billing.ts': "export type { Stripe } from 'stripe';",
          '/m.ts': [
            "import type { Stripe } from './billing';",
            'export const go = ({ stripe }: { stripe: Stripe }) => stripe.prices.list(); // here',
          ].join('\n'),
        },
        '/m.ts',
      ),
    ).toEqual({ module: 'stripe', name: 'Stripe', steps: ['new', 'prices'] });
  });

  it('follows a property a type declares, and one destructured from a callback’s parameter', () => {
    expect(
      originAt(
        {
          '/t.ts': [
            "import type { Transporter } from 'nodemailer';",
            'type Resolved = { transporter: Transporter };',
            'declare const resolved: Resolved;',
            'resolved.transporter.sendMail({}); // here',
          ].join('\n'),
        },
        '/t.ts',
      ),
    ).toEqual({ module: 'nodemailer', name: 'Transporter', steps: ['new'] });
    expect(
      originAt(
        {
          '/k.ts': [
            "import { Kysely } from 'kysely';",
            'const db = new Kysely();',
            "db.selectFrom('Envelope').where(({ eb }) => eb.selectFrom('Recipient')); // here",
          ].join('\n'),
        },
        '/k.ts',
      ),
    ).toMatchObject({ module: 'kysely', name: 'Kysely' });
  });
});

describe('originOf from an installed package’s types (owner, 15 Nov 2026)', () => {
  it('reads the package from where a value’s type is declared, where the code doesn’t say', () => {
    expect(packageOf('/w/node_modules/stripe/types/index.d.ts')).toBe('stripe');
    expect(packageOf('/w/node_modules/@types/nodemailer/index.d.ts')).toBe('nodemailer');
    expect(packageOf('/w/node_modules/@types/scope__name/index.d.ts')).toBe('@scope/name');
    expect(packageOf('/w/node_modules/.pnpm/x/node_modules/@prisma/client/index.d.ts')).toBe(
      '@prisma/client',
    );
    expect(packageOf('/w/node_modules/typescript/lib/lib.es5.d.ts')).toBeNull();
    expect(packageOf('/w/src/db.ts')).toBeNull();
    expect(
      originAt(
        {
          '/node_modules/stripe/package.json': JSON.stringify({
            name: 'stripe',
            types: 'index.d.ts',
          }),
          '/node_modules/stripe/index.d.ts':
            'declare class Stripe { prices: { list(): Promise<unknown> } }\nexport default Stripe;',
          // A client handed over by something the project can't follow (a dependency-injection container).
          '/c.ts': [
            "import type Stripe from 'stripe';",
            'declare const container: { get(name: string): unknown };',
            "const stripe = container.get('stripe') as Stripe;",
            'stripe.prices.list(); // here',
          ].join('\n'),
        },
        '/c.ts',
      ),
    ).toEqual({ module: 'stripe', name: 'Stripe', steps: ['new', 'prices'] });
  });
});
