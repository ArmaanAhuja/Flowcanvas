import { Fragment, type ComponentPropsWithRef } from 'react';
import {
  AppWindow,
  BrainCircuit,
  Code,
  Database,
  File,
  Globe,
  KeyRound,
  Layers,
  ListChecks,
  Route,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { classNames } from '../../class-names';
import { Tag, type TagTone } from '../tag/Tag';
import styles from './FlowNode.module.css';
import { wrapSegments } from './wrap';

/** The twelve node types in Graphite, one icon each. */
export type FlowNodeKind =
  | 'ui'
  | 'function'
  | 'route'
  | 'rule'
  | 'data'
  | 'external'
  | 'ai'
  | 'queue'
  | 'config'
  | 'auth'
  | 'error'
  | 'file';

/** What happened to this node in the change under review. Absent means unchanged. */
export type FlowNodeChange = 'added' | 'modified' | 'removed' | 'affected' | 'scope';

/** Live status, independent of the change: a failing test, or analysis still running. */
export type FlowNodeStatus = 'failing' | 'analysing';

export interface FlowNodeProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  /** Short name, e.g. "createItem". */
  readonly title: string;
  /** File and line, e.g. "src/items/create.ts:42". */
  readonly location: string;
  readonly kind?: FlowNodeKind;
  readonly change?: FlowNodeChange;
  readonly status?: FlowNodeStatus;
  readonly selected?: boolean;
}

const KINDS: Record<FlowNodeKind, { readonly icon: LucideIcon; readonly label: string }> = {
  ui: { icon: AppWindow, label: 'UI' },
  function: { icon: Code, label: 'Function' },
  route: { icon: Route, label: 'Route' },
  rule: { icon: ListChecks, label: 'Rule' },
  data: { icon: Database, label: 'Data' },
  external: { icon: Globe, label: 'External service' },
  ai: { icon: BrainCircuit, label: 'AI call' },
  queue: { icon: Layers, label: 'Queue' },
  config: { icon: SlidersHorizontal, label: 'Config' },
  auth: { icon: KeyRound, label: 'Auth' },
  error: { icon: TriangleAlert, label: 'Error' },
  file: { icon: File, label: 'File' },
};

interface Label {
  readonly tone: TagTone;
  /** Visual prefix only; screen readers hear the text ("modified", not "tilde modified"). */
  readonly symbol?: string;
  readonly text: string;
}

const CHANGE_LABELS: Record<FlowNodeChange, Label> = {
  added: { tone: 'added', symbol: '+', text: 'added' },
  modified: { tone: 'modified', symbol: '~', text: 'modified' },
  removed: { tone: 'removed', symbol: '−', text: 'removed' },
  affected: { tone: 'affected', text: 'affected' },
  scope: { tone: 'scope', text: 'outside selection' },
};

const STATUS_LABELS: Record<FlowNodeStatus, Label> = {
  failing: { tone: 'removed', text: 'failing' },
  analysing: { tone: 'neutral', text: 'analysing…' },
};

function StateTag({ label }: { readonly label: Label }) {
  return (
    <Tag tone={label.tone}>
      {/* A no-break space: the Tag is a flex container, which would drop an ordinary trailing space. */}
      {label.symbol !== undefined && <span aria-hidden="true">{`${label.symbol}\u00a0`}</span>}
      {label.text}
    </Tag>
  );
}

/** Text that wraps at its word boundaries (`canAccess·Team·Document`, `folder/·delete-·folder.·ts`), not anywhere. */
function Wrapping({ text }: { readonly text: string }) {
  return wrapSegments(text).map((piece, index) => (
    // Pieces repeat ("a/a/"): their index is their identity.
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {piece}
    </Fragment>
  ));
}

/**
 * One step of a flow on the canvas. Presentational only: selection, focus and keyboard handling
 * belong to the canvas that renders it. A change is shown by hue *and* by shape (state bar, dashed
 * outline, strikethrough) *and* by a text tag, so it never depends on colour alone.
 */
export function FlowNode({
  title,
  location,
  kind = 'function',
  change,
  status,
  selected = false,
  className,
  ...rest
}: FlowNodeProps) {
  const { icon: Icon, label: kindLabel } = KINDS[kind];
  return (
    <div
      {...rest}
      className={classNames(styles.node, className)}
      data-change={change}
      data-status={status}
      data-selected={selected || undefined}
      aria-busy={status === 'analysing' || undefined}
    >
      <Icon className={styles.icon} role="img" aria-label={kindLabel} />
      <div className={styles.text}>
        <div className={styles.titleRow}>
          <span className={styles.title}>
            <Wrapping text={title} />
          </span>
          {(change !== undefined || status !== undefined) && (
            <span className={styles.tags}>
              {change !== undefined && <StateTag label={CHANGE_LABELS[change]} />}
              {status !== undefined && <StateTag label={STATUS_LABELS[status]} />}
            </span>
          )}
        </div>
        <span className={styles.location}>
          <Wrapping text={location} />
        </span>
      </div>
    </div>
  );
}
