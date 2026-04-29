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
    <section id="features" className="py-32 relative overflow-hidden">
      <div
        className="absolute -top-40 right-0 w-[800px] h-[800px] rounded-full pointer-events-none opacity-40 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(96,165,250,0.15), transparent 100%)" }}
        aria-hidden
      />
      <div
        className="absolute top-1/2 -left-40 w-[600px] h-[600px] rounded-full pointer-events-none opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(192,132,252,0.15), transparent 100%)" }}
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

        <div className="mt-20 grid grid-cols-1 md:grid-cols-6 grid-rows-[repeat(4,minmax(180px,auto))] gap-6">
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
    <div className="max-w-3xl flex flex-col items-center mx-auto text-center">
      <div className="flex items-center gap-3 mb-6 bg-blue-500/10 border border-blue-500/20 px-4 py-1.5 rounded-full shadow-[0_0_15px_rgba(96,165,250,0.15)]">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-xs uppercase tracking-widest text-blue-400 font-semibold">
          {eyebrow}
        </span>
      </div>
      <h2 className="font-display text-[clamp(2.4rem,5vw,4.2rem)] font-bold leading-[1.05] tracking-tight">
        {title}
      </h2>
      {sub && (
        <p className="mt-6 text-[18px] text-gray-400 leading-relaxed max-w-2xl mx-auto">
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
    <div
      className={`group relative bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all duration-500 p-8 rounded-3xl overflow-hidden backdrop-blur-xl shadow-lg ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] via-transparent to-purple-500/[0.03] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div
        className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        aria-hidden
      />
      <div className="relative flex flex-col h-full z-10">
        <div className="flex items-center gap-3 text-blue-400 mb-6">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 shadow-[0_0_15px_rgba(96,165,250,0.15)]">
            {icon}
          </div>
        </div>
        <h3 className="font-display text-2xl font-bold tracking-tight text-white mb-3">
          {title}
        </h3>
        <p className="text-[15px] text-gray-400 leading-relaxed mb-6">
          {body}
        </p>
        {children && <div className="mt-auto pt-6 flex-1 flex flex-col justify-end">{children}</div>}
      </div>
    </div>
  );
}

function DiffVisual() {
  return (
    <div className="relative rounded-xl border border-white/5 bg-[#050505] font-mono text-[12px] leading-relaxed p-5 overflow-hidden shadow-inner">
      <div className="text-gray-500 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
        apps/api/src/users.ts
      </div>
      <div className="bg-red-500/10 -mx-5 px-5 border-l-2 border-red-500 text-red-400 py-1.5 mb-1">
        {"- return await db.raw(`SELECT * FROM users WHERE id = ${id}`);"}
      </div>
      <div className="bg-emerald-500/10 -mx-5 px-5 border-l-2 border-emerald-500 text-emerald-400 py-1.5">
        {"+ return await db.query(`SELECT * FROM users WHERE id = $1`, [id]);"}
      </div>
      <div className="text-gray-500 mt-5 mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
        apps/api/src/cache.ts
      </div>
      <div className="bg-amber-500/10 -mx-5 px-5 border-l-2 border-amber-500 text-amber-400 py-1.5 mb-1">
        ~ ttl 60s → 86400s · review eviction
      </div>
      <div className="bg-amber-500/10 -mx-5 px-5 border-l-2 border-amber-500 text-amber-400 py-1.5">
        ~ no invalidation on user.update
      </div>
    </div>
  );
}

function KeyVisual() {
  const providers = [
    { p: "Anthropic", m: "claude-3.5-sonnet", state: "ok", env: "$ANTHROPIC_API_KEY" },
    { p: "OpenAI", m: "gpt-4o", state: "ok", env: "$OPENAI_API_KEY" },
    { p: "OpenRouter", m: "gemini-pro", state: "idle", env: "—" },
  ];
  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <div
          key={p.p}
          className="flex flex-col justify-center rounded-xl border border-white/5 bg-[#050505] p-4 hover:border-white/10 transition-colors"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-gray-200">
              {p.p}
            </span>
            <span
              className={`flex items-center gap-1.5 text-xs font-medium ${
                p.state === "ok" ? "text-emerald-400" : "text-gray-500"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${p.state === "ok" ? "bg-emerald-400" : "bg-gray-500"}`}></span>
              {p.state === "ok" ? "Live" : "Ready"}
            </span>
          </div>
          <div className="font-mono text-[11px] text-gray-500 truncate flex items-center gap-2">
            <span className="text-gray-400 bg-white/5 px-2 py-0.5 rounded">{p.m}</span>
            <span>{p.env}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function OfflineVisual() {
  return (
    <div className="relative h-24 rounded-xl border border-white/5 bg-[#050505] overflow-hidden flex items-center justify-center group/offline">
      <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover/offline:opacity-100 transition-opacity"></div>
      <div className="relative z-10 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.2)]">
          <Cpu className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="flex flex-col gap-1 text-xs font-mono">
          <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            127.0.0.1
          </div>
          <div className="flex items-center gap-2 text-gray-600 px-2 py-1">
            <span className="line-through">api.external.com</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GitVisual() {
  return (
    <div className="relative h-24 rounded-xl border border-white/5 bg-[#050505] p-4 flex flex-col justify-center">
      <div className="font-mono text-[12px] leading-relaxed">
        <div className="text-gray-500 flex items-center gap-2">
          <span className="text-purple-400">❯</span> git diff HEAD~1
        </div>
        <div className="text-gray-400 ml-4 mb-2">→ 4 files · 87 lines</div>
        <div className="text-gray-500 flex items-center gap-2">
          <span className="text-blue-400">❯</span> codevetter review
        </div>
        <div className="text-emerald-400 ml-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Analyzing diff...
        </div>
      </div>
    </div>
  );
}

function SeverityVisual() {
  return (
    <div className="space-y-3 pt-2">
      {[
        { k: "Critical", v: 4, c: "bg-red-500", text: "text-red-400" },
        { k: "High", v: 12, c: "bg-amber-500", text: "text-amber-400" },
        { k: "Medium", v: 29, c: "bg-blue-500", text: "text-blue-400" },
      ].map((s) => (
        <div key={s.k} className="flex items-center gap-3 text-sm font-medium">
          <span className={`w-20 ${s.text}`}>{s.k}</span>
          <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full ${s.c} shadow-[0_0_10px_rgba(255,255,255,0.2)]`}
              style={{
                width: `${(s.v / 29) * 100}%`,
              }}
            />
          </div>
          <span className="text-gray-400 font-mono text-xs w-6 text-right">
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
      color: "text-red-400",
      bg: "bg-red-500/10 border-red-500/20",
      title: "SQL Injection Vector",
      body: "Unparameterized token concatenated into query. High risk of arbitrary table access.",
      fix: "db.query(`...$1`,[token])",
    },
    {
      sev: "High",
      color: "text-amber-400",
      bg: "bg-amber-500/10 border-amber-500/20",
      title: "PII Leak in Logger",
      body: "Authentication token leaks into DataDog via unredacted request payload.",
      fix: "logger.redact(['token', 'pwd'])",
    },
    {
      sev: "Medium",
      color: "text-blue-400",
      bg: "bg-blue-500/10 border-blue-500/20",
      title: "Missing Rate Limit",
      body: "No throttle applied to /auth/refresh. Potential vector for token exhaustion DoS.",
      fix: "rateLimit({ rpm: 60 })",
    },
  ];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {findings.map((f) => (
        <div
          key={f.title}
          className="relative rounded-xl border border-white/5 bg-[#050505] p-5 hover:border-white/10 transition-colors"
        >
          <div className="flex items-center justify-between mb-4">
            <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold tracking-wider ${f.bg} ${f.color}`}>
              {f.sev}
            </span>
            <span className="font-mono text-[10px] text-gray-500 bg-white/5 px-2 py-1 rounded">
              Auto-Fix
            </span>
          </div>
          <div className="font-display text-[16px] font-bold text-gray-200 mb-2">
            {f.title}
          </div>
          <div className="text-[13px] text-gray-400 leading-relaxed mb-4 min-h-[40px]">
            {f.body}
          </div>
          <div className="font-mono text-[11.5px] rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 shadow-inner">
            + {f.fix}
          </div>
        </div>
      ))}
    </div>
  );
}