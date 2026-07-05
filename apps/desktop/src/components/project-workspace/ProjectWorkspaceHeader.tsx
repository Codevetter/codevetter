import type { ReactNode } from 'react';
import { GitBranch } from 'lucide-react';

import { useProjectWorkspace } from '@/lib/project-workspace';

export function ProjectWorkspaceHeader({
  actions,
  children,
}: {
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const { selectedRepoPath, selectedProject } = useProjectWorkspace();
  if (!selectedRepoPath) return null;

  return (
    <header className="cv-frame cv-glow-edge mb-6 overflow-hidden rounded-lg">
      <div className="cv-terminal-bar px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          project
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {children ?? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <GitBranch size={15} className="text-cyan-300" />
                <span className="cv-label">Active repository</span>
              </div>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-100">
                {selectedProject?.display_name ?? selectedRepoPath.split('/').pop()}
              </h1>
              <p className="mt-1 max-w-2xl font-mono text-xs text-slate-500">{selectedRepoPath}</p>
            </>
          )}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
