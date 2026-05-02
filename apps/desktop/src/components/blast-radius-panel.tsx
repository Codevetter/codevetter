import {
  AlertOctagon,
  ChevronDown,
  ChevronRight,
  Crosshair,
  FileCode,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { BlastRadiusReport, BlastSymbol } from "@/lib/tauri-ipc";
import { cn } from "@/lib/utils";

interface Props {
  report: BlastRadiusReport | null;
  loading: boolean;
  error: string | null;
  onJump?: (file: string, line: number) => void;
}

const KIND_LABEL: Record<string, string> = {
  function: "fn",
  "const-fn": "fn",
  method: "method",
  class: "class",
  struct: "struct",
  enum: "enum",
  type: "type",
};

function kindLabel(k: string) {
  return KIND_LABEL[k] ?? k;
}

function riskStyle(risk: string) {
  if (risk === "high")
    return "text-red-400 bg-red-500/10 border-red-500/30";
  if (risk === "medium")
    return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
}

function riskIcon(risk: string) {
  if (risk === "high") return <AlertOctagon size={12} />;
  if (risk === "medium") return <ShieldAlert size={12} />;
  return <ShieldCheck size={12} />;
}

function basename(p: string) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// ─── Symbol row ─────────────────────────────────────────────────────────────

function SymbolRow({
  symbol,
  onJump,
}: {
  symbol: BlastSymbol;
  onJump?: (file: string, line: number) => void;
}) {
  const [expanded, setExpanded] = useState(symbol.risk === "high");

  return (
    <div className="border-b border-[#1a1a1a] last:border-b-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#111111]"
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-slate-500" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-slate-500" />
        )}
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
            riskStyle(symbol.risk),
          )}
        >
          {riskIcon(symbol.risk)}
          {symbol.callerCount}
        </span>
        <span className="shrink-0 rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
          {kindLabel(symbol.kind)}
        </span>
        <span className="truncate font-mono text-xs text-slate-200">
          {symbol.name}
        </span>
        <span className="ml-auto truncate text-[10px] text-slate-600">
          {basename(symbol.definedIn)}
        </span>
      </button>

      {expanded && (
        <div className="bg-[#080808] px-3 pb-2">
          {symbol.callerCount === 0 ? (
            <p className="py-1 pl-5 text-[11px] italic text-emerald-500/70">
              No callers found — safe to change, or newly added and unused.
            </p>
          ) : (
            <ul className="mt-1 space-y-px pl-5">
              {symbol.callers.map((c, i) => (
                <li key={i}>
                  <button
                    onClick={() => onJump?.(c.file, c.line)}
                    className="group flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-[#111111]"
                  >
                    <FileCode
                      size={11}
                      className="mt-0.5 shrink-0 text-slate-600 group-hover:text-amber-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-[10px] text-slate-500 group-hover:text-amber-400">
                        {c.file}:{c.line}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-slate-400">
                        {c.snippet}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────

export default function BlastRadiusPanel({ report, loading, error, onJump }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const groups = useMemo(() => {
    if (!report) return { high: [], medium: [], safe: [] };
    const high: BlastSymbol[] = [];
    const medium: BlastSymbol[] = [];
    const safe: BlastSymbol[] = [];
    for (const s of report.symbols) {
      if (s.risk === "high") high.push(s);
      else if (s.risk === "medium") medium.push(s);
      else safe.push(s);
    }
    return { high, medium, safe };
  }, [report]);

  if (!report && !loading && !error) return null;

  return (
    <div className="border-b border-[#1a1a1a] bg-[#0a0a0a]">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#111111]"
      >
        {collapsed ? (
          <ChevronRight size={12} className="text-slate-500" />
        ) : (
          <ChevronDown size={12} className="text-slate-500" />
        )}
        <Target size={13} className="text-amber-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
          Blast Radius
        </span>

        {loading && (
          <span className="ml-2 flex items-center gap-1 text-[10px] text-slate-500">
            <Loader2 size={10} className="animate-spin" />
            scanning…
          </span>
        )}

        {report && !loading && (
          <span className="ml-2 flex items-center gap-2 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <Sparkles size={10} />
              {report.totalSymbols} symbol{report.totalSymbols !== 1 && "s"}
            </span>
            <span className="text-slate-700">·</span>
            <span className="flex items-center gap-1">
              <Crosshair size={10} />
              {report.totalCallers} caller{report.totalCallers !== 1 && "s"}
            </span>
            <span className="text-slate-700">·</span>
            <span>{report.changedFiles} file{report.changedFiles !== 1 && "s"}</span>
          </span>
        )}

        {report && !loading && (
          <div className="ml-auto flex items-center gap-1.5 text-[10px]">
            {groups.high.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-semibold text-red-400">
                <AlertOctagon size={10} /> {groups.high.length} high
              </span>
            )}
            {groups.medium.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-400">
                <ShieldAlert size={10} /> {groups.medium.length} med
              </span>
            )}
            {groups.safe.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-400">
                <ShieldCheck size={10} /> {groups.safe.length} safe
              </span>
            )}
          </div>
        )}
      </button>

      {!collapsed && (
        <>
          {error && (
            <div className="px-3 py-2 text-[11px] text-red-400">{error}</div>
          )}
          {report && !loading && report.totalSymbols === 0 && (
            <div className="px-3 py-2 text-[11px] text-slate-500">
              No top-level symbols defined in this diff.
            </div>
          )}
          {report && report.symbols.length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {report.symbols.map((s) => (
                <SymbolRow
                  key={`${s.definedIn}:${s.name}`}
                  symbol={s}
                  onJump={onJump}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
