import {
  Button,
  PopoverButton,
  Popover,
  PopoverTrigger,
  WORKSPACE_STATUS_LABELS,
  WorkspaceStatus,
} from '@flowcanvas/ui';
import { useEffect, useState } from 'react';
import { MACHINE, shownState, type WorkspaceControl } from '../projects/ProjectWorkspace';
import { fetchUsage, isProblem } from '../usage/api';
import { formatWorkspaceTime } from '../usage/Usage';
import styles from './WorkspacePopover.module.css';

const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** What the "since" fact means in each state. */
const SINCE: Partial<Record<string, string>> = {
  running: 'Running since',
  sleeping: 'Asleep since',
  stopped: 'Stopped since',
};

/**
 * The top bar's workspace chip and its popover (design brief, 29: "click for machine size, uptime, last backup
 * time and Sleep now"; Figma 37's workspace popover). Only recorded facts: no backup time until backups exist
 * (18a), no region or "change where it runs" until the local runner (48a).
 */
export function WorkspacePopover({
  control,
  fetcher,
}: {
  readonly control: WorkspaceControl;
  readonly fetcher: typeof fetch;
}) {
  const shown = shownState(control);
  return (
    <PopoverTrigger>
      <PopoverButton kind="ghost" aria-label={`Workspace: ${WORKSPACE_STATUS_LABELS[shown]}`}>
        <WorkspaceStatus state={shown} {...(shown === 'running' ? { detail: '2 cores' } : {})} />
      </PopoverButton>
      <Popover title="Workspace">
        <WorkspaceDetails control={control} fetcher={fetcher} />
      </Popover>
    </PopoverTrigger>
  );
}

function WorkspaceDetails({
  control,
  fetcher,
}: {
  readonly control: WorkspaceControl;
  readonly fetcher: typeof fetch;
}) {
  const { workspace, pending, problem, act } = control;
  const shown = shownState(control);
  const busy = pending !== undefined;
  // This month's usage, read when the popover opens (it's only shown here).
  const [usage, setUsage] = useState<string>('…');
  useEffect(() => {
    let current = true;
    void fetchUsage(fetcher).then((result) => {
      if (current)
        setUsage(
          isProblem(result)
            ? 'Not available right now'
            : formatWorkspaceTime(result.workspaceSeconds),
        );
    });
    return () => {
      current = false;
    };
  }, [fetcher]);
  const since = SINCE[workspace.state];

  return (
    <div className={styles.details}>
      <dl className={styles.facts}>
        <dt>Status</dt>
        <dd>{WORKSPACE_STATUS_LABELS[shown]}</dd>
        <dt>Machine</dt>
        <dd>{MACHINE}</dd>
        {since !== undefined && (
          <>
            <dt>{since}</dt>
            <dd>{time.format(new Date(workspace.stateChangedAt))}</dd>
          </>
        )}
        <dt>This month</dt>
        <dd>{usage}</dd>
      </dl>
      {workspace.failure !== null && <p className={styles.note}>{workspace.failure}</p>}
      {problem !== undefined && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        {(shown === 'not_created' || shown === 'stopped' || shown === 'failed') && (
          <Button size="sm" disabled={busy} onClick={() => void act('open')}>
            {shown === 'failed' ? 'Try again' : 'Open'}
          </Button>
        )}
        {shown === 'sleeping' && (
          <Button size="sm" disabled={busy} onClick={() => void act('resume')}>
            Resume
          </Button>
        )}
        {shown === 'running' && (
          <Button size="sm" disabled={busy} onClick={() => void act('sleep')}>
            {pending === 'sleep' ? 'Putting to sleep…' : 'Sleep now'}
          </Button>
        )}
        {(shown === 'running' || shown === 'sleeping') && (
          <Button size="sm" kind="ghost" disabled={busy} onClick={() => void act('stop')}>
            {pending === 'stop' ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>
    </div>
  );
}
