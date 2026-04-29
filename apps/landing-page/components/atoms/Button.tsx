import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "ghost" | "outline" | "glass";

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
    "group inline-flex items-center gap-2 px-6 h-12 text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-accent] focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-bg] rounded-full";

  const variants: Record<Variant, string> = {
    primary:
      "bg-white text-black hover:bg-gray-100 shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_30px_rgba(255,255,255,0.4)]",
    outline:
      "border border-white/20 text-white hover:border-white/40 hover:bg-white/5 backdrop-blur-md",
    glass:
      "bg-white/5 border border-white/10 text-white backdrop-blur-md hover:bg-white/10 hover:border-white/20 shadow-lg",
    ghost:
      "text-gray-400 hover:text-white hover:bg-white/5",
  };

  return (
    <a className={cn(base, variants[variant], className)} {...props}>
      {children}
    </a>
  );
}