import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function DisclosurePanel({
  title,
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn('group rounded-xl border border-[var(--cv-line)] bg-white/[0.018]', className)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
          {summary ? (
            <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">{summary}</div>
          ) : null}
        </div>
        <ChevronRight
          size={16}
          className="shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="border-t border-[var(--cv-line)] p-4">{children}</div>
    </details>
  );
}
