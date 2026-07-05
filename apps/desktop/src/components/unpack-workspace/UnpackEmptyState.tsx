import { ScanSearch, Sparkles, Target } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { UnpackRunKindBadge } from '@/components/unpack-workspace/UnpackRunKindBadge';

type Props = {
  onUnpack: () => void;
  busy: boolean;
};

const STEPS = [
  {
    step: '1',
    title: 'Generate snapshot',
    kind: 'local' as const,
    detail:
      'Rust parallel walk builds inventory, QA posture, health signals, and graph hints — offline, no API keys.',
    icon: ScanSearch,
  },
  {
    step: '2',
    title: 'Analyze or ask',
    kind: 'ai' as const,
    detail:
      'Analyze attaches an AI report to the snapshot. Or ask custom questions against the same local data.',
    icon: Sparkles,
  },
  {
    step: '3',
    title: 'Use it in Review',
    kind: 'local' as const,
    detail:
      'Blast radius, deep graph context, and handoff exports feed the verification loop (graph index is also local).',
    icon: Target,
  },
] as const;

export function UnpackEmptyState({ onUnpack, busy }: Props) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--cv-line)] bg-[var(--bg-surface)]/60 p-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
          Mission control for this repo
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Generate a local snapshot first. You can browse it immediately, then run AI analysis as a
          separate step on that exact snapshot.
        </p>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {STEPS.map(({ step, title, kind, detail, icon: Icon }) => (
          <div
            key={step}
            className="rounded-lg border border-[var(--cv-line)] bg-[var(--bg-raised)]/50 p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--cv-accent)]">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--cv-line)] font-mono text-[10px]">
                  {step}
                </span>
                <Icon size={13} />
                {title}
              </div>
              <UnpackRunKindBadge kind={kind} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onUnpack}>
          <ScanSearch size={14} className="mr-1.5" />
          Generate new
        </Button>
        <UnpackRunKindBadge kind="local" />
      </div>
    </div>
  );
}
