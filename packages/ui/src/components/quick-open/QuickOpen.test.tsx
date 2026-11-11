import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickOpen } from './QuickOpen';

afterEach(cleanup);

const FILES = [
  'apps/web/src/utils/greeting.ts',
  'apps/web/src/components/poll-form.tsx',
  'README.md',
];

function renderOpen(onOpen = vi.fn(), onOpenChange = vi.fn(), files = FILES) {
  render(<QuickOpen isOpen onOpenChange={onOpenChange} files={files} onOpen={onOpen} />);
  return { onOpen, onOpenChange };
}

describe('QuickOpen', () => {
  it('is a dialog with the search field focused, listing files', () => {
    renderOpen();
    expect(screen.getByRole('dialog', { name: 'Open a file' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'File name' }));
    expect(
      within(screen.getByRole('listbox', { name: 'Files' })).getAllByRole('option'),
    ).toHaveLength(3);
  });

  it('narrows as you type, and Enter opens the first match', async () => {
    const user = userEvent.setup();
    const { onOpen, onOpenChange } = renderOpen();
    await user.keyboard('greet');
    const options = within(screen.getByRole('listbox', { name: 'Files' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['greeting.tsapps/web/src/utils']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onOpen).toHaveBeenCalledWith('apps/web/src/utils/greeting.ts');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes with Escape without opening anything', async () => {
    const user = userEvent.setup();
    const { onOpen, onOpenChange } = renderOpen();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('says when nothing matches, or there are no files', async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.keyboard('zzzz');
    expect(screen.getByText('No file matches.')).toBeTruthy();
    cleanup();
    renderOpen(vi.fn(), vi.fn(), []);
    expect(screen.getByText('No files yet.')).toBeTruthy();
  });
});

describe('QuickOpen rows', () => {
  it('are named by file and folder, with a pause between them', () => {
    renderOpen();
    expect(
      screen.getByRole('option', { name: 'poll-form.tsx, apps/web/src/components' }),
    ).toBeTruthy();
    expect(screen.getByRole('option', { name: 'README.md' })).toBeTruthy();
  });
});
