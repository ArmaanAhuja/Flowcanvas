import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupNode } from './GroupNode';

afterEach(cleanup);

describe('GroupNode', () => {
  it('is a closed card named from the code, with its count; its header is the one control', () => {
    render(<GroupNode title="server-only/document" count={4} onToggle={vi.fn()} />);
    const header = screen.getByRole('button', { name: 'server-only/document, 4 nodes' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('opens and closes on a click, Enter or Space', () => {
    const onToggle = vi.fn();
    render(<GroupNode title="Tables" count={5} kind="data" onToggle={onToggle} />);
    const header = screen.getByRole('button');
    fireEvent.click(header);
    fireEvent.keyDown(header, { key: 'Enter' });
    fireEvent.keyDown(header, { key: ' ' });
    fireEvent.keyDown(header, { key: 'a' });
    expect(onToggle).toHaveBeenCalledTimes(3);
  });

  it('open, is a frame its members are drawn over: it says so, and lists none itself', () => {
    const { container } = render(
      <GroupNode title="Tables" count={2} expanded onToggle={vi.fn()} />,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect((container.firstElementChild as HTMLElement).dataset.expanded).toBe('true');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says one node in the singular', () => {
    render(<GroupNode title="Hand-offs" count={1} />);
    expect(screen.getByRole('button', { name: 'Hand-offs, 1 node' })).toBeTruthy();
  });
});
