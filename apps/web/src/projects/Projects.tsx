import { Button, Input } from '@flowcanvas/ui';
import { useEffect, useId, useState, type SubmitEvent } from 'react';
import {
  createProject,
  fetchProjects,
  isProblem,
  type ApiProblem,
  type Project,
  type WorkspaceState,
} from './api';
import { ProjectSecrets } from '../secrets/ProjectSecrets';
import styles from './Projects.module.css';

interface ProjectsProps {
  /** Replaces the browser's fetch in tests. */
  readonly fetcher?: typeof fetch;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Words for each workspace state; state is always written out, never shown by colour alone. */
const WORKSPACE_STATES: Record<WorkspaceState, string> = {
  not_created: 'Workspace not created yet',
  creating: 'Workspace starting',
  running: 'Workspace running',
  sleeping: 'Workspace sleeping',
  resuming: 'Workspace resuming',
  stopped: 'Workspace stopped',
  failed: 'Workspace failed',
};

/**
 * The signed-in person's projects and a form to create one. A stand-in until the phase 2 start screen
 * (design brief, "Start screens"); built from the design system's Input and Button.
 */
export function Projects({ fetcher = fetch }: ProjectsProps) {
  const [projects, setProjects] = useState<Project[] | undefined>(undefined);
  const [loadProblem, setLoadProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void fetchProjects(fetcher).then((loaded) => {
      if (!current) return;
      if (isProblem(loaded)) setLoadProblem(loaded.message);
      else setProjects(loaded);
    });
    return () => {
      current = false;
    };
  }, [fetcher]);

  return (
    <section className={styles.section} aria-labelledby="projects-heading">
      <h2 id="projects-heading" className={styles.heading}>
        Projects
      </h2>
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
              <ProjectItem key={project.id} project={project} fetcher={fetcher} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function ProjectItem({
  project,
  fetcher,
}: {
  readonly project: Project;
  readonly fetcher: typeof fetch;
}) {
  const [showSecrets, setShowSecrets] = useState(false);
  const secretsId = useId();
  return (
    <li className={styles.item}>
      <span className={styles.itemHeader}>
        <span className={styles.name}>{project.name}</span>
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
      </span>
      {project.repoUrl !== null && <span className={styles.repo}>{project.repoUrl}</span>}
      <span className={styles.meta}>
        Created {dateFormat.format(new Date(project.createdAt))} ·{' '}
        {WORKSPACE_STATES[project.workspace.state]}
      </span>
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
