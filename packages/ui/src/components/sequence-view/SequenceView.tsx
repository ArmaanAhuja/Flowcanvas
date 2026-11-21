import { Clock } from 'lucide-react';
import { memo, type CSSProperties } from 'react';
import { classNames } from '../../class-names';
import { Tag } from '../tag/Tag';
import styles from './SequenceView.module.css';

export type SequenceChange = 'added' | 'modified' | 'affected';

export interface SequenceStep {
  readonly id: string;
  readonly name: string;
  /** Where it is (`email/email.service.ts:18`); said in its row's title, for the pointer. */
  readonly location?: string | undefined;
  /** How deep in the calls it is: 0 for the flow's root (or a section's first step). */
  readonly depth: number;
  /** The outcome it's reached on, from a decision: "yes", "no", "case 'DRAFT'", "error". */
  readonly branch?: string | null | undefined;
  /** On a failure path (a catch's branch): a red marker (design brief, "Sequence view"). */
  readonly failure?: boolean | undefined;
  /** Calls whose target wasn't found, or that aren't shown: an open end, not a step that can be selected. */
  readonly stub?: boolean | undefined;
  readonly change?: SequenceChange | undefined;
  /**
   * Its order, and how many rows it spans (itself and what it calls): without timings, its bar covers its calls'
   * rows, as a trace's parent span covers its children's.
   */
  readonly order: number;
  readonly span: number;
  /** Measured, from a run (phase 29): start and duration in ms. Never set from the code. */
  readonly start?: number | undefined;
  readonly duration?: number | undefined;
}

export interface SequenceBackgroundSection {
  readonly id: string;
  /** "Background · email-queue · EmailSenderJob": the hand-off it starts after. */
  readonly title: string;
  readonly steps: readonly SequenceStep[];
}

export interface SequenceViewProps {
  readonly title: string;
  /** "order from code; no timings yet" until a run is observed (design brief). */
  readonly subtitle: string;
  readonly mainSteps: readonly SequenceStep[];
  /** Each hand-off's work, after it (design brief: "async hand-offs jump to a new row group labelled Background"). */
  readonly background?: readonly SequenceBackgroundSection[] | undefined;
  readonly selectedId?: string | null | undefined;
  readonly onSelectStep?: ((id: string) => void) | undefined;
  readonly className?: string | undefined;
}

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${String(ms)} ms`);

/**
 * The sequence view (phase 13; Figma 08; design brief, "Sequence view"): the flow as a waterfall, one row a step in
 * the order the code calls them, nested by depth; each hand-off's work in a Background group after it. Without
 * runtime data the bars show order only (dashed), each covering the rows of what it calls; with measured spans
 * (phase 29) they show start and duration on a time axis. Nothing is timed that wasn't measured.
 */
export const SequenceView = memo(function SequenceView({
  title,
  subtitle,
  mainSteps,
  background = [],
  selectedId,
  onSelectStep,
  className,
}: SequenceViewProps) {
  const all = [...mainSteps, ...background.flatMap((section) => section.steps)];
  const timed = all.some((step) => step.duration !== undefined);
  const total = timed
    ? Math.max(1, ...all.map((step) => (step.start ?? 0) + (step.duration ?? 0)))
    : Math.max(1, all.length);
  const ticks = timed ? [0, 0.25, 0.5, 0.75, 1].map((f) => formatMs(Math.round(total * f))) : [];

  const row = (step: SequenceStep) => {
    const left = timed ? (step.start ?? 0) / total : step.order / total;
    const width = timed ? (step.duration ?? 0) / total : step.span / total;
    const bar: CSSProperties = {
      insetInlineStart: `${(left * 100).toFixed(2)}%`,
      inlineSize: `${(width * 100).toFixed(2)}%`,
    };
    const label = (
      <>
        {step.branch != null && <span className={styles.branch}>{step.branch}</span>}
        <span className={styles.name}>{step.name}</span>
        {step.change !== undefined && (
          <Tag tone={step.change}>
            {step.change === 'added' ? '+' : step.change === 'modified' ? '~' : 'affected'}
          </Tag>
        )}
        {step.failure === true && <Tag tone="removed">failure path</Tag>}
      </>
    );
    const indent = { '--depth': String(step.depth) } as CSSProperties;
    if (step.stub === true) {
      return (
        <div key={step.id} className={styles.row} data-stub>
          <div className={styles.step} style={indent}>
            {label}
          </div>
          <div className={styles.track} />
        </div>
      );
    }
    return (
      <div
        key={step.id}
        className={styles.row}
        role="button"
        tabIndex={0}
        aria-label={`${step.name}${step.location === undefined ? '' : `, ${step.location}`}`}
        aria-pressed={selectedId === step.id}
        title={step.location}
        data-selected={selectedId === step.id || undefined}
        data-failure={step.failure === true || undefined}
        onClick={() => onSelectStep?.(step.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectStep?.(step.id);
          }
        }}
      >
        <div className={styles.step} style={indent}>
          {label}
        </div>
        <div className={styles.track}>
          <span
            className={styles.bar}
            data-timed={step.duration !== undefined || undefined}
            data-change={step.change}
            data-failure={step.failure === true || undefined}
            style={bar}
          />
          {step.duration !== undefined && (
            <span
              className={styles.duration}
              style={{ insetInlineStart: `${((left + width) * 100).toFixed(2)}%` }}
            >
              {formatMs(step.duration)}
            </span>
          )}
        </div>
      </div>
    );
  };

  const changed = all.some((step) => step.change !== undefined);
  const failures = all.some((step) => step.failure === true);
  return (
    <section className={classNames(styles.view, className)} aria-label="Sequence">
      <header className={styles.header}>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </header>
      <div className={styles.axis}>
        <span className={styles.step}>Step</span>
        <div className={styles.track}>
          {ticks.map((tick, i) => (
            <span
              key={tick}
              className={styles.tick}
              style={{ insetInlineStart: `${String(i * 25)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
      </div>
      <div role="group" aria-label="Main">
        {mainSteps.map(row)}
      </div>
      {background.map((section) => (
        <div key={section.id} role="group" aria-label={section.title}>
          <div className={styles.section}>
            <Clock className={styles.clock} aria-hidden="true" />
            <span>{section.title}</span>
          </div>
          {section.steps.map(row)}
        </div>
      ))}
      <footer className={styles.legend} aria-label="Legend">
        {timed && (
          <span className={styles.key}>
            <span className={styles.swatch} data-timed />
            observed span
          </span>
        )}
        {all.some((step) => step.duration === undefined && step.stub !== true) && (
          <span className={styles.key}>
            <span className={styles.swatch} />
            order from code, no timing
          </span>
        )}
        {changed && (
          <span className={styles.key}>
            <span className={styles.swatch} data-change="modified" />
            changed in this session
          </span>
        )}
        {failures && (
          <span className={styles.key}>
            <span className={styles.swatch} data-failure />
            failure path
          </span>
        )}
      </footer>
    </section>
  );
});
