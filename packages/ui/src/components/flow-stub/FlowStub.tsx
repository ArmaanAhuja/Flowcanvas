import type { ComponentPropsWithRef } from 'react';
import { classNames } from '../../class-names';
import styles from './FlowStub.module.css';

export interface FlowStubProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /**
   * `unknown`: a node's calls whose target wasn't found, grouped (owner, 12 Nov 2026), drawn as Graphite's unknown
   * edge, an open stub ending in a hollow circle. `more`: where the flow stopped at its cap.
   */
  readonly variant: 'unknown' | 'more';
  readonly count: number;
  readonly selected?: boolean;
}

const text = (variant: FlowStubProps['variant'], count: number) =>
  variant === 'unknown'
    ? `${count.toLocaleString('en-US')} unknown ${count === 1 ? 'call' : 'calls'}`
    : `${count.toLocaleString('en-US')} more ${count === 1 ? 'call' : 'calls'} not shown`;

/** The honest ends of a flow (ADR 0028): what it can't resolve, and what it didn't show. Never a node of its own. */
export function FlowStub({ variant, count, selected = false, className, ...rest }: FlowStubProps) {
  return (
    <div
      {...rest}
      className={classNames(styles.stub, className)}
      data-variant={variant}
      data-selected={selected || undefined}
    >
      {variant === 'unknown' && (
        <svg className={classNames(styles.glyph)} viewBox="0 0 16 16" aria-hidden="true">
          <line x1="8" y1="0" x2="8" y2="8" />
          <circle cx="8" cy="11.5" r="3" />
        </svg>
      )}
      <span className={classNames(styles.text)}>{text(variant, count)}</span>
    </div>
  );
}
