import type { ComponentProps } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function AppCard({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={cn('border-border/80 bg-card/95 shadow-sm', className)} {...props} />;
}
