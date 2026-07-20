import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cv-canvas)] active:translate-y-px disabled:pointer-events-none disabled:opacity-45 disabled:active:translate-y-0',
  {
    variants: {
      variant: {
        default:
          'border border-amber-200/20 bg-primary text-primary-foreground shadow-[0_12px_30px_-18px_rgba(243,173,61,0.9),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-[var(--cv-accent-strong)]',
        destructive:
          'border border-rose-300/20 bg-destructive text-destructive-foreground shadow-[0_12px_28px_-20px_rgba(251,113,133,0.8)] hover:bg-destructive/90',
        outline:
          'border border-white/[0.11] bg-white/[0.035] text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white',
        secondary:
          'border border-white/[0.07] bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-zinc-400 hover:bg-white/[0.055] hover:text-zinc-100',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button };
