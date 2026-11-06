// A terminal in a workspace (ADR 0017): bash on a pty, through the Docker Engine API, and the WebSocket that
// carries it. Binary frames are terminal bytes; text frames are JSON control messages.
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import type { Engine } from './engine.js';
import { HostError } from './errors.js';
import { TERMINAL_LIMITS, parseControl, type ServerControl } from './protocol.js';

export {
  TERMINAL_LIMITS,
  checkSize,
  parseControl,
  type ClientControl,
  type ServerControl,
} from './protocol.js';

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
