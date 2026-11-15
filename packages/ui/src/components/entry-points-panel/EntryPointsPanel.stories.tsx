import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { EntryPointsPanel, type EntryGroup, type EntryRow } from './EntryPointsPanel';

const meta = {
  title: 'Canvas/EntryPointsPanel',
  component: EntryPointsPanel,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof EntryPointsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma 06's project, as entry points (catalogue example content). */
const GROUPS: readonly EntryGroup[] = [
  {
    id: 'screens',
    count: 4,
    rows: [
      {
        id: 's-editor',
        kind: 'screen',
        label: '/items/:id/edit',
        suffix: 'ItemEditor',
        complete: true,
        children: [
          { id: 'e-save', kind: 'element', label: '<Button> onClick', complete: true },
          { id: 'e-form', kind: 'element', label: '<form> onSubmit', complete: true },
        ],
      },
      {
        id: 's-list',
        kind: 'screen',
        label: '/items',
        suffix: 'ItemsList',
        complete: true,
        childCount: 6,
      },
      { id: 's-detail', kind: 'screen', label: '/items/:id', suffix: 'ItemDetail', complete: true },
      { id: 's-settings', kind: 'screen', label: '/settings', suffix: 'Settings', complete: true },
    ],
  },
  {
    id: 'api',
    count: 9,
    rows: [
      { id: 'a-post', kind: 'api-route', label: 'POST /api/items', complete: true },
      { id: 'a-get', kind: 'api-route', label: 'GET /api/items', complete: true },
      { id: 'a-one', kind: 'api-route', label: 'GET /api/items/:id', complete: true },
      {
        id: 'a-auth',
        kind: 'api-route',
        label: 'GET /:unknown/auth/:id',
        complete: false,
        why: 'Part of its path isn’t a constant the code fixes.',
      },
    ],
    more: 5,
  },
  {
    id: 'jobs',
    count: 2,
    rows: [
      { id: 'k-digest', kind: 'cron', label: 'cron-queue · DailyDigestJob', complete: true },
      { id: 'j-email', kind: 'job', label: 'email-queue · SendEmailJob', complete: true },
    ],
  },
  {
    id: 'events',
    count: 1,
    rows: [{ id: 'v-created', kind: 'event', label: 'item.created', complete: true }],
  },
  {
    id: 'cli',
    count: 2,
    rows: [
      { id: 'c-dev', kind: 'cli-command', label: 'acme-web: dev', complete: true },
      { id: 'c-seed', kind: 'cli-command', label: 'acme-web: db:seed', complete: true },
    ],
  },
];

function Interactive({
  groups,
  start = 's-editor',
}: {
  readonly groups: readonly EntryGroup[];
  readonly start?: string;
}) {
  const [selected, setSelected] = useState<string | null>(start);
  const [filter, setFilter] = useState('');
  const matches = (row: EntryRow) => row.label.toLowerCase().includes(filter.toLowerCase());
  const shown = groups.map((group) => ({ ...group, rows: group.rows.filter(matches) }));
  return (
    <div style={{ width: 248, height: 640 }}>
      <EntryPointsPanel
        groups={shown}
        filter={filter}
        onFilterChange={setFilter}
        selected={selected}
        onShowFlow={(row) => {
          setSelected(row.id);
        }}
      />
    </div>
  );
}

const ARGS = {
  groups: [],
  filter: '',
  onFilterChange: () => undefined,
  onShowFlow: () => undefined,
};

/** Grouped by kind with counts; a screen open to its elements; an API route not fully detected. */
export const Project: Story = { args: ARGS, render: () => <Interactive groups={GROUPS} /> };

/** While the graph is being built: the message under the filter, and nothing listed yet. */
export const Building: Story = {
  args: ARGS,
  render: () => (
    <div style={{ width: 248, height: 360 }}>
      <EntryPointsPanel
        groups={GROUPS.map((g) => ({ ...g, count: 0, rows: [], more: 0 }))}
        filter=""
        onFilterChange={() => undefined}
        onShowFlow={() => undefined}
        message="Entry points are found with the graph, which is still being built."
        listed={false}
      />
    </div>
  ),
};
