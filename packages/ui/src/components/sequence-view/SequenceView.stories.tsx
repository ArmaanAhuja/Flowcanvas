import type { Meta, StoryObj } from '@storybook/react-vite';
import { SequenceView, type SequenceStep } from './SequenceView';

// The sequence view (phase 13; Figma 08). Catalogue content: a flow from the code, and (as phase 29 will show) the same
// flow with measured spans.
const meta: Meta<typeof SequenceView> = {
  title: 'Components/SequenceView',
  component: SequenceView,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof SequenceView>;

const s = (
  id: string,
  name: string,
  depth: number,
  order: number,
  span: number,
  extra: Partial<SequenceStep> = {},
): SequenceStep => ({ id, name, depth, order, span, location: `src/${name}.ts:10`, ...extra });

export const FromCode: Story = {
  args: {
    title: 'Save item',
    subtitle: 'order from code; no timings yet',
    mainSteps: [
      s('1', 'onSubmit', 0, 0, 8),
      s('2', 'rateLimit', 1, 1, 1, { change: 'added' }),
      s('3', 'validateItem', 1, 2, 2),
      s('4', 'reject', 2, 3, 1, { branch: 'no' }),
      s('5', 'POST /api/items', 1, 4, 3),
      s('6', 'db.items.insert', 2, 5, 1),
      s('7', '1 unknown call', 2, 6, 1, { stub: true, location: undefined }),
      s('8', 'showError', 1, 7, 1, { branch: 'error', failure: true }),
    ],
    background: [
      {
        id: 'process-items',
        title: 'Background · process-items',
        steps: [
          s('9', 'processItem', 0, 8, 3),
          s('10', 'llm.complete', 1, 9, 1, { change: 'modified' }),
          s('11', 'notify', 1, 10, 1),
        ],
      },
    ],
    selectedId: '10',
  },
};

export const Observed: Story = {
  args: {
    title: 'Save item',
    subtitle: '1.92 s end to end · run 12 · 2 min ago',
    mainSteps: [
      s('1', 'onSubmit', 0, 0, 1, { start: 0, duration: 4 }),
      s('2', 'rateLimit', 0, 1, 1, { start: 4, duration: 2, change: 'added' }),
      s('3', 'validateItem', 0, 2, 1, { start: 6, duration: 8 }),
      s('4', 'POST /api/items', 0, 3, 2, { start: 14, duration: 96 }),
      s('5', 'db.items.insert', 1, 4, 1, { start: 40, duration: 38 }),
    ],
    background: [
      {
        id: 'process-items',
        title: 'Background · process-items · starts 2 ms after the response',
        steps: [
          s('6', 'processItem', 0, 5, 3, { start: 130, duration: 1700 }),
          s('7', 'llm.complete', 1, 6, 1, { start: 160, duration: 1520, change: 'modified' }),
          s('8', 'notify', 1, 7, 1, { start: 1770, duration: 140 }),
        ],
      },
    ],
    selectedId: '7',
  },
};
