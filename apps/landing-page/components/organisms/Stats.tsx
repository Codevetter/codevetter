const items = [
  { k: "0ms", v: "Cloud round-trip", sub: "runs entirely on-device" },
  { k: "3+", v: "LLM providers", sub: "anthropic · openai · openrouter" },
  { k: "100%", v: "Code stays local", sub: "no proxy, no telemetry" },
  { k: "<60s", v: "Typical review", sub: "median across 1,200 PRs" },
];

export function Stats() {
  return (
    <section className="relative overflow-hidden bg-[#0A0A0A] py-16">
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" aria-hidden />
      
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {items.map((it) => (
            <div
              key={it.k}
              className="relative group p-6 rounded-3xl hover:bg-white/[0.02] transition-colors duration-500"
            >
              <div className="font-display text-4xl md:text-5xl font-bold text-white group-hover:text-blue-400 transition-colors duration-500 tabular-nums mb-3 tracking-tighter">
                {it.k}
              </div>
              <div className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-1 group-hover:text-white transition-colors">
                {it.v}
              </div>
              <div className="text-xs text-gray-500 font-medium">
                {it.sub}
              </div>
              <div className="absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}