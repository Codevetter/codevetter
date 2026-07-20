import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectWorkspace } from '@/lib/project-workspace';
import {
  getRepoProjectGitStatus,
  isTauriAvailable,
  type RepoProject,
  type RepoProjectGitStatus,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

function formatUpdated(value: string | null | undefined): string {
  if (!value) return 'no commits';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'updated recently';
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'updated now';
  if (diffMs < hour) return `updated ${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `updated ${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 14 * day) return `updated ${Math.floor(diffMs / day)}d ago`;
  return `updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function ProjectGitMeta({ repoPath }: { repoPath: string }) {
  const [status, setStatus] = useState<RepoProjectGitStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    setStatus(null);
    setFailed(false);
    void getRepoProjectGitStatus(repoPath)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  if (failed) {
    return <span className="text-[10px] text-slate-600">git unavailable</span>;
  }

  if (!status) {
    return <span className="text-[10px] text-slate-600">checking git</span>;
  }

  return (
    <span
      className={cn('truncate text-[11px]', status.clean ? 'text-slate-500' : 'text-amber-200/75')}
    >
      <span className="font-mono">{status.branch ?? 'detached'}</span>
      <span className="px-1.5 text-slate-700">·</span>
      {status.clean ? 'clean' : `${status.changed_files} changed`}
      <span className="px-1.5 text-slate-700">·</span>
      {formatUpdated(status.last_commit_at).replace('updated ', '')}
    </span>
  );
}

function ProjectRow({
  project,
  active,
  onSelect,
  onRemove,
}: {
  project: RepoProject;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        'group relative mb-1.5 overflow-hidden rounded-xl border transition duration-150',
        active
          ? 'border-white/[0.11] bg-white/[0.045]'
          : 'border-transparent bg-white/[0.018] hover:border-white/[0.08] hover:bg-white/[0.04]'
      )}
    >
      <div
        className={cn(
          'absolute inset-y-2 left-0 w-0.5 rounded-r-full',
          active ? 'bg-amber-300/70 shadow-[0_0_14px_rgba(243,173,61,0.45)]' : 'bg-transparent'
        )}
      />
      <button
        type="button"
        onClick={onSelect}
        title={project.repo_path}
        className="w-full px-3 py-2.5 pr-9 text-left"
      >
        <div className="min-w-0 truncate text-sm font-medium leading-5 text-slate-100">
          {project.display_name}
        </div>
        <div className="mt-1 min-w-0 truncate">
          <ProjectGitMeta repoPath={project.repo_path} />
        </div>
      </button>
      <button
        type="button"
        className="absolute right-2 top-2.5 rounded-md border border-transparent p-1 text-slate-600 opacity-0 transition hover:border-red-300/15 hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
        title="Remove project from CodeVetter"
        aria-label={`Remove ${project.display_name} from CodeVetter`}
        onClick={onRemove}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

export function ProjectSidebar({ className }: { className?: string }) {
  const {
    projects,
    loading,
    addingProject,
    selectedRepoPath,
    selectProject,
    removeProject,
    addProject,
  } = useProjectWorkspace();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.display_name.toLowerCase().includes(q) || p.repo_path.toLowerCase().includes(q)
    );
  }, [filter, projects]);

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden border-r border-white/[0.07] bg-[var(--cv-surface-translucent)] backdrop-blur-xl',
        className
      )}
    >
      <div className="relative overflow-hidden border-b border-white/[0.07] px-4 py-3.5">
        <div className="relative flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-normal text-slate-50">Projects</div>
          </div>
        </div>
      </div>

      <div className="border-b border-white/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <Input
              name="project-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter projects"
              className="h-9 rounded-lg !border-white/[0.09] !bg-black/25 pl-9 pr-3 text-sm !text-slate-200 placeholder:!text-slate-600 focus-visible:!border-amber-300/30 focus-visible:!ring-amber-300/15"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-8 shrink-0 rounded-lg border-amber-300/20 bg-amber-300/[0.08] p-0 text-amber-100 transition hover:border-amber-200/40 hover:bg-amber-300/15 hover:text-white"
            onClick={() => void addProject()}
            disabled={addingProject}
            aria-label="Add project"
          >
            {addingProject ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2.5">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-3 text-xs text-slate-500">
            <Loader2 size={15} className="animate-spin text-amber-200" />
            Loading projects...
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] px-3 py-4 text-xs leading-5 text-slate-500">
            {projects.length === 0
              ? 'Add a repo to get started.'
              : 'No projects match your filter.'}
          </p>
        ) : (
          filtered.map((p) => {
            const active = p.repo_path === selectedRepoPath;
            return (
              <ProjectRow
                key={p.id}
                project={p}
                active={active}
                onSelect={() => selectProject(p.repo_path)}
                onRemove={() => {
                  const ok = window.confirm(
                    `Remove ${p.display_name} from CodeVetter? This only removes the project from the sidebar; it does not delete files.`
                  );
                  if (ok) void removeProject(p.repo_path);
                }}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}
