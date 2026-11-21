import { expect, test } from '@playwright/test';
import { accessibilityProblems } from '../accessibility.js';
import { openStory, storyIds, THEMES } from './storybook.js';

// Every catalogue story in both themes, checked with axe (WCAG 2.2 AA). No screenshots: they were dropped on
// 21 Nov 2026 (owner); the Figma screens aren't matched any more either.
for (const id of storyIds()) {
  for (const theme of THEMES) {
    test(`${id} · ${theme}`, async ({ page }) => {
      await openStory(page, id, theme);
      expect(await accessibilityProblems(page)).toEqual([]);
    });
  }
}
