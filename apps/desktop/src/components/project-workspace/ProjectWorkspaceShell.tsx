import type { ReactNode } from 'react';

import { ProjectSidebar } from '@/components/project-workspace/ProjectSidebar';
import { cn } from '@/lib/utils';

export function ProjectWorkspaceShell({
  children,
  className,
  mainClassName,
}: {
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}) {
  return (
    <div className={cn('box-border flex h-full min-h-0 overflow-hidden bg-transparent', className)}>
      <ProjectSidebar className="h-full min-h-0" />
      <div
        className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden', mainClassName)}
      >
        {children}
      </div>
    </div>
  );
}
