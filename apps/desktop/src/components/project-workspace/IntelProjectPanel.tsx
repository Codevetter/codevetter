import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { IntelSnapshotView } from '@/pages/Intel';
import {
  type DoraMetrics,
  deleteRepoIntelReport,
  getRepoIntelReport,
  isTauriAvailable,
  listRepoIntelReports,
  type RepoAttributionReport,
  type RepoIntelReportSummary,
  saveIntelSnapshot,
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

export function IntelProjectPanel({
  repoPath,
  onSnapshotsChange,
}: {
  repoPath: string;
  onSnapshotsChange?: () => void;
}) {
  const [snapshots, setSnapshots] = useState<RepoIntelReportSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [report, setReport] = useState<RepoAttributionReport | null>(null);
  const [dora, setDora] = useState<DoraMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!isTauriAvailable()) return;
    try {
      const rows = await listRepoIntelReports(repoPath, 50);
      setSnapshots(rows);
      return rows;
    } catch {
      return [];
    }
  }, [repoPath]);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setDora(null);
    setActiveId(null);
    setSnapshots([]);
    void (async () => {
      const rows = await refreshList();
      if (cancelled || !rows?.length) return;
      await loadSnapshot(rows[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath, refreshList, loadSnapshot]);

  const handleRefresh = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError('Intel requires the desktop app.');
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const result = await saveIntelSnapshot(repoPath, 90);
      setReport(result.report);
      setDora(result.dora);
      setActiveId(result.report_id);
      const rows = await refreshList();
      if (rows?.length) setActiveId(rows[0].id);
      onSnapshotsChange?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRefreshing(false);
    }
  }, [onSnapshotsChange, refreshList, repoPath]);

  const handleDeleteSnapshot = useCallback(
    async (id: string) => {
      if (!isTauriAvailable()) return;
      const ok = window.confirm('Delete this Intel snapshot? This only removes the stored report.');
      if (!ok) return;
      try {
        await deleteRepoIntelReport(id);
        const rows = await refreshList();
        const next = rows?.[0] ?? null;
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--cv-line)] bg-[var(--bg-surface)] px-4 py-3">
        <div className="text-xs text-slate-400">
          {activeSnapshot ? (
            <>
              Last updated{' '}
              <span className="tabular-nums text-slate-300">
                {formatSnapshotTime(activeSnapshot.created_at)}
              </span>
              {activeSnapshot.commit_sha ? (
                <span className="ml-2 font-mono text-slate-500">
                  · {activeSnapshot.commit_sha.slice(0, 12)}
                </span>
              ) : null}
              <span className="ml-2 text-slate-600">· {snapshots.length} snapshot(s)</span>
            </>
          ) : (
            'No snapshots stored for this project yet.'
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeSnapshot ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleDeleteSnapshot(activeSnapshot.id)}
              disabled={refreshing}
              aria-label="Delete Intel snapshot"
            >
              <Trash2 size={14} className="mr-1.5" />
              Delete
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <RefreshCw size={14} className="mr-1.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {snapshots.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">History</span>
          {snapshots.map((s) => (
            <div
              key={s.id}
              className={cn(
                'inline-flex items-center rounded-md border font-mono text-[10px] transition-colors',
                s.id === activeId
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                  : 'border-[var(--cv-line)] text-slate-500 hover:text-slate-300'
              )}
            >
              <button type="button" className="px-2 py-1" onClick={() => void loadSnapshot(s.id)}>
                {formatSnapshotTime(s.created_at)}
              </button>
              <button
                type="button"
                className="border-l border-[var(--cv-line)] px-1.5 py-1 text-slate-600 hover:bg-red-500/10 hover:text-red-300"
                title="Delete Intel snapshot"
                aria-label="Delete Intel snapshot"
                onClick={() => void handleDeleteSnapshot(s.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <IntelSnapshotView report={report} dora={dora} loading={loading && !report} />
    </div>
  );
}
