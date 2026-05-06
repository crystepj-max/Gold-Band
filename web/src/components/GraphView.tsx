import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import dagre from 'dagre';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { GraphNodeVm, GraphVm } from '../types';
import { displayStatus } from '../i18n';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/PageScaffold';
import { StatusBadge } from './StatusBadge';
import { cn } from '@/lib/utils';
import { normalizeTone, toneSurfaceClass } from '@/lib/status';

const NODE_WIDTH = 226;
const NODE_HEIGHT = 138;
const NODE_GAP_X = 112;
const NODE_GAP_Y = 72;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.2;
const WORKFLOW_FIT_MAX_ZOOM = 0.88;
const ACTUAL_FIT_MAX_ZOOM = 0.82;

type GraphMode = 'readonly' | 'interactive';

type WorkflowNodeData = {
  node: GraphNodeVm;
  selected: boolean;
  mode: GraphMode;
  currentLabel: string;
  statusLabel: string;
};

interface GraphViewProps {
  graph: GraphVm;
  selectedNodeId?: string | null;
  onNodeSelect?: (node: GraphNodeVm) => void;
  onNodeOpenDetail?: (node: GraphNodeVm) => void;
  onNodeOpenSession?: (node: GraphNodeVm) => void;
  variant?: 'grid' | 'workflow' | 'actual';
}

const nodeTypes = {
  workflowNode: WorkflowNode,
};

export function GraphView({ graph, selectedNodeId, onNodeSelect, onNodeOpenDetail, onNodeOpenSession, variant = 'grid' }: GraphViewProps) {
  const { t } = useTranslation();
  const mode: GraphMode = variant === 'actual' ? 'interactive' : 'readonly';
  const { nodes, edges } = useMemo(() => createLayoutedGraph(graph, selectedNodeId, mode, t), [graph, selectedNodeId, mode, t]);
  const [menu, setMenu] = useState<{ x: number; y: number; node: GraphNodeVm } | null>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<WorkflowNodeData>) => {
    onNodeSelect?.(node.data.node);
  }, [onNodeSelect]);

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node<WorkflowNodeData>) => {
    onNodeOpenDetail?.(node.data.node);
  }, [onNodeOpenDetail]);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node<WorkflowNodeData>) => {
    if (mode !== 'interactive') return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, node: node.data.node });
  }, [mode]);

  if (graph.nodes.length === 0) {
    return <EmptyState>{t('graph.emptyGraph')}</EmptyState>;
  }

  return (
    <div className={cn('relative min-w-0 overflow-hidden rounded-xl border bg-muted/15', variant === 'workflow' ? 'h-[360px]' : 'h-full min-h-[300px]')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: variant === 'workflow' ? 0.2 : 0.18, maxZoom: variant === 'workflow' ? WORKFLOW_FIT_MAX_ZOOM : ACTUAL_FIT_MAX_ZOOM }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={mode === 'interactive'}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        preventScrolling
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        className="workflow-graph"
      >
        <Background color="var(--border)" gap={28} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border bg-card/85 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground shadow-sm backdrop-blur">
        {mode === 'interactive' ? t('graph.executionGraph') : t('graph.workflowBlueprint')}
      </div>
      {menu ? (
        <div
          role="menu"
          className="fixed z-50 min-w-36 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <GraphMenuItem onClick={() => onNodeOpenDetail?.(menu.node)}>{t('graph.viewNodeDetail')}</GraphMenuItem>
          <GraphMenuItem disabled={!menu.node.attemptId} onClick={() => onNodeOpenSession?.(menu.node)}>{t('graph.viewSession')}</GraphMenuItem>
          <GraphMenuItem onClick={() => navigator.clipboard?.writeText(menu.node.nodeId ?? menu.node.id)}>{t('graph.copyNodeId')}</GraphMenuItem>
          <GraphMenuItem disabled>{t('graph.retryFromNode')}</GraphMenuItem>
        </div>
      ) : null}
    </div>
  );
}

function createLayoutedGraph(graph: GraphVm, selectedNodeId: string | null | undefined, mode: GraphMode, t: TFunction) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: NODE_GAP_Y, ranksep: NODE_GAP_X, marginx: 40, marginy: 36 });

  graph.nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  graph.edges.forEach((edge) => {
    dagreGraph.setEdge(edge.from, edge.to);
  });
  dagre.layout(dagreGraph);

  const nodes: Node<WorkflowNodeData>[] = graph.nodes.map((node) => {
    const layout = dagreGraph.node(node.id);
    return {
      id: node.id,
      type: 'workflowNode',
      position: {
        x: layout.x - NODE_WIDTH / 2,
        y: layout.y - NODE_HEIGHT / 2,
      },
      data: {
        node,
        selected: selectedNodeId === node.id || selectedNodeId === node.nodeId,
        mode,
        currentLabel: t('graph.current'),
        statusLabel: displayStatus(t, node.status ?? node.outcome),
      },
      draggable: false,
      selectable: mode === 'interactive',
    };
  });

  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `${edge.from}-${edge.to}-${index}`,
    source: edge.from,
    target: edge.to,
    label: edge.label || undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.8 },
    labelStyle: { fill: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em' },
    labelBgStyle: { fill: 'var(--card)', fillOpacity: 0.92 },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 999,
  }));

  return { nodes, edges };
}

function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  const { node, selected, mode, currentLabel, statusLabel } = data;
  const tone = normalizeTone(node.status ?? node.outcome);
  return (
    <div
      className={cn(
        'relative h-[138px] w-[226px] overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow',
        toneSurfaceClass(node.status ?? node.outcome),
        node.artifactCount > 0 && 'border-gold-warning/60 bg-gold-warning/10',
        node.attachmentCount > 0 && 'ring-1 ring-slate-400/45 shadow-[0_0_0_1px_rgba(148,163,184,0.22)]',
        node.current && 'ring-2 ring-primary/55',
        selected && 'border-primary bg-primary/10 text-primary shadow-[0_0_0_1px_rgba(245,158,11,0.3)]',
        mode === 'interactive' && 'cursor-pointer hover:shadow-md',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-2 !border-card !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!size-2 !border-2 !border-card !bg-muted-foreground" />
      <div className={cn('h-1 w-full', tone === 'success' && 'bg-gold-success', tone === 'running' && 'bg-gold-running', tone === 'warning' && 'bg-gold-warning', tone === 'danger' && 'bg-gold-danger', tone === 'neutral' && 'bg-muted-foreground')} />
      <div className="flex h-[48px] items-start justify-between gap-3 border-b bg-card/55 px-4 py-2.5">
        <div className="min-w-0">
          <strong className="block truncate font-mono text-[13px] leading-tight">{node.nodeId ?? node.id}</strong>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{node.nodeType}</span>
        </div>
        {node.current ? <Badge className="shrink-0 text-[10px]">{currentLabel}</Badge> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-between px-4 py-3">
        <p className="line-clamp-2 text-sm leading-6 text-foreground">{node.label}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={node.status ?? node.outcome} label={statusLabel} />
          {node.artifactCount > 0 ? <Badge variant="secondary" className="font-mono text-[10px]">A{node.artifactCount}</Badge> : null}
          {node.attachmentCount > 0 ? <Badge variant="secondary" className="font-mono text-[10px]">P{node.attachmentCount}</Badge> : null}
        </div>
      </div>
    </div>
  );
}

function GraphMenuItem({ children, disabled = false, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center rounded-sm px-2 py-1.5 text-left outline-hidden hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      onClick={() => onClick?.()}
    >
      {children}
    </button>
  );
}
