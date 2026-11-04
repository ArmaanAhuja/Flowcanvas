// `pnpm workspace:clean`: remove test leftovers and old workspace images.
// `pnpm workspace:clean --all --yes`: also every workspace (with its files) and image, e.g. once a cloud
// provider is connected (upgrade-later 33). Without --yes it only lists what --all would remove.
import { imageTag } from '@flowcanvas/workspace-image';
import { dockerCli } from '../src/docker-cli.js';
import { findObjects, planClean, remove } from '../src/clean.js';

const all = process.argv.includes('--all');
const yes = process.argv.includes('--yes');
const plan = planClean(await findObjects(dockerCli), { all, currentImage: imageTag() });

if (plan.length === 0) {
  console.log('Nothing to remove.');
} else if (all && !yes) {
  console.log('--all would remove these, including every workspace’s files:');
  for (const object of plan) console.log(`  ${object.kind} ${object.name}`);
  console.log('Run again with --all --yes to remove them.');
  process.exitCode = 1;
} else {
  for (const object of plan) {
    try {
      await remove(dockerCli, object);
      console.log(`removed ${object.kind} ${object.name}`);
    } catch (error) {
      console.log(`could not remove ${object.kind} ${object.name}: ${String(error)}`);
      process.exitCode = 1;
    }
  }
}
