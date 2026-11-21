import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceView, type SequenceStep } from './SequenceView';

afterEach(cleanup);

const step = (
  id: string,
  name: string,
  order: number,
  extra: Partial<SequenceStep> = {},
): SequenceStep => ({
  id,
  name,
  depth: 0,
  order,
  span: 1,
  ...extra,
});

describe('SequenceView', () => {
  it('without timings: says so, draws no time axis, and its legend has only order from code', () => {
    const { container } = render(
      <SequenceView
        title="send"
        subtitle="order from code; no timings yet"
        mainSteps={[step('a', 'send', 0, { span: 2 }), step('b', 'check', 1, { depth: 1 })]}
      />,
    );
    expect(screen.getByText('order from code; no timings yet')).toBeTruthy();
    expect(screen.queryByText(/ms$/)).toBeNull();
    const legend = screen.getByRole('contentinfo', { name: 'Legend' });
    expect(legend.textContent).toBe('order from code, no timing');
    // The root's bar covers its call's row too: half the axis from the start.
    const bars = container.querySelectorAll<HTMLElement>('[class*="bar"]');
    expect(Number.parseFloat(bars[0]?.style.inlineSize ?? '')).toBe(100);
    expect(Number.parseFloat(bars[1]?.style.insetInlineStart ?? '')).toBe(50);
  });

  it('says the branch a step is reached on, and marks a failure path in words, not by colour alone', () => {
    render(
      <SequenceView
        title="send"
        subtitle="x"
        mainSteps={[
          step('a', 'send', 0, { span: 3 }),
          step('b', 'recover', 1, { depth: 1, branch: 'error', failure: true }),
          step('c', '2 unknown calls', 2, { depth: 1, stub: true }),
        ]}
      />,
    );
    expect(screen.getByText('error')).toBeTruthy();
    expect(screen.getByText('failure path', { selector: 'span:not([class*="key"])' })).toBeTruthy();
    // An open end is a row, but not a step to select.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('selects a step on a click, Enter or Space', () => {
    const onSelectStep = vi.fn();
    render(
      <SequenceView
        title="send"
        subtitle="x"
        mainSteps={[step('a', 'send', 0)]}
        selectedId="a"
        onSelectStep={onSelectStep}
      />,
    );
    const row = screen.getByRole('button', { name: 'send' });
    expect(row.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelectStep).toHaveBeenCalledTimes(3);
  });

  it('puts each hand-off’s work in a Background group after the main steps', () => {
    render(
      <SequenceView
        title="send"
        subtitle="x"
        mainSteps={[step('a', 'send', 0)]}
        background={[
          { id: 'h', title: 'Background · email-queue', steps: [step('w', 'handle', 1)] },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Background · email-queue' }).textContent).toContain(
      'handle',
    );
  });

  it('with measured spans: a time axis, and each span’s duration', () => {
    render(
      <SequenceView
        title="send"
        subtitle="96 ms end to end"
        mainSteps={[
          step('a', 'send', 0, { start: 0, duration: 96 }),
          step('b', 'save', 1, { start: 10, duration: 40 }),
        ]}
      />,
    );
    expect(screen.getByText('96 ms', { selector: '[class*="tick"]' })).toBeTruthy();
    expect(screen.getByText('40 ms')).toBeTruthy();
    expect(screen.getByRole('contentinfo', { name: 'Legend' }).textContent).toBe('observed span');
  });
});
