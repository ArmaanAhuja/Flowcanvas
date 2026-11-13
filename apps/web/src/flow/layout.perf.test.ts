// @vitest-environment node
// ELK's time for a flow at the 60-node cap (phase 7, ADR 0028: the spike measured 63 ms median, 96 ms worst, in
// Node). Run alone (`pnpm test:perf`), never alongside the unit tests, whose load makes any timing meaningless.
import ELK from 'elkjs/lib/elk.bundled.js';
import { expect, it } from 'vitest';
import { layoutFlow } from './layout';
import { capFlow } from './fixtures';

it('lays a flow at the 60-node cap out in well under a second (median of 5, after one warm-up)', async () => {
  const elk = new ELK();
  await layoutFlow(capFlow(), elk);
  const times: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    await layoutFlow(capFlow(), elk);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const median = times[2] ?? Infinity;
  console.log(
    `60-node flow: median ${String(Math.round(median))} ms, worst ${String(Math.round(times[4] ?? 0))} ms`,
  );
  expect(median).toBeLessThan(1000);
});
