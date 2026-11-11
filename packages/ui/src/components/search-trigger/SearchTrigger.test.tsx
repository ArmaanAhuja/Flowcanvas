import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchTrigger } from './SearchTrigger';

afterEach(cleanup);

describe('SearchTrigger', () => {
  it('is a button named Search that announces its shortcut', () => {
    render(<SearchTrigger onPress={vi.fn()} shortcutLabel="⌘K" keyShortcuts="Meta+K" />);
    const button = screen.getByRole('button', { name: 'Search' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
    expect(button.textContent).toBe('Search⌘K');
  });

  it('opens the palette by click, Enter or Space', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<SearchTrigger onPress={onPress} shortcutLabel="Ctrl K" keyShortcuts="Control+K" />);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(3);
  });
});
