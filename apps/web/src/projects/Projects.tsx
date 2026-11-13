import { Button, Input } from '@flowcanvas/ui';
import { Suspense, lazy, useEffect, useId, useState, type SubmitEvent } from 'react';
import {
  createProject,
  fetchDemoProject,
  fetchProjects,
  isProblem,
  type ApiProblem,
  type Project,
} from './api';
import { ProjectSecrets } from '../secrets/ProjectSecrets';
import { ProjectWorkspace, shownState, useWorkspace } from './ProjectWorkspace';
import { linkTo, projectPath } from '../routing/route';
import styles from './Projects.module.css';

/** Where workspaces can't run (staging, until a cloud provider is connected), said once, plainly. */
export const WORKSPACES_LOCAL_ONLY =
  'Workspaces run on your own computer until a cloud provider is connected (phase 1d). Open your projects there with pnpm dev.';

interface ProjectsProps {
  /** Replaces the browser's fetch in tests. */
  readonly fetcher?: typeof fetch;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

// xterm.js is about 300 kB: loaded only when someone opens a terminal.
const WorkspaceTerminal = lazy(async () => ({
  default: (await import('../terminal/WorkspaceTerminal')).WorkspaceTerminal,
}));

/**
 * The signed-in person's projects and a form to create one, at `/`. A stand-in until the start screen, which gets a
 * phase of its own (decisions log, 7 Nov 2026)
 * (design brief, "Start screens"); built from the design system's Input and Button.
 */
export function Projects({ fetcher = fetch }: ProjectsProps) {
  const [projects, setProjects] = useState<Project[] | undefined>(undefined);
  const [available, setAvailable] = useState(false);
  const [loadProblem, setLoadProblem] = useState<string | undefined>(undefined);
  const [demoProblem, setDemoProblem] = useState<string | undefined>(undefined);
  const [demoBusy, setDemoBusy] = useState(false);
  // The project the demo button made or found: its workspace opens as soon as its row is shown.
  const [openNow, setOpenNow] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void fetchProjects(fetcher).then((loaded) => {
      if (!current) return;
      if (isProblem(loaded)) setLoadProblem(loaded.message);
      else {
        setProjects(loaded.projects);
        setAvailable(loaded.workspacesAvailable);
      }
    });
    return () => {
      current = false;
    };
  }, [fetcher]);

  async function openDemo(): Promise<void> {
    setDemoBusy(true);
    setDemoProblem(undefined);
    const demo = await fetchDemoProject(fetcher);
    setDemoBusy(false);
    if (isProblem(demo)) {
      setDemoProblem(demo.message);
      return;
    }
    // First in the list, replacing the row if it was already there.
    setProjects((existing) => [demo, ...(existing ?? []).filter((p) => p.id !== demo.id)]);
    setOpenNow(demo.id);
  }

  return (
    <section className={styles.section} aria-labelledby="projects-heading">
      <div className={styles.headingRow}>
        <h2 id="projects-heading" className={styles.heading}>
          Projects
        </h2>
        {projects !== undefined && available && (
          <Button disabled={demoBusy} onClick={() => void openDemo()}>
            {demoBusy ? 'Opening…' : 'Open demo project'}
          </Button>
        )}
      </div>
      {projects !== undefined && !available && (
        <p className={styles.empty} role="status">
          {WORKSPACES_LOCAL_ONLY}
        </p>
      )}
      {demoProblem !== undefined && (
        <p className={styles.error} role="alert">
          {demoProblem}
        </p>
      )}
      <NewProjectForm
        fetcher={fetcher}
        onCreated={(project) => {
          setProjects((existing) => [project, ...(existing ?? [])]);
        }}
      />
      {loadProblem !== undefined && (
        <p className={styles.error} role="alert">
          {loadProblem}
        </p>
      )}
      {projects !== undefined &&
        (projects.length === 0 ? (
          <p className={styles.empty}>No projects yet. Create one above.</p>
        ) : (
          <ul className={styles.list} aria-label="Your projects">
            {projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                fetcher={fetcher}
                available={available}
                openOnShow={openNow === project.id}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

function ProjectItem({
  project,
  fetcher,
  available,
  openOnShow,
}: {
  readonly project: Project;
  readonly fetcher: typeof fetch;
  readonly available: boolean;
  readonly openOnShow: boolean;
}) {
  const [showSecrets, setShowSecrets] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const secretsId = useId();
  const terminalId = useId();
  const control = useWorkspace(project.id, project.workspace, fetcher);
  const running = shownState(control) === 'running';
  const { act, workspace } = control;

  // Open demo project: one click opens it, unless it's already up.
  useEffect(() => {
    if (!openOnShow || workspace.state === 'running') return;
    void act(workspace.state === 'sleeping' ? 'resume' : 'open');
    // Once per click: keyed to openOnShow alone, so it runs again only when the demo button picks this project.
  }, [openOnShow]);
  return (
    <li className={styles.item}>
      <span className={styles.itemHeader}>
        <a className={styles.name} {...linkTo(projectPath(project.id))}>
          {project.name}
        </a>
        <span className={styles.toggles}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={showSecrets}
            aria-controls={secretsId}
            onClick={() => {
              setShowSecrets((open) => !open);
            }}
          >
            {showSecrets ? 'Hide secrets' : 'Secrets'}
          </button>
          {running && (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={showTerminal}
              aria-controls={terminalId}
              onClick={() => {
                setShowTerminal((open) => !open);
              }}
            >
              {showTerminal ? 'Close terminal' : 'Terminal'}
            </button>
          )}
        </span>
      </span>
      {project.repoUrl !== null && (
        <span className={styles.repo}>
          {project.repoUrl}
          {project.repoCommit !== null && ` · pinned at ${project.repoCommit.slice(0, 7)}`}
        </span>
      )}
      <span className={styles.meta}>Created {dateFormat.format(new Date(project.createdAt))}</span>
      {available && <ProjectWorkspace project={project} control={control} />}
      <div id={terminalId} hidden={!showTerminal}>
        {running && showTerminal && (
          <Suspense fallback={<p className={styles.meta}>Loading the terminal…</p>}>
            <WorkspaceTerminal projectId={project.id} projectName={project.name} />
          </Suspense>
        )}
      </div>
      <div id={secretsId} hidden={!showSecrets}>
        {showSecrets && (
          <ProjectSecrets projectId={project.id} projectName={project.name} fetcher={fetcher} />
        )}
      </div>
    </li>
  );
}

function NewProjectForm({
  fetcher,
  onCreated,
}: {
  readonly fetcher: typeof fetch;
  readonly onCreated: (project: Project) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (name.trim() === '') {
      setProblem({ message: 'Give the project a name.', field: 'name' });
      return;
    }
    setSaving(true);
    const created = await createProject(fetcher, { name, repoUrl });
    setSaving(false);
    if (isProblem(created)) {
      setProblem(created);
      return;
    }
    setProblem(undefined);
    setName('');
    setRepoUrl('');
    onCreated(created);
  }

  const problemId = `${id}-problem`;
  const describedBy = (field: 'name' | 'repoUrl') =>
    problem?.field === field ? problemId : undefined;

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <label className={styles.label} htmlFor={`${id}-name`}>
        Project name
      </label>
      <Input
        id={`${id}-name`}
        value={name}
        maxLength={100}
        autoComplete="off"
        invalid={problem?.field === 'name'}
        aria-describedby={describedBy('name')}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <label className={styles.label} htmlFor={`${id}-repo`}>
        Repository address (optional)
      </label>
      <Input
        id={`${id}-repo`}
        mono
        value={repoUrl}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://github.com/owner/repo"
        invalid={problem?.field === 'repoUrl'}
        aria-describedby={describedBy('repoUrl')}
        onChange={(event) => {
          setRepoUrl(event.target.value);
        }}
      />
      {problem !== undefined && (
        <p id={problemId} className={styles.error} role="alert">
          {problem.message}
        </p>
      )}
      <div className={styles.actions}>
        <Button kind="primary" type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create project'}
        </Button>
      </div>
    </form>
  );
}
