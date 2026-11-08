import type { Meta, StoryObj } from '@storybook/react-vite';
import { QuickOpen } from './QuickOpen';

const meta = {
  title: 'Editor/QuickOpen',
  component: QuickOpen,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof QuickOpen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Ctrl/⌘+P (Figma 16's palette, files only): every file until you type (catalogue example content). */
export const Open: Story = {
  args: {
    isOpen: true,
    onOpenChange: () => undefined,
    onOpen: () => undefined,
    files: [
      'apps/web/src/components/poll-form.tsx',
      'apps/web/src/utils/greeting.ts',
      'apps/web/src/pages/polls/[id].tsx',
      'packages/database/prisma/schema.prisma',
      'README.md',
      'package.json',
    ],
  },
  render: (args) => (
    <div style={{ height: 600 }}>
      <QuickOpen {...args} />
    </div>
  ),
};
