import { classNames } from '../../class-names';
import { ProvenanceGlyph, type GlyphProvenance } from '../provenance-glyph/ProvenanceGlyph';
import styles from './GraphStats.module.css';

/** One version of the project's flow graph, as the engine reports it (phase 6, ADR 0027). */
export interface GraphStatsSnapshot {
  readonly takenAt: string;
  readonly complete: boolean;
  readonly note: string | null;
  readonly files: number;
  readonly builtInCalls: number;
  readonly stats: {
    readonly nodes: number;
    readonly edges: number;
    readonly byNodeKind: Readonly<Record<string, number>>;
    readonly byCodeUnit: Readonly<Record<string, number>>;
    readonly byEdgeKind: Readonly<Record<string, number>>;
    readonly byProvenance: Readonly<Record<string, number>>;
  };
  readonly buildMs: number;
  readonly saveMs: number;
  readonly loadMs: number;
}

export interface GraphStatsProps {
  /** `unavailable`: no workspace running; `loading`: not asked yet. The rest are the engine's. */
  readonly state: 'loading' | 'unavailable' | 'waiting' | 'building' | 'ready' | 'failed';
  readonly message?: string | null | undefined;
  readonly snapshot: GraphStatsSnapshot | null;
  /** When each kind not detected yet arrives (owner, 12 Nov 2026: shown with its zero). */
  readonly arrivesIn: Readonly<Partial<Record<string, number>>>;
}

const NODE_KINDS: readonly (readonly [string, string])[] = [
  ['entry-point', 'Entry points'],
  ['code-unit', 'Code units'],
  ['decision', 'Decisions'],
  ['data-access', 'Data access'],
  ['async-handoff', 'Async hand-offs'],
  ['external-boundary', 'External boundaries'],
];
const CODE_UNITS: readonly (readonly [string, string])[] = [
  ['function', 'Functions'],
  ['component', 'Components'],
  ['method', 'Methods'],
  ['class', 'Classes'],
  ['module', 'Top levels of files'],
];
const EDGE_KINDS: readonly (readonly [string, string])[] = [
  ['call', 'Calls'],
  ['branch', 'Branches'],
  ['data', 'Data'],
  ['handoff', 'Hand-offs'],
  ['boundary', 'Boundaries'],
];
const PROVENANCES: readonly (readonly [GlyphProvenance, string, string])[] = [
  ['observed', 'Observed', 'seen running'],
  ['resolved', 'Resolved', 'proven by the compiler'],
  ['convention', 'Convention', 'matched by a framework rule'],
  ['suggested', 'Suggested', 'proposed, unverified'],
  ['unknown', 'Unknown', 'target not found'],
];

const count = (n: number) => n.toLocaleString('en-US');
const duration = (ms: number) =>
  ms < 1000
    ? `${String(ms)} ms`
    : `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const STATE_TEXT: Readonly<Record<GraphStatsProps['state'], string | null>> = {
  loading: 'Asking the workspace…',
  unavailable: 'Open the workspace to see its graph.',
  waiting: 'The graph is built once the project is indexed.',
  building: 'Building the graph…',
  ready: null,
  failed: null,
};

/**
 * Labs → Graph stats (phase 6's Try it): what the project's flow graph holds, by kind and by how each edge is known,
 * with every kind listed, zeros included, and when the missing ones arrive (owner, 12 Nov 2026). Calls into
 * TypeScript's library are counted apart: they're not in the graph.
 */
export function GraphStats({ state, message, snapshot, arrivesIn }: GraphStatsProps) {
  const said = STATE_TEXT[state] ?? message ?? null;
  return (
    <section className={classNames(styles.stats)} aria-label="Graph stats">
      <p className={classNames(styles.label)}>Labs · preview</p>
      {said !== null && (
        <p className={classNames(styles.note)} role="status">
          {said}
        </p>
      )}
      {snapshot !== null && (
        <>
          <header className={classNames(styles.summary)}>
            <p className={classNames(styles.total)}>
              {count(snapshot.stats.nodes)} nodes · {count(snapshot.stats.edges)} edges
            </p>
            <p className={classNames(styles.detail)}>
              {state === 'ready' ? 'From' : 'Last version, from'} {count(snapshot.files)} files, at{' '}
              {time(snapshot.takenAt)}
            </p>
            {!snapshot.complete && (
              <p className={classNames(styles.detail)}>
                {snapshot.note ?? 'Part of the project only.'}
              </p>
            )}
          </header>
          <Counts
            title="Nodes"
            rows={NODE_KINDS}
            counts={snapshot.stats.byNodeKind}
            arrivesIn={arrivesIn}
          />
          <Counts
            title="Code units"
            rows={CODE_UNITS}
            counts={snapshot.stats.byCodeUnit}
            arrivesIn={{}}
          />
          <Counts
            title="Edges"
            rows={EDGE_KINDS}
            counts={snapshot.stats.byEdgeKind}
            arrivesIn={arrivesIn}
          />
          <section className={classNames(styles.group)} aria-labelledby="graph-provenance">
            <h3 id="graph-provenance" className={classNames(styles.title)}>
              How edges are known
            </h3>
            <dl className={classNames(styles.list)}>
              {PROVENANCES.map(([key, label, meaning]) => (
                <div key={key} className={classNames(styles.row)}>
                  <dt className={classNames(styles.name)}>
                    <ProvenanceGlyph provenance={key} />
                    <span>
                      {label} <span className={classNames(styles.meaning)}>{meaning}</span>
                    </span>
                  </dt>
                  <dd className={classNames(styles.value)}>
                    {count(snapshot.stats.byProvenance[key] ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <p className={classNames(styles.detail)}>
            {count(snapshot.builtInCalls)} calls into TypeScript’s library, counted, not in the
            graph.
          </p>
          <p className={classNames(styles.detail)}>
            Built in {duration(snapshot.buildMs)} · saved in {duration(snapshot.saveMs)} · loaded in{' '}
            {duration(snapshot.loadMs)}
          </p>
        </>
      )}
    </section>
  );
}

function Counts({
  title,
  rows,
  counts,
  arrivesIn,
}: {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly counts: Readonly<Record<string, number>>;
  readonly arrivesIn: Readonly<Partial<Record<string, number>>>;
}) {
  const id = `graph-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className={classNames(styles.group)} aria-labelledby={id}>
      <h3 id={id} className={classNames(styles.title)}>
        {title}
      </h3>
      <dl className={classNames(styles.list)}>
        {rows.map(([key, label]) => {
          const value = counts[key] ?? 0;
          const phase = arrivesIn[key];
          return (
            <div key={key} className={classNames(styles.row)}>
              <dt className={classNames(styles.name)}>
                {label}
                {value === 0 && phase !== undefined && (
                  <span className={classNames(styles.meaning)}> arrives in phase {phase}</span>
                )}
              </dt>
              <dd className={classNames(styles.value)}>{count(value)}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
