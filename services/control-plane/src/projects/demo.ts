import manifest from '../../../../corpus/manifest.json' with { type: 'json' };
import type { Database } from '../db/database.js';
import { createProject, findPinnedProject, type Project } from './projects.js';

/** The current stage's demo project (build plan: "Open demo project"): stage 1 opens Rallly. */
export const DEMO_CORPUS_ID = 'rallly';

export interface DemoProject {
  readonly name: string;
  readonly repoUrl: string;
  /** The corpus pin (rule 8): the demo opens exactly this commit, not the fork's head. */
  readonly commit: string;
}

/** The demo, from the corpus manifest, so its fork and pinned commit live in one place. */
export function demoProject(): DemoProject {
  const repo = manifest.repos.find((entry) => entry.id === DEMO_CORPUS_ID);
  if (repo === undefined) throw new Error(`corpus/manifest.json has no ${DEMO_CORPUS_ID}`);
  return {
    name: `${repo.name} (demo)`,
    repoUrl: `https://github.com/${repo.fork}`,
    commit: repo.commit,
  };
}

/** The person's demo project, made the first time. 'duplicate-name' if another project has its name. */
export async function ensureDemoProject(
  db: Database,
  ownerId: string,
): Promise<{ project: Project; created: boolean } | 'duplicate-name'> {
  const demo = demoProject();
  const existing = await findPinnedProject(db, ownerId, demo.repoUrl, demo.commit);
  if (existing !== undefined) return { project: existing, created: false };
  const made = await createProject(db, ownerId, {
    name: demo.name,
    repoUrl: demo.repoUrl,
    repoCommit: demo.commit,
  });
  return made === 'duplicate-name' ? made : { project: made, created: true };
}
