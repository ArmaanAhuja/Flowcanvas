import { describe, expect, it } from 'vitest';
import { eventEntries, serverActionEntries } from './react.js';
import { programOf } from './test-program.js';

describe('eventEntries', () => {
  it('lists each event prop with its handler, inside the component it’s in', () => {
    const file = programOf({
      '/form.tsx': [
        'export function PollForm() {',
        '  const save = () => {};',
        '  return (',
        '    <form onSubmit={save}>',
        '      <button onClick={() => save()}>Save</button>',
        '      <Input onChange={form.handleChange} onBlur={debounce(save)} className="x" />',
        '    </form>',
        '  );',
        '}',
      ].join('\n'),
    });
    const found = eventEntries(file('/form.tsx'));
    expect(
      found.map((e) => [
        e.name,
        e.at.line,
        'handler' in e,
        'handlerName' in e,
        e.why,
        e.within !== undefined,
      ]),
    ).toEqual([
      ['<form> onSubmit', 4, false, true, undefined, true],
      ['<button> onClick', 5, true, false, undefined, true],
      ['<Input> onChange', 6, false, true, undefined, true],
      [
        '<Input> onBlur',
        6,
        false,
        false,
        'Its handler is made when the app runs, not written as a function here.',
        true,
      ],
    ]);
  });
});

describe('serverActionEntries', () => {
  it('lists a use-server file’s exported functions, and functions marked in their own body', () => {
    const file = programOf({
      '/actions.ts': [
        "'use server';",
        'export async function deletePoll(id: string) {}',
        'export const closePoll = async (id: string) => {};',
        'export const makeAdmin = authActionClient.metadata({ a: 1 }).action(async () => {});',
        'export const fromElsewhere = makeAction(handler);',
        'async function helper() {}',
        'export const LIMIT = 3;',
      ].join('\n'),
      '/page.tsx': [
        'export default function Page() {',
        '  async function rename(form: FormData) {',
        "    'use server';",
        '  }',
        '  return <form action={rename} />;',
        '}',
      ].join('\n'),
      '/late.ts': "import x from 'y';\n'use server';\nexport async function notOne() {}\n",
    });
    expect(serverActionEntries(file('/actions.ts')).map((e) => [e.name, e.at.line])).toEqual([
      ['server action deletePoll', 2],
      ['server action closePoll', 3],
      ['server action makeAdmin', 4],
      ['server action fromElsewhere', 5],
    ]);
    const [, , made, elsewhere] = serverActionEntries(file('/actions.ts'));
    expect(made?.handler).toBeDefined();
    expect(elsewhere?.why).toBe(
      'Its handler is made when the app runs, not written as a function here.',
    );
    expect(serverActionEntries(file('/page.tsx')).map((e) => e.name)).toEqual([
      'server action rename',
    ]);
    expect(serverActionEntries(file('/late.ts'))).toEqual([]);
  });
});
