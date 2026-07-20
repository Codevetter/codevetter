import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring/70 focus:ring-offset-2 focus:ring-offset-[var(--cv-canvas)]',
  {
    variants: {
      variant: {
        default: 'border-amber-300/20 bg-amber-300/[0.1] text-amber-200 hover:bg-amber-300/[0.16]',
        secondary: 'border-white/[0.07] bg-white/[0.045] text-zinc-300 hover:bg-white/[0.075]',
        destructive: 'border-rose-300/20 bg-rose-400/[0.1] text-rose-200 hover:bg-rose-400/[0.16]',
        outline: 'border-white/[0.1] bg-white/[0.02] text-zinc-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
