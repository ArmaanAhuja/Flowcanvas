import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette, type PaletteSymbol } from './CommandPalette';

afterEach(cleanup);

const FILES = [
  'apps/web/src/features/poll/mutations.ts',
  'apps/web/src/components/poll-form.tsx',
  'README.md',
];
const SYMBOLS: PaletteSymbol[] = [
  {
    path: 'apps/web/src/features/poll/mutations.ts',
    name: 'createPoll',
    kind: 'function',
    container: null,
    line: 98,
    column: 14,
    exported: true,
  },
  {
    path: 'apps/web/src/features/poll/components/create-poll.tsx',
    name: 'CreatePoll',
    kind: 'component',
    container: null,
    line: 115,
    column: 14,
    exported: true,
  },
  {
    path: 'apps/web/src/server/poll-service.ts',
    name: 'findPoll',
    kind: 'method',
    container: 'PollService',
    line: 12,
    column: 9,
    exported: false,
  },
];

/** The page's part: keeps the query, and answers symbol searches after `delayMs`, as the API would. */
function Harness(props: {
  readonly delayMs?: number;
  readonly note?: string;
  readonly onOpenFile?: (path: string) => void;
  readonly onOpenSymbol?: (symbol: PaletteSymbol) => void;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [symbols, setSymbols] = useState<PaletteSymbol[]>([]);
  useEffect(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = SYMBOLS.filter((s) => words.every((w) => s.name.toLowerCase().includes(w)));
    if (props.delayMs === undefined) {
      setSymbols(found);
      return;
    }
    const timer = setTimeout(() => {
      setSymbols(found);
    }, props.delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [query, props.delayMs]);
  return (
    <CommandPalette
      isOpen
      onOpenChange={props.onOpenChange ?? vi.fn()}
      query={query}
      onQueryChange={setQuery}
      symbols={symbols}
      symbolsNote={props.note}
      files={FILES}
      onOpenFile={props.onOpenFile ?? vi.fn()}
      onOpenSymbol={props.onOpenSymbol ?? vi.fn()}
    />
  );
}

const results = () => screen.getByRole('listbox', { name: 'Results' });
const groups = () =>
  within(results())
    .getAllByRole('group')
    .map((group) => ({
      name: group.querySelector('header')?.textContent,
      rows: within(group)
        .getAllByRole('option')
        .map((o) => o.getAttribute('aria-label') ?? o.textContent),
    }));

describe('CommandPalette', () => {
  it('is a dialog with the search field focused, and says what to type', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Search symbols and files' }),
    );
    expect(results().textContent).toBe('Type part of a function, component or file name.');
  });

  it('lists symbols first, then files, each symbol with its kind and place', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('poll');
    expect(groups()).toEqual([
      {
        name: 'Symbols',
        rows: [
          'createPoll, function, apps/web/src/features/poll/mutations.ts:98',
          'CreatePoll, component, apps/web/src/features/poll/components/create-poll.tsx:115',
          'findPoll, method, PollService · apps/web/src/server/poll-service.ts:12',
        ],
      },
      {
        name: 'Files',
        rows: [
          'poll-form.tsx, apps/web/src/components',
          'mutations.ts, apps/web/src/features/poll',
        ],
      },
    ]);
    // Screen readers hear the name, the kind and the place, not just the icon.
    expect(
      within(results()).getByRole('option', {
        name: 'findPoll, method, PollService · apps/web/src/server/poll-service.ts:12',
      }),
    ).toBeTruthy();
  });

  it('opens the top symbol with Enter, even when symbols arrive after the typing', async () => {
    const user = userEvent.setup();
    const onOpenSymbol = vi.fn();
    const onOpenFile = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Harness
        delayMs={30}
        onOpenSymbol={onOpenSymbol}
        onOpenFile={onOpenFile}
        onOpenChange={onOpenChange}
      />,
    );
    await user.keyboard('createpoll');
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    await user.keyboard('{Enter}');
    expect(onOpenSymbol).toHaveBeenCalledWith(SYMBOLS[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens the top symbol with Enter when files match at once and symbols arrive later (found by CI)', async () => {
    const user = userEvent.setup();
    const onOpenSymbol = vi.fn();
    const onOpenFile = vi.fn();
    render(<Harness delayMs={60} onOpenSymbol={onOpenSymbol} onOpenFile={onOpenFile} />);
    // "poll" matches files at once (ranked here) and symbols only after the "search" answers.
    await user.keyboard('poll');
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(within(results()).getAllByRole('option')[0]?.getAttribute('aria-label')).toBe(
      'createPoll, function, apps/web/src/features/poll/mutations.ts:98',
    );
    await user.keyboard('{Enter}');
    expect(onOpenSymbol).toHaveBeenCalledWith(SYMBOLS[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('marks the top result until the person moves, then opens what they moved to', async () => {
    const user = userEvent.setup();
    const onOpenSymbol = vi.fn();
    render(<Harness delayMs={700} onOpenSymbol={onOpenSymbol} />);
    await user.keyboard('poll');
    // Slower than React Aria's half-second highlight delay, as on a busy CI machine.
    await act(() => new Promise((resolve) => setTimeout(resolve, 800)));
    const options = within(results()).getAllByRole('option');
    expect(options[0]?.className).toMatch(/top/);
    // Only the first: the file that was on top before the symbols came no longer is.
    expect(options.slice(1).some((o) => o.className.includes('top'))).toBe(false);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(results()).getAllByRole('option')[0]?.className).not.toMatch(/top/);
    await user.keyboard('{Enter}');
    expect(onOpenSymbol).toHaveBeenCalledWith(SYMBOLS[1]);
  });

  it('opens a file chosen with the arrow keys', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<Harness onOpenFile={onOpenFile} />);
    await user.keyboard('poll-form');
    await user.keyboard('{Enter}');
    expect(onOpenFile).toHaveBeenCalledWith('apps/web/src/components/poll-form.tsx');
  });

  it('searches files only after #', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('#poll');
    expect(groups().map((g) => g.name)).toEqual(['Files']);
    await user.clear(screen.getByRole('searchbox'));
    await user.keyboard('#');
    expect(results().textContent).toBe('Type part of a file’s name.');
  });

  it('shows the index’s note under Symbols, with the results so far', async () => {
    const user = userEvent.setup();
    render(<Harness note="Indexing 400 of 1,958 files…" />);
    await user.keyboard('createpoll');
    expect(screen.getByRole('status').textContent).toBe('Indexing 400 of 1,958 files…');
    // createPoll and CreatePoll: the results so far stay listed under the note.
    expect(groups()[0]?.rows).toHaveLength(2);
  });

  it('says why nothing matched when the index can’t answer', async () => {
    const user = userEvent.setup();
    render(<Harness note="Symbols aren’t available: the project index stopped." />);
    await user.keyboard('zzz');
    expect(screen.getByRole('status').textContent).toBe(
      'Symbols aren’t available: the project index stopped.',
    );
  });

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('zzzz');
    expect(results().textContent).toBe('Nothing matches.');
  });

  it('closes with Escape, opening nothing and forgetting the query', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onOpenSymbol = vi.fn();
    render(<Harness onOpenChange={onOpenChange} onOpenSymbol={onOpenSymbol} />);
    await user.keyboard('poll{Escape}{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenSymbol).not.toHaveBeenCalled();
  });
});
