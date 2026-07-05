import type { UnpackRepoInventory, UnpackScanProfile } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

type Props = {
  profile: UnpackScanProfile | null;
  inventory?: UnpackRepoInventory | null;
  className?: string;
  title?: string;
};

function heatClass(pct: number): string {
  if (pct >= 40) return 'bg-red-500/85';
  if (pct >= 25) return 'bg-amber-500/80';
  if (pct >= 12) return 'bg-violet-500/75';
  return 'bg-cyan-500/70';
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function stageName(stage: string): string {
  if (stage === 'background_enrich') return 'Background enrich';
  if (stage === 'fast_scan') return 'Fast scan';
  if (stage === 'full_scan') return 'Full local scan';
  if (stage === 'local_scan_persist') return 'Persist';
  if (stage === 'fast_scan_persist') return 'Persist';
  return stage;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function UnpackScanProfileHeatmap({ profile, inventory, className, title }: Props) {
  if (!profile || profile.steps.length === 0) return null;

  const maxMs = Math.max(...profile.steps.map((s) => s.ms), 1);
  const stageLabel = stageName(profile.stage);
  const graph = inventory?.repo_graph;
  const health = inventory?.repo_health;
  const history = inventory?.history_brief;
  const coverageSummary = inventory?.coverage ?? null;
  const totalFiles = coverageSummary?.total_files ?? inventory?.estimated_total_files ?? null;
  const coverage =
    inventory && totalFiles && totalFiles > 0
      ? `${inventory.files_scanned.toLocaleString()} / ${totalFiles.toLocaleString()}`
      : (inventory?.files_scanned.toLocaleString() ?? '—');
  const coveragePct =
    coverageSummary?.sample_percent ??
    (inventory && totalFiles && totalFiles > 0
      ? (inventory.files_scanned / totalFiles) * 100
      : null);
  const graphTruncated = Boolean(graph?.truncated);
  const healthTruncated = Boolean(health?.truncated);
  const workspaceUnits = inventory?.workspace_units?.length ?? 0;
  const hasWholeRepoMetadata = Boolean(
    inventory && (!inventory.max_files_hit || coverageSummary?.total_files)
  );
  const metrics = [
    { label: 'Total', value: `${profile.total_ms.toLocaleString()}ms` },
    { label: 'Peak RSS', value: formatBytes(profile.peak_rss_bytes) },
    { label: 'Files', value: coverage },
    {
      label: 'Strategy',
      value: coverageSummary?.strategy?.replaceAll('_', ' ') ?? '—',
    },
    { label: 'Bytes', value: formatBytes(inventory?.bytes_scanned) },
    { label: 'Graph', value: graph ? `${graph.nodes.length}/${graph.edges.length}` : '—' },
    { label: 'Graph cap', value: graph ? yesNo(graphTruncated) : '—' },
    { label: 'Health', value: health ? health.files_analyzed.toLocaleString() : '—' },
    { label: 'Health cap', value: health ? yesNo(healthTruncated) : '—' },
    { label: 'Workspaces', value: workspaceUnits ? workspaceUnits.toLocaleString() : '—' },
    {
      label: 'Deep sample',
      value: coveragePct !== null ? `${coveragePct.toFixed(1)}%` : 'full',
    },
    { label: 'Whole metadata', value: inventory ? yesNo(hasWholeRepoMetadata) : '—' },
    { label: 'Commits', value: history ? history.recent_commits.length.toLocaleString() : '—' },
    { label: 'Skipped', value: inventory?.files_skipped.toLocaleString() ?? '—' },
  ];

  return (
    <div
      className={cn(
        'rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/70 p-3',
        className
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--text-primary)]">
          {title ?? 'Scan heatmap'}
        </span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          {stageLabel} · {profile.total_ms.toLocaleString()}ms total
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1.5"
          >
            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              {metric.label}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-primary)]">
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      {inventory?.max_files_hit && (
        <div className="mb-3 rounded border border-yellow-500/25 bg-yellow-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-yellow-100">
          Safety cap hit. This snapshot covers {coverage}
          {coveragePct !== null ? ` files (${coveragePct.toFixed(1)}%)` : ' files'} for deep graph
          and health analysis.
          {coverageSummary?.notes?.[0] ? ` ${coverageSummary.notes[0]}` : ''}
          {hasWholeRepoMetadata
            ? ' Whole-repo tracked-file metadata is still used for languages, top dirs, and workspace boundaries.'
            : ''}
        </div>
      )}

      {(graphTruncated || healthTruncated) && (
        <div className="mb-3 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-cyan-100">
          Bounded analysis is active
          {graphTruncated ? '; graph nodes are capped after the highest-priority structure' : ''}
          {healthTruncated ? '; health scoring shows the highest-ranked candidate files' : ''}.
        </div>
      )}

      <div className="space-y-1.5">
        {profile.steps.map((step) => (
          <div
            key={`${profile.stage}-${step.id}`}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2"
          >
            <div className="min-w-0">
              <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
                <span className="truncate">{step.label}</span>
                <span className="shrink-0 font-mono text-[var(--text-muted)]">
                  {step.ms.toLocaleString()}ms · {step.pct.toFixed(0)}%
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[var(--bg-raised)]">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    heatClass(step.pct)
                  )}
                  style={{ width: `${Math.max(4, (step.ms / maxMs) * 100)}%` }}
                  title={`${step.label}: ${step.ms}ms (${step.pct.toFixed(1)}%)`}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 overflow-hidden rounded border border-[var(--cv-line)]">
        <div className="grid grid-cols-[minmax(0,1fr)_80px_64px] bg-[var(--bg-raised)] px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
          <span>Step</span>
          <span className="text-right">Time</span>
          <span className="text-right">Share</span>
        </div>
        {profile.steps.map((step) => (
          <div
            key={`${profile.stage}-${step.id}-row`}
            className="grid grid-cols-[minmax(0,1fr)_80px_64px] border-t border-[var(--cv-line)] px-2 py-1 text-[11px]"
          >
            <span className="truncate text-[var(--text-secondary)]">{step.label}</span>
            <span className="text-right font-mono text-[var(--text-primary)]">
              {step.ms.toLocaleString()}ms
            </span>
            <span className="text-right font-mono text-[var(--text-muted)]">
              {step.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
