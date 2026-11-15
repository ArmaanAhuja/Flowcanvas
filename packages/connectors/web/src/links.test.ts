import type * as TS from 'typescript';
import { describe, expect, it } from 'vitest';
import { graphqlKeys, linkOf, LINK_MESSAGES, type FoundLink } from './links.js';
import { programOf } from './test-program.js';

function found(files: Record<string, string>, path: string): [number, FoundLink][] {
  const context = programOf(files)(path);
  const { ts, source } = context;
  const out: [number, FoundLink][] = [];
  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const hit = linkOf(context, node);
      if (hit !== null)
        out.push([source.getLineAndCharacterOfPosition(node.getStart()).line + 1, hit]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('linkOf', () => {
  it('finds tRPC requests by the procedure’s path: queries, and mutate on a useMutation', () => {
    const hits = found(
      {
        '/trpc.ts':
          "import { createTRPCReact } from '@trpc/react-query';\nexport const trpc = createTRPCReact();",
        '/form.tsx': [
          "import { trpc } from './trpc';",
          'export function Form() {',
          '  const makePoll = trpc.polls.make.useMutation();',
          '  const { mutateAsync: send } = trpc.document.distribute.useMutation();',
          '  const polls = trpc.polls.list.useQuery();',
          '  const utils = trpc.useUtils();',
          '  return { submit: async () => { await makePoll.mutateAsync({}); await send({}); utils.polls.list.invalidate(); } };',
          '}',
        ].join('\n'),
      },
      '/form.tsx',
    );
    expect(hits.map(([line, h]) => [line, h.keys])).toEqual([
      [5, ['polls.list']],
      [7, ['polls.make']],
      [7, ['document.distribute']],
    ]);
  });

  it('finds fetch and axios to the app’s own paths, through a wrapper and a URL builder', () => {
    const hits = found(
      {
        '/endpoints.ts': [
          "let BASE_URL = '';",
          'export const login = () => `${BASE_URL}/api/auth/login`;',
          'export const message = (id: string) => `/api/messages/${id}`;',
        ].join('\n'),
        '/request.ts': [
          "import axios from 'axios';",
          'async function _post(url: string, data?: unknown) { return (await axios.post(url, data)).data; }',
          'export default { post: _post };',
        ].join('\n'),
        '/service.ts': [
          "import request from './request';",
          "import * as endpoints from './endpoints';",
          'declare const id: string;',
          'request.post(endpoints.login(), {});',
          "fetch(endpoints.message(id), { method: 'DELETE' });",
          "fetch('/api/polls?limit=5');",
          "fetch('https://api.github.com/user');",
          'declare const anywhere: string;',
          'fetch(anywhere);',
        ].join('\n'),
      },
      '/service.ts',
    );
    expect(hits.map(([line, h]) => [line, h.keys, h.why ?? null])).toEqual([
      [4, ['POST {BASE_URL}/api/auth/login'], null],
      [5, ['DELETE /api/messages/:param'], null],
      [6, ['GET /api/polls'], null],
      [9, [], LINK_MESSAGES.url],
    ]);
  });

  it('finds Apollo’s requests by operation and root field, from gql text or a generated document', () => {
    const hits = found(
      {
        '/docs.ts': [
          "import { gql } from '@apollo/client';",
          'export const SIGN_IN = gql`mutation SignIn($e: String!) { signIn(email: $e) { tokens { token } } }`;',
          "export const GetMe = { kind: 'Document', definitions: [{ kind: 'OperationDefinition', operation: 'query', selectionSet: { kind: 'SelectionSet', selections: [{ kind: 'Field', name: { kind: 'Name', value: 'currentUser' } }] } }] } as unknown as object;",
        ].join('\n'),
        '/auth.ts': [
          "import { useMutation, useQuery } from '@apollo/client';",
          "import { SIGN_IN, GetMe } from './docs';",
          'export function useAuth() {',
          '  const [signIn] = useMutation(SIGN_IN);',
          '  const me = useQuery(GetMe);',
          '  return () => signIn({});',
          '}',
        ].join('\n'),
      },
      '/auth.ts',
    );
    expect(hits.map(([line, h]) => [line, h.keys])).toEqual([
      [5, ['query currentUser']],
      [6, ['mutation signIn']],
    ]);
  });

  it('reads a document’s root fields, skipping aliases, arguments and fragments', () => {
    expect(graphqlKeys('query Q { me: currentUser(id: 1) { id } workspaces { ...W } }')).toEqual([
      'query currentUser',
      'query workspaces',
    ]);
  });
});
