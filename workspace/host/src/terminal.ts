// A terminal in a workspace (ADR 0017): bash on a pty, through the Docker Engine API, and the WebSocket that
// carries it. Binary frames are terminal bytes; text frames are JSON control messages.
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import type { Engine } from './engine.js';
import { HostError } from './errors.js';

export const TERMINAL_LIMITS = {
  cols: { min: 2, max: 500 },
  rows: { min: 2, max: 200 },
  /** Largest frame either way. Typing and pasting are far smaller; output is sent in chunks. */
  frameBytes: 64 * 1024,
} as const;

/** Control messages, as JSON text frames. */
export interface ClientControl {
  readonly type: 'resize';
  readonly cols: number;
  readonly rows: number;
}
export type ServerControl =
  | { readonly type: 'exit'; readonly code: number | null }
  | { readonly type: 'error'; readonly message: string };

export function checkSize(
  cols: unknown,
  rows: unknown,
): { cols: number; rows: number } | undefined {
  const fits = (value: unknown, range: { min: number; max: number }): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max;
  return fits(cols, TERMINAL_LIMITS.cols) && fits(rows, TERMINAL_LIMITS.rows)
    ? { cols, rows }
    : undefined;
}

export function parseControl(text: string): ClientControl | undefined {
  try {
    const message = JSON.parse(text) as { type?: unknown; cols?: unknown; rows?: unknown };
    const size = message.type === 'resize' ? checkSize(message.cols, message.rows) : undefined;
    return size === undefined ? undefined : { type: 'resize', ...size };
  } catch {
    return undefined;
  }
}

export interface TerminalSession {
  readonly stream: Duplex;
  resize(cols: number, rows: number): Promise<void>;
  exitCode(): Promise<number | null>;
}

/** Starts `bash -l` on a pty in the container, as the workspace user. */
export async function openTerminal(
  engine: Engine,
  ref: string,
  options: { cols: number; rows: number; cwd: string },
): Promise<TerminalSession> {
  const created = await engine.json('POST', `/containers/${encodeURIComponent(ref)}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: ['bash', '-l'],
    Env: ['TERM=xterm-256color', 'COLORTERM=truecolor'],
    WorkingDir: options.cwd,
    User: '1000:1000',
    ConsoleSize: [options.rows, options.cols],
  });
  const id = (created.body as { Id?: unknown } | undefined)?.Id;
  if (created.status !== 201 || typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) {
    throw new HostError('failed', 'The terminal could not be started.');
  }
  const stream = await engine.upgrade(`/exec/${id}/start`, { Detach: false, Tty: true });
  return {
    stream,
    resize: async (cols, rows) => {
      await engine.json('POST', `/exec/${id}/resize?h=${String(rows)}&w=${String(cols)}`);
    },
    exitCode: async () => {
      const inspected = await engine.json('GET', `/exec/${id}/json`);
      const code = (inspected.body as { ExitCode?: unknown } | undefined)?.ExitCode;
      return typeof code === 'number' ? code : null;
    },
  };
}

/** Carries one terminal session over one WebSocket, until either side ends. */
export function relayTerminal(
  socket: WebSocket,
  session: TerminalSession,
  log: (line: string) => void,
): void {
  const send = (control: ServerControl) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(control));
  };
  let ended = false;
  const end = async () => {
    if (ended) return;
    ended = true;
    send({ type: 'exit', code: await session.exitCode().catch(() => null) });
    socket.close(1000, 'terminal ended');
  };

  session.stream.on('data', (chunk: Buffer) => {
    for (let start = 0; start < chunk.length; start += TERMINAL_LIMITS.frameBytes) {
      if (socket.readyState === socket.OPEN) {
        socket.send(chunk.subarray(start, start + TERMINAL_LIMITS.frameBytes), { binary: true });
      }
    }
  });
  session.stream.on('end', () => void end());
  session.stream.on('error', () => void end());

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      session.stream.write(data);
      return;
    }
    const control = parseControl(data.toString('utf8'));
    if (control === undefined) {
      send({ type: 'error', message: 'Unknown control message.' });
      return;
    }
    session.resize(control.cols, control.rows).catch(() => {
      log('terminal resize failed');
    });
  });
  // The page went away: closing the stream hangs up the shell.
  socket.on('close', () => {
    ended = true;
    session.stream.destroy();
  });
}
