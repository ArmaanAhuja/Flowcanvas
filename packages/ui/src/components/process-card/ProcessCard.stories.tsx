import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../button/Button';
import { ProcessCard } from './ProcessCard';

const meta = {
  title: 'Components/ProcessCard',
  component: ProcessCard,
  args: {
    label: 'dev',
    command: 'pnpm run dev',
    state: 'running',
    ports: [3000],
    log: '> turbo dev --filter=@rallly/web\n\n@rallly/web:dev:   ▲ Next.js 15.5.4\n@rallly/web:dev:   - Local:        http://localhost:3000\n@rallly/web:dev:  ✓ Ready in 2.1s\n',
    actions: (
      <>
        <Button size="sm">Restart</Button>
        <Button size="sm">Stop</Button>
      </>
    ),
  },
} satisfies Meta<typeof ProcessCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Finished: Story = {
  args: {
    label: 'Install dependencies',
    command: 'pnpm install',
    state: 'finished',
    ports: [],
    log: 'Packages: +1843\nDone in 41.2s\n',
    actions: undefined,
  },
};

export const Failed: Story = {
  args: {
    state: 'failed',
    exitCode: 1,
    ports: [],
    log: 'Error: Invalid environment variables: SECRET_PASSWORD is required\n',
  },
};

export const CouldNotStart: Story = {
  args: {
    state: 'failed',
    ports: [],
    log: '',
    problem:
      'pnpm isn’t installed, or Flowcanvas can’t find it on your PATH. Install it, then try again.',
  },
};
