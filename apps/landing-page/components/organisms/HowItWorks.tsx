import { ShieldCheck, Terminal, Zap } from "lucide-react";

import { SectionHeading } from "./Bento";

const steps = [
  {
    n: "01",
    title: "Drop in your diff",
    body: "Stage changes, paste a patch, or hand it a branch range. CodeVetter parses files, hunks, and call-sites locally.",
    code: "$ codevetter review HEAD~1..HEAD",
    icon: <Terminal className="w-5 h-5" />,
  },
  {
    n: "02",
    title: "Pick the model",
    body: "Choose Claude, GPT, or anything OpenRouter routes. Switch per-review. Token usage is live-tracked, never proxied.",
    code: "→ provider=anthropic model=claude-3-opus",
    icon: <Zap className="w-5 h-5" />,
  },
  {
    n: "03",
    title: "Triage the verdict",
    body: "Findings ranked by severity, mapped to CWE, with concrete patch diffs. Apply, edit, or dismiss with one keystroke.",
    code: "✓ 4 critical · 12 high · 29 medium",
    icon: <ShieldCheck className="w-5 h-5" />,
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="py-32 relative overflow-hidden">
      <div className="relative max-w-7xl mx-auto px-6">
        <SectionHeading
          eyebrow="Operating loop"
          title={
            <>
              Three steps. <span className="text-gradient">Zero ceremony.</span>
            </>
          }
          sub="No accounts, no setup wizards, no SaaS dashboard. Open the app, plug in a key, ship safer code."
        />

        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-12">
          {steps.map((s) => (
            <div key={s.n} className="relative group">
              <div className="absolute -inset-4 rounded-[2rem] bg-white/[0.02] opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-8 shadow-[0_0_20px_rgba(96,165,250,0.15)] group-hover:scale-110 transition-transform duration-500">
                  {s.icon}
                </div>
                <div className="text-xs font-bold text-blue-500/50 uppercase tracking-[0.2em] mb-3">
                  Step {s.n}
                </div>
                <h3 className="text-2xl font-bold text-white mb-4 tracking-tight">
                  {s.title}
                </h3>
                <p className="text-gray-400 text-[15px] leading-relaxed mb-8">
                  {s.body}
                </p>
                <div className="rounded-xl bg-black border border-white/5 p-4 font-mono text-xs shadow-inner">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-red-500/40"></div>
                    <div className="w-2 h-2 rounded-full bg-amber-500/40"></div>
                    <div className="w-2 h-2 rounded-full bg-emerald-500/40"></div>
                  </div>
                  <div className="text-blue-400/90 leading-relaxed break-all">
                    {s.code}
                  </div>
                  <Activity stage={parseInt(s.n) - 1} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Activity({ stage }: { stage: number }) {
  if (stage === 0) {
    return (
      <div className="mt-4 space-y-2 text-[11px] text-gray-500 border-t border-white/5 pt-4">
        <div className="flex items-center justify-between">
          <span>parsing diff</span>
          <span className="text-emerald-500">✓</span>
        </div>
        <div className="flex items-center justify-between">
          <span>resolving call-sites</span>
          <span className="text-emerald-500">✓</span>
        </div>
        <div className="flex items-center justify-between">
          <span>building context</span>
          <span className="text-blue-400 animate-pulse">...</span>
        </div>
      </div>
    );
  }
  if (stage === 1) {
    return (
      <div className="mt-4 grid grid-cols-1 gap-2 border-t border-white/5 pt-4">
        <div className="flex items-center justify-between px-2 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-400">
          <span>claude-3-opus</span>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 rounded border border-white/5 text-[10px] text-gray-600">
          <span>gpt-4o</span>
          <span className="w-1.5 h-1.5 rounded-full bg-gray-700"></span>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
      <div className="flex justify-between text-[10px] font-bold">
        <span className="text-red-400/80">CRITICAL</span>
        <span className="text-gray-500">04</span>
      </div>
      <div className="flex justify-between text-[10px] font-bold">
        <span className="text-amber-400/80">HIGH</span>
        <span className="text-gray-500">12</span>
      </div>
      <div className="flex justify-between text-[10px] font-bold border-t border-white/5 pt-2 mt-2">
        <span className="text-emerald-400">PATCHES READY</span>
        <span className="text-emerald-400">45</span>
      </div>
    </div>
  );
}