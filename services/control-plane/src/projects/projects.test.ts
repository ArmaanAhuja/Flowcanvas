// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/database.js';
import { migratedDatabase } from '../test/database.js';
import { signedInAs } from '../test/sessions.js';
import { createProject, listProjects, parseNewProject } from './projects.js';

describe('parseNewProject', () => {
  it('trims the name and allows no repository', () => {
    expect(parseNewProject({ name: '  Rallly  ' })).toEqual({ name: 'Rallly', repoUrl: null });
    expect(parseNewProject({ name: 'Rallly', repoUrl: '   ' })).toEqual({
      name: 'Rallly',
      repoUrl: null,
    });
  });

  it('needs a name of 1 to 100 characters, without control characters', () => {
    expect(parseNewProject({})).toEqual({ field: 'name', message: 'Give the project a name.' });
    expect(parseNewProject({ name: '   ' })).toMatchObject({ field: 'name' });
    expect(parseNewProject({ name: 42 })).toMatchObject({ field: 'name' });
    expect(parseNewProject({ name: 'a'.repeat(100) })).toMatchObject({ name: 'a'.repeat(100) });
    expect(parseNewProject({ name: 'a'.repeat(101) })).toMatchObject({ field: 'name' });
    expect(parseNewProject({ name: 'two\nlines' })).toMatchObject({ field: 'name' });
  });

  it('counts characters, not bytes, so names in any language fit', () => {
    expect(parseNewProject({ name: 'प्रोजेक्ट 日本 ✓' })).toMatchObject({
      name: 'प्रोजेक्ट 日本 ✓',
    });
  });

  it('accepts an https repository address', () => {
    expect(parseNewProject({ name: 'x', repoUrl: 'https://github.com/lukevella/rallly' })).toEqual({
      name: 'x',
      repoUrl: 'https://github.com/lukevella/rallly',
    });
  });

  it('refuses addresses that aren’t https, aren’t URLs, or carry credentials', () => {
    for (const repoUrl of ['github.com/x/y', 'http://github.com/x/y', 'git@github.com:x/y.git']) {
      expect(parseNewProject({ name: 'x', repoUrl })).toMatchObject({ field: 'repoUrl' });
    }
    expect(parseNewProject({ name: 'x', repoUrl: 'https://ghp_CANARY@github.com/x/y' })).toEqual({
      field: 'repoUrl',
      message: 'Remove the username or token from the address. Never put credentials in a URL.',
    });
  });
});

describe('projects in the database', () => {
  let db: Database;
  let ada: string;
  let grace: string;

  beforeEach(async () => {
    db = await migratedDatabase();
    ada = (await signedInAs(db, 'ada@example.com')).userId;
    grace = (await signedInAs(db, 'grace@example.com')).userId;
  });

  it('creates a project and lists it for its owner, newest first', async () => {
    const first = await createProject(db, ada, { name: 'Rallly', repoUrl: null });
    await db.query("update projects set created_at = now() - interval '1 hour'");
    const second = await createProject(db, ada, {
      name: 'Documenso',
      repoUrl: 'https://github.com/documenso/documenso',
    });
    expect(first).toMatchObject({ name: 'Rallly', repoUrl: null });
    expect(second).toMatchObject({ repoUrl: 'https://github.com/documenso/documenso' });
    if (second === 'duplicate-name') throw new Error('unexpected duplicate');
    expect(new Date(second.createdAt).toISOString()).toBe(second.createdAt);

    expect((await listProjects(db, ada)).map((project) => project.name)).toEqual([
      'Documenso',
      'Rallly',
    ]);
  });

  it('never shows one person’s projects to another', async () => {
    await createProject(db, ada, { name: 'Rallly', repoUrl: null });
    expect(await listProjects(db, grace)).toEqual([]);
  });

  it('refuses a second project with the same name for the same person only', async () => {
    await createProject(db, ada, { name: 'Rallly', repoUrl: null });
    expect(await createProject(db, ada, { name: 'Rallly', repoUrl: null })).toBe('duplicate-name');
    expect(await createProject(db, grace, { name: 'Rallly', repoUrl: null })).toMatchObject({
      name: 'Rallly',
    });
  });

  it('creates the workspace record with the project, not created yet, and only once', async () => {
    const created = await createProject(db, ada, { name: 'Rallly', repoUrl: null });
    if (created === 'duplicate-name') throw new Error('unexpected duplicate');
    expect(created.workspace.state).toBe('not_created');
    expect(await createProject(db, ada, { name: 'Rallly', repoUrl: null })).toBe('duplicate-name');

    const rows = await db.query<{ id: string; project_id: string }>(
      'select id, project_id from workspaces',
    );
    expect(rows).toEqual([{ id: created.workspace.id, project_id: created.id }]);
    expect((await listProjects(db, ada))[0]?.workspace).toEqual(created.workspace);
  });
});
