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
  // The background lane is a frame: never selected (it isn't selectable).
  if (selected.type === 'lane') return null;
  if (selected.type === 'group') {
    const { title, count, members } = selected.data;
    return (
      <section className={styles.inspector} aria-label={`Group ${title}`}>
        <p className={styles.caption}>Group</p>
        <p
          className={styles.title}
        >{`${title} · ${String(count)} ${count === 1 ? 'node' : 'nodes'}`}</p>
        <ul className={styles.list} aria-label="Group members">
          {members.map((m) => (
            <li key={m.id} className={styles.row}>
              <span className={styles.code}>{m.name}</span>
              <span className={styles.outcome}>{m.location}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const { place, title } = selected.data;
  const node = flow.nodes.find((n) => n.id === selected.data.id);
  if (node !== undefined && (node.data ?? node.service ?? node.handoff) !== undefined) {
    return <ConnectionDetails flow={flow} node={node} titleOf={titleOf} onOpen={onOpen} />;
  }
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

const LIBRARY_NAMES: Readonly<Record<string, string>> = {
  prisma: 'Prisma',
  kysely: 'Kysely',
  sql: 'SQL',
  mongoose: 'Mongoose',
  typeorm: 'TypeORM',
};
const SERVICE_KINDS = {
  email: 'Email',
  payments: 'Payments',
  storage: 'Storage',
  ai: 'AI',
  http: 'HTTP',
} as const;
const HANDOFF_KINDS = {
  queue: 'Queue',
  job: 'Job',
  cron: 'Schedule',
  event: 'Event',
  timer: 'Timer',
  websocket: 'WebSocket',
} as const;

/**
 * A table, an outside service or a hand-off (phases 9 to 11; design brief, "Node inspector": Data access, External
 * service, Queue or job): what the code fixes of it, how it's known, why when it isn't fully, and where in this flow it's
 * reached from, each opening its line.
 */
function ConnectionDetails({
  flow,
  node,
  titleOf,
  onOpen,
}: {
  readonly flow: Flow;
  readonly node: Flow['nodes'][number];
  readonly titleOf: (id: string) => string;
  readonly onOpen: (place: CodePosition) => void;
}) {
  const facts: [string, string][] = [];
  let caption = '';
  let complete = true;
  let why: string | null = null;
  if (node.data !== undefined) {
    caption = 'Data access';
    facts.push(
      [node.data.library === 'mongoose' ? 'Model' : 'Table', node.data.table ?? 'Not known'],
      ['Access', node.data.operation === 'write' ? 'Write' : 'Read'],
      ['Library', LIBRARY_NAMES[node.data.library] ?? node.data.library],
    );
    ({ complete, why } = node.data);
  } else if (node.service !== undefined) {
    caption = 'External service';
    facts.push(['Service', SERVICE_KINDS[node.service.kind]], ['Package', node.service.library]);
    if (node.service.url !== null) facts.push(['URL', node.service.url]);
    ({ complete, why } = node.service);
  } else if (node.handoff !== undefined) {
    caption = 'Async hand-off';
    facts.push(
      ['Kind', HANDOFF_KINDS[node.handoff.kind]],
      ['Name', node.handoff.name ?? 'Not known'],
      ['Found by', node.handoff.library],
    );
    ({ complete, why } = node.handoff);
  }
  const into = flow.edges.filter((edge) => edge.to === node.id);
  const onward = flow.edges.filter((edge) => edge.from === node.id);
  return (
    <section className={styles.inspector} aria-label={node.name}>
      <p className={styles.caption}>{caption}</p>
      <p className={styles.title}>{node.name}</p>
      <dl className={styles.facts}>
        {facts.map(([term, value]) => (
          <div key={term} className={styles.fact}>
            <dt className={styles.caption}>{term}</dt>
            <dd className={styles.code}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>
        {complete
          ? 'Known by a library’s rule (convention): matched from the code, not seen running.'
          : `Not fully detected: ${why ?? ''}`}
      </p>
      {into.length > 0 && (
        <>
          <p className={styles.caption}>Reached from</p>
          <ul className={styles.list} aria-label="Reached from">
            {into.map((edge) => (
              <li key={`${edge.from}:${edge.kind}`} className={styles.row}>
                <span className={styles.code}>{titleOf(edge.from)}</span>
                {edge.lines[0] !== undefined && edge.from.includes('#') && (
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => {
                      onOpen({ path: pathOf(edge.from), line: edge.lines[0] ?? 1, column: 1 });
                    }}
                  >
                    {String(edge.lines[0])}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {onward.length > 0 && (
        <>
          <p className={styles.caption}>Handled by</p>
          <ul className={styles.list} aria-label="Handled by">
            {onward.map((edge) => (
              <li key={edge.to} className={styles.row}>
                <span className={styles.code}>{titleOf(edge.to)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
