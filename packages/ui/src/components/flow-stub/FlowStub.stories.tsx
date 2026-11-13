import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlowStub } from './FlowStub';

const meta = {
  title: 'Components/Flow stub',
  component: FlowStub,
  args: { variant: 'unknown', count: 4 },
} satisfies Meta<typeof FlowStub>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnknownCalls: Story = {};
export const OneUnknownCall: Story = { args: { count: 1 } };
export const MoreNotShown: Story = { args: { variant: 'more', count: 32 } };
export const Selected: Story = { args: { selected: true } };
