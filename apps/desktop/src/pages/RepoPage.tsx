import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ProjectWorkspaceEmpty } from '@/components/project-workspace/ProjectWorkspaceEmpty';
import { ProjectWorkspaceHeader } from '@/components/project-workspace/ProjectWorkspaceHeader';
import { ProjectWorkspaceShell } from '@/components/project-workspace/ProjectWorkspaceShell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useProjectWorkspace } from '@/lib/project-workspace';
import { UnpackProjectPanel } from '@/pages/RepoUnpacked';

export default function RepoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedRepoPath, selectProject, ready, refreshProjects } = useProjectWorkspace();

  const initialRepo = useRef(searchParams.get('repo'));
  const didApplyUrl = useRef(false);

  useEffect(() => {
    if (!ready || didApplyUrl.current) return;
    didApplyUrl.current = true;
    const fromUrl = initialRepo.current;
    if (fromUrl) selectProject(fromUrl);
  }, [ready, selectProject]);

  useEffect(() => {
    if (!selectedRepoPath) return;
    const current = searchParams.get('repo');
    if (current === selectedRepoPath) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('repo', selectedRepoPath);
        return next;
      },
      { replace: true }
    );
  }, [searchParams, selectedRepoPath, setSearchParams]);

  return (
    <TooltipProvider delayDuration={200}>
      <ProjectWorkspaceShell mainClassName="px-4 pb-20 pt-5 lg:px-5">
        {!selectedRepoPath ? (
          <ProjectWorkspaceEmpty />
        ) : (
          <>
            <ProjectWorkspaceHeader />
            <UnpackProjectPanel
              repoPath={selectedRepoPath}
              onSnapshotsChange={() => void refreshProjects({ silent: true })}
            />
          </>
        )}
      </ProjectWorkspaceShell>
    </TooltipProvider>
  );
}
