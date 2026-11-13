// The inspector's Details for what's selected in a flow (phase 7; design brief, "Node inspector"): a function's
// details as its code reveals them, a decision's condition and where each outcome leads, and the open ends.
import type { CodePosition, FlowResult } from '@flowcanvas/engine/protocol';
import { Button, NodeDetails } from '@flowcanvas/ui';
import type { CanvasNode } from '../canvas/FlowCanvas';
import styles from './FlowInspector.module.css';
import type { DetailsState } from './useFlow';

type Flow = NonNullable<FlowResult['flow']>;

export interface FlowInspectorProps {
  readonly flow: Flow;
  readonly selected: CanvasNode;
  readonly details: DetailsState;
  readonly onOpen: (place: CodePosition) => void;
}

const where = (place: CodePosition) => `${place.path}:${String(place.line)}`;
const pathOf = (id: string) => id.slice(0, id.indexOf('#'));

export function FlowInspector({ flow, selected, details, onOpen }: FlowInspectorProps) {
  const titleOf = (id: string) => flow.nodes.find((node) => node.id === id)?.name ?? id;
  if (selected.type === 'decision') {
    const outcomes = flow.edges.filter((edge) => edge.from === selected.data.id);
    const { place } = selected.data;
    return (
      <section className={styles.inspector} aria-label="Decision">
        <p className={styles.caption}>Decision</p>
        <p className={styles.code}>{selected.data.condition}</p>
        {place !== null && <Header place={place} onOpen={onOpen} />}
        {outcomes.length > 0 && (
          <ul className={styles.list} aria-label="Outcomes">
            {outcomes.map((edge) => (
              <li key={`${edge.to}:${edge.label ?? ''}`} className={styles.row}>
                <span className={styles.outcome}>{edge.label ?? 'then'}</span>
                <span className={styles.code}>{titleOf(edge.to)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  if (selected.type === 'stub') {
    const { from, variant, count } = selected.data;
    if (variant === 'more') {
      return (
        <section className={styles.inspector} aria-label="Not shown">
          <p className={styles.title}>{`${count.toLocaleString('en-US')} more calls not shown`}</p>
          <p className={styles.note}>
            {`The flow shows its first ${String(flow.nodes.length)} nodes, nearest first. Expanding a flow arrives in phase 12.`}
          </p>
        </section>
      );
    }
    const group = flow.unknown.find((g) => g.from === from);
    const path = pathOf(from);
    return (
      <section className={styles.inspector} aria-label="Unknown calls">
        <p
          className={styles.title}
        >{`${count.toLocaleString('en-US')} unknown ${count === 1 ? 'call' : 'calls'}`}</p>
        <p className={styles.note}>
          {`From ${titleOf(from)}: calls whose target wasn't found in the project, as written.`}
        </p>
        <ul className={styles.list}>
          {(group?.calls ?? []).map((call) => (
            <li key={`${call.target}:${call.label ?? ''}`} className={styles.row}>
              <span className={styles.code}>{call.target}</span>
              {call.label !== null && <span className={styles.outcome}>{call.label}</span>}
              {call.lines[0] !== undefined && (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    onOpen({ path, line: call.lines[0] ?? 1, column: 1 });
                  }}
                >
                  {String(call.lines[0])}
                </button>
              )}
            </li>
          ))}
        </ul>
        {group !== undefined && group.total > group.calls.length && (
          <p className={styles.note}>
            {`and ${(group.total - group.calls.length).toLocaleString('en-US')} more, in the code`}
          </p>
        )}
      </section>
    );
  }
  const { place, title } = selected.data;
  return (
    <section className={styles.inspector} aria-label={title}>
      <p className={styles.title}>{title}</p>
      {place != null && <Header place={place} onOpen={onOpen} />}
      {details.kind === 'loading' && (
        <p className={styles.note} role="status">
          Reading the code…
        </p>
      )}
      {details.kind === 'problem' && (
        <p className={styles.note} role="status">
          {details.message}
        </p>
      )}
      {details.kind === 'ready' &&
        (details.result.details === null ? (
          <p className={styles.note} role="status">
            {details.result.message ?? 'Nothing to show for this.'}
          </p>
        ) : (
          place != null && (
            <NodeDetails
              details={details.result.details}
              path={place.path}
              onOpenLine={(line) => {
                onOpen({ path: place.path, line, column: 1 });
              }}
            />
          )
        ))}
    </section>
  );
}

function Header({
  place,
  onOpen,
}: {
  readonly place: CodePosition;
  readonly onOpen: (place: CodePosition) => void;
}) {
  return (
    <div className={styles.header}>
      <button
        type="button"
        className={styles.link}
        onClick={() => {
          onOpen(place);
        }}
      >
        {where(place)}
      </button>
      <Button
        onClick={() => {
          onOpen(place);
        }}
      >
        Open code
      </Button>
    </div>
  );
}
