import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[linear-gradient(135deg,hsl(var(--primary-dim)),hsl(var(--primary)))] text-primary-foreground',
        secondary: 'bg-[hsl(var(--secondary)/0.92)] text-secondary-foreground',
        outline: 'bg-white/[0.03] text-muted-foreground shadow-[inset_0_0_0_1px_rgba(64,72,93,0.22)]',
        success: 'bg-[rgba(163,194,147,0.12)] text-[hsl(var(--success))] shadow-[0_0_16px_rgba(163,194,147,0.08)]',
        warning: 'bg-[rgba(255,212,143,0.12)] text-[#ffd48f] shadow-[0_0_16px_rgba(255,212,143,0.07)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
