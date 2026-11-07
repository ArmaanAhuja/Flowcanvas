import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { EditorTabs, type EditorTab } from './EditorTabs';

const meta = {
  title: 'Editor/EditorTabs',
  component: EditorTabs,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EditorTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const FIGMA_11: EditorTab[] = [
  { id: 'worker/process.ts', label: 'process.ts', title: 'worker/process.ts', unsaved: true },
  { id: 'middleware/rateLimit.ts', label: 'rateLimit.ts', title: 'middleware/rateLimit.ts' },
  { id: 'api/items/route.ts', label: 'route.ts', title: 'api/items/route.ts', unsaved: true },
];

function Interactive({ tabs }: { readonly tabs: readonly EditorTab[] }) {
  const [open, setOpen] = useState(tabs);
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <EditorTabs
      aria-label="Open files"
      tabs={open}
      {...(active === undefined ? {} : { active })}
      onSelect={setActive}
      onClose={(id) => {
        setOpen((now) => now.filter((tab) => tab.id !== id));
      }}
    />
  );
}

/** Figma 11: three open files, the first shown; two with unsaved changes (a dot, and in their names). */
export const Default: Story = {
  args: {
    'aria-label': 'Open files',
    tabs: FIGMA_11,
    onSelect: () => undefined,
    onClose: () => undefined,
  },
  render: () => <Interactive tabs={FIGMA_11} />,
};

/** More files than fit: the row scrolls sideways and keeps the shown tab in view. */
export const Many: Story = {
  args: {
    'aria-label': 'Open files',
    tabs: [],
    onSelect: () => undefined,
    onClose: () => undefined,
  },
  render: () => (
    <div style={{ width: 640 }}>
      <Interactive
        tabs={[
          'page.tsx',
          'layout.tsx',
          'poll-form.tsx',
          'use-poll.ts',
          'trpc.ts',
          'schema.prisma',
          'auth.ts',
          'email.ts',
        ].map((label, i) => ({ id: label, label, unsaved: i === 2 }))}
      />
    </div>
  ),
};
