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
    <section className="relative py-8 border-y border-[--color-line] bg-[--color-bg-elev]/60 overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[--color-accent] to-transparent animate-beam"
        aria-hidden
      />
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-3 mb-5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[--color-accent]">
            // PATTERN_LIBRARY
          </span>
          <span className="text-[--color-text-mute] font-mono text-[11px]">
            things we catch the agent missed
          </span>
        </div>
        <Marquee>
          {items.map((it) => (
            <div
              key={it.tag}
              className="flex items-center gap-3 border border-[--color-line] bg-[--color-surface] px-4 py-2.5"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[--color-accent] border border-[--color-accent]/40 bg-[--color-accent]/5 px-1.5 py-0.5">
                {it.tag}
              </span>
              <span className="font-mono text-[12px] text-[--color-text-dim] whitespace-nowrap">
                {it.label}
              </span>
            </div>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
