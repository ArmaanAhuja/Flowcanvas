import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { FileTree } from './FileTree';

const meta = {
  title: 'Editor/FileTree',
  component: FileTree,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FileTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma 11's project (catalogue example content). */
const FIGMA_11 = [
  'api/items/route.ts',
  'lib/db.ts',
  'lib/parse.ts',
  'middleware/rateLimit.ts',
  'worker/process.ts',
  'ui/ItemForm.tsx',
  'package.json',
];

function Interactive({
  files,
  start,
}: {
  readonly files: readonly string[];
  readonly start?: string;
}) {
  const [selected, setSelected] = useState(start);
  return (
    <div style={{ width: 232, height: 420 }}>
      <FileTree
        aria-label="Files"
        files={files}
        {...(selected === undefined ? {} : { selected })}
        unsaved={new Set(['worker/process.ts'])}
        onOpen={setSelected}
      />
    </div>
  );
}

/** The shown file is selected and its folder open; unsaved files carry a dot. */
export const Project: Story = {
  args: { 'aria-label': 'Files', files: FIGMA_11, onOpen: () => undefined },
  render: () => <Interactive files={FIGMA_11} start="worker/process.ts" />,
};

/** A project with 2,000 files: only the rows in view are in the page. */
export const Large: Story = {
  args: { 'aria-label': 'Files', files: [], onOpen: () => undefined },
  render: () => (
    <Interactive
      files={Array.from(
        { length: 2000 },
        (_, i) => `apps/web/src/features/f${String(i % 40)}/component-${String(i)}.tsx`,
      )}
      start="apps/web/src/features/f3/component-3.tsx"
    />
  ),
};

/** Before the project's files are known (a workspace with no clone yet). */
export const Empty: Story = {
  args: { 'aria-label': 'Files', files: [], onOpen: () => undefined },
  render: () => <Interactive files={[]} />,
};
