import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchTrigger } from './SearchTrigger';

const meta = {
  title: 'Shell/SearchTrigger',
  component: SearchTrigger,
  args: { onPress: () => undefined },
} satisfies Meta<typeof SearchTrigger>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The top bar's search on a Mac (Figma 06): opens the command palette. */
export const Mac: Story = { args: { shortcutLabel: '⌘K', keyShortcuts: 'Meta+K' } };

/** Elsewhere, the same with Ctrl. */
export const Others: Story = { args: { shortcutLabel: 'Ctrl K', keyShortcuts: 'Control+K' } };
