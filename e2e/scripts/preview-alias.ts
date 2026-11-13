// The address of a branch's preview: shared by the deploy (deploy.ts) and the check that waits for it
// (wait-for-deploy.ts), so the two can never disagree.

export const WORKER = 'flowcanvas';

/**
 * Cloudflare's branch alias for a Workers Builds preview: lowercase, every run of other characters becomes a
 * dash, trimmed, and short enough that `<alias>-flowcanvas` fits a 63-character DNS label.
 */
export function branchAlias(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 62 - WORKER.length)
    .replace(/-+$/, '');
}
