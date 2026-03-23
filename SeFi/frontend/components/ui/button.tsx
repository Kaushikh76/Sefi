import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[14px] text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default:
          'bg-[linear-gradient(135deg,hsl(var(--primary-dim)),hsl(var(--primary)))] text-primary-foreground shadow-[0_14px_28px_rgba(139,168,126,0.2)] hover:brightness-105',
        secondary:
          'bg-[hsl(var(--secondary)/0.92)] text-secondary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-[hsl(var(--surface-highest))]',
        ghost: 'text-foreground hover:bg-white/5 hover:text-foreground',
        outline:
          'border border-[hsl(var(--border)/0.2)] bg-[hsl(var(--secondary)/0.3)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[hsl(var(--secondary)/0.65)]',
        destructive:
          'bg-[rgba(255,113,108,0.14)] text-[hsl(var(--danger))] shadow-[0_0_0_1px_rgba(255,113,108,0.18)] hover:bg-[rgba(255,113,108,0.22)]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-xl px-3',
        lg: 'h-11 rounded-2xl px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => {
  return <button className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
});
Button.displayName = 'Button';

export { Button, buttonVariants };
