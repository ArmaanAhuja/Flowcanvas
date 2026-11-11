import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuItem } from '../menu/Menu';
import { ContextMenu } from './ContextMenu';

afterEach(cleanup);

function Harness({ onAction }: { readonly onAction: (key: unknown) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button">editor</button>
      <ContextMenu
        isOpen={open}
        onOpenChange={setOpen}
        at={{ x: 120, y: 80 }}
        aria-label="Code"
        onAction={onAction}
      >
        <MenuItem id="definition" shortcut="F12">
          Go to definition
        </MenuItem>
        <MenuItem id="callers">Callers</MenuItem>
      </ContextMenu>
    </>
  );
}

describe('ContextMenu', () => {
  it('opens as a menu, first item focused, items with their shortcuts', () => {
    render(<Harness onAction={vi.fn()} />);
    const menu = screen.getByRole('menu', { name: 'Code' });
    expect(menu).toBeTruthy();
    expect(document.activeElement?.textContent).toContain('Go to definition');
    expect(screen.getByRole('menuitem', { name: 'Go to definition' }).textContent).toContain('F12');
  });

  it('runs an item with the keyboard and closes', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onAction).toHaveBeenCalledWith('callers');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes with Escape, running nothing', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Harness onAction={onAction} />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('is placed at the pointer, through the CSSOM', () => {
    render(<Harness onAction={vi.fn()} />);
    const anchor = document.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(anchor?.style.left).toBe('120px');
    expect(anchor?.style.top).toBe('80px');
    expect(anchor?.getAttribute('style')).not.toBeNull();
  });
});
