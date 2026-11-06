import type { ComponentPropsWithRef } from 'react';
import { classNames } from '../../class-names';
import styles from './WorkspaceStatus.module.css';

/** A workspace's states, as the control plane records them (phase 1d). */
export type WorkspaceStatusState =
  'not_created' | 'creating' | 'running' | 'sleeping' | 'resuming' | 'stopped' | 'failed';

/** The words for each state. The text always says the state; the dot only repeats it. */
export const WORKSPACE_STATUS_LABELS: Record<WorkspaceStatusState, string> = {
  not_created: 'Not started',
  creating: 'Starting…',
  running: 'Running',
  sleeping: 'Sleeping',
  resuming: 'Resuming…',
  stopped: 'Stopped',
  failed: 'Couldn’t start',
};

/**
 * How the dot looks: healthy (green, Graphite's runtime "pass"), failed (coral red, "fail"), changing (an open
 * ring: Starting and Resuming), or idle (neutral). Figma colours Starting with the accent, but Graphite keeps
 * the accent for selection and focus only, and Graphite wins (CLAUDE.md, sources).
 */
type Tone = 'healthy' | 'failed' | 'changing' | 'idle';
const TONES: Record<WorkspaceStatusState, Tone> = {
  not_created: 'idle',
  creating: 'changing',
  running: 'healthy',
  sleeping: 'idle',
  resuming: 'changing',
  stopped: 'idle',
  failed: 'failed',
};

export interface WorkspaceStatusProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  readonly state: WorkspaceStatusState;
  /** Shown after the label, e.g. "2 cores" for "Running · 2 cores" (design brief, 29). */
  readonly detail?: string;
}

/** The workspace status chip (design brief, "29. Workspace status"): a small dot and the state in words. */
export function WorkspaceStatus({ state, detail, className, ...rest }: WorkspaceStatusProps) {
  return (
    <span {...rest} className={classNames(styles.status, className)} data-state={state}>
      <span className={styles.dot} data-tone={TONES[state]} aria-hidden="true" />
      <span className={styles.label}>
        {WORKSPACE_STATUS_LABELS[state]}
        {detail !== undefined && ` · ${detail}`}
      </span>
    </span>
  );
}
