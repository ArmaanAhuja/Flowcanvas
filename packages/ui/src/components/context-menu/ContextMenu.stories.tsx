import type { Meta, StoryObj } from '@storybook/react-vite';
import { MenuItem } from '../menu/Menu';
import { ContextMenu } from './ContextMenu';

const meta = {
  title: 'Editor/ContextMenu',
  component: ContextMenu,
  parameters: { layout: 'fullscreen' },
  args: {
    isOpen: true,
    onOpenChange: () => undefined,
    onAction: () => undefined,
    at: { x: 160, y: 120 },
    'aria-label': 'Code',
    children: null,
  },
  render: (args) => (
    <div style={{ height: 400 }}>
      <ContextMenu {...args}>
        <MenuItem id="definition" shortcut="F12">
          Go to definition
        </MenuItem>
        <MenuItem id="references" shortcut="Shift F12">
          Find references
        </MenuItem>
        <MenuItem id="callers">Callers</MenuItem>
        <MenuItem id="callees">Callees</MenuItem>
      </ContextMenu>
    </div>
  ),
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Right-click in the Code view (phase 5). */
export const Open: Story = {};
