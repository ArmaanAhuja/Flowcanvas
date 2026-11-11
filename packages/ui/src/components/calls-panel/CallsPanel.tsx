import { ChevronRight } from 'lucide-react';
import { Button, Disclosure, DisclosurePanel, Heading } from 'react-aria-components';
import { classNames } from '../../class-names';
import { Tabs } from '../tabs/Tabs';
import styles from './CallsPanel.module.css';

/** A place in the project: a project-relative path and a 1-based line and column. */
export interface CallPlace {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

export type CallsView = 'callers' | 'callees' | 'references';

/** One caller or callee, as the engine reports it (phase 5, ADR 0026). */
export interface CallRow {
  readonly id: string;
  readonly name: string;
  /** The kind in words: "Function", "Component", "Method"… */
  readonly kindLabel: string | null;
  /** The class or namespace it sits in. */
  readonly container: string | null;
  readonly relation: 'calls' | 'renders';
  /** How it's known (CLAUDE.md rule 4): proven by the compiler, or not. */
  readonly provenance: 'resolved' | 'unresolved';
  /** TypeScript's standard library: resolved, but not the project's code. */
  readonly builtIn: boolean;
  /** Where it's declared; null when unresolved or built in. */
  readonly place: CallPlace | null;
  /** Where the calls happen. */
  readonly sites: readonly CallPlace[];
}

export interface ReferenceRow extends CallPlace {
  readonly isDefinition: boolean;
}

export interface CallsPanelProps {
  readonly view: CallsView;
  readonly onViewChange: (view: CallsView) => void;
  /** What's being looked at; null before anything has been asked. */
  readonly target: {
    readonly name: string;
    readonly kindLabel: string | null;
    readonly place: CallPlace | null;
  } | null;
  readonly status: 'idle' | 'loading' | 'ready';
  readonly rows: readonly CallRow[];
  readonly references: readonly ReferenceRow[];
  /** Said above the list: a partial answer, a project too large, no workspace… */
  readonly message?: string | null | undefined;
  /** Opens a place in the Code view. */
  readonly onOpen: (place: CallPlace) => void;
}

const VIEWS: readonly { id: CallsView; label: string }[] = [
  { id: 'callers', label: 'Callers' },
  { id: 'callees', label: 'Callees' },
  { id: 'references', label: 'References' },
];

const where = (place: CallPlace) => `${place.path}:${String(place.line)}`;

/**
 * The right panel's Calls tab (Figma's inspector; the brief's "Connections"; owner, 12 Nov 2026): who calls or
 * renders the function, what it calls or renders, and where it's referenced. Every row says how it's known: a solid
 * line for resolved, an open stub ending in a hollow circle for unresolved (Graphite's form channel), and the word.
 * Callees come in groups: the project's, unresolved, and built-in (collapsed), as the owner decided.
 */
export function CallsPanel({
  view,
  onViewChange,
  target,
  status,
  rows,
  references,
  message,
  onOpen,
}: CallsPanelProps) {
  const project = rows.filter((r) => r.provenance === 'resolved' && !r.builtIn);
  const unresolved = rows.filter((r) => r.provenance === 'unresolved');
  const builtIn = rows.filter((r) => r.builtIn);
  return (
    <section className={classNames(styles.panel)} aria-label="Calls">
      <Tabs
        aria-label="Show"
        variant="segmented"
        items={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
        value={view}
        onValueChange={(id) => {
          if (id === 'callers' || id === 'callees' || id === 'references') onViewChange(id);
        }}
      />
      {target === null ? (
        <p className={classNames(styles.empty)}>
          Right-click a function in the Code view, then choose Callers, Callees or Find references.
        </p>
      ) : (
        <header className={classNames(styles.target)}>
          <span className={classNames(styles.targetName)}>{target.name}</span>
          {target.kindLabel !== null && (
            <span className={classNames(styles.kind)}>{target.kindLabel}</span>
          )}
          {target.place !== null && (
            <button
              type="button"
              className={classNames(styles.place)}
              onClick={() => {
                if (target.place !== null) onOpen(target.place);
              }}
            >
              {where(target.place)}
            </button>
          )}
        </header>
      )}
      {status === 'loading' && (
        <p className={classNames(styles.note)} role="status">
          Asking TypeScript…
        </p>
      )}
      {status === 'ready' && message !== null && message !== undefined && (
        <p className={classNames(styles.note)} role="status">
          {message}
        </p>
      )}
      {status === 'ready' && target !== null && view !== 'references' && (
        <>
          {view === 'callers' ? (
            <Group rows={project} empty="No callers in the project." onOpen={onOpen} opens="site" />
          ) : (
            <>
              <Group
                rows={project}
                empty="It calls nothing in the project."
                onOpen={onOpen}
                opens="place"
              />
              {unresolved.length > 0 && (
                <section className={classNames(styles.group)} aria-labelledby="calls-unresolved">
                  <h3 id="calls-unresolved" className={classNames(styles.groupTitle)}>
                    Unresolved ({unresolved.length})
                  </h3>
                  <p className={classNames(styles.groupNote)}>
                    TypeScript couldn’t find what these call: a package that isn’t installed, or a
                    call built at run time. Nothing is guessed.
                  </p>
                  <Group rows={unresolved} empty="" onOpen={onOpen} opens="site" />
                </section>
              )}
              {builtIn.length > 0 && (
                <Disclosure className={classNames(styles.group)}>
                  <Heading level={3} className={classNames(styles.groupTitle)}>
                    <Button slot="trigger" className={classNames(styles.disclosure)}>
                      <ChevronRight
                        size={14}
                        aria-hidden="true"
                        className={classNames(styles.chevron)}
                      />
                      Built-in ({builtIn.length})
                    </Button>
                  </Heading>
                  <DisclosurePanel>
                    <Group rows={builtIn} empty="" onOpen={onOpen} opens="site" />
                  </DisclosurePanel>
                </Disclosure>
              )}
            </>
          )}
        </>
      )}
      {status === 'ready' && target !== null && view === 'references' && (
        <References rows={references} onOpen={onOpen} />
      )}
    </section>
  );
}

/** A list of callers or callees. `opens`: where a click goes, the call's site or the declaration. */
function Group({
  rows,
  empty,
  onOpen,
  opens,
}: {
  readonly rows: readonly CallRow[];
  readonly empty: string;
  readonly onOpen: (place: CallPlace) => void;
  readonly opens: 'site' | 'place';
}) {
  if (rows.length === 0) {
    return empty === '' ? null : <p className={classNames(styles.empty)}>{empty}</p>;
  }
  return (
    <ul className={classNames(styles.list)}>
      {rows.map((row) => {
        const destination =
          opens === 'place' ? (row.place ?? row.sites[0]) : (row.sites[0] ?? row.place);
        const shown = opens === 'place' ? row.place : (row.sites[0] ?? null);
        const label = [
          row.name,
          row.relation,
          row.provenance,
          row.builtIn ? 'built-in' : null,
          shown === null ? null : where(shown),
        ]
          .filter((part) => part !== null)
          .join(', ');
        return (
          <li key={row.id} className={classNames(styles.item)}>
            <button
              type="button"
              className={classNames(styles.row)}
              aria-label={label}
              disabled={destination === undefined || destination === null}
              onClick={() => {
                if (destination !== undefined && destination !== null) onOpen(destination);
              }}
            >
              <Provenance resolved={row.provenance === 'resolved'} />
              <span className={classNames(styles.name)}>{row.name}</span>
              <span className={classNames(styles.relation)}>{row.relation}</span>
              {row.kindLabel !== null && (
                <span className={classNames(styles.kind)}>{row.kindLabel}</span>
              )}
              {shown !== null && <span className={classNames(styles.where)}>{where(shown)}</span>}
            </button>
            {row.sites.length > 1 && (
              <span className={classNames(styles.more)}>
                {row.sites.length} places:{' '}
                {row.sites.slice(1, 6).map((site) => (
                  <button
                    key={where(site)}
                    type="button"
                    className={classNames(styles.siteLink)}
                    onClick={() => {
                      onOpen(site);
                    }}
                  >
                    line {site.line}
                  </button>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function References({
  rows,
  onOpen,
}: {
  readonly rows: readonly ReferenceRow[];
  readonly onOpen: (place: CallPlace) => void;
}) {
  if (rows.length === 0)
    return <p className={classNames(styles.empty)}>No references in the project.</p>;
  return (
    <ul className={classNames(styles.list)}>
      {rows.map((row) => (
        <li
          key={`${row.path}:${String(row.line)}:${String(row.column)}`}
          className={classNames(styles.item)}
        >
          <button
            type="button"
            className={classNames(styles.row)}
            aria-label={`${where(row)}${row.isDefinition ? ', definition' : ''}`}
            onClick={() => {
              onOpen(row);
            }}
          >
            <span className={classNames(styles.where, styles.wide)}>{where(row)}</span>
            {row.isDefinition && <span className={classNames(styles.kind)}>definition</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Graphite's provenance by form: a solid line (resolved), or an open stub ending in a hollow circle (unknown). */
function Provenance({ resolved }: { readonly resolved: boolean }) {
  return (
    <svg className={classNames(styles.provenance)} viewBox="0 0 16 8" aria-hidden="true">
      {resolved ? (
        <line x1="1" y1="4" x2="15" y2="4" />
      ) : (
        <>
          <line x1="1" y1="4" x2="9" y2="4" />
          <circle cx="12" cy="4" r="2.5" />
        </>
      )}
    </svg>
  );
}
