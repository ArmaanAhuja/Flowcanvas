import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar';

afterEach(cleanup);

describe('StatusBar', () => {
  it('shows its items, then whatever goes on the right, as a named group that is not a live region', () => {
    render(
      <StatusBar
        aria-label="Editor status"
        items={['Ln 43, Col 17', 'UTF-8']}
        end={<button>Autosave</button>}
      />,
    );
    const bar = screen.getByRole('group', { name: 'Editor status' });
    expect(bar.textContent).toBe('Ln 43, Col 17UTF-8Autosave');
    expect(bar.getAttribute('aria-live')).toBeNull();
  });
});
