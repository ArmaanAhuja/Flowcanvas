import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatWorkspaceTime, Usage } from './Usage';

afterEach(cleanup);

const answer = (workspaceSeconds: number) =>
  vi.fn<typeof fetch>(() =>
    Promise.resolve(
      Response.json({
        usage: {
          periodStart: '2026-10-01T00:00:00.000Z',
          resetsAt: '2026-11-01T00:00:00.000Z',
          workspaceSeconds,
          storageByteHours: 0,
        },
      }),
    ),
  );

describe('formatWorkspaceTime', () => {
  it('rounds down to the minute and adds hours from 60 minutes', () => {
    expect(formatWorkspaceTime(0)).toBe('0 min');
    expect(formatWorkspaceTime(59)).toBe('0 min');
    expect(formatWorkspaceTime(3599)).toBe('59 min');
    expect(formatWorkspaceTime(7500)).toBe('2 h 5 min');
  });
});

describe('Usage', () => {
  it('shows the measured workspace time and when it resets', async () => {
    const fetcher = answer(7500);
    render(<Usage fetcher={fetcher} />);
    expect(await screen.findByText(/Workspace time: 2 h 5 min\./)).toBeTruthy();
    expect(screen.getByText(/Resets .*2026/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith('/api/usage', expect.anything());
  });

  it('shows a real 0 before any workspace has run', async () => {
    render(<Usage fetcher={answer(0)} />);
    expect(await screen.findByText(/Workspace time: 0 min\./)).toBeTruthy();
  });

  it('says when usage can’t be loaded', async () => {
    render(
      <Usage
        fetcher={() =>
          Promise.resolve(
            Response.json(
              { error: 'Could not load your usage. Try again in a moment.' },
              { status: 503 },
            ),
          )
        }
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not load your usage. Try again in a moment.',
    );
  });
});
