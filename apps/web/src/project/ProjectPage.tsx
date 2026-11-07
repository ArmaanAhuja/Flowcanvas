import { WorkspaceStatus } from '@flowcanvas/ui';
import { useEffect, useState } from 'react';
import { fetchProjects, isProblem, type Project } from '../projects/api';
import { linkTo } from '../routing/route';
import { Shell } from '../shell/Shell';
import styles from './ProjectPage.module.css';

/** What each region says until its content exists: honest empty states, never placeholders (owner, 7 Nov). */
export const EMPTY = {
  left: 'Entry points appear here once the project is analysed.',
  canvas: 'Flows appear here once the project is analysed.',
  right: 'Select something on the canvas to see its details here.',
  review: 'No agent session yet.',
} as const;

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'problem'; readonly message: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly project: Project; readonly workspacesAvailable: boolean };

/** A project's page, `/p/<id>` (phase 2): the app shell around the project. */
export function ProjectPage({
  projectId,
  fetcher = fetch,
}: {
  readonly projectId: string;
  readonly fetcher?: typeof fetch;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });

  useEffect(() => {
    let current = true;
    void fetchProjects(fetcher).then((list) => {
      if (!current) return;
      if (isProblem(list)) {
        setLoaded({ kind: 'problem', message: list.message });
        return;
      }
      const project = list.projects.find((p) => p.id === projectId);
      setLoaded(
        project === undefined
          ? { kind: 'missing' }
          : { kind: 'ready', project, workspacesAvailable: list.workspacesAvailable },
      );
    });
    return () => {
      current = false;
    };
  }, [fetcher, projectId]);

  if (loaded.kind !== 'ready') {
    return (
      <main className={styles.message}>
        <p role={loaded.kind === 'loading' ? 'status' : 'alert'}>
          {loaded.kind === 'loading'
            ? 'Opening the project…'
            : loaded.kind === 'missing'
              ? 'There’s no such project, or it isn’t yours.'
              : loaded.message}
        </p>
        {loaded.kind !== 'loading' && (
          <a className={styles.link} {...linkTo('/')}>
            Go to your projects
          </a>
        )}
      </main>
    );
  }

  const { project } = loaded;
  return (
    <Shell
      topBar={
        <>
          <a className={styles.home} {...linkTo('/')}>
            Flowcanvas
          </a>
          <span className={styles.project}>{project.name}</span>
          <span className={styles.spacer} />
          {loaded.workspacesAvailable && (
            <WorkspaceStatus
              state={project.workspace.state}
              {...(project.workspace.state === 'running' ? { detail: '2 cores' } : {})}
            />
          )}
        </>
      }
      rail={null}
      left={<p className={styles.empty}>{EMPTY.left}</p>}
      canvas={<p className={styles.canvasEmpty}>{EMPTY.canvas}</p>}
      right={<p className={styles.empty}>{EMPTY.right}</p>}
      review={<span className={styles.reviewEmpty}>{EMPTY.review}</span>}
    />
  );
}
