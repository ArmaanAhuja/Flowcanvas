import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import {
  adoptInjectedStyles,
  styleFreeDocument,
  withoutInlineStyles,
} from '../terminal/adopt-styles';
import { terminalFont, terminalTheme } from '../terminal/theme';
import type { RunControl } from './useRun';
import styles from './RunPanel.module.css';

/**
 * A process card's output (build plan v2, phase 3), as its terminal would show it: colours, progress lines, and a
 * prompt the person can answer by typing here while it runs.
 */
export function ProcessOutput({
  id,
  label,
  running,
  run,
}: {
  readonly id: string;
  readonly label: string;
  readonly running: boolean;
  readonly run: Pick<RunControl, 'follow' | 'input' | 'resize'>;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const live = useRef(running);
  live.current = running;
  const control = useRef(run);
  control.current = run;

  useEffect(() => {
    const element = screen.current;
    if (element === null) return;
    const stopAdopting = adoptInjectedStyles(element);
    const terminal = new Terminal({
      ...terminalFont(),
      theme: terminalTheme(),
      scrollback: 5000,
      convertEol: false,
      disableStdin: false,
      cursorBlink: false,
      documentOverride: styleFreeDocument(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    withoutInlineStyles(() => {
      terminal.open(element);
    });
    fit.fit();
    const unfollow = control.current.follow(id, (text) => {
      terminal.write(text);
    });
    const typing = terminal.onData((data) => {
      if (live.current) control.current.input(id, data);
    });
    const resizing = terminal.onResize(({ cols, rows }) => {
      control.current.resize(id, cols, rows);
    });
    control.current.resize(id, terminal.cols, terminal.rows);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            fit.fit();
          });
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      typing.dispose();
      resizing.dispose();
      unfollow();
      terminal.dispose();
      stopAdopting();
    };
  }, [id]);

  return <div ref={screen} className={styles.output} aria-label={`Output of ${label}`} />;
}
