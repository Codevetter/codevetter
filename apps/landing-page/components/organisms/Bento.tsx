import { Spotlight } from "@/components/effects/Spotlight";
import {
  Cpu,
  GitBranch,
  KeyRound,
  Layers,
  ScanSearch,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";

export function Bento() {
  return (
    <section id="features" className="py-28 relative overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[--color-accent]/40 to-transparent pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute -top-40 right-0 w-[600px] h-[600px] rounded-full pointer-events-none opacity-50 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(125,211,252,0.10), transparent 70%)" }}
        aria-hidden
      />
      <div
        className="absolute top-1/2 -left-40 w-[500px] h-[500px] rounded-full pointer-events-none opacity-50 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(167,139,250,0.10), transparent 70%)" }}
        aria-hidden
      />
      <div className="relative max-w-7xl mx-auto px-6">
        <SectionHeading
          eyebrow="Capability matrix"
          title={
            <>
              Built for the way{" "}
              <span className="text-gradient">agents ship code.</span>
            </>
          }
          sub="Cursor, Claude Code, Devin — they merge fast and miss things. CodeVetter is the second pair of eyes that runs on your laptop."
        />

        <div className="mt-16 grid grid-cols-1 md:grid-cols-6 grid-rows-[repeat(4,minmax(140px,auto))] gap-4">
          <Card
            className="md:col-span-4 md:row-span-2"
            icon={<ScanSearch className="w-5 h-5" />}
            title="Diff-aware review engine"
            body="Parses your patch, traces affected call sites, and feeds the LLM a focused context window. No shotgun prompts, no hallucinated files."
          >
            <DiffVisual />
          </Card>

          <Card
            className="md:col-span-2 md:row-span-2"
            icon={<KeyRound className="w-5 h-5" />}
            title="Bring your own key"
            body="Anthropic, OpenAI, OpenRouter. Keys live in your OS keychain. Zero proxying through us."
          >
            <KeyVisual />
          </Card>

          <Card
            className="md:col-span-2"
            icon={<Cpu className="w-5 h-5" />}
            title="Runs offline"
            body="Tauri binary. SQLite under the hood. No backend, no signup."
          >
            <OfflineVisual />
          </Card>
          <Card
            className="md:col-span-2"
            icon={<GitBranch className="w-5 h-5" />}
            title="Git-native"
            body="Staged diffs, ranges, branches. Drop into any repo."
          >
            <GitVisual />
          </Card>
          <Card
            className="md:col-span-2"
            icon={<Layers className="w-5 h-5" />}
            title="Severity-tiered"
            body="Critical → high → medium. Mapped to CWE & OWASP."
          >
            <SeverityVisual />
          </Card>

          <Card
            className="md:col-span-6"
            icon={<Wand2 className="w-5 h-5" />}
            title="Patch suggestions, not pep talks"
            body="Every finding ships with a concrete code edit you can apply or discard. Reasoning is shown, not narrated."
          >
            <PatchVisual />
          </Card>
        </div>
      </div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: string;
}) {
  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-8 h-px bg-gradient-to-r from-[--color-accent] to-transparent" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[--color-accent]">
          {eyebrow}
        </span>
      </div>
      <h2 className="font-display text-[clamp(2rem,4.5vw,3.6rem)] font-bold leading-[1.04] tracking-tight">
        {title}
      </h2>
      {sub && (
        <p className="mt-5 text-[16px] text-[--color-text-dim] leading-relaxed">
          {sub}
        </p>
      )}
    </div>
  );
}

function Card({
  icon,
  title,
  body,
  className = "",
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Spotlight
      className={`group relative bg-[--color-surface] border border-[--color-line] hover:border-[--color-accent]/50 transition-colors p-6 overflow-hidden noise ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[--color-accent]/[0.04] via-transparent to-[--color-accent-3]/[0.04] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <div
        className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[--color-accent] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
        aria-hidden
      />
      <div className="relative flex flex-col h-full">
        <div className="flex items-center gap-2.5 text-[--color-accent]">
          {icon}
          <span className="label-mono !text-[--color-accent]">
            // {title.slice(0, 14).toUpperCase()}
          </span>
        </div>
        <h3 className="mt-4 font-display text-xl font-semibold tracking-tight leading-snug">
          {title}
        </h3>
        <p className="mt-2 text-[14px] text-[--color-text-dim] leading-relaxed">
          {body}
        </p>
        {children && <div className="mt-6 flex-1">{children}</div>}
      </div>
    </Spotlight>
  );
}

function DiffVisual() {
  return (
    <div className="relative bg-[--color-bg] border border-[--color-line] font-mono text-[11.5px] leading-[1.85] p-4 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[--color-accent]/40 to-transparent" aria-hidden />
      <div className="text-[--color-text-mute] mb-1">@@ apps/api/src/users.ts @@</div>
      <div className="bg-[--color-danger]/10 -mx-4 px-4 border-l-2 border-[--color-danger] text-[--color-danger]">
        {"- return await db.raw(`SELECT * FROM users WHERE id = ${id}`);"}
      </div>
      <div className="bg-[--color-ok]/10 -mx-4 px-4 border-l-2 border-[--color-ok] text-[--color-ok]">
        {"+ return await db.query(`SELECT * FROM users WHERE id = $1`, [id]);"}
      </div>
      <div className="text-[--color-text-mute] mt-2 mb-1">@@ apps/api/src/cache.ts @@</div>
      <div className="bg-[--color-warn]/10 -mx-4 px-4 border-l-2 border-[--color-warn] text-[--color-warn]/90">
        ~ ttl 60s → 86400s · review eviction
      </div>
      <div className="bg-[--color-warn]/10 -mx-4 px-4 border-l-2 border-[--color-warn] text-[--color-warn]/90">
        ~ no invalidation on user.update
      </div>
    </div>
  );
}

function KeyVisual() {
  const providers = [
    { p: "Anthropic", m: "claude-opus-4-7", state: "ok", env: "$ANTHROPIC_KEY" },
    { p: "OpenAI", m: "gpt-5-codex", state: "ok", env: "$OPENAI_KEY" },
    { p: "OpenRouter", m: "kimi-k2", state: "idle", env: "—" },
    { p: "Local", m: "qwen-3-coder", state: "idle", env: "ollama:11434" },
  ];
  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <div
          key={p.p}
          className="border border-[--color-line] bg-[--color-bg] px-3 py-2 hover:border-[--color-accent]/40 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-[--color-text]">
              {p.p}
            </span>
            <span
              className={`font-mono text-[9px] uppercase tracking-[0.2em] ${
                p.state === "ok" ? "text-[--color-ok]" : "text-[--color-text-mute]"
              }`}
            >
              {p.state === "ok" ? "● live" : "○ ready"}
            </span>
          </div>
          <div className="font-mono text-[10px] text-[--color-text-mute] mt-0.5 truncate">
            {p.m} · {p.env}
          </div>
        </div>
      ))}
    </div>
  );
}

function OfflineVisual() {
  return (
    <div className="relative h-20 bg-[--color-bg] border border-[--color-line] overflow-hidden flex items-center justify-center">
      <svg viewBox="0 0 200 60" className="absolute inset-0 w-full h-full" aria-hidden>
        <defs>
          <linearGradient id="net" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(125,211,252,0)" />
            <stop offset="0.5" stopColor="rgba(125,211,252,0.6)" />
            <stop offset="1" stopColor="rgba(125,211,252,0)" />
          </linearGradient>
        </defs>
        <line x1="0" y1="30" x2="80" y2="30" stroke="url(#net)" strokeDasharray="2 4" />
        <line x1="120" y1="30" x2="200" y2="30" stroke="url(#net)" strokeDasharray="2 4" opacity="0.3" />
      </svg>
      <div className="relative z-10 flex items-center gap-3">
        <div className="w-10 h-10 border border-[--color-accent] bg-[--color-accent]/10 flex items-center justify-center">
          <Cpu className="w-5 h-5 text-[--color-accent]" strokeWidth={1.5} />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em]">
          <div className="text-[--color-ok]">● local</div>
          <div className="text-[--color-text-mute] line-through">cloud</div>
        </div>
      </div>
    </div>
  );
}

function GitVisual() {
  return (
    <div className="relative h-20 bg-[--color-bg] border border-[--color-line] overflow-hidden p-3">
      <div className="font-mono text-[10.5px] leading-[1.6]">
        <div className="text-[--color-text-mute]">$ git diff HEAD~1</div>
        <div className="text-[--color-accent]">→ 4 files · 87 lines</div>
        <div className="text-[--color-text-mute]">$ codevetter review</div>
        <div className="text-[--color-ok] flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-[--color-ok] animate-pulse-soft" />
          scanning…
        </div>
      </div>
    </div>
  );
}

function SeverityVisual() {
  return (
    <div className="space-y-1.5">
      {[
        { k: "Critical", v: 4, c: "--color-danger" },
        { k: "High", v: 12, c: "--color-warn" },
        { k: "Medium", v: 29, c: "--color-accent" },
      ].map((s) => (
        <div key={s.k} className="flex items-center gap-2 font-mono text-[10.5px]">
          <span
            className="uppercase tracking-[0.16em] w-16 shrink-0"
            style={{ color: `var(${s.c})` }}
          >
            {s.k}
          </span>
          <div className="flex-1 h-1.5 bg-[--color-line] overflow-hidden">
            <div
              className="h-full"
              style={{
                width: `${(s.v / 29) * 100}%`,
                background: `var(${s.c})`,
              }}
            />
          </div>
          <span className="text-[--color-text-mute] tabular-nums">
            {String(s.v).padStart(2, "0")}
          </span>
        </div>
      ))}
    </div>
  );
}

function PatchVisual() {
  const findings = [
    {
      sev: "Critical",
      color: "--color-danger",
      title: "SQLi — token concatenated",
      body: "Token interpolated into query body. Parameterize or fail.",
      fix: "db.query(`...$1`,[token])",
    },
    {
      sev: "High",
      color: "--color-warn",
      title: "PII logged at INFO",
      body: "auth token leaks into observability stack.",
      fix: "logger.redact(['token'])",
    },
    {
      sev: "Medium",
      color: "--color-accent",
      title: "/auth/refresh missing rate-limit",
      body: "No throttle on token mint. DoS vector.",
      fix: "rateLimit({ rpm: 60 })",
    },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {findings.map((f) => (
        <div
          key={f.title}
          className="relative bg-[--color-bg] border border-[--color-line] p-4 space-y-2.5 overflow-hidden group/card hover:border-[--color-accent]/30 transition-colors"
          style={{ borderLeftColor: `var(${f.color})`, borderLeftWidth: 2 }}
        >
          <div className="flex items-center justify-between">
            <span
              className="font-mono text-[10px] uppercase tracking-[0.18em]"
              style={{ color: `var(${f.color})` }}
            >
              // {f.sev}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[--color-text-mute]">
              FIX-1m
            </span>
          </div>
          <div className="font-display text-[15px] font-semibold leading-snug">
            {f.title}
          </div>
          <div className="text-[12px] text-[--color-text-dim] leading-relaxed">
            {f.body}
          </div>
          <div className="font-mono text-[10.5px] bg-[--color-surface-2] border border-[--color-line] px-2.5 py-1.5 text-[--color-ok]">
            + {f.fix}
          </div>
        </div>
      ))}
    </div>
  );
}
