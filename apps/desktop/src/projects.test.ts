import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOST_RECENT, Projects } from './projects.js';

let root: string;
let clock: number;
const projects = () => new Projects({ dataRoot: root, now: () => new Date((clock += 1000)) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fc-projects-'));
  clock = Date.UTC(2026, 10, 21);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Projects', () => {
  it('gives a folder an id the first time, and the same id when it’s opened again, even after a restart', () => {
    const first = projects().open('/home/me/code/my-app');
    expect(first).toMatchObject({ name: 'my-app', path: '/home/me/code/my-app' });
    const again = projects().open('/home/me/code/my-app/');
    expect(again.id).toBe(first.id);
    expect(again.lastOpenedAt > first.lastOpenedAt).toBe(true);
    expect(projects().get(first.id)?.path).toBe('/home/me/code/my-app');
  });

  it('lists the newest first and keeps the last 20', () => {
    const list = projects();
    for (let i = 0; i < MOST_RECENT + 3; i += 1) list.open(`/code/app-${String(i)}`);
    const names = list.list().map((p) => p.name);
    expect(names).toHaveLength(MOST_RECENT);
    expect(names[0]).toBe(`app-${String(MOST_RECENT + 2)}`);
    expect(names).not.toContain('app-0');
  });

  it('keeps each project’s data in a folder of its own, readable by the person only, never in the project', () => {
    const list = projects();
    const project = list.open('/code/app');
    const folder = list.dataFolder(project.id);
    expect(folder.startsWith(root)).toBe(true);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, 'projects.json')).mode & 0o777).toBe(0o600);
  });

  it('starts with no recent projects when the list is damaged, rather than failing to start', () => {
    writeFileSync(join(root, 'projects.json'), '{not json');
    expect(projects().list()).toEqual([]);
    projects().open('/code/app');
    expect(JSON.parse(readFileSync(join(root, 'projects.json'), 'utf8'))).toHaveLength(1);
  });
});
