import { baseValues } from '@flowcanvas/tokens';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import styles from './Shell.module.css';

/** The regions that collapse (design brief: "every side region collapses so the canvas can go full screen"). */
export type ShellPanel = 'left' | 'right' | 'dock';

const px = (token: keyof typeof baseValues): number => Number.parseFloat(baseValues[token]);

/** Figma 06's sizes (tokens), and how far each can be resized. The dock holds the terminal (brief, 18). */
export const SIZES = {
  left: { default: px('--size-panel-left'), min: 180, max: 480 },
  right: { default: px('--size-panel-right'), min: 280, max: 640 },
  dock: { default: px('--size-panel-review-open'), min: 120, max: 600 },
  canvasMin: 320,
} as const;

export interface ShellControl {
  readonly isOpen: (panel: ShellPanel) => boolean;
  readonly setOpen: (panel: ShellPanel, open: boolean) => void;
  readonly toggle: (panel: ShellPanel) => void;
  /** Everything collapsed but the canvas; calling it again restores what was open. */
  readonly toggleFullScreen: () => void;
  readonly fullScreen: boolean;
  readonly reviewOpen: boolean;
  readonly toggleReview: () => void;
}

const ShellContext = createContext<ShellControl | undefined>(undefined);

/** For the rail, the top bar and anything else inside the shell that opens or closes its regions. */
export function useShell(): ShellControl {
  const control = useContext(ShellContext);
  if (control === undefined) throw new Error('useShell must be used inside <Shell>');
  return control;
}

/** Each collapsible region's last width (or height) in pixels, and whether it's open. */
export type SavedLayout = Record<ShellPanel, { readonly size: number; readonly open: boolean }>;

export const LAYOUT_KEY = 'flowcanvas-shell-layout';

export const DEFAULT_LAYOUT: SavedLayout = {
  left: { size: SIZES.left.default, open: true },
  right: { size: SIZES.right.default, open: true },
  dock: { size: SIZES.dock.default, open: false },
};

/**
 * The layout is saved in pixels, per browser. (The panel library saves percentages, which would change a
 * 320 px panel's width whenever the window size changes.) Blocked or broken storage just means the defaults.
 */
export function loadLayout(): SavedLayout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (raw === null) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<
      Record<ShellPanel, { size?: unknown; open?: unknown }>
    >;
    const read = (panel: ShellPanel) => {
      const saved = parsed[panel];
      const { min, max } = SIZES[panel];
      return typeof saved?.size === 'number' &&
        saved.size >= min &&
        saved.size <= max &&
        typeof saved.open === 'boolean'
        ? { size: saved.size, open: saved.open }
        : DEFAULT_LAYOUT[panel];
    };
    return { left: read('left'), right: read('right'), dock: read('dock') };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(layout: SavedLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private window or full storage: the layout just isn't remembered.
  }
}

export interface ShellProps {
  readonly topBar: ReactNode;
  readonly rail: ReactNode;
  readonly left: ReactNode;
  readonly canvas: ReactNode;
  readonly right: ReactNode;
  /** The bottom dock's content (the terminal), shown while it's open. */
  readonly dock: ReactNode;
  readonly review: ReactNode;
  /** Shown in the review bar's open area (300 px). */
  readonly reviewDetail?: ReactNode;
}

/**
 * The project's window (design brief, "Main canvas workspace"; Figma 06): top bar, rail, left panel, canvas,
 * bottom dock, right panel and review bar. The side regions and the dock collapse and resize, by mouse and
 * keyboard (each separator is a focusable splitter), and the layout is remembered per browser. Each region is
 * a landmark; a collapsed one is inert, so neither the keyboard nor a screen reader lands in it.
 */
export function Shell({
  topBar,
  rail,
  left,
  canvas,
  right,
  dock,
  review,
  reviewDetail,
}: ShellProps) {
  const panels: Record<ShellPanel, React.RefObject<PanelImperativeHandle | null>> = {
    left: usePanelRef(),
    right: usePanelRef(),
    dock: usePanelRef(),
  };
  // Read once: the starting sizes, in pixels.
  const [initial] = useState(loadLayout);
  // Open or not comes from each panel's real size, so dragging one shut counts as closing it.
  const [open, setOpenState] = useState<Record<ShellPanel, boolean>>({
    left: initial.left.open,
    right: initial.right.open,
    dock: initial.dock.open,
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const beforeFullScreen = useRef<Record<ShellPanel, boolean> | undefined>(undefined);
  // The last open size of each panel, so reopening returns to it rather than to the minimum.
  const layout = useRef<SavedLayout>(initial);

  const setOpen = useCallback(
    (panel: ShellPanel, value: boolean) => {
      const handle = panels[panel].current;
      if (handle === null) return;
      if (!value) {
        handle.collapse();
        return;
      }
      handle.expand();
      handle.resize(layout.current[panel].size);
    },
    // The panel refs are stable for the component's life, so this never needs to change.
    [],
  );

  const track = (panel: ShellPanel) => (size: { inPixels: number }) => {
    const isOpen = size.inPixels > 0;
    const previous = layout.current[panel];
    // Whole pixels: a fraction left over from the window resizing would blur the edge.
    const next = { size: isOpen ? Math.round(size.inPixels) : previous.size, open: isOpen };
    if (next.size !== previous.size || next.open !== previous.open) {
      layout.current = { ...layout.current, [panel]: next };
      saveLayout(layout.current);
    }
    setOpenState((current) =>
      current[panel] === isOpen ? current : { ...current, [panel]: isOpen },
    );
  };

  const start = (panel: ShellPanel) => (initial[panel].open ? initial[panel].size : 0);

  // When the window changes size, the library rescales by percentage (a 248 px panel became 247.81 px at
  // 1280 wide). Putting each open panel back at its saved pixel size keeps Figma's exact widths.
  useEffect(() => {
    const keepPixels = () => {
      for (const panel of ['left', 'right', 'dock'] as const) {
        const handle = panels[panel].current;
        if (handle !== null && !handle.isCollapsed()) handle.resize(layout.current[panel].size);
      }
    };
    window.addEventListener('resize', keepPixels);
    return () => {
      window.removeEventListener('resize', keepPixels);
    };
    // The panel refs are stable for the component's life.
  }, []);

  const control = useMemo<ShellControl>(() => {
    const fullScreen =
      !open.left && !open.right && !open.dock && beforeFullScreen.current !== undefined;
    return {
      isOpen: (panel) => open[panel],
      setOpen,
      toggle: (panel) => {
        setOpen(panel, !open[panel]);
      },
      fullScreen,
      toggleFullScreen: () => {
        if (fullScreen && beforeFullScreen.current !== undefined) {
          const restore = beforeFullScreen.current;
          beforeFullScreen.current = undefined;
          for (const panel of Object.keys(restore) as ShellPanel[]) {
            if (restore[panel]) setOpen(panel, true);
          }
          return;
        }
        beforeFullScreen.current = { ...open };
        for (const panel of Object.keys(open) as ShellPanel[]) setOpen(panel, false);
      },
      reviewOpen,
      toggleReview: () => {
        setReviewOpen((value) => !value);
      },
    };
  }, [open, reviewOpen, setOpen]);

  return (
    <ShellContext.Provider value={control}>
      <div className={styles.shell} data-review-open={reviewOpen}>
        <header className={styles.topBar} data-region="top-bar">
          {topBar}
        </header>
        <div className={styles.body}>
          <nav className={styles.rail} aria-label="Tools" data-region="rail">
            {rail}
          </nav>
          <Group
            orientation="horizontal"
            className={styles.group}
            resizeTargetMinimumSize={{ coarse: 24, fine: 8 }}
          >
            <Panel
              id="left"
              panelRef={panels.left}
              defaultSize={start('left')}
              minSize={SIZES.left.min}
              maxSize={SIZES.left.max}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={track('left')}
            >
              <aside
                className={styles.left}
                aria-label="Left panel"
                data-region="left-panel"
                inert={!open.left}
              >
                {left}
              </aside>
            </Panel>
            <Separator className={styles.separator} aria-label="Resize the left panel" />
            <Panel id="center" minSize={SIZES.canvasMin}>
              <Group
                orientation="vertical"
                className={styles.group}
                resizeTargetMinimumSize={{ coarse: 24, fine: 8 }}
              >
                <Panel id="canvas" minSize={160}>
                  <main className={styles.canvas} aria-label="Canvas" data-region="canvas">
                    {canvas}
                  </main>
                </Panel>
                <Separator className={styles.separator} aria-label="Resize the bottom dock" />
                <Panel
                  id="dock"
                  panelRef={panels.dock}
                  defaultSize={start('dock')}
                  minSize={SIZES.dock.min}
                  maxSize={SIZES.dock.max}
                  collapsible
                  collapsedSize={0}
                  groupResizeBehavior="preserve-pixel-size"
                  onResize={track('dock')}
                >
                  <section
                    className={styles.dock}
                    aria-label="Bottom dock"
                    data-region="dock"
                    inert={!open.dock}
                  >
                    {open.dock && dock}
                  </section>
                </Panel>
              </Group>
            </Panel>
            <Separator className={styles.separator} aria-label="Resize the right panel" />
            <Panel
              id="right"
              panelRef={panels.right}
              defaultSize={start('right')}
              minSize={SIZES.right.min}
              maxSize={SIZES.right.max}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={track('right')}
            >
              <aside
                className={styles.right}
                aria-label="Right panel"
                data-region="right-panel"
                inert={!open.right}
              >
                {right}
              </aside>
            </Panel>
          </Group>
        </div>
        <footer className={styles.review} aria-label="Review" data-region="review-bar">
          {review}
          {reviewOpen && <div className={styles.reviewDetail}>{reviewDetail}</div>}
        </footer>
      </div>
    </ShellContext.Provider>
  );
}
