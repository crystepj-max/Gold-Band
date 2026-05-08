import { useTranslation } from 'react-i18next';
import type { TaskPage } from '../types';
import { breadcrumbs } from '../state/navigation';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';

interface BreadcrumbsProps {
  page: TaskPage;
  onNavigate: (page: TaskPage) => void;
  className?: string;
}

export function Breadcrumbs({ page, onNavigate, className }: BreadcrumbsProps) {
  const { t } = useTranslation();
  const items = breadcrumbs(page);
  return (
    <Breadcrumb className={cn('text-xs', className)}>
      <BreadcrumbList>
        {items.map((item, index) => {
          const active = index === items.length - 1;
          const itemPage = item.page;
          const interactive = itemPage && !active;
          const label = item.labelKey ? t(item.labelKey) : item.label;
          return (
            <BreadcrumbItem key={`${item.key}-${index}`}>
              {active ? (
                <BreadcrumbPage className="relative px-1 pb-1 text-xs font-semibold text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-gradient-to-r after:from-transparent after:via-primary after:to-transparent">
                  {label}
                </BreadcrumbPage>
              ) : interactive ? (
                <button
                  type="button"
                  className="group -mx-1 inline-flex h-6 items-center rounded-sm px-1.5 py-0 text-xs focus-visible:outline-none"
                  onClick={() => onNavigate(itemPage)}
                >
                  <span
                    className={cn(
                      'relative inline-flex rounded-sm px-0.5 pb-1 text-muted-foreground transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:rounded-full after:bg-transparent',
                      'group-hover:text-foreground group-hover:after:bg-primary group-focus-visible:text-foreground group-focus-visible:after:bg-primary',
                    )}
                  >
                    {label}
                  </span>
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">{label}</span>
              )}
              {index < items.length - 1 ? <span aria-hidden="true" className="text-muted-foreground">/</span> : null}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
