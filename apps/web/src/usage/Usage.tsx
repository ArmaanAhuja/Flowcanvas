import { useEffect, useState } from 'react';
import { fetchUsage, isProblem, type UsageSummary } from './api';
import styles from './Usage.module.css';

interface UsageProps {
  /** Replaces the browser's fetch in tests. */
  readonly fetcher?: typeof fetch;
}

// The reset date is the first instant of next month in UTC, so it's shown as a UTC date.
const resetFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

/** "2 h 5 min", rounded down to the minute; under a minute reads "0 min". */
export function formatWorkspaceTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${String(minutes)} min` : `${String(hours)} h ${String(minutes % 60)} min`;
}

/**
 * Workspace time this month: the start of the meter on the profile page (design brief, "31. Usage and limits").
 * Only what was measured; the free allowance and limits come with plans (phase 44a).
 */
export function Usage({ fetcher = fetch }: UsageProps) {
  const [usage, setUsage] = useState<UsageSummary | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void fetchUsage(fetcher).then((loaded) => {
      if (!current) return;
      if (isProblem(loaded)) setProblem(loaded.message);
      else setUsage(loaded);
    });
    return () => {
      current = false;
    };
  }, [fetcher]);

  return (
    <section className={styles.section} aria-labelledby="usage-heading">
      <h2 id="usage-heading" className={styles.heading}>
        Usage this month
      </h2>
      {problem !== undefined && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      {usage !== undefined && (
        <p className={styles.line}>
          Workspace time: {formatWorkspaceTime(usage.workspaceSeconds)}.{' '}
          <span className={styles.meta}>
            Resets {resetFormat.format(new Date(usage.resetsAt))}.
          </span>
        </p>
      )}
    </section>
  );
}
