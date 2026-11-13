import { Button, WorkspaceStatus } from '@flowcanvas/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchWorkspace,
  isProblem,
  workspaceAction,
  type Project,
  type Workspace,
  type WorkspaceAction,
  type WorkspaceState,
} from './api';
import styles from './ProjectWorkspace.module.css';

/** How often the page asks again: often while a workspace is changing, now and then while it runs (so an
 * idle sleep or the resource guard's change shows without a reload). A GET isn't activity. */
export const POLL_MS = { changing: 3_000, running: 30_000 } as const;

/** Each workspace's machine on this computer (workspace/image WORKSPACE_LIMITS). */
export const MACHINE = '2 cores · 4 GiB · this computer';

export const TEXT = {
  starting: (name: string) => `Starting ${name}`,
  resuming: (name: string) => `Resuming ${name}`,
  cloning: (repo: string, commit: string | null) =>
    `Cloning ${repo.replace(/^https:\/\//, '')}${commit === null ? '' : ` at ${commit.slice(0, 7)}`}. Usually under 15 seconds.`,
  startingAgain: 'Starting it again with its files. Usually a few seconds.',
  startingEmpty: 'Starting an empty workspace. Usually a few seconds.',
  waking: 'Waking it with its files and running processes as they were. Usually under a second.',
  asleepTitle: 'This workspace is asleep',
  asleepKept: 'Its files and running processes are kept as they were, and asleep costs nothing.',
  resumeTime: 'Usually under a second',
} as const;

const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The workspace's record, the action in flight, and what the API said if it didn't go as asked. */
export function useWorkspace(projectId: string, initial: Workspace, fetcher: typeof fetch) {
  const [workspace, setWorkspace] = useState(initial);
  const [pending, setPending] = useState<WorkspaceAction | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const act = useCallback(
    async (action: WorkspaceAction) => {
      setPending(action);
      setProblem(undefined);
      const result = await workspaceAction(fetcher, projectId, action);
      if (result.workspace !== undefined) setWorkspace(result.workspace);
      setProblem(result.problem);
      setPending(undefined);
    },
    [fetcher, projectId],
  );

  useEffect(() => {
    if (pending !== undefined) return;
    const changing = workspace.state === 'creating' || workspace.state === 'resuming';
    if (!changing && workspace.state !== 'running') return;
    let current = true;
    const timer = setTimeout(
      () => {
        void fetchWorkspace(fetcher, projectId).then((latest) => {
          if (current && !isProblem(latest)) setWorkspace(latest);
        });
      },
      changing ? POLL_MS.changing : POLL_MS.running,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [workspace, pending, fetcher, projectId]);

  return { workspace, pending, problem, act };
}

export type WorkspaceControl = ReturnType<typeof useWorkspace>;

/** What to show while a request is in flight: we asked for it, so "Starting…" is true from the click. */
export function shownState(
  control: Pick<WorkspaceControl, 'workspace' | 'pending'>,
): WorkspaceState {
  const { workspace, pending } = control;
  if (pending === 'open') return workspace.state === 'sleeping' ? 'resuming' : 'creating';
  if (pending === 'resume') return 'resuming';
  return workspace.state;
}

/**
 * A project's workspace on the projects list (design brief, "29. Workspace status"; the project page shows it in its
 * top bar, phase 2):
 * the status chip, what can be done from here, and the starting and asleep cards. Only what's true is shown:
 * no backups or checkpoints until they exist (18a), no progress figure the host doesn't report.
 */
export function ProjectWorkspace({
  project,
  control,
}: {
  readonly project: Project;
  readonly control: WorkspaceControl;
}) {
  const { workspace, pending, problem, act } = control;
  const shown = shownState(control);
  const busy = pending !== undefined;
  const run = (action: WorkspaceAction) => () => void act(action);

  return (
    <div className={styles.workspace}>
      <div className={styles.row}>
        <WorkspaceStatus state={shown} {...(shown === 'running' ? { detail: '2 cores' } : {})} />
        <span className={styles.actions}>
          {(shown === 'not_created' || shown === 'stopped' || shown === 'failed') && (
            <Button size="sm" disabled={busy} onClick={run('open')}>
              {shown === 'failed' ? 'Try again' : 'Open'}
            </Button>
          )}
          {shown === 'running' && (
            <>
              <Button size="sm" kind="ghost" disabled={busy} onClick={run('sleep')}>
                {pending === 'sleep' ? 'Putting to sleep…' : 'Sleep'}
              </Button>
              <Button size="sm" kind="ghost" disabled={busy} onClick={run('stop')}>
                {pending === 'stop' ? 'Stopping…' : 'Stop'}
              </Button>
            </>
          )}
        </span>
      </div>

      {problem !== undefined && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}

      {(shown === 'creating' || shown === 'resuming') && (
        <section className={styles.card} aria-label={`${project.name} workspace starting`}>
          <h3 className={styles.title}>
            {shown === 'resuming' ? TEXT.resuming(project.name) : TEXT.starting(project.name)}
          </h3>
          <p className={styles.text}>{startingLine(project, workspace, shown)}</p>
          {/* Indeterminate: the host reports no progress, so no figure is shown (never fabricate). */}
          <div className={styles.strip} role="progressbar" aria-label="Starting" />
        </section>
      )}

      {shown === 'sleeping' && (
        <section className={styles.card} aria-label={`${project.name} workspace asleep`}>
          <h3 className={styles.title}>{TEXT.asleepTitle}</h3>
          {workspace.failure !== null && <p className={styles.text}>{workspace.failure}</p>}
          <p className={styles.text}>{TEXT.asleepKept}</p>
          <dl className={styles.facts}>
            <dt>Asleep since</dt>
            <dd>{time.format(new Date(workspace.stateChangedAt))}</dd>
            <dt>Machine</dt>
            <dd>{MACHINE}</dd>
            <dt>Resume time</dt>
            <dd>{TEXT.resumeTime}</dd>
          </dl>
          <div className={styles.cardActions}>
            <Button size="sm" kind="ghost" disabled={busy} onClick={run('stop')}>
              {pending === 'stop' ? 'Stopping…' : 'Stop'}
            </Button>
            <Button size="sm" disabled={busy} onClick={run('resume')}>
              Resume
            </Button>
          </div>
        </section>
      )}

      {(shown === 'stopped' || shown === 'failed') &&
        workspace.failure !== null &&
        problem === undefined && (
          <p className={styles.text} role="status">
            {workspace.failure}
          </p>
        )}
    </div>
  );
}

function startingLine(project: Project, workspace: Workspace, shown: WorkspaceState): string {
  if (shown === 'resuming') return TEXT.waking;
  // Only the first start clones; a stopped workspace keeps its files.
  if (workspace.state === 'stopped') return TEXT.startingAgain;
  if (project.repoUrl === null) return TEXT.startingEmpty;
  return TEXT.cloning(project.repoUrl, project.repoCommit);
}
