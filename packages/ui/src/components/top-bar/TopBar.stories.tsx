import type { Meta, StoryObj } from '@storybook/react-vite';
import { GitBranch } from 'lucide-react';
import { Tabs } from '../tabs/Tabs';
import { WorkspaceStatus } from '../workspace-status/WorkspaceStatus';
import { TopBar } from './TopBar';

const meta = {
  title: 'Shell/TopBar',
  component: TopBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** As on Figma 06: project and branch, the view switch (Sequence and Code arrive in later phases), status. */
export const Default: Story = {
  args: {
    start: (
      <>
        <strong>acme-web</strong>
        <GitBranch size={14} aria-hidden="true" />
        <span>main</span>
      </>
    ),
    middle: (
      <Tabs
        aria-label="View"
        variant="segmented"
        items={[
          { id: 'graph', label: 'Graph' },
          { id: 'sequence', label: 'Sequence', disabled: true, hint: 'Arrives in a later phase' },
          { id: 'code', label: 'Code', disabled: true, hint: 'Arrives in a later phase' },
        ]}
      />
    ),
    end: <WorkspaceStatus state="running" detail="2 cores" />,
  },
};
