// Named import: the package's type entry is CommonJS, so its default export doesn't type-check under nodenext.
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * WCAG 2.2 AA problems axe finds on the page as it is now, one line each (empty when there are none). Used by the
 * catalogue check and at the end of every walkthrough (owner, 21 Nov 2026: accessibility kept, screenshots gone).
 */
export async function accessibilityProblems(
  page: Page,
  options: { readonly electron?: boolean } = {},
): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Electron can't open the blank page axe merges its results in; legacy mode checks without one.
    .setLegacyMode(options.electron === true)
    .analyze();
  return results.violations
    .map((violation) => ({
      ...violation,
      // Known false positive (ADR 0008): a menu item's shortcut is its description, not part of its name.
      nodes: violation.nodes.filter(
        (node) =>
          !(
            violation.id === 'label-content-name-mismatch' && node.html.includes('role="menuitem"')
          ),
      ),
    }))
    .filter((violation) => violation.nodes.length > 0)
    .map(
      (violation) =>
        `accessibility: ${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
}
