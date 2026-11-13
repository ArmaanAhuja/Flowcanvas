import { expect, test, type Page } from '@playwright/test';
import { FakeWorkspace, INDEX_READY, runningProject } from './fake-workspace.js';
import { watchForPageProblems } from './support.js';

// Phase 4 · Try it: press ⌘K and jump to any function in Rallly. In a real browser under the production CSP: the
// index's progress, ⌘K and the top bar's search, a function found by typing part of its name, Enter, and the Code
// view at that line. The workspace is a fake that answers like the engine; the real engine on Rallly and
// Documenso is proven by the Docker corpus test (workspace/host/src/corpus.docker.test.ts). The browser's half of
// "search under 100 ms" is measured here: keypress to results, with the API answering at once.

const PROJECT = runningProject('3f1c0d2e-0000-4000-8000-0000000000c4', '2026-11-11T09:00:00.000Z');

// createPoll at line 98, column 14, as in Rallly at its pin (corpus/labels/symbols.json).
const MUTATIONS = [
  ...Array.from({ length: 97 }, (_, i) => `// line ${String(i + 1)}`),
  'export const createPoll = async ({',
  '  title,',
  '}: { title: string }) => title;',
  '',
].join('\n');

const SYMBOLS = (
  [
    ['createPoll', 'function', 'apps/web/src/features/poll/mutations.ts', 98, 14],
    ['CreatePoll', 'component', 'apps/web/src/features/poll/components/create-poll.tsx', 115, 14],
    ['createMemoryStore', 'function', 'apps/web/src/app/api/middleware/rate-limit.ts', 119, 17],
    ['CalendarService', 'interface', 'apps/web/src/features/calendars/types.ts', 1, 18],
    ['RateLimitWindow', 'type', 'apps/web/src/app/api/middleware/rate-limit.ts', 23, 13],
  ] as [string, string, string, number, number][]
).map(([name, kind, path, line, column]) => ({
  name,
  kind,
  path,
  line,
  column,
  container: null,
  exported: true,
}));

/** A fake workspace whose index answers "indexing" twice, then "ready"; it keeps what was searched for. */
function fakeWorkspace(page: Page) {
  let indexingAnswers = 2;
  const searches: string[] = [];
  new FakeWorkspace(page, {
    project: PROJECT,
    files: { 'apps/web/src/features/poll/mutations.ts': MUTATIONS, 'README.md': '# Rallly\n' },
    indexStatus: () => {
      const indexing = indexingAnswers > 0;
      if (indexing) indexingAnswers -= 1;
      const done = indexing ? 980 : 1958;
      return {
        ...INDEX_READY,
        state: indexing ? 'indexing' : 'ready',
        done,
        files: done,
        byStatus: { ...INDEX_READY.byStatus, parsed: done },
        symbols: done * 3,
        lastFullMs: indexing ? null : 1015,
      };
    },
    answers: {
      '/workspace/index/search': (url) => {
        const query = url.searchParams.get('q') ?? '';
        searches.push(query);
        // Whole names only: then a row can appear only because of the keystroke that completes its name, which
        // is what the timing below measures. Ranking and partial matches are the engine's, tested on its own.
        const symbols = SYMBOLS.filter((s) => s.name.toLowerCase() === query.trim().toLowerCase());
        return { symbols, ms: 1 };
      },
    },
  });
  return { searches };
}

/**
 * Measures in the page, from the keydown of `key` to the first moment an option named `option` is in the
 * results: the browser's half of "search under 100 ms", without Playwright's own round trips.
 */
async function keyToResult(page: Page, key: string, option: string): Promise<number> {
  await page.evaluate((name) => {
    const w = window as unknown as { __pressed?: number | undefined; __shown?: number | undefined };
    w.__pressed = undefined;
    w.__shown = undefined;
    const selector = `[role="option"][aria-label="${CSS.escape(name)}"]`;
    // The row must not be there before the key: its appearance is the key's doing.
    if (document.querySelector(selector) !== null) throw new Error(`${name} is already shown`);
    window.addEventListener(
      'keydown',
      () => {
        w.__pressed = performance.now();
        const observer = new MutationObserver(() => {
          if (document.querySelector(selector) !== null) {
            w.__shown = performance.now();
            observer.disconnect();
          }
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      },
      { capture: true, once: true },
    );
  }, option);
  await page.keyboard.press(key);
  await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
  return page.evaluate(() => {
    const w = window as unknown as { __pressed?: number | undefined; __shown?: number | undefined };
    return (w.__shown ?? Number.NaN) - (w.__pressed ?? Number.NaN);
  });
}

test('phase 4: press ⌘K and jump to any function in Rallly', async ({ page }) => {
  const watch = watchForPageProblems(page);
  const { searches } = fakeWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${PROJECT.id}`);

  await test.step('While the project indexes, a chip says how far it has got; then it goes', async () => {
    const chip = page.getByTestId('index-chip').first();
    await expect(chip).toHaveText('Indexing 50%');
    await expect(chip).toHaveAttribute('title', 'Indexing 980 of 1,958 files…');
    await expect(page.getByTestId('index-chip')).toHaveCount(0, { timeout: 5000 });
  });

  await test.step('The top bar’s search opens the palette; # searches files only', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('#mutations');
    await expect(dialog.getByRole('group')).toHaveCount(1);
    await expect(
      dialog.getByRole('option', { name: 'mutations.ts, apps/web/src/features/poll', exact: true }),
    ).toBeVisible();
    // The first Escape clears the field, the second closes (React Aria's search field, as in quick-open).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  await test.step('⌘K, part of a function’s name: it’s the top result, within 100 ms of the keypress', async () => {
    const times: number[] = [];
    for (const [typed, last, name] of [
      ['createpol', 'l', 'createPoll, function, apps/web/src/features/poll/mutations.ts:98'],
      [
        'ratelimitwindo',
        'w',
        'RateLimitWindow, type, apps/web/src/app/api/middleware/rate-limit.ts:23',
      ],
      [
        'calendarservic',
        'e',
        'CalendarService, interface, apps/web/src/features/calendars/types.ts:1',
      ],
      [
        'creatememorystor',
        'e',
        'createMemoryStore, function, apps/web/src/app/api/middleware/rate-limit.ts:119',
      ],
      [
        'CreatePol',
        'l',
        'CreatePoll, component, apps/web/src/features/poll/components/create-poll.tsx:115',
      ],
    ] as const) {
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('searchbox', { name: 'Search symbols and files' })).toBeFocused();
      await page.keyboard.type(typed);
      times.push(await keyToResult(page, last, name));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
    }
    console.log(`phase 4: keypress to results, ms: ${times.map((t) => t.toFixed(1)).join(', ')}`);
    for (const time of times) expect(time).toBeLessThan(100);

    await page.keyboard.press('Control+k');
    await page.keyboard.type('createPoll');
    const results = page.getByRole('listbox', { name: 'Results' });
    await expect(results.getByRole('option').first()).toHaveAccessibleName(
      'createPoll, function, apps/web/src/features/poll/mutations.ts:98',
    );
  });

  await test.step('Enter opens the Code view at that line, with the cursor on the name', async () => {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Code', selected: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Editor status' })).toContainText('Ln 98, Col 14');
    // Scrolled to it: the line is on screen, and it's the cursor's line.
    const line = page.locator('.cm-activeLine');
    await expect(line).toContainText('export const createPoll = async ({');
    await expect(line).toBeInViewport();
    // The editor has focus: typing goes in at the name.
    await page.keyboard.type('x');
    await expect(line).toContainText('export const xcreatePoll');
  });

  expect(searches).toContain('createPoll');
  expect(watch.problems()).toEqual([]);
});
