import { Activity, Copy, GitCommit, Loader2, RefreshCw, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SourceLink } from '@/components/unpack-workspace/SourceLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  type DoraMetrics,
  deleteRepoIntelReport,
  getRepoIntelReport,
  isTauriAvailable,
  listRepoIntelReports,
  type RepoAttributionReport,
  type RepoIntelReportSummary,
  saveIntelSnapshot,
  type WindowReport,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

function formatSnapshotTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtNum(value: number): string {
  return value.toLocaleString('en-US');
}

function fmtCompact(value: number): string {
  if (Math.abs(value) < 10_000) return fmtNum(value);
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function findWindow(report: RepoAttributionReport | null, label: string): WindowReport | null {
  return report?.windows.find((window) => window.label === label) ?? null;
}

function formatHours(value: number | null): string {
  if (value == null) return 'unknown';
  if (value < 24) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)}d`;
}

function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 12) : 'unknown';
}

function shortPath(value: string): string {
  if (value === '(root)') return value;
  if (value.length <= 28) return value;
  return `.../${value.split('/').slice(-2).join('/')}`;
}

function SignalCard({
  label,
  value,
  detail,
  tone = 'text-slate-100',
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums', tone)}>{value}</div>
      <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{detail}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-[var(--cv-line)] bg-white/[0.025] p-4 text-left transition-colors hover:border-amber-300/30 focus:outline-none focus:ring-2 focus:ring-amber-300/25"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--cv-line)] bg-white/[0.025] p-4">{content}</div>
  );
}

type ActivityZoom = {
  label: string;
  value: string;
  detail: string;
  rows: Array<{ label: string; value: string; detail?: string; source?: string }>;
};

function ActivityMetricDialog({
  zoom,
  repoPath,
  onOpenChange,
}: {
  zoom: ActivityZoom | null;
  repoPath: string;
  onOpenChange: (zoom: ActivityZoom | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!zoom) return;
    const rows = zoom.rows
      .map((row) => `- ${row.label}: ${row.value}${row.detail ? ` — ${row.detail}` : ''}`)
      .join('\n');
    await navigator.clipboard.writeText(
      `# ${zoom.label}\n\nValue: ${zoom.value}\nEvidence quality: ${zoom.detail}\n\n${rows}`
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  }, [zoom]);

  return (
    <Dialog open={Boolean(zoom)} onOpenChange={(open) => !open && onOpenChange(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <DialogTitle>
              {zoom?.label}: <span className="font-mono text-cyan-200">{zoom?.value}</span>
            </DialogTitle>
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              <Copy size={13} className="mr-1.5" />
              {copied ? 'Copied' : 'Copy packet'}
            </Button>
          </div>
          <DialogDescription>{zoom?.detail}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-[var(--cv-line)] bg-white/[0.025] p-3 text-xs">
          <div className="font-medium text-[var(--text-primary)]">Evidence quality</div>
          <div className="mt-1 text-[var(--text-secondary)]">{zoom?.detail}</div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-[var(--cv-line)]">
          {zoom?.rows.map((row) => (
            <div
              key={`${row.label}-${row.value}`}
              className="border-b border-[var(--cv-line)] px-3 py-2.5 text-xs last:border-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium text-[var(--text-primary)]">{row.label}</div>
                <div className="font-mono text-cyan-200">{row.value}</div>
              </div>
              {row.detail ? (
                <div className="mt-1 text-[var(--text-secondary)]">{row.detail}</div>
              ) : null}
              {row.source ? (
                <div className="mt-2">
                  <SourceLink path={row.source} repoPath={repoPath} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IntelProjectPanel({
  repoPath,
  onSnapshotsChange,
  refreshToken = 0,
}: {
  repoPath: string;
  onSnapshotsChange?: () => void;
  refreshToken?: number;
}) {
  const [snapshots, setSnapshots] = useState<RepoIntelReportSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [report, setReport] = useState<RepoAttributionReport | null>(null);
  const [dora, setDora] = useState<DoraMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ActivityZoom | null>(null);
  const autoGenerateRepoRef = useRef<string | null>(null);

  const loadSnapshot = useCallback(async (id: string) => {
    if (!isTauriAvailable()) return;
    setLoading(true);
    setError(null);
    try {
      const row = await getRepoIntelReport(id);
      setActiveId(row.id);
      setReport(JSON.parse(row.report_json) as RepoAttributionReport);
      setDora(row.dora_json ? (JSON.parse(row.dora_json) as DoraMetrics) : null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshList = useCallback(async () => {
    if (!isTauriAvailable()) return [];
    try {
      const rows = await listRepoIntelReports(repoPath, 50);
      setSnapshots(rows);
      return rows;
    } catch {
      return [];
    }
  }, [repoPath]);

  const generateActivitySnapshot = useCallback(async () => {
    const result = await saveIntelSnapshot(repoPath, 90);
    setReport(result.report);
    setDora(result.dora);
    setActiveId(result.report_id);
    const rows = await refreshList();
    if (rows.length) setActiveId(rows[0].id);
    onSnapshotsChange?.();
    return rows;
  }, [onSnapshotsChange, refreshList, repoPath]);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setDora(null);
    setActiveId(null);
    setSnapshots([]);
    void (async () => {
      const rows = await refreshList();
      if (cancelled) return;
      if (rows.length) {
        await loadSnapshot(rows[0].id);
        return;
      }
      if (autoGenerateRepoRef.current === repoPath) return;
      autoGenerateRepoRef.current = repoPath;
      setRefreshing(true);
      setError(null);
      try {
        await generateActivitySnapshot();
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generateActivitySnapshot, loadSnapshot, refreshList, refreshToken, repoPath]);

  const handleRefresh = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError('Activity analysis requires the desktop app.');
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      await generateActivitySnapshot();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRefreshing(false);
    }
  }, [generateActivitySnapshot]);

  const handleDeleteSnapshot = useCallback(
    async (id: string) => {
      if (!isTauriAvailable()) return;
      const ok = window.confirm(
        'Delete this activity snapshot? This only removes the stored report.'
      );
      if (!ok) return;
      try {
        await deleteRepoIntelReport(id);
        const rows = await refreshList();
        const next = rows[0] ?? null;
        if (next) {
          await loadSnapshot(next.id);
        } else {
          setActiveId(null);
          setReport(null);
          setDora(null);
        }
        onSnapshotsChange?.();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    },
    [loadSnapshot, onSnapshotsChange, refreshList]
  );

  const activeSnapshot = snapshots.find((s) => s.id === activeId) ?? snapshots[0];
  const thirty = findWindow(report, '30d') ?? findWindow(report, 'all');
  const seven = findWindow(report, '7d') ?? thirty;
  const aiShare = thirty ? pct(thirty.ai_commits, thirty.ai_commits + thirty.human_commits) : 0;
  const correctiveRate = thirty ? pct(thirty.revert_or_fixup_commits, thirty.total_commits) : 0;
  const topDirectory = report?.top_directories[0] ?? null;
  const topAuthor = report?.by_author[0] ?? null;

  const nextActions = useMemo(() => {
    if (!report || !thirty) return [];
    const actions: Array<{ label: string; detail: string; tone: string; source?: string }> = [];
    if (topDirectory) {
      actions.push({
        label: `Inspect ${topDirectory.path}`,
        detail: `Top churn area: ${fmtNum(topDirectory.commits)} commits, +${fmtNum(
          topDirectory.additions
        )} / -${fmtNum(topDirectory.deletions)}.`,
        tone: 'text-cyan-200',
        source: topDirectory.path,
      });
    }
    if (thirty.commit_size_p95 > 1200) {
      actions.push({
        label: 'Review large change batches',
        detail: `30d p95 commit size is ${fmtNum(thirty.commit_size_p95)} lines changed.`,
        tone: 'text-amber-200',
      });
    }
    if (correctiveRate >= 8) {
      actions.push({
        label: 'Audit corrective loops',
        detail: `${thirty.revert_or_fixup_commits} recent commits look like revert/fixup work.`,
        tone: 'text-rose-200',
      });
    }
    const blindSpot = report.blind_spots?.find((spot) => spot.severity !== 'low');
    if (blindSpot) {
      actions.push({
        label: blindSpot.label,
        detail: `${blindSpot.metric_impact} ${blindSpot.detail}`,
        tone: blindSpot.severity === 'high' ? 'text-rose-200' : 'text-amber-200',
        source: blindSpot.sample_files[0],
      });
    }
    if (actions.length === 0) {
      actions.push({
        label: 'Stable activity pattern',
        detail: 'No large corrective loop, churn spike, or attribution blind spot stands out.',
        tone: 'text-emerald-200',
      });
    }
    return actions.slice(0, 4);
  }, [correctiveRate, report, thirty, topDirectory]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-surface)]/70 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Activity size={16} className="text-cyan-200" />
              <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                Repo activity
              </h2>
              <Badge
                variant="outline"
                className="border-cyan-300/18 bg-cyan-300/[0.06] text-[10px] uppercase tracking-wider text-cyan-100"
              >
                local git
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              Git attribution, churn, authors, and release-health signals for the selected repo. Use
              this to decide where review depth should increase.
            </p>
            {activeSnapshot ? (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Last activity snapshot {formatSnapshotTime(activeSnapshot.created_at)} · commit{' '}
                <span className="font-mono">{shortSha(activeSnapshot.commit_sha)}</span>
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {activeSnapshot ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleDeleteSnapshot(activeSnapshot.id)}
                disabled={refreshing}
                aria-label="Delete activity snapshot"
              >
                <Trash2 size={14} className="mr-1.5" />
                Delete
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100 hover:border-cyan-200/35 hover:bg-cyan-300/[0.1] hover:text-white"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <RefreshCw size={14} className="mr-1.5" />
              )}
              Refresh activity
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--cv-line)] bg-white/[0.025] px-4 py-4 text-sm text-[var(--text-secondary)]">
          <Loader2 size={16} className="animate-spin text-cyan-200" />
          Loading activity snapshot...
        </div>
      ) : null}

      {!loading && !report ? (
        <div className="rounded-xl border border-dashed border-[var(--cv-line)] bg-white/[0.018] p-5">
          <div className="text-sm font-medium text-[var(--text-primary)]">
            No activity snapshot yet
          </div>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
            Generate one to see recent commit mix, churn hotspots, authors, and local release
            health.
          </p>
        </div>
      ) : null}

      {report && thirty ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SignalCard
              label="AI share"
              value={`${aiShare.toFixed(1)}%`}
              detail={`${fmtNum(thirty.ai_commits)} AI-shaped / ${fmtNum(
                thirty.human_commits
              )} human-shaped commits in 30d`}
              tone={aiShare > 70 ? 'text-amber-200' : 'text-cyan-100'}
              onClick={() =>
                setZoom({
                  label: 'AI share',
                  value: `${aiShare.toFixed(1)}%`,
                  detail:
                    'Evidence quality is git-derived and attribution is heuristic; inspect source rows before treating authorship as causal.',
                  rows: [
                    {
                      label: '30-day attribution',
                      value: `${fmtNum(thirty.ai_commits)} AI / ${fmtNum(thirty.human_commits)} human`,
                    },
                    ...report.top_files.slice(0, 8).map((file) => ({
                      label: file.path,
                      value: `${fmtNum(file.commits)} commits`,
                      detail: `+${fmtNum(file.additions)} / -${fmtNum(file.deletions)}`,
                      source: file.path,
                    })),
                  ],
                })
              }
            />
            <SignalCard
              label="Recent commits"
              value={fmtNum(thirty.total_commits)}
              detail={`${fmtNum(seven?.total_commits ?? 0)} in the last 7d · ${fmtNum(
                thirty.active_days
              )} active days`}
            />
            <SignalCard
              label="Correction rate"
              value={`${correctiveRate.toFixed(1)}%`}
              detail={`${fmtNum(thirty.revert_or_fixup_commits)} revert/fixup-shaped commits`}
              tone={correctiveRate >= 8 ? 'text-rose-200' : 'text-emerald-200'}
            />
            <SignalCard
              label="Deploy frequency"
              value={dora ? `${dora.deploys_per_week.toFixed(2)}/wk` : 'unknown'}
              detail={
                dora
                  ? `${fmtNum(dora.release_count)} releases · lead ${formatHours(
                      dora.median_lead_time_hours
                    )} · failure ${dora.change_failure_rate_pct.toFixed(1)}%`
                  : 'No semver release signal found'
              }
              onClick={() =>
                setZoom({
                  label: 'Deploy frequency',
                  value: dora ? `${dora.deploys_per_week.toFixed(2)}/wk` : 'unknown',
                  detail:
                    'Local DORA is git-derived from semver tags and corrective commits; it does not prove a production deployment.',
                  rows:
                    dora?.recent_releases.map((release) => ({
                      label: release.tag,
                      value: formatSnapshotTime(release.created_at),
                      detail: `${release.commits_since_previous} commits · ${shortSha(release.commit_sha)}`,
                    })) ?? [],
                })
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
            <div className="rounded-xl border border-[var(--cv-line)] bg-white/[0.025] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <GitCommit size={15} className="text-cyan-200" />
                What changed most
              </div>
              <div className="mt-4 space-y-2">
                {(() => {
                  const rows = report.top_directories.slice(0, 5);
                  const maxChurn = Math.max(1, ...rows.map((dir) => dir.additions + dir.deletions));
                  return rows.map((dir) => {
                    const churn = dir.additions + dir.deletions;
                    const width = Math.max(6, (churn / maxChurn) * 100);
                    return (
                      <div
                        key={dir.path}
                        className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-main)]/28 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-sm text-[var(--text-primary)]">
                              {shortPath(dir.path)}
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                              {fmtNum(dir.commits)} commits
                            </div>
                          </div>
                          <div className="shrink-0 text-right font-mono text-xs tabular-nums">
                            <span className="text-emerald-300">+{fmtCompact(dir.additions)}</span>
                            <span className="px-1 text-[var(--text-muted)]">/</span>
                            <span className="text-rose-300">-{fmtCompact(dir.deletions)}</span>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-cyan-300/70"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--cv-line)] bg-white/[0.025] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Users size={15} className="text-cyan-200" />
                Authors and next checks
              </div>
              <div className="mt-4 space-y-3">
                {topAuthor ? (
                  <div className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-main)]/35 p-3">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {topAuthor.name || topAuthor.email}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                      {fmtNum(topAuthor.commits)} commits · {fmtNum(topAuthor.active_days)} active
                      days · last {topAuthor.last_commit}
                    </div>
                  </div>
                ) : null}
                {nextActions.map((action) => (
                  <div
                    key={`${action.label}-${action.detail}`}
                    className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-main)]/35 p-3"
                  >
                    <div className={cn('text-sm font-medium', action.tone)}>{action.label}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                      {action.detail}
                    </div>
                    {action.source ? (
                      <div className="mt-2">
                        <SourceLink path={action.source} repoPath={repoPath} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {snapshots.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cv-line)] bg-white/[0.012] px-3 py-2">
              <span className="text-[11px] font-medium text-[var(--text-muted)]">
                Activity history
              </span>
              {snapshots.map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors',
                    snapshot.id === activeId
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                      : 'border-[var(--cv-line)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  )}
                  onClick={() => void loadSnapshot(snapshot.id)}
                >
                  {formatSnapshotTime(snapshot.created_at)}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      <ActivityMetricDialog zoom={zoom} repoPath={repoPath} onOpenChange={setZoom} />
    </div>
  );
}
