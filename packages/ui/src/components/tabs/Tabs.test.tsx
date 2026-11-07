import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs, type TabItem } from './Tabs';

afterEach(cleanup);

const items: TabItem[] = [
  { id: 'details', label: 'Details' },
  { id: 'runs', label: 'Runs', count: 12 },
  { id: 'changes', label: 'Changes', count: 1 },
  { id: 'calls', label: 'Calls' },
];

function renderInspector(onValueChange = vi.fn()) {
  render(
    <Tabs
      aria-label="Inspector"
      items={items}
      onValueChange={onValueChange}
      renderPanel={(id) => <p>Panel for {id}</p>}
    />,
  );
  return onValueChange;
}

const tab = (name: RegExp) => screen.getByRole('tab', { name });

/** The focused element; fails the test with a clear message if nothing is focused. */
function focused(): Element {
  const element = document.activeElement;
  if (element === null) {
    throw new Error('expected an element to have focus');
  }
  return element;
}

describe('Tabs', () => {
  it('selects the first tab by default and shows its panel', () => {
    renderInspector();
    expect(screen.getByRole('tablist', { name: 'Inspector' })).toBeTruthy();
    expect(tab(/Details/).getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel', { name: 'Details' });
    expect(panel.textContent).toBe('Panel for details');
  });

  it('puts only the selected tab in the Tab order (roving tabindex)', () => {
    renderInspector();
    expect(tab(/Details/).tabIndex).toBe(0);
    expect(tab(/Runs/).tabIndex).toBe(-1);
  });

  it('selects a tab on click and reports it', () => {
    const onValueChange = renderInspector();
    fireEvent.click(tab(/Runs/));
    expect(tab(/Runs/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel for runs');
    expect(onValueChange).toHaveBeenCalledWith('runs');
  });

  it('moves focus and selection with the arrow keys, wrapping at the ends', () => {
    renderInspector();
    tab(/Details/).focus();

    fireEvent.keyDown(focused(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab(/Runs/));
    expect(tab(/Runs/).getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(focused(), { key: 'ArrowLeft' });
    fireEvent.keyDown(focused(), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab(/Calls/));
  });

  it('jumps to the first and last tab with Home and End', () => {
    renderInspector();
    tab(/Details/).focus();
    fireEvent.keyDown(focused(), { key: 'End' });
    expect(document.activeElement).toBe(tab(/Calls/));
    fireEvent.keyDown(focused(), { key: 'Home' });
    expect(document.activeElement).toBe(tab(/Details/));
  });

  it('makes the panel focusable so Tab can move into the content', () => {
    renderInspector();
    expect(screen.getByRole('tabpanel').tabIndex).toBe(0);
  });

  it('shows counts after the label', () => {
    renderInspector();
    expect(tab(/Runs/).textContent).toBe('Runs 12');
  });

  it('follows `value` when controlled', () => {
    const onValueChange = vi.fn();
    render(
      <Tabs aria-label="Review" items={items} value="changes" onValueChange={onValueChange} />,
    );
    expect(tab(/Changes/).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tab(/Calls/));
    expect(tab(/Changes/).getAttribute('aria-selected')).toBe('true');
    expect(onValueChange).toHaveBeenCalledWith('calls');
  });

  it('does not report a click on the tab that is already selected', () => {
    const onValueChange = renderInspector();
    fireEvent.click(tab(/Details/));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe('Tabs: counts', () => {
  it('names a tab with its count as words apart ("Runs 12"), in both variants', () => {
    for (const variant of ['underline', 'pill'] as const) {
      render(<Tabs aria-label={variant} variant={variant} items={items} />);
      expect(screen.getByRole('tab', { name: 'Runs 12' })).toBeTruthy();
      cleanup();
    }
  });
});
