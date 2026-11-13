import '@xyflow/react/dist/base.css';
import {
  CanvasToolbar,
  FlowNode,
  ToolbarButton,
  ToolbarDivider,
  ToolbarText,
  type FlowNodeChange,
  type FlowNodeKind,
} from '@flowcanvas/ui';
import { baseValues } from '@flowcanvas/tokens';
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Hand, Maximize, Minus, MousePointer2, Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './FlowCanvas.module.css';
import {
  DecisionCard,
  FlowEdge,
  StubCard,
  type DecisionCanvasNode,
  type FlowCanvasEdge,
  type StubCanvasNode,
} from './flow-parts';

export interface FlowNodeData extends Record<string, unknown> {
  readonly title: string;
  readonly location: string;
  readonly kind?: FlowNodeKind;
  readonly change?: FlowNodeChange;
  /** In a flow (phase 7): its node in the graph, and where its name is (what "Open code" opens). */
  readonly id?: string;
  readonly place?: { readonly path: string; readonly line: number; readonly column: number } | null;
}

/** A code unit (and the phase 2 examples); and, in a flow (phase 7), its decisions and open ends. */
export type UnitCanvasNode = Node<FlowNodeData, 'flow'>;
export type CanvasNode = UnitCanvasNode | DecisionCanvasNode | StubCanvasNode;
export type CanvasEdge = Edge | FlowCanvasEdge;

/** Our FlowNode as React Flow's node type; the handles only anchor edges (nodes aren't connected by hand). */
const FlowNodeCard = memo(function FlowNodeCard({
  data,
  selected,
}: NodeProps<Node<FlowNodeData, 'flow'>>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={styles.handle}
      />
      <FlowNode
        title={data.title}
        location={data.location}
        {...(data.kind === undefined ? {} : { kind: data.kind })}
        {...(data.change === undefined ? {} : { change: data.change })}
        selected={selected}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={styles.handle}
      />
    </>
  );
});

const NODE_TYPES = { flow: FlowNodeCard, decision: DecisionCard, stub: StubCard };
const EDGE_TYPES = { flow: FlowEdge };
const px = (token: keyof typeof baseValues) => Number.parseFloat(baseValues[token]);
const MINIMAP = { width: px('--size-minimap-width'), height: px('--size-minimap-height') };

export const ZOOM = { min: 0.05, max: 2, step: 1.2 } as const;

// React Flow's options, made once: a fresh object or array on every render makes it redo work, which showed up
// as stutter while panning 500 nodes (phase 2 step 7).
// Arrowheads in the edge's own stroke colour (a CSS variable, so they follow the theme and the form).
const EDGE_OPTIONS = {
  type: 'smoothstep',
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
    color: 'var(--color-edge-default)',
  },
} as const;
const FIT_OPTIONS = { padding: 0.15 } as const;
/** Where a focused node's top sits (px from the canvas's top): below the flow's name and counts. */
const FOCUS_TOP = 72;
const ZOOM_KEYS = ['Control', 'Meta'];
/** In Select, the middle and right buttons pan; the left one draws a selection box. */
const PAN_BUTTONS_SELECT = [1, 2];
const PRO_OPTIONS = { hideAttribution: true } as const;
const MINIMAP_STYLE = { width: MINIMAP.width, height: MINIMAP.height } as const;

/** Below this zoom a node's text is too small to read: nodes paint as shapes only (FlowNode's level of detail). */
export const LOW_DETAIL_BELOW = 0.4;

export type CanvasTool = 'select' | 'pan';

export interface FlowCanvasProps {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  /** Shown over an empty canvas, e.g. "Flows arrive with the flow builder (phase 7)." */
  readonly empty: ReactNode;
  /** Shown above the canvas, e.g. that these are example nodes. */
  readonly banner?: ReactNode;
  /** Top left over the canvas, e.g. the index's progress chip (phase 4), or a flow's name and counts (phase 7). */
  readonly status?: ReactNode;
  /** A node chosen (a click, or the keyboard): the inspector shows it. Null when nothing is selected. */
  readonly onSelectNode?: (node: CanvasNode | null) => void;
  /** A node opened (a double-click): its code. */
  readonly onOpenNode?: (node: CanvasNode) => void;
  /**
   * A node to open on (a flow's root): at 100%, centred across, near the top, as Figma 06 shows a flow (owner,
   * 14 Nov 2026). Without one, everything is fitted (the stress test). F fits either way.
   */
  readonly focus?: string;
}

/**
 * The canvas (design brief, "Main canvas workspace"; Figma 06): React Flow, styled from our tokens.
 * - **Select (V):** drag on the background selects a box; **Pan (H):** drag moves the view. Space + drag pans
 *   with either.
 * - Scroll pans; Ctrl or ⌘ + scroll, or a pinch, zooms. **F** fits the selection, or everything.
 * - The minimap is bottom-left and the toolbar bottom-centre, as on Figma 06.
 */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({
  nodes: given,
  edges: givenEdges,
  empty,
  banner,
  status,
  onSelectNode,
  onOpenNode,
  focus,
}: FlowCanvasProps) {
  const [tool, setTool] = useState<CanvasTool>('select');
  // React Flow keeps selection in the nodes themselves, so it holds them; a new set replaces them.
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([...given]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([...givenEdges]);
  useEffect(() => {
    setNodes([...given]);
  }, [given, setNodes]);
  useEffect(() => {
    setEdges([...givenEdges]);
  }, [givenEdges, setEdges]);
  const container = useRef<HTMLDivElement>(null);
  // No useViewport here: only ZoomControls follows the zoom, so panning doesn't re-render the canvas.
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  // Empty by what it's given, not by React Flow's copy: the copy catches up in an effect, one render late, and in
  // that render a flow just laid out showed "Choose a function…" under its own counts (phase 7's screens, on CI).
  const isEmpty = given.length === 0;
  // React Flow gets handlers that never change, calling the latest ones: a new handler on every render made it
  // report the selection again, and the page render again (a loop found by the page tests).
  const handlers = useRef({ onSelectNode, onOpenNode });
  handlers.current = { onSelectNode, onOpenNode };
  const onSelectionChange = useCallback(({ nodes: chosen }: { nodes: CanvasNode[] }) => {
    handlers.current.onSelectNode?.(chosen.length === 1 ? (chosen[0] ?? null) : null);
  }, []);
  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: CanvasNode) => {
    handlers.current.onOpenNode?.(node);
  }, []);

  // A new set of nodes with a node to open on: that node at 100%, near the top. Set before React Flow's first fit,
  // which is off when there's a focus.
  const focused = focus === undefined ? undefined : given.find((node) => node.id === focus);
  useEffect(() => {
    const box = container.current?.getBoundingClientRect();
    if (focused === undefined || box === undefined) return;
    const width = (focused as { readonly size?: { readonly width: number } }).size?.width ?? 0;
    void flow.setViewport({
      x: Math.round(box.width / 2 - (focused.position.x + width / 2)),
      y: FOCUS_TOP - focused.position.y,
      zoom: 1,
    });
    // Only when the nodes change: panning and zooming after that are the person's.
  }, [given]);

  const fit = () => {
    if (flow.getNodes().length === 0) return;
    const selected = flow.getNodes().filter((node) => node.selected === true);
    void flow.fitView({
      padding: 0.15,
      duration: 200,
      ...(selected.length > 0 ? { nodes: selected } : {}),
    });
  };

  // F, V and H, like other canvas tools. Our own listener: React Flow's useKeyPress stopped reporting F after a
  // box selection (found by the walkthrough).
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCanvasShortcut(event)) return;
      const key = event.key.toLowerCase();
      if (key === 'f') fitRef.current();
      else if (key === 'v') setTool('select');
      else if (key === 'h') setTool('pan');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className={styles.canvas} data-tool={tool} ref={container}>
      <DetailLevel container={container} />
      {banner !== undefined && (
        <p className={styles.banner} role="note">
          {banner}
        </p>
      )}
      {status !== undefined && <div className={styles.status}>{status}</div>}
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={onNodeDoubleClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={ZOOM.min}
        maxZoom={ZOOM.max}
        fitView={focus === undefined}
        fitViewOptions={FIT_OPTIONS}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomActivationKeyCode={ZOOM_KEYS}
        panActivationKeyCode="Space"
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'pan' ? true : PAN_BUTTONS_SELECT}
        deleteKeyCode={null}
        // Zoomed in, only the nodes on screen are in the page; zoomed out, all of them are (shapes only).
        onlyRenderVisibleElements
        proOptions={PRO_OPTIONS}
        aria-label="Flow canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {!isEmpty && (
          <MiniMap
            position="bottom-left"
            style={MINIMAP_STYLE}
            ariaLabel="Minimap"
            pannable
            zoomable
          />
        )}
      </ReactFlow>
      {isEmpty && <div className={styles.empty}>{empty}</div>}
      <div className={styles.toolbar}>
        <CanvasToolbar aria-label="Canvas">
          <ToolbarButton
            label="Select (V)"
            icon={<MousePointer2 size={16} />}
            active={tool === 'select'}
            onClick={() => {
              setTool('select');
            }}
          />
          <ToolbarButton
            label="Pan (H)"
            icon={<Hand size={16} />}
            active={tool === 'pan'}
            onClick={() => {
              setTool('pan');
            }}
          />
          <ToolbarDivider />
          <ZoomControls />
          <ToolbarButton
            label="Fit (F)"
            icon={<Maximize size={16} />}
            disabled={isEmpty}
            onClick={fit}
          />
        </CanvasToolbar>
      </div>
    </div>
  );
}

/**
 * A plain key meant for the canvas: not while typing (inputs, text areas, editable text, which includes the
 * terminal's hidden text area), and not with Ctrl, ⌘ or Alt, so the browser's own shortcuts (⌘F) still work.
 */
export function isCanvasShortcut(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
  // Where the key was really pressed: inside a shadow root (the code editor, ADR 0021), `event.target` is only the
  // shadow root's host by the time a window listener sees it.
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof HTMLElement)) return true;
  // Inside a dialog, list or menu above the canvas (⌘K, quick-open, the workspace popover). React Aria's
  // Autocomplete passes each typed key on to its list as a copy of the event, whose target is the list, not the
  // field; treating that copy as V (select) cancelled the letter "v" in the palette (found by the phase 4
  // walkthrough).
  if (target.closest('[role="dialog"], [role="listbox"], [role="menu"]') !== null) return false;
  // Inside editable text (also nested inside an editor's own markup).
  if (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  ) {
    return false;
  }
  return !(
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** The zoom buttons and level: the only part of the canvas that re-renders as the view moves. */
function ZoomControls() {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <>
      <ToolbarButton
        label="Zoom out"
        icon={<Minus size={16} />}
        disabled={zoom <= ZOOM.min}
        onClick={() => void flow.zoomOut({ duration: 150 })}
      />
      <ToolbarText>
        <span aria-label="Zoom level">{`${String(Math.round(zoom * 100))}%`}</span>
      </ToolbarText>
      <ToolbarButton
        label="Zoom in"
        icon={<Plus size={16} />}
        disabled={zoom >= ZOOM.max}
        onClick={() => void flow.zoomIn({ duration: 150 })}
      />
    </>
  );
}

/**
 * Marks the canvas `data-detail="low"` while zoomed out below LOW_DETAIL_BELOW. Subscribed to that one boolean, so
 * it changes once per crossing, never per frame, and the nodes themselves don't re-render (it's CSS).
 */
function DetailLevel({
  container,
}: {
  readonly container: React.RefObject<HTMLDivElement | null>;
}) {
  const low = useStore((state) => state.transform[2] < LOW_DETAIL_BELOW);
  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    if (low) element.dataset.detail = 'low';
    else delete element.dataset.detail;
  }, [low, container]);
  return null;
}
