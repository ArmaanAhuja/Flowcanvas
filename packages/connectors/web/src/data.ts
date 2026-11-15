// Reads and writes of the database (build plan phase 10, owner 15 Nov 2026; ADR 0031): Prisma, Kysely, raw SQL,
// Mongoose and TypeORM. A call is one when its receiver comes from that library (`originOf`); its table is what the
// code fixes (a Prisma model's accessor and the schema's @@map, a Kysely table literal, a Mongoose model's name, a
// TypeORM entity's @Entity name), or null with why, never guessed.
import type * as TS from 'typescript';
import type { DataLibrary, DataOperation } from '@flowcanvas/graph-model';
import { stringValue, type FileContext } from './ast.js';
import { NEW, PARAM, callArguments, isCall, originOf, type Origin } from './origin.js';

export interface FoundData {
  readonly library: DataLibrary;
  /** The table, a MongoDB model's name for Mongoose; null when the code doesn't fix it. */
  readonly table: string | null;
  readonly operation: DataOperation;
  readonly complete: boolean;
  readonly why?: string;
}

export const DATA_MESSAGES = {
  noModel: 'Its model isn’t in the project’s Prisma schema.',
  table: 'Its table isn’t a constant the code fixes.',
  sql: 'Its query isn’t text the code fixes, so its tables aren’t known.',
  entity: 'Its entity isn’t known from the code.',
} as const;

const PRISMA_READ = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const PRISMA_WRITE = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);
const PRISMA_RAW = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']);
/** `@prisma/client`, and a client generated into the project (`./generated/prisma`, `.prisma/client`). */
const PRISMA_MODULE =
  /^@prisma\/client(\/|$)|(^|\/)\.prisma\/client(\/|$)|(^|\/)generated\/prisma(\/|$)/;

const KYSELY_STARTS: ReadonlyMap<string, DataOperation> = new Map([
  ['selectFrom', 'read'],
  ['insertInto', 'write'],
  ['replaceInto', 'write'],
  ['updateTable', 'write'],
  ['deleteFrom', 'write'],
  ['mergeInto', 'write'],
]);

const MONGOOSE_READ = new Set([
  'find',
  'findOne',
  'findById',
  'countDocuments',
  'estimatedDocumentCount',
  'exists',
  'distinct',
  'aggregate',
]);
const MONGOOSE_WRITE = new Set([
  'create',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'findByIdAndDelete',
  'deleteOne',
  'deleteMany',
  'bulkWrite',
]);

const TYPEORM_READ = new Set([
  'find',
  'findBy',
  'findOne',
  'findOneBy',
  'findOneOrFail',
  'findOneByOrFail',
  'findAndCount',
  'findAndCountBy',
  'count',
  'countBy',
  'exists',
  'existsBy',
  'sum',
  'average',
  'minimum',
  'maximum',
]);
const TYPEORM_WRITE = new Set([
  'save',
  'insert',
  'update',
  'upsert',
  'delete',
  'softDelete',
  'restore',
  'remove',
  'softRemove',
  'increment',
  'decrement',
  'clear',
]);
/** Methods that hand back a repository for a table named in their arguments (TypeORM's and Twenty's own). */
const REPOSITORY_GETTERS = new Set(['getRepository', 'getRepositoryForWorkspace']);

/** A Prisma schema's models: each accessor (`poll`, as the client names it) → its table (`@@map`, else the model). */
export function prismaTables(schema: string): Map<string, string> {
  const tables = new Map<string, string>();
  for (const match of schema.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    const model = match[1] ?? '';
    const mapped = /@@map\(\s*(?:name\s*:\s*)?"([^"]+)"/.exec(match[2] ?? '')?.[1];
    tables.set(model.charAt(0).toLowerCase() + model.slice(1), mapped ?? model);
  }
  return tables;
}

/** The tables a SQL text names, and whether it writes. */
export function sqlTables(text: string): { tables: string[]; operation: DataOperation } {
  const tables = new Set<string>();
  for (const match of text.matchAll(
    /\b(for\s+)?(?:from|join|into|update)\s+("?[A-Za-z_][\w."]*)/gi,
  )) {
    // `FOR UPDATE SKIP LOCKED` locks rows; it names no table.
    if (match[1] !== undefined) continue;
    const name = (match[2] ?? '').replaceAll('"', '');
    if (name !== '' && !/^(select|set|lateral)$/i.test(name)) tables.add(name);
  }
  const operation: DataOperation =
    /^\s*(with\b[\s\S]*?\)\s*)?(insert|update|delete|merge|upsert)\b/i.test(text)
      ? 'write'
      : 'read';
  return { tables: [...tables], operation };
}

/** After `new PrismaClient()`, the steps that keep it a client (`$extends(…)`, a transaction's `tx`) taken out. */
function prismaRest(origin: Origin): string[] | null {
  if (origin.module === null || !PRISMA_MODULE.test(origin.module)) return null;
  // A client, or a transaction's (`tx: Prisma.TransactionClient`).
  const client = origin.name === 'PrismaClient' && origin.steps[0] === NEW;
  const transaction =
    origin.name === 'Prisma' && origin.steps[0] === 'TransactionClient' && origin.steps[1] === NEW;
  if (!client && !transaction) return null;
  const rest: string[] = [];
  const steps = origin.steps.slice(client ? 1 : 2);
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] ?? '';
    const after = steps[i + 1];
    if ((step === '$extends' || step === '$transaction') && (isCall(after) || after === PARAM)) {
      i += 1;
      continue;
    }
    rest.push(step);
  }
  return rest;
}

/** Whether a value is Kysely's: from `kysely`, a Prisma client's `$kysely`, or a callback inside such a query. */
function isKysely(origin: Origin): boolean {
  return origin.module === 'kysely' || origin.steps.includes('$kysely');
}

/** A Mongoose model's name, when the value is the model itself (`mongoose.model('User', …)`, `models.User`). */
function mongooseModel(origin: Origin): string | null {
  if (origin.module !== 'mongoose') return null;
  // From `typeof import('mongoose')` the first property is the import's name (`models`): read it as a step.
  const steps =
    origin.name === 'default' || origin.name === '*'
      ? origin.steps
      : [origin.name, ...origin.steps];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i] ?? '';
    if (step === 'model' && isCall(steps[i + 1]) && i + 2 === steps.length) {
      return callArguments(steps[i + 1] ?? '')[0] ?? null;
    }
    if (step === 'models' && i + 2 === steps.length) return steps[i + 1] ?? null;
  }
  return null;
}

/** Each call in a file that reads or writes the database. */
export function dataOf(
  context: FileContext,
  call: TS.CallExpression,
  tables: ReadonlyMap<string, string>,
): FoundData | null {
  const { ts } = context;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  const receiver = callee.expression;
  const origin = originOf(context, receiver);

  if (origin !== null) {
    const rest = prismaRest(origin);
    if (rest !== null) {
      if (rest.length === 1 && (PRISMA_READ.has(method) || PRISMA_WRITE.has(method))) {
        const table = tables.get(rest[0] ?? '') ?? null;
        return {
          library: 'prisma',
          table,
          operation: PRISMA_WRITE.has(method) ? 'write' : 'read',
          complete: table !== null,
          ...(table === null ? { why: DATA_MESSAGES.noModel } : {}),
        };
      }
      if (rest.length === 0 && PRISMA_RAW.has(method)) return rawSql(context, call.arguments[0]);
    }
    const start = KYSELY_STARTS.get(method);
    if (start !== undefined && isKysely(origin)) {
      const first = call.arguments[0];
      const written = first === undefined ? null : stringValue(context, first);
      const table = written === null ? null : (written.split(/\s+as\s+/i)[0]?.trim() ?? null);
      return {
        library: 'kysely',
        table: table === '' ? null : table,
        operation: start,
        complete: table !== null && table !== '',
        ...(table === null || table === '' ? { why: DATA_MESSAGES.table } : {}),
      };
    }
    const model = mongooseModel(origin);
    if (model !== null && (MONGOOSE_READ.has(method) || MONGOOSE_WRITE.has(method))) {
      return {
        library: 'mongoose',
        table: model,
        operation: MONGOOSE_WRITE.has(method) ? 'write' : 'read',
        complete: true,
      };
    }
  }
  if (TYPEORM_READ.has(method) || TYPEORM_WRITE.has(method)) {
    const table = repositoryTable(context, receiver, origin);
    if (table !== undefined) {
      return {
        library: 'typeorm',
        table,
        operation: TYPEORM_WRITE.has(method) ? 'write' : 'read',
        complete: table !== null,
        ...(table === null ? { why: DATA_MESSAGES.entity } : {}),
      };
    }
  }
  return null;
}

/** A tagged template of raw SQL: Kysely's `sql`, Prisma's `$queryRaw` (tagged). */
export function taggedDataOf(
  context: FileContext,
  tagged: TS.TaggedTemplateExpression,
): FoundData | null {
  const { ts } = context;
  const tag = tagged.tag;
  if (ts.isPropertyAccessExpression(tag) && PRISMA_RAW.has(tag.name.text)) {
    const origin = originOf(context, tag.expression);
    const rest = origin === null ? null : prismaRest(origin);
    if (rest !== null && rest.length === 0) return rawSql(context, tagged.template);
    return null;
  }
  const origin = originOf(context, tag);
  // Kysely's sql is a query when it's executed (`sql\`…\`.execute(db)`); in a builder it's part of one.
  const executed =
    ts.isPropertyAccessExpression(tagged.parent) &&
    tagged.parent.expression === tagged &&
    tagged.parent.name.text === 'execute';
  if (
    origin?.module === 'kysely' &&
    origin.name === 'sql' &&
    origin.steps.length === 0 &&
    executed
  ) {
    return rawSql(context, tagged.template);
  }
  return null;
}

function rawSql(context: FileContext, query: TS.Node | undefined): FoundData {
  const { ts } = context;
  let text: string | null = null;
  if (query !== undefined) {
    if (ts.isNoSubstitutionTemplateLiteral(query) || ts.isStringLiteral(query)) text = query.text;
    else if (ts.isTemplateExpression(query)) {
      // The fixed text around the values: `SELECT … FROM "Poll" WHERE id = ${id}` names its tables there.
      text = [query.head.text, ...query.templateSpans.map((s) => s.literal.text)].join(' ? ');
    }
  }
  if (text === null) {
    return {
      library: 'sql',
      table: null,
      operation: 'read',
      complete: false,
      why: DATA_MESSAGES.sql,
    };
  }
  const { tables, operation } = sqlTables(text);
  // Text the code fixes that names no table (`SELECT pg_advisory_xact_lock(…)`): the database, no table.
  return {
    library: 'sql',
    table: tables.length === 0 ? null : tables.join(', '),
    operation,
    complete: true,
  };
}

/**
 * A TypeORM repository's table: undefined when the receiver isn't a repository at all; null when it is but its table
 * isn't known. From its declared type (`Repository<UserEntity>`, `@InjectRepository(UserEntity)`), or the call that
 * hands it back (`getRepository(UserEntity)`, Twenty's `getRepositoryForWorkspace(workspaceId, 'person')`).
 */
function repositoryTable(
  context: FileContext,
  receiver: TS.Expression,
  origin: Origin | null,
): string | null | undefined {
  const { ts } = context;
  // Handed back by a getter: the last call in the origin's steps after a getter's name.
  if (origin !== null) {
    const steps = origin.steps;
    for (let i = steps.length - 2; i >= 0; i -= 1) {
      if (
        REPOSITORY_GETTERS.has(steps[i] ?? '') &&
        isCall(steps[i + 1]) &&
        i + 2 === steps.length
      ) {
        // The last name given (`getRepositoryForWorkspace(workspaceId, 'person')`, `getRepository('person')`).
        const named = callArguments(steps[i + 1] ?? '')
          .filter((a) => a !== null)
          .at(-1);
        return named ?? null;
      }
    }
  }
  const declaration = declarationOf(context, receiver);
  if (declaration === undefined) return undefined;
  // `@InjectRepository(UserEntity)` on the parameter or property.
  for (const decorator of ts.canHaveDecorators(declaration)
    ? (ts.getDecorators(declaration) ?? [])
    : []) {
    const call = decorator.expression;
    if (
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === 'InjectRepository'
    ) {
      const [entity] = call.arguments;
      return entity === undefined ? null : entityTable(context, entity);
    }
  }
  const type = 'type' in declaration ? (declaration.type as TS.TypeNode | undefined) : undefined;
  if (type !== undefined && ts.isTypeReferenceNode(type)) {
    const name = ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.right.text;
    if (name.endsWith('Repository')) {
      const [argument] = type.typeArguments ?? [];
      return argument !== undefined && ts.isTypeReferenceNode(argument)
        ? entityTable(
            context,
            ts.isIdentifier(argument.typeName) ? argument.typeName : argument.typeName.right,
          )
        : null;
    }
  }
  // Declared from a getter's call: `const repo = await manager.getRepository(UserEntity)`.
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    let value: TS.Expression = declaration.initializer;
    while (ts.isAwaitExpression(value) || ts.isParenthesizedExpression(value))
      value = value.expression;
    if (
      ts.isCallExpression(value) &&
      ts.isPropertyAccessExpression(value.expression) &&
      REPOSITORY_GETTERS.has(value.expression.name.text)
    ) {
      for (const argument of [...value.arguments].reverse()) {
        if (ts.isStringLiteralLike(argument)) return argument.text;
        if (ts.isIdentifier(argument)) {
          const table = entityTable(context, argument);
          if (table !== null) return table;
        }
      }
      const [typed] = value.typeArguments ?? [];
      return typed !== undefined && ts.isTypeReferenceNode(typed)
        ? entityTable(
            context,
            ts.isIdentifier(typed.typeName) ? typed.typeName : typed.typeName.right,
          )
        : null;
    }
  }
  return undefined;
}

/** What a receiver names: a variable, parameter or class member the project declares. */
function declarationOf(context: FileContext, receiver: TS.Expression): TS.Declaration | undefined {
  const { ts, checker } = context;
  if (checker === undefined) return undefined;
  const at = ts.isPropertyAccessExpression(receiver) ? receiver.name : receiver;
  const symbol = checker.getSymbolAtLocation(at);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (declaration === undefined || declaration.getSourceFile().isDeclarationFile) return undefined;
  return declaration;
}

/** An entity class's table: `@Entity('user')`, `@Entity({ name: 'user' })`; else the class has no fixed table. */
function entityTable(context: FileContext, entity: TS.Node): string | null {
  const { ts, checker } = context;
  if (checker === undefined) return null;
  let symbol = checker.getSymbolAtLocation(entity);
  if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  if (declaration === undefined) return null;
  for (const decorator of ts.getDecorators(declaration) ?? []) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
    if (call.expression.text !== 'Entity') continue;
    const [first] = call.arguments;
    // No name given: the naming strategy decides, which the code here doesn't say.
    if (first === undefined) return null;
    if (ts.isStringLiteralLike(first)) return first.text;
    if (ts.isObjectLiteralExpression(first)) {
      for (const property of first.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'name'
        ) {
          return stringValue(context, property.initializer);
        }
      }
    }
    return null;
  }
  return null;
}
