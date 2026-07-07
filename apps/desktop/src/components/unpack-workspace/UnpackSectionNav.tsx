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
    <nav className="border-b border-white/[0.055] pb-3" aria-label="Unpack sections">
      <div className="flex flex-wrap gap-1.5">
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
                'inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-white/[0.12] bg-white/[0.055] text-slate-100'
                  : 'border-transparent text-[var(--text-muted)] hover:border-white/[0.08] hover:bg-white/[0.03] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon size={13} className={isActive ? 'text-cyan-200/80' : undefined} />
              <span className="hidden sm:inline">{section.label}</span>
              <span className="sm:hidden">{section.short}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
