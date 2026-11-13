import type { Meta, StoryObj } from '@storybook/react-vite';
import { CallsPanel, type CallRow } from './CallsPanel';

// Catalogue example content, shaped like Rallly's createPoll.
const place = (path: string, line: number) => ({ path, line, column: 14 });
const row = (name: string, extra: Partial<CallRow> = {}): CallRow => ({
  id: name,
  name,
  kindLabel: 'Function',
  container: null,
  relation: 'calls',
  provenance: 'resolved',
  builtIn: false,
  place: place('apps/web/src/features/poll/mutations.ts', 40),
  sites: [place('apps/web/src/features/poll/mutations.ts', 120)],
  ...extra,
});

const meta = {
  title: 'Shell/CallsPanel',
  component: CallsPanel,
  parameters: { layout: 'padded' },
  args: {
    view: 'callers',
    onViewChange: () => undefined,
    onOpen: () => undefined,
    onShowFlow: () => undefined,
    status: 'ready',
    target: {
      name: 'createPoll',
      kindLabel: 'Function',
      place: place('apps/web/src/features/poll/mutations.ts', 98),
    },
    rows: [
      row('route.ts (top level)', {
        kindLabel: null,
        place: place('apps/web/src/app/api/v1/[...route]/route.ts', 1),
        sites: [
          place('apps/web/src/app/api/v1/[...route]/route.ts', 64),
          place('apps/web/src/app/api/v1/[...route]/route.ts', 91),
        ],
      }),
      row('NewPollPage', {
        kindLabel: 'Component',
        relation: 'renders',
        sites: [place('apps/web/src/app/new/page.tsx', 22)],
      }),
    ],
    references: [],
  },
  render: (args) => (
    <div style={{ width: 360 }}>
      <CallsPanel {...args} />
    </div>
  ),
} satisfies Meta<typeof CallsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Who calls or renders it (right-click → Callers). */
export const Callers: Story = {};

/** What it calls, grouped: the project's, unresolved (no node_modules), built-in collapsed (owner, 12 Nov 2026). */
export const Callees: Story = {
  args: {
    view: 'callees',
    rows: [
      row('toPollResponse', { place: place('apps/web/src/features/poll/mutations.ts', 30) }),
      row('assertOpenPollCapacity', {
        place: place('apps/web/src/features/poll/limit/mutations.ts', 12),
      }),
      row('prisma.$transaction', { provenance: 'unresolved', kindLabel: null, place: null }),
      row('tx.poll.create', { provenance: 'unresolved', kindLabel: null, place: null }),
      row('max', { builtIn: true, kindLabel: 'Method', place: null }),
    ],
  },
};

/** Every place it's used (Shift+F12). */
export const References: Story = {
  args: {
    view: 'references',
    references: [
      { ...place('apps/web/src/features/poll/mutations.ts', 98), isDefinition: true },
      { ...place('apps/web/src/app/api/v1/[...route]/route.ts', 64), isDefinition: false },
    ],
  },
};

/** While TypeScript works (the first question about a package builds its programs). */
export const Loading: Story = { args: { status: 'loading', rows: [] } };

/** Before anything is asked. */
export const Empty: Story = { args: { status: 'idle', target: null, rows: [] } };
