import { expect, test } from '@playwright/test';
import { expectedCommit, version, watchForPageProblems } from './support.js';

// Phase 1 · Try it: open the staging link; the app loads and shows its version.
test('phase 1: the app loads and shows its version', async ({ page }) => {
  const watch = watchForPageProblems(page);

  await test.step('Open the preview link', async () => {
    await page.goto('/');
    await expect(page).toHaveTitle('Flowcanvas');
    await expect(page.getByRole('heading', { name: 'Flowcanvas' })).toBeVisible();
  });

  await test.step('The page shows the version and the commit it was built from', async () => {
    const buildLine = expectedCommit
      ? `${version} · ${expectedCommit}`
      : new RegExp(`^${version.replaceAll('.', '\\.')} · [0-9a-f]{7}$`);
    await expect(page.getByText(buildLine)).toBeVisible();
  });

  expect(await watch.problems()).toEqual([]);
});
