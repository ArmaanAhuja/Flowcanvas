// The flow's line at the canvas's top left (Figma 06): what it's from, and the completeness pill's counts. Says so
// when it's from the last version (the graph catching up with changes) or covers part of the project only.
import type { FlowResult } from '@flowcanvas/engine/protocol';
import { completenessText } from '@flowcanvas/ui';
import styles from './FlowStatus.module.css';

export function FlowStatus({ result }: { readonly result: FlowResult }) {
  const { flow } = result;
  if (flow === null) return null;
  const root = flow.nodes.find((node) => node.id === flow.root)?.name ?? flow.root;
  const notes = [
    result.current ? null : 'From the last version: the graph is catching up with your changes.',
    result.complete ? null : 'From part of the project only.',
    result.message,
  ].filter((note): note is string => note !== null);
  return (
    <div className={styles.status} role="status">
      <p className={styles.line}>
        <span className={styles.root}>{root}</span>
        <span className={styles.counts}>{completenessText(flow.byProvenance)}</span>
      </p>
      {notes.map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}
    </div>
  );
}
