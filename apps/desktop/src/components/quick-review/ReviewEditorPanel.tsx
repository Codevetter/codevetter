import { Loader2, Zap } from 'lucide-react';
import { type MutableRefObject, type RefObject, useEffect, useRef } from 'react';

import FixDiffView from '@/components/quick-review/FixDiffView';
import type { DiffFile } from '@/lib/quick-review-code';
import { renderCodeLine } from '@/lib/quick-review-code';
import type { CliReviewFinding, FileLineData, FixFindingsResult } from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';

interface HunkNavTarget {
  key: string;
  filePath: string;
  hunkIndex: number;
}

function splitSourcePath(path: string): { name: string; directory: string } {
  if (!path) return { name: 'Source unavailable', directory: '' };
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return {
    name: segments.pop() || normalized,
    directory: segments.join('/'),
  };
}

export interface ReviewEditorPanelProps {
  fixResult: FixFindingsResult | null;
  diffFiles: DiffFile[];
  expandedFiles: Set<string>;
  toggleFileExpanded: (path: string) => void;
  handleRevertFile: (path: string) => void;
  handleRevertHunk: (path: string, hunkText: string) => void;
  hunkNavRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  hunkNavTargets: HunkNavTarget[];
  activeHunkNavIndex: number;
  handleReReview: () => void;
  isReviewing: boolean;
  repoPath: string;
  diffRange: string;
  handleMergeFix: () => Promise<void>;
  handleDiscardFix: () => Promise<void>;
  handleOpenInIDE: () => Promise<void>;
  isFixing: string | null;
  fixLogRef: RefObject<HTMLDivElement | null>;
  fixProgress: string[];
  selectedFindingIdx: number | null;
  activeFinding: CliReviewFinding | null;
  activeCodePath: string;
  codeLanguage: string;
  codeLines: FileLineData[];
  sourceLoading: boolean;
}

export default function ReviewEditorPanel({
  fixResult,
  diffFiles,
  expandedFiles,
  toggleFileExpanded,
  handleRevertFile,
  handleRevertHunk,
  hunkNavRefs,
  hunkNavTargets,
  activeHunkNavIndex,
  handleReReview,
  isReviewing,
  repoPath,
  diffRange,
  handleMergeFix,
  handleDiscardFix,
  handleOpenInIDE,
  isFixing,
  fixLogRef,
  fixProgress,
  selectedFindingIdx,
  activeFinding,
  activeCodePath,
  codeLanguage,
  codeLines,
  sourceLoading,
}: ReviewEditorPanelProps) {
  const activeSource = splitSourcePath(activeCodePath);
  const highlightedLineRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (sourceLoading) return;
    highlightedLineRef.current?.scrollIntoView({ block: 'center' });
  }, [codeLines, sourceLoading]);

  return (
    <div className="cv-scan flex h-full flex-col bg-[#050505]">
      {/* Fix results view */}
      {fixResult ? (
        <FixDiffView
          fixResult={fixResult}
          diffFiles={diffFiles}
          expandedFiles={expandedFiles}
          toggleFileExpanded={toggleFileExpanded}
          handleRevertFile={handleRevertFile}
          handleRevertHunk={handleRevertHunk}
          hunkNavRefs={hunkNavRefs}
          hunkNavTargets={hunkNavTargets}
          activeHunkNavIndex={activeHunkNavIndex}
          handleReReview={handleReReview}
          isReviewing={isReviewing}
          repoPath={repoPath}
          diffRange={diffRange}
          handleMergeFix={handleMergeFix}
          handleDiscardFix={handleDiscardFix}
          handleOpenInIDE={handleOpenInIDE}
        />
      ) : isFixing ? (
        <div className="flex h-full flex-col bg-[#050505]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--cv-line)] px-4 py-2">
            <Loader2 size={14} className="animate-spin text-[var(--cv-accent)]" />
            <span className="text-xs font-medium text-[var(--cv-accent)]">
              Fixing with Claude...
            </span>
          </div>
          <div ref={fixLogRef} className="flex-1 overflow-y-auto p-4">
            {fixProgress.length > 0 ? (
              fixProgress.map((line, i) => (
                <div
                  key={i}
                  className="font-mono text-[11px] leading-5 text-[var(--cv-text-muted)]"
                >
                  {line}
                </div>
              ))
            ) : (
              <div className="flex items-center gap-2 text-sm text-[var(--cv-text-muted)]">
                <Loader2 size={16} className="animate-spin" />
                Waiting for output...
              </div>
            )}
          </div>
        </div>
      ) : selectedFindingIdx !== null && activeFinding ? (
        <>
          {/* File path header + finding context */}
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--cv-line)] bg-[#090a0c] px-5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] font-medium text-slate-300">
                {activeSource.name}
              </div>
              {activeSource.directory && (
                <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--cv-text-muted)]">
                  {activeSource.directory}
                </div>
              )}
            </div>
            {codeLanguage && (
              <span className="shrink-0 text-[10px] font-medium text-[var(--cv-text-muted)]">
                {codeLanguage}
              </span>
            )}
            {activeFinding.line != null && (
              <span className="shrink-0 font-mono text-[10px] text-[var(--cv-text-muted)]">
                line {activeFinding.line}
              </span>
            )}
          </div>
          {/* Code lines */}
          <div className="flex-1 overflow-y-auto bg-[#030405] px-5 py-5 font-mono text-[13px] leading-7">
            {sourceLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[var(--cv-text-muted)]">
                <Loader2 size={14} className="animate-spin text-[var(--cv-accent)]" />
                Loading source…
              </div>
            ) : codeLines.length > 0 ? (
              <div className="grid grid-cols-[42px_1fr] gap-x-4">
                {codeLines.map((cl) => (
                  <div key={cl.line} className="contents">
                    <span
                      className={cn(
                        'select-none text-right tabular-nums',
                        cl.highlight ? 'text-[var(--cv-danger)]/80' : 'text-slate-700'
                      )}
                    >
                      {cl.line}
                    </span>
                    <pre
                      ref={cl.highlight ? highlightedLineRef : undefined}
                      className={cn(
                        'min-w-0 whitespace-pre border-l-2 px-3',
                        cl.highlight
                          ? 'border-[var(--cv-danger)] bg-red-500/10 text-slate-100'
                          : 'border-transparent text-slate-300 hover:bg-white/[0.025]'
                      )}
                    >
                      {renderCodeLine(cl.text, codeLanguage)}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[42px_1fr] gap-x-4">
                <span className="text-right text-slate-700">{activeFinding.line ?? 1}</span>
                <span className="-mx-3 border-l-2 border-[var(--cv-danger)] bg-red-500/10 px-3 text-slate-400">
                  Source snapshot unavailable. Reopen the repository to inspect this line.
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex h-12 items-center border-b border-[var(--cv-line)] bg-[#090a0c] px-5">
            <span className="text-xs font-medium text-[var(--cv-text-muted)]">
              Source inspection
            </span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[#030405] text-[var(--cv-text-muted)]">
            <Zap size={24} className="text-slate-700" />
            <span className="text-sm">Select a review comment to inspect source</span>
          </div>
        </div>
      )}
    </div>
  );
}
