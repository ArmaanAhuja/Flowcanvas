import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasToolbar, ToolbarButton, ToolbarDivider, ToolbarText } from './CanvasToolbar';

afterEach(cleanup);

describe('CanvasToolbar', () => {
  it('is a named toolbar of tools (pressed or not) and actions (no pressed state)', async () => {
    const onClick = vi.fn();
    render(
      <CanvasToolbar aria-label="Canvas">
        <ToolbarButton label="Select (V)" icon="s" active />
        <ToolbarButton label="Pan (H)" icon="h" active={false} />
        <ToolbarDivider />
        <ToolbarText>100%</ToolbarText>
        <ToolbarButton label="Fit (F)" icon="f" onClick={onClick} />
      </CanvasToolbar>,
    );
    expect(screen.getByRole('toolbar', { name: 'Canvas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Pan (H)' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Fit (F)' }).hasAttribute('aria-pressed')).toBe(
      false,
    );
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical');
    expect(screen.getByText('100%')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fit (F)' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
