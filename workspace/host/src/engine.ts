// The few Docker Engine API calls the CLI can't do for us: an exec with a pty, its resizing and its exit code
// (ADR 0017). Over Docker's own Unix socket; paths and bodies are built here from checked values only.
import { request as httpRequest } from 'node:http';
import type { Duplex } from 'node:stream';
import { HostError } from './errors.js';
import { DOCKER_DOWN } from './docker-cli.js';

export interface Engine {
  json(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }>;
  /** Starts a request that Docker answers by switching to a raw two-way stream. */
  upgrade(path: string, body: unknown): Promise<Duplex>;
}

/** `DOCKER_HOST` when it's a Unix socket, else Docker's usual one. */
export function dockerSocket(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.DOCKER_HOST ?? '';
  return host.startsWith('unix://') ? host.slice('unix://'.length) : '/var/run/docker.sock';
}

export function socketEngine(socketPath: string = dockerSocket()): Engine {
  const unreachable = () => new HostError('unavailable', DOCKER_DOWN);
  return {
    json: (method, path, body) =>
      new Promise((resolve, reject) => {
        const request = httpRequest(
          { socketPath, method, path, headers: { 'content-type': 'application/json' } },
          (response) => {
            let text = '';
            response.on('data', (chunk: Buffer) => (text += chunk.toString()));
            response.on('end', () => {
              let parsed: unknown = text;
              try {
                parsed = text === '' ? undefined : (JSON.parse(text) as unknown);
              } catch {
                // Plain text, e.g. an error message.
              }
              resolve({ status: response.statusCode ?? 0, body: parsed });
            });
          },
        );
        request.on('error', () => {
          reject(unreachable());
        });
        request.end(body === undefined ? undefined : JSON.stringify(body));
      }),
    upgrade: (path, body) =>
      new Promise((resolve, reject) => {
        const request = httpRequest({
          socketPath,
          method: 'POST',
          path,
          headers: { 'content-type': 'application/json', connection: 'Upgrade', upgrade: 'tcp' },
        });
        request.on('upgrade', (_response, socket) => {
          resolve(socket);
        });
        request.on('response', (response) => {
          response.resume();
          reject(new HostError('failed', 'The terminal could not be started.'));
        });
        request.on('error', () => {
          reject(unreachable());
        });
        request.end(JSON.stringify(body));
      }),
  };
}
