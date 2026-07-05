import { AlertTriangle, GitBranch, Layers, Loader2, Network, ScanSearch } from 'lucide-react';
import { type ReactNode } from 'react';

import { UnpackAiPanel, type UnpackAskEntry } from '@/components/unpack-workspace/UnpackAiPanel';
import { UnpackRunKindBadge } from '@/components/unpack-workspace/UnpackRunKindBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { UnpackRepoInventory } from '@/lib/tauri-ipc';
import type { UnpackPhase } from '@/lib/unpack-sections';
import { cn } from '@/lib/utils';

type Props = {
  phase: UnpackPhase;
  repoPath: string;
  inventory?: UnpackRepoInventory | null;
  hasReport: boolean;
  lastUpdated?: string | null;
  commitSha?: string | null;
  agent: string;
  model: string;
  askQuestion: string;
  askAnswers: UnpackAskEntry[];
  onAgentChange: (agent: string) => void;
  onModelChange: (model: string) => void;
  onAskQuestionChange: (question: string) => void;
  onUnpack: () => void;
  onSummarize: () => void;
  onAsk: () => void;
  qaScore?: number | null;
  healthScore?: number | null;
  graphNodes?: number | null;
};

function phaseLabel(phase: UnpackPhase): { text: string; tone: string } {
  switch (phase) {
    case 'scanning':
      return { text: 'Unpacking', tone: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' };
    case 'generating':
      return {
        text: 'Summarizing',
        tone: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
      };
    case 'asking':
      return {
        text: 'Asking',
        tone: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
      };
    case 'ready':
      return { text: 'Ready', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' };
    case 'error':
      return { text: 'Error', tone: 'border-red-500/40 bg-red-500/10 text-red-200' };
    default:
      return {
        text: 'Idle',
        tone: 'border-[var(--cv-line)] bg-[var(--bg-raised)] text-[var(--text-muted)]',
      };
  }
}

function MetricTile({
  label,
  value,
  detail,
  icon,
  tone,
  progress,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon: ReactNode;
  tone: {
    text: string;
    border: string;
    bg: string;
    bar: string;
  };
  progress?: number | null;
}) {
  const pct = progress == null ? null : Math.max(0, Math.min(100, progress));
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]',
        tone.border,
        tone.bg
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider',
          tone.text
        )}
      >
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {pct != null ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
          <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {detail ? (
        <div className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{detail}</div>
      ) : null}
    </div>
  );
}

const metricTones = {
  cyan: {
    text: 'text-cyan-200',
    border: 'border-cyan-400/20',
    bg: 'bg-cyan-400/[0.055]',
    bar: 'bg-cyan-300',
  },
  emerald: {
    text: 'text-emerald-200',
    border: 'border-emerald-400/20',
    bg: 'bg-emerald-400/[0.055]',
    bar: 'bg-emerald-300',
  },
  amber: {
    text: 'text-amber-200',
    border: 'border-amber-400/20',
    bg: 'bg-amber-400/[0.055]',
    bar: 'bg-amber-300',
  },
  violet: {
    text: 'text-violet-200',
    border: 'border-violet-400/20',
    bg: 'bg-violet-400/[0.055]',
    bar: 'bg-violet-300',
  },
  rose: {
    text: 'text-rose-200',
    border: 'border-rose-400/20',
    bg: 'bg-rose-400/[0.055]',
    bar: 'bg-rose-300',
  },
} as const;

function scoreTone(
  score?: number | null,
  max = 100
): (typeof metricTones)[keyof typeof metricTones] {
  if (score == null) return metricTones.violet;
  const pct = (score / max) * 100;
  if (pct >= 80) return metricTones.emerald;
  if (pct >= 60) return metricTones.amber;
  return metricTones.rose;
}

function LanguageComposition({ inventory }: { inventory: UnpackRepoInventory }) {
  const languages = inventory.languages.slice(0, 5);
  if (languages.length === 0) return null;
  const total = Math.max(
    1,
    languages.reduce((sum, language) => sum + language.files, 0)
  );
  const colors = ['bg-cyan-300', 'bg-violet-300', 'bg-emerald-300', 'bg-amber-300', 'bg-rose-300'];

  return (
    <div className="border-t border-[var(--cv-line)] px-5 pb-5 pt-1">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-secondary)]">Language mix</span>
        {languages.map((language, index) => (
          <span key={language.language} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', colors[index] ?? 'bg-slate-400')} />
            {language.language}
          </span>
        ))}
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-black/30">
        {languages.map((language, index) => (
          <div
            key={language.language}
            className={colors[index] ?? 'bg-slate-400'}
            style={{ width: `${Math.max(3, (language.files / total) * 100)}%` }}
            title={`${language.language}: ${language.files.toLocaleString()} files`}
          />
        ))}
      </div>
    </div>
  );
}

export function UnpackMissionControl({
  phase,
  inventory,
  hasReport,
  lastUpdated,
  commitSha,
  agent,
  model,
  askQuestion,
  askAnswers,
  onAgentChange,
  onModelChange,
  onAskQuestionChange,
  onUnpack,
  onSummarize,
  onAsk,
  qaScore,
  healthScore,
  graphNodes,
}: Props) {
  const isBusy = phase === 'scanning' || phase === 'generating' || phase === 'asking';
  const phaseMeta = phaseLabel(phase);
  const files = inventory?.files_scanned ?? 0;
  const canRunAi = Boolean(inventory) && !isBusy;

  return (
    <section className="cv-frame cv-glow-edge cv-scan overflow-hidden rounded-xl">
      <div className="cv-terminal-bar px-5 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          unpack console
        </span>
        <span className="ml-auto font-mono text-[10px] text-cyan-300/70">local-first</span>
      </div>
      <div className="border-b border-[var(--cv-line)] bg-gradient-to-br from-[var(--bg-raised)]/80 via-transparent to-cyan-500/[0.04] px-5 py-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-0 items-center gap-2 text-xl font-semibold text-[var(--text-primary)]">
                  <Layers size={18} className="text-[var(--cv-accent)]" />
                  <span className="truncate">{inventory?.repo_name ?? 'Repo unpack'}</span>
                </div>
                <Badge
                  variant="outline"
                  className={cn('text-[10px] uppercase tracking-wider', phaseMeta.tone)}
                >
                  {isBusy ? <Loader2 size={10} className="mr-1 animate-spin" /> : null}
                  {phaseMeta.text}
                </Badge>
                {hasReport ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-[10px] uppercase tracking-wider text-emerald-200"
                  >
                    Summary ready
                  </Badge>
                ) : inventory ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-[10px] uppercase tracking-wider text-amber-200"
                  >
                    Inventory only
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                {lastUpdated ? (
                  <>
                    Last snapshot <span className="text-[var(--text-primary)]">{lastUpdated}</span>
                    {commitSha ? (
                      <span className="ml-2 font-mono text-[var(--text-muted)]">
                        · {commitSha.slice(0, 12)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  'Step 1: Generate local snapshot. Step 2: Analyze or ask questions when useful.'
                )}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:items-end">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cv-action-primary"
                  disabled={isBusy}
                  onClick={onUnpack}
                >
                  {phase === 'scanning' ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <ScanSearch size={14} className="mr-1.5" />
                  )}
                  Generate new
                </Button>
                <UnpackRunKindBadge kind="local" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {inventory ? (
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-5">
          <MetricTile
            label="Files"
            value={files.toLocaleString()}
            detail={`${inventory.files_skipped.toLocaleString()} skipped · local scan`}
            icon={<GitBranch size={11} />}
            tone={metricTones.cyan}
          />
          <MetricTile
            label="QA posture"
            value={qaScore != null ? `${qaScore}/100` : '—'}
            detail={inventory.qa_readiness?.status ?? 'not scored'}
            icon={<ScanSearch size={11} />}
            tone={scoreTone(qaScore, 100)}
            progress={qaScore}
          />
          <MetricTile
            label="Health"
            value={healthScore != null ? `${healthScore.toFixed(1)}/10` : '—'}
            detail={
              inventory.repo_health
                ? `${inventory.repo_health.hotspot_count} hotspots`
                : 'not scored'
            }
            icon={<AlertTriangle size={11} />}
            tone={scoreTone(healthScore, 10)}
            progress={healthScore != null ? healthScore * 10 : null}
          />
          <MetricTile
            label="Graph"
            value={graphNodes != null ? graphNodes.toLocaleString() : '—'}
            detail={
              inventory.repo_graph ? `${inventory.repo_graph.edges.length} edges` : 'not built'
            }
            icon={<Network size={11} />}
            tone={metricTones.violet}
            progress={
              inventory.repo_graph
                ? Math.min(
                    100,
                    (inventory.repo_graph.edges.length / Math.max(1, graphNodes ?? 1)) * 100
                  )
                : null
            }
          />
          <MetricTile
            label="Stack"
            value={inventory.stack_tags.length || '—'}
            detail={
              inventory.stack_tags.length > 0
                ? inventory.stack_tags.slice(0, 3).join(' · ')
                : (inventory.branch ?? 'no tags')
            }
            icon={<Layers size={11} />}
            tone={metricTones.emerald}
          />
        </div>
      ) : null}
      {inventory ? <LanguageComposition inventory={inventory} /> : null}
      <div className="border-t border-[var(--cv-line)] p-5">
        <UnpackAiPanel
          canRun={canRunAi}
          isSummarizing={phase === 'generating'}
          isAsking={phase === 'asking'}
          agent={agent}
          model={model}
          question={askQuestion}
          answers={askAnswers}
          onAgentChange={onAgentChange}
          onModelChange={onModelChange}
          onSummarize={onSummarize}
          onQuestionChange={onAskQuestionChange}
          onAsk={onAsk}
        />
      </div>
    </section>
  );
}
