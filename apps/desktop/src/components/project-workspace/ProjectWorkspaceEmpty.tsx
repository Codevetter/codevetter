import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useProjectWorkspace } from '@/lib/project-workspace';

export function ProjectWorkspaceEmpty({
  title = 'Add a project',
  description = 'Choose a local repository to review or unpack.',
}: {
  title?: string;
  description?: string;
}) {
  const { addProject, addingProject } = useProjectWorkspace();

  return (
    <div className="flex min-h-[calc(100vh-10rem)] select-none items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
        <h1 className="text-base font-semibold tracking-normal text-slate-100">{title}</h1>
        <p className="mt-1.5 text-sm leading-5 text-slate-500">{description}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-5 h-9 w-full justify-center rounded-xl border-white/[0.1] bg-white/[0.055] px-4 text-slate-100 hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white"
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
