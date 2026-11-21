import { expect, test } from '@playwright/test';
import { watchForPageProblems } from './support.js';

// Phase 1a · Try it: open the component catalogue, flip dark and light, compare with Figma.
// The app side of it: the theme menu and the link to the catalogue (which lives on its own origin).
test('phase 1a: switch theme and open the component catalogue', async ({ page }) => {
  const watch = watchForPageProblems(page);

  await test.step('Open the preview link', async () => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Theme: / })).toBeVisible();
  });

  await test.step('Choose Theme → Light', async () => {
    await page.getByRole('button', { name: /^Theme: / }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
  });

  await test.step('Reload: the choice is remembered', async () => {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  await test.step('Choose Theme → Dark', async () => {
    await page.getByRole('button', { name: 'Theme: Light' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  await test.step('The catalogue link points to the component catalogue', async () => {
    await expect(page.getByRole('link', { name: 'Open the component catalogue' })).toHaveAttribute(
      'href',
      /^https:\/\/flowcanvas-catalogue\./,
    );
  });

  expect(await watch.problems()).toEqual([]);
});
