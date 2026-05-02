import type { CliReviewFinding } from "@/lib/tauri-ipc";

interface FindingCardProps {
  finding: CliReviewFinding;
}

const severityConfig: Record<
  string,
  { icon: string; bg: string; text: string; border: string }
> = {
  critical: {
    icon: "\u2716",
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/20",
  },
  warning: {
    icon: "\u26A0",
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    border: "border-yellow-500/20",
  },
  suggestion: {
    icon: "\u2731",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
  },
  nitpick: {
    icon: "\u00B7",
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/20",
  },
};

const defaultConfig = {
  icon: "\u2022",
  bg: "bg-slate-500/10",
  text: "text-slate-400",
  border: "border-slate-500/20",
};

export default function FindingCard({ finding }: FindingCardProps) {
  const severity = finding.severity ?? "nitpick";
  const config = severityConfig[severity] ?? defaultConfig;

  return (
    <div
      className={`rounded-xl border ${config.border} ${config.bg} p-4 transition-colors`}
    >
      {/* Header */}
      <div className="mb-2 flex items-start gap-2">
        <span className={`mt-0.5 text-sm ${config.text}`}>{config.icon}</span>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-slate-200">
              {finding.title}
            </h4>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.text}`}
            >
              {severity}
            </span>
          </div>
          {(finding.filePath || finding.line != null) && (
            <p className="mono mt-0.5 text-xs text-slate-500">
              {finding.filePath}
              {finding.line != null ? `:${finding.line}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* Summary */}
      <p className="text-xs leading-relaxed text-slate-400">
        {finding.summary}
      </p>

      {/* Suggestion */}
      {finding.suggestion && (
        <div className="mono mt-3 rounded-lg border border-[#1a1a1a] bg-[#0f1117] p-3 text-xs leading-relaxed text-slate-300">
          {finding.suggestion}
        </div>
      )}

      {/* Confidence */}
      {finding.confidence != null && (
        <div className="mt-2 text-[10px] text-slate-600">
          Confidence: {Math.round(finding.confidence * 100)}%
        </div>
      )}
    </div>
  );
}
