// `pnpm workspace:image [--force]`: build the workspace image for the current Dockerfile.
import { buildImage, imageExists } from '../src/docker.js';
import { imageTag } from '../src/spec.js';

const force = process.argv.includes('--force');
const tag = imageTag();
const existed = await imageExists(tag);
const started = Date.now();
await buildImage({ force });
console.log(
  existed && !force ? `${tag} is up to date` : `Built ${tag} in ${String(Date.now() - started)} ms`,
);
