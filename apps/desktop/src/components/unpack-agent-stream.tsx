import { listen } from '@tauri-apps/api/event';
import {
  ChevronDown,
  ChevronRight,
  FileSearch,
  FolderOpen,
  Globe,
  Loader2,
  Pencil,
  Search,
  Terminal,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cancelUnpackGeneration, isTauriAvailable } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

const MAX_STREAM_CHARS = 48_000;
const MAX_ACTIVITIES = 80;

export type UnpackAgentActivity = {
  kind: string;
  label: string;
  detail?: string | null;
};

type UnpackAgentStreamProps = {
  repoPath: string;
  activeReportId: string | null;
  running: boolean;
  onCancel?: () => void;
  onLatestActivity?: (activity: UnpackAgentActivity | null) => void;
};

function activityIcon(kind: string) {
  switch (kind) {
    case 'read':
      return FolderOpen;
    case 'search':
    case 'glob':
      return Search;
    case 'run':
      return Terminal;
    case 'edit':
      return Pencil;
    case 'web':
      return Globe;
    case 'write':
      return Wand2;
    default:
      return FileSearch;
  }
}

function activityTone(kind: string): string {
  switch (kind) {
    case 'read':
      return 'text-cyan-300 border-cyan-500/25 bg-cyan-500/10';
    case 'search':
    case 'glob':
      return 'text-amber-200 border-amber-500/25 bg-amber-500/10';
    case 'run':
      return 'text-rose-200 border-rose-500/25 bg-rose-500/10';
    case 'edit':
      return 'text-violet-200 border-violet-500/25 bg-violet-500/10';
    case 'write':
      return 'text-emerald-200 border-emerald-500/25 bg-emerald-500/10';
    default:
      return 'text-slate-300 border-[var(--cv-line)] bg-[var(--bg-main)]/60';
  }
}

export function UnpackAgentStream({
  repoPath,
  activeReportId,
  running,
  onCancel,
  onLatestActivity,
}: UnpackAgentStreamProps) {
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [activities, setActivities] = useState<UnpackAgentActivity[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const tailRef = useRef<HTMLPreElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!running) {
      setStdout('');
      setStderr('');
      setActivities([]);
      onLatestActivity?.(null);
    }
  }, [onLatestActivity, running]);

  useEffect(() => {
    if (!isTauriAvailable() || !repoPath || !running) return;
    let unlistenStream: (() => void) | undefined;
    let unlistenActivity: (() => void) | undefined;

    void listen<{
      stream_id: string;
      repo_path: string;
      stream: string;
      chunk: string;
      done: boolean;
    }>('unpack-agent-stream', (event) => {
      if (event.payload.repo_path !== repoPath) return;
      if (activeReportId && event.payload.stream_id !== activeReportId) return;
      const append = (prev: string, chunk: string) => {
        const next = prev + chunk;
        return next.length > MAX_STREAM_CHARS ? next.slice(-MAX_STREAM_CHARS) : next;
      };
      if (event.payload.stream === 'stderr') {
        setStderr((prev) => append(prev, event.payload.chunk));
      } else {
        setStdout((prev) => append(prev, event.payload.chunk));
      }
    }).then((fn) => {
      unlistenStream = fn;
    });

    void listen<{
      stream_id: string;
      repo_path: string;
      kind: string;
      label: string;
      detail?: string | null;
    }>('unpack-agent-activity', (event) => {
      if (event.payload.repo_path !== repoPath) return;
      if (activeReportId && event.payload.stream_id !== activeReportId) return;
      const activity: UnpackAgentActivity = {
        kind: event.payload.kind,
        label: event.payload.label,
        detail: event.payload.detail,
      };
      setActivities((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.label === activity.label && last.kind === activity.kind) return prev;
        const next = [...prev, activity];
        return next.length > MAX_ACTIVITIES ? next.slice(-MAX_ACTIVITIES) : next;
      });
      onLatestActivity?.(activity);
    }).then((fn) => {
      unlistenActivity = fn;
    });

    return () => {
      unlistenStream?.();
      unlistenActivity?.();
    };
  }, [activeReportId, onLatestActivity, repoPath, running]);

  useEffect(() => {
    const el = tailRef.current;
    if (el && showRaw) el.scrollTop = el.scrollHeight;
  }, [showRaw, stdout, stderr]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activities]);

  if (!running) return null;

  const combined = [stdout, stderr ? `\n[stderr]\n${stderr}` : ''].filter(Boolean).join('');
  const latest = activities[activities.length - 1] ?? null;

  return (
    <div className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-main)]/80">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--cv-line)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 size={12} className="shrink-0 animate-spin text-violet-300" />
          <span className="text-[11px] font-medium text-slate-300">Agent progress</span>
          {latest && (
            <span className="truncate text-[10px] text-slate-500">
              {latest.label}
              {latest.detail ? ` · ${latest.detail}` : ''}
            </span>
          )}
        </div>
        {activeReportId ? (
          <button
            type="button"
            className="text-[10px] text-red-300 hover:text-red-200"
            onClick={() => {
              void cancelUnpackGeneration(activeReportId).then(() => onCancel?.());
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>

      <div ref={listRef} className="max-h-40 space-y-1 overflow-auto px-3 py-2">
        {activities.length === 0 ? (
          <p className="text-[10px] text-slate-500">Waiting for agent activity…</p>
        ) : (
          activities.map((activity, index) => {
            const Icon = activityIcon(activity.kind);
            const isLatest = index === activities.length - 1;
            return (
              <div
                key={`${activity.kind}-${activity.label}-${index}`}
                className={cn(
                  'flex items-start gap-2 rounded border px-2 py-1.5 text-[10px]',
                  activityTone(activity.kind),
                  isLatest && 'ring-1 ring-violet-500/30'
                )}
              >
                <Icon size={11} className="mt-0.5 shrink-0 opacity-80" />
                <div className="min-w-0">
                  <div className="font-medium">{activity.label}</div>
                  {activity.detail && (
                    <div className="mt-0.5 truncate font-mono text-[9px] opacity-80">
                      {activity.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        className="flex w-full items-center gap-1 border-t border-[var(--cv-line)] px-3 py-1.5 text-left text-[10px] text-slate-500 hover:text-slate-300"
        onClick={() => setShowRaw((v) => !v)}
      >
        {showRaw ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Raw output
        {combined.trim() ? ` (${combined.length.toLocaleString()} chars)` : ''}
      </button>

      {showRaw && (
        <pre
          ref={tailRef}
          className="max-h-36 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--cv-line)] p-3 font-mono text-[10px] leading-relaxed text-slate-500"
        >
          {combined.trim() ? combined : 'No raw output yet…'}
        </pre>
      )}
    </div>
  );
}
