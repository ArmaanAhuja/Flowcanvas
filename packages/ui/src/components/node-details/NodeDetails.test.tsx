import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecisionNode } from '../decision-node/DecisionNode';
import { FlowStub } from '../flow-stub/FlowStub';
import { NodeDetails, completenessText, type NodeDetailsData } from './NodeDetails';

afterEach(cleanup);

const list = <T,>(items: T[], total = items.length) => ({ items, total });
const none = { items: [], total: 0 };
// Documenso's sendDocument, as the engine reads it (phase 7).
const details: NodeDetailsData = {
  signature: '({ id, userId, teamId }: SendDocumentOptions): Promise<Envelope>',
  params: list([{ name: '{ id, userId, teamId }', type: 'SendDocumentOptions', optional: false }]),
  returns: 'Promise<Envelope>',
  async: true,
  exported: true,
  decisions: list(
    [
      { kind: 'if', condition: '!envelope', outcomes: ['yes'], line: 106 },
      { kind: 'catch', condition: 'on error', outcomes: ['error'], line: 290 },
    ],
    21,
  ),
  throws: list([{ text: "new Error('Document not found')", line: 107 }]),
  awaits: list([{ text: 'prisma.envelope.findFirst', line: 69 }]),
  unresolved: list([{ text: 'prisma.envelope.findFirst', lines: [69] }]),
  writes: none,
};

describe('NodeDetails', () => {
  it('shows what the code reveals, each line opening its place, and says when a list is cut', () => {
    const onOpenLine = vi.fn();
    render(
      <NodeDetails
        details={details}
        path="packages/lib/send-document.ts"
        onOpenLine={onOpenLine}
      />,
    );
    expect(screen.getByText(details.signature ?? '')).toBeTruthy();
    expect(screen.getByText('exported · async')).toBeTruthy();
    const decisions = screen.getByRole('region', { name: 'Decisions' });
    expect(within(decisions).getByText('21')).toBeTruthy();
    expect(within(decisions).getByText('and 19 more, in the code')).toBeTruthy();
    expect(within(decisions).getByText('error')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open packages/lib/send-document.ts:107' }));
    expect(onOpenLine).toHaveBeenCalledWith(107);
    // Nothing written to module state: no empty group.
    expect(screen.queryByRole('region', { name: 'Writes to module state' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Unknown calls' })).toBeTruthy();
  });

  it('leaves out what a top level or a class doesn’t have', () => {
    render(
      <NodeDetails
        details={{ ...details, signature: null, returns: null, async: false, exported: false }}
        path="a.ts"
        onOpenLine={vi.fn()}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Returns' })).toBeNull();
    expect(screen.queryByText(/exported|async/)).toBeNull();
  });
});

describe('completenessText', () => {
  it('counts every edge, then each kind present, in the brief’s order', () => {
    expect(
      completenessText({ observed: 2, resolved: 11, convention: 4, suggested: 0, unknown: 1 }),
    ).toBe('18 edges · 11 resolved · 4 convention · 2 observed · 1 unknown');
    expect(
      completenessText({ observed: 0, resolved: 1, convention: 0, suggested: 0, unknown: 0 }),
    ).toBe('1 edge · 1 resolved');
  });
});

describe('DecisionNode and FlowStub', () => {
  it('cut a long condition on the canvas, keeping it whole for screen readers and on hover', () => {
    const long = `isTspEnvelope(envelope) && signingOrder === DocumentSigningOrder.PARALLEL && documentMeta`;
    render(<DecisionNode condition={long} />);
    const node = screen.getByLabelText(`Decision: ${long}`);
    expect(node.getAttribute('title')).toBe(long);
    expect(node.textContent).toBe(`${long.slice(0, 59)}…`);
  });

  it('say how many calls are unknown or not shown', () => {
    render(
      <>
        <FlowStub variant="unknown" count={1} />
        <FlowStub variant="unknown" count={63} />
        <FlowStub variant="more" count={32} />
      </>,
    );
    expect(screen.getByText('1 unknown call')).toBeTruthy();
    expect(screen.getByText('63 unknown calls')).toBeTruthy();
    expect(screen.getByText('32 more calls not shown')).toBeTruthy();
  });
});
