import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rail, RailButton } from './rail/Rail';
import { ReviewBar } from './review-bar/ReviewBar';
import { Tabs } from './tabs/Tabs';
import { TopBar } from './top-bar/TopBar';

afterEach(cleanup);

describe('TopBar', () => {
  it('lays out its three groups', () => {
    render(<TopBar start="acme-web" middle="views" end="status" data-testid="bar" />);
    expect(screen.getByTestId('bar').textContent).toBe('acme-webviewsstatus');
  });
});

describe('Rail', () => {
  it('names each tool for screen readers and says which one is open', async () => {
    const onClick = vi.fn();
    render(
      <Rail aria-label="Tools" footer={<RailButton label="Settings" icon="s" />}>
        <RailButton label="Canvas" icon="c" active />
        <RailButton label="Files" icon="f" onClick={onClick} />
      </Rail>,
    );
    expect(screen.getByRole('button', { name: 'Canvas' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Files' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });
});

describe('ReviewBar', () => {
  it('says why there is nothing to review, with no tabs', () => {
    render(<ReviewBar summary="No agent session yet." />);
    expect(screen.getByText('No agent session yet.')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows the tabs with their counts, and the actions', () => {
    render(
      <ReviewBar
        tabs={[{ id: 'changed', label: 'Changed', count: 3, countTone: 'modified' }]}
        actions={<button type="button">Accept</button>}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Changed 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
  });
});

describe('Tabs: disabled items (the view switch)', () => {
  const items = [
    { id: 'graph', label: 'Graph' },
    { id: 'sequence', label: 'Sequence', disabled: true, hint: 'Arrives in a later phase' },
    { id: 'code', label: 'Code' },
  ];

  it('shows a disabled item with its hint, and never selects it', async () => {
    const onValueChange = vi.fn();
    render(
      <Tabs aria-label="View" variant="segmented" items={items} onValueChange={onValueChange} />,
    );
    const sequence = screen.getByRole('tab', { name: 'Sequence' });
    expect((sequence as HTMLButtonElement).disabled).toBe(true);
    expect(sequence.getAttribute('title')).toBe('Arrives in a later phase');
    await userEvent.click(sequence);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('skips a disabled item with the arrow keys', async () => {
    const onValueChange = vi.fn();
    render(
      <Tabs aria-label="View" variant="segmented" items={items} onValueChange={onValueChange} />,
    );
    screen.getByRole('tab', { name: 'Graph' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('code');
    await userEvent.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('graph');
  });
});
