import {
  Button,
  ContextMenu,
  GraphStats,
  MenuItem,
  Rail,
  RailButton,
  ReviewBar,
  SearchTrigger,
  Tabs,
  TopBar,
  type CallPlace,
} from '@flowcanvas/ui';
import { FileText, Maximize2, Minimize2, PanelRight, SquareTerminal, Target } from 'lucide-react';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchTree } from '../code/api';
import { useWorkspaceEvents } from '../code/events';
import { useCodeFiles } from '../code/useCodeFiles';
import { fetchProjects, isProblem, type Project } from '../projects/api';
import { FlowCanvas } from '../canvas/FlowCanvas';
import { EXAMPLE_BANNER, exampleGraph } from '../canvas/examples';
import { useLabs } from '../labs/LabsProvider';
import { useGraphStats } from '../graph/useGraphStats';
import { ARRIVES_IN } from '@flowcanvas/graph-model';
import { shownState, useWorkspace, type WorkspaceControl } from '../projects/ProjectWorkspace';
import { linkTo } from '../routing/route';
import { WorkspacePopover } from './WorkspacePopover';
import { Shell, useShell } from '../shell/Shell';
import { IndexChip } from '../symbols/IndexChip';
import { indexChip, paletteNote } from '../symbols/texts';
import { askSemantic } from '../symbols/api';
import { useCalls } from '../symbols/useCalls';
import { useProjectIndex, useSymbolSearch } from '../symbols/useProjectIndex';
import { Inspector } from './Inspector';
import styles from './ProjectPage.module.css';

// The file tree (React Aria's Tree) only when Files is shown, and CodeMirror only when the Code view opens:
// each in its own chunk, so a project page that never opens them doesn't download them.
const FilesPanel = lazy(async () => ({ default: (await import('../code/FilesPanel')).FilesPanel }));
const CodeView = lazy(async () => ({ default: (await import('../code/CodeView')).CodeView }));
// Quick-open (Ctrl/⌘+P) and the command palette (⌘K, phase 4): one chunk of their own (SearchDialogs.ts), fetched in
// the background once the workspace runs, so it's there before the first keypress. Loading it on the keypress lost
// the first letters typed (found by the screen test, phase 3 step 8).
const loadSearchDialogs = () => import('../symbols/SearchDialogs');
const QuickOpen = lazy(async () => ({ default: (await loadSearchDialogs()).QuickOpen }));
const CommandPalette = lazy(async () => ({ default: (await loadSearchDialogs()).CommandPalette }));

/** ⌘K on a Mac, Ctrl+K elsewhere; the top bar shows whichever applies. */
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

// xterm.js only when the dock opens a terminal.
const WorkspaceTerminal = lazy(async () => ({
  default: (await import('../terminal/WorkspaceTerminal')).WorkspaceTerminal,
}));

/**
 * What each region says until its content exists: honest empty states, never placeholders (owner, 7 Nov), and
 * whatever arrives later says so with its build-plan phase (owner, 12 Nov 2026).
 */
export const EMPTY = {
  left: 'Entry points arrive with entry-point detection (phase 8): pages, routes, event handlers and jobs found in the code.',
  canvas: 'Flows arrive with the flow builder (phase 7).',
  right: 'Details of what you select on the canvas arrive with the flow builder (phase 7).',
  review: 'Agent sessions arrive with the agent panel (phase 19).',
  reviewDetail:
    'Reviewing an agent session’s changes, with their tests and what’s still unverified, arrives with the review panel (phase 32).',
  terminalClosed: 'Open the workspace to use a terminal here.',
  terminalUnavailable:
    'Workspaces run on your own computer until a cloud provider is connected (phase 1d), so there’s no terminal here.',
} as const;

/** The view switch: Graph and Code (phase 3); Sequence arrives with its phase (shown, never offered). */
const VIEWS = [
  { id: 'graph', label: 'Graph' },
  {
    id: 'sequence',
    label: 'Sequence',
    disabled: true,
    hint: 'The sequence view arrives in phase 13',
  },
  { id: 'code', label: 'Code' },
];

export type ProjectView = 'graph' | 'code';
type LeftTool = 'entry-points' | 'files';

const viewKey = (projectId: string) => `flowcanvas-view-${projectId}`;

function rememberedView(projectId: string): ProjectView {
  try {
    return window.localStorage.getItem(viewKey(projectId)) === 'code' ? 'code' : 'graph';
  } catch {
    return 'graph';
  }
}

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
  const running = workspacesAvailable && shownState(control) === 'running';
  const [view, setViewState] = useState<ProjectView>(() => rememberedView(project.id));
  const [leftTool, setLeftTool] = useState<LeftTool>(view === 'code' ? 'files' : 'entry-points');
  const code = useCodeFiles(project.id, fetcher, running);
  const unsaved = useMemo(
    () => new Set(code.files.filter((file) => file.unsaved).map((file) => file.path)),
    [code.files],
  );
  // Changes in the workspace: open files follow them (useCodeFiles), and the file tree is listed again when a file
  // appears or goes. The tree's paths are known here from its last listing.
  const [treeRefresh, setTreeRefresh] = useState(0);
  const listed = useRef<ReadonlySet<string>>(new Set());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useWorkspaceEvents(project.id, running, (event) => {
    code.onDiskEvent(event);
    if (event.type === 'overflow' || event.deleted || !listed.current.has(event.path)) {
      // A burst (a checkout, an install) lists once.
      if (refreshTimer.current !== undefined) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        setTreeRefresh((n) => n + 1);
      }, 300);
    }
  });

  useEffect(() => {
    if (running) void loadSearchDialogs();
  }, [running]);

  // The project index (phase 4): its progress while it indexes, and symbol search for the palette.
  const index = useProjectIndex(project.id, running, fetcher);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteFiles, setPaletteFiles] = useState<readonly string[]>([]);
  const search = useSymbolSearch(project.id, paletteQuery, palette && running, fetcher);
  const openPalette = useCallback(() => {
    setPaletteFiles(running ? [...listed.current] : []);
    setPalette(true);
    // The freshest list: the tree may not have been shown yet.
    if (running) {
      void fetchTree(project.id, fetcher).then((result) => {
        if ('files' in result) setPaletteFiles(result.files);
      });
    }
  }, [running, project.id, fetcher]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [openPalette]);

  // Quick-open, Ctrl/⌘+P: the browser's print is not what anyone wants here.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickFiles, setQuickFiles] = useState<readonly string[]>([]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'p'
      ) {
        event.preventDefault();
        if (!running) return;
        setQuickFiles([...listed.current]);
        setQuickOpen(true);
        // The freshest list: the tree may not have been shown yet.
        void fetchTree(project.id, fetcher).then((result) => {
          if ('files' in result) setQuickFiles(result.files);
        });
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [running, project.id, fetcher]);

  // TypeScript's answers (phase 5): the right-click menu, F12 and Shift+F12 in the Code view, and the Calls tab.
  // Labs → Graph stats (phase 6): the flow graph's counts in the Details tab, asked for only while it's on.
  const graphStatsOn = useLabs().isOn('graph-stats');
  const graph = useGraphStats(project.id, running, graphStatsOn, fetcher);
  const calls = useCalls(project.id, fetcher);
  const [menu, setMenu] = useState<{
    readonly at: CallPlace;
    readonly pointer: { readonly x: number; readonly y: number };
  } | null>(null);
  const openPlace = (place: CallPlace) => {
    if (view !== 'code') setView('code');
    code.open(place.path, { line: place.line, column: place.column });
  };
  const goToDefinition = (at: CallPlace) => {
    void askSemantic(project.id, 'definition', at, fetcher).then((answer) => {
      // The first definition in the project; a built-in one (TypeScript's library) has no place to open.
      const place =
        'definitions' in answer
          ? answer.definitions.find((d) => d.place !== null)?.place
          : undefined;
      if (place !== undefined && place !== null) openPlace(place);
      else if ('definitions' in answer && answer.definitions.length > 0)
        calls.notice('It’s defined in TypeScript’s standard library, not in the project.');
      else calls.notice(answer.message ?? 'TypeScript found no definition for this.');
    });
  };
  const semantic = (op: 'definition' | 'references' | 'callers' | 'callees', at: CallPlace) => {
    if (op === 'definition') goToDefinition(at);
    else void calls.ask(op, at);
  };

  const setView = (next: ProjectView) => {
    // Leaving the Code view settles its files: autosaved, or journalled with autosave off. Only leaving it:
    // arriving must not save anything (restored changes would be written the moment they appear).
    if (view === 'code' && next !== 'code') code.flush();
    setViewState(next);
    // As on Figma 11: the Code view's left panel is the file tree, the Graph view's the entry points.
    setLeftTool(next === 'code' ? 'files' : 'entry-points');
    try {
      window.localStorage.setItem(viewKey(project.id), next);
    } catch {
      // Not remembering the view is fine.
    }
  };
  return (
    <Shell
      topBar={
        <ProjectTopBar
          project={project}
          view={view}
          onView={setView}
          onSearch={openPalette}
          {...(workspacesAvailable ? { workspace: control } : {})}
          fetcher={fetcher}
        />
      }
      rail={<ProjectRail leftTool={leftTool} onLeftTool={setLeftTool} />}
      left={
        leftTool === 'files' ? (
          <Suspense fallback={<p className={styles.empty}>Loading the files…</p>}>
            <FilesPanel
              projectId={project.id}
              projectName={project.name}
              running={running}
              selected={code.active?.path}
              unsaved={unsaved}
              onOpen={(path) => {
                if (view !== 'code') setView('code');
                code.open(path);
              }}
              refresh={treeRefresh}
              onList={(files) => {
                listed.current = new Set(files);
              }}
              fetcher={fetcher}
            />
          </Suspense>
        ) : (
          <section className={styles.panel} aria-labelledby="entry-points">
            <h2 id="entry-points" className={styles.panelTitle}>
              Entry points
            </h2>
            <IndexChip status={index.status} className={styles.panelChip} />
            <p className={styles.empty}>{EMPTY.left}</p>
          </section>
        )
      }
      canvas={
        <>
          {quickOpen && (
            <Suspense fallback={null}>
              <QuickOpen
                isOpen
                onOpenChange={setQuickOpen}
                files={quickFiles}
                onOpen={(path) => {
                  if (view !== 'code') setView('code');
                  code.open(path);
                }}
              />
            </Suspense>
          )}
          {palette && (
            <Suspense fallback={null}>
              <CommandPalette
                isOpen
                onOpenChange={setPalette}
                query={paletteQuery}
                onQueryChange={setPaletteQuery}
                symbols={search.symbols}
                symbolsNote={paletteNote(running, index.status, search.problem)}
                files={paletteFiles}
                onOpenFile={(path) => {
                  if (view !== 'code') setView('code');
                  code.open(path);
                }}
                onOpenSymbol={(symbol) => {
                  if (view !== 'code') setView('code');
                  code.open(symbol.path, { line: symbol.line, column: symbol.column });
                }}
              />
            </Suspense>
          )}
          {view === 'code' ? (
            <Suspense fallback={<p className={styles.empty}>Loading the editor…</p>}>
              <CodeView
                files={code}
                running={running}
                indexNote={indexChip(index.status)?.detail}
                onSemanticKey={(op, path, at) => {
                  semantic(op, { path, ...at });
                }}
                onContextMenu={(path, at, pointer) => {
                  setMenu({ at: { path, ...at }, pointer });
                }}
              />
            </Suspense>
          ) : (
            <ProjectCanvas status={<IndexChip status={index.status} />} />
          )}
          {menu !== null && (
            <ContextMenu
              isOpen
              onOpenChange={(open) => {
                if (!open) setMenu(null);
              }}
              at={menu.pointer}
              aria-label="Code"
              onAction={(key) => {
                if (
                  key === 'definition' ||
                  key === 'references' ||
                  key === 'callers' ||
                  key === 'callees'
                ) {
                  semantic(key, menu.at);
                }
              }}
            >
              <MenuItem id="definition" shortcut="F12">
                Go to definition
              </MenuItem>
              <MenuItem id="references" shortcut="Shift+F12">
                Find references
              </MenuItem>
              <MenuItem id="callers">Callers</MenuItem>
              <MenuItem id="callees">Callees</MenuItem>
            </ContextMenu>
          )}
        </>
      }
      right={
        <Inspector
          calls={calls.state}
          details={
            graphStatsOn ? (
              <GraphStats
                state={graph.state}
                message={graph.message}
                snapshot={graph.snapshot}
                arrivesIn={ARRIVES_IN}
              />
            ) : (
              <p className={styles.empty}>{EMPTY.right}</p>
            )
          }
          onViewChange={calls.setView}
          onOpen={openPlace}
        />
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
  view,
  onView,
  onSearch,
  workspace,
  fetcher,
}: {
  readonly project: Project;
  readonly view: ProjectView;
  readonly onView: (view: ProjectView) => void;
  /** Opens the command palette (phase 4). */
  readonly onSearch: () => void;
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
      middle={
        <Tabs
          aria-label="View"
          variant="segmented"
          items={VIEWS}
          value={view}
          onValueChange={(id) => {
            if (id === 'graph' || id === 'code') onView(id);
          }}
        />
      }
      end={
        <>
          <SearchTrigger
            onPress={onSearch}
            shortcutLabel={isMac() ? '⌘K' : 'Ctrl K'}
            keyShortcuts={isMac() ? 'Meta+K' : 'Control+K'}
          />
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

/** Only the tools that work now; the rest of Figma 06's rail arrives with their phases. Entry points and Files
 * share the left panel: a tool's button shows it there, or closes the panel if it's already showing. */
function ProjectRail({
  leftTool,
  onLeftTool,
}: {
  readonly leftTool: LeftTool;
  readonly onLeftTool: (tool: LeftTool) => void;
}) {
  const shell = useShell();
  const leftButton = (tool: LeftTool) => () => {
    if (leftTool === tool) {
      shell.toggle('left');
    } else {
      onLeftTool(tool);
      shell.setOpen('left', true);
    }
  };
  return (
    <Rail>
      <RailButton
        label="Entry points"
        icon={<Target size={18} />}
        active={leftTool === 'entry-points' && shell.isOpen('left')}
        onClick={leftButton('entry-points')}
      />
      <RailButton
        label="Files"
        icon={<FileText size={18} />}
        active={leftTool === 'files' && shell.isOpen('left')}
        onClick={leftButton('files')}
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
function ProjectCanvas({ status }: { readonly status: ReactNode }) {
  const stressTest = useLabs().isOn('canvas-stress-test');
  const examples = useMemo(() => (stressTest ? exampleGraph() : undefined), [stressTest]);
  return (
    <FlowCanvas
      nodes={examples?.nodes ?? []}
      edges={examples?.edges ?? []}
      empty={<p className={styles.empty}>{EMPTY.canvas}</p>}
      status={status}
      {...(examples === undefined ? {} : { banner: EXAMPLE_BANNER })}
    />
  );
}
