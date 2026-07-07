import { Layers, Loader2, ScanSearch } from 'lucide-react';

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
  onUnpack: () => void;
  qaScore?: number | null;
  healthScore?: number | null;
  graphNodes?: number | null;
  progressDetail?: string | null;
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

function SnapshotFact({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--cv-line)] bg-white/[0.02] px-3 py-2.5">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className={cn('mt-1 truncate text-lg font-semibold tabular-nums', tone)}>{value}</div>
      {detail ? (
        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{detail}</div>
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

export function UnpackMissionControl({
  phase,
  inventory,
  hasReport,
  lastUpdated,
  commitSha,
  onUnpack,
  qaScore,
  healthScore,
  graphNodes,
  progressDetail,
}: Props) {
  const isBusy = phase === 'scanning' || phase === 'generating' || phase === 'asking';
  const phaseMeta = phaseLabel(phase);
  const files = inventory?.files_scanned ?? 0;

  if (!inventory) {
    return (
      <section className="overflow-hidden rounded-xl border border-[var(--cv-line)] bg-[var(--bg-surface)]/70">
        <div className="border-b border-[var(--cv-line)] px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Snapshot
          </span>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                Generate a local snapshot
              </h2>
              {isBusy ? (
                <Badge
                  variant="outline"
                  className={cn('text-[10px] uppercase tracking-wider', phaseMeta.tone)}
                >
                  <Loader2 size={10} className="mr-1 animate-spin" />
                  {phaseMeta.text}
                </Badge>
              ) : (
                <UnpackRunKindBadge kind="local" />
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Fast offline scan for files, stack, graph hints, health signals, and repo structure.
              No AI or API keys.
            </p>
            {phase === 'scanning' && progressDetail ? (
              <p className="mt-2 truncate font-mono text-xs text-cyan-200/80">{progressDetail}</p>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0 rounded-xl border-cyan-300/20 bg-cyan-300/[0.07] px-4 text-cyan-100 hover:border-cyan-200/35 hover:bg-cyan-300/[0.1] hover:text-white"
            disabled={isBusy}
            onClick={onUnpack}
          >
            {phase === 'scanning' ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <ScanSearch size={14} className="mr-1.5" />
            )}
            Generate snapshot
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--cv-line)] bg-white/[0.018]">
      <div className="px-5 py-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex min-w-0 items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
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
                  'Local snapshot is ready. Analyze it only when you need interpretation.'
                )}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:items-end">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100 hover:border-cyan-200/35 hover:bg-cyan-300/[0.1] hover:text-white"
                  disabled={isBusy}
                  onClick={onUnpack}
                >
                  {phase === 'scanning' ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <ScanSearch size={14} className="mr-1.5" />
                  )}
                  Rescan
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-2 border-t border-[var(--cv-line)] p-3 sm:grid-cols-2 lg:grid-cols-5">
        <SnapshotFact
          label="Files"
          value={files.toLocaleString()}
          detail={`${inventory.files_skipped.toLocaleString()} skipped · local scan`}
          tone="text-cyan-100"
        />
        <SnapshotFact
          label="QA posture"
          value={qaScore != null ? `${qaScore}/100` : '—'}
          detail={inventory.qa_readiness?.status ?? 'not scored'}
          tone={scoreTone(qaScore, 100).text}
        />
        <SnapshotFact
          label="Health"
          value={healthScore != null ? `${healthScore.toFixed(1)}/10` : '—'}
          detail={
            inventory.repo_health ? `${inventory.repo_health.hotspot_count} hotspots` : 'not scored'
          }
          tone={scoreTone(healthScore, 10).text}
        />
        <SnapshotFact
          label="Graph"
          value={graphNodes != null ? graphNodes.toLocaleString() : '—'}
          detail={inventory.repo_graph ? `${inventory.repo_graph.edges.length} edges` : 'not built'}
          tone="text-violet-100"
        />
        <SnapshotFact
          label="Stack"
          value={inventory.stack_tags.length ? inventory.stack_tags.length.toLocaleString() : '—'}
          detail={
            inventory.stack_tags.length > 0
              ? inventory.stack_tags.slice(0, 3).join(' · ')
              : (inventory.branch ?? 'no tags')
          }
          tone="text-emerald-100"
        />
      </div>
    </section>
  );
}
