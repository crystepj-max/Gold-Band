import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskListVm, TaskPage, TaskRowVm } from '../types';
import { displayStatus } from '../i18n';
import { StatusBadge } from '../components/StatusBadge';
import { AppCard } from '@/components/AppCard';
import { CodeBlock, EmptyState, Page, PageHeader } from '@/components/PageScaffold';
import { fullRequirementText } from '@/components/RequirementDisclosure';
import { TaskTableSkeleton } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type TaskListLoading = 'initial' | 'manual' | null;

interface TaskListPageProps {
  vm: TaskListVm | null;
  loading: TaskListLoading;
  breadcrumbs?: ReactNode;
  onNavigate: (page: TaskPage) => void;
  onRefresh: () => void;
}

type TaskFilter = 'all' | 'running' | 'completed' | 'resumable' | 'failed' | 'invalid';
type TaskSortKey = 'id' | 'title' | 'status' | 'workflow' | 'latest';
type SortDir = 'asc' | 'desc';

const pageSizes = [10, 20, 50];

export function TaskListPage({ vm, loading, breadcrumbs, onNavigate, onRefresh }: TaskListPageProps) {
  const { t } = useTranslation();
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<TaskSortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const isInitialLoading = loading === 'initial';
  const isManualRefreshing = loading === 'manual' && vm !== null;

  const filteredTasks = useMemo(() => {
    const tasks = (vm?.tasks ?? []).filter((task) => matchesTaskFilter(task, filter));
    const query = searchTerm.trim().toLowerCase();
    if (!query) return tasks;
    return tasks.filter((task) => taskSearchText(task, t).includes(query));
  }, [filter, searchTerm, t, vm]);

  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((left, right) => compareTasks(left, right, sortKey, sortDir));
  }, [filteredTasks, sortDir, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedTasks.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedTasks = sortedTasks.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize);
  const previewTask = useMemo(() => {
    if (!previewTaskId) return null;
    return sortedTasks.find((task) => task.id === previewTaskId) ?? null;
  }, [previewTaskId, sortedTasks]);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [pageIndex, safePageIndex]);

  useEffect(() => {
    if (!previewTaskId) return;
    if (sortedTasks.some((task) => task.id === previewTaskId)) return;
    setPreviewTaskId(null);
    setIsPreviewOpen(false);
  }, [previewTaskId, sortedTasks]);

  const toggleSort = (key: TaskSortKey) => {
    if (sortKey === key) {
      setSortDir((current) => current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const updateFilter = (value: TaskFilter) => {
    setFilter(value);
    setPageIndex(0);
  };

  const updateSearchTerm = (value: string) => {
    setSearchTerm(value);
    setPageIndex(0);
  };

  const quickFilterValue = filter === 'running' || filter === 'completed' ? filter : 'all';
  const statusFilterValue = filter === 'resumable' || filter === 'failed' || filter === 'invalid' ? filter : 'all';

  const closePreview = () => {
    setIsPreviewOpen(false);
    setPreviewTaskId(null);
  };

  const openPreview = (taskId: string) => {
    setPreviewTaskId(taskId);
    setIsPreviewOpen(true);
  };

  return (
    <Page flush className="flex flex-col" onContextMenu={(event) => event.preventDefault()}>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={t('taskList.title')}
        subtitle={t('taskList.subtitle')}
        actions={(
          <>
            <Button variant="outline" disabled={isInitialLoading || isManualRefreshing} onClick={onRefresh}>
              <RefreshCw className={cn(isManualRefreshing && 'animate-spin')} />
              {t('common.refresh')}
            </Button>
            <Button disabled>{t('taskList.createTask')}</Button>
            <Button variant="outline" disabled>{t('taskList.importRequirements')}</Button>
          </>
        )}
      />

      {isInitialLoading && !vm ? <TaskListSkeletonPage /> : null}
      {vm ? (
        <div className="min-h-0 flex-1 p-5 xl:p-6">
          <ScrollArea className="h-full min-h-0 min-w-0">
            <div className="space-y-5 pr-1">
              <AppCard className="relative overflow-hidden py-0 shadow-none">
                {isManualRefreshing ? <div className="absolute inset-x-0 top-0 z-10 h-px bg-border" /> : null}
                <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-foreground">{t('taskList.taskList')}</h2>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:justify-end">
                    <Tabs value={quickFilterValue} onValueChange={(value) => updateFilter(value as TaskFilter)}>
                      <TabsList>
                        <TabsTrigger value="all">{t('taskList.allTasks')}</TabsTrigger>
                        <TabsTrigger value="running">{t('taskList.runningTasks')}</TabsTrigger>
                        <TabsTrigger value="completed">{t('taskList.completedTasks')}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <Select value={statusFilterValue} onValueChange={(value) => updateFilter(value as TaskFilter)}>
                      <SelectTrigger className="w-[148px]" aria-label={t('taskList.statusFilter')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('taskList.allStatuses')}</SelectItem>
                        <SelectItem value="resumable">{displayStatus(t, 'resumable')}</SelectItem>
                        <SelectItem value="failed">{displayStatus(t, 'failed')}</SelectItem>
                        <SelectItem value="invalid">{t('taskList.configIssues')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <label className="min-w-[220px] flex-1 lg:max-w-sm">
                      <span className="sr-only">{t('taskList.search')}</span>
                      <input
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        value={searchTerm}
                        onChange={(event) => updateSearchTerm(event.target.value)}
                        placeholder={t('taskList.searchPlaceholder')}
                      />
                    </label>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table className="w-full min-w-[820px] table-fixed">
                    <colgroup>
                      <col className="w-[12%]" />
                      <col className="w-[40%]" />
                      <col className="w-[13%]" />
                      <col className="w-[12%]" />
                      <col className="w-[13%]" />
                      <col className="w-[10%]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <SortableHead label={t('taskList.id')} sortKey="id" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                        <SortableHead label={t('taskList.taskTitle')} sortKey="title" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                        <SortableHead label={t('common.status')} sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                        <SortableHead label={t('common.workflow')} sortKey="workflow" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                        <SortableHead label={t('taskList.latest')} sortKey="latest" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                        <TableHead className="pr-4 text-right">{t('common.action')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedTasks.map((task) => (
                        <TableRow
                          className={cn('cursor-pointer', isPreviewOpen && previewTask?.id === task.id && 'bg-primary/10 hover:bg-primary/15')}
                          data-task-preview-row="true"
                          key={task.id}
                          onClick={() => openPreview(task.id)}
                          onDoubleClick={() => onNavigate({ kind: 'workflow', taskId: task.id })}
                        >
                          <TableCell className="truncate text-xs font-medium text-muted-foreground">{task.id}</TableCell>
                          <TableCell className="min-w-0">
                            <strong className="block truncate text-sm">{task.title}</strong>
                            <small className="block truncate text-muted-foreground">{task.requirementPreview || task.description}</small>
                          </TableCell>
                          <TableCell className="truncate"><StatusBadge value={task.displayStatus} label={displayStatus(t, task.displayStatus)} /></TableCell>
                          <TableCell className="truncate"><WorkflowState task={task} /></TableCell>
                          <TableCell className="truncate text-xs font-medium text-muted-foreground">{task.latestRun?.id ?? t('taskList.noRun')}</TableCell>
                          <TableCell className="pr-4 text-right">
                            <Button variant="link" size="sm" className="px-0" onClick={(event) => { event.stopPropagation(); onNavigate({ kind: 'workflow', taskId: task.id }); }}>{t('taskList.enter')}</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {sortedTasks.length === 0 ? <div className="p-5"><EmptyState>{vm.tasks.length === 0 ? t('taskList.noTasks') : t('taskList.noMatchingTasks')}</EmptyState></div> : null}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
                  <span className="shrink-0">{t('common.pageRange', { start: sortedTasks.length ? safePageIndex * pageSize + 1 : 0, end: Math.min(sortedTasks.length, (safePageIndex + 1) * pageSize), total: sortedTasks.length })}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{t('common.pageSize')}</span>
                    <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPageIndex(0); }}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>{pageSizes.map((value) => <SelectItem value={String(value)} key={value}>{value}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" disabled={safePageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>{t('common.previousPage')}</Button>
                    <Button variant="outline" size="sm" disabled={safePageIndex >= pageCount - 1} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>{t('common.nextPage')}</Button>
                  </div>
                </div>
              </AppCard>
            </div>
          </ScrollArea>
          <TaskPreviewSheet task={previewTask} open={isPreviewOpen && previewTask !== null} onOpenChange={(open) => { if (open) setIsPreviewOpen(true); else closePreview(); }} onNavigate={onNavigate} />
        </div>
      ) : null}
    </Page>
  );
}

function compareTasks(left: TaskRowVm, right: TaskRowVm, key: TaskSortKey, dir: SortDir) {
  const direction = dir === 'asc' ? 1 : -1;
  const leftValue = taskSortValue(left, key);
  const rightValue = taskSortValue(right, key);
  return leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' }) * direction;
}

function taskSortValue(task: TaskRowVm, key: TaskSortKey) {
  if (key === 'title') return task.title;
  if (key === 'status') return task.displayStatus;
  if (key === 'workflow') return workflowStatusValue(task);
  if (key === 'latest') return task.latestRun?.id ?? '';
  return task.id;
}

function matchesTaskFilter(task: TaskRowVm, filter: TaskFilter) {
  const display = normalizeStatusValue(task.displayStatus);
  const runStatus = normalizeStatusValue(task.latestRun?.status);
  const runOutcome = normalizeStatusValue(task.latestRun?.outcome);
  if (filter === 'running') return display === 'running' || runStatus === 'running';
  if (filter === 'completed') return ['completed', 'complete', 'success', 'succeeded'].includes(display) || ['success', 'succeeded'].includes(runOutcome);
  if (filter === 'resumable') return display === 'resumable' || Boolean(task.resumableRunId) || Boolean(task.latestRun?.resumable);
  if (filter === 'failed') return ['failed', 'failure'].includes(display) || ['failed', 'failure'].includes(runOutcome);
  if (filter === 'invalid') return ['invalid', 'missing-workflow', 'missing'].includes(display) || !task.workflowExists || !task.workflowValid;
  return true;
}

function taskSearchText(task: TaskRowVm, t: TFunction) {
  const workflowStatus = workflowStatusValue(task);
  return [
    task.id,
    task.title,
    task.description,
    task.requirementPreview,
    task.requirement,
    task.displayStatus,
    displayStatus(t, task.displayStatus),
    task.workflowError,
    workflowStatus,
    displayStatus(t, workflowStatus),
    task.latestRun?.id,
    task.latestRun?.status,
    task.latestRun?.outcome,
    task.resumableRunId,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function workflowStatusValue(task: TaskRowVm) {
  if (!task.workflowExists) return 'missing-workflow';
  if (!task.workflowValid) return 'invalid';
  return 'valid';
}

function normalizeStatusValue(value?: string | null) {
  return value?.toLowerCase() ?? '';
}

function SortableHead({ label, sortKey, activeKey, dir, onSort }: { label: string; sortKey: TaskSortKey; activeKey: TaskSortKey; dir: SortDir; onSort: (key: TaskSortKey) => void }) {
  return (
    <TableHead>
      <Button variant="ghost" size="sm" className="h-auto px-0 font-semibold" onClick={() => onSort(sortKey)}>
        {label}{activeKey === sortKey ? <span className="ml-1 text-xs">{dir === 'asc' ? '↑' : '↓'}</span> : null}
      </Button>
    </TableHead>
  );
}

function WorkflowState({ task }: { task: TaskRowVm }) {
  const { t } = useTranslation();
  if (!task.workflowExists) return <StatusBadge value="missing-workflow" tone="warning" label={displayStatus(t, 'missing-workflow')} />;
  if (!task.workflowValid) return <StatusBadge value="invalid" tone="danger" label={displayStatus(t, 'invalid')} />;
  return <StatusBadge value="valid" tone="success" label={displayStatus(t, 'valid')} />;
}

function TaskListSkeletonPage() {
  return (
    <div className="min-h-0 flex-1 p-5 xl:p-6">
      <div className="space-y-5">
        <Skeleton className="h-16 w-2/3" />
        <TaskTableSkeleton />
      </div>
    </div>
  );
}

function TaskPreviewSheet({ task, open, onOpenChange, onNavigate }: { task: TaskRowVm | null; open: boolean; onOpenChange: (open: boolean) => void; onNavigate: (page: TaskPage) => void }) {
  const { t } = useTranslation();
  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-[440px] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[440px]"
        closeLabel={t('common.close')}
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-task-preview-row="true"]')) event.preventDefault();
        }}
        showOverlay={false}
      >
        {task ? <TaskPreviewContent task={task} onNavigate={onNavigate} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function TaskPreviewContent({ task, onNavigate }: { task: TaskRowVm; onNavigate: (page: TaskPage) => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const requirement = fullRequirementText(task.requirement, task.requirementPreview || task.description, t('common.empty'));

  const copyRequirement = async () => {
    await navigator.clipboard.writeText(requirement);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <SheetHeader className="shrink-0 gap-3 border-b px-5 py-4 text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t('taskList.taskPreview')}</p>
        <SheetDescription className="sr-only">{t('taskList.taskPreviewDescription')}</SheetDescription>
        <div className="flex min-w-0 flex-wrap gap-2 pr-8">
          <Badge variant="secondary" className="max-w-full truncate">{task.id}</Badge>
          <StatusBadge value={task.displayStatus} label={displayStatus(t, task.displayStatus)} />
        </div>
        <SheetTitle className="line-clamp-2 break-words text-xl">{task.title}</SheetTitle>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col p-5">
        <div className="flex shrink-0 items-center justify-between gap-3 pb-4">
          <h3 className="font-semibold text-foreground">{t('common.fullRequirement')}</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={t('common.copy')} onClick={copyRequirement}>
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <CodeBlock className="whitespace-pre-wrap font-sans text-sm leading-7">{requirement}</CodeBlock>
        </ScrollArea>
      </div>
      <SheetFooter className="shrink-0 border-t bg-background/95 p-5">
        <Button className="w-full shadow-sm" onClick={() => onNavigate({ kind: 'workflow', taskId: task.id })}>{t('common.workflow')}</Button>
      </SheetFooter>
    </>
  );
}
