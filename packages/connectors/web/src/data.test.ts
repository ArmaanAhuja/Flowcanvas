import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  DATA_MESSAGES,
  dataOf,
  prismaTables,
  sqlTables,
  taggedDataOf,
  type FoundData,
} from './data.js';
import { programOf } from './test-program.js';

const PRISMA =
  "import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();";
const TABLES = prismaTables(
  'model Poll {\n  id String @id\n  @@map("polls")\n}\nmodel Option {\n  id String @id\n}\n',
);

/** What each call (and tagged template) in a file reads or writes, in order. */
function found(files: Record<string, string>, path: string): FoundData[] {
  const context = programOf(files)(path);
  const { ts, source } = context;
  const out: FoundData[] = [];
  const visit = (node: TS.Node): void => {
    const hit = ts.isCallExpression(node)
      ? dataOf(context, node, TABLES)
      : ts.isTaggedTemplateExpression(node)
        ? taggedDataOf(context, node)
        : null;
    if (hit !== null) out.push(hit);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('prismaTables and sqlTables', () => {
  it('reads each model’s accessor and table, @@map included', () => {
    expect([...TABLES]).toEqual([
      ['poll', 'polls'],
      ['option', 'Option'],
    ]);
  });

  it('reads the tables a query names, and whether it writes', () => {
    expect(sqlTables('SELECT * FROM "Poll" p JOIN option o ON o.poll = p.id')).toEqual({
      tables: ['Poll', 'option'],
      operation: 'read',
    });
    expect(sqlTables('UPDATE "Poll" SET closed = true')).toEqual({
      tables: ['Poll'],
      operation: 'write',
    });
    // A row lock names no table.
    expect(sqlTables('SELECT id FROM queued_emails FOR UPDATE SKIP LOCKED').tables).toEqual([
      'queued_emails',
    ]);
  });
});

describe('dataOf', () => {
  it('finds Prisma reads and writes with their tables, through a transaction’s client', () => {
    const hits = found(
      {
        '/db.ts': PRISMA,
        '/poll.ts': [
          "import { prisma } from './db';",
          'export async function make() {',
          '  await prisma.poll.create({ data: {} });',
          '  await prisma.$transaction(async (tx) => { await tx.option.findMany(); });',
          '  await prisma.user.count();',
          '  prisma.poll.fields;',
          '}',
        ].join('\n'),
      },
      '/poll.ts',
    );
    expect(hits).toEqual([
      { library: 'prisma', table: 'polls', operation: 'write', complete: true },
      { library: 'prisma', table: 'Option', operation: 'read', complete: true },
      {
        library: 'prisma',
        table: null,
        operation: 'read',
        complete: false,
        why: DATA_MESSAGES.noModel,
      },
    ]);
  });

  it('finds a client given as a destructured parameter, by its default or its declared type', () => {
    expect(
      found(
        {
          '/db.ts': PRISMA,
          '/q.ts': [
            "import { prisma } from './db';",
            "import type { PrismaClient } from '@prisma/client';",
            'export const count = ({ db = prisma }: { db?: unknown }) => db.poll.count();',
            'export const all = ({ client }: { client: PrismaClient }) => client.option.findMany();',
          ].join('\n'),
        },
        '/q.ts',
      ).map((h) => [h.table, h.operation]),
    ).toEqual([
      ['polls', 'read'],
      ['Option', 'read'],
    ]);
  });

  it('finds a transaction client’s reads and writes (`tx: Prisma.TransactionClient`)', () => {
    // Re-exported from a client generated at build time, which the repository doesn't have (Rallly).
    expect(
      found(
        {
          '/database.ts': "export { Prisma } from './generated/prisma/client';",
          '/use.ts': [
            "import { Prisma } from './database';",
            'export const go = (tx: Prisma.TransactionClient) => tx.poll.update({});',
          ].join('\n'),
        },
        '/use.ts',
      ).map((h) => h.table),
    ).toEqual(['polls']);
    const hits = found(
      {
        '/t.ts': [
          "import { Prisma } from '@prisma/client';",
          'export async function sync(tx: Prisma.TransactionClient, db?: Prisma.TransactionClient) {',
          '  await tx.poll.findMany();',
          '  await db?.option.deleteMany();',
          '}',
        ].join('\n'),
      },
      '/t.ts',
    );
    expect(hits.map((h) => [h.table, h.operation])).toEqual([
      ['polls', 'read'],
      ['Option', 'write'],
    ]);
  });

  it('finds Kysely’s queries by their table, and raw SQL by the tables its text names', () => {
    const hits = found(
      {
        '/db.ts':
          "import { Kysely, sql } from 'kysely';\nexport const db = new Kysely({});\nexport { sql };",
        '/q.ts': [
          "import { db } from './db';",
          "import { sql } from 'kysely';",
          "db.selectFrom('Envelope as e').where((eb) => eb.exists(eb.selectFrom('Recipient')));",
          "db.updateTable('Envelope').set({});",
          'sql`DELETE FROM "Session" WHERE expires < now()`;',
          'sql`SELECT pg_advisory_xact_lock(1)`;',
        ].join('\n'),
      },
      '/q.ts',
    );
    expect(hits.map((h) => [h.library, h.table, h.operation])).toEqual([
      ['kysely', 'Envelope', 'read'],
      ['kysely', 'Recipient', 'read'],
      ['kysely', 'Envelope', 'write'],
      ['sql', 'Session', 'write'],
      ['sql', null, 'read'],
    ]);
  });

  it('finds Mongoose models’ reads and writes, from a factory of models (CommonJS)', () => {
    const hits = found(
      {
        '/models.js': [
          "const mongoose = require('mongoose');",
          "const createUser = () => mongoose.models.User || mongoose.model('User', {});",
          'module.exports = { User: createUser() };',
        ].join('\n'),
        '/user.js': [
          "const { User } = require('./models');",
          'User.findOne({});',
          'User.updateOne({}, {});',
        ].join('\n'),
      },
      '/user.js',
    );
    expect(hits.map((h) => [h.library, h.table, h.operation])).toEqual([
      ['mongoose', 'User', 'read'],
      ['mongoose', 'User', 'write'],
    ]);
  });

  it('finds TypeORM repositories’ tables from their entity, and from a getter’s argument', () => {
    const hits = found(
      {
        '/user.entity.ts': [
          "import { Entity } from 'typeorm';",
          "@Entity({ name: 'user', schema: 'core' })",
          'export class UserEntity {}',
        ].join('\n'),
        '/users.ts': [
          "import { Repository } from 'typeorm';",
          "import { InjectRepository } from '@nestjs/typeorm';",
          "import { UserEntity } from './user.entity';",
          'declare const manager: { getRepositoryForWorkspace(id: string, name: string): any };',
          'export class Users {',
          '  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}',
          '  async go() {',
          '    await this.users.findOneBy({});',
          "    const people = await manager.getRepositoryForWorkspace('w', 'person');",
          '    await people.save({});',
          '  }',
          '}',
        ].join('\n'),
      },
      '/users.ts',
    );
    expect(hits.map((h) => [h.library, h.table, h.operation])).toEqual([
      ['typeorm', 'user', 'read'],
      ['typeorm', 'person', 'write'],
    ]);
  });

  it('leaves calls it can’t tie to a library alone', () => {
    expect(
      found(
        { '/x.ts': 'declare const store: any;\nstore.poll.create({});\nstore.find();' },
        '/x.ts',
      ),
    ).toEqual([]);
  });
});
