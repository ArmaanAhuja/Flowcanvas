import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallsPanel, type CallRow, type CallsPanelProps } from './CallsPanel';

afterEach(cleanup);

const place = (path: string, line: number) => ({ path, line, column: 3 });
const row = (name: string, extra: Partial<CallRow> = {}): CallRow => ({
  id: name,
  name,
  kindLabel: 'Function',
  container: null,
  relation: 'calls',
  provenance: 'resolved',
  builtIn: false,
  place: place(`src/${name}.ts`, 1),
  sites: [place('src/page.tsx', 7)],
  ...extra,
});

function renderPanel(props: Partial<CallsPanelProps> = {}) {
  const onOpen = vi.fn();
  const onViewChange = vi.fn();
  render(
    <CallsPanel
      view="callers"
      onViewChange={onViewChange}
      target={{ name: 'createPoll', kindLabel: 'Function', place: place('src/poll.ts', 98) }}
      status="ready"
      rows={[]}
      references={[]}
      onOpen={onOpen}
      {...props}
    />,
  );
  return { onOpen, onViewChange };
}

describe('CallsPanel', () => {
  it('says what to do before anything is asked', () => {
    renderPanel({ target: null, status: 'idle' });
    expect(screen.getByText(/Right-click a function in the Code view/)).toBeTruthy();
  });

  it('shows the function and its place, and switches between the three views', async () => {
    const user = userEvent.setup();
    const { onOpen, onViewChange } = renderPanel();
    expect(screen.getByText('createPoll')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'src/poll.ts:98' }));
    expect(onOpen).toHaveBeenCalledWith(place('src/poll.ts', 98));
    await user.click(screen.getByRole('tab', { name: 'Callees' }));
    expect(onViewChange).toHaveBeenCalledWith('callees');
  });

  it('opens the flow from the function looked at, when the page offers it (phase 7)', async () => {
    const user = userEvent.setup();
    const onShowFlow = vi.fn();
    renderPanel({ onShowFlow });
    await user.click(screen.getByRole('button', { name: 'Show flow' }));
    expect(onShowFlow).toHaveBeenCalledWith(place('src/poll.ts', 98));
    cleanup();
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Show flow' })).toBeNull();
  });

  it('lists callers with how each is known, and opens where the call is', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderPanel({
      rows: [
        row('Page', {
          kindLabel: 'Component',
          relation: 'renders',
          sites: [place('src/page.tsx', 7), place('src/page.tsx', 12)],
        }),
      ],
    });
    const caller = screen.getByRole('button', {
      name: 'Page, renders, resolved, src/page.tsx:7',
    });
    await user.click(caller);
    expect(onOpen).toHaveBeenCalledWith(place('src/page.tsx', 7));
    await user.click(screen.getByRole('button', { name: 'line 12' }));
    expect(onOpen).toHaveBeenLastCalledWith(place('src/page.tsx', 12));
  });

  it('groups callees: the project’s, unresolved (explained), built-in (collapsed)', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderPanel({
      view: 'callees',
      rows: [
        row('toPollResponse', { place: place('src/poll.ts', 20) }),
        row('prisma.poll.create', {
          provenance: 'unresolved',
          kindLabel: null,
          place: null,
          sites: [place('src/poll.ts', 101)],
        }),
        row('max', { builtIn: true, place: null, sites: [place('src/poll.ts', 103)] }),
      ],
    });
    // A callee opens where it's declared.
    await user.click(
      screen.getByRole('button', { name: 'toPollResponse, calls, resolved, src/poll.ts:20' }),
    );
    expect(onOpen).toHaveBeenCalledWith(place('src/poll.ts', 20));
    const unresolved = screen.getByRole('region', { name: 'Unresolved (1)' });
    expect(within(unresolved).getByText(/Nothing is guessed/)).toBeTruthy();
    // An unresolved call has no declaration to open: its site opens instead.
    await user.click(
      within(unresolved).getByRole('button', {
        name: 'prisma.poll.create, calls, unresolved, src/poll.ts:101',
      }),
    );
    expect(onOpen).toHaveBeenLastCalledWith(place('src/poll.ts', 101));
    // Built-ins are collapsed until asked for.
    const toggle = screen.getByRole('button', { name: 'Built-in (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /^max, calls, resolved, built-in/ })).toBeTruthy();
  });

  it('lists references, the definition marked', () => {
    renderPanel({
      view: 'references',
      references: [
        { ...place('src/poll.ts', 98), isDefinition: true },
        { ...place('src/route.ts', 12), isDefinition: false },
      ],
    });
    expect(screen.getByRole('button', { name: 'src/poll.ts:98, definition' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'src/route.ts:12' })).toBeTruthy();
  });

  it('says it is working, says what an answer lacks, and says when there is nothing', () => {
    renderPanel({ status: 'loading' });
    expect(screen.getByRole('status').textContent).toBe('Finding calls…');
    cleanup();
    renderPanel({ message: 'Part of this project is too large to look at here.' });
    expect(screen.getByRole('status').textContent).toMatch(/too large/);
    expect(screen.getByText('No callers in the project.')).toBeTruthy();
  });

  it('draws provenance by form, with the word for screen readers', () => {
    renderPanel({
      view: 'callees',
      rows: [row('a'), row('b()', { provenance: 'unresolved', place: null })],
    });
    const glyphs = document.querySelectorAll('svg');
    // Resolved: one line. Unresolved: a stub and a hollow circle.
    expect([...glyphs].map((g) => g.querySelectorAll('circle').length)).toEqual([0, 1]);
  });
});
