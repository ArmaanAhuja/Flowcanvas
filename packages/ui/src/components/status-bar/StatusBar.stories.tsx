import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toggle } from '../toggle/Toggle';
import { StatusBar } from './StatusBar';

const meta = {
  title: 'Editor/StatusBar',
  component: StatusBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Figma 11's status bar, with the autosave switch (owner, 7 Nov 2026). No error count: it arrives with language
 * servers (phase 33), and none is shown before then.
 */
export const Editor: Story = {
  args: {
    'aria-label': 'Editor status',
    items: ['Ln 43, Col 17', 'Spaces: 2', 'UTF-8', 'TypeScript'],
    end: (
      <>
        <span id="autosave-label">Autosave</span>
        <Toggle aria-labelledby="autosave-label" defaultChecked />
      </>
    ),
  },
};
