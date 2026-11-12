import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../button/Button';
import { ReviewBar } from './ReviewBar';

const meta = {
  title: 'Shell/ReviewBar',
  component: ReviewBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ReviewBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before any agent session: nothing to review, and it says so. */
export const Empty: Story = {
  args: { summary: 'Agent sessions arrive with the agent panel (phase 19).' },
};

/** After a session, as on Figma 06 (catalogue example content). */
export const AfterSession: Story = {
  args: {
    tabs: [
      { id: 'changed', label: 'Changed', count: 3, countTone: 'modified' },
      { id: 'affected', label: 'Affected', count: 2, countTone: 'affected' },
      { id: 'tests', label: 'Tests', count: '3/4', countTone: 'modified' },
      { id: 'observed', label: 'Observed', count: 5 },
      { id: 'unverified', label: 'Unverified', count: 1 },
    ],
    summary: 'Session · 4 steps · 2 min ago',
    actions: (
      <>
        <Button kind="ghost">Revert step</Button>
        <Button>Compare</Button>
        <Button kind="primary">Accept</Button>
      </>
    ),
  },
};
