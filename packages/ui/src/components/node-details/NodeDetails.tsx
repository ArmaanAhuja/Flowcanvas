import { classNames } from '../../class-names';
import { ProvenanceGlyph, type GlyphProvenance } from '../provenance-glyph/ProvenanceGlyph';
import styles from './NodeDetails.module.css';

/** A list as the engine sends it: its first items, and how many there are in all. */
export interface DetailListData<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** What the code reveals about a code unit (the engine's `NodeDetails`, phase 7, ADR 0028 §3). */
export interface NodeDetailsData {
  readonly signature: string | null;
  readonly params: DetailListData<{
    readonly name: string;
    readonly type: string;
    readonly optional: boolean;
  }>;
  readonly returns: string | null;
  readonly async: boolean;
  readonly exported: boolean;
  readonly decisions: DetailListData<{
    readonly kind: 'if' | 'switch' | 'ternary' | 'catch';
    readonly condition: string;
    readonly outcomes: readonly string[];
    readonly line: number;
  }>;
  readonly throws: DetailListData<{ readonly text: string; readonly line: number }>;
  readonly awaits: DetailListData<{ readonly text: string; readonly line: number }>;
  readonly unresolved: DetailListData<{ readonly text: string; readonly lines: readonly number[] }>;
  readonly writes: DetailListData<{ readonly text: string; readonly line: number }>;
}

export interface NodeDetailsProps {
  readonly details: NodeDetailsData;
  /** The unit's file, for each line's link ("src/poll.ts:12"). */
  readonly path: string;
  /** Opens a line of the unit's file in the Code view. */
  readonly onOpenLine: (line: number) => void;
}

const DECISION_KINDS = { if: 'if', switch: 'switch', ternary: '?:', catch: 'catch' } as const;

/**
 * The inspector's Details for a code unit (design brief, "Node inspector"; phase 7): everything its code reveals, each
 * line a link to its place. Lists say how many there are when only the first are shown. Empty lists aren't shown.
 */
export function NodeDetails({ details, path, onOpenLine }: NodeDetailsProps) {
  const at = (line: number) => (
    <button
      type="button"
      className={classNames(styles.line)}
      onClick={() => {
        onOpenLine(line);
      }}
      aria-label={`Open ${path}:${String(line)}`}
    >
      {String(line)}
    </button>
  );
  return (
    <section className={classNames(styles.details)} aria-label="Details">
      {details.signature !== null && (
        <p className={classNames(styles.signature)}>{details.signature}</p>
      )}
      {(details.async || details.exported) && (
        <p className={classNames(styles.marks)}>
          {[details.exported ? 'exported' : null, details.async ? 'async' : null]
            .filter((mark) => mark !== null)
            .join(' · ')}
        </p>
      )}
      <Group title="Inputs" list={details.params}>
        {(param) => (
          <>
            <span className={classNames(styles.code)}>
              {param.name}
              {param.optional ? '?' : ''}
            </span>
            <span className={classNames(styles.type)}>{param.type}</span>
          </>
        )}
      </Group>
      {details.returns !== null && (
        <section className={classNames(styles.group)} aria-label="Returns">
          <h3 className={classNames(styles.title)}>Returns</h3>
          <p className={classNames(styles.type)}>{details.returns}</p>
        </section>
      )}
      <Group title="Decisions" list={details.decisions}>
        {(decision) => (
          <>
            <span className={classNames(styles.kind)}>{DECISION_KINDS[decision.kind]}</span>
            <span className={classNames(styles.code)} title={decision.condition}>
              {decision.condition}
            </span>
            <span className={classNames(styles.outcomes)}>{decision.outcomes.join(' · ')}</span>
            {at(decision.line)}
          </>
        )}
      </Group>
      <Group title="Throws" list={details.throws}>
        {(thrown) => (
          <>
            <span className={classNames(styles.code)}>{thrown.text}</span>
            {at(thrown.line)}
          </>
        )}
      </Group>
      <Group title="Awaits" list={details.awaits}>
        {(awaited) => (
          <>
            <span className={classNames(styles.code)}>{awaited.text}</span>
            {at(awaited.line)}
          </>
        )}
      </Group>
      <Group title="Unknown calls" list={details.unresolved}>
        {(call) => (
          <>
            <Glyph provenance="unknown" />
            <span className={classNames(styles.code)}>{call.text}</span>
            {call.lines[0] !== undefined && at(call.lines[0])}
          </>
        )}
      </Group>
      <Group title="Writes to module state" list={details.writes}>
        {(write) => (
          <>
            <span className={classNames(styles.code)}>{write.text}</span>
            {at(write.line)}
          </>
        )}
      </Group>
    </section>
  );
}

function Glyph({ provenance }: { readonly provenance: GlyphProvenance }) {
  return <ProvenanceGlyph provenance={provenance} className={classNames(styles.glyph)} />;
}

function Group<T>({
  title,
  list,
  children,
}: {
  readonly title: string;
  readonly list: DetailListData<T>;
  readonly children: (item: T) => React.ReactNode;
}) {
  if (list.total === 0) return null;
  const more = list.total - list.items.length;
  return (
    <section className={classNames(styles.group)} aria-label={title}>
      <h3 className={classNames(styles.title)}>
        {title}{' '}
        <span className={classNames(styles.count)}>{list.total.toLocaleString('en-US')}</span>
      </h3>
      <ul className={classNames(styles.list)}>
        {list.items.map((item, index) => (
          <li key={index} className={classNames(styles.row)}>
            {children(item)}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className={classNames(styles.more)}>
          and {more.toLocaleString('en-US')} more, in the code
        </p>
      )}
    </section>
  );
}

/** Provenance names in the order the completeness pill lists them (design brief). */
const PILL_ORDER = ['resolved', 'convention', 'observed', 'suggested', 'unknown'] as const;

/**
 * The completeness pill's words (design brief, "Flow graph view"; Figma 06): all of a flow's edges, then each kind
 * of provenance it has, e.g. "18 edges · 11 resolved · 4 convention · 2 observed · 1 unknown".
 */
export function completenessText(byProvenance: Readonly<Record<GlyphProvenance, number>>): string {
  const total = PILL_ORDER.reduce((sum, key) => sum + byProvenance[key], 0);
  return [
    `${total.toLocaleString('en-US')} ${total === 1 ? 'edge' : 'edges'}`,
    ...PILL_ORDER.filter((key) => byProvenance[key] > 0).map(
      (key) => `${byProvenance[key].toLocaleString('en-US')} ${key}`,
    ),
  ].join(' · ');
}
