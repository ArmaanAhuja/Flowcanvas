// The right panel (Figma's inspector, phase 5): Details, Runs and Changes as on Figma, with Calls working now.
import { CallsPanel, Tabs, type CallPlace, type CallsView } from '@flowcanvas/ui';
import { useEffect, useRef, useState } from 'react';
import { useShell } from '../shell/Shell';
import type { CallsState } from '../symbols/useCalls';
import styles from './ProjectPage.module.css';

const LATER = 'Arrives in a later phase';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'runs', label: 'Runs', disabled: true, hint: LATER },
  { id: 'changes', label: 'Changes', disabled: true, hint: LATER },
  { id: 'calls', label: 'Calls' },
];

type InspectorTab = 'details' | 'calls';

/**
 * Lives inside the Shell, so a question (a right-click → Callers, Shift+F12) brings the panel into view on the Calls
 * tab, even when it was closed.
 */
export function Inspector({
  calls,
  emptyDetails,
  onViewChange,
  onOpen,
}: {
  readonly calls: CallsState;
  readonly emptyDetails: string;
  readonly onViewChange: (view: CallsView) => void;
  readonly onOpen: (place: CallPlace) => void;
}) {
  const { setOpen } = useShell();
  const [tab, setTab] = useState<InspectorTab>('details');
  const seen = useRef(calls.asked);
  useEffect(() => {
    if (calls.asked === seen.current) return;
    seen.current = calls.asked;
    setTab('calls');
    setOpen('right', true);
  }, [calls.asked, setOpen]);

  return (
    <section className={styles.panel} aria-labelledby="inspector">
      <h2 id="inspector" className={styles.panelTitle}>
        Inspector
      </h2>
      <Tabs
        aria-label="Inspector"
        items={TABS}
        value={tab}
        onValueChange={(id) => {
          if (id === 'details' || id === 'calls') setTab(id);
        }}
        renderPanel={(id) =>
          id === 'calls' ? (
            <CallsPanel
              view={calls.view}
              onViewChange={onViewChange}
              target={calls.target}
              status={calls.status}
              rows={calls.rows}
              references={calls.references}
              message={calls.message}
              onOpen={onOpen}
            />
          ) : (
            <p className={styles.empty}>{emptyDetails}</p>
          )
        }
      />
    </section>
  );
}
