import { AlertTriangle, ExternalLink, ListTodo, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getSaasMakerStatus,
  isTauriAvailable,
  listSaasMakerTasks,
  type SaasMakerStatus,
  type SaasMakerTask,
} from '@/lib/tauri-ipc';

function statusColor(status?: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'done':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    case 'in_progress':
      return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200';
    default:
      return 'border-slate-500/40 bg-slate-500/10 text-slate-200';
  }
}

function priorityColor(priority?: string | null): string {
  switch ((priority ?? '').toLowerCase()) {
    case 'high':
      return 'border-red-500/40 bg-red-500/10 text-red-200';
    case 'low':
      return 'border-slate-500/40 bg-slate-500/10 text-slate-300';
    default:
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
}

export default function SaasMakerTasksPanel() {
  const [tasks, setTasks] = useState<SaasMakerTask[]>([]);
  const [status, setStatus] = useState<SaasMakerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');

  const refresh = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setLoading(true);
    setError(null);
    try {
      const s = await getSaasMakerStatus();
      setStatus(s);
      if (!s.configured) {
        setTasks([]);
        return;
      }
      const projectSlug = slug || s.project_slug || undefined;
      const rows = await listSaasMakerTasks(projectSlug ?? null);
      setTasks(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="rounded-xl border border-[var(--cv-line)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListTodo size={14} className="text-[var(--cv-accent)]" />
          <h3 className="cv-label text-slate-300">From SaaS Maker</h3>
          {status?.configured && (
            <Badge
              variant="outline"
              className="border-cyan-500/40 bg-cyan-500/10 text-[9px] text-[var(--cv-accent)]"
            >
              {status.token_source}
            </Badge>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="h-7"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Input
          value={slug}
          placeholder={status?.project_slug ?? 'project-slug'}
          onChange={(e) => setSlug(e.target.value)}
          className="h-7 max-w-xs font-mono text-[10px]"
        />
        <span className="text-[10px] text-slate-500">override project slug, then refresh</span>
      </div>

      {!status?.configured && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          SaaS Maker not configured. Set <span className="font-mono">SAASMAKER_SESSION_TOKEN</span>{' '}
          or open Settings → Integrations.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          <AlertTriangle size={12} className="mr-1 inline" />
          <span className="font-mono">{error}</span>
        </div>
      )}

      {status?.configured && !error && tasks.length === 0 && !loading && (
        <p className="text-[11px] text-slate-500">No open tasks for this project.</p>
      )}

      {tasks.length > 0 && (
        <div className="overflow-hidden rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-[var(--cv-line)] text-slate-500">
                <th className="px-2 py-1.5 text-left font-normal">title</th>
                <th className="px-2 py-1.5 text-left font-normal">status</th>
                <th className="px-2 py-1.5 text-left font-normal">priority</th>
                <th className="px-2 py-1.5 text-left font-normal">slug</th>
                <th className="px-2 py-1.5 text-left font-normal">updated</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-[var(--cv-line)]/40 last:border-0">
                  <td className="px-2 py-1.5">
                    <div className="truncate font-medium text-slate-100">{t.title}</div>
                    {t.description && (
                      <div className="line-clamp-1 text-[10px] text-slate-500">{t.description}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant="outline" className={`text-[9px] ${statusColor(t.status)}`}>
                      {t.status ?? '—'}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant="outline" className={`text-[9px] ${priorityColor(t.priority)}`}>
                      {t.priority ?? '—'}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-slate-400">
                    {t.project_slug ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-slate-400">
                    {t.updated_at?.slice(0, 10) ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {t.pr_url && (
                      <a
                        href={t.pr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-[var(--cv-accent)] hover:underline"
                      >
                        <ExternalLink size={10} />
                        PR
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
