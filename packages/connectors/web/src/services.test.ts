import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';
import { serviceOf, type FoundService } from './services.js';
import { programOf } from './test-program.js';

function found(files: Record<string, string>, path: string): [number, FoundService][] {
  const context = programOf(files)(path);
  const { ts, source } = context;
  const out: [number, FoundService][] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const hit = serviceOf(context, node);
      if (hit !== null)
        out.push([source.getLineAndCharacterOfPosition(node.getStart()).line + 1, hit]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('serviceOf', () => {
  it('finds email, payments, storage and AI by their package, the client’s calls only', () => {
    const hits = found(
      {
        '/mailer.ts':
          "import { createTransport } from 'nodemailer';\nexport const mailer = createTransport({});",
        '/s.ts': [
          "import Stripe from 'stripe';",
          "import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';",
          "import { getSignedUrl } from '@aws-sdk/s3-request-presigner';",
          "import OpenAI from 'openai';",
          "import { mailer } from './mailer';",
          "const stripe = new Stripe('k');",
          'const s3 = new S3Client({});',
          'const openai = new OpenAI();',
          'export async function go() {',
          '  await mailer.sendMail({});',
          '  await stripe.customers.create({});',
          '  await s3.send(new PutObjectCommand({}));',
          '  await getSignedUrl(s3, new PutObjectCommand({}));',
          '  await openai.chat.completions.create({});',
          '}',
        ].join('\n'),
      },
      '/s.ts',
    );
    expect(hits.map(([line, h]) => [line, h.kind, h.library])).toEqual([
      [10, 'email', 'nodemailer'],
      [11, 'payments', 'stripe'],
      [12, 'storage', '@aws-sdk/client-s3'],
      [13, 'storage', '@aws-sdk/s3-request-presigner'],
      [14, 'ai', 'openai'],
    ]);
  });

  it('finds fetch and axios to a fixed outside URL; the app’s own paths aren’t boundaries', () => {
    const hits = found(
      {
        '/h.ts': [
          "import axios from 'axios';",
          'declare const path: string;',
          "fetch('https://api.github.com/user');",
          'fetch(`https://hooks.slack.com/${path}`);',
          "axios.post('https://api.example.com/v1/items', {});",
          "fetch('/api/private/polls');",
          'fetch(path);',
        ].join('\n'),
      },
      '/h.ts',
    );
    expect(hits.map(([line, h]) => [line, h.library, h.url])).toEqual([
      [3, 'fetch', 'https://api.github.com/user'],
      [4, 'fetch', 'https://hooks.slack.com/'],
      [5, 'axios', 'https://api.example.com/v1/items'],
    ]);
  });
});
