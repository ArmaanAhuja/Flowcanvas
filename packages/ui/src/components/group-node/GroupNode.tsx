import type { ComponentPropsWithRef, KeyboardEvent } from 'react';
import {
  AppWindow,
  ChevronRight,
  Clock,
  Code,
  Database,
  FileCode,
  Globe,
  KeyRound,
  Route,
  Sparkles,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { classNames } from '../../class-names';
import type { FlowNodeKind } from '../flow-node/FlowNode';
import styles from './GroupNode.module.css';

export type GroupNodeKind = FlowNodeKind;

const ICONS: Record<GroupNodeKind, LucideIcon> = {
  function: Code,
  file: FileCode,
  ui: AppWindow,
  data: Database,
  ai: Sparkles,
  queue: Clock,
  external: Globe,
  route: Route,
  rule: SlidersHorizontal,
  config: SlidersHorizontal,
  auth: KeyRound,
  error: TriangleAlert,
};

export interface GroupNodeProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  /** Named from the code: its folder (`server-only/document`), or its kind ("Tables"). */
  readonly title: string;
  readonly count: number;
  /** Open: a frame (filling its box) its members are drawn in; closed: a stacked card. */
  readonly expanded?: boolean | undefined;
  readonly onToggle?: (() => void) | undefined;
  readonly kind?: GroupNodeKind | undefined;
  readonly selected?: boolean | undefined;
}

/**
 * A group of a flow's nodes (phase 12, ADR 0032; design brief: "collapsed groups look like stacked cards
 * ('Validation · 4'), with a chevron to expand. Expanding pushes nothing else around"). Closed, a stacked card; open,
 * a frame whose header closes it. The header is the one control: a click, Enter or Space opens or closes it.
 */
export function GroupNode({
  title,
  count,
  expanded = false,
  onToggle,
  kind = 'function',
  selected = false,
  className,
  ...rest
}: GroupNodeProps) {
  const Icon = ICONS[kind];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle?.();
    }
  };
  return (
    <div
      {...rest}
      className={classNames(styles.group, className)}
      data-expanded={expanded || undefined}
      data-selected={selected || undefined}
    >
      <div
        className={styles.header}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${title}, ${String(count)} ${count === 1 ? 'node' : 'nodes'}`}
        onClick={onToggle}
        onKeyDown={onKeyDown}
      >
        <Icon className={styles.icon} aria-hidden="true" />
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{count}</span>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
      </div>
    </div>
  );
}
