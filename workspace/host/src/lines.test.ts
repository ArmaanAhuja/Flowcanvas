// The JSON-lines connection shared by the agent and the engine: what happens when the process in the workspace
// goes away mid-write (found by CI, phase 4: an EPIPE on stdin was an uncaught exception, which in the real host
// would end the host process).
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { HostError } from './errors.js';
import { LineConnection, type LineProtocol, type WorkspaceProcess } from './lines.js';

const protocol: LineProtocol<{ op: string }, { ok: boolean }> = {
  version: 1,
  maxLineBytes: 1024,
  timeoutMs: () => 5000,
  check: (_request, body): body is { ok: boolean } => typeof body === 'object' && body !== null,
  messages: { stopped: 'It stopped.', noAnswer: 'No answer.', badAnswer: 'Bad answer.' },
};

/** A process whose stdin fails every write with EPIPE, as a pipe to a process that has just exited does. */
function brokenPipe(): WorkspaceProcess {
  const stdin = new Writable({
    write(_chunk, _encoding, done) {
      done(
        Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' }),
      );
    },
  });
  return {
    stdin,
    stdout: new PassThrough(),
    kill: () => undefined,
    onExit: () => undefined,
  };
}

describe('LineConnection', () => {
  it('treats a broken pipe as the process having stopped: the request fails, nothing is thrown', async () => {
    let closed = 0;
    const connection = new LineConnection(brokenPipe(), protocol, () => {
      closed += 1;
    });
    await expect(connection.call({ op: 'status' })).rejects.toEqual(
      new HostError('failed', 'It stopped.'),
    );
    expect(connection.closed).toBe(true);
    expect(closed).toBe(1);
    // Later calls fail at once, without writing.
    await expect(connection.call({ op: 'status' })).rejects.toEqual(
      new HostError('failed', 'It stopped.'),
    );
  });
});
