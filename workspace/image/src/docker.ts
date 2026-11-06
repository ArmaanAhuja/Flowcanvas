// Building the image with the Docker CLI. Used by `pnpm workspace:image`, the Docker tests and, later,
// the workspace host when the image for the current Dockerfile is missing.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DOCKERFILE_URL, imageTag } from './spec.js';

const run = promisify(execFile);

export async function imageExists(tag: string = imageTag()): Promise<boolean> {
  try {
    await run('docker', ['image', 'inspect', '--format', '{{.Id}}', tag]);
    return true;
  } catch {
    return false;
  }
}

/** Builds the image unless this Dockerfile's tag already exists. Returns the tag. */
export async function buildImage(options: { force?: boolean } = {}): Promise<string> {
  const tag = imageTag();
  if (!options.force && (await imageExists(tag))) return tag;
  const dockerfile = fileURLToPath(DOCKERFILE_URL);
  const context = fileURLToPath(new URL('.', DOCKERFILE_URL));
  await run(
    'docker',
    ['build', '--file', dockerfile, '--tag', tag, '--label', 'org.flowcanvas.workspace=1', context],
    {
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return tag;
}
