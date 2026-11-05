import { vars } from '@flowcanvas/tokens';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceStatus, type WorkspaceStatusState } from './WorkspaceStatus';

const STATES: WorkspaceStatusState[] = [
  'not_created',
  'creating',
  'running',
  'sleeping',
  'resuming',
  'stopped',
  'failed',
];

const meta = {
  title: 'Components/WorkspaceStatus',
  component: WorkspaceStatus,
  args: { state: 'running', detail: '2 cores' },
  argTypes: { state: { control: 'select', options: STATES } },
} satisfies Meta<typeof WorkspaceStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every state, as the top-bar chip shows it (design brief, "29. Workspace status"). */
export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['8'] }}>
      {STATES.map((state) => (
        <WorkspaceStatus
          key={state}
          state={state}
          {...(state === 'running' ? { detail: '2 cores' } : {})}
        />
      ))}
    </div>
  ),
};
