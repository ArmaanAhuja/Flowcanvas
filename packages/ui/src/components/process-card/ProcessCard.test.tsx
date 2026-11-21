import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PROCESS_STATE_LABELS, ProcessCard } from './ProcessCard';

afterEach(cleanup);

describe('ProcessCard', () => {
  it('says its state in words, with the exit code when it failed', () => {
    for (const [state, label] of Object.entries(PROCESS_STATE_LABELS)) {
      render(<ProcessCard label="dev" command="pnpm run dev" state={state as 'running'} />);
      expect(screen.getByText(label)).toBeTruthy();
      cleanup();
    }
    render(<ProcessCard label="dev" command="pnpm run dev" state="failed" exitCode={2} />);
    expect(screen.getByText('Failed · exit code 2')).toBeTruthy();
  });

  it('links each port to the address it serves, shows the command and a reachable log', () => {
    render(
      <ProcessCard
        label="dev"
        command="pnpm run dev"
        state="running"
        ports={[3000]}
        log={'ready\n'}
      />,
    );
    expect(screen.getByRole('link', { name: 'localhost:3000' }).getAttribute('href')).toBe(
      'http://localhost:3000',
    );
    expect(screen.getByText('pnpm run dev')).toBeTruthy();
    const log = screen.getByLabelText('Output of dev');
    expect(log.textContent).toBe('ready\n');
    expect(log.tabIndex).toBe(0);
    expect(screen.getByRole('region', { name: 'dev' }).dataset.state).toBe('running');
  });

  it('says why it couldn’t start', () => {
    render(
      <ProcessCard
        label="dev"
        command="pnpm run dev"
        state="failed"
        problem="pnpm isn’t installed."
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('pnpm isn’t installed.');
  });
});
