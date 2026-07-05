import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ProjectWorkspaceEmpty } from '@/components/project-workspace/ProjectWorkspaceEmpty';
import { ProjectWorkspaceHeader } from '@/components/project-workspace/ProjectWorkspaceHeader';
import { ProjectWorkspaceShell } from '@/components/project-workspace/ProjectWorkspaceShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useProjectWorkspace } from '@/lib/project-workspace';
import {
  forcePollTrexWatcher,
  isTauriAvailable,
  listTrexPrRuns,
  listTrexWatchers,
  startTrexWatcher,
  stopTrexWatcher,
  type TrexPrRun,
  type TrexWatcher,
} from '@/lib/tauri-ipc';

function verdictBadge(v: string) {
  const cls =
    v === 'APPROVE'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
      : v === 'NEEDS_REVIEW'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
        : 'border-red-500/40 bg-red-500/10 text-red-400';
  return (
    <Badge variant="outline" className={`text-[10px] uppercase ${cls}`}>
      {v}
    </Badge>
  );
}

function statusIcon(s: string | null) {
  if (s === 'success') return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (s === 'failure') return <XCircle size={14} className="text-red-400" />;
  if (s === 'pending') return <CircleDashed size={14} className="text-amber-400" />;
  return <ShieldAlert size={14} className="text-zinc-500" />;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function TRex() {
  const { selectedRepoPath } = useProjectWorkspace();
  const [watchers, setWatchers] = useState<TrexWatcher[]>([]);
  const [runs, setRuns] = useState<TrexPrRun[]>([]);
  const [intervalSecs, setIntervalSecs] = useState(300);
  const [baseBranch, setBaseBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const projectWatcher = useMemo(
    () => watchers.find((w) => w.repo_path === selectedRepoPath) ?? null,
    [watchers, selectedRepoPath]
  );

  const refresh = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const [w, r] = await Promise.all([
        listTrexWatchers(),
        listTrexPrRuns(selectedRepoPath ?? undefined, 50),
      ]);
      setWatchers(w);
      setRuns(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedRepoPath]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, 15_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const handleStart = async () => {
    if (!isTauriAvailable()) {
      setError('Desktop app required.');
      return;
    }
    if (!selectedRepoPath) {
      setError('Select a project from the sidebar first.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await startTrexWatcher({
        repo_path: selectedRepoPath,
        interval_secs: intervalSecs,
        base_branch: baseBranch.trim() || undefined,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (path: string) => {
    setBusy(path);
    try {
      await stopTrexWatcher(path);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleForcePoll = async (path: string) => {
    setBusy(path);
    try {
      await forcePollTrexWatcher(path);
      setTimeout(refresh, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ProjectWorkspaceShell mainClassName="px-6 pb-24 pt-6">
      {!selectedRepoPath ? (
        <ProjectWorkspaceEmpty
          title="T-Rex watcher"
          description="Select a project from the sidebar, then register a PR watcher for that repo. T-Rex polls open PRs and posts sandbox verdicts back to GitHub."
        />
      ) : (
        <div className="mx-auto max-w-6xl">
          <ProjectWorkspaceHeader
            actions={
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>
                <RefreshCw size={12} className="mr-1" />
                Refresh
              </Button>
            }
          >
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                T-Rex watcher
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
                Polls open PRs on the active project, runs the sandbox when a head SHA changes, and
                posts a <span className="font-mono">codevetter/t-rex</span> commit status to GitHub.
              </p>
            </div>
          </ProjectWorkspaceHeader>

          <Card className="mb-6 border-[var(--cv-line)] bg-[var(--bg-surface)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {projectWatcher?.enabled ? 'Watcher active' : 'Start watcher'}
              </CardTitle>
              <CardDescription className="text-xs">
                Interval between polls (minimum 60 s). Optional base branch overrides the default PR
                base detection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectWatcher ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--cv-line)] bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          projectWatcher.enabled
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400'
                            : 'border-zinc-700 bg-zinc-900 text-[10px] text-zinc-400'
                        }
                      >
                        {projectWatcher.enabled ? 'Active' : 'Paused'}
                      </Badge>
                      <span className="truncate font-mono text-xs">{projectWatcher.repo_path}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-secondary)]">
                      <span>Every {projectWatcher.interval_secs}s</span>
                      <span>Last polled {fmtAgo(projectWatcher.last_polled_at)}</span>
                      {projectWatcher.base_branch && (
                        <span className="font-mono">base={projectWatcher.base_branch}</span>
                      )}
                      {projectWatcher.last_error && (
                        <span className="text-red-400">
                          last error: {projectWatcher.last_error}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === projectWatcher.repo_path}
                      onClick={() => void handleForcePoll(projectWatcher.repo_path)}
                    >
                      <Play size={12} className="mr-1" />
                      Poll now
                    </Button>
                    {projectWatcher.enabled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === projectWatcher.repo_path}
                        onClick={() => void handleStop(projectWatcher.repo_path)}
                      >
                        <Square size={12} className="mr-1" />
                        Stop
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-[140px,180px,auto]">
                  <Input
                    type="number"
                    min={60}
                    value={intervalSecs}
                    onChange={(e) => setIntervalSecs(Math.max(60, Number(e.target.value) || 300))}
                    aria-label="Poll interval seconds"
                  />
                  <Input
                    placeholder="Base branch (optional)"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                  />
                  <Button onClick={() => void handleStart()} disabled={loading}>
                    {loading ? (
                      <Loader2 size={14} className="mr-2 animate-spin" />
                    ) : (
                      <Plus size={14} className="mr-2" />
                    )}
                    Start watcher
                  </Button>
                </div>
              )}
              {error && (
                <p className="flex items-center gap-2 text-xs text-red-400">
                  <AlertTriangle size={12} />
                  {error}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-[var(--cv-line)] bg-[var(--bg-surface)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent runs</CardTitle>
              <CardDescription className="text-xs">
                Sandbox runs for this project (up to 50 most recent).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--text-secondary)]">
                  No runs yet — the watcher fires when a PR&apos;s head SHA changes.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {runs.map((r) => (
                    <div
                      key={r.id}
                      className="grid grid-cols-[auto,auto,1fr,auto,auto] items-center gap-3 rounded border border-[var(--cv-line)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
                    >
                      <span title={r.status_state ?? 'no status posted'}>
                        {statusIcon(r.status_state)}
                      </span>
                      <span className="font-mono text-[var(--text-secondary)]">
                        PR #{r.pr_number}
                      </span>
                      <span className="truncate">{r.summary}</span>
                      <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                        {r.head_sha.slice(0, 7)}
                      </span>
                      <div className="flex items-center gap-2">
                        {verdictBadge(r.verdict)}
                        <span className="text-[10px] text-[var(--text-secondary)]">
                          {fmtAgo(r.ran_at)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ProjectWorkspaceShell>
  );
}
