import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommandPalette, type PaletteSymbol } from './CommandPalette';

// Catalogue example content, shaped like Rallly's.
const SYMBOLS: PaletteSymbol[] = [
  {
    path: 'apps/web/src/features/poll/mutations.ts',
    name: 'createPoll',
    kind: 'function',
    container: null,
    line: 98,
    column: 14,
    exported: true,
  },
  {
    path: 'apps/web/src/features/poll/components/create-poll.tsx',
    name: 'CreatePoll',
    kind: 'component',
    container: null,
    line: 115,
    column: 14,
    exported: true,
  },
  {
    path: 'apps/web/src/server/poll-service.ts',
    name: 'createPollOption',
    kind: 'method',
    container: 'PollService',
    line: 41,
    column: 9,
    exported: false,
  },
  {
    path: 'apps/web/src/features/poll/schema.ts',
    name: 'CreatePollInput',
    kind: 'type',
    container: null,
    line: 7,
    column: 13,
    exported: true,
  },
];
const FILES = [
  'apps/web/src/features/poll/components/create-poll.tsx',
  'apps/web/src/features/poll/mutations.ts',
  'apps/web/src/app/[locale]/(optional-space)/new/page.tsx',
  'README.md',
];

const meta = {
  title: 'Shell/CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  args: {
    isOpen: true,
    onOpenChange: () => undefined,
    onQueryChange: () => undefined,
    onOpenFile: () => undefined,
    onOpenSymbol: () => undefined,
    files: FILES,
    symbols: SYMBOLS,
    query: 'create poll',
  },
  render: (args) => (
    <div style={{ height: 640 }}>
      <CommandPalette {...args} />
    </div>
  ),
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ⌘K (Figma 16): symbols from the project index first, then files. */
export const Results: Story = {};

/** While the first index runs: the results so far, and how far it has got. */
export const Indexing: Story = {
  args: { symbols: SYMBOLS.slice(0, 2), symbolsNote: 'Indexing 400 of 1,958 files…' },
};

/** `#` searches files only. */
export const FilesOnly: Story = { args: { query: '#create' } };

/** Before typing. */
export const Empty: Story = { args: { query: '', symbols: [] } };
