import { FolderGit2, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectWorkspace } from '@/lib/project-workspace';
import { cn } from '@/lib/utils';

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
        'cv-glass cv-glow-edge flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden border-r border-[var(--cv-line)] bg-[#08090a]',
        className
      )}
    >
      <div className="cv-terminal-bar px-3 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          workspace
        </span>
      </div>

      <div className="border-b border-[var(--cv-line)] px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="cv-label">Projects</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cv-action-primary h-7 px-2"
            onClick={() => void addProject()}
            disabled={addingProject}
            aria-label="Add project"
          >
            {addingProject ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          </Button>
        </div>
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter projects"
            className="cv-input h-8 pl-8 font-mono text-[11px]"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-600">
            {projects.length === 0
              ? 'Add a repo to get started.'
              : 'No projects match your filter.'}
          </p>
        ) : (
          filtered.map((p) => {
            const active = p.repo_path === selectedRepoPath;
            return (
              <div
                key={p.id}
                className={cn(
                  'group relative mb-1 rounded-lg border transition-colors',
                  active
                    ? 'border-cyan-400/45 bg-cyan-400/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'border-transparent bg-white/[0.015] hover:border-[var(--cv-line)] hover:bg-white/[0.035]'
                )}
              >
                <button
                  type="button"
                  onClick={() => selectProject(p.repo_path)}
                  className="w-full px-3 py-2.5 pr-9 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderGit2
                      size={14}
                      className={cn(
                        'shrink-0',
                        active
                          ? 'text-cyan-300'
                          : 'text-[var(--text-muted)] group-hover:text-slate-300'
                      )}
                    />
                    <div className="truncate text-sm font-medium text-slate-200">
                      {p.display_name}
                    </div>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-slate-600">
                    {p.repo_path}
                  </div>
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-2 rounded p-1 text-[var(--text-muted)] opacity-0 transition hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                  title="Remove project from CodeVetter"
                  aria-label={`Remove ${p.display_name} from CodeVetter`}
                  onClick={() => {
                    const ok = window.confirm(
                      `Remove ${p.display_name} from CodeVetter? This only removes the project from the sidebar; it does not delete files.`
                    );
                    if (ok) void removeProject(p.repo_path);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
