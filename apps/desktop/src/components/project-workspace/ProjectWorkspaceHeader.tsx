import type { ReactNode } from 'react';

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
    <header className="cv-spotlight-surface mb-5 rounded-2xl px-5 py-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          {children ?? (
            <>
              <span className="cv-page-kicker">Repository</span>
              <h1 className="cv-page-title mt-1.5 truncate text-slate-100">
                {selectedProject?.display_name ?? selectedRepoPath.split('/').pop()}
              </h1>
              <p className="mt-1.5 max-w-3xl truncate font-mono text-xs text-slate-500">
                {selectedRepoPath}
              </p>
            </>
          )}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
