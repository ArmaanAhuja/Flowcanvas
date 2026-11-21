import { useEffect, useRef, type ReactNode } from 'react';
import { classNames } from '../../class-names';
import styles from './ProcessCard.module.css';

/** A process's states, as the desktop app's process manager reports them (build plan v2, phase 3). */
export type ProcessCardState = 'running' | 'stopping' | 'stopped' | 'finished' | 'failed';

export const PROCESS_STATE_LABELS: Record<ProcessCardState, string> = {
  running: 'Running',
  stopping: 'Stopping…',
  stopped: 'Stopped',
  finished: 'Finished',
  failed: 'Failed',
};

/** As the workspace chip: green for a running process, red for a failure, an open ring while it's stopping. */
const TONES: Record<ProcessCardState, 'healthy' | 'failed' | 'changing' | 'idle'> = {
  running: 'healthy',
  stopping: 'changing',
  stopped: 'idle',
  finished: 'idle',
  failed: 'failed',
};

export interface ProcessCardProps {
  /** `dev`, `Install dependencies`. */
  readonly label: string;
  /** What runs (`pnpm run dev`). */
  readonly command: string;
  readonly state: ProcessCardState;
  readonly exitCode?: number | null;
  /** Ports it listens on, each shown as a link to http://localhost:<port>. */
  readonly ports?: readonly number[];
  /** Why it couldn't start, in words. */
  readonly problem?: string | null;
  /** Its output, as text (already masked). */
  readonly log?: string;
  /** Its output as something else (the desktop app's terminal view); shown instead of `log`. */
  readonly output?: ReactNode;
  /** Buttons: Stop, Restart. */
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * One process the person started (design brief, "18. Terminal and run manager"): its name, state in words, what it
 * runs, the addresses it serves, and its log, which follows the end while it's at the end.
 */
export function ProcessCard({
  label,
  command,
  state,
  exitCode = null,
  ports = [],
  problem = null,
  log = '',
  output,
  actions,
  className,
}: ProcessCardProps) {
  const logRef = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const element = logRef.current;
    if (element !== null && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [log]);
  const said =
    state === 'failed' && exitCode !== null
      ? `${PROCESS_STATE_LABELS.failed} · exit code ${String(exitCode)}`
      : PROCESS_STATE_LABELS[state];
  return (
    <section className={classNames(styles.card, className)} aria-label={label} data-state={state}>
      <header className={styles.header}>
        <span className={styles.dot} data-tone={TONES[state]} aria-hidden="true" />
        <h3 className={styles.label}>{label}</h3>
        <span className={styles.state}>{said}</span>
        {ports.map((port) => (
          <a
            key={port}
            className={styles.port}
            href={`http://localhost:${String(port)}`}
            target="_blank"
            rel="noreferrer"
          >
            localhost:{port}
          </a>
        ))}
        <span className={styles.actions}>{actions}</span>
      </header>
      <code className={styles.command}>{command}</code>
      {problem !== null && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {output}
      {output === undefined && log !== '' && (
        <pre
          ref={logRef}
          className={styles.log}
          // Scrollable, so it's reachable by keyboard (axe: scrollable-region-focusable).
          tabIndex={0}
          aria-label={`Output of ${label}`}
          onScroll={(event) => {
            const element = event.currentTarget;
            atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
          }}
        >
          {log}
        </pre>
      )}
    </section>
  );
}
