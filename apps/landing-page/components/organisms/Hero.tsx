"use client";

import { Button } from "@/components/atoms/Button";
import { Tag } from "@/components/atoms/Tag";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Download,
  Terminal,
  ShieldAlert,
  Sparkles,
  SearchCode,
  ShieldCheck
} from "lucide-react";

export function Hero() {
  return (
    <section className="relative pt-32 pb-24 overflow-hidden">
      <div className="absolute inset-0 grid-bg pointer-events-none" aria-hidden />

      <div className="relative max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center text-center"
        >
          <div className="flex items-center gap-3 mb-8">
            <Tag tone="accent" className="bg-blue-500/10 border-blue-500/20 text-blue-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              v1.1.9 Available
            </Tag>
            <Tag tone="mute" className="hidden sm:flex">
              <Sparkles className="w-3.5 h-3.5 text-gray-400" />
              Built for the agent era
            </Tag>
          </div>

          <h1 className="font-display font-bold text-[clamp(2.8rem,7vw,6.5rem)] leading-[1.05] tracking-tight max-w-5xl">
            <span className="block text-white">Stop merging</span>
            <span className="block mt-2">
              <span className="text-gradient">unreviewed</span>{" "}
              <span className="relative inline-block">
                <span className="relative z-10 text-white">AI code.</span>
                <svg
                  className="absolute -bottom-3 left-0 w-full h-4 text-blue-400/50"
                  viewBox="0 0 200 12"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <motion.path
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.5, delay: 0.5, ease: "easeOut" }}
                    d="M2 8 Q 50 2, 100 6 T 198 4"
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </h1>

          <p className="mt-8 max-w-2xl text-[18px] leading-relaxed text-gray-400">
            CodeVetter is a beautiful desktop review platform for the diffs your agent
            ships. Catch what Cursor, Claude Code, and Devin missed — vulnerabilities, 
            regressions, and silent drift. Runs entirely offline.
          </p>

          <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="primary" href="#download" className="w-full sm:w-auto">
              <Download className="w-4 h-4" />
              Download for macOS
              <ArrowRight
                className="w-4 h-4 transition-transform group-hover:translate-x-1"
              />
            </Button>
            <Button variant="glass" href="#how" className="w-full sm:w-auto">
              <Terminal className="w-4 h-4 text-gray-400" />
              See it in action
            </Button>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs font-medium text-gray-500">
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              No telemetry
            </span>
            <span className="flex items-center gap-2">
              <SearchCode className="w-4 h-4 text-blue-400" />
              Bring your own key
            </span>
            <span className="flex items-center gap-2 text-gray-400">
              Open source · ISC
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="mt-24"
        >
          <HeroPreview />
        </motion.div>
      </div>
    </section>
  );
}

function HeroPreview() {
  return (
    <div className="relative max-w-[1100px] mx-auto perspective-1000">
      {/* Background glows */}
      <div
        className="absolute -inset-x-20 -inset-y-20 blur-3xl pointer-events-none opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, rgba(96, 165, 250, 0.4), transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(192, 132, 252, 0.3), transparent 60%)",
        }}
        aria-hidden
      />
      
      {/* App Window */}
      <div className="relative rounded-2xl border border-white/10 bg-[#0A0A0A]/80 backdrop-blur-2xl shadow-[0_0_80px_rgba(0,0,0,0.8),0_20px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.1)] overflow-hidden">
        {/* Titlebar */}
        <div className="flex items-center justify-between border-b border-white/5 px-4 h-12 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]"></div>
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]"></div>
            <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]"></div>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-white/5 border border-white/5 text-xs text-gray-400 font-medium">
            <SearchCode className="w-3.5 h-3.5" />
            <span>codevetter — review · feat/refresh-tokens</span>
          </div>
          <div className="w-12"></div> {/* Spacer for centering */}
        </div>

        {/* Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[560px]">
          
          {/* Sidebar */}
          <aside className="hidden lg:flex lg:col-span-3 flex-col border-r border-white/5 bg-white/[0.01]">
            <div className="px-5 pt-6 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Pipeline</div>
            <div className="px-3 space-y-1 pb-6 border-b border-white/5">
              <PipelineItem label="Diff parsed" state="ok" time="12ms" />
              <PipelineItem label="AST traced" state="ok" time="84ms" />
              <PipelineItem label="LLM scoring" state="active" time="1.4s" />
              <PipelineItem label="Severity tag" state="idle" time="—" />
              <PipelineItem label="Patch draft" state="idle" time="—" />
            </div>
            <div className="px-5 pt-6 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Findings</div>
            <div className="px-3 space-y-1 pb-5 flex-1">
              <FindingItem tone="danger" id="V-0821" rule="SQL Injection" />
              <FindingItem tone="warn" id="V-0822" rule="PII-leak" />
              <FindingItem tone="accent" id="V-0824" rule="TTL drift" />
            </div>
            <div className="border-t border-white/5 px-5 py-4 flex items-center justify-between text-xs">
              <span className="text-gray-500 font-medium">Model</span>
              <span className="text-blue-400 font-mono">claude-3-opus</span>
            </div>
          </aside>

          {/* Editor */}
          <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-white/5 relative bg-[#050505]">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 text-xs text-gray-400 font-mono">
              <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">vuln</span>
              <span>apps/api/src/auth/session_manager.ts</span>
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
            
            {/* Context Tooltip */}
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

          {/* Details */}
          <aside className="lg:col-span-3 p-6 bg-white/[0.01] space-y-6">
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Verdict</div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm">
                <ShieldAlert className="w-4 h-4" />
                CRITICAL
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Suggested Actions</div>
              <button className="w-full py-2.5 px-4 rounded-lg bg-white text-black font-medium text-sm hover:bg-gray-100 transition-colors shadow-lg shadow-white/10">
                Apply Patch
              </button>
              <button className="w-full py-2.5 px-4 rounded-lg bg-white/5 border border-white/10 text-white font-medium text-sm hover:bg-white/10 transition-colors">
                Dismiss Finding
              </button>
            </div>

            <div className="pt-4 border-t border-white/5">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tags</div>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-gray-300 font-mono">CWE-89</span>
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] text-gray-300 font-mono">OWASP-A03</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PipelineItem({ label, state, time }: { label: string; state: "ok" | "active" | "idle"; time: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-default">
      <div className="flex items-center gap-2.5">
        {state === "ok" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />}
        {state === "active" && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,0.5)]" />}
        {state === "idle" && <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />}
        <span className={`text-sm ${state === "idle" ? "text-gray-500" : "text-gray-300"}`}>{label}</span>
      </div>
      <span className="text-xs text-gray-500 font-mono">{time}</span>
    </div>
  );
}

function FindingItem({ tone, id, rule }: { tone: "danger" | "warn" | "accent"; id: string; rule: string }) {
  const colors = {
    danger: "text-red-400 border-red-500/30 bg-red-500/5",
    warn: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    accent: "text-blue-400 border-blue-500/30 bg-blue-500/5",
  };
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-1 ${colors[tone]}`}>
      <span className="text-xs font-mono">{id}</span>
      <span className="text-sm font-medium">{rule}</span>
    </div>
  );
}
