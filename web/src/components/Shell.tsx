import { Bot, Boxes, BrainCircuit, ChevronsUpDown, Command, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PrimaryModule } from '../types';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ShellProps {
  active: PrimaryModule;
  repoRoot?: string;
  onSelect: (module: PrimaryModule) => void;
  onChooseWorkspace: () => void;
  children: React.ReactNode;
}

export function Shell({ active, repoRoot, onSelect, onChooseWorkspace, children }: ShellProps) {
  const { t } = useTranslation();
  return (
    <TooltipProvider>
      <div className="grid h-screen grid-cols-[256px_minmax(0,1fr)] bg-gold-workspace text-foreground" onContextMenu={(event) => event.preventDefault()}>
        <aside className="flex min-h-0 flex-col gap-5 border-r bg-sidebar px-5 py-7 text-sidebar-foreground">
          <Button variant="ghost" className="h-auto justify-start gap-3 px-0 py-0 hover:bg-transparent" onClick={() => onSelect('task-orchestration')}>
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-lg font-black text-primary-foreground">◇</span>
            <span className="text-left">
              <strong className="block text-xl leading-none text-primary">Gold Band</strong>
              <small className="mt-1 block text-[11px] uppercase tracking-[0.18em] text-muted-foreground">AI Orchestrator</small>
            </span>
          </Button>

          <Button variant="outline" className="h-auto justify-between gap-3 border-sidebar-border bg-transparent p-3 text-left hover:bg-sidebar-accent" onClick={onChooseWorkspace} title={repoRoot ?? t('common.switchWorkspace')}>
            <span className="min-w-0">
              <span className="block truncate font-mono text-xs text-muted-foreground">{repoRoot ?? t('common.workspace')}</span>
              <small className="mt-1 block text-xs font-semibold text-primary">{t('common.switchWorkspace')}</small>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>

          <nav className="mt-6 flex flex-1 flex-col gap-2">
            <ShellNavButton active={active === 'task-orchestration'} icon={<Command />} label={t('common.taskOrchestration')} onClick={() => onSelect('task-orchestration')} />
            <ShellNavButton disabled icon={<Boxes />} label={t('common.knowledgeBase')} suffix={t('common.comingSoon')} />
            <ShellNavButton disabled icon={<BrainCircuit />} label={t('common.modelManagement')} suffix={t('common.comingSoon')} />
          </nav>

          <Separator />
          <ShellNavButton active={active === 'settings'} icon={<Settings />} label={t('common.settings')} onClick={() => onSelect('settings')} />
        </aside>
        <main className="flex min-w-0 flex-col overflow-hidden bg-gold-workspace">{children}</main>
      </div>
    </TooltipProvider>
  );
}

function ShellNavButton({ active, disabled, icon, label, suffix, onClick }: { active?: boolean; disabled?: boolean; icon: React.ReactNode; label: string; suffix?: string; onClick?: () => void }) {
  const button = (
    <Button
      variant="ghost"
      disabled={disabled}
      className={cn(
        'h-12 justify-between rounded-lg px-3 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        active && 'bg-sidebar-accent text-sidebar-primary',
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-3">
        <span className="[&_svg]:size-5">{icon}</span>
        <span>{label}</span>
      </span>
      {suffix ? <span className="text-xs">{suffix}</span> : null}
    </Button>
  );

  if (!disabled) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{suffix}</TooltipContent>
    </Tooltip>
  );
}
