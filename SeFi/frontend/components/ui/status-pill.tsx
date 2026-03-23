import * as React from 'react';
import { cn } from '@/lib/utils';

type StatusTone = 'healthy' | 'warning' | 'stale' | 'risk';

const toneClasses: Record<StatusTone, { wrapper: string; dot: string }> = {
  healthy: {
    wrapper: 'bg-[rgba(163,194,147,0.12)] text-[hsl(var(--success))]',
    dot: 'bg-[hsl(var(--success))] led-success',
  },
  warning: {
    wrapper: 'bg-[rgba(255,212,143,0.12)] text-[#ffd48f]',
    dot: 'bg-[#ffd48f] led-warning',
  },
  stale: {
    wrapper: 'bg-white/[0.06] text-muted-foreground shadow-[inset_0_0_0_1px_rgba(64,72,93,0.18)]',
    dot: 'bg-muted-foreground led-stale',
  },
  risk: {
    wrapper: 'bg-[rgba(255,113,108,0.12)] text-[hsl(var(--danger))]',
    dot: 'bg-[hsl(var(--danger))] led-danger',
  },
};

export type StatusPillProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: StatusTone;
};

export function StatusPill({ className, tone = 'stale', children, ...props }: StatusPillProps) {
  const styles = toneClasses[tone];

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium tracking-[0.02em]',
        styles.wrapper,
        className
      )}
      {...props}
    >
      <span className={cn('h-1 w-1 rounded-full', styles.dot)} />
      <span>{children}</span>
    </div>
  );
}
