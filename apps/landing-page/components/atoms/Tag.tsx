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
    accent: "text-blue-400 bg-blue-500/10 border-blue-500/20 shadow-[0_0_10px_rgba(96,165,250,0.15)]",
    warn: "text-amber-400 bg-amber-500/10 border-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.15)]",
    danger: "text-rose-400 bg-red-500/10 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.15)]",
    ok: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.15)]",
    mute: "text-gray-400 bg-white/5 border-white/10 backdrop-blur-md",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 border text-xs font-medium rounded-full transition-colors",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}