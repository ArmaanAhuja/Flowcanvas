import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../projects/api';
import { LabsProvider } from '../labs/LabsProvider';
import { EMPTY, ProjectPage } from './ProjectPage';

afterEach(cleanup);

const rallly: Project = {
  id: 'p-1',
  name: 'Rallly',
  repoUrl: 'https://github.com/lukevella/rallly',
  repoCommit: null,
  createdAt: '2026-11-07T09:00:00.000Z',
  workspace: {
    id: 'w-1',
    state: 'running',
    stateChangedAt: '2026-11-07T09:00:00.000Z',
    failure: null,
  },
};

/** The page as the app shows it: inside Labs (its canvas reads the stress-test switch). */
const renderPage = (page: ReactElement) => render(<LabsProvider>{page}</LabsProvider>);

const api = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));

describe('ProjectPage', () => {
  it('says it is opening the project, then shows the shell with every region', async () => {
    renderPage(
      <ProjectPage
        projectId="p-1"
        fetcher={api({ projects: [rallly], workspacesAvailable: true })}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Opening the project…');
    expect(await screen.findByText('Rallly')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Tools' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Left panel' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Canvas' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Right panel' })).toBeTruthy();
    expect(screen.getByRole('contentinfo', { name: 'Review' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Workspace: Running' }).textContent).toBe(
      'Running · 2 cores',
    );
  });

  it('shows honest empty states, never made-up content', async () => {
    renderPage(
      <ProjectPage
        projectId="p-1"
        fetcher={api({ projects: [rallly], workspacesAvailable: true })}
      />,
    );
    await screen.findByText('Rallly');
    for (const text of [EMPTY.left, EMPTY.canvas, EMPTY.right, EMPTY.review]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it('opens the review bar’s detail, and offers only the views that exist', async () => {
    renderPage(
      <ProjectPage
        projectId="p-1"
        fetcher={api({ projects: [rallly], workspacesAvailable: true })}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Show review' }));
    expect(screen.getByText(EMPTY.reviewDetail)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide review' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Graph' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole<HTMLButtonElement>('tab', { name: 'Sequence' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('tab', { name: 'Code' }).disabled).toBe(true);
  });

  it('puts only working tools on the rail', async () => {
    renderPage(
      <ProjectPage
        projectId="p-1"
        fetcher={api({ projects: [rallly], workspacesAvailable: true })}
      />,
    );
    const rail = await screen.findByRole('navigation', { name: 'Tools' });
    expect([...rail.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Entry points',
      'Terminal',
    ]);
  });

  it('shows no workspace status where workspaces can’t run (staging)', async () => {
    renderPage(
      <ProjectPage
        projectId="p-1"
        fetcher={api({ projects: [rallly], workspacesAvailable: false })}
      />,
    );
    await screen.findByText('Rallly');
    expect(screen.queryByText(/Running/)).toBeNull();
  });

  it('says so for a project that isn’t there or isn’t yours, with a way back', async () => {
    renderPage(
      <ProjectPage
        projectId="p-9"
        fetcher={api({ projects: [rallly], workspacesAvailable: true })}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'There’s no such project, or it isn’t yours.',
    );
    expect(screen.getByRole('link', { name: 'Go to your projects' }).getAttribute('href')).toBe(
      '/',
    );
  });

  it('shows the API’s reason when signed out', async () => {
    renderPage(<ProjectPage projectId="p-1" fetcher={api({ error: 'Sign in first.' }, 401)} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Sign in first.');
  });
});
