import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];

export const REPO_ROOT = new URL('../../', import.meta.url);

interface IndexEntry {
  readonly id: string;
  readonly type: 'story' | 'docs';
}

/** Every story in the built catalogue, read from Storybook's index (so new stories are covered automatically). */
export function storyIds(): string[] {
  const file = new URL('packages/ui/storybook-static/index.json', REPO_ROOT);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error('Storybook is not built. Run `pnpm test:visual`, which builds it first.');
  }
  const index = JSON.parse(text) as { entries: Record<string, IndexEntry> };
  return Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    .map((entry) => entry.id);
}

/** Opens one story in the given theme and waits until it is rendered, themed and its fonts are loaded. */
export async function openStory(page: Page, id: string, theme: Theme): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
  await page.waitForFunction(
    (expected) =>
      document.documentElement.dataset.theme === expected &&
      (document.querySelector('#storybook-root')?.childElementCount ?? 0) > 0,
    theme,
  );
  // Everything the story fetches (lazy chunks, fonts) in, then the fonts applied and two frames drawn: axe reads text
  // as laid out, and `fonts.ready` alone can resolve before a font is even requested.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(undefined);
          });
        });
      }),
  );
  // Let finite animations (popover fade-in) finish; infinite ones (the analysing shimmer) keep running.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
}
