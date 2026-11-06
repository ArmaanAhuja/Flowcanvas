import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_STATUS_LABELS,
  WorkspaceStatus,
  type WorkspaceStatusState,
} from './WorkspaceStatus';

afterEach(cleanup);

const tone = (state: WorkspaceStatusState) => {
  const { container } = render(<WorkspaceStatus state={state} />);
  const dot = container.querySelector('[data-tone]');
  const value = dot?.getAttribute('data-tone');
  cleanup();
  return { value, hidden: dot?.getAttribute('aria-hidden') };
};

describe('WorkspaceStatus', () => {
  it('says every state in words, so it never depends on the dot’s colour', () => {
    for (const [state, label] of Object.entries(WORKSPACE_STATUS_LABELS)) {
      render(<WorkspaceStatus state={state as WorkspaceStatusState} />);
      expect(screen.getByText(label)).toBeTruthy();
      cleanup();
    }
    expect(WORKSPACE_STATUS_LABELS.creating).toBe('Starting…');
    expect(WORKSPACE_STATUS_LABELS.failed).toBe('Couldn’t start');
  });

  it('adds a detail after the label', () => {
    render(<WorkspaceStatus state="running" detail="2 cores" />);
    expect(screen.getByText('Running · 2 cores')).toBeTruthy();
  });

  it('gives the dot a tone per state, hidden from screen readers (the words carry it)', () => {
    expect(tone('running')).toEqual({ value: 'healthy', hidden: 'true' });
    expect(tone('failed').value).toBe('failed');
    expect(tone('creating').value).toBe('changing');
    expect(tone('resuming').value).toBe('changing');
    for (const idle of ['not_created', 'sleeping', 'stopped'] as const) {
      expect(tone(idle).value).toBe('idle');
    }
  });

  it('passes through other attributes and marks its state', () => {
    render(<WorkspaceStatus state="sleeping" title="Workspace status" />);
    const chip = screen.getByTitle('Workspace status');
    expect(chip.dataset.state).toBe('sleeping');
  });
});
