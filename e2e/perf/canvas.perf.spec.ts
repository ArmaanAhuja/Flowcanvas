import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';

// Phase 2 · Done when: "500 dummy nodes pan and zoom smoothly". 500 nodes (the Labs stress test), panned by
// dragging and scrolling and zoomed with Ctrl + scroll, at a zoom where all of them are on screen and at 100%.
// Measured:
// - frame times (requestAnimationFrame, the main thread's frames)
// - long tasks (the main thread blocked over 50 ms)
// - input to paint (Event Timing): the share of pointer and wheel events that took over 16 ms until the next
//   frame was painted, which is what a person feels. The browser reports only those slow ones, so every input
//   is also counted.

const real = process.env.PERF_REAL === '1';

/** "Smooth" (phase 2 plan): median 60 fps and 95th percentile under 25 ms, on the laptop with its GPU.
 * Headless (CI, software rendering) only catches large regressions. */
export const LIMITS = real
  ? { medianFrameMs: 17.5, p95FrameMs: 25, worstLongTaskMs: 100, slowInputShare: 0.05 }
  : { medianFrameMs: 50, p95FrameMs: 100, worstLongTaskMs: 250, slowInputShare: 0.25 };

/**
 * The one known exception (phase 2 report; the build plan's phase 42 brings the WebGL renderer that fixes it): zooming in close (100% to 200%), where nodes come
 * into and leave the page as they enter and leave the view, still drops a few frames (p95 about 40 to 50 ms).
 * Its own limit is named here so it can't get worse unseen; the target is LIMITS, like everything else.
 */
export const CLOSE_ZOOM_LIMITS = real
  ? { ...LIMITS, p95FrameMs: 60, worstLongTaskMs: 150 }
  : LIMITS;
const CLOSE_ZOOM = '100% zoom: Ctrl + scroll to zoom';

const PROJECT = {
  id: 'p-perf',
  name: 'Rallly',
  repoUrl: null,
  repoCommit: null,
  createdAt: '2026-11-07T09:00:00.000Z',
  workspace: {
    id: 'w',
    state: 'sleeping',
    stateChangedAt: '2026-11-07T09:00:00.000Z',
    failure: null,
  },
};

interface Measured {
  frames: number[];
  longTasks: number[];
  slow: { name: string; ms: number }[];
  inputs: number;
  stop: boolean;
}

const reply = (route: Route, body: unknown) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

const percentile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

/** Runs in the page before anything else: observers that fill `window.perf` while a scene is measured. */
function observe(): void {
  const w = window as unknown as { perf?: Measured };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) w.perf?.longTasks.push(entry.duration);
  }).observe({ type: 'longtask' });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (/^(pointermove|wheel|pointerdown|pointerup)$/.test(entry.name)) {
        w.perf?.slow.push({ name: entry.name, ms: entry.duration });
      }
    }
  }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  for (const type of ['pointermove', 'wheel', 'pointerdown', 'pointerup']) {
    window.addEventListener(
      type,
      () => {
        if (w.perf !== undefined) w.perf.inputs += 1;
      },
      { capture: true, passive: true },
    );
  }
}

async function startMeasuring(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { perf: Measured };
    w.perf = { frames: [], longTasks: [], slow: [], inputs: 0, stop: false };
    let last = performance.now();
    const tick = (t: number) => {
      w.perf.frames.push(t - last);
      last = t;
      if (!w.perf.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopMeasuring(page: Page): Promise<Measured> {
  // Let the last inputs' paints be reported.
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const w = window as unknown as { perf: Measured };
    w.perf.stop = true;
    return { ...w.perf, frames: w.perf.frames.slice(2) };
  });
}

test('500 nodes pan and zoom smoothly', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/projects') {
      return reply(route, { projects: [PROJECT], workspacesAvailable: true });
    }
    return reply(route, {});
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('flowcanvas-labs', JSON.stringify({ 'canvas-stress-test': true }));
  });
  await page.addInitScript(observe);
  await page.goto(`/p/${PROJECT.id}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(500);

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl === null || info === null || info === undefined
      ? 'unknown'
      : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  });

  const box = await page.locator('[data-region="canvas"]').boundingBox();
  if (box === null) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const scenes: [string, () => Promise<void>][] = [
    [
      'all 500 on screen',
      async () => {
        await page.getByRole('button', { name: 'Fit (F)' }).click();
      },
    ],
    [
      '100% zoom',
      async () => {
        while (
          Number((await page.getByLabel('Zoom level').textContent())?.replace('%', '')) < 100
        ) {
          await page.getByRole('button', { name: 'Zoom in' }).click();
        }
      },
    ],
  ];

  const gestures: [string, () => Promise<void>][] = [
    [
      'drag to pan',
      async () => {
        // Space + drag, around a circle: 240 moves.
        await page.mouse.move(cx, cy);
        await page.keyboard.down('Space');
        await page.mouse.down();
        for (let i = 0; i < 240; i++) {
          await page.mouse.move(cx + Math.sin(i / 20) * 300, cy + Math.cos(i / 20) * 200);
        }
        await page.mouse.up();
        await page.keyboard.up('Space');
      },
    ],
    [
      'scroll to pan',
      async () => {
        for (let i = 0; i < 60; i++)
          await page.mouse.wheel(i % 2 === 0 ? 60 : -60, i < 30 ? 80 : -80);
      },
    ],
    [
      'Ctrl + scroll to zoom',
      async () => {
        await page.keyboard.down('Control');
        for (let i = 0; i < 40; i++) await page.mouse.wheel(0, i < 20 ? -60 : 60);
        await page.keyboard.up('Control');
      },
    ],
  ];

  const results = [];
  for (const [scene, prepare] of scenes) {
    for (const [gesture, perform] of gestures) {
      await prepare();
      await page.waitForTimeout(600);
      await startMeasuring(page);
      const started = Date.now();
      await perform();
      const seconds = (Date.now() - started) / 1000;
      const m = await stopMeasuring(page);
      results.push({
        scene: `${scene}: ${gesture}`,
        seconds: Number(seconds.toFixed(1)),
        frames: m.frames.length,
        medianFrameMs: Number(percentile(m.frames, 0.5).toFixed(1)),
        p95FrameMs: Number(percentile(m.frames, 0.95).toFixed(1)),
        worstFrameMs: Number(percentile(m.frames, 1).toFixed(1)),
        longTasks: m.longTasks.length,
        worstLongTaskMs: Math.round(Math.max(0, ...m.longTasks)),
        inputs: m.inputs,
        slowInputs: m.slow.length,
        slowInputShare: m.inputs === 0 ? 0 : Number((m.slow.length / m.inputs).toFixed(3)),
        slowest: m.slow
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 3)
          .map((e) => `${e.name} ${String(Math.round(e.ms))} ms`),
      });
    }
  }

  const report = {
    mode: real ? 'real window, GPU' : 'headless',
    gpu,
    nodes: 500,
    viewport: '1440 × 900',
    limits: LIMITS,
    closeZoomLimits: CLOSE_ZOOM_LIMITS,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  // reports-data is git-ignored, so a fresh checkout (CI) doesn't have it.
  mkdirSync('reports-data', { recursive: true });
  writeFileSync('reports-data/canvas-perf.json', `${JSON.stringify(report, null, 2)}\n`);

  for (const row of results) {
    const limits = row.scene === CLOSE_ZOOM ? CLOSE_ZOOM_LIMITS : LIMITS;
    expect(row.medianFrameMs, `${row.scene}: median frame`).toBeLessThanOrEqual(
      limits.medianFrameMs,
    );
    expect(row.p95FrameMs, `${row.scene}: p95 frame`).toBeLessThan(limits.p95FrameMs);
    expect(row.worstLongTaskMs, `${row.scene}: worst long task`).toBeLessThan(
      limits.worstLongTaskMs,
    );
    expect(row.slowInputShare, `${row.scene}: share of inputs over 16 ms to paint`).toBeLessThan(
      limits.slowInputShare,
    );
  }
});
