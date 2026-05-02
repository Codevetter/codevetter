"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Download,
  GitPullRequestArrow,
  SearchCode,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";

import { Button } from "@/components/atoms/Button";
import { Tag } from "@/components/atoms/Tag";
import { Aurora } from "@/components/effects/Aurora";
import { ParticleField } from "@/components/effects/ParticleField";

export function Hero() {
  return (
    <section className="relative pt-32 pb-24 overflow-hidden">
      <Aurora intensity="low" />
      <div className="absolute inset-0 grid-bg pointer-events-none" aria-hidden />
      <ParticleField count={30} />

      <div className="relative max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: "easeOut" }}
          className="flex flex-col items-center text-center"
        >
          <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
            <Tag tone="accent" className="font-mono uppercase tracking-[0.16em]">
              <span className="w-1.5 h-1.5 rounded-full bg-[--color-accent] animate-pulse-soft" />
              v1.1.9 Available
            </Tag>
            <Tag tone="mute" className="font-mono uppercase tracking-[0.16em]">
              <Sparkles className="w-3 h-3" strokeWidth={1.5} />
              Built for the agent era
            </Tag>
          </div>

          <h1 className="font-display font-bold text-[clamp(2.8rem,7vw,6.35rem)] leading-[1.02] tracking-tight max-w-5xl">
            <span className="block text-white">Stop merging</span>
            <span className="block">
              <span className="text-gradient">unreviewed</span>{" "}
              <span className="relative inline-block">
                <span className="relative z-10 text-white">AI code.</span>
                <svg
                  className="absolute -bottom-3 left-0 hidden h-4 w-full text-[--color-accent]/70 sm:block"
                  viewBox="0 0 200 12"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <motion.path
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.2, delay: 0.55, ease: "easeOut" }}
                    d="M2 8 Q 50 2, 100 6 T 198 4"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </h1>

          <p className="mt-8 max-w-2xl text-[18px] leading-relaxed text-gray-400">
            CodeVetter is a desktop review cockpit for the diffs your agent
            ships. Catch what Cursor, Claude Code, and Devin missed —
            vulnerabilities, regressions, and silent drift. Runs entirely
            offline.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="primary" href="#download" className="w-full sm:w-auto">
              <Download className="w-4 h-4" strokeWidth={1.5} />
              Download for macOS
              <ArrowRight
                className="w-4 h-4 transition-transform group-hover:translate-x-1"
                strokeWidth={1.5}
              />
            </Button>
            <Button variant="outline" href="#how" className="w-full sm:w-auto">
              <Terminal className="w-4 h-4 text-gray-400" strokeWidth={1.5} />
              See it in action
            </Button>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[--color-text-mute]">
            <span className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-[--color-ok]" />
              No telemetry
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-[--color-ok]" />
              Bring your own key
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-[--color-ok]" />
              Open source · ISC
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-[--color-ok]" />
              Signed binaries
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.25, ease: "easeOut" }}
          className="mt-20"
        >
          <HeroPreview />
        </motion.div>
      </div>
    </section>
  );
}

function HeroPreview() {
  return (
    <div className="relative max-w-6xl mx-auto">
      <div
        className="absolute -inset-x-12 -inset-y-10 blur-3xl pointer-events-none opacity-70"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 30%, rgba(56,189,248,0.26), transparent 70%), radial-gradient(40% 40% at 80% 80%, rgba(167,139,250,0.22), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="corner-frame relative border border-[--color-line] bg-[--color-surface] glow-edge noise overflow-hidden">
        <div className="flex items-center justify-between border-b border-[--color-line] px-4 h-10 bg-[--color-bg-elev]/70">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[--color-danger]/40 border border-[--color-danger]/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-[--color-warn]/40 border border-[--color-warn]/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-[--color-ok]/40 border border-[--color-ok]/60" />
          </div>
          <div className="flex items-center gap-3">
            <GitPullRequestArrow className="w-3.5 h-3.5 text-[--color-text-mute]" strokeWidth={1.5} />
            <span className="label-mono">codevetter — review · feat/refresh-tokens · #1284</span>
          </div>
          <span className="label-mono">⌘ K</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[540px]">
          <aside className="hidden lg:flex lg:col-span-3 flex-col border-r border-white/5 bg-white/[0.01]">
            <div className="px-5 pt-5 pb-3 label-mono">Pipeline</div>
            <div className="px-5 space-y-2.5 pb-5 border-b border-[--color-line]">
              <PipelineItem label="Diff parsed" state="ok" time="12ms" />
              <PipelineItem label="AST traced" state="ok" time="84ms" />
              <PipelineItem label="LLM scoring" state="active" time="1.4s" />
              <PipelineItem label="Severity tag" state="idle" time="—" />
              <PipelineItem label="Patch draft" state="idle" time="—" />
            </div>
            <div className="px-5 pt-5 pb-3 label-mono">Findings</div>
            <div className="px-5 space-y-2 pb-5 flex-1">
              <FindingItem tone="danger" id="V-0821" file="session_manager.ts" rule="SQLi" />
              <FindingItem tone="warn" id="V-0822" file="logger.ts" rule="PII-leak" />
              <FindingItem tone="warn" id="V-0823" file="auth.ts" rule="Rate-limit" />
              <FindingItem tone="accent" id="V-0824" file="cache.ts" rule="TTL drift" />
            </div>
            <div className="border-t border-[--color-line] px-5 py-3 flex items-center justify-between font-mono text-[10px]">
              <span className="text-[--color-text-mute] uppercase tracking-[0.18em]">Model</span>
              <span className="text-[--color-accent]">claude-opus-4-7</span>
            </div>
          </aside>

          <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-[--color-line] relative overflow-hidden bg-[#050505]">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[--color-accent] to-transparent animate-scan" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[--color-line] text-xs text-gray-400 font-mono">
              <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">vuln</span>
              <span>apps/api/src/auth/session_manager.ts</span>
              </div>
              <span className="label-mono text-[--color-danger]">+2 / -0</span>
            </div>
            <div className="p-4 font-mono text-[13px] leading-relaxed text-gray-300">
              <div className="flex">
                <div className="w-8 text-right text-gray-600 select-none mr-4">36</div>
                <div><span className="text-purple-400">import</span> {`{`} db {`}`} <span className="text-purple-400">from</span> <span className="text-green-400">{`"@/lib/sql"`}</span>;</div>
              </div>
              <div className="flex">
                <div className="w-8 text-right text-gray-600 select-none mr-4">37</div>
                <div></div>
              </div>
              <div className="flex">
                <div className="w-8 text-right text-gray-600 select-none mr-4">38</div>
                <div><span className="text-purple-400">async function</span> <span className="text-blue-400">validateSession</span>(token: <span className="text-yellow-300">string</span>) {`{`}</div>
              </div>
              <div className="flex">
                <div className="w-8 text-right text-gray-600 select-none mr-4">39</div>
                <div className="text-gray-500">{`  // resolve session for the incoming request`}</div>
              </div>
              
              <div className="relative flex bg-red-500/10 border-l-2 border-red-500 -ml-4 pl-4 py-1 mt-1">
                <div className="w-8 text-right text-red-500/50 select-none mr-4">40</div>
                <div><span className="text-purple-400">  const</span> query = <span className="text-green-400">{`\`SELECT * FROM sessions WHERE token = '\${token}'\``}</span>;</div>
              </div>
              <div className="relative flex bg-red-500/10 border-l-2 border-red-500 -ml-4 pl-4 py-1 mb-1">
                <div className="w-8 text-right text-red-500/50 select-none mr-4">41</div>
                <div><span className="text-purple-400">  const</span> result = <span className="text-purple-400">await</span> db.execute(query);</div>
              </div>
              
              <div className="flex">
                <div className="w-8 text-right text-gray-600 select-none mr-4">42</div>
                <div><span className="text-purple-400">  if</span> (!result.rows[<span className="text-yellow-400">0</span>]) <span className="text-purple-400">throw new</span> Error(<span className="text-green-400">"Invalid session"</span>);</div>
              </div>
              <div className="flex">
                <div className="w-8 text-right text-gray-600 select-none mr-4">43</div>
                <div><span className="text-purple-400">  return</span> result.rows[<span className="text-yellow-400">0</span>];</div>
              </div>
              <div className="flex">
                <div className="w-8 text-right text-gray-600 select-none mr-4">44</div>
                <div>{`}`}</div>
              </div>
            </div>
            
            <div className="absolute top-[170px] right-6 bg-[#1A1A1A] border border-white/10 rounded-xl shadow-2xl p-4 max-w-[280px] z-10 backdrop-blur-xl">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold text-white">SQL Injection Vector</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-3">
                Token concatenated directly into query body. Allows arbitrary read/write against sessions table.
              </p>
              <div className="bg-black/50 border border-white/5 rounded-lg p-2.5 font-mono text-[11px]">
                <div className="text-emerald-400">+ db.query(`...$1`, [token])</div>
              </div>
            </div>
          </div>

          <aside className="lg:col-span-3 p-6 bg-white/[0.01] space-y-6">
            <div>
              <div className="label-mono mb-4">Verdict</div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm">
                <ShieldAlert className="w-4 h-4" />
                CRITICAL
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="label-mono">Suggested actions</div>
              <button className="w-full py-2.5 px-4 rounded-lg bg-white text-black font-medium text-sm hover:bg-gray-100 transition-colors shadow-lg shadow-white/10">
                Apply Patch
              </button>
              <button className="w-full py-2.5 px-4 rounded-lg bg-white/5 border border-white/10 text-white font-medium text-sm hover:bg-white/10 transition-colors">
                Dismiss Finding
              </button>
            </div>

            <div className="pt-4 border-t border-white/5">
              <div className="label-mono mb-3">Tags</div>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-gray-300 font-mono">CWE-89</span>
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-gray-300 font-mono">OWASP-A03</span>
              </div>
            </div>
          </aside>
        </div>

        <div className="border-t border-[--color-line] grid grid-cols-2 lg:grid-cols-4 divide-x divide-[--color-line] font-mono text-[11px]">
          <Stat label="Critical" value="04" tone="danger" />
          <Stat label="High" value="12" tone="warn" />
          <Stat label="Medium" value="29" tone="accent" />
          <Stat label="Patches ready" value="45" tone="ok" />
        </div>
      </div>
    </div>
  );
}

function PipelineItem({ label, state, time }: { label: string; state: "ok" | "active" | "idle"; time: string }) {
  const dot =
    state === "ok"
      ? "bg-[--color-ok]"
      : state === "active"
        ? "bg-[--color-accent] animate-pulse-soft"
        : "bg-[--color-text-mute]/40";
  const text = state === "idle" ? "text-[--color-text-mute]" : "text-[--color-text]";

  return (
    <div className="flex items-center justify-between font-mono text-[11px]">
      <span className="flex items-center gap-2.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className={text}>{label}</span>
      </span>
      <span className="text-[--color-text-mute]">{time}</span>
    </div>
  );
}

function FindingItem({
  tone,
  id,
  file,
  rule,
}: {
  tone: "danger" | "warn" | "accent";
  id: string;
  file: string;
  rule: string;
}) {
  const color =
    tone === "danger"
      ? "border-[--color-danger] text-[--color-danger]"
      : tone === "warn"
        ? "border-[--color-warn] text-[--color-warn]"
        : "border-[--color-accent] text-[--color-accent]";

  return (
    <div className="border-l-2 pl-2.5 py-1 font-mono text-[10.5px] leading-tight">
      <div className={`${color} flex justify-between`}>
        <span>{id}</span>
        <span>{rule}</span>
      </div>
      <div className="text-[--color-text-mute] truncate">{file}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "danger" | "warn" | "accent" | "ok";
}) {
  const color =
    tone === "danger"
      ? "text-[--color-danger]"
      : tone === "warn"
        ? "text-[--color-warn]"
        : tone === "accent"
          ? "text-[--color-accent]"
          : "text-[--color-ok]";

  return (
    <div className="px-5 py-3.5 flex items-center justify-between bg-[--color-bg-elev]/40">
      <span className="label-mono">{label}</span>
      <span className={`font-display text-2xl font-bold ${color}`}>{value}</span>
    </div>
  );
}
