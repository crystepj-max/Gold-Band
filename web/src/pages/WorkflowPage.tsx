import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunGroupVm, TaskPage, WorkflowVm } from '../types';
import { displayPolicy, displayStatus } from '../i18n';
import { GraphView } from '../components/GraphView';
import { StatusBadge } from '../components/StatusBadge';
import { AppCard } from '@/components/AppCard';
import { EmptyState, Metric, MetricsBar, ModuleBar, Page, PageHeader } from '@/components/PageScaffold';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface WorkflowPageProps {
  vm: WorkflowVm | null;
  busy: boolean;
  onNavigate: (page: TaskPage) => void;
  onStartRun: (taskId: string) => void;
  onContinueRun: (taskId: string, runId: string) => void;
  onKillRun: (taskId: string, runId: string) => void;
}

type StatusFilter = 'all' | 'running' | 'paused' | 'completed' | 'failed' | 'resumable';
type SortDir = 'asc' | 'desc';
const pageSizes = [5, 10, 20];

export function WorkflowPage({ vm, busy, onNavigate, onStartRun, onContinueRun, onKillRun }: WorkflowPageProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(5);

  if (!vm) return <Page><EmptyState>{t('common.loading')}</EmptyState></Page>;
  const activeRun = vm.runs.find((group) => group.run.status === 'running' || group.run.status === 'paused')?.run ?? vm.runs[0]?.run;
  const filteredRuns = vm.runs.filter((group) => matchesRunFilter(group, statusFilter));
  const sortedRuns = [...filteredRuns].sort((left, right) => left.run.id.localeCompare(right.run.id, undefined, { numeric: true }) * (sortDir === 'asc' ? 1 : -1));
  const pageCount = Math.max(1, Math.ceil(sortedRuns.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRuns = sortedRuns.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);

  return (
    <Page flush className="flex flex-col">
      <ModuleBar
        title={t('workflow.moduleTitle')}
        tabs={<Tabs value="runs"><TabsList><TabsTrigger value="overview">{t('workflow.overview')}</TabsTrigger><TabsTrigger value="runs">{t('workflow.runs')}</TabsTrigger><TabsTrigger value="nodes">{t('workflow.nodes')}</TabsTrigger><TabsTrigger value="artifacts">{t('workflow.artifacts')}</TabsTrigger></TabsList></Tabs>}
        actions={<><Button disabled={busy || !vm.task.workflowValid} onClick={() => onStartRun(vm.task.id)}>{t('common.startRun')}</Button><Button variant="outline" disabled={busy || !activeRun?.resumable} onClick={() => activeRun && onContinueRun(vm.task.id, activeRun.id)}>{t('common.continueRun')}</Button></>}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-6">
          <PageHeader
            eyebrow={vm.task.id}
            title={vm.task.title}
            subtitle={<>{t('workflow.requirementSummary', { summary: vm.task.requirementPreview || vm.task.description || '-' })}{activeRun?.currentNode ? <span className="ml-2 text-primary">{t('workflow.currentStatus', { node: activeRun.currentNode })}</span> : null}</>}
            actions={<><Button variant="outline" disabled>{t('workflow.viewRequirement')}</Button>{activeRun && (activeRun.status === 'running' || activeRun.status === 'paused') ? <Button variant="destructive" disabled={busy} onClick={() => onKillRun(vm.task.id, activeRun.id)}>{t('common.stopRun')}</Button> : null}</>}
          />
          <MetricsBar>
            <Metric label={t('workflow.taskId')} value={vm.task.id} />
            <Metric label={t('workflow.workflowStatus')} value={vm.task.workflowValid ? displayStatus(t, 'valid') : vm.task.workflowExists ? displayStatus(t, 'invalid') : displayStatus(t, 'missing-workflow')} />
            <Metric label={t('workflow.activeRun')} value={activeRun?.id ?? '-'} />
            <Metric label={t('common.outcome')} value={displayStatus(t, activeRun?.outcome ?? activeRun?.status ?? vm.task.displayStatus)} />
            <Metric label={t('common.artifacts')} value={vm.task.artifactCount} />
          </MetricsBar>
          <AppCard className="gap-0 py-0">
            <CardHeader className="border-b px-5 py-4"><CardTitle>{t('workflow.blueprintTitle')}</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4">
              {vm.control ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-muted/20 p-2">
                  <ControlPill label={t('workflow.maxRepairLoops')} value={vm.control.maxRepairLoops} />
                  <ControlPill label={t('workflow.maxAcceptanceLoops')} value={vm.control.maxAcceptanceLoops} />
                  <ControlPill label={t('workflow.onAcceptanceFailure')} value={displayPolicy(t, vm.control.onAcceptanceFailure)} />
                </div>
              ) : null}
              <GraphView graph={vm.graph} variant="workflow" />
            </CardContent>
          </AppCard>
          <AppCard className="py-0">
            <CardHeader className="flex-row items-center justify-between gap-3 border-b py-5">
              <CardTitle>{t('workflow.historyTitle')}</CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{t('common.filterByStatus')}</span>
                <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value as StatusFilter); setPageIndex(0); }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['all', 'running', 'paused', 'completed', 'failed', 'resumable'] as StatusFilter[]).map((value) => <SelectItem value={value} key={value}>{value === 'all' ? t('common.all') : displayStatus(t, value)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => setSortDir((value) => value === 'asc' ? 'desc' : 'asc')}>{t('common.sort')} {sortDir === 'asc' ? '↑' : '↓'}</Button>
              </div>
            </CardHeader>
            <CardContent className="px-5 py-5">
              <div className="overflow-x-auto rounded-xl border">
                <Table className="min-w-[1120px] table-fixed">
                  <colgroup>
                    <col className="w-[12%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[18%]" />
                    <col className="w-[8%]" />
                    <col className="w-[14%]" />
                    <col className="w-[10%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow><TableHead>{t('workflow.idGroup')}</TableHead><TableHead>{t('common.status')}</TableHead><TableHead>{t('common.outcome')}</TableHead><TableHead>{t('common.trigger')}</TableHead><TableHead>{t('common.loops')}</TableHead><TableHead>{t('workflow.currentNode')}</TableHead><TableHead>{t('common.artifacts')}</TableHead><TableHead className="sticky right-0 z-10 bg-card text-right shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.45)]">{t('common.action')}</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedRuns.flatMap((group) => [
                      <TableRow className="bg-muted/30" key={group.run.id}>
                        <TableCell><span className="font-mono font-semibold">⌄ {group.run.id}</span></TableCell>
                        <TableCell><StatusBadge value={group.run.status} label={displayStatus(t, group.run.status)} /></TableCell>
                        <TableCell><StatusBadge value={group.run.outcome} label={displayStatus(t, group.run.outcome)} /></TableCell>
                        <TableCell className="text-muted-foreground">{displayStatus(t, group.run.pauseReason ?? group.run.outcome ?? 'observed')}</TableCell>
                        <TableCell className="text-muted-foreground">{group.rounds.length}</TableCell>
                        <TableCell className="text-primary">{group.run.currentNode ?? '-'}</TableCell>
                        <TableCell><Badge variant="secondary">{group.rounds.reduce((sum, round) => sum + round.artifactCount, 0)}</Badge></TableCell>
                        <TableCell className="sticky right-0 z-10 space-x-2 bg-muted text-right shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.45)]">{group.run.resumable ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onContinueRun(vm.task.id, group.run.id)}>{t('common.continueRun')}</Button> : null}{group.run.status === 'running' || group.run.status === 'paused' ? <Button variant="destructive" size="sm" disabled={busy} onClick={() => onKillRun(vm.task.id, group.run.id)}>{t('common.stopRun')}</Button> : null}{!group.run.resumable && group.run.status !== 'running' && group.run.status !== 'paused' ? <span className="inline-flex h-8 items-center justify-end px-3 text-muted-foreground">-</span> : null}</TableCell>
                      </TableRow>,
                      ...group.rounds.map((round) => (
                        <TableRow className="cursor-pointer" key={`${group.run.id}-${round.id}`} onClick={() => onNavigate({ kind: 'round-detail', taskId: vm.task.id, runId: group.run.id, roundId: round.id })}>
                          <TableCell className="font-mono text-muted-foreground">└ {round.id}</TableCell>
                          <TableCell><StatusBadge value={round.status} label={displayStatus(t, round.status)} /></TableCell>
                          <TableCell><StatusBadge value={round.outcome} label={displayStatus(t, round.outcome)} /></TableCell>
                          <TableCell className="text-muted-foreground">{displayStatus(t, round.trigger)}</TableCell>
                          <TableCell className="text-muted-foreground">{round.repairLoopsUsed}</TableCell>
                          <TableCell className="text-muted-foreground">{t('workflow.nodeValue', { node: round.currentNode ?? '-' })}</TableCell>
                          <TableCell className="text-muted-foreground">{t('workflow.assetCounts', { artifacts: round.artifactCount, attachments: round.attachmentCount })}</TableCell>
                          <TableCell className="sticky right-0 z-10 bg-card text-right shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.45)]"><Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); onNavigate({ kind: 'round-detail', taskId: vm.task.id, runId: group.run.id, roundId: round.id }); }}>{t('workflow.openRound')}</Button></TableCell>
                        </TableRow>
                      )),
                    ])}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>{t('workflow.groupsRange', { start: sortedRuns.length ? safePageIndex * pageSize + 1 : 0, end: Math.min(sortedRuns.length, (safePageIndex + 1) * pageSize), total: sortedRuns.length })}</span>
                <div className="flex items-center gap-2">
                  <span>{t('common.pageSize')}</span>
                  <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPageIndex(0); }}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>{pageSizes.map((value) => <SelectItem value={String(value)} key={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" disabled={safePageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>{t('common.previousPage')}</Button>
                  <Button variant="outline" size="sm" disabled={safePageIndex >= pageCount - 1} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>{t('common.nextPage')}</Button>
                </div>
              </div>
            </CardContent>
          </AppCard>
        </div>
      </ScrollArea>
    </Page>
  );
}

function ControlPill({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-9 min-w-[176px] flex-1 items-center justify-between gap-3 rounded-lg border bg-card/55 px-3 py-1.5">
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <strong className="shrink-0 text-sm text-foreground">{value}</strong>
    </div>
  );
}

function matchesRunFilter(group: RunGroupVm, filter: StatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'failed') return group.run.outcome === 'failure' || group.rounds.some((round) => round.outcome === 'failure');
  if (filter === 'resumable') return group.run.resumable;
  return group.run.status === filter || group.rounds.some((round) => round.status === filter);
}
