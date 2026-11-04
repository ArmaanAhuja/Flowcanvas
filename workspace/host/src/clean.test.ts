import { describe, expect, it } from 'vitest';
import { planClean, type DockerObject } from './clean.js';

const CURRENT = 'flowcanvas-workspace:b6722cf7e5d0';
const objects: DockerObject[] = [
  { kind: 'image', name: CURRENT, prefix: '', ours: true },
  { kind: 'image', name: 'flowcanvas-workspace:0123456789ab', prefix: '', ours: true },
  { kind: 'volume', name: 'fc-ws-1', prefix: 'fc', ours: true },
  { kind: 'container', name: 'fc-ws-1', prefix: 'fc', ours: true },
  { kind: 'network', name: 'fc-ws-1', prefix: 'fc', ours: true },
  { kind: 'container', name: 'fc-egress', prefix: 'fc', ours: true },
  { kind: 'container', name: 'x', prefix: 'fc-test-1a2b', ours: true },
  { kind: 'volume', name: 'fc-test-vol-1a2b-0', prefix: '', ours: false },
  // Not ours: other projects on the same laptop.
  { kind: 'container', name: 'postgres', prefix: '', ours: false },
  { kind: 'volume', name: 'nivesh_data', prefix: '', ours: false },
  { kind: 'network', name: 'fc-lookalike', prefix: '', ours: false },
  { kind: 'image', name: 'node:24-slim', prefix: '', ours: false },
];
const names = (plan: DockerObject[]) => plan.map((object) => `${object.kind} ${object.name}`);

describe('planClean', () => {
  it('by default removes only test leftovers and old workspace images', () => {
    expect(names(planClean(objects, { all: false, currentImage: CURRENT }))).toEqual([
      'container x',
      'volume fc-test-vol-1a2b-0',
      'image flowcanvas-workspace:0123456789ab',
    ]);
  });

  it('with --all removes every Flowcanvas object, containers first', () => {
    expect(names(planClean(objects, { all: true, currentImage: CURRENT }))).toEqual([
      'container fc-ws-1',
      'container fc-egress',
      'container x',
      'network fc-ws-1',
      'volume fc-ws-1',
      'volume fc-test-vol-1a2b-0',
      `image ${CURRENT}`,
      'image flowcanvas-workspace:0123456789ab',
    ]);
  });

  it('never touches anything that is not ours', () => {
    for (const all of [false, true]) {
      const plan = names(planClean(objects, { all, currentImage: CURRENT }));
      for (const other of ['postgres', 'nivesh_data', 'fc-lookalike', 'node:24-slim']) {
        expect(plan.join('\n')).not.toContain(other);
      }
    }
  });
});
