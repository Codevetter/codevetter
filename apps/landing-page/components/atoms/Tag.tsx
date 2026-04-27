import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function Tag({
  children,
  tone = "accent",
  className,
}: {
  children: ReactNode;
  tone?: "accent" | "warn" | "danger" | "ok" | "mute";
  className?: string;
}) {
  const tones = {
    accent: "text-[--color-accent] bg-[--color-accent]/10 border-[--color-accent]/30",
    warn: "text-[--color-warn] bg-[--color-warn]/10 border-[--color-warn]/30",
    danger: "text-[--color-danger] bg-[--color-danger]/10 border-[--color-danger]/30",
    ok: "text-[--color-ok] bg-[--color-ok]/10 border-[--color-ok]/30",
    mute: "text-[--color-text-dim] bg-[--color-surface-2] border-[--color-line]",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 border font-mono text-[10px] uppercase tracking-[0.16em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
