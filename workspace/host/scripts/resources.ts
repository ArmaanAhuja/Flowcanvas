// `pnpm workspace:resources`: the laptop's figures and Flowcanvas's share, against the budget.
import { dockerCli } from '../src/docker-cli.js';
import { assess, readFigures } from '../src/resources.js';

const checks = assess(await readFigures(dockerCli));
const width = Math.max(...checks.map((check) => check.name.length));
for (const check of checks) {
  console.log(
    `${check.ok ? 'ok  ' : 'OVER'}  ${check.name.padEnd(width)}  ${check.value}  (${check.limit})`,
  );
}
process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
