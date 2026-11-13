import type { Meta, StoryObj } from '@storybook/react-vite';
import { DecisionNode } from './DecisionNode';

// Catalogue example content: conditions from Documenso's sendDocument (phase 7).
const meta = {
  title: 'Components/Decision node',
  component: DecisionNode,
  args: { condition: 'signingOrder === DocumentSigningOrder.SEQUENTIAL' },
} satisfies Meta<typeof DecisionNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Condition: Story = {};
export const Long: Story = {
  args: {
    condition:
      'isTspEnvelope(envelope) && signingOrder === DocumentSigningOrder.PARALLEL && envelope.documentMeta',
  },
};
export const Catch: Story = { args: { condition: 'on error' } };
export const Selected: Story = { args: { selected: true } };
