import { Button, Rail, RailButton, ReviewBar, Tabs, TopBar } from '@flowcanvas/ui';
import { Maximize2, Minimize2, PanelRight, SquareTerminal, Target } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { fetchProjects, isProblem, type Project } from '../projects/api';
import { FlowCanvas } from '../canvas/FlowCanvas';
import { EXAMPLE_BANNER, exampleGraph } from '../canvas/examples';
import { useLabs } from '../labs/LabsProvider';
import { shownState, useWorkspace, type WorkspaceControl } from '../projects/ProjectWorkspace';
import { linkTo } from '../routing/route';
import { WorkspacePopover } from './WorkspacePopover';
import { Shell, useShell } from '../shell/Shell';
import styles from './ProjectPage.module.css';

// xterm.js only when the dock opens a terminal.
const WorkspaceTerminal = lazy(async () => ({
  default: (await import('../terminal/WorkspaceTerminal')).WorkspaceTerminal,
}));

/** What each region says until its content exists: honest empty states, never placeholders (owner, 7 Nov). */
export const EMPTY = {
  left: 'Entry points appear here once the project is analysed.',
  canvas: 'Flows appear here once the project is analysed.',
  right: 'Select something on the canvas to see its details here.',
  review: 'No agent session yet.',
  reviewDetail:
    'Changes from an agent session are listed here, with their tests and what’s still unverified.',
  terminalClosed: 'Open the workspace to use a terminal here.',
  terminalUnavailable: 'Workspaces run locally for now, so there’s no terminal here.',
} as const;

/** The view switch: Graph now; the others arrive with their phases (shown, never offered). */
const VIEWS = [
  { id: 'graph', label: 'Graph' },
  {
    id: 'sequence',
    label: 'Sequence',
    disabled: true,
    hint: 'The sequence view arrives in a later phase',
  },
  { id: 'code', label: 'Code', disabled: true, hint: 'The code view arrives with the editor' },
];

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

  return (
    <ReadyProject
      project={loaded.project}
      workspacesAvailable={loaded.workspacesAvailable}
      fetcher={fetcher}
    />
  );
}

/** The loaded project in the shell. One workspace record for the whole page: the chip, its popover and the
 * dock all follow it, with its polling (so an idle sleep shows here too). */
function ReadyProject({
  project,
  workspacesAvailable,
  fetcher,
}: {
  readonly project: Project;
  readonly workspacesAvailable: boolean;
  readonly fetcher: typeof fetch;
}) {
  const control = useWorkspace(project.id, project.workspace, fetcher);
  return (
    <Shell
      topBar={
        <ProjectTopBar
          project={project}
          {...(workspacesAvailable ? { workspace: control } : {})}
          fetcher={fetcher}
        />
      }
      rail={<ProjectRail />}
      left={
        <section className={styles.panel} aria-labelledby="entry-points">
          <h2 id="entry-points" className={styles.panelTitle}>
            Entry points
          </h2>
          <p className={styles.empty}>{EMPTY.left}</p>
        </section>
      }
      canvas={<ProjectCanvas />}
      right={
        <section className={styles.panel} aria-labelledby="inspector">
          <h2 id="inspector" className={styles.panelTitle}>
            Inspector
          </h2>
          <p className={styles.empty}>{EMPTY.right}</p>
        </section>
      }
      dock={
        <Dock
          project={project}
          {...(workspacesAvailable ? { running: shownState(control) === 'running' } : {})}
        />
      }
      review={<ProjectReviewBar />}
      reviewDetail={<p className={styles.empty}>{EMPTY.reviewDetail}</p>}
    />
  );
}

function ProjectTopBar({
  project,
  workspace,
  fetcher,
}: {
  readonly project: Project;
  /** Absent where workspaces can't run (staging): no chip at all. */
  readonly workspace?: WorkspaceControl;
  readonly fetcher: typeof fetch;
}) {
  const shell = useShell();
  return (
    <TopBar
      start={
        <>
          <a className={styles.home} {...linkTo('/')}>
            Flowcanvas
          </a>
          <span className={styles.project}>{project.name}</span>
        </>
      }
      middle={<Tabs aria-label="View" variant="segmented" items={VIEWS} />}
      end={
        <>
          {workspace !== undefined && <WorkspacePopover control={workspace} fetcher={fetcher} />}
          <RailButton
            label="Right panel"
            icon={<PanelRight size={18} />}
            active={shell.isOpen('right')}
            onClick={() => {
              shell.toggle('right');
            }}
          />
          <RailButton
            label={shell.fullScreen ? 'Leave full screen' : 'Full-screen canvas'}
            icon={shell.fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            active={shell.fullScreen}
            onClick={shell.toggleFullScreen}
          />
        </>
      }
    />
  );
}

/** Only the tools that work now; the rest of Figma 06's rail arrives with their phases. */
function ProjectRail() {
  const shell = useShell();
  return (
    <Rail>
      <RailButton
        label="Entry points"
        icon={<Target size={18} />}
        active={shell.isOpen('left')}
        onClick={() => {
          shell.toggle('left');
        }}
      />
      <RailButton
        label="Terminal"
        icon={<SquareTerminal size={18} />}
        active={shell.isOpen('dock')}
        onClick={() => {
          shell.toggle('dock');
        }}
      />
    </Rail>
  );
}

function ProjectReviewBar() {
  const shell = useShell();
  return (
    <ReviewBar
      summary={EMPTY.review}
      actions={
        <Button
          kind="ghost"
          size="sm"
          aria-expanded={shell.reviewOpen}
          onClick={shell.toggleReview}
        >
          {shell.reviewOpen ? 'Hide review' : 'Show review'}
        </Button>
      }
    />
  );
}

function Dock({ project, running }: { readonly project: Project; readonly running?: boolean }) {
  if (running === undefined) return <p className={styles.empty}>{EMPTY.terminalUnavailable}</p>;
  if (!running) return <p className={styles.empty}>{EMPTY.terminalClosed}</p>;
  return (
    <Suspense fallback={<p className={styles.empty}>Loading the terminal…</p>}>
      <WorkspaceTerminal projectId={project.id} projectName={project.name} />
    </Suspense>
  );
}

/** No flows until the project is analysed (phase 4 onwards); the Labs stress test shows labelled examples. */
function ProjectCanvas() {
  const stressTest = useLabs().isOn('canvas-stress-test');
  const examples = useMemo(() => (stressTest ? exampleGraph() : undefined), [stressTest]);
  return (
    <FlowCanvas
      nodes={examples?.nodes ?? []}
      edges={examples?.edges ?? []}
      empty={<p className={styles.empty}>{EMPTY.canvas}</p>}
      {...(examples === undefined ? {} : { banner: EXAMPLE_BANNER })}
    />
  );
}
