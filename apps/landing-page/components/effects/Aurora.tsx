import { cn } from "@/lib/cn";

export function Aurora({
  className,
  intensity = "med",
}: {
  className?: string;
  intensity?: "low" | "med" | "high";
}) {
  const op = intensity === "low" ? 0.35 : intensity === "high" ? 0.85 : 0.6;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      style={{ opacity: op }}
    >
      <div
        className="absolute -top-32 -left-24 w-[640px] h-[640px] rounded-full blur-[120px] animate-drift-a"
        style={{
          background:
            "radial-gradient(closest-side, rgba(56,189,248,0.55), transparent 70%)",
        }}
      />
      <div
        className="absolute top-1/3 right-0 w-[560px] h-[560px] rounded-full blur-[140px] animate-drift-b"
        style={{
          background:
            "radial-gradient(closest-side, rgba(167,139,250,0.45), transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-0 left-1/3 w-[520px] h-[520px] rounded-full blur-[120px] animate-drift-c"
        style={{
          background:
            "radial-gradient(closest-side, rgba(244,114,182,0.30), transparent 70%)",
        }}
      />
    </div>
  );
}
