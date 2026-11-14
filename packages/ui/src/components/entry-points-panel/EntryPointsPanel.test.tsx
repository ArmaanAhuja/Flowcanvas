import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryPointsPanel, type EntryGroup } from './EntryPointsPanel';

// jsdom has no layout: give the virtualizer a viewport, so it renders rows (React Aria's testing advice).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(248);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GROUPS: readonly EntryGroup[] = [
  {
    id: 'screens',
    count: 2,
    rows: [
      {
        id: 's1',
        kind: 'screen',
        label: '/polls/:urlId',
        suffix: 'PollPage',
        complete: true,
        childCount: 3,
      },
      { id: 's2', kind: 'screen', label: '/settings', suffix: 'Settings', complete: true },
    ],
  },
  {
    id: 'api',
    count: 203,
    rows: [
      { id: 'a1', kind: 'api-route', label: 'POST /api/private/polls', complete: true },
      {
        id: 'a2',
        kind: 'api-route',
        label: 'GET /:unknown/auth/:id',
        complete: false,
        why: 'Part of its path isn’t a constant the code fixes.',
      },
    ],
    more: 201,
  },
  { id: 'jobs', count: 0, rows: [], arrivesIn: 11 },
  { id: 'events', count: 0, rows: [], arrivesIn: 11 },
  {
    id: 'cli',
    count: 1,
    rows: [{ id: 'c1', kind: 'cli-command', label: '@rallly/web: dev', complete: true }],
  },
];

const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}`) });

function renderPanel(overrides: Partial<Parameters<typeof EntryPointsPanel>[0]> = {}) {
  const props = {
    groups: GROUPS,
    filter: '',
    onFilterChange: vi.fn(),
    onShowFlow: vi.fn(),
    onShowMore: vi.fn(),
    onExpand: vi.fn(),
    ...overrides,
  };
  render(<EntryPointsPanel {...props} />);
  return props;
}

describe('EntryPointsPanel', () => {
  it('lists the design brief’s groups with their counts, open, and the total', () => {
    renderPanel();
    const panel = screen.getByRole('region', { name: 'Entry points' });
    expect(
      within(panel).getByRole('heading', { name: 'Entry points' }).nextSibling?.textContent,
    ).toBe('206');
    expect(row('Screens and elements').textContent).toContain('2');
    expect(row('API routes').getAttribute('aria-expanded')).toBe('true');
    expect(row('/polls/:urlId').textContent).toContain('PollPage');
    // Later kinds say which phase brings them.
    expect(screen.getAllByRole('row', { name: 'Arrives in phase 11.' })).toHaveLength(2);
  });

  it('marks what isn’t fully detected with its reason, never by colour alone', () => {
    renderPanel();
    expect(
      within(row('GET /:unknown/auth/:id')).getByRole('img', {
        name: 'Not fully detected: Part of its path isn’t a constant the code fixes.',
      }),
    ).toBeDefined();
    expect(within(row('POST /api/private/polls')).queryByRole('img')).toBeNull();
  });

  it('shows a flow from Show flow, or Enter on a row', async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(
      within(row('POST /api/private/polls')).getByRole('button', {
        name: 'Show the flow from POST /api/private/polls',
      }),
    );
    expect(props.onShowFlow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a1' }));
    row('@rallly/web: dev').focus();
    await user.keyboard('{Enter}');
    expect(props.onShowFlow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('asks for a screen’s elements when it’s opened, and a group’s next rows', async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    expect(row('/polls/:urlId').getAttribute('aria-expanded')).toBe('false');
    // Arrow right opens a row, as the WAI-ARIA tree pattern says (the chevron is for the pointer).
    row('/polls/:urlId').focus();
    await user.keyboard('{ArrowRight}');
    expect(row('/polls/:urlId').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('row', { name: 'Loading elements…' })).toBeDefined();
    expect(props.onExpand).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    row('Show 201 more').focus();
    await user.keyboard('{Enter}');
    expect(props.onShowMore).toHaveBeenCalledWith('api');
  });

  it('says nothing of an empty group before the entry points are listed, but still when a kind comes later', () => {
    renderPanel({ groups: GROUPS.map((g) => ({ ...g, rows: [] })), listed: false });
    expect(screen.queryByRole('row', { name: 'None found in this project.' })).toBeNull();
    // Nor a count it doesn't know yet.
    expect(row('API routes').textContent).toBe('API routes');
    expect(screen.getAllByRole('row', { name: 'Arrives in phase 11.' })).toHaveLength(2);
  });

  it('filters through the page, and says when nothing matches', async () => {
    const user = userEvent.setup();
    const props = renderPanel({
      filter: 'zzz',
      groups: GROUPS.map((g) => (g.id === 'cli' ? { ...g, rows: [] } : g)),
    });
    await user.type(screen.getByRole('textbox', { name: 'Filter entry points' }), 'x');
    expect(props.onFilterChange).toHaveBeenCalledWith('zzzx');
    expect(screen.getByRole('row', { name: 'None match the filter.' })).toBeDefined();
  });
});
