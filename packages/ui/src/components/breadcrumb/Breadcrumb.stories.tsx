import type { Meta, StoryObj } from '@storybook/react-vite';
import { Breadcrumb } from './Breadcrumb';

const meta = {
  title: 'Editor/Breadcrumb',
  component: Breadcrumb,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A file's path above the editor (Figma 11). Symbols follow the file from phase 4. */
export const FilePath: Story = {
  args: { 'aria-label': 'File path', segments: ['worker', 'process.ts'] },
};

/** Too long to show: cut in the middle, the file always visible, the whole path on hover. */
export const Long: Story = {
  args: {
    'aria-label': 'File path',
    segments: ['apps', 'web', 'src', 'features', 'polls', 'create', 'poll-form.tsx'],
  },
};
