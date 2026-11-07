import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorTabs, type EditorTab } from './EditorTabs';

// jsdom has no scrollIntoView (every browser does): record the calls instead.
let scrolled: Element[];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(cleanup);

const TABS: EditorTab[] = [
  { id: 'worker/process.ts', label: 'process.ts', title: 'worker/process.ts', unsaved: true },
  { id: 'middleware/rateLimit.ts', label: 'rateLimit.ts', title: 'middleware/rateLimit.ts' },
];

function renderTabs(active = 'worker/process.ts') {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <EditorTabs
      aria-label="Open files"
      tabs={TABS}
      active={active}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { onSelect, onClose };
}

describe('EditorTabs', () => {
  it('lists the open files, marking the shown one, with unsaved changes in the name', () => {
    renderTabs();
    expect(screen.getByRole('navigation', { name: 'Open files' })).toBeTruthy();
    const shown = screen.getByRole('button', { name: 'process.ts, unsaved changes' });
    expect(shown.getAttribute('aria-current')).toBe('true');
    expect(shown.getAttribute('title')).toBe('worker/process.ts');
    expect(
      screen.getByRole('button', { name: 'rateLimit.ts' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('shows a file on click, closes one with its button or a middle click', async () => {
    const user = userEvent.setup();
    const { onSelect, onClose } = renderTabs();
    await user.click(screen.getByRole('button', { name: 'rateLimit.ts' }));
    expect(onSelect).toHaveBeenCalledWith('middleware/rateLimit.ts');
    await user.click(screen.getByRole('button', { name: 'Close process.ts' }));
    expect(onClose).toHaveBeenCalledWith('worker/process.ts');
    const tab = screen.getByRole('button', { name: 'rateLimit.ts' }).closest('li');
    if (tab === null) throw new Error('no tab');
    fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenLastCalledWith('middleware/rateLimit.ts');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('reaches every tab and close button with the keyboard', async () => {
    const user = userEvent.setup();
    const { onClose } = renderTabs();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close process.ts' }));
    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledWith('worker/process.ts');
  });

  it('keeps the shown tab in view when another file is shown', () => {
    const { rerender } = render(
      <EditorTabs
        aria-label="Open files"
        tabs={TABS}
        active="worker/process.ts"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    rerender(
      <EditorTabs
        aria-label="Open files"
        tabs={TABS}
        active="middleware/rateLimit.ts"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(scrolled.at(-1)).toBe(screen.getByRole('button', { name: 'rateLimit.ts' }));
  });
});
