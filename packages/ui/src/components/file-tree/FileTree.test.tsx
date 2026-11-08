import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree';

// jsdom has no layout: give the virtualizer a viewport, so it renders rows (React Aria's testing advice).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(248);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FILES = [
  'package.json',
  'src/index.ts',
  'src/lib/db.ts',
  'src/lib/parse.ts',
  'worker/process.ts',
];

const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}`) });

describe('FileTree', () => {
  it('shows the top level: folders first, closed', () => {
    render(<FileTree aria-label="Files" files={FILES} onOpen={vi.fn()} />);
    const tree = screen.getByRole('treegrid', { name: 'Files' });
    const rows = within(tree).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(['src', 'worker', 'package.json']);
    expect(row('src').getAttribute('aria-expanded')).toBe('false');
    expect(row('src').getAttribute('aria-level')).toBe('1');
  });

  it('opens a folder on click, and a file on click, without opening folders as files', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<FileTree aria-label="Files" files={FILES} onOpen={onOpen} />);
    await user.click(row('src'));
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    expect(row('lib').getAttribute('aria-level')).toBe('2');
    await user.click(row('index.ts'));
    expect(onOpen).toHaveBeenCalledWith('src/index.ts');
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.click(row('src'));
    expect(row('src').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps responding to clicks once a file is open and selected (regression)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<FileTree aria-label="Files" files={FILES} onOpen={onOpen} />);
    await user.click(row('src'));
    await user.click(row('index.ts'));
    rerender(<FileTree aria-label="Files" files={FILES} selected="src/index.ts" onOpen={onOpen} />);
    await user.click(row('worker'));
    expect(row('worker').getAttribute('aria-expanded')).toBe('true');
    await user.click(row('process.ts'));
    expect(onOpen).toHaveBeenLastCalledWith('worker/process.ts');
    await user.click(row('worker'));
    expect(row('worker').getAttribute('aria-expanded')).toBe('false');
  });

  it('works by keyboard: arrows move and open, Enter opens a file', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<FileTree aria-label="Files" files={FILES} onOpen={onOpen} />);
    await user.tab();
    expect(document.activeElement).toBe(row('src'));
    await user.keyboard('{ArrowRight}');
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(row('index.ts'));
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('src/index.ts');
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowLeft}');
    expect(row('src').getAttribute('aria-expanded')).toBe('false');
  });

  it('reveals the shown file, opening its folders, and says it is the open one', () => {
    render(
      <FileTree aria-label="Files" files={FILES} selected="src/lib/parse.ts" onOpen={vi.fn()} />,
    );
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    expect(row('lib').getAttribute('aria-expanded')).toBe('true');
    expect(
      screen
        .getByRole('row', { name: 'parse.ts, open in the editor' })
        .hasAttribute('data-current'),
    ).toBe(true);
    expect(screen.getByRole('row', { name: 'db.ts' }).hasAttribute('data-current')).toBe(false);
  });

  it('says unsaved changes in the row name, not only with a dot', () => {
    render(
      <FileTree
        aria-label="Files"
        files={FILES}
        selected="src/index.ts"
        unsaved={new Set(['src/index.ts', 'package.json'])}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('row', { name: 'index.ts, open in the editor, unsaved changes' }),
    ).toBeTruthy();
    expect(screen.getByRole('row', { name: 'package.json, unsaved changes' })).toBeTruthy();
  });

  it('updates a row when the open file or its unsaved changes change later (regression)', () => {
    const { rerender } = render(
      <FileTree aria-label="Files" files={FILES} selected="package.json" onOpen={vi.fn()} />,
    );
    expect(screen.getByRole('row', { name: 'package.json, open in the editor' })).toBeTruthy();
    rerender(
      <FileTree
        aria-label="Files"
        files={FILES}
        selected="package.json"
        unsaved={new Set(['package.json'])}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('row', { name: 'package.json, open in the editor, unsaved changes' }),
    ).toBeTruthy();
    rerender(
      <FileTree aria-label="Files" files={FILES} selected="src/index.ts" onOpen={vi.fn()} />,
    );
    expect(screen.getByRole('row', { name: 'package.json' }).hasAttribute('data-current')).toBe(
      false,
    );
  });

  it('moves with the arrow keys without opening anything on the way', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<FileTree aria-label="Files" files={FILES} selected="package.json" onOpen={onOpen} />);
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(onOpen).not.toHaveBeenCalled();
    expect(row('src').getAttribute('aria-expanded')).toBe('false');
  });

  it('says so when there are no files', () => {
    render(<FileTree aria-label="Files" files={[]} onOpen={vi.fn()} />);
    expect(screen.getByText('No files yet.')).toBeTruthy();
  });
});
