import type { UnpackSectionMeta, UnpackWorkspaceSection } from '@/lib/unpack-sections';
import { cn } from '@/lib/utils';

type Props = {
  sections: UnpackSectionMeta[];
  active: UnpackWorkspaceSection;
  onChange: (section: UnpackWorkspaceSection) => void;
};

export function UnpackSectionNav({ sections, active, onChange }: Props) {
  if (sections.length <= 1) return null;

  return (
    <nav
      className="sticky top-0 z-20 -mx-1 border-b border-[var(--cv-line)] bg-[var(--bg-main)]/88 px-1 py-2 backdrop-blur-md"
      aria-label="Unpack sections"
    >
      <div className="cv-glass flex gap-1 overflow-x-auto rounded-lg p-1 [scrollbar-width:thin]">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onChange(section.id)}
              title={section.description}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-[var(--cv-accent)]/40 bg-[var(--cv-accent)]/12 text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                  : 'border-transparent text-[var(--text-muted)] hover:border-[var(--cv-line)] hover:bg-white/[0.035] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon size={13} className={isActive ? 'text-[var(--cv-accent)]' : undefined} />
              <span className="hidden sm:inline">{section.label}</span>
              <span className="sm:hidden">{section.short}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
