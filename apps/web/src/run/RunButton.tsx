import { Button } from '@flowcanvas/ui';
import { Play, Square } from 'lucide-react';
import type { RunControl } from './useRun';
import styles from './RunPanel.module.css';

/**
 * The top bar's Run (build plan v2, phase 3): one button that starts the project (installing first if needed), and
 * stops it while it runs. Its address shows beside it once the project says where it listens.
 */
export function RunButton({
  run,
  onNeedsPanel,
}: {
  readonly run: RunControl;
  /** Shows the Run tab: variables to fill in, or the output of what just started. */
  readonly onNeedsPanel: () => void;
}) {
  const plan = run.state?.plan;
  if (plan === undefined || plan.main === null) return null;
  const main = run.main;
  if (main !== undefined) {
    const port = main.ports[0];
    return (
      <span className={styles.runButton}>
        {port !== undefined && (
          <a
            className={styles.address}
            href={`http://localhost:${String(port)}`}
            target="_blank"
            rel="noreferrer"
          >
            localhost:{port}
          </a>
        )}
        <Button
          kind="secondary"
          disabled={main.state === 'stopping'}
          onClick={() => {
            run.stop(main.id);
          }}
        >
          <Square size={14} aria-hidden="true" /> Stop
        </Button>
      </span>
    );
  }
  return (
    <Button
      kind="primary"
      disabled={run.preparing}
      onClick={() => {
        run.runMain();
        onNeedsPanel();
      }}
    >
      <Play size={14} aria-hidden="true" /> {run.preparing ? 'Installing…' : 'Run'}
    </Button>
  );
}
