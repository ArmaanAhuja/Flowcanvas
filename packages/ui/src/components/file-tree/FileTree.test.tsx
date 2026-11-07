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

  it('reveals and selects the shown file, opening its folders', () => {
    render(
      <FileTree aria-label="Files" files={FILES} selected="src/lib/parse.ts" onOpen={vi.fn()} />,
    );
    expect(row('src').getAttribute('aria-expanded')).toBe('true');
    expect(row('lib').getAttribute('aria-expanded')).toBe('true');
    expect(row('parse.ts').getAttribute('aria-selected')).toBe('true');
    expect(row('db.ts').getAttribute('aria-selected')).toBe('false');
  });

  it('marks unsaved files in words, not only with a dot', () => {
    render(
      <FileTree
        aria-label="Files"
        files={FILES}
        selected="src/index.ts"
        unsaved={new Set(['src/index.ts'])}
        onOpen={vi.fn()}
      />,
    );
    expect(within(row('index.ts')).getByRole('img', { name: 'unsaved changes' })).toBeTruthy();
  });

  it('says so when there are no files', () => {
    render(<FileTree aria-label="Files" files={[]} onOpen={vi.fn()} />);
    expect(screen.getByText('No files yet.')).toBeTruthy();
  });
});
