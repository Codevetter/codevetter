import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline";

type Props = ComponentProps<"a"> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: Props) {
  const base =
    "group inline-flex items-center gap-2 px-5 h-11 font-mono text-[11px] uppercase tracking-[0.18em] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-accent] focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-bg]";

  const variants: Record<Variant, string> = {
    primary:
      "bg-[--color-accent] text-[#001016] hover:bg-[--color-accent-2] hover:shadow-[0_0_30px_-4px_var(--color-accent-glow)]",
    outline:
      "border border-[--color-line-2] text-[--color-text] hover:border-[--color-accent] hover:text-[--color-accent] hover:bg-[--color-accent]/5",
    ghost:
      "text-[--color-text-dim] hover:text-[--color-text]",
  };

  return (
    <a className={cn(base, variants[variant], className)} {...props}>
      {children}
    </a>
  );
}
