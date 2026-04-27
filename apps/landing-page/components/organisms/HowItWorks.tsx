import { SectionHeading } from "./Bento";

const steps = [
  {
    n: "01",
    title: "Drop in your diff",
    body: "Stage changes, paste a patch, or hand it a branch range. CodeVetter parses files, hunks, and call-sites locally.",
    code: "$ codevetter review HEAD~1..HEAD",
  },
  {
    n: "02",
    title: "Pick the model",
    body: "Choose Claude, GPT, or anything OpenRouter routes. Switch per-review. Token usage is live-tracked, never proxied.",
    code: "→ provider=anthropic  model=claude-opus-4-7",
  },
  {
    n: "03",
    title: "Triage the verdict",
    body: "Findings ranked by severity, mapped to CWE, with concrete patch diffs. Apply, edit, or dismiss with one keystroke.",
    code: "✓ 4 critical · 12 high · 29 medium  →  patch.diff",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="py-28 relative border-t border-[--color-line] overflow-hidden">
      <div
        className="absolute -left-40 top-1/3 w-[500px] h-[500px] rounded-full pointer-events-none opacity-40"
        style={{ background: "radial-gradient(closest-side, rgba(56,189,248,0.10), transparent 70%)" }}
        aria-hidden
      />
      <div className="relative max-w-7xl mx-auto px-6">
        <SectionHeading
          eyebrow="Operating loop"
          title={
            <>
              Three steps. <span className="text-[--color-accent]">Zero ceremony.</span>
            </>
          }
          sub="No accounts, no setup wizards, no SaaS dashboard. Open the app, plug in a key, ship safer code."
        />

        <div className="mt-16 relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-[--color-line-2] to-transparent hidden md:block" aria-hidden />

          <div className="space-y-16">
            {steps.map((s, i) => (
              <div
                key={s.n}
                className={`grid md:grid-cols-2 gap-8 md:gap-12 items-center ${
                  i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div>
                  <div className="font-mono text-[11px] tracking-[0.2em] text-[--color-accent] mb-3">
                    STEP_{s.n}
                  </div>
                  <h3 className="font-display text-3xl md:text-4xl font-bold tracking-tight leading-tight">
                    {s.title}
                  </h3>
                  <p className="mt-4 text-[15px] text-[--color-text-dim] leading-relaxed max-w-md">
                    {s.body}
                  </p>
                </div>
                <div className="relative corner-frame bg-[--color-bg-elev] border border-[--color-line] p-5 font-mono text-[12.5px] text-[--color-text]">
                  <div className="absolute top-3 right-3 label-mono">
                    {s.n}/03
                  </div>
                  <div className="text-[--color-accent]">{s.code}</div>
                  <Activity stage={i} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Activity({ stage }: { stage: number }) {
  if (stage === 0) {
    return (
      <div className="mt-3 space-y-1 text-[--color-text-dim]">
        <div>parsing diff <span className="text-[--color-ok]">✓</span></div>
        <div>resolving 3 affected files <span className="text-[--color-ok]">✓</span></div>
        <div>building review context <span className="animate-pulse-soft text-[--color-accent]">...</span></div>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className="mt-3 grid grid-cols-3 gap-2">
        {["claude-opus-4-7", "gpt-5-codex", "kimi-k2"].map((m, i) => (
          <div
            key={m}
            className={`text-center py-2 border ${
              i === 0
                ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent]"
                : "border-[--color-line] text-[--color-text-mute]"
            }`}
          >
            {m}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex justify-between"><span className="text-[--color-danger]">CRITICAL</span><span className="text-[--color-text-mute]">04</span></div>
      <div className="flex justify-between"><span className="text-[--color-warn]">HIGH</span><span className="text-[--color-text-mute]">12</span></div>
      <div className="flex justify-between"><span className="text-[--color-accent]">MEDIUM</span><span className="text-[--color-text-mute]">29</span></div>
      <div className="flex justify-between border-t border-[--color-line] pt-1.5 mt-2"><span className="text-[--color-ok]">PATCHES READY</span><span className="text-[--color-ok]">45</span></div>
    </div>
  );
}
