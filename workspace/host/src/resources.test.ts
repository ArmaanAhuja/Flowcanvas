import { describe, expect, it } from 'vitest';
import { BUDGET, assess, parseDockerSize, type Figures } from './resources.js';

const GiB = 1024 ** 3;
const healthy: Figures = {
  memoryTotalBytes: 30.8 * GiB,
  memoryAvailableBytes: 22 * GiB,
  diskFreeBytes: 581 * GiB,
  load1: 1.2,
  cores: 16,
  running: 1,
  asleep: 1,
  imagesBytes: 559_000_000,
  volumesBytes: 52_000_000,
};

describe('parseDockerSize', () => {
  it("reads Docker's sizes, which use powers of 1000", () => {
    expect(parseDockerSize('0B')).toBe(0);
    expect(parseDockerSize('138.9kB')).toBe(138_900);
    expect(parseDockerSize('559MB')).toBe(559_000_000);
    expect(parseDockerSize('2.5GB')).toBe(2_500_000_000);
    expect(parseDockerSize('N/A')).toBe(0);
  });
});

describe('assess', () => {
  it('is all ok on a healthy laptop', () => {
    expect(assess(healthy).every((check) => check.ok)).toBe(true);
  });

  it('flags each limit when it is crossed', () => {
    const over = (changes: Partial<Figures>) =>
      assess({ ...healthy, ...changes })
        .filter((check) => !check.ok)
        .map((check) => check.name);
    expect(over({ running: 3 })).toEqual(['Workspaces running']);
    expect(over({ volumesBytes: 25 * GiB })).toEqual(['Flowcanvas disk (images and workspaces)']);
    expect(over({ memoryAvailableBytes: 3.9 * GiB })).toEqual(['Memory available']);
    expect(over({ diskFreeBytes: 49 * GiB })).toEqual(['Disk free']);
    expect(over({ load1: 14.5 })).toEqual(['Load (1 minute)']);
  });

  it('uses the owner’s budget (4 Nov 2026)', () => {
    expect(BUDGET).toEqual({
      maxRunning: 2,
      flowcanvasDiskBytes: 25 * GiB,
      minAvailableMemoryBytes: 4 * GiB,
      minFreeDiskBytes: 50 * GiB,
      maxLoadPerCore: 0.9,
      loadSustainedMs: 120_000,
    });
  });
});
