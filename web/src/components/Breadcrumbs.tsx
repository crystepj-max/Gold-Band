import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskPage } from '../types';
import { breadcrumbs } from '../state/navigation';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';

interface BreadcrumbsProps {
  page: TaskPage;
  onNavigate: (page: TaskPage) => void;
}

export function Breadcrumbs({ page, onNavigate }: BreadcrumbsProps) {
  const { t } = useTranslation();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const items = breadcrumbs(page);
  return (
    <Breadcrumb className="px-8 pt-4 font-mono text-xs">
      <BreadcrumbList>
        {items.map((item, index) => {
          const active = index === items.length - 1;
          const itemPage = item.page;
          const interactive = itemPage && !active;
          const selected = hoveredKey === item.key;
          const label = item.labelKey ? t(item.labelKey) : item.label;
          return (
            <BreadcrumbItem key={`${item.key}-${index}`}>
              {active ? (
                <BreadcrumbPage className="relative px-1 pb-1 font-mono text-xs font-semibold text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-gradient-to-r after:from-transparent after:via-primary after:to-transparent">
                  {label}
                </BreadcrumbPage>
              ) : interactive ? (
                <button
                  type="button"
                  className="-mx-1 inline-flex h-6 items-center rounded-sm px-1.5 py-0 font-mono text-xs focus-visible:outline-none"
                  onBlur={() => setHoveredKey(null)}
                  onClick={() => onNavigate(itemPage)}
                  onFocus={() => setHoveredKey(item.key)}
                  onMouseEnter={() => setHoveredKey(item.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                >
                  <span
                    className={cn(
                      'relative inline-flex rounded-sm px-0.5 pb-1 transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:rounded-full',
                      selected ? 'after:bg-primary' : 'text-muted-foreground after:bg-transparent',
                    )}
                    style={selected ? { WebkitTextFillColor: 'var(--foreground)' } : undefined}
                  >
                    {label}
                  </span>
                </button>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">{label}</span>
              )}
              {index < items.length - 1 ? <span aria-hidden="true" className="text-muted-foreground">/</span> : null}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
