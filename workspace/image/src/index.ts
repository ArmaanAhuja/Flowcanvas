// The workspace image and its container settings (phase 1d, ADR 0016).
export {
  DOCKERFILE_URL,
  WORKSPACE_DIR,
  WORKSPACE_LIMITS,
  WORKSPACE_USER,
  imageTag,
  networkCreateArgs,
  runArgs,
  type RunOptions,
  type WorkspaceLimits,
} from './spec.js';
export { buildImage, imageExists } from './docker.js';
