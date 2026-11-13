import type { ComponentPropsWithRef } from 'react';
import { classNames } from '../../class-names';
import styles from './DecisionNode.module.css';

/** Longest condition shown on the canvas; the inspector shows it whole (phase 7, risk R2). */
export const CONDITION_SHOWN = 60;

export interface DecisionNodeProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The condition as written (`envelope.status === DocumentStatus.DRAFT`), "on error" for a catch. */
  readonly condition: string;
  readonly selected?: boolean;
}

/**
 * A decision in a flow (design brief, "Flow graph view"; ADR 0028): a small diamond with its condition, cut to
 * CONDITION_SHOWN characters (the whole of it on hover and for screen readers). Its outcomes label the edges out of
 * it. Presentational only, like FlowNode.
 */
export function DecisionNode({
  condition,
  selected = false,
  className,
  ...rest
}: DecisionNodeProps) {
  const shown =
    condition.length > CONDITION_SHOWN ? `${condition.slice(0, CONDITION_SHOWN - 1)}…` : condition;
  return (
    <div
      {...rest}
      className={classNames(styles.decision, className)}
      data-selected={selected || undefined}
      // A figure in a diagram: read as one thing, with the whole condition (axe: a label needs a role).
      role="img"
      aria-label={`Decision: ${condition}`}
      title={condition}
    >
      <span className={classNames(styles.diamond)} aria-hidden="true" />
      <span className={classNames(styles.condition)} aria-hidden="true">
        {shown}
      </span>
    </div>
  );
}
