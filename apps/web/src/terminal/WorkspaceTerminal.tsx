import '@xterm/xterm/css/xterm.css';
import { Button } from '@flowcanvas/ui';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { adoptInjectedStyles, styleFreeDocument, withoutInlineStyles } from './adopt-styles';
import { terminalFont, terminalTheme } from './theme';
import styles from './WorkspaceTerminal.module.css';

type Status =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'open'; readonly notice?: string }
  | { readonly kind: 'ended'; readonly code: number | null }
  | { readonly kind: 'failed' };

export const MESSAGES = {
  connecting: 'Connecting…',
  open: 'Connected to the workspace.',
  failed:
    'Couldn’t open the terminal. Check that the workspace is running, then start a new terminal.',
  ended: (code: number | null) =>
    code === null ? 'The terminal ended.' : `The terminal ended (exit code ${String(code)}).`,
} as const;

/** The terminal's WebSocket address on this page's own origin (ADR 0017). */
export function terminalUrl(
  location: Location,
  projectId: string,
  cols: number,
  rows: number,
): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/api/projects/${encodeURIComponent(projectId)}/workspace/terminal?cols=${String(cols)}&rows=${String(rows)}`;
}

interface WorkspaceTerminalProps {
  readonly projectId: string;
  readonly projectName: string;
  /** Replaces the browser's WebSocket in tests. */
  readonly openSocket?: (url: string) => WebSocket;
}

const browserSocket = (url: string) => new WebSocket(url);

/**
 * A shell in the project's running workspace (design brief, "18. Terminal and run manager", minimal until the
 * app shell). Bytes go both ways as binary frames; size changes and the exit code are JSON text frames.
 */
export function WorkspaceTerminal({
  projectId,
  projectName,
  openSocket = browserSocket,
}: WorkspaceTerminalProps) {
  const screen = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  // Bumped by "Start a new terminal" to open a fresh session.
  const [session, setSession] = useState(0);

  useEffect(() => {
    const element = screen.current;
    if (element === null) return;
    setStatus({ kind: 'connecting' });
    const stopAdopting = adoptInjectedStyles(element);
    const terminal = new Terminal({
      ...terminalFont(),
      theme: terminalTheme(),
      cursorBlink: true,
      scrollback: 5000,
      // No inline <style> elements for the CSP to block; adoptInjectedStyles applies their text (ADR 0017).
      documentOverride: styleFreeDocument(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    withoutInlineStyles(() => {
      terminal.open(element);
    });
    fit.fit();

    const socket = openSocket(
      terminalUrl(window.location, projectId, terminal.cols, terminal.rows),
    );
    socket.binaryType = 'arraybuffer';
    const encoder = new TextEncoder();
    let opened = false;
    let ended = false;
    const send = (data: string | Uint8Array<ArrayBuffer>) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    };

    socket.addEventListener('open', () => {
      opened = true;
      setStatus({ kind: 'open' });
      terminal.focus();
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      // Bytes; checked by tag rather than instanceof, which fails for buffers from another realm.
      if (Object.prototype.toString.call(event.data) === '[object ArrayBuffer]') {
        terminal.write(new Uint8Array(event.data as ArrayBuffer));
        return;
      }
      if (typeof event.data !== 'string') return;
      let control: { type?: unknown; code?: unknown; message?: unknown };
      try {
        control = JSON.parse(event.data) as typeof control;
      } catch {
        return;
      }
      if (control.type === 'exit') {
        ended = true;
        setStatus({ kind: 'ended', code: typeof control.code === 'number' ? control.code : null });
      } else if (control.type === 'error' && typeof control.message === 'string') {
        setStatus({ kind: 'open', notice: control.message });
      }
    });
    socket.addEventListener('close', () => {
      if (ended) return;
      setStatus(opened ? { kind: 'ended', code: null } : { kind: 'failed' });
    });

    const typing = terminal.onData((data) => {
      send(encoder.encode(data));
    });
    const resizing = terminal.onResize(({ cols, rows }) => {
      send(JSON.stringify({ type: 'resize', cols, rows }));
    });
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
      socket.close();
      terminal.dispose();
      stopAdopting();
    };
  }, [projectId, openSocket, session]);

  const message =
    status.kind === 'connecting'
      ? MESSAGES.connecting
      : status.kind === 'open'
        ? (status.notice ?? MESSAGES.open)
        : status.kind === 'ended'
          ? MESSAGES.ended(status.code)
          : MESSAGES.failed;

  return (
    <div className={styles.terminal}>
      <div className={styles.bar}>
        <p className={styles.status} role="status">
          {message}
        </p>
        {(status.kind === 'ended' || status.kind === 'failed') && (
          <Button
            kind="secondary"
            size="sm"
            onClick={() => {
              setSession((n) => n + 1);
            }}
          >
            Start a new terminal
          </Button>
        )}
      </div>
      <div ref={screen} className={styles.screen} aria-label={`Terminal for ${projectName}`} />
    </div>
  );
}
