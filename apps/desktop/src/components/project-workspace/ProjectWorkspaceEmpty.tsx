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
      <div className="cv-spotlight-surface w-full max-w-sm rounded-2xl p-6">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-zinc-100">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
        <Button
          type="button"
          className="mt-5 h-9 w-full justify-center px-4"
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
