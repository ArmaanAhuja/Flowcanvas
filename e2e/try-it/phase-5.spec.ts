import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, runningProject } from './fake-workspace.js';
import { clickWord, watchForPageProblems } from './support.js';

// Phase 5 · Try it: right-click a function → Callers. In a real browser under the production CSP: Rallly's
// createPoll in the Code view, the right-click menu, Callers in the inspector's Calls tab, a caller opened at its
// line, Callees in their groups (the project's, unresolved, built-in), and Shift+F12's references. The workspace is a
// fake answering as the engine does for Rallly at its pin (corpus/labels/calls.json); the engine itself is checked
// against those labels in real workspaces by the Docker corpus test (workspace/host/src/corpus.docker.test.ts).

const PROJECT = runningProject('3f1c0d2e-0000-4000-8000-0000000000c5', '2026-11-12T09:00:00.000Z');

const MUTATIONS_PATH = 'apps/web/src/features/poll/mutations.ts';
const PRIVATE_ROUTE = 'apps/web/src/app/api/private/[...route]/route.ts';
const V1_ROUTE = 'apps/web/src/app/api/v1/[...route]/route.ts';

/** A file with `lines` at their line numbers (1-based) and comments elsewhere. */
const fileWith = (length: number, lines: Record<number, string>) =>
  Array.from({ length }, (_, i) => lines[i + 1] ?? `// line ${String(i + 1)}`).join('\n') + '\n';

// createPoll at line 98, column 14, as in Rallly at its pin.
const MUTATIONS = fileWith(160, {
  98: 'export const createPoll = async ({ title }: { title: string }) => title;',
});
const ROUTE = fileWith(700, {
  404: '      const poll = await createPoll({',
  476: '    const poll = await createPoll({',
  612: '      const poll = await createPoll({',
  683: '    const poll = await createPoll({',
});

const place = (path: string, line: number, column: number) => ({ path, line, column });
const TARGET = {
  name: 'createPoll',
  kind: 'function',
  container: null,
  place: place(MUTATIONS_PATH, 98, 14),
  builtIn: false,
};
const entry = (
  name: string,
  provenance: 'resolved' | 'unresolved',
  declared: { path: string; line: number; column: number } | null,
  sites: { path: string; line: number; column: number }[],
  extra: { kind?: string | null; builtIn?: boolean } = {},
) => ({
  name,
  kind: extra.kind ?? (provenance === 'resolved' ? 'function' : null),
  container: null,
  place: declared,
  builtIn: extra.builtIn ?? false,
  relation: 'calls',
  provenance,
  sites,
});

// The engine's answers for createPoll in Rallly (the labels).
const CALLERS = {
  target: TARGET,
  entries: [
    entry(
      'route.ts (top level)',
      'resolved',
      place(PRIVATE_ROUTE, 1, 1),
      [place(PRIVATE_ROUTE, 404, 26), place(PRIVATE_ROUTE, 476, 24)],
      { kind: null },
    ),
    entry(
      'route.ts (top level)',
      'resolved',
      place(V1_ROUTE, 1, 1),
      [place(V1_ROUTE, 612, 26), place(V1_ROUTE, 683, 24)],
      { kind: null },
    ),
  ],
  complete: true,
  message: null,
};
const at = (line: number, column: number) => [place(MUTATIONS_PATH, line, column)];
const CALLEES = {
  target: TARGET,
  entries: [
    entry('some', 'resolved', null, at(113, 24), { kind: 'method', builtIn: true }),
    entry('prisma.$transaction', 'unresolved', null, at(115, 22)),
    entry(
      'assertOpenPollCapacity',
      'resolved',
      place('apps/web/src/features/poll/limit/mutations.ts', 57, 14),
      at(116, 11),
    ),
    entry('tx.poll.create', 'unresolved', null, at(118, 24)),
    entry('nanoid', 'resolved', place('packages/utils/src/nanoid.ts', 3, 14), at(120, 13)),
    entry(
      'recordPollActivities',
      'resolved',
      place('apps/web/src/features/activity/mutations.ts', 20, 23),
      at(139, 11),
    ),
    entry(
      'scheduleWebhookDispatch',
      'resolved',
      place('apps/web/src/features/webhook/mutations.ts', 479, 14),
      at(147, 5),
    ),
    entry('toPollResponse', 'resolved', place(MUTATIONS_PATH, 82, 14), at(152, 10)),
  ],
  complete: true,
  message: null,
};
const REFERENCES = {
  target: TARGET,
  references: [
    { ...place(MUTATIONS_PATH, 98, 14), isDefinition: true },
    { ...place(PRIVATE_ROUTE, 404, 26), isDefinition: false },
    { ...place(PRIVATE_ROUTE, 476, 24), isDefinition: false },
    { ...place(V1_ROUTE, 612, 26), isDefinition: false },
    { ...place(V1_ROUTE, 683, 24), isDefinition: false },
  ],
  complete: true,
  message: null,
};

/** A fake workspace answering the Calls tab as the engine does; `asked` keeps each question as `op path:line:column`. */
function fakeWorkspace(page: Page) {
  const asked: string[] = [];
  const question = (op: string, body: unknown) => (url: URL) => {
    const at = (name: string) => url.searchParams.get(name) ?? '';
    asked.push(`${op} ${at('path')}:${at('line')}:${at('column')}`);
    return body;
  };
  new FakeWorkspace(page, {
    project: PROJECT,
    files: { [MUTATIONS_PATH]: MUTATIONS, [PRIVATE_ROUTE]: ROUTE, [V1_ROUTE]: ROUTE },
    answers: {
      '/workspace/index/callers': question('callers', CALLERS),
      '/workspace/index/callees': question('callees', CALLEES),
      '/workspace/index/references': question('references', REFERENCES),
      '/workspace/index/definition': question('definition', {
        definitions: [TARGET],
        message: null,
      }),
      '/workspace/index/search': (url) => {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const symbols = 'createpoll'.startsWith(query)
          ? [
              {
                name: 'createPoll',
                kind: 'function',
                container: null,
                exported: true,
                path: MUTATIONS_PATH,
                line: 98,
                column: 14,
              },
            ]
          : [];
        return { symbols, ms: 1 };
      },
    },
  });
  return { asked };
}

const status = (page: Page) => page.getByRole('group', { name: 'Editor status' });

test('phase 5: right-click a function → Callers', async ({ page }) => {
  const watch = watchForPageProblems(page);
  const workspace = fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.getByText('Rallly', { exact: true })).toBeVisible();

  await test.step('⌘K to createPoll (phase 4): the Code view at line 98', async () => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('createPoll');
    await expect(page.getByRole('option', { name: /^createPoll, function/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(status(page)).toContainText('Ln 98, Col 14');
  });

  await test.step('Right-click createPoll: a menu at the pointer, the first item focused', async () => {
    await clickWord(page, 'export const createPoll', 'createPoll');
    const menu = page.getByRole('menu', { name: 'Code' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Go to definitionF12',
      'Find referencesShift+F12',
      'Callers',
      'Callees',
      'Show flow',
    ]);
    await expect(menu.getByRole('menuitem', { name: 'Go to definition' })).toBeFocused();
    // The cursor moved to where the pointer was.
    await expect(status(page)).toContainText('Ln 98');
  });

  await test.step('Callers: the inspector’s Calls tab, each caller with how it’s known', async () => {
    await page.getByRole('menuitem', { name: 'Callers' }).click();
    await expect(page.getByRole('menu', { name: 'Code' })).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Calls', selected: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Callers', selected: true })).toBeVisible();
    const calls = page.getByRole('region', { name: 'Calls' });
    await expect(calls.getByText('createPoll', { exact: true })).toBeVisible();
    await expect(
      calls.getByRole('button', {
        name: `route.ts (top level), calls, resolved, ${PRIVATE_ROUTE}:404`,
      }),
    ).toBeVisible();
    await expect(
      calls.getByRole('button', { name: `route.ts (top level), calls, resolved, ${V1_ROUTE}:612` }),
    ).toBeVisible();
    // The question was about the name under the pointer, 1-based.
    expect(workspace.asked[0]).toMatch(
      new RegExp(`^callers ${MUTATIONS_PATH.replaceAll('.', '\\.')}:98:\\d+$`),
    );
  });

  await test.step('A caller opens where it calls, in the Code view', async () => {
    await page
      .getByRole('button', { name: `route.ts (top level), calls, resolved, ${V1_ROUTE}:612` })
      .click();
    // The editor shows v1's route.ts (editor tabs are buttons; the editor is named by its file).
    await expect(page.getByRole('textbox', { name: `Code: ${V1_ROUTE}` })).toBeVisible();
    await expect(status(page)).toContainText('Ln 612, Col 26');
    // Its other call, from the row's places.
    await page.getByRole('button', { name: 'line 683' }).click();
    await expect(status(page)).toContainText('Ln 683, Col 24');
  });

  await test.step('Callees: the project’s, then unresolved (explained), then built-in (collapsed)', async () => {
    await page.getByRole('tab', { name: 'Callees' }).click();
    const calls = page.getByRole('region', { name: 'Calls' });
    await expect(
      calls.getByRole('button', {
        name: 'nanoid, calls, resolved, packages/utils/src/nanoid.ts:3',
      }),
    ).toBeVisible();
    const unresolved = calls.getByRole('region', { name: 'Unresolved (2)' });
    await expect(unresolved).toContainText('Nothing is guessed');
    await expect(
      unresolved.getByRole('button', {
        name: `prisma.$transaction, calls, unresolved, ${MUTATIONS_PATH}:115`,
      }),
    ).toBeVisible();
    const builtIn = calls.getByRole('button', { name: 'Built-in (1)' });
    await expect(builtIn).toHaveAttribute('aria-expanded', 'false');
    await builtIn.click();
    await expect(
      calls.getByRole('button', { name: /^some, calls, resolved, built-in/ }),
    ).toBeVisible();
    // Asked about the same place as Callers.
    expect(workspace.asked[1]?.replace(/^callees/, 'callers')).toBe(workspace.asked[0]);
  });

  await test.step('Shift+F12 on createPoll: its references, the definition marked', async () => {
    await page.getByRole('button', { name: 'mutations.ts', exact: true }).click();
    await expect(page.getByRole('textbox', { name: `Code: ${MUTATIONS_PATH}` })).toBeVisible();
    // The file keeps its cursor, on createPoll where the right-click put it.
    await expect(status(page)).toContainText('Ln 98');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Shift+F12');
    await expect(page.getByRole('tab', { name: 'References', selected: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `${MUTATIONS_PATH}:98, definition` }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: `${V1_ROUTE}:683` })).toBeVisible();
  });

  expect(watch.problems()).toEqual([]);
});
