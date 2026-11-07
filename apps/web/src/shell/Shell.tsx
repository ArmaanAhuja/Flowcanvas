import type { ReactNode } from 'react';
import styles from './Shell.module.css';

export interface ShellProps {
  readonly topBar: ReactNode;
  readonly rail: ReactNode;
  readonly left: ReactNode;
  readonly canvas: ReactNode;
  readonly right: ReactNode;
  readonly review: ReactNode;
}

/**
 * The project's window (design brief, "Main canvas workspace"; Figma 06): top bar, rail, left panel, canvas,
 * right panel and review bar, at Figma's sizes (tokens `size.bar`, `size.rail`, `size.panel.*`). Each region
 * is a landmark, so screen-reader users can move between them.
 */
export function Shell({ topBar, rail, left, canvas, right, review }: ShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.topBar} data-region="top-bar">
        {topBar}
      </header>
      <nav className={styles.rail} aria-label="Tools" data-region="rail">
        {rail}
      </nav>
      <aside className={styles.left} aria-label="Left panel" data-region="left-panel">
        {left}
      </aside>
      <main className={styles.canvas} aria-label="Canvas" data-region="canvas">
        {canvas}
      </main>
      <aside className={styles.right} aria-label="Right panel" data-region="right-panel">
        {right}
      </aside>
      <footer className={styles.review} aria-label="Review" data-region="review-bar">
        {review}
      </footer>
    </div>
  );
}
