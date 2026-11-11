// Running the Docker CLI. Arguments are always an array (never a shell string), so nothing in them is
// interpreted by a shell; the callers build them from checked names only (workspace-image's spec.ts).
import { execFile } from 'node:child_process';
import { HostError } from './errors.js';

export interface DockerResult {
  readonly stdout: string;
}

/** Runs `docker <args>`. Rejects with DockerFailure when the command fails, HostError when Docker isn't there. */
export type Docker = (
  args: readonly string[],
  options?: { timeoutMs?: number; input?: string | Buffer },
) => Promise<DockerResult>;

/** A failed docker command, for the host's own decisions and logs; never shown to the person as is. */
export class DockerFailure extends Error {
  override readonly name = 'DockerFailure';
  constructor(
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`docker exited with ${String(exitCode)}: ${stderr.slice(0, 500)}`);
  }

  /** Docker's words for "that container, network or volume doesn't exist". */
  get missing(): boolean {
    return /no such (object|container|network|volume)|not found/i.test(this.stderr);
  }
}

export const DOCKER_DOWN = "Docker isn't running on this computer. Start Docker, then try again.";

export const dockerCli: Docker = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      [...args],
      { timeout: options.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout: stdout.trim() });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || /Cannot connect to the Docker daemon/i.test(stderr)) {
          reject(new HostError('unavailable', DOCKER_DOWN));
          return;
        }
        reject(new DockerFailure(typeof code === 'number' ? code : null, stderr));
      },
    );
    // Content for the command's stdin (e.g. the agent's files), so it never goes on a command line.
    child.stdin?.end(options.input);
  });
