import { useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { AgentRegistryVm, ManagedAgentVm, WorkflowDsl, WorkflowEdgeDsl, WorkflowNodeDsl, WorkflowWorkerNodeDsl } from '../types';
import { AppCard } from '@/components/AppCard';
import { CodeBlock, EmptyState } from '@/components/PageScaffold';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const END_NODE = '$end';
const NEW_ROUND_NODE = '$new-round';
const NODE_WIDTH = 220;
const NODE_GAP = 280;

type EditorTab = 'canvas' | 'json';
type EdgeOutcome = 'success' | 'failure' | 'invalid';
type SessionMode = 'new' | 'continue';
type EditorNodeData = { label: string; kind: string; detail: string };

interface WorkflowEditorProps {
  value?: WorkflowDsl | null;
  agentRegistry: AgentRegistryVm | null;
  onSave: (workflow: WorkflowDsl) => Promise<void> | void;
  saving?: boolean;
}

export function WorkflowEditor({ value, agentRegistry, onSave, saving }: WorkflowEditorProps) {
  const { t } = useTranslation();
  const defaultAgent = firstConfiguredAgent(agentRegistry)?.agentType ?? 'claude-code';
  const initialWorkflow = useMemo(() => value ?? createDefaultWorkflow(defaultAgent), [defaultAgent, value]);
  const [workflow, setWorkflow] = useState<WorkflowDsl>(initialWorkflow);
  const [nodes, setNodes] = useState<Node<EditorNodeData>[]>(() => workflowToFlowNodes(initialWorkflow));
  const [edges, setEdges] = useState<Edge[]>(() => workflowToFlowEdges(initialWorkflow));
  const [tab, setTab] = useState<EditorTab>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialWorkflow.nodes[0]?.id ?? null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const agents = agentRegistry?.agents.filter((agent) => agent.supported) ?? [];
  const selectedNode = selectedNodeId ? workflow.nodes.find((node) => node.id === selectedNodeId) ?? null : null;
  const selectedEdgeIndex = selectedEdgeId ? Number(selectedEdgeId.split(':').at(-1)) : -1;
  const selectedEdge = selectedEdgeIndex >= 0 ? workflow.edges[selectedEdgeIndex] ?? null : null;
  const workflowJson = useMemo(() => JSON.stringify(workflow, null, 2), [workflow]);
  const canSave = workflow.nodes.length > 0 && workflow.entry.trim() !== '' && agents.length > 0;

  const syncWorkflow = (next: WorkflowDsl) => {
    setWorkflow(next);
    setNodes(workflowToFlowNodes(next));
    setEdges(workflowToFlowEdges(next));
  };

  const handleNodesChange = (changes: NodeChange<Node<EditorNodeData>>[]) => setNodes((current) => applyNodeChanges(changes, current));
  const handleEdgesChange = (changes: EdgeChange<Edge>[]) => setEdges((current) => applyEdgeChanges(changes, current));
  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const edge: WorkflowEdgeDsl = { from: connection.source, to: connection.target, on: 'success' };
    setWorkflow((current) => ({ ...current, edges: [...current.edges, edge] }));
    setEdges((current) => addEdge({ ...connection, id: edgeId(edge, workflow.edges.length), label: edge.on, markerEnd: { type: MarkerType.ArrowClosed } }, current));
  };

  const applyDefaultTemplate = () => {
    const next = createDefaultWorkflow(defaultAgent);
    syncWorkflow(next);
    setSelectedNodeId(next.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
  };

  const addWorkerNode = () => {
    const nextIndex = workflow.nodes.length + 1;
    const id = uniqueNodeId(workflow, `node-${nextIndex}`);
    const node: WorkflowWorkerNodeDsl = {
      type: 'worker',
      id,
      provider: defaultAgent,
      goal: t('workflowEditor.defaultNodeGoal'),
      primary_artifact: null,
    };
    const next = { ...workflow, nodes: [...workflow.nodes, node] };
    syncWorkflow(next);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId || workflow.nodes.length <= 1) return;
    const nodes = workflow.nodes.filter((node) => node.id !== selectedNodeId);
    const next = {
      ...workflow,
      entry: workflow.entry === selectedNodeId ? nodes[0]?.id ?? '' : workflow.entry,
      nodes,
      edges: workflow.edges.filter((edge) => edge.from !== selectedNodeId && edge.to !== selectedNodeId),
    };
    syncWorkflow(next);
    setSelectedNodeId(next.nodes[0]?.id ?? null);
  };

  const updateNode = (nodeId: string, patch: Partial<WorkflowWorkerNodeDsl>) => {
    const next = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === nodeId && node.type === 'worker' ? { ...node, ...patch } : node),
    };
    syncWorkflow(next);
    if (patch.id && patch.id !== nodeId) setSelectedNodeId(patch.id);
  };

  const updateEdge = (index: number, patch: Partial<WorkflowEdgeDsl>) => {
    const next = {
      ...workflow,
      edges: workflow.edges.map((edge, edgeIndex) => edgeIndex === index ? { ...edge, ...patch } : edge),
    };
    syncWorkflow(next);
    setSelectedEdgeId(next.edges[index] ? edgeId(next.edges[index], index) : null);
  };

  const deleteSelectedEdge = () => {
    if (selectedEdgeIndex < 0) return;
    const next = { ...workflow, edges: workflow.edges.filter((_, index) => index !== selectedEdgeIndex) };
    syncWorkflow(next);
    setSelectedEdgeId(null);
  };

  return (
    <div className="grid min-h-[620px] gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <AppCard className="min-h-0 gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <div className="min-w-0">
            <CardTitle>{t('workflowEditor.title')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{t('workflowEditor.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={tab} onValueChange={(value) => setTab(value as EditorTab)}>
              <TabsList>
                <TabsTrigger value="canvas">{t('workflowEditor.canvas')}</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={applyDefaultTemplate}>{t('workflowEditor.defaultTemplate')}</Button>
            <Button size="sm" disabled={!canSave || saving} onClick={() => onSave(workflow)}>{t('workflowEditor.saveWorkflow')}</Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-0">
          {tab === 'canvas' ? (
            <div className="h-[560px] min-h-0">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
                onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
                nodesDraggable
                nodesConnectable
                elementsSelectable
                fitView
                proOptions={{ hideAttribution: true }}
                className="workflow-graph bg-muted/10"
              >
                <Background color="var(--border)" gap={28} size={1} />
                <Controls showInteractive={false} position="bottom-right" />
              </ReactFlow>
            </div>
          ) : (
            <ScrollArea className="h-[560px] p-4">
              <CodeBlock>{workflowJson}</CodeBlock>
            </ScrollArea>
          )}
        </CardContent>
      </AppCard>
      <AppCard className="min-h-0 gap-0 overflow-hidden py-0">
        <CardHeader className="border-b px-4 py-3">
          <CardTitle>{t('workflowEditor.inspector')}</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 p-0">
          <ScrollArea className="h-[620px]">
            <div className="space-y-4 p-4">
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={addWorkerNode}>{t('workflowEditor.addNode')}</Button>
                <Button className="flex-1" variant="outline" disabled={!selectedNodeId || workflow.nodes.length <= 1} onClick={deleteSelectedNode}>{t('workflowEditor.deleteNode')}</Button>
              </div>
              {!agents.length ? <EmptyState>{t('workflowEditor.noAgents')}</EmptyState> : null}
              {selectedNode ? <NodeInspector node={selectedNode} agents={agents} workflow={workflow} onUpdate={updateNode} t={t} /> : null}
              {selectedEdge ? <EdgeInspector edge={selectedEdge} index={selectedEdgeIndex} workflow={workflow} onUpdate={updateEdge} onDelete={deleteSelectedEdge} t={t} /> : null}
              {!selectedNode && !selectedEdge ? <EmptyState>{t('workflowEditor.selectHint')}</EmptyState> : null}
            </div>
          </ScrollArea>
        </CardContent>
      </AppCard>
    </div>
  );
}

function NodeInspector({ node, agents, workflow, onUpdate, t }: { node: WorkflowNodeDsl; agents: ManagedAgentVm[]; workflow: WorkflowDsl; onUpdate: (nodeId: string, patch: Partial<WorkflowWorkerNodeDsl>) => void; t: (key: string, options?: Record<string, unknown>) => string }) {
  if (node.type !== 'worker') {
    return <EmptyState>{t('workflowEditor.legacyNodeReadonly')}</EmptyState>;
  }
  const validationEnabled = Boolean(node.output && node.success_condition);
  return (
    <div className="space-y-3 rounded-xl border bg-card/45 p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{t('workflowEditor.nodeConfig')}</strong>
        <Badge variant="outline">worker</Badge>
      </div>
      <Field label={t('workflowEditor.nodeId')}>
        <input className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={node.id} onChange={(event) => onUpdate(node.id, { id: sanitizeNodeId(event.target.value, workflow) })} />
      </Field>
      <Field label={t('workflowEditor.agent')}>
        <Select value={node.provider ?? ''} onValueChange={(provider) => onUpdate(node.id, { provider })}>
          <SelectTrigger><SelectValue placeholder={t('workflowEditor.selectAgent')} /></SelectTrigger>
          <SelectContent>{agents.map((agent) => <SelectItem value={agent.agentType} key={agent.agentType}>{agent.displayName}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('workflowEditor.profile')}>
        <input className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={node.profile ?? ''} onChange={(event) => onUpdate(node.id, { profile: event.target.value || null })} />
      </Field>
      <Field label={t('workflowEditor.goal')}>
        <Textarea value={node.goal ?? ''} onChange={(event) => onUpdate(node.id, { goal: event.target.value })} />
      </Field>
      <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
        {t('workflowEditor.manualCheckPlaceholder')}
      </div>
      <div className="space-y-3 rounded-lg border bg-muted/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('workflowEditor.outputValidation')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdate(node.id, validationEnabled ? { output: null, success_condition: null, primary_artifact: null } : defaultValidationPatch(node.id))}
          >
            {validationEnabled ? t('workflowEditor.disable') : t('workflowEditor.enable')}
          </Button>
        </div>
        {validationEnabled ? (
          <>
            <Field label={t('workflowEditor.outputArtifact')}>
              <input className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={node.output?.artifact ?? ''} onChange={(event) => onUpdate(node.id, { primary_artifact: event.target.value, output: { kind: 'json', artifact: event.target.value } })} />
            </Field>
            <Field label={t('workflowEditor.successPath')}>
              <input className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={node.success_condition?.path ?? ''} onChange={(event) => onUpdate(node.id, { success_condition: { path: event.target.value, equals: node.success_condition?.equals ?? true } })} />
            </Field>
            <Field label={t('workflowEditor.successEquals')}>
              <input className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={String(node.success_condition?.equals ?? true)} onChange={(event) => onUpdate(node.id, { success_condition: { path: node.success_condition?.path ?? 'passed', equals: parseJsonScalar(event.target.value) } })} />
            </Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

function EdgeInspector({ edge, index, workflow, onUpdate, onDelete, t }: { edge: WorkflowEdgeDsl; index: number; workflow: WorkflowDsl; onUpdate: (index: number, patch: Partial<WorkflowEdgeDsl>) => void; onDelete: () => void; t: (key: string) => string }) {
  return (
    <div className="space-y-3 rounded-xl border bg-card/45 p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{t('workflowEditor.edgeConfig')}</strong>
        <Button size="sm" variant="outline" onClick={onDelete}>{t('workflowEditor.deleteEdge')}</Button>
      </div>
      <Field label={t('workflowEditor.edgeOutcome')}>
        <Select value={edge.on} onValueChange={(on) => onUpdate(index, { on: on as EdgeOutcome })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{(['success', 'failure', 'invalid'] as EdgeOutcome[]).map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('workflowEditor.edgeTarget')}>
        <Select value={edge.to} onValueChange={(to) => onUpdate(index, { to })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {workflow.nodes.map((node) => <SelectItem value={node.id} key={node.id}>{node.id}</SelectItem>)}
            <SelectItem value={END_NODE}>{END_NODE}</SelectItem>
            <SelectItem value={NEW_ROUND_NODE}>{NEW_ROUND_NODE}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('workflowEditor.sessionMode')}>
        <Select value={edge.session ?? 'new'} onValueChange={(session) => onUpdate(index, { session: session as SessionMode })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="new">new</SelectItem>
            <SelectItem value="continue">continue</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function workflowToFlowNodes(workflow: WorkflowDsl): Node<EditorNodeData>[] {
  return workflow.nodes.map((node, index) => ({
    id: node.id,
    position: { x: index * NODE_GAP, y: index % 2 === 0 ? 80 : 220 },
    data: {
      label: node.id,
      kind: node.type,
      detail: node.type === 'worker' ? node.goal ?? '' : node.type,
    },
    style: { width: NODE_WIDTH, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--card-foreground)' },
  }));
}

function workflowToFlowEdges(workflow: WorkflowDsl): Edge[] {
  return workflow.edges.map((edge, index) => ({
    id: edgeId(edge, index),
    source: edge.from,
    target: workflow.nodes.some((node) => node.id === edge.to) ? edge.to : edge.from,
    label: edge.to === NEW_ROUND_NODE || edge.to === END_NODE ? `${edge.on} → ${edge.to}` : edge.on,
    animated: edge.on === 'failure',
    markerEnd: { type: MarkerType.ArrowClosed },
    className: cn(edge.on === 'failure' && 'text-destructive'),
  }));
}

function edgeId(edge: WorkflowEdgeDsl, index: number) {
  return `${edge.from}:${edge.to}:${edge.on}:${index}`;
}

function firstConfiguredAgent(registry: AgentRegistryVm | null) {
  return registry?.agents.find((agent) => agent.supported) ?? null;
}

export function parseWorkflowJson(json?: string | null): WorkflowDsl | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as WorkflowDsl;
    return value?.version && Array.isArray(value.nodes) ? value : null;
  } catch {
    return null;
  }
}

export function createDefaultWorkflow(provider: string): WorkflowDsl {
  const worker = (id: string, goal: string, validation = false): WorkflowWorkerNodeDsl => ({
    type: 'worker',
    id,
    provider,
    goal,
    primary_artifact: validation ? `${id}-result` : null,
    output: validation ? { kind: 'json', artifact: `${id}-result` } : null,
    success_condition: validation ? { path: 'passed', equals: true } : null,
  });
  return {
    version: '0.1',
    id: 'task-workflow',
    entry: 'plan',
    control: { max_repair_loops: 3, max_acceptance_loops: 1, on_acceptance_failure: 'stop' },
    nodes: [
      worker('plan', 'Analyze the imported requirement and produce an implementation plan.'),
      worker('dev', 'Implement the requirement in the workspace.'),
      worker('review', 'Review the implementation and return JSON with {"passed": boolean}.', true),
      worker('test', 'Run or describe verification and return JSON with {"passed": boolean}.', true),
      worker('accept', 'Validate acceptance and return JSON with {"passed": boolean}.', true),
    ],
    edges: [
      { from: 'plan', to: 'dev', on: 'success' },
      { from: 'dev', to: 'review', on: 'success' },
      { from: 'review', to: 'test', on: 'success' },
      { from: 'review', to: 'dev', on: 'failure', session: 'continue' },
      { from: 'test', to: 'accept', on: 'success' },
      { from: 'test', to: 'dev', on: 'failure', session: 'continue' },
      { from: 'accept', to: END_NODE, on: 'success' },
      { from: 'accept', to: NEW_ROUND_NODE, on: 'failure' },
    ],
  };
}

function uniqueNodeId(workflow: WorkflowDsl, base: string) {
  let candidate = base;
  let index = 1;
  while (workflow.nodes.some((node) => node.id === candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }
  return candidate;
}

function sanitizeNodeId(value: string, workflow: WorkflowDsl) {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  if (!sanitized) return uniqueNodeId(workflow, 'node');
  return sanitized;
}

function defaultValidationPatch(nodeId: string): Partial<WorkflowWorkerNodeDsl> {
  const artifact = `${nodeId}-result`;
  return {
    primary_artifact: artifact,
    output: { kind: 'json', artifact },
    success_condition: { path: 'passed', equals: true },
  };
}

function parseJsonScalar(value: string) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const number = Number(value);
  if (!Number.isNaN(number) && value.trim() !== '') return number;
  return value;
}
