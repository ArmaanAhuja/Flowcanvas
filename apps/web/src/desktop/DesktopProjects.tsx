import { Button } from '@flowcanvas/ui';
import { useEffect, useState } from 'react';
import { fetchProjects, isProblem, type Project } from '../projects/api';
import { linkTo, navigate, projectPath } from '../routing/route';
import type { DesktopBridge } from './bridge';
import styles from './DesktopProjects.module.css';

/** A desktop project: the folder's path comes with it (the site's projects have none). */
type DesktopProject = Project & { readonly path?: string };

export const DESKTOP_TEXT = {
  open: 'Open folder',
  opening: 'Opening…',
  empty:
    'Open a project folder to start. Flowcanvas reads it on your computer; nothing is uploaded.',
} as const;

/**
 * The desktop app's start (build plan v2, phase 1): Open folder (the system's picker), then the folders opened
 * before, newest first, each opening its project.
 */
export function DesktopProjects({
  bridge,
  fetcher = fetch,
}: {
  readonly bridge: DesktopBridge;
  readonly fetcher?: typeof fetch;
}) {
  const [projects, setProjects] = useState<readonly DesktopProject[] | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void fetchProjects(fetcher).then((loaded) => {
      if (!current) return;
      if (isProblem(loaded)) setProblem(loaded.message);
      else setProjects(loaded.projects);
    });
    return () => {
      current = false;
    };
  }, [fetcher]);

  async function openFolder(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      const opened = await bridge.openFolder();
      if (opened !== null) navigate(projectPath(opened.id));
    } catch {
      setProblem('Couldn’t open that folder. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="desktop-projects-heading">
      <div className={styles.headingRow}>
        <h2 id="desktop-projects-heading" className={styles.heading}>
          Projects
        </h2>
        <Button kind="primary" disabled={busy} onClick={() => void openFolder()}>
          {busy ? DESKTOP_TEXT.opening : DESKTOP_TEXT.open}
        </Button>
      </div>
      {problem !== undefined && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      {projects?.length === 0 && <p className={styles.empty}>{DESKTOP_TEXT.empty}</p>}
      {projects !== undefined && projects.length > 0 && (
        <ul className={styles.list} aria-label="Recent projects">
          {projects.map((project) => (
            <li key={project.id} className={styles.item}>
              <a className={styles.name} {...linkTo(projectPath(project.id))}>
                {project.name}
              </a>
              {project.path !== undefined && <span className={styles.path}>{project.path}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
