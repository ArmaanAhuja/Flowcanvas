// The integrated terminal (build plan v2, phase 3): the person's own shell on a pty in the project's folder, carried
// over a WebSocket as the workspaces' terminals were (ADR 0017): binary frames are bytes, text frames JSON control
// messages. It's theirs, like any terminal: what they type and see isn't logged.
import {
  parseControl,
  TERMINAL_LIMITS,
  type ServerControl,
} from '@flowcanvas/workspace-host/protocol';
import type { WebSocket } from 'ws';
import { childEnvironment, loadNodePty } from './processes.js';

/** What the relay needs from a pty (node-pty's IPty, narrowed so tests can pass their own). */
export interface Pty {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (exit: { exitCode: number }) => void): { dispose(): void };
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type OpenPty = (options: { cwd: string; cols: number; rows: number }) => Pty;

/** The person's login shell, else bash. */
export function shell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL !== undefined && env.SHELL !== '' ? env.SHELL : '/bin/bash';
}

/** node-pty, loaded only when a terminal opens (it's a native module). */
export const nodePty: OpenPty = ({ cwd, cols, rows }) => {
  return loadNodePty().spawn(shell(), ['-l'], {
    name: 'xterm-256color',
    cwd,
    cols,
    rows,
    env: { ...childEnvironment(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
};

/** Carries one pty over one WebSocket, until either side ends. */
export function relayPty(socket: WebSocket, pty: Pty): void {
  const send = (control: ServerControl) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(control));
  };
  let ended = false;
  const output = pty.onData((data) => {
    const bytes = Buffer.from(data, 'utf8');
    for (let start = 0; start < bytes.length; start += TERMINAL_LIMITS.frameBytes) {
      if (socket.readyState === socket.OPEN) {
        socket.send(bytes.subarray(start, start + TERMINAL_LIMITS.frameBytes), { binary: true });
      }
    }
  });
  const exit = pty.onExit(({ exitCode }) => {
    ended = true;
    send({ type: 'exit', code: exitCode });
    socket.close(1000, 'terminal ended');
  });
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (data.length > TERMINAL_LIMITS.frameBytes) {
        send({ type: 'error', message: 'That was too much at once.' });
        return;
      }
      pty.write(data.toString('utf8'));
      return;
    }
    const control = data.length <= 1024 ? parseControl(data.toString('utf8')) : undefined;
    if (control === undefined) {
      send({ type: 'error', message: 'Unknown control message.' });
      return;
    }
    pty.resize(control.cols, control.rows);
  });
  // The page went away: the shell is hung up, as closing a terminal window does.
  socket.on('close', () => {
    output.dispose();
    exit.dispose();
    if (!ended) pty.kill();
  });
}
