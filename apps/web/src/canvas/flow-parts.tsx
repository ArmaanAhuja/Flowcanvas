// The flow's own parts on the canvas (phase 7): decisions, the open ends (stubs), groups (phase 12), and edges drawn by how each is known.
import { DecisionNode, FlowStub, GroupNode } from '@flowcanvas/ui';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { createContext, memo, useContext } from 'react';
import { Clock } from 'lucide-react';
import type { DecisionData, FlowEdgeData, GroupData, LaneData, StubData } from '../flow/layout';
import { CORNER, pointAlong, routePath } from '../flow/route';
import styles from './FlowCanvas.module.css';

export type DecisionCanvasNode = Node<DecisionData, 'decision'>;
export type StubCanvasNode = Node<StubData, 'stub'>;
export type LaneCanvasNode = Node<LaneData, 'lane'>;
export type GroupCanvasNode = Node<GroupData, 'group'>;

/** Opens or closes a group by its id: the page's, given to the canvas (phase 12). */
export const GroupToggle = createContext<(id: string) => void>(() => undefined);

/**
 * A group of the flow's nodes (phase 12): closed, a stacked card; open, a frame its members are drawn in, over the
 * canvas. Its header opens and closes it.
 */
export const GroupCard = memo(function GroupCard({
  id,
  data,
  selected,
}: NodeProps<GroupCanvasNode>) {
  const toggle = useContext(GroupToggle);
  return (
    <>
      <Anchors />
      <GroupNode
        title={data.title}
        count={data.count}
        kind={data.kind}
        expanded={data.expanded}
        selected={selected}
        onToggle={() => {
          toggle(id);
        }}
      />
    </>
  );
});

/** The background lane (phase 11): a labelled frame behind what handed-off work runs. */
export const LaneCard = memo(function LaneCard({ data }: NodeProps<LaneCanvasNode>) {
  return (
    <div className={styles.lane} role="group" aria-label={`${data.label} lane`}>
      <span className={styles.laneLabel}>{data.label}</span>
    </div>
  );
});
export type FlowCanvasEdge = Edge<FlowEdgeData, 'flow'>;

const Anchors = ({ target = true, source = true }: { target?: boolean; source?: boolean }) => (
  <>
    {target && (
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={styles.handle}
      />
    )}
    {source && (
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={styles.handle}
      />
    )}
  </>
);

export const DecisionCard = memo(function DecisionCard({
  data,
  selected,
}: NodeProps<DecisionCanvasNode>) {
  return (
    <>
      <Anchors />
      <DecisionNode condition={data.condition} selected={selected} />
    </>
  );
});

export const StubCard = memo(function StubCard({ data, selected }: NodeProps<StubCanvasNode>) {
  return (
    <>
      <Anchors source={false} />
      <FlowStub variant={data.variant} count={data.count} selected={selected} />
    </>
  );
});

/**
 * An edge by Graphite's provenance forms: resolved solid in edge/default; observed solid in edge/observed; suggested
 * dotted; unknown, to a stub, a plain line with no arrow (the stub draws its hollow circle). A `catch`'s outcome is a
 * failure path, a thin line in the removed hue (design brief). An outcome label sits on the edge.
 */
export const FlowEdge = memo(function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<FlowCanvasEdge>) {
  // ELK's route around the nodes when there is one (always, once laid out); a step between the handles otherwise.
  const route = data?.route;
  const routed = route !== undefined && route.length >= 2;
  const along = routed ? pointAlong(route) : null;
  const [path, labelX, labelY] = routed
    ? [routePath(route), along?.x ?? 0, along?.y ?? 0]
    : getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: CORNER,
      });
  const form = data?.failure === true ? 'failure' : (data?.provenance ?? 'resolved');
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={styles.edge}
        data-form={form}
        data-selected={selected === true || undefined}
        data-highlighted={data?.highlighted === true || undefined}
        data-dimmed={data?.highlighted === false || undefined}
        {...(data?.stub === true ? {} : { markerEnd })}
      />
      {data !== undefined &&
        (data.badge !== undefined || data.handoff === true) &&
        data.label === null && (
          <EdgeLabelRenderer>
            <span
              className={`${styles.edgeBadge ?? ''} nodrag nopan`}
              style={{
                transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
              }}
            >
              {data.handoff === true && <Clock size={12} aria-label="Handed off" role="img" />}
              {data.badge}
            </span>
          </EdgeLabelRenderer>
        )}
      {data?.label != null && (
        <EdgeLabelRenderer>
          <span
            className={`${styles.edgeLabel ?? ''} nodrag nopan`}
            data-form={form}
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
