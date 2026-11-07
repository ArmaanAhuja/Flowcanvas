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
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Hand, Maximize, Minus, MousePointer2, Plus } from 'lucide-react';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './FlowCanvas.module.css';

export interface FlowNodeData extends Record<string, unknown> {
  readonly title: string;
  readonly location: string;
  readonly kind?: FlowNodeKind;
  readonly change?: FlowNodeChange;
}

export type CanvasNode = Node<FlowNodeData, 'flow'>;
export type CanvasEdge = Edge;

/** Our FlowNode as React Flow's node type; the handles only anchor edges (nodes aren't connected by hand). */
const FlowNodeCard = memo(function FlowNodeCard({ data, selected }: NodeProps<CanvasNode>) {
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

const NODE_TYPES = { flow: FlowNodeCard };
const px = (token: keyof typeof baseValues) => Number.parseFloat(baseValues[token]);
const MINIMAP = { width: px('--size-minimap-width'), height: px('--size-minimap-height') };

export const ZOOM = { min: 0.05, max: 2, step: 1.2 } as const;

export type CanvasTool = 'select' | 'pan';

export interface FlowCanvasProps {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  /** Shown over an empty canvas, e.g. "Flows appear here once the project is analysed." */
  readonly empty: ReactNode;
  /** Shown above the canvas, e.g. that these are example nodes. */
  readonly banner?: ReactNode;
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

function Canvas({ nodes: given, edges: givenEdges, empty, banner }: FlowCanvasProps) {
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
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const { zoom } = useViewport();
  const isEmpty = nodes.length === 0;

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
    <div className={styles.canvas} data-tool={tool}>
      {banner !== undefined && (
        <p className={styles.banner} role="note">
          {banner}
        </p>
      )}
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={ZOOM.min}
        maxZoom={ZOOM.max}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomActivationKeyCode={['Control', 'Meta']}
        panActivationKeyCode="Space"
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'pan' ? true : [1, 2]}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        aria-label="Flow canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {!isEmpty && (
          <MiniMap
            position="bottom-left"
            style={{ width: MINIMAP.width, height: MINIMAP.height }}
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
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
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
