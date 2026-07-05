import { FolderPlus, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useProjectWorkspace } from '@/lib/project-workspace';

export function ProjectWorkspaceEmpty({
  title = 'Repo workspace',
  description = 'Pick a project from the sidebar or add a local repository. Unpack and Intel snapshots are stored locally — refresh when you want a new baseline.',
}: {
  title?: string;
  description?: string;
}) {
  const { addProject, addingProject } = useProjectWorkspace();

  return (
    <div className="cv-frame cv-glow-edge mx-auto mt-24 max-w-lg overflow-hidden rounded-lg text-center">
      <div className="cv-terminal-bar px-4 py-2.5">
        <span className="cv-dot bg-red-500/50" />
        <span className="cv-dot bg-amber-400/50" />
        <span className="cv-dot bg-emerald-400/50" />
        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          project intake
        </span>
      </div>
      <div className="p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
          <FolderPlus size={24} />
        </div>
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{description}</p>
        <Button
          type="button"
          variant="outline"
          className="cv-action-primary mt-6"
          onClick={() => void addProject()}
          disabled={addingProject}
        >
          {addingProject ? (
            <Loader2 size={14} className="mr-1.5 animate-spin" />
          ) : (
            <Plus size={14} className="mr-1.5" />
          )}
          Add project
        </Button>
      </div>
    </div>
  );
}
