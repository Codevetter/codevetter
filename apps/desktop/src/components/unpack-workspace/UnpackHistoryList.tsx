import { memo, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  History,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UnpackReportSummary } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

type StatusKind = 'ok' | 'failed' | 'pending';

function formatRuntime(ms?: number | null): string {
  if (!ms || ms < 0) return '-';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSnapshotDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function timelineStatusKind(status: string | null | undefined): StatusKind {
  const s = (status ?? '').toLowerCase();
  if (s === 'failed' || s === 'error' || s === 'errored') return 'failed';
  if (s === 'running' || s === 'in_progress' || s === 'pending' || s === 'queued') return 'pending';
  return 'ok';
}

function timelineDateLabel(d: Date, now: Date): string {
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
}

function groupTimelineByDate(
  rows: UnpackReportSummary[]
): Array<{ label: string; rows: UnpackReportSummary[] }> {
  const now = new Date();
  const groups: Array<{ label: string; rows: UnpackReportSummary[] }> = [];
  for (const row of rows) {
    const label = timelineDateLabel(new Date(row.created_at), now);
    const last = groups[groups.length - 1];
    if (last?.label === label) {
      last.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }
  return groups;
}

function analysisBadge(row: UnpackReportSummary): { label: string; tone: string } {
  if (row.status === 'failed') {
    return { label: 'Failed', tone: 'border-red-500/30 bg-red-500/10 text-red-200' };
  }
  if (timelineStatusKind(row.status) === 'pending') {
    return { label: 'Running', tone: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200' };
  }
  if (row.analysis_ready) {
    return {
      label: 'Analysis ready',
      tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    };
  }
  return { label: 'Local only', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-200' };
}

export const UnpackHistoryList = memo(function UnpackHistoryList({
  history,
  activeId,
  onLoad,
  onDelete,
  onRefresh,
  refreshing,
  mode,
  timelineRepoName,
  onOpenTimeline,
  onBack,
  onGenerate,
  onAnalyze,
}: {
  history: UnpackReportSummary[];
  activeId?: string;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  mode: 'all' | 'timeline';
  timelineRepoName?: string;
  onOpenTimeline?: (repoPath: string, repoName: string) => void;
  onBack?: () => void;
  onGenerate?: () => void;
  onAnalyze?: (id: string) => void;
}) {
  const isTimeline = mode === 'timeline';
  const Icon = isTimeline ? History : Layers;
  const title = isTimeline ? 'Past snapshots' : 'All snapshots';
  const subtitle = isTimeline
    ? timelineRepoName
      ? `${timelineRepoName} snapshots`
      : 'Stored local snapshots'
    : 'Saved local snapshots across projects';

  return (
    <Card className="overflow-hidden rounded-xl border border-[var(--cv-line)] bg-white/[0.018] shadow-none">
      <CardHeader className="border-b border-[var(--cv-line)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon size={16} className="text-[var(--cv-accent)]" />
              {title}
            </CardTitle>
            <CardDescription className="mt-0.5 text-[11px]">{subtitle}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {isTimeline && onBack ? (
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                <ChevronLeft size={14} className="mr-1" />
                All
              </Button>
            ) : null}
            {onGenerate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100 hover:border-cyan-200/35 hover:bg-cyan-300/[0.1] hover:text-white"
                onClick={onGenerate}
              >
                <Plus size={14} className="mr-1.5" />
                Generate snapshot
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh snapshots"
            >
              <RefreshCw size={14} className={cn('mr-1.5', refreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {history.length === 0 ? (
          <div className="cv-metric-tile flex flex-col items-center justify-center rounded-md border-dashed px-4 py-8 text-center">
            <div className="text-sm font-medium text-[var(--text-primary)]">No snapshots yet</div>
            <div className="mt-1 max-w-md text-xs leading-relaxed text-[var(--text-secondary)]">
              Generate a local snapshot first. AI analysis can be added to that snapshot later.
            </div>
            {onGenerate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100 hover:border-cyan-200/35 hover:bg-cyan-300/[0.1] hover:text-white"
                onClick={onGenerate}
              >
                <Plus size={14} className="mr-1.5" />
                Generate snapshot
              </Button>
            ) : null}
          </div>
        ) : isTimeline ? (
          <SnapshotRows
            rows={history}
            activeId={activeId}
            onLoad={onLoad}
            onDelete={onDelete}
            onAnalyze={onAnalyze}
          />
        ) : (
          <ul className="space-y-2">
            {history.map((row) => (
              <GlobalSnapshotRow
                key={row.id}
                row={row}
                active={row.id === activeId}
                onLoad={onLoad}
                onDelete={onDelete}
                onOpenTimeline={onOpenTimeline}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
});

function GlobalSnapshotRow({
  row,
  active,
  onLoad,
  onDelete,
  onOpenTimeline,
}: {
  row: UnpackReportSummary;
  active: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenTimeline?: (repoPath: string, repoName: string) => void;
}) {
  const analysis = analysisBadge(row);
  return (
    <li
      className={cn(
        'cv-metric-tile flex flex-col gap-2 rounded-md px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between',
        active && 'border-cyan-400/40 bg-cyan-500/5'
      )}
    >
      <button type="button" className="min-w-0 text-left" onClick={() => onLoad(row.id)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {row.repo_name}
          </span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {row.commit_sha?.slice(0, 10) ?? 'no commit'}
          </span>
          <Badge
            variant="outline"
            className={cn('border text-[10px] uppercase tracking-wider', analysis.tone)}
          >
            {analysis.label}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span>{formatSnapshotDate(row.created_at)}</span>
          <span>{formatRuntime(row.runtime_ms)}</span>
          <span>{row.files_scanned.toLocaleString()} files</span>
        </div>
      </button>
      <div className="flex items-center gap-1">
        {onOpenTimeline ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onOpenTimeline(row.repo_path, row.repo_name)}
          >
            <History size={12} className="mr-1" />
            History
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => onLoad(row.id)}>
          <ExternalLink size={12} className="mr-1" />
          Open
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onDelete(row.id)}
          aria-label="Delete snapshot"
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </li>
  );
}

function SnapshotRows({
  rows,
  activeId,
  onLoad,
  onDelete,
  onAnalyze,
}: {
  rows: UnpackReportSummary[];
  activeId?: string;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onAnalyze?: (id: string) => void;
}) {
  const groups = useMemo(() => groupTimelineByDate(rows), [rows]);
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.label}>
          <header className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              {group.label}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              · {group.rows.length}
            </span>
          </header>
          <div className="overflow-hidden rounded-lg border border-[var(--cv-line)]">
            {group.rows.map((row) => (
              <SnapshotRow
                key={row.id}
                row={row}
                active={row.id === activeId}
                onLoad={onLoad}
                onDelete={onDelete}
                onAnalyze={onAnalyze}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SnapshotRow({
  row,
  active,
  onLoad,
  onDelete,
  onAnalyze,
}: {
  row: UnpackReportSummary;
  active: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onAnalyze?: (id: string) => void;
}) {
  const kind = timelineStatusKind(row.status);
  const StatusIcon =
    kind === 'failed' ? AlertTriangle : kind === 'pending' ? Loader2 : CheckCircle2;
  const statusColor =
    kind === 'failed' ? 'text-red-300' : kind === 'pending' ? 'text-cyan-300' : 'text-emerald-400';
  const analysis = analysisBadge(row);
  const canAnalyze = !row.analysis_ready && kind !== 'failed' && onAnalyze;

  return (
    <article
      className={cn(
        'border-b border-[var(--cv-line)] bg-white/[0.012] px-3 py-2 transition-colors last:border-b-0 hover:bg-white/[0.028]',
        active && 'border-cyan-500/40 bg-cyan-500/5'
      )}
    >
      <button
        type="button"
        className="grid w-full gap-2 text-left md:grid-cols-[minmax(0,1fr),auto]"
        onClick={() => onLoad(row.id)}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusIcon
              size={13}
              className={cn(statusColor, kind === 'pending' && 'animate-spin')}
            />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {formatSnapshotDate(row.created_at)}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {row.commit_sha?.slice(0, 10) ?? 'no commit'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span>{row.files_scanned.toLocaleString()} files</span>
            <span>{formatRuntime(row.runtime_ms)}</span>
            <span>{row.agent_used ?? 'no AI agent'}</span>
          </div>
          {kind === 'failed' && row.error_message ? (
            <div className="mt-1 flex items-start gap-1 text-[11px] text-red-300">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="truncate">{row.error_message}</span>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:justify-end">
          <Badge
            variant="outline"
            className={cn('border text-[10px] uppercase tracking-wider', analysis.tone)}
          >
            {analysis.label}
          </Badge>
          {active ? (
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200">
              Open
            </span>
          ) : null}
        </div>
      </button>

      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1">
        {canAnalyze ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onAnalyze(row.id)}
          >
            <Sparkles size={12} className="mr-1" />
            Analyze
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => onLoad(row.id)}
        >
          <ExternalLink size={12} className="mr-1" />
          Open
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => onDelete(row.id)}
          aria-label="Delete snapshot"
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </article>
  );
}
