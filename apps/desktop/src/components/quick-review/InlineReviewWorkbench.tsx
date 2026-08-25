import {
  CheckCircle,
  ClipboardCheck,
  History,
  ListChecks,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { severityColor } from '@/lib/quick-review-format';
import type { FindingEvidence } from '@/lib/quick-review-types';
import type { CliReviewFinding, FindingDisposition } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';
import type { VerificationDecisionSummary } from '@/lib/verification-presentation';

export type ReviewDockTab = 'findings' | 'evidence' | 'history' | 'limitations';

interface InlineReviewWorkbenchProps {
  decision: VerificationDecisionSummary;
  activeFinding: CliReviewFinding | null;
  activeFindingIndex: number | null;
  findingCount: number;
  verifiedCount: number;
  activeEvidence: FindingEvidence;
  selectedForPatch: boolean;
  dockTab: ReviewDockTab;
  onDockTabChange: (tab: ReviewDockTab) => void;
  onTogglePatch: () => void;
  onSetDisposition: (disposition: FindingDisposition) => void;
  source: ReactNode;
  findings: ReactNode;
  evidence: ReactNode;
  history: ReactNode;
  limitations: ReactNode;
  footer: ReactNode;
}

const tabs: Array<{
  id: ReviewDockTab;
  label: string;
  icon: typeof ListChecks;
}> = [
  { id: 'findings', label: 'Findings', icon: ListChecks },
  { id: 'evidence', label: 'Evidence', icon: ClipboardCheck },
  { id: 'history', label: 'History', icon: History },
  { id: 'limitations', label: 'Review record', icon: ShieldAlert },
];

function evidenceLabel(evidence: FindingEvidence): string {
  if (evidence.status === 'reproduced') return 'Reproduced';
  if (evidence.status === 'fixed') return 'Fixed';
  if (evidence.status === 'not_reproduced') return 'Not reproduced';
  return 'Not checked';
}

export default function InlineReviewWorkbench({
  decision,
  activeFinding,
  activeFindingIndex,
  findingCount,
  verifiedCount,
  activeEvidence,
  selectedForPatch,
  dockTab,
  onDockTabChange,
  onTogglePatch,
  onSetDisposition,
  source,
  findings,
  evidence,
  history,
  limitations,
  footer,
}: InlineReviewWorkbenchProps) {
  const activeDock = { findings, evidence, history, limitations }[dockTab];
  const canDisposition = Boolean(activeFinding?.id);
  const [overlayOpen, setOverlayOpen] = useState(
    () => window.matchMedia('(min-width: 1280px)').matches
  );

  useEffect(() => {
    setOverlayOpen(window.matchMedia('(min-width: 1280px)').matches);
  }, [activeFindingIndex]);

  useEffect(() => {
    if (!overlayOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOverlayOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [overlayOpen]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onDockTabChange(nextTab.id);
    document.getElementById(`review-dock-tab-${nextTab.id}`)?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--cv-line)] bg-[#060708]">
      <div className="flex min-h-[58px] shrink-0 items-center gap-3 border-b border-[var(--cv-line)] bg-[#090a0c] px-4">
        <Badge
          variant="outline"
          className={cn(
            'rounded-full px-2.5 py-1 text-[10px] font-semibold',
            decision.status === 'ship_candidate'
              ? 'border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200'
              : decision.status === 'hold'
                ? 'border-amber-400/30 bg-amber-400/[0.08] text-amber-200'
                : 'border-slate-500/30 bg-slate-500/[0.08] text-slate-300'
          )}
        >
          {decision.label}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-slate-100">{decision.limitation}</p>
          <p className="truncate text-[12px] text-[var(--cv-text-muted)]">{decision.nextAction}</p>
        </div>
        {activeFinding && (
          <div className="flex shrink-0 items-center gap-2">
            {!overlayOpen && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOverlayOpen(true)}
                className="h-9 px-3 text-[12px] text-[var(--cv-text-muted)] hover:bg-white/[0.04] hover:text-white"
              >
                Show finding
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canDisposition}
              onClick={() => onSetDisposition('dismissed')}
              className="h-9 border-[var(--cv-line-strong)] bg-[#111316] px-3 text-[12px] text-slate-300 hover:bg-white/[0.06] hover:text-white"
            >
              Dismiss
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onDockTabChange('evidence')}
              className="h-9 bg-[var(--cv-accent)] px-3 text-[12px] font-semibold text-black hover:bg-amber-300"
            >
              Open verification
            </Button>
          </div>
        )}
      </div>

      <div className="relative min-h-[180px] flex-1 overflow-hidden bg-[#030405]">
        <div
          className={cn(
            'h-full min-h-0 transition-[padding] duration-150',
            activeFinding && overlayOpen && 'xl:pr-[410px]'
          )}
        >
          {source}
        </div>
        {activeFinding && activeFindingIndex !== null && overlayOpen && (
          <aside
            aria-label="Selected finding"
            className="absolute right-5 top-16 z-10 w-[min(390px,calc(100%-40px))] overflow-hidden rounded-xl border border-amber-400/30 bg-[#111216] shadow-[0_22px_55px_rgba(0,0,0,0.52)]"
          >
            <div className="flex items-center gap-2 border-b border-[var(--cv-line)] px-3 py-2.5">
              <Badge
                variant="outline"
                className={cn(
                  'rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase',
                  severityColor(activeFinding.severity)
                )}
              >
                {activeFinding.severity}
              </Badge>
              <span className="text-[12px] font-semibold text-slate-200">
                Finding {activeFindingIndex + 1} of {findingCount}
              </span>
              <span className="ml-auto max-w-[150px] truncate font-mono text-[10px] text-[var(--cv-text-muted)]">
                {activeFinding.filePath || 'Source unavailable'}
                {activeFinding.line != null ? `:${activeFinding.line}` : ''}
              </span>
              <button
                type="button"
                onClick={() => setOverlayOpen(false)}
                aria-label="Close selected finding"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--cv-text-muted)] hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="p-4">
              <h2 className="text-[17px] font-semibold leading-6 text-white">
                {activeFinding.title}
              </h2>
              <p className="mt-2 line-clamp-4 text-[13px] leading-5 text-slate-300">
                {activeFinding.summary}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md border border-[var(--cv-line)] bg-white/[0.025] px-2 py-1 text-slate-400">
                  {evidenceLabel(activeEvidence)}
                </span>
                <span className="rounded-md border border-[var(--cv-line)] bg-white/[0.025] px-2 py-1 text-slate-400">
                  {activeEvidence.artifact.trim()
                    ? 'Runtime receipt attached'
                    : 'No runtime receipt'}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onTogglePatch}
                  className="h-9 gap-1.5 border-[var(--cv-line-strong)] bg-[#111316] px-3 text-[12px] text-slate-300 hover:bg-white/[0.06] hover:text-white"
                >
                  {selectedForPatch ? <CheckCircle size={13} /> : <Square size={13} />}
                  {selectedForPatch ? 'In patch queue' : 'Add to patch'}
                </Button>
              </div>
            </div>
          </aside>
        )}
      </div>

      <section className="flex h-[30vh] min-h-[180px] max-h-[260px] shrink-0 flex-col border-t border-[var(--cv-line)] bg-[#090a0c]">
        <div
          className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--cv-line)] px-2"
          role="tablist"
          aria-label="Review evidence dock"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = dockTab === tab.id;
            const tabIndex = tabs.indexOf(tab);
            const suffix =
              tab.id === 'findings'
                ? ` ${findingCount}`
                : tab.id === 'evidence'
                  ? ` ${verifiedCount}/${findingCount}`
                  : '';
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`review-dock-tab-${tab.id}`}
                aria-controls="review-dock-panel"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onDockTabChange(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tabIndex)}
                className={cn(
                  'flex h-10 items-center gap-1.5 border-b px-3 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
                  active
                    ? 'border-[var(--cv-accent)] text-slate-100'
                    : 'border-transparent text-[var(--cv-text-muted)] hover:text-slate-200'
                )}
              >
                <Icon size={13} aria-hidden="true" />
                {tab.label}
                {suffix}
              </button>
            );
          })}
        </div>
        <div
          id="review-dock-panel"
          aria-labelledby={`review-dock-tab-${dockTab}`}
          className="min-h-0 flex-1 overflow-hidden"
          role="tabpanel"
        >
          {activeDock}
        </div>
        {footer}
      </section>
    </div>
  );
}
