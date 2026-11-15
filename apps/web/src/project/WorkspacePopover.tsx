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
  const main: { readonly label: string; readonly action: 'open' | 'resume' | 'sleep' } | null =
    shown === 'not_created' || shown === 'stopped' || shown === 'failed'
      ? { label: shown === 'failed' ? 'Try again' : 'Open', action: 'open' }
      : shown === 'sleeping'
        ? { label: 'Resume', action: 'resume' }
        : shown === 'running'
          ? { label: pending === 'sleep' ? 'Putting to sleep…' : 'Sleep now', action: 'sleep' }
          : null;

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
        {/* One button for the main action, whatever the state: when Sleep now turns into Resume it's the same
            element, so keyboard focus stays in the popover and Escape still closes it. While a request runs it's
            aria-disabled, not disabled: a browser takes focus away from a disabled button (phase 9, found by the
            phase 2 walkthrough on main). */}
        {main !== null && (
          <Button
            size="sm"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) void act(main.action);
            }}
          >
            {main.label}
          </Button>
        )}
        {(shown === 'running' || shown === 'sleeping') && (
          <Button
            size="sm"
            kind="ghost"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) void act('stop');
            }}
          >
            {pending === 'stop' ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>
    </div>
  );
}
