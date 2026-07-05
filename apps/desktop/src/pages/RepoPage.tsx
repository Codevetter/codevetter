import { GitCommit, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { IntelProjectPanel } from '@/components/project-workspace/IntelProjectPanel';
import { ProjectWorkspaceEmpty } from '@/components/project-workspace/ProjectWorkspaceEmpty';
import { ProjectWorkspaceHeader } from '@/components/project-workspace/ProjectWorkspaceHeader';
import { ProjectWorkspaceShell } from '@/components/project-workspace/ProjectWorkspaceShell';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useProjectWorkspace } from '@/lib/project-workspace';
import { cn } from '@/lib/utils';
import { UnpackProjectPanel } from '@/pages/RepoUnpacked';

type RepoTab = 'unpack' | 'intel';

export default function RepoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedRepoPath, selectProject, ready, refreshProjects } = useProjectWorkspace();

  const section = searchParams.get('section');
  const tab: RepoTab = section === 'intel' || section === 'attribution' ? 'intel' : 'unpack';
  const setTab = useCallback(
    (next: RepoTab) => {
      const repo = searchParams.get('repo');
      if (next === 'unpack') {
        setSearchParams(repo ? { repo } : {}, { replace: true });
      } else {
        setSearchParams(repo ? { repo, section: 'intel' } : { section: 'intel' }, {
          replace: true,
        });
      }
    },
    [searchParams, setSearchParams]
  );

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
      <ProjectWorkspaceShell mainClassName="px-6 pb-24 pt-6">
        {!selectedRepoPath ? (
          <ProjectWorkspaceEmpty />
        ) : (
          <>
            <ProjectWorkspaceHeader
              actions={
                <div className="cv-glass inline-flex shrink-0 rounded-md p-0.5">
                  {(
                    [
                      { key: 'unpack' as const, label: 'Unpack', icon: ScanSearch },
                      { key: 'intel' as const, label: 'Intel', icon: GitCommit },
                    ] as const
                  ).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
                        tab === key
                          ? 'border border-cyan-400/35 bg-cyan-500/12 text-cyan-200'
                          : 'border border-transparent text-slate-500 hover:bg-white/[0.035] hover:text-slate-300'
                      )}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
                </div>
              }
            />

            {tab === 'unpack' ? (
              <UnpackProjectPanel
                repoPath={selectedRepoPath}
                onSnapshotsChange={() => void refreshProjects({ silent: true })}
              />
            ) : (
              <IntelProjectPanel
                repoPath={selectedRepoPath}
                onSnapshotsChange={() => void refreshProjects({ silent: true })}
              />
            )}
          </>
        )}
      </ProjectWorkspaceShell>
    </TooltipProvider>
  );
}
