import type { Meta, StoryObj } from '@storybook/react-vite';
import { GraphStats, type GraphStatsSnapshot } from './GraphStats';

// Catalogue example content: Rallly's graph as the engine built it, decisions included (ADRs 0027 and 0028).
const rallly: GraphStatsSnapshot = {
  takenAt: '2026-11-12T10:42:00.000Z',
  complete: true,
  note: null,
  files: 1168,
  builtInCalls: 3930,
  stats: {
    nodes: 5381,
    edges: 22574,
    byNodeKind: {
      'entry-point': 0,
      'code-unit': 3327,
      decision: 2054,
      'data-access': 0,
      'async-handoff': 0,
      'external-boundary': 0,
    },
    byCodeUnit: { function: 1603, method: 189, component: 1081, class: 38, module: 416 },
    byEdgeKind: { call: 16394, branch: 6180, data: 0, handoff: 0, boundary: 0 },
    byProvenance: { observed: 0, resolved: 11870, convention: 0, suggested: 0, unknown: 10704 },
  },
  buildMs: 4100,
  saveMs: 20,
  loadMs: 10,
};
const ARRIVES_IN = {
  'entry-point': 8,
  'data-access': 10,
  'external-boundary': 10,
  'async-handoff': 11,
  data: 10,
  boundary: 10,
  handoff: 11,
};

const meta = {
  title: 'Shell/GraphStats',
  component: GraphStats,
  parameters: { layout: 'padded' },
  args: { state: 'ready', snapshot: rallly, arrivesIn: ARRIVES_IN },
  render: (args) => (
    <div style={{ width: 360 }}>
      <GraphStats {...args} />
    </div>
  ),
} satisfies Meta<typeof GraphStats>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const BuildingWithLastVersion: Story = { args: { state: 'building' } };
export const Waiting: Story = { args: { state: 'waiting', snapshot: null } };
export const Partial: Story = {
  args: {
    snapshot: {
      ...rallly,
      complete: false,
      note: 'This project is too large to analyse whole here: the graph covers part of it.',
    },
  },
};
export const Failed: Story = {
  args: {
    state: 'failed',
    message: 'The graph couldn’t be built. It’s tried again after the next change.',
  },
};
export const NotRunning: Story = { args: { state: 'unavailable', snapshot: null } };
