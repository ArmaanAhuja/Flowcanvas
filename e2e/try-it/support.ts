import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// The product version lives in the root package.json; the page must show exactly that.
export const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/** Short commit the build under test must show, when the run knows it (CI, or a preview check). */
export const expectedCommit = process.env.E2E_EXPECTED_COMMIT?.slice(0, 7);

/**
 * Collects uncaught page errors and Content-Security-Policy violations for the whole walkthrough.
 * Call it before the first navigation; assert that `problems()` is empty at the end.
 */
export function watchForPageProblems(page: Page): { problems: () => string[] } {
  const found: string[] = [];
  page.on('pageerror', (error) => found.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      found.push(`CSP: ${message.text()}`);
    }
  });
  return { problems: () => [...found] };
}

/**
 * Clicks `word` (a right-click unless told) on the editor's line containing `lineText`, with the real mouse at the
 * word's centre (phase 5).
 * CodeMirror draws a line as text nodes and highlighting spans that don't follow word boundaries, so the word is
 * found as a DOM range inside the editor's shadow root, not as an element.
 */
export async function clickWord(
  page: Page,
  lineText: string,
  word: string,
  button: 'left' | 'right' = 'right',
): Promise<void> {
  const box = await page.evaluate(
    ([text, target]) => {
      const root = document.querySelector('[data-region="editor"]')?.shadowRoot;
      const line = [...(root?.querySelectorAll('.cm-line') ?? [])].find((l) =>
        l.textContent.includes(text),
      );
      if (line === undefined) throw new Error(`No line with ${text}`);
      const start = line.textContent.indexOf(target);
      const range = document.createRange();
      let seen = 0;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (start >= seen && start < seen + length) range.setStart(node, start - seen);
        if (start + target.length > seen && start + target.length <= seen + length) {
          range.setEnd(node, start + target.length - seen);
          break;
        }
        seen += length;
      }
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    [lineText, word] as const,
  );
  await page.mouse.click(box.x, box.y, { button });
}
