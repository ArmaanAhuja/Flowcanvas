import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Bug,
  FileText,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  Puzzle,
  Search,
  Settings,
  SquareTerminal,
  Target,
  User,
} from 'lucide-react';
import { Rail, RailButton } from './Rail';

const meta = {
  title: 'Shell/Rail',
  component: Rail,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

const tools = [
  ['Canvas', LayoutGrid],
  ['Entry points', Target],
  ['Files', FileText],
  ['Search', Search],
  ['Source control', GitBranch],
  ['Tests', FlaskConical],
  ['Debug', Bug],
  ['Terminal', SquareTerminal],
  ['Plugins', Puzzle],
] as const;

/** Figma 06's rail, with Entry points open. */
export const Default: Story = {
  args: { children: null },
  render: () => (
    <div style={{ height: 520 }}>
      <Rail
        aria-label="Tools"
        footer={
          <>
            <RailButton label="Account" icon={<User size={18} />} />
            <RailButton label="Settings" icon={<Settings size={18} />} />
          </>
        }
      >
        {tools.map(([label, Icon]) => (
          <RailButton
            key={label}
            label={label}
            icon={<Icon size={18} />}
            active={label === 'Entry points'}
          />
        ))}
      </Rail>
    </div>
  ),
};
