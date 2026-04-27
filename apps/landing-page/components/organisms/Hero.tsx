"use client";

import { Button } from "@/components/atoms/Button";
import { Tag } from "@/components/atoms/Tag";
import { Aurora } from "@/components/effects/Aurora";
import { ParticleField } from "@/components/effects/ParticleField";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Download,
  Terminal,
  GitPullRequestArrow,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

export function Hero() {
  return (
    <section className="relative pt-32 pb-24 overflow-hidden">
      <Aurora intensity="med" />
      <div className="absolute inset-0 grid-bg pointer-events-none" aria-hidden />
      <ParticleField count={36} />

      <div className="relative max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center text-center"
        >
          <div className="flex items-center gap-2 mb-8">
            <Tag tone="accent">
              <span className="w-1.5 h-1.5 rounded-full bg-[--color-accent] animate-pulse-soft" />
              v1.1.9 · macOS · Windows · Linux
            </Tag>
            <Tag tone="mute">
              <Sparkles className="w-3 h-3" strokeWidth={1.5} />
              Built for the agent era
            </Tag>
          </div>

          <h1 className="font-display font-bold text-[clamp(2.6rem,7.2vw,6rem)] leading-[1.0] tracking-tight max-w-5xl">
            <span className="block">Stop merging</span>
            <span className="block">
              <span className="text-gradient">unreviewed</span>{" "}
              <span className="relative inline-block">
                <span className="relative z-10">AI code.</span>
                <svg
                  className="absolute -bottom-2 left-0 w-full h-3 text-[--color-accent]/70"
                  viewBox="0 0 200 12"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <motion.path
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.2, delay: 0.6, ease: "easeOut" }}
                    d="M2 8 Q 50 2, 100 6 T 198 4"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-[17px] leading-relaxed text-[--color-text-dim]">
            CodeVetter is a desktop review platform for the diffs your agent
            ships. Bring any LLM, run it on your laptop, and catch what Cursor,
            Claude Code, and Devin missed — vulnerabilities, regressions, and
            silent drift.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" href="#download">
              <Download className="w-4 h-4" strokeWidth={1.5} />
              Download for macOS
              <ArrowRight
                className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                strokeWidth={1.5}
              />
            </Button>
            <Button variant="outline" href="#how">
              <Terminal className="w-4 h-4" strokeWidth={1.5} />
              See it in action
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[--color-text-mute]">
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
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
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
        className="absolute -inset-x-12 -inset-y-10 blur-3xl pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 30%, rgba(56,189,248,0.30), transparent 70%), radial-gradient(40% 40% at 80% 80%, rgba(167,139,250,0.25), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="corner-frame relative bg-[--color-surface] border border-[--color-line] glow-edge noise overflow-hidden">
        <div className="flex items-center justify-between border-b border-[--color-line] px-4 h-10 bg-[--color-bg-elev]">
          <div className="flex items-center gap-1.5">
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

        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[520px]">
          <aside className="hidden lg:flex lg:col-span-3 flex-col border-r border-[--color-line] bg-[--color-bg-elev]/40">
            <div className="px-5 pt-5 pb-3 label-mono">Pipeline</div>
            <div className="px-5 space-y-2.5 pb-5 border-b border-[--color-line]">
              {[
                { label: "Diff parsed", state: "ok" as const, t: "12ms" },
                { label: "AST traced", state: "ok" as const, t: "84ms" },
                { label: "LLM scoring", state: "active" as const, t: "1.4s" },
                { label: "Severity tag", state: "idle" as const, t: "—" },
                { label: "Patch draft", state: "idle" as const, t: "—" },
              ].map((s, i) => (
                <PipelineRow key={i} {...s} />
              ))}
            </div>
            <div className="px-5 pt-5 pb-3 label-mono">Findings</div>
            <div className="px-5 space-y-2 pb-5 flex-1">
              <FindingRow tone="danger" id="V-0821" file="session_manager.ts" rule="SQLi" />
              <FindingRow tone="warn" id="V-0822" file="logger.ts" rule="PII-leak" />
              <FindingRow tone="warn" id="V-0823" file="auth.ts" rule="Rate-limit" />
              <FindingRow tone="accent" id="V-0824" file="cache.ts" rule="TTL drift" />
            </div>
            <div className="border-t border-[--color-line] px-5 py-3 flex items-center justify-between font-mono text-[10px]">
              <span className="text-[--color-text-mute] tracking-[0.18em] uppercase">Model</span>
              <span className="text-[--color-accent]">claude-opus-4-7</span>
            </div>
          </aside>

          <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-[--color-line] relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[--color-accent] to-transparent animate-scan" />
            </div>
            <CodeBlock />
          </div>

          <aside className="lg:col-span-3 p-5 bg-[--color-bg-elev]/40 space-y-5 relative">
            <div className="flex items-center justify-between">
              <span className="label-mono">Verdict</span>
              <Tag tone="danger">
                <ShieldAlert className="w-3 h-3" strokeWidth={1.5} />
                CRITICAL
              </Tag>
            </div>
            <div className="space-y-2">
              <div className="font-display text-[16px] font-semibold leading-snug">
                SQL injection via string-built query
              </div>
              <div className="text-[12px] text-[--color-text-dim] leading-relaxed">
                Token concatenated directly into query body. Allows arbitrary
                read/write against <span className="font-mono text-[--color-accent]">sessions</span>.
              </div>
            </div>

            <div className="border-y border-[--color-line] py-4 space-y-2">
              <div className="label-mono">Suggested patch</div>
              <div className="font-mono text-[11px] bg-[--color-surface-2] p-2.5 border border-[--color-line] leading-relaxed">
                <div className="text-[--color-danger]/90">
                  <span className="text-[--color-text-mute]">- </span>
                  {"`SELECT * WHERE token='${token}'`"}
                </div>
                <div className="text-[--color-ok]/95">
                  <span>+ </span>
                  {"db.query(`...WHERE token=$1`,[token])"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {["CWE-89", "OWASP-A03", "FIX-1m"].map((b) => (
                <Tag key={b} tone="mute" className="justify-center">
                  {b}
                </Tag>
              ))}
            </div>

            <div className="pt-2 grid grid-cols-2 gap-2">
              <button className="font-mono text-[10px] uppercase tracking-[0.18em] py-2.5 bg-[--color-accent] text-[#001016] hover:bg-[--color-accent-2] transition-colors">
                Apply patch
              </button>
              <button className="font-mono text-[10px] uppercase tracking-[0.18em] py-2.5 border border-[--color-line] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors">
                Dismiss
              </button>
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

function PipelineRow({
  label,
  state,
  t,
}: {
  label: string;
  state: "ok" | "active" | "idle";
  t: string;
}) {
  const dot =
    state === "ok"
      ? "bg-[--color-ok]"
      : state === "active"
        ? "bg-[--color-accent] animate-pulse-soft"
        : "bg-[--color-text-mute]/40";
  const text =
    state === "idle" ? "text-[--color-text-mute]" : "text-[--color-text]";
  return (
    <div className="flex items-center justify-between font-mono text-[11px]">
      <span className="flex items-center gap-2.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className={text}>{label}</span>
      </span>
      <span className="text-[--color-text-mute]">{t}</span>
    </div>
  );
}

function FindingRow({
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

function CodeBlock() {
  const lines: { n: number; el: React.ReactNode; danger?: boolean }[] = [
    { n: 36, el: <><span className="text-[#c084fc]">import</span> {`{`} db {`}`} <span className="text-[#c084fc]">from</span> <span className="text-[#86efac]">{`"@/lib/sql"`}</span>;</> },
    { n: 37, el: <></> },
    { n: 38, el: <><span className="text-[#c084fc]">async function</span> <span className="text-[#fde68a]">validateSession</span>(token: <span className="text-[#7dd3fc]">string</span>) {`{`}</> },
    { n: 39, el: <span className="text-[--color-text-mute]">{`  // resolve session for the incoming request`}</span> },
    { n: 40, el: <><span className="text-[#c084fc]">  const</span> query = <span className="text-[#86efac]">{`\`SELECT * FROM sessions WHERE token = '\${token}'\``}</span>;</>, danger: true },
    { n: 41, el: <><span className="text-[#c084fc]">  const</span> result = <span className="text-[#7dd3fc]">await</span> db.execute(query);</>, danger: true },
    { n: 42, el: <><span className="text-[#c084fc]">  if</span> (!result.rows[<span className="text-[#fde68a]">0</span>]) <span className="text-[#c084fc]">throw new</span> Error(<span className="text-[#86efac]">"Invalid session"</span>);</> },
    { n: 43, el: <><span className="text-[#c084fc]">  return</span> result.rows[<span className="text-[#fde68a]">0</span>];</> },
    { n: 44, el: <>{`}`}</> },
  ];

  return (
    <div className="p-6 font-mono text-[13px] leading-[1.75]">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-[--color-line]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[--color-danger] animate-pulse-soft" />
          <span className="label-mono">apps/api/src/auth/session_manager.ts</span>
        </div>
        <span className="label-mono text-[--color-danger]">+2 / -0 · vuln</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-5">
        {lines.map((l) => (
          <div key={l.n} className="contents group">
            <span className="text-right text-[--color-text-mute]/60 select-none tabular-nums">
              {l.n}
            </span>
            <span
              className={
                l.danger
                  ? "relative -mx-3 px-3 bg-[--color-danger]/10 border-l-2 border-[--color-danger]"
                  : ""
              }
            >
              {l.el}
              {l.danger && l.n === 40 && (
                <span className="ml-3 inline-flex items-center gap-1 align-middle">
                  <Tag tone="danger" className="!text-[9px] !tracking-[0.2em]">
                    SQLi · CWE-89
                  </Tag>
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
