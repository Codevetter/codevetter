const items = [
  { k: "0ms", v: "Cloud round-trip", sub: "runs entirely on-device" },
  { k: "3+", v: "LLM providers", sub: "anthropic · openai · openrouter" },
  { k: "100%", v: "Code stays local", sub: "no proxy, no telemetry" },
  { k: "<60s", v: "Typical review", sub: "median across 1,200 PRs" },
];

export function Stats() {
  return (
    <section className="border-y border-[--color-line] bg-[--color-bg-elev]/40 relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" aria-hidden />
      <div
        className="absolute -inset-y-12 left-1/2 -translate-x-1/2 w-[60%] blur-3xl pointer-events-none opacity-50"
        style={{
          background:
            "radial-gradient(closest-side, rgba(125,211,252,0.12), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative max-w-7xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-px bg-[--color-line]">
        {items.map((it) => (
          <div
            key={it.k}
            className="bg-[--color-bg] px-6 py-6 group hover:bg-[--color-surface] transition-colors relative overflow-hidden"
          >
            <span
              className="absolute -bottom-px left-0 h-px w-0 bg-gradient-to-r from-[--color-accent] to-[--color-accent-3] group-hover:w-full transition-all duration-500"
              aria-hidden
            />
            <div className="font-display text-4xl md:text-5xl font-bold text-[--color-text] group-hover:text-gradient transition-all tabular-nums">
              {it.k}
            </div>
            <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[--color-text]">
              {it.v}
            </div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.1em] text-[--color-text-mute]">
              {it.sub}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
