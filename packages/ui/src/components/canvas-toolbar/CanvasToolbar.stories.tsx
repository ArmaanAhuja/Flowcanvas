import type { Meta, StoryObj } from '@storybook/react-vite';
import { Hand, Maximize, Minus, MousePointer2, Plus } from 'lucide-react';
import { CanvasToolbar, ToolbarButton, ToolbarDivider, ToolbarText } from './CanvasToolbar';

const meta = {
  title: 'Shell/CanvasToolbar',
  component: CanvasToolbar,
} satisfies Meta<typeof CanvasToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Select active; zoom at 100%. Comment and Add frame (Figma 06) join when they exist. */
export const Default: Story = {
  args: { 'aria-label': 'Canvas' },
  render: (args) => (
    <CanvasToolbar {...args}>
      <ToolbarButton label="Select (V)" icon={<MousePointer2 size={16} />} active />
      <ToolbarButton label="Pan (H)" icon={<Hand size={16} />} active={false} />
      <ToolbarDivider />
      <ToolbarButton label="Zoom out" icon={<Minus size={16} />} />
      <ToolbarText>100%</ToolbarText>
      <ToolbarButton label="Zoom in" icon={<Plus size={16} />} />
      <ToolbarButton label="Fit (F)" icon={<Maximize size={16} />} />
    </CanvasToolbar>
  ),
};
