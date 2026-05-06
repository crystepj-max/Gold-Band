import type { TaskPage } from '../types';

export interface BreadcrumbItemVm {
  key: string;
  label?: string;
  labelKey?: string;
  page?: TaskPage;
}

export function breadcrumbs(page: TaskPage) {
  const items: BreadcrumbItemVm[] = [{ key: 'task-list', labelKey: 'navigation.taskList', page: { kind: 'task-list' } }];
  if (page.kind === 'task-list') return items;
  items.push({ key: `task-${page.taskId}`, label: page.taskId });
  items.push({ key: 'workflow', labelKey: page.kind === 'round-detail' ? 'navigation.workflowList' : 'navigation.workflow', page: { kind: 'workflow', taskId: page.taskId } });
  if (page.kind === 'workflow') return items;
  items.push({ key: `run-${page.runId}`, label: page.runId });
  items.push({ key: `round-${page.roundId}`, label: page.roundId, page });
  return items;
}
