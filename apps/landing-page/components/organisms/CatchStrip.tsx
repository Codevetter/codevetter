import { Marquee } from "@/components/effects/Marquee";

const items = [
  { tag: "CWE-89", label: "SQL Injection" },
  { tag: "CWE-79", label: "Cross-site scripting" },
  { tag: "CWE-352", label: "CSRF token missing" },
  { tag: "CWE-798", label: "Hardcoded credentials" },
  { tag: "CWE-22", label: "Path traversal" },
  { tag: "OWASP-A01", label: "Broken access control" },
  { tag: "OWASP-A03", label: "Injection class" },
  { tag: "OWASP-A07", label: "Auth failures" },
  { tag: "REGEX", label: "Catastrophic backtracking" },
  { tag: "RACE", label: "TOCTOU window" },
  { tag: "PII", label: "Token logged at info" },
  { tag: "PERF", label: "N+1 query loop" },
  { tag: "TTL", label: "Cache divergence" },
  { tag: "SEMVER", label: "Breaking API change" },
];

export function CatchStrip() {
  return (
    <section className="relative py-12 bg-black overflow-hidden group">
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent"
        aria-hidden
      />
      
      <div className="max-w-7xl mx-auto px-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
          <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
            Vulnerability Engine v2.0
          </span>
        </div>
        <div className="text-xs font-medium text-gray-500 font-mono">
          Patterns specifically trained on high-velocity agent diffs
        </div>
      </div>

      <Marquee>
        {items.map((it) => (
          <div
            key={it.tag}
            className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-full px-5 py-2.5 mx-2 hover:bg-white/[0.08] hover:border-white/10 transition-all duration-300 group/item"
          >
            <span className="text-[10px] font-bold text-blue-400 font-mono bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full group-hover/item:bg-blue-500 group-hover/item:text-white transition-colors">
              {it.tag}
            </span>
            <span className="text-sm font-semibold text-gray-300 whitespace-nowrap">
              {it.label}
            </span>
          </div>
        ))}
      </Marquee>
      
      <div
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"
        aria-hidden
      />
    </section>
  );
}