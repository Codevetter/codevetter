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
  snapshotCount: number;
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
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon: ReactNode;
}) {
  return (
    <div className="cv-metric-tile rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {detail ? (
        <div className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{detail}</div>
      ) : null}
    </div>
  );
}

export function UnpackMissionControl({
  phase,
  inventory,
  hasReport,
  snapshotCount,
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
    <section className="cv-frame cv-glow-edge cv-scan overflow-hidden rounded-lg">
      <div className="cv-terminal-bar px-4 py-2.5">
        <span className="cv-dot bg-red-500/50" />
        <span className="cv-dot bg-amber-400/50" />
        <span className="cv-dot bg-emerald-400/50" />
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          unpack console
        </span>
        <span className="ml-auto font-mono text-[10px] text-cyan-300/70">local-first</span>
      </div>
      <div className="border-b border-[var(--cv-line)] bg-gradient-to-br from-[var(--bg-raised)]/80 via-transparent to-cyan-500/[0.04] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
                <Layers size={16} className="text-[var(--cv-accent)]" />
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
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">
              {lastUpdated ? (
                <>
                  Last snapshot <span className="text-[var(--text-primary)]">{lastUpdated}</span>
                  {commitSha ? (
                    <span className="ml-2 font-mono text-[var(--text-muted)]">
                      · {commitSha.slice(0, 12)}
                    </span>
                  ) : null}
                  <span className="ml-2 text-[var(--text-muted)]">
                    · {snapshotCount} stored run{snapshotCount === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                'Step 1: Generate local snapshot. Step 2: Analyze or ask questions when useful.'
              )}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </div>

      {inventory ? (
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricTile
            label="Files"
            value={files.toLocaleString()}
            detail={`${inventory.files_skipped.toLocaleString()} skipped · local scan`}
            icon={<GitBranch size={11} />}
          />
          <MetricTile
            label="QA posture"
            value={qaScore != null ? `${qaScore}/100` : '—'}
            detail={inventory.qa_readiness?.status ?? 'not scored'}
            icon={<ScanSearch size={11} />}
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
          />
          <MetricTile
            label="Graph"
            value={graphNodes != null ? graphNodes.toLocaleString() : '—'}
            detail={
              inventory.repo_graph ? `${inventory.repo_graph.edges.length} edges` : 'not built'
            }
            icon={<Network size={11} />}
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
          />
        </div>
      ) : null}
    </section>
  );
}
