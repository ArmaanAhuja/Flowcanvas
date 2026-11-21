import type { Meta, StoryObj } from '@storybook/react-vite';
import { GroupNode } from './GroupNode';

// A flow's groups (phase 12), named from the code: a folder, or a kind. Catalogue content.
const meta: Meta<typeof GroupNode> = {
  title: 'Canvas/GroupNode',
  component: GroupNode,
  args: { title: 'server-only/document', count: 18, expanded: false, kind: 'function' },
  decorators: [
    (Story) => (
      <div style={{ width: 216, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof GroupNode>;

export const Collapsed: Story = {};

export const Tables: Story = { args: { title: 'Tables', count: 5, kind: 'data' } };

export const Selected: Story = { args: { selected: true } };

/** Open: the frame its members are drawn over on the canvas (here at a fixed size, empty). */
export const Expanded: Story = {
  args: { expanded: true },
  decorators: [
    (Story) => (
      <div style={{ width: 480, height: 240 }}>
        <Story />
      </div>
    ),
  ],
};
