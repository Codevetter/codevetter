import {
  ArrowLeft,
  CheckCircle,
  CheckSquare2,
  ClipboardCheck,
  FolderGit2,
  Loader2,
  Square,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import BlastRadiusPanel from '@/components/blast-radius-panel';
import { ProjectWorkspaceEmpty } from '@/components/project-workspace/ProjectWorkspaceEmpty';
import { ProjectWorkspaceShell } from '@/components/project-workspace/ProjectWorkspaceShell';
import AgentStatusTimeline from '@/components/quick-review/AgentStatusTimeline';
import AudienceValidationPanel from '@/components/quick-review/AudienceValidationPanel';
import CreatePreviewPanel from '@/components/quick-review/CreatePreviewPanel';
import EvidenceInsightsPanel from '@/components/quick-review/EvidenceInsightsPanel';
import FindingsListPanel from '@/components/quick-review/FindingsListPanel';
import InlineReviewWorkbench, {
  type ReviewDockTab,
} from '@/components/quick-review/InlineReviewWorkbench';
import ReviewEditorPanel from '@/components/quick-review/ReviewEditorPanel';
import ReviewMemoryGraphPanel from '@/components/quick-review/ReviewMemoryGraphPanel';
import ReviewSetupPanel from '@/components/quick-review/ReviewSetupPanel';
import SyntheticQaPanel from '@/components/quick-review/SyntheticQaPanel';
import VerificationEvidencePanel from '@/components/quick-review/VerificationEvidencePanel';
import VerificationSummaryPanel, {
  type WarmExecutionFinding,
} from '@/components/quick-review/VerificationSummaryPanel';
import XrayExportPanel from '@/components/quick-review/XrayExportPanel';
import SandboxRunner from '@/components/SandboxRunner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  type BrowserEvidenceRef,
  buildAgentFixPacket,
  renderAgentFixPacketMarkdown,
  type TaskContext,
} from '@/lib/agent-fix-packet';
import { trackCoreAction } from '@/lib/analytics';
import { renderAudienceValidationProof } from '@/lib/audience-validation';
import { useProjectWorkspace } from '@/lib/project-workspace';
import { buildReviewIntentReport } from '@/lib/intent-debugger/report';
import { parseDiffIntoFiles } from '@/lib/quick-review-code';
import {
  canPreviewQaArtifact,
  severityColor,
  severityIcon,
  severityOrder,
} from '@/lib/quick-review-format';
import {
  buildProcedureExecutionEvents,
  findingEvidenceKey,
  mergeProcedureExecutionEvents,
  procedureEventKey,
  procedureEventsForFindingEvidence,
  procedureEventsForFixResult,
  procedureEventsForQaRun,
  procedureEventTimeLabel,
  qaRequestFromHistory,
  qaRunsForReviewPrompt,
  repoLabelFromPath,
  repoScopedPreferenceKey,
  sameHistoryFile,
  storedProcedureEventToExecutionEvent,
  storedSyntheticQaRunToHistory,
} from '@/lib/quick-review-procedure';
import { diffRangeFromSourceLabel, repoPrefKey } from '@/lib/quick-review-state';
import {
  defaultFindingEvidence,
  emptyBrowserEvidence,
  type FindingEvidence,
  type QaAuthMode,
  type QaPreset,
  type QaRepoTraceMode,
  type QaRunHistoryEntry,
  type QaRunnerType,
  type QaTargetPreset,
  type QaWorkflowPreset,
} from '@/lib/quick-review-types';
import {
  buildCodebaseHistoryExplanations,
  buildFindingHunkNoteMarkdown,
  buildFocusedReviewMemoryGraph,
  buildQaPostFixComparison,
  buildReviewerProofMarkdown,
  buildVerificationTimeline,
  projectDifferentialVerificationHistory,
  type EvidenceCandidateStatus,
  formatHistoryCommandEvidence,
  type HistoryFindingSummary,
  type ProcedureExecutionEvent,
  queryCodebaseHistoryExplanationForFile,
  selectTimelineSegmentFindingIndexes,
  type VerificationTimelineItem,
  type VerificationTimelineJumpTarget,
} from '@/lib/review-proof';
import {
  syntheticQaFailureFinding,
  syntheticQaToFindingEvidence,
} from '@/lib/synthetic-qa/apply-evidence';
import { CODEVETTER_REVIEW_SHELL } from '@/lib/synthetic-qa/loops';
import type { SyntheticQaRunResult } from '@/lib/synthetic-qa/types';
import type {
  AudienceValidationBundle,
  BlastRadiusReport,
  CliReviewFinding,
  CliReviewResult,
  EvidenceCandidate,
  EvidenceProcedureStep,
  FileLineData,
  FindingDisposition,
  FixFindingsResult,
  LocalReviewFindingRow,
  LocalReviewRow,
  PlaywrightSpecCandidate,
  PullRequest,
  RawSessionContextItem,
  RepoHistoryContext,
  ReviewManifest,
  ReviewProcedureEvent,
  ReviewVerificationCommandSuggestion,
  StoredDifferentialVerificationRun,
} from '@/lib/tauri-ipc';
import {
  analyzeBlastRadius,
  unpackDeepGraphDetectChanges,
  unpackDeepGraphStatus,
  type UnpackDeepGraphDetectChanges,
  cancelReviewVerificationCommand,
  cancelCliReview,
  deleteReview,
  discardFix,
  discoverPlaywrightSpecs,
  fixFindings,
  getLocalDiff,
  getPreference,
  getRepoHistoryContext,
  getReview,
  getReviewManifest,
  isTauriAvailable,
  listGitBranches,
  listPullRequests,
  listReviewProcedureEvents,
  listReviews,
  listDifferentialVerificationRuns,
  listSyntheticQaRuns,
  listWarmVerificationRuns,
  mergeFix,
  openInApp,
  readFileAroundLine,
  readFilePreview,
  readRawSessionContext,
  recordReviewProcedureEvent,
  recordSyntheticQaRun,
  revertDiffHunk,
  revertFiles,
  runCliReview,
  runReviewVerificationCommand,
  runSyntheticQa,
  sendTrayNotification,
  setCurrentWindowTitle,
  setFindingDisposition,
  setPreference,
  suggestReviewVerificationCommands,
} from '@/lib/tauri-ipc';
import { cn } from '@/lib/utils';
import {
  deriveVerificationDecisionSummary,
  VERIFICATION_COPY,
} from '@/lib/verification-presentation';
import {
  completeReviewQualificationState,
  failReviewQualificationState,
  getReviewQualificationRequest,
  type VerificationWindow,
} from '@/lib/verification-state-bridge';
import {
  projectWarmVerification,
  type WarmVerificationProjection,
} from '@/lib/warm-verification/adapters';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickBaseBranch(branches: string[]): string {
  if (branches.includes('main')) return 'main';
  if (branches.includes('master')) return 'master';
  if (branches.length > 0) return branches[0];
  return '';
}

interface TaskContextSetters {
  setTaskGoal: (v: string) => void;
  setTaskAcceptance: (v: string) => void;
  setTaskNonGoals: (v: string) => void;
  setTaskSourceLabel: (v: string) => void;
}

function resetTaskContext(setters: TaskContextSetters): void {
  setters.setTaskGoal('');
  setters.setTaskAcceptance('');
  setters.setTaskNonGoals('');
  setters.setTaskSourceLabel('');
}

async function loadPersistedTaskContext(dir: string, setters: TaskContextSetters): Promise<void> {
  try {
    const savedTask = await getPreference(`quick_review_task_${repoPrefKey(dir)}`);
    if (savedTask) {
      const parsed = JSON.parse(savedTask) as Partial<TaskContext>;
      setters.setTaskGoal(parsed.goal ?? '');
      setters.setTaskAcceptance(parsed.acceptanceCriteria ?? '');
      setters.setTaskNonGoals(parsed.nonGoals ?? '');
      setters.setTaskSourceLabel(parsed.sourceLabel ?? '');
    } else {
      resetTaskContext(setters);
    }
  } catch {
    resetTaskContext(setters);
  }
}

interface QaWorkflowSetters {
  setQaBaseUrl: (v: string) => void;
  setQaLoopId: (v: string) => void;
  setQaRunnerType: (v: QaRunnerType) => void;
  setQaGoal: (v: string) => void;
  setQaTargetRoute: (v: string) => void;
  setQaExternalCommand: (v: string) => void;
  setQaRepoSpecPath: (v: string) => void;
  setQaRepoTraceMode: (v: QaRepoTraceMode) => void;
  setQaAuthMode: (v: QaAuthMode) => void;
  setQaStorageStatePath: (v: string) => void;
  setQaAllowRemoteTarget: (v: boolean) => void;
  setQaTargets: (v: QaTargetPreset[]) => void;
  setQaActiveTargetId: (v: string) => void;
  setQaTargetName: (v: string) => void;
  setQaWorkflowName: (v: string) => void;
}

function buildSyntheticQaRunConfig(
  request: QaPreset,
  runRepoPath: string
): Parameters<typeof runSyntheticQa>[2] {
  return {
    runnerType: request.runnerType,
    goal: request.goal,
    externalCommand: request.runnerType === 'external_skill' ? request.externalCommand : undefined,
    repoPath: runRepoPath,
    specPath: request.runnerType === 'repo_playwright' ? request.repoSpecPath : undefined,
    repoTraceMode: request.runnerType === 'repo_playwright' ? request.repoTraceMode : undefined,
    authMode: request.authMode,
    storageStatePath: request.authMode === 'storage_state' ? request.storageStatePath : undefined,
    targetRoute: request.targetRoute,
    allowRemoteTarget: request.allowRemoteTarget,
  };
}

function resolveAudienceDefaultArtifact(
  qaLastRun: SyntheticQaRunResult | null,
  qaBaseUrl: string
): string {
  return qaLastRun?.screenshot_path ?? qaLastRun?.route ?? qaBaseUrl;
}

function BlastRadiusSection({
  blastReport,
  blastLoading,
  blastError,
  deepGraphImpact,
  deepGraphImpactLoading,
  handleJumpToCaller,
}: {
  blastReport: BlastRadiusReport | null;
  blastLoading: boolean;
  blastError: string | null;
  deepGraphImpact: UnpackDeepGraphDetectChanges | null;
  deepGraphImpactLoading: boolean;
  handleJumpToCaller: (file: string, line: number) => Promise<void>;
}) {
  if (!blastReport && !blastLoading && !blastError && !deepGraphImpact && !deepGraphImpactLoading) {
    return null;
  }
  return (
    <div className="shrink-0 border-b border-[var(--cv-line)]">
      <BlastRadiusPanel
        report={blastReport}
        loading={blastLoading}
        error={blastError}
        deepGraphImpact={deepGraphImpact}
        deepGraphImpactLoading={deepGraphImpactLoading}
        onJump={handleJumpToCaller}
      />
    </div>
  );
}

function MemoryGraphPanels({
  reviewMemoryGraph,
  focusedReviewMemoryGraph,
}: {
  reviewMemoryGraph: CliReviewResult['review_memory_graph'];
  focusedReviewMemoryGraph: ReturnType<typeof buildFocusedReviewMemoryGraph>;
}) {
  return (
    <>
      {reviewMemoryGraph && reviewMemoryGraph.nodes.length > 0 && (
        <ReviewMemoryGraphPanel
          graph={reviewMemoryGraph}
          title="Review memory graph"
          accent="cyan"
          nodeLimit={5}
        />
      )}
      {focusedReviewMemoryGraph && focusedReviewMemoryGraph.nodes.length > 0 && (
        <ReviewMemoryGraphPanel
          graph={focusedReviewMemoryGraph}
          title="Finding graph focus"
          accent="emerald"
          nodeLimit={4}
        />
      )}
    </>
  );
}

function SelectedFindingDetail({
  activeFinding,
  selectedFindingIdx,
  repoPath,
  selectedBranch,
  baseBranch,
  reviewId,
  qaWorkflowScopeLabel,
  qaActiveWorkflowId,
  qaWorkflows,
  qaWorkflowName,
  setQaWorkflowName,
  handleSelectQaWorkflow,
  handleSaveQaWorkflow,
  handleDeleteQaWorkflow,
  qaActiveTargetId,
  qaTargets,
  handleSelectQaTarget,
  qaBaseUrl,
  setQaBaseUrl,
  qaAllowRemoteTarget,
  setQaAllowRemoteTarget,
  qaTargetName,
  setQaTargetName,
  qaTargetRoute,
  setQaTargetRoute,
  qaAuthMode,
  setQaAuthMode,
  qaStorageStatePath,
  setQaStorageStatePath,
  qaLoopId,
  setQaLoopId,
  setQaGoal,
  qaGoal,
  qaRunnerType,
  setQaRunnerType,
  qaRepoSpecPath,
  setQaRepoSpecPath,
  qaSpecLoading,
  qaSpecCandidates,
  qaSpecError,
  handleDiscoverQaSpecs,
  qaRepoTraceMode,
  setQaRepoTraceMode,
  qaExternalCommand,
  setQaExternalCommand,
  handleSaveQaTarget,
  handleDeleteQaTarget,
  handleRunSyntheticQa,
  qaRunning,
  qaError,
  qaLastRun,
  qaArtifactPreview,
  qaArtifactPreviewLoading,
  handlePreviewQaArtifact,
  handleOpenQaArtifact,
  setQaArtifactPreview,
  applyQaToSelectedFinding,
  addQaFailureFinding,
  qaEvidenceHistory,
  qaPostFixComparison,
  postFixQaRunning,
  handleRunPostFixQa,
  activeEvidence,
  updateFindingEvidence,
  activeBrowserEvidence,
  updateBrowserEvidence,
  verificationCommand,
  setVerificationCommand,
  verificationCommandSuggestions,
  verificationCommandSuggestionsLoading,
  verificationCommandTimeoutMs,
  setVerificationCommandTimeoutMs,
  verificationCommandRunning,
  handleRunVerificationCommand,
  verificationCommandRunId,
  verificationCommandCanceling,
  handleCancelVerificationCommand,
  verificationCommandError,
  handleRecordTestCommandEvent,
  toggleRevalidationItem,
}: {
  activeFinding: CliReviewFinding;
  selectedFindingIdx: number | null;
  repoPath: string;
  selectedBranch: string;
  baseBranch: string;
  reviewId: string;
  qaWorkflowScopeLabel: string;
  qaActiveWorkflowId: string;
  qaWorkflows: QaWorkflowPreset[];
  qaWorkflowName: string;
  setQaWorkflowName: (v: string) => void;
  handleSelectQaWorkflow: (id: string) => void;
  handleSaveQaWorkflow: () => void;
  handleDeleteQaWorkflow: () => void;
  qaActiveTargetId: string;
  qaTargets: QaTargetPreset[];
  handleSelectQaTarget: (id: string) => void;
  qaBaseUrl: string;
  setQaBaseUrl: (v: string) => void;
  qaAllowRemoteTarget: boolean;
  setQaAllowRemoteTarget: (v: boolean) => void;
  qaTargetName: string;
  setQaTargetName: (v: string) => void;
  qaTargetRoute: string;
  setQaTargetRoute: (v: string) => void;
  qaAuthMode: QaAuthMode;
  setQaAuthMode: (v: QaAuthMode) => void;
  qaStorageStatePath: string;
  setQaStorageStatePath: (v: string) => void;
  qaLoopId: string;
  setQaLoopId: (v: string) => void;
  setQaGoal: (v: string) => void;
  qaGoal: string;
  qaRunnerType: QaRunnerType;
  setQaRunnerType: (v: QaRunnerType) => void;
  qaRepoSpecPath: string;
  setQaRepoSpecPath: (v: string) => void;
  qaSpecLoading: boolean;
  qaSpecCandidates: PlaywrightSpecCandidate[];
  qaSpecError: string | null;
  handleDiscoverQaSpecs: () => Promise<void>;
  qaRepoTraceMode: QaRepoTraceMode;
  setQaRepoTraceMode: (v: QaRepoTraceMode) => void;
  qaExternalCommand: string;
  setQaExternalCommand: (v: string) => void;
  handleSaveQaTarget: () => void;
  handleDeleteQaTarget: () => void;
  handleRunSyntheticQa: () => Promise<void>;
  qaRunning: boolean;
  qaError: string | null;
  qaLastRun: SyntheticQaRunResult | null;
  qaArtifactPreview: { path: string; content: string; language: string; totalLines: number } | null;
  qaArtifactPreviewLoading: boolean;
  handlePreviewQaArtifact: (artifact: string) => Promise<void>;
  handleOpenQaArtifact: (artifact: string) => Promise<void>;
  setQaArtifactPreview: (
    v: { path: string; content: string; language: string; totalLines: number } | null
  ) => void;
  applyQaToSelectedFinding: () => void;
  addQaFailureFinding: () => void;
  qaEvidenceHistory: QaRunHistoryEntry[];
  qaPostFixComparison: ReturnType<typeof buildQaPostFixComparison>;
  postFixQaRunning: boolean;
  handleRunPostFixQa: () => Promise<void>;
  activeEvidence: FindingEvidence;
  updateFindingEvidence: (idx: number, patch: Partial<FindingEvidence>) => void;
  activeBrowserEvidence: BrowserEvidenceRef;
  updateBrowserEvidence: (idx: number, patch: Partial<BrowserEvidenceRef>) => void;
  verificationCommand: string;
  setVerificationCommand: (v: string) => void;
  verificationCommandSuggestions: ReviewVerificationCommandSuggestion[];
  verificationCommandSuggestionsLoading: boolean;
  verificationCommandTimeoutMs: number;
  setVerificationCommandTimeoutMs: (v: number) => void;
  verificationCommandRunning: boolean;
  handleRunVerificationCommand: () => Promise<void>;
  verificationCommandRunId: string | null;
  verificationCommandCanceling: boolean;
  handleCancelVerificationCommand: () => Promise<void>;
  verificationCommandError: string | null;
  handleRecordTestCommandEvent: () => void;
  toggleRevalidationItem: (idx: number, itemId: string) => void;
}) {
  return (
    <>
      <Badge
        variant="outline"
        className={cn(
          'rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase',
          severityColor(activeFinding.severity)
        )}
      >
        {severityIcon(activeFinding.severity)}
        <span className="ml-1">{activeFinding.severity}</span>
      </Badge>
      <h2 className="mt-4 text-[18px] font-semibold leading-6 tracking-[-0.012em] text-white">
        {activeFinding.title}
      </h2>
      <p className="mt-3 text-[14px] leading-[22px] text-slate-300">{activeFinding.summary}</p>
      {activeFinding.filePath && (
        <div className="mt-4 break-all font-mono text-[11px] leading-4 text-[var(--cv-text-muted)]">
          {activeFinding.filePath}
          {activeFinding.line != null && `:${activeFinding.line}`}
        </div>
      )}
      {activeFinding.suggestion && (
        <div className="mt-6 border-t border-[var(--cv-line)] pt-5">
          <div className="cv-label mb-3">Suggested action</div>
          <p className="text-[14px] leading-[22px] text-slate-300">{activeFinding.suggestion}</p>
        </div>
      )}
      <div className="mt-6 border-t border-[var(--cv-line)] pt-5" data-testid="trex-sandbox-panel">
        <SandboxRunner
          repoPath={repoPath}
          branch={selectedBranch || ''}
          baseBranch={baseBranch || null}
          reviewId={reviewId || null}
          onComplete={() => {
            // Refresh findings so the via-execution rows attach
            // to the existing list; QuickReview's history list
            // re-fetches when reviewId changes — bumping it is
            // enough here.
          }}
        />
      </div>
      <SyntheticQaPanel
        qaWorkflowScopeLabel={qaWorkflowScopeLabel}
        qaActiveWorkflowId={qaActiveWorkflowId}
        qaWorkflows={qaWorkflows}
        qaWorkflowName={qaWorkflowName}
        setQaWorkflowName={setQaWorkflowName}
        handleSelectQaWorkflow={handleSelectQaWorkflow}
        handleSaveQaWorkflow={handleSaveQaWorkflow}
        handleDeleteQaWorkflow={handleDeleteQaWorkflow}
        qaActiveTargetId={qaActiveTargetId}
        qaTargets={qaTargets}
        handleSelectQaTarget={handleSelectQaTarget}
        qaBaseUrl={qaBaseUrl}
        setQaBaseUrl={setQaBaseUrl}
        qaAllowRemoteTarget={qaAllowRemoteTarget}
        setQaAllowRemoteTarget={setQaAllowRemoteTarget}
        qaTargetName={qaTargetName}
        setQaTargetName={setQaTargetName}
        qaTargetRoute={qaTargetRoute}
        setQaTargetRoute={setQaTargetRoute}
        qaAuthMode={qaAuthMode}
        setQaAuthMode={setQaAuthMode}
        qaStorageStatePath={qaStorageStatePath}
        setQaStorageStatePath={setQaStorageStatePath}
        qaLoopId={qaLoopId}
        setQaLoopId={setQaLoopId}
        setQaGoal={setQaGoal}
        qaGoal={qaGoal}
        qaRunnerType={qaRunnerType}
        setQaRunnerType={setQaRunnerType}
        qaRepoSpecPath={qaRepoSpecPath}
        setQaRepoSpecPath={setQaRepoSpecPath}
        qaSpecLoading={qaSpecLoading}
        qaSpecCandidates={qaSpecCandidates}
        qaSpecError={qaSpecError}
        handleDiscoverQaSpecs={handleDiscoverQaSpecs}
        qaRepoTraceMode={qaRepoTraceMode}
        setQaRepoTraceMode={setQaRepoTraceMode}
        qaExternalCommand={qaExternalCommand}
        setQaExternalCommand={setQaExternalCommand}
        handleSaveQaTarget={handleSaveQaTarget}
        handleDeleteQaTarget={handleDeleteQaTarget}
        handleRunSyntheticQa={handleRunSyntheticQa}
        qaRunning={qaRunning}
        qaError={qaError}
        qaLastRun={qaLastRun}
        qaArtifactPreview={qaArtifactPreview}
        qaArtifactPreviewLoading={qaArtifactPreviewLoading}
        handlePreviewQaArtifact={handlePreviewQaArtifact}
        handleOpenQaArtifact={handleOpenQaArtifact}
        setQaArtifactPreview={setQaArtifactPreview}
        selectedFindingIdx={selectedFindingIdx}
        applyQaToSelectedFinding={applyQaToSelectedFinding}
        addQaFailureFinding={addQaFailureFinding}
        qaRunHistory={qaEvidenceHistory}
        qaPostFixComparison={qaPostFixComparison}
        postFixQaRunning={postFixQaRunning}
        handleRunPostFixQa={handleRunPostFixQa}
        repoPath={repoPath}
      />
      {selectedFindingIdx !== null && (
        <VerificationEvidencePanel
          selectedFindingIdx={selectedFindingIdx}
          activeFinding={activeFinding}
          activeEvidence={activeEvidence}
          updateFindingEvidence={updateFindingEvidence}
          activeBrowserEvidence={activeBrowserEvidence}
          updateBrowserEvidence={updateBrowserEvidence}
          verificationCommand={verificationCommand}
          setVerificationCommand={setVerificationCommand}
          verificationCommandSuggestions={verificationCommandSuggestions}
          verificationCommandSuggestionsLoading={verificationCommandSuggestionsLoading}
          verificationCommandTimeoutMs={verificationCommandTimeoutMs}
          setVerificationCommandTimeoutMs={setVerificationCommandTimeoutMs}
          verificationCommandRunning={verificationCommandRunning}
          repoPath={repoPath}
          handleRunVerificationCommand={handleRunVerificationCommand}
          verificationCommandRunId={verificationCommandRunId}
          verificationCommandCanceling={verificationCommandCanceling}
          handleCancelVerificationCommand={handleCancelVerificationCommand}
          verificationCommandError={verificationCommandError}
          handleRecordTestCommandEvent={handleRecordTestCommandEvent}
          toggleRevalidationItem={toggleRevalidationItem}
        />
      )}
    </>
  );
}

interface ViewModeLocals {
  activeFinding: CliReviewFinding | null;
  activeCodePath: string;
  activeEvidence: FindingEvidence;
  activeBrowserEvidence: BrowserEvidenceRef;
  evidenceCandidates: EvidenceCandidate[];
  evidenceProcedureSteps: EvidenceProcedureStep[];
  reviewMemoryGraph: CliReviewResult['review_memory_graph'];
  reviewManifest: CliReviewResult['review_manifest'];
  coverageCounts: Record<string, number> | null;
  focusedReviewMemoryGraph: ReturnType<typeof buildFocusedReviewMemoryGraph>;
  procedureEventsByStep: Record<string, ProcedureExecutionEvent[]>;
}

function computeViewModeLocals(
  result: CliReviewResult,
  selectedFindingIdx: number | null,
  sortedFindings: CliReviewFinding[],
  codeFilePath: string,
  evidenceByFinding: Record<string, FindingEvidence>,
  browserEvidenceByFinding: Record<string, BrowserEvidenceRef>,
  procedureExecutionEvents: ProcedureExecutionEvent[]
): ViewModeLocals {
  const activeFinding = selectedFindingIdx !== null ? sortedFindings[selectedFindingIdx] : null;
  const activeCodePath = codeFilePath || activeFinding?.filePath || '';
  const activeEvidence =
    activeFinding && selectedFindingIdx !== null
      ? {
          ...defaultFindingEvidence,
          ...evidenceByFinding[findingEvidenceKey(activeFinding, selectedFindingIdx)],
        }
      : defaultFindingEvidence;
  const activeBrowserEvidence =
    activeFinding && selectedFindingIdx !== null
      ? {
          ...emptyBrowserEvidence(),
          ...browserEvidenceByFinding[findingEvidenceKey(activeFinding, selectedFindingIdx)],
        }
      : emptyBrowserEvidence();
  const evidenceCandidates = result.evidence_candidates ?? [];
  const evidenceProcedureSteps = result.evidence_procedure_steps ?? [];
  const reviewMemoryGraph = result.review_memory_graph;
  const reviewManifest = result.review_manifest;
  const coverageCounts =
    reviewManifest && !('coverage_kind' in reviewManifest)
      ? reviewManifest.units.reduce(
          (counts, unit) => {
            counts[unit.coverage_state] += 1;
            return counts;
          },
          { reviewed: 0, reused: 0, skipped: 0, failed: 0, cancelled: 0 }
        )
      : null;
  const focusedReviewMemoryGraph = buildFocusedReviewMemoryGraph(reviewMemoryGraph, activeFinding);
  const procedureEventsByStep = procedureExecutionEvents.reduce<
    Record<string, ProcedureExecutionEvent[]>
  >((acc, event) => {
    acc[event.stepId] = [...(acc[event.stepId] ?? []), event];
    return acc;
  }, {});
  return {
    activeFinding,
    activeCodePath,
    activeEvidence,
    activeBrowserEvidence,
    evidenceCandidates,
    evidenceProcedureSteps,
    reviewMemoryGraph,
    reviewManifest,
    coverageCounts,
    focusedReviewMemoryGraph,
    procedureEventsByStep,
  };
}

async function applyFixAndPostFixQa(
  repoPath: string,
  result: CliReviewResult,
  fixPacketFindings: Array<CliReviewFinding & Record<string, unknown>>,
  qaRunHistory: QaRunHistoryEntry[],
  qaActiveWorkflowId: string,
  currentQaWorkflow: (id: string) => QaWorkflowPreset,
  activeProcedureSteps: EvidenceProcedureStep[],
  recordProcedureExecutionEvents: (
    events: ProcedureExecutionEvent[],
    metadata?: Record<string, unknown>
  ) => void,
  runSyntheticQaFlow: (
    request: QaPreset,
    options?: { repoPathOverride?: string | null }
  ) => Promise<QaRunHistoryEntry>,
  setIsFixing: (v: string | null) => void,
  setFixResult: (v: FixFindingsResult | null) => void,
  setFixCompletedAt: (v: string | null) => void,
  setFixProgress: React.Dispatch<React.SetStateAction<string[]>>,
  setError: (v: string | null) => void,
  setPostFixQaRunning: (v: boolean) => void,
  setQaError: (v: string | null) => void,
  fixLogRef: React.RefObject<HTMLDivElement | null>
): Promise<void> {
  const preFixQaRun = qaRunHistory[0] ?? null;
  const currentQaRequest = currentQaWorkflow(qaActiveWorkflowId || 'manual');
  setIsFixing('selected');
  setFixResult(null);
  setFixCompletedAt(null);
  setFixProgress([]);
  setError(null);

  // Listen for streaming progress events
  const unlisten = await setupFixProgressListener(setFixProgress, fixLogRef);

  try {
    const res = await fixFindings(repoPath, fixPacketFindings, result.agent);
    const completedAt = new Date().toISOString();
    setFixResult(res);
    setFixCompletedAt(completedAt);
    void notifyIfEnabled(
      'notify_task_complete',
      false,
      'Fix complete',
      buildFixCompleteMessage(res)
    );
    recordProcedureExecutionEvents(procedureEventsForFixResult(activeProcedureSteps, res), {
      agent: res.agent,
      changedFiles: res.changed_files.length,
      findingsFixed: res.findings_fixed,
      usingWorktree: res.using_worktree ?? null,
    });
    if (preFixQaRun) {
      setPostFixQaRunning(true);
      setQaError(null);
      try {
        await runSyntheticQaFlow(qaRequestFromHistory(preFixQaRun, currentQaRequest), {
          repoPathOverride: res.worktree_path,
        });
      } catch (qaErr) {
        setQaError(
          `Post-fix QA rerun failed: ${qaErr instanceof Error ? qaErr.message : String(qaErr)}`
        );
      } finally {
        setPostFixQaRunning(false);
      }
    }
  } catch (e) {
    setError(`Fix failed: ${String(e)}`);
    void notifyIfEnabled(
      'notify_agent_error',
      true,
      'Fix failed',
      'The AI agent failed while applying the selected fixes.'
    );
  } finally {
    setIsFixing(null);
    unlisten?.();
  }
}

async function setFindingDispositionWithRollback(
  idx: number,
  disposition: FindingDisposition,
  sortedFindings: CliReviewFinding[],
  setResult: (updater: (prev: CliReviewResult | null) => CliReviewResult | null) => void,
  setSelectedFindings: (updater: (prev: Set<number>) => Set<number>) => void,
  setError: (v: string | null) => void
): Promise<void> {
  const target = sortedFindings[idx];
  const findingId = target?.id;
  if (!findingId) return;
  const next: FindingDisposition | null = target.disposition === disposition ? null : disposition;
  // Optimistic local update; matched by persisted id.
  setResult((prev) =>
    prev
      ? {
          ...prev,
          findings: prev.findings.map((finding) =>
            finding.id === findingId ? { ...finding, disposition: next } : finding
          ),
        }
      : prev
  );
  // Drop a dismissed finding from the fix selection so bulk patches skip it;
  // it stays individually selectable afterward.
  if (next === 'dismissed') {
    setSelectedFindings((prev) => {
      if (!prev.has(idx)) return prev;
      const updated = new Set(prev);
      updated.delete(idx);
      return updated;
    });
  }
  try {
    await setFindingDisposition(findingId, next);
  } catch (e) {
    console.error('[CodeVetter] Failed to set finding disposition:', e);
    setError("Couldn't save that finding verdict. Try again.");
    // Roll back the optimistic change.
    setResult((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.map((finding) =>
              finding.id === findingId
                ? { ...finding, disposition: target.disposition ?? null }
                : finding
            ),
          }
        : prev
    );
  }
}

async function copyTimelineSegmentPacket(
  item: VerificationTimelineItem,
  timelineSegmentFindingIndexes: (segmentId: string) => number[],
  sortedFindings: CliReviewFinding[],
  evidenceByFinding: Record<string, FindingEvidence>,
  browserEvidenceByFinding: Record<string, BrowserEvidenceRef>,
  currentTaskContext: TaskContext,
  repoPath: string,
  resultDiffRange: string | undefined,
  diffRange: string,
  resultAgent: string | undefined,
  setSelectedFindings: (v: Set<number>) => void,
  setTimelinePacketCopiedId: (v: string | null) => void
): Promise<void> {
  const indexes = timelineSegmentFindingIndexes(item.id);
  if (indexes.length === 0) return;

  const findings = indexes
    .map((idx) => sortedFindings[idx])
    .filter((finding): finding is CliReviewFinding => Boolean(finding));
  const evidence = mapSelectedEvidence(indexes, sortedFindings, evidenceByFinding);
  const browserEvidence = mapSelectedBrowserEvidence(
    indexes,
    sortedFindings,
    browserEvidenceByFinding
  );

  const sourceLabel = [
    currentTaskContext.sourceLabel,
    `Timeline segment: ${item.label} (${item.status})`,
  ]
    .filter(Boolean)
    .join(' · ');
  const packet = buildAgentFixPacket({
    repoPath,
    diffRange: resultDiffRange || diffRange,
    agent: resultAgent ?? 'claude',
    task: {
      ...currentTaskContext,
      sourceLabel,
    },
    findings,
    evidence,
    browserEvidence,
    timelineReplay: {
      segmentId: item.id,
      label: item.label,
      phase: item.phase,
      status: item.status,
      detail: item.detail,
      jumpKind: item.jump?.kind ?? null,
      jumpPath: item.jump?.path ?? null,
      jumpLine: item.jump?.line ?? null,
      anchors: mapTimelineAnchors(item.anchors ?? []),
    },
  });

  try {
    await navigator.clipboard.writeText(renderAgentFixPacketMarkdown(packet));
    setSelectedFindings(new Set(indexes));
    setTimelinePacketCopiedId(item.id);
    setTimeout(() => setTimelinePacketCopiedId(null), 2000);
  } catch {
    // clipboard unavailable — fail silently
  }
}

async function loadQaWorkflowsFromPrefs(
  qaWorkflowPreferenceKey: string,
  qaPresetPreferenceKey: string,
  setQaWorkflows: (v: QaWorkflowPreset[]) => void,
  setQaActiveWorkflowId: (v: string) => void,
  applyQaWorkflow: (workflow: Partial<QaWorkflowPreset>) => void,
  setQaPreferenceLoadedKey: (v: string) => void,
  setQaPresetLoaded: (v: boolean) => void
): Promise<void> {
  try {
    const [scopedWorkflowsRaw, globalWorkflowsRaw, scopedPresetRaw, legacyRaw] = await Promise.all([
      getPreference(qaWorkflowPreferenceKey),
      getPreference('quick_review_qa_workflows'),
      getPreference(qaPresetPreferenceKey),
      getPreference('quick_review_qa_preset'),
    ]);

    const workflowsRaw = scopedWorkflowsRaw || globalWorkflowsRaw;
    if (workflowsRaw) {
      const workflows = JSON.parse(workflowsRaw) as QaWorkflowPreset[];
      if (Array.isArray(workflows) && workflows.length > 0) {
        setQaWorkflows(workflows);
        setQaActiveWorkflowId(workflows[0].id);
        applyQaWorkflow(workflows[0]);
        return;
      }
    }

    const presetRaw = scopedPresetRaw || legacyRaw;
    if (presetRaw) {
      const legacy = JSON.parse(presetRaw) as Partial<QaPreset>;
      setQaWorkflows([]);
      setQaActiveWorkflowId('');
      applyQaWorkflow({ ...legacy, name: CODEVETTER_REVIEW_SHELL.label });
      return;
    }
    setQaWorkflows([]);
    setQaActiveWorkflowId('');
  } catch {
    // Keep defaults if local preferences are unavailable or malformed.
  } finally {
    setQaPreferenceLoadedKey(qaWorkflowPreferenceKey);
    setQaPresetLoaded(true);
  }
}

async function copyReviewerProof(
  result: CliReviewResult,
  sortedFindings: CliReviewFinding[],
  selectedFindingIdx: number | null,
  evidenceByFinding: Record<string, FindingEvidence>,
  evidenceCounts: { reproduced: number; fixed: number; notReproduced: number },
  evidenceCandidateStatuses: Record<string, EvidenceCandidateStatus>,
  reviewTimeline: VerificationTimelineItem[],
  qaPostFixComparison: ReturnType<typeof buildQaPostFixComparison>,
  historyExplanations: ReturnType<typeof buildCodebaseHistoryExplanations>,
  historyContext: RepoHistoryContext | null,
  procedureExecutionEvents: ProcedureExecutionEvent[],
  intentReport: ReturnType<typeof buildReviewIntentReport> | null,
  historyFindingSummaries: Map<number, HistoryFindingSummary>,
  audienceBundle: AudienceValidationBundle | null,
  setProofCopied: (v: boolean) => void
): Promise<void> {
  const evidence = sortedFindings.map((finding, idx) => ({
    ...defaultFindingEvidence,
    ...evidenceByFinding[findingEvidenceKey(finding, idx)],
  }));
  const activeFindingForProof =
    selectedFindingIdx !== null ? sortedFindings[selectedFindingIdx] : null;
  const focusedReviewMemoryGraph = buildFocusedReviewMemoryGraph(
    result.review_memory_graph,
    activeFindingForProof
  );
  const reviewerProof = buildReviewerProofMarkdown({
    diffRange: result.diff_range,
    score: result.score,
    agent: result.agent,
    findings: sortedFindings,
    evidence,
    evidenceCounts,
    evidenceCandidates: result.evidence_candidates,
    evidenceCandidateStatuses,
    evidenceProcedureSteps: result.evidence_procedure_steps,
    reviewMemoryGraph: result.review_memory_graph,
    focusedReviewMemoryGraph,
    trustedGraphContext: result.trusted_graph_context,
    verificationTimeline: reviewTimeline,
    qaPostFixComparison,
    historyExplanations,
    temporalHistory: historyContext?.temporal_slice,
    procedureExecutionEvents,
    intentReport,
    historyFindingSummaries,
  });
  const markdown = audienceBundle
    ? `${reviewerProof}\n\n${renderAudienceValidationProof(audienceBundle)}`
    : reviewerProof;

  try {
    await navigator.clipboard.writeText(markdown);
    setProofCopied(true);
    setTimeout(() => setProofCopied(false), 2000);
  } catch {
    // clipboard unavailable — fail silently
  }
}

function buildIntentReport(
  result: CliReviewResult,
  diffRange: string,
  changeDesc: string,
  sortedFindings: CliReviewFinding[],
  evidenceByFinding: Record<string, FindingEvidence>,
  historyContext: RepoHistoryContext | null,
  qaRunHistory: QaRunHistoryEntry[],
  fixResult: FixFindingsResult | null,
  blastReport: BlastRadiusReport | null
) {
  return buildReviewIntentReport({
    reviewId: result.review_id,
    diffRange: result.diff_range || diffRange,
    changeDescription: changeDesc,
    findings: sortedFindings.map((finding) => ({
      severity: finding.severity,
      title: finding.title,
      filePath: finding.filePath,
    })),
    evidence: sortedFindings.map((finding, idx) => ({
      ...defaultFindingEvidence,
      ...evidenceByFinding[findingEvidenceKey(finding, idx)],
    })),
    history: historyContext ? buildIntentReportHistory(historyContext) : null,
    qaRuns: qaRunHistory,
    fix: fixResult
      ? {
          changedFiles: fixResult.changed_files.length,
          findingsFixed: fixResult.findings_fixed,
        }
      : null,
    reviewMode: result.review_mode,
    riskTier: result.risk_tier,
    changedLines: result.changed_lines,
    sensitivePaths: result.sensitive_paths,
    blast: blastReport
      ? {
          totalCallers: blastReport.totalCallers,
          totalSymbols: blastReport.totalSymbols,
          changedFiles: blastReport.changedFiles,
        }
      : null,
  });
}

function parseJsonOrDefault<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function loadReviewEvidence(
  reviewId: string,
  setEvidenceByFinding: (v: Record<string, FindingEvidence>) => void,
  setBrowserEvidenceByFinding: (v: Record<string, BrowserEvidenceRef>) => void,
  setEvidenceCandidateStatuses: (v: Record<string, EvidenceCandidateStatus>) => void,
  setStoredProcedureEvents: (v: ReviewProcedureEvent[]) => void
): Promise<void> {
  if (!reviewId) {
    setEvidenceByFinding({});
    setBrowserEvidenceByFinding({});
    setEvidenceCandidateStatuses({});
    setStoredProcedureEvents([]);
    return;
  }
  const [raw, browserRaw, candidateRaw] = await Promise.all([
    getPreference(`quick_review_evidence_${reviewId}`),
    getPreference(`quick_review_browser_evidence_${reviewId}`),
    getPreference(`quick_review_candidate_statuses_${reviewId}`),
  ]);
  setEvidenceByFinding(parseJsonOrDefault(raw, {}));
  setBrowserEvidenceByFinding(parseJsonOrDefault(browserRaw, {}));
  setEvidenceCandidateStatuses(parseJsonOrDefault(candidateRaw, {}));
}

function sortFindingsBySeverity(findings: CliReviewFinding[]): CliReviewFinding[] {
  return [...findings].sort(
    (a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
  );
}

function countFindingsBySeverity(findings: CliReviewFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
}

function groupUncheckedBySeverity(
  uncheckedFindings: CliReviewFinding[]
): Array<[string, CliReviewFinding[]]> {
  const buckets = new Map<string, CliReviewFinding[]>();
  for (const finding of uncheckedFindings) {
    const arr = buckets.get(finding.severity) ?? [];
    arr.push(finding);
    buckets.set(finding.severity, arr);
  }
  return Array.from(buckets.entries()).sort(
    ([a], [b]) => (severityOrder[a] ?? 99) - (severityOrder[b] ?? 99)
  );
}

function mapSelectedEvidence(
  indexes: number[],
  sortedFindings: CliReviewFinding[],
  evidenceByFinding: Record<string, FindingEvidence>
): FindingEvidence[] {
  return indexes.map((idx) => {
    const finding = sortedFindings[idx];
    return finding
      ? {
          ...defaultFindingEvidence,
          ...evidenceByFinding[findingEvidenceKey(finding, idx)],
        }
      : defaultFindingEvidence;
  });
}

function mapSelectedBrowserEvidence(
  indexes: number[],
  sortedFindings: CliReviewFinding[],
  browserEvidenceByFinding: Record<string, BrowserEvidenceRef>
): BrowserEvidenceRef[] {
  return indexes.map((idx) => {
    const finding = sortedFindings[idx];
    return finding
      ? {
          ...emptyBrowserEvidence(),
          ...browserEvidenceByFinding[findingEvidenceKey(finding, idx)],
        }
      : emptyBrowserEvidence();
  });
}

function computeEvidenceCounts(evidenceByFinding: Record<string, FindingEvidence>): {
  reproduced: number;
  fixed: number;
  notReproduced: number;
} {
  return Object.values(evidenceByFinding).reduce(
    (acc, evidence) => {
      if (evidence.status === 'reproduced') acc.reproduced += 1;
      if (evidence.status === 'fixed') acc.fixed += 1;
      if (evidence.status === 'not_reproduced') acc.notReproduced += 1;
      return acc;
    },
    { reproduced: 0, fixed: 0, notReproduced: 0 }
  );
}

function mapTimelineAnchors(anchors: NonNullable<VerificationTimelineItem['anchors']>) {
  return (anchors ?? []).slice(0, 4).map((anchor) => ({
    label: anchor.label,
    source: anchor.source,
    status: anchor.status,
    contextExcerpt: anchor.contextExcerpt?.slice(0, 2) ?? [],
    conversationContext: anchor.conversationContext,
    sourcePath: anchor.sourcePath ?? null,
    sourceLine: anchor.sourceLine ?? null,
    eventId: anchor.eventId ?? null,
    sessionId: anchor.sessionId ?? null,
    artifact: anchor.artifact ?? null,
    jumpKind: anchor.jump?.kind ?? null,
    jumpPath: anchor.jump?.path ?? null,
  }));
}

function buildReviewTimeline(
  reviewId: string,
  result: CliReviewResult | null,
  sortedFindings: CliReviewFinding[],
  selectedFindingIdx: number | null,
  taskGoal: string,
  isReviewing: boolean,
  qaRunning: boolean,
  postFixQaRunning: boolean,
  qaRunHistory: QaRunHistoryEntry[],
  qaPostFixComparison: ReturnType<typeof buildQaPostFixComparison>,
  evidenceCounts: { reproduced: number; fixed: number; notReproduced: number },
  fixPacket: { findings: unknown[]; routeAdvice: string },
  selectedFindingIndexes: number[],
  isFixing: string | null,
  fixResult: FixFindingsResult | null,
  historyContext: RepoHistoryContext | null,
  warmVerificationProjections: WarmVerificationProjection[],
  differentialTimelineHistory: VerificationTimelineItem[]
): VerificationTimelineItem[] {
  const timeline = buildVerificationTimeline({
    runId: reviewId || result?.review_id || null,
    taskGoal,
    review: result
      ? {
          findingsCount: sortedFindings.length,
          mode: result.review_mode,
          riskTier: result.risk_tier,
          selectedFindingIndex: selectedFindingIdx,
          firstFindingPath: sortedFindings[0]?.filePath ?? null,
          firstFindingLine: sortedFindings[0]?.line ?? null,
          findingPaths: sortedFindings.flatMap((finding) =>
            finding.filePath ? [finding.filePath] : []
          ),
        }
      : null,
    isReviewing,
    qa: {
      running: qaRunning || postFixQaRunning,
      latest: qaRunHistory[0] ?? null,
      comparison: qaPostFixComparison,
    },
    evidenceCounts,
    fixPacket: {
      selectedFindings: fixPacket.findings.length,
      routeAdvice: fixPacket.routeAdvice,
      selectedFindingIndex: selectedFindingIndexes[0] ?? null,
    },
    isFixing: Boolean(isFixing),
    fixResult: fixResult
      ? {
          success: fixResult.success,
          agent: fixResult.agent,
          usingWorktree: fixResult.using_worktree,
          worktreePath: fixResult.worktree_path ?? null,
          changedFiles: fixResult.changed_files.length,
          changedFileOrigins: fixResult.changed_files,
          findingsFixed: fixResult.findings_fixed,
        }
      : null,
    history: historyContext,
  });
  return [
    ...timeline,
    ...warmVerificationProjections.map((projection) => ({
      ...projection.timelineProof,
      label: 'Warm verification history',
      detail: `recorded ${projection.provenance.finished_at} · ${projection.timelineProof.detail}`,
      status: 'idle' as const,
    })),
    ...differentialTimelineHistory,
  ];
}

function computeHistoryFileSummaries(ctx: RepoHistoryContext): Array<{
  file: string;
  commits: number;
  decisions: number;
  agents: number;
  recurring: number;
}> {
  const summaries = new Map<
    string,
    { commits: number; decisions: number; agents: number; recurring: number }
  >();
  const ensure = (file: string) => {
    const existing = summaries.get(file);
    if (existing) return existing;
    const next = { commits: 0, decisions: 0, agents: 0, recurring: 0 };
    summaries.set(file, next);
    return next;
  };

  for (const file of ctx.files_analyzed) ensure(file);
  for (const commit of ctx.recent_commits) ensure(commit.file).commits += 1;
  for (const decision of ctx.prior_decisions ?? []) {
    ensure(decision.file).decisions += 1;
  }
  for (const recurring of ctx.recurring_failures) {
    ensure(recurring.file).recurring += recurring.count;
  }
  for (const activity of ctx.prior_agent_activity) {
    for (const file of activity.files ?? []) {
      ensure(file).agents += 1;
    }
  }

  return Array.from(summaries.entries())
    .map(([file, counts]) => ({ file, ...counts }))
    .filter(
      (summary) => summary.commits + summary.decisions + summary.agents + summary.recurring > 0
    )
    .sort(
      (a, b) =>
        b.decisions +
        b.recurring +
        b.agents +
        b.commits -
        (a.decisions + a.recurring + a.agents + a.commits)
    )
    .slice(0, 5);
}

function computeHistoryFindingSummaries(
  ctx: RepoHistoryContext,
  sortedFindings: CliReviewFinding[]
): Map<number, HistoryFindingSummary> {
  const map = new Map<number, HistoryFindingSummary>();
  sortedFindings.forEach((finding, findingIdx) => {
    const file = finding.filePath;
    if (!file) return;

    const commits = ctx.recent_commits.filter((commit) => sameHistoryFile(commit.file, file));
    const decisions = (ctx.prior_decisions ?? []).filter((decision) =>
      sameHistoryFile(decision.file, file)
    );
    const recurring = ctx.recurring_failures.filter((failure) =>
      sameHistoryFile(failure.file, file)
    );
    const commands = ctx.command_signals ?? [];
    const claims = ctx.agent_claims ?? [];
    const signalCount =
      commits.length + decisions.length + recurring.length + commands.length + claims.length;
    if (signalCount === 0) return;

    map.set(findingIdx, {
      findingIdx,
      file,
      commits: commits.length,
      decisions: decisions.length,
      recurring: recurring.reduce((sum, item) => sum + item.count, 0),
      commands: commands.length,
      claims: claims.length,
      topDecision: decisions[0]?.text,
      topCommit: commits[0]?.subject,
      topClaim: claims[0]?.claim,
      topCommands: commands.slice(0, 2).map(formatHistoryCommandEvidence),
    });
  });
  return map;
}

function buildCliReviewResultFromStored(
  review: LocalReviewRow,
  findings: CliReviewFinding[],
  reviewManifest: ReviewManifest,
  reviewReadiness?: CliReviewResult['review_readiness']
): CliReviewResult {
  return {
    review_id: review.id,
    score: review.score_composite ?? 0,
    findings,
    summary: review.summary_markdown ?? '',
    agent: review.agent_used ?? 'claude',
    duration_ms: 0,
    diff_range: diffRangeFromSourceLabel(review.source_label),
    findings_count: findings.length,
    review_manifest: reviewManifest,
    review_readiness: reviewReadiness,
  };
}

function mapStoredFindings(raw: LocalReviewFindingRow[]): CliReviewFinding[] {
  return (raw ?? []).map((f) => ({
    id: f.id,
    severity: f.severity ?? 'info',
    title: f.title ?? '',
    summary: f.summary ?? '',
    suggestion: f.suggestion ?? undefined,
    filePath: f.file_path ?? undefined,
    line: f.line ?? undefined,
    confidence: f.confidence ?? undefined,
    discovery_method: (f.discovery_method as 'inspection' | 'execution' | null) ?? undefined,
    disposition: f.disposition,
  }));
}

function extractDeepGraphBaseRef(diffRange: string): string | null {
  if (diffRange.includes('...')) return diffRange.split('...')[0];
  if (diffRange.includes('..')) return diffRange.split('..')[0];
  return null;
}

function buildReviewCompleteMessage(res: CliReviewResult, diffRange: string): string {
  const count = res.findings_count ?? res.findings.length;
  return `${count} finding${count === 1 ? '' : 's'} · score ${Math.round(res.score)}/100 · ${res.diff_range || diffRange}`;
}

function describeReviewError(msg: string): string {
  if (msg.includes('TAURI_NOT_AVAILABLE')) {
    return 'Not running in Tauri — run inside the desktop app to start a review.';
  }
  return "The review couldn't finish. The AI agent may have failed or timed out — check the agent is installed and try again.";
}

function ResultHeader({
  result,
  diffRange,
  projectName,
  repoPath,
  sortedFindings,
  evidenceCounts,
  handleNewReview,
}: {
  result: CliReviewResult;
  diffRange: string;
  projectName: string;
  repoPath: string;
  sortedFindings: CliReviewFinding[];
  evidenceCounts: { reproduced: number; fixed: number };
  handleNewReview: () => void;
}) {
  const source = result.diff_range || diffRange || 'local diff';
  const compactSource = source.length > 34 ? `${source.slice(0, 13)}…${source.slice(-12)}` : source;
  const findingCount = result.findings_count ?? sortedFindings.length;

  return (
    <header className="mb-3 flex min-h-[68px] shrink-0 items-center gap-3 border-b border-[var(--cv-line)] px-1 py-2.5">
      <Button
        variant="ghost"
        size="sm"
        className="h-10 shrink-0 gap-1 px-2 text-[var(--cv-text-muted)] hover:bg-white/[0.04] hover:text-slate-100"
        onClick={handleNewReview}
      >
        <ArrowLeft size={14} />
        Back
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--cv-line)] bg-white/[0.035] text-amber-200">
          <FolderGit2 size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0 max-w-[38%]">
          <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-slate-100">
            {projectName}
          </div>
          <div
            className="mt-0.5 truncate font-mono text-[11px] text-[var(--cv-text-muted)]"
            title={repoPath}
          >
            {repoPath || 'Repository path unavailable'}
          </div>
        </div>
        <div className="h-8 w-px shrink-0 bg-[var(--cv-line)]" aria-hidden="true" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-200">Change review</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--cv-text-muted)]">
            <span className="min-w-0 truncate font-mono" title={source}>
              {compactSource}
            </span>
            <span className="shrink-0">· {result.agent}</span>
            {result.risk_tier && <span className="shrink-0">· {result.risk_tier}</span>}
          </div>
        </div>
      </div>
      <div className="flex h-8 items-center gap-4 border-l border-[var(--cv-line)] pl-4">
        <div className="text-right">
          <div className="text-[12px] font-medium tabular-nums text-slate-200">
            {evidenceCounts.reproduced + evidenceCounts.fixed}
          </div>
          <div className="text-[11px] text-[var(--cv-text-muted)]">verified</div>
        </div>
        <div className="text-right">
          <div className="text-[12px] font-medium tabular-nums text-slate-200">{findingCount}</div>
          <div className="text-[11px] text-[var(--cv-text-muted)]">
            {findingCount === 1 ? 'finding' : 'findings'}
          </div>
        </div>
        <div
          className="hidden text-right lg:block"
          title="Model review score; executable evidence determines confidence"
        >
          <div className="text-[12px] font-medium tabular-nums text-[var(--cv-text-muted)]">
            {Math.round(result.score)}
          </div>
          <div className="text-[11px] text-[var(--cv-text-muted)]">model score</div>
        </div>
      </div>
    </header>
  );
}

function FixFooter({
  selectableFindingCount,
  selectedFindings,
  isFixing,
  viewHasRepoPath,
  toggleSelectAll,
  handleFixSelected,
}: {
  selectableFindingCount: number;
  selectedFindings: Set<number>;
  isFixing: string | null;
  viewHasRepoPath: boolean;
  toggleSelectAll: () => void;
  handleFixSelected: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-[var(--cv-line)] bg-[var(--cv-canvas)] p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSelectAll}
          title="Select all findings for fix (dismissed excluded)"
          aria-pressed={
            selectableFindingCount > 0 && selectedFindings.size >= selectableFindingCount
          }
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
        >
          {selectableFindingCount > 0 && selectedFindings.size >= selectableFindingCount ? (
            <CheckSquare2 size={14} className="text-[var(--cv-accent)]" />
          ) : (
            <Square size={14} />
          )}
          All
        </button>
        <div className="relative ml-auto group">
          <Button
            size="sm"
            onClick={handleFixSelected}
            disabled={isFixing !== null || selectedFindings.size === 0 || !viewHasRepoPath}
            aria-describedby={!viewHasRepoPath ? 'review-fix-disabled-reason' : undefined}
            className="gap-1.5 bg-white text-xs text-black hover:bg-slate-200 disabled:opacity-50"
          >
            {isFixing === 'selected' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Zap size={14} />
            )}
            {isFixing === 'selected'
              ? 'Fixing...'
              : `Fix${selectedFindings.size > 0 ? ` (${selectedFindings.size})` : ''}`}
          </Button>
          {!viewHasRepoPath && (
            <>
              <span id="review-fix-disabled-reason" className="sr-only">
                No repository path is available, so fixes cannot be applied.
              </span>
              <div
                aria-hidden="true"
                className="absolute bottom-full right-0 mb-1.5 hidden whitespace-nowrap border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1 text-[10px] text-slate-400 shadow-lg group-hover:block"
              >
                No repo path — can't apply fixes
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewReceipt({
  reviewManifest,
  coverageCounts,
  readiness,
}: {
  reviewManifest: NonNullable<CliReviewResult['review_manifest']>;
  coverageCounts: Record<string, number> | null;
  readiness?: CliReviewResult['review_readiness'];
}) {
  const mcpCallCount = readiness?.codevetter_mcp_call_count ?? 0;
  const contextDelivery = readiness?.context_delivery ?? 'internal';
  const legacy = 'coverage_kind' in reviewManifest;
  const coverageComplete = !legacy && reviewManifest.complete_coverage;
  const ready = readiness?.status === 'ready';
  const reviewed = (coverageCounts?.reviewed ?? 0) + (coverageCounts?.reused ?? 0);
  const healthy = coverageComplete && (readiness == null || ready);

  return (
    <div
      className={cn(
        'mb-3 grid shrink-0 gap-2 border-y px-1 py-3 text-xs lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-5',
        healthy ? 'border-white/[0.08]' : 'border-amber-400/20'
      )}
      data-testid="review-coverage"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheck
            size={15}
            className={cn('shrink-0', healthy ? 'text-emerald-300' : 'text-amber-300')}
            aria-hidden="true"
          />
          <span className={cn('font-medium', healthy ? 'text-slate-100' : 'text-amber-100')}>
            {legacy
              ? 'Coverage unknown'
              : ready || readiness == null
                ? coverageComplete
                  ? 'Review context ready'
                  : 'Partial review context'
                : 'Review incomplete — do not treat as a full verdict'}
          </span>
          <span className="hidden text-slate-700 sm:inline">·</span>
          <span className="hidden truncate text-[var(--cv-text-muted)] sm:inline">
            {legacy
              ? reviewManifest.limitation
              : `${reviewed} file${reviewed === 1 ? '' : 's'} inspected${coverageCounts?.reused ? `, ${coverageCounts.reused} reused` : ''}`}
          </span>
        </div>
        <div className="mt-1 pl-[23px] text-[11px] text-[var(--cv-text-muted)] sm:hidden">
          {legacy ? 'Legacy review' : `${reviewed} file${reviewed === 1 ? '' : 's'} inspected`}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-[23px] font-mono text-[11px] text-[var(--cv-text-muted)] lg:justify-end lg:pl-0">
        {legacy ? (
          <span>Legacy review</span>
        ) : (
          <>
            <span>{coverageComplete ? 'Complete coverage' : 'Partial coverage'}</span>
            {readiness && (
              <span data-testid="review-readiness">
                graph {readiness.graph_status} · history {readiness.history_status}
              </span>
            )}
            {readiness && (
              <span>
                {readiness.runtime_evidence_count} runtime record
                {readiness.runtime_evidence_count === 1 ? '' : 's'}
              </span>
            )}
            <span>CodeVetter MCP {mcpCallCount} calls</span>
            <span>{contextDelivery}</span>
          </>
        )}
      </div>
      {!legacy &&
        ((coverageCounts?.skipped ?? 0) > 0 ||
          (coverageCounts?.failed ?? 0) > 0 ||
          (coverageCounts?.cancelled ?? 0) > 0 ||
          reviewManifest.stale ||
          (readiness != null && !ready)) && (
          <div className="text-[11px] text-amber-200/80 lg:col-span-2">
            {[
              coverageCounts?.skipped ? `${coverageCounts.skipped} policy-skipped` : null,
              coverageCounts?.failed ? `${coverageCounts.failed} failed` : null,
              coverageCounts?.cancelled ? `${coverageCounts.cancelled} cancelled` : null,
              reviewManifest.stale ? 'target changed during review' : null,
              ...(readiness?.limitations ?? []),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      {!legacy && reviewManifest.qualification_counts.rejected > 0 && (
        <span className="sr-only">
          {reviewManifest.qualification_counts.rejected} rejected ·{' '}
          {reviewManifest.qualification_counts.unresolved} unresolved ·{' '}
          {reviewManifest.qualification_counts.stale} stale
        </span>
      )}
    </div>
  );
}

function buildFixCompleteMessage(res: FixFindingsResult): string {
  return `${res.findings_fixed} finding${res.findings_fixed === 1 ? '' : 's'} fixed across ${res.changed_files.length} file${res.changed_files.length === 1 ? '' : 's'}.`;
}

async function setupFixProgressListener(
  setFixProgress: (updater: (prev: string[]) => string[]) => void,
  fixLogRef: React.RefObject<HTMLDivElement | null>
): Promise<(() => void) | undefined> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<string>('fix-progress', (event) => {
      setFixProgress((prev) => {
        const next = [...prev, event.payload];
        return next.length > 50 ? next.slice(-50) : next;
      });
      if (fixLogRef.current) {
        fixLogRef.current.scrollTop = fixLogRef.current.scrollHeight;
      }
    });
  } catch {
    return undefined;
  }
}

function buildQaRunHistoryEntry(request: QaPreset, run: SyntheticQaRunResult): QaRunHistoryEntry {
  return {
    createdAt: new Date().toISOString(),
    loopId: run.loop_id,
    runnerType: run.runner_type ?? request.runnerType,
    baseUrl: request.baseUrl,
    goal: run.goal || request.goal,
    route: run.route || request.targetRoute,
    authMode: request.authMode,
    pass: run.pass,
    durationMs: run.duration_ms,
    notes: run.notes,
    screenshotPath: run.screenshot_path,
    artifacts: run.artifacts ?? [],
    consoleErrors: run.trace?.console_errors?.length ?? 0,
    externalCommand: request.externalCommand,
    repoSpecPath: request.repoSpecPath,
    repoTraceMode: request.repoTraceMode,
    storageStatePath: request.storageStatePath,
    allowRemoteTarget: request.allowRemoteTarget,
  };
}

async function handleTimelineFileJump(
  jump: VerificationTimelineJumpTarget,
  repoPath: string | null,
  setSelectedFindingIdx: (v: number | null) => void,
  setCodeLines: (v: FileLineData[]) => void,
  setCodeFilePath: (v: string) => void,
  setCodeLanguage: (v: string) => void,
  isCurrentRequest: () => boolean
): Promise<void> {
  if (!jump.path) return;
  setSelectedFindingIdx(null);
  const targetPath =
    jump.path.startsWith('/') || !repoPath ? jump.path : `${repoPath}/${jump.path}`;
  try {
    const res = await readFileAroundLine(targetPath, Math.max(1, jump.line ?? 1), 15, 15);
    if (!isCurrentRequest()) return;
    setCodeLines(res.lines);
    setCodeFilePath(res.file_path);
    setCodeLanguage(res.language);
  } catch (e) {
    if (!isCurrentRequest()) return;
    console.error('[Review] failed to load timeline file:', e);
    setCodeLines([]);
    setCodeFilePath(jump.path);
    setCodeLanguage('');
  }
}

async function handleTimelineArtifactJump(
  jump: VerificationTimelineJumpTarget,
  handlePreviewQaArtifact: (path: string) => Promise<void>,
  handleOpenQaArtifact: (path: string) => Promise<void>
): Promise<void> {
  if (!jump.path) return;
  if (canPreviewQaArtifact(jump.path)) {
    await handlePreviewQaArtifact(jump.path);
  } else {
    await handleOpenQaArtifact(jump.path);
  }
}

async function handleTimelineCommandSourceJump(
  jump: VerificationTimelineJumpTarget,
  setError: (v: string | null) => void,
  setCommandSourcePreviewLoading: (v: string | null) => void,
  setCommandSourcePreview: (
    v: {
      key: string;
      path: string;
      line: number;
      language: string;
      items?: RawSessionContextItem[];
      lines?: FileLineData[];
    } | null
  ) => void
): Promise<void> {
  if (!jump.path) return;
  if (!isTauriAvailable()) {
    setError('Previewing command sources requires the CodeVetter desktop app (Tauri).');
    return;
  }
  const key = `timeline:${jump.path}:${jump.line ?? 1}`;
  const line = Math.max(1, jump.line ?? 1);
  setCommandSourcePreviewLoading(key);
  setError(null);
  try {
    if (jump.source === 'raw_session') {
      const preview = await readRawSessionContext(jump.path, line, 8, 12);
      setCommandSourcePreview({
        key,
        path: preview.file_path,
        line: preview.target_line,
        language: 'transcript',
        items: preview.items,
      });
    } else {
      const preview = await readFileAroundLine(jump.path, line, 2, 2);
      setCommandSourcePreview({
        key,
        path: preview.file_path,
        line: preview.target_line,
        language: preview.language,
        lines: preview.lines,
      });
    }
  } catch (err) {
    setCommandSourcePreview(null);
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setCommandSourcePreviewLoading(null);
  }
}

function buildVerificationCommandNotes(
  existingNotes: string,
  command: string,
  run: {
    passed: boolean;
    canceled: boolean;
    timed_out: boolean;
    duration_ms: number;
    exit_code: number | null;
    artifact: string | null;
    stderr_tail: string;
  }
): string {
  return [
    existingNotes.trim(),
    '',
    `Command: ${command}`,
    `Result: ${
      run.passed ? 'PASS' : run.canceled ? 'CANCELED' : run.timed_out ? 'TIMEOUT' : 'FAIL'
    } (${run.duration_ms}ms, exit ${run.exit_code})`,
    `Artifact: ${run.artifact}`,
    run.stderr_tail.trim() ? `stderr:\n${run.stderr_tail.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function runReviewQualification(
  stateName: string,
  reviewId: string,
  handleLoadPastReview: (id: string) => Promise<void>
): Promise<void> {
  await handleLoadPastReview(reviewId);
  await nextPaint();
  const expectedDecision =
    stateName === 'review-partial-ready'
      ? 'Hold'
      : stateName === 'review-completed-ready'
        ? 'Ship candidate'
        : undefined;
  const summary = await waitForDecisionSummary(expectedDecision);
  await nextPaint();
  if (stateName === 'review-keyboard-focused') {
    const target = summary.querySelector<HTMLAnchorElement>('a[href="/trex"]');
    target?.focus();
    await nextPaint();
    if (!target || document.activeElement !== target) {
      throw new Error('Native Review focus target was unavailable');
    }
  }
  if (stateName === 'review-reduced-motion') {
    document.documentElement.classList.add('cv-verify-reduced-motion');
    await nextPaint();
  }

  const host = window as unknown as VerificationWindow;
  const runtimeErrorCount = host.__CODEVETTER_VERIFY_RUNTIME_ERRORS__?.length ?? 0;
  const horizontalOverflow =
    document.documentElement.scrollWidth > document.documentElement.clientWidth;
  if (runtimeErrorCount > 0) throw new Error('Native Review emitted a runtime error');
  if (horizontalOverflow) throw new Error('Native Review has document-level overflow');

  host.__CODEVETTER_VERIFY_REPORT__ = {
    stateName,
    reviewId,
    runtimeErrorCount,
    horizontalOverflow,
    activeElementText: document.activeElement?.textContent?.trim().slice(0, 80) ?? '',
    reducedMotionForced: document.documentElement.classList.contains('cv-verify-reduced-motion'),
  };
  const readyTitle = `CodeVetter · ${stateName} · ready`;
  document.title = readyTitle;
  await setCurrentWindowTitle(readyTitle);
}

function applyQaWorkflowPreset(
  workflow: Partial<QaWorkflowPreset>,
  setters: QaWorkflowSetters
): void {
  if (workflow.baseUrl) setters.setQaBaseUrl(workflow.baseUrl);
  if (workflow.loopId) setters.setQaLoopId(workflow.loopId);
  if (
    workflow.runnerType === 'playwright_builtin' ||
    workflow.runnerType === 'external_skill' ||
    workflow.runnerType === 'repo_playwright'
  ) {
    setters.setQaRunnerType(workflow.runnerType);
  }
  if (workflow.goal) setters.setQaGoal(workflow.goal);
  if (typeof workflow.targetRoute === 'string') {
    setters.setQaTargetRoute(workflow.targetRoute || CODEVETTER_REVIEW_SHELL.route);
  }
  if (typeof workflow.externalCommand === 'string') {
    setters.setQaExternalCommand(workflow.externalCommand);
  }
  if (typeof workflow.repoSpecPath === 'string') {
    setters.setQaRepoSpecPath(workflow.repoSpecPath);
  }
  if (
    workflow.repoTraceMode === 'off' ||
    workflow.repoTraceMode === 'retain-on-failure' ||
    workflow.repoTraceMode === 'on'
  ) {
    setters.setQaRepoTraceMode(workflow.repoTraceMode);
  }
  if (workflow.authMode === 'none' || workflow.authMode === 'storage_state') {
    setters.setQaAuthMode(workflow.authMode);
  }
  if (typeof workflow.storageStatePath === 'string') {
    setters.setQaStorageStatePath(workflow.storageStatePath);
  }
  if (typeof workflow.allowRemoteTarget === 'boolean') {
    setters.setQaAllowRemoteTarget(workflow.allowRemoteTarget);
  }
  if (Array.isArray(workflow.targets)) {
    setters.setQaTargets(workflow.targets);
    const firstTarget = workflow.targets[0];
    if (firstTarget) {
      setters.setQaActiveTargetId(firstTarget.id);
      setters.setQaTargetName(firstTarget.name);
      setters.setQaTargetRoute(firstTarget.route);
      setters.setQaGoal(firstTarget.goal);
    } else {
      setters.setQaActiveTargetId('');
    }
  }
  if (workflow.name) setters.setQaWorkflowName(workflow.name);
}

function buildIntentReportHistory(ctx: RepoHistoryContext): {
  recentCommits: number;
  priorDecisions: number;
  priorAgentRuns: number;
  recurringFailures: number;
  commands: number;
  claims: number;
  commandStatus: { passed: number; failed: number; stale: number; unknown: number };
  commandArtifacts: number;
  rawSessionCommands: number;
  structuredCommands: number;
  latestCommand: string | null;
  latestClaim: string | null;
} {
  const signals = ctx.command_signals ?? [];
  return {
    recentCommits: ctx.recent_commits.length,
    priorDecisions: ctx.prior_decisions?.length ?? 0,
    priorAgentRuns: ctx.prior_agent_activity.length,
    recurringFailures: ctx.recurring_failures.length,
    commands: signals.length,
    claims: ctx.agent_claims?.length ?? 0,
    commandStatus: {
      passed: signals.filter((signal) => signal.status === 'passed').length,
      failed: signals.filter((signal) => signal.status === 'failed').length,
      stale: signals.filter((signal) => signal.status === 'stale').length,
      unknown: signals.filter((signal) => signal.status == null || signal.status === 'unknown')
        .length,
    },
    commandArtifacts: signals.reduce((sum, signal) => sum + (signal.artifacts?.length ?? 0), 0),
    rawSessionCommands: signals.filter((signal) => signal.source === 'raw_session').length,
    structuredCommands: signals.filter((signal) => signal.source === 'output_structured').length,
    latestCommand: signals[0]?.command ?? null,
    latestClaim: ctx.agent_claims?.[0]?.claim ?? null,
  };
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForDecisionSummary(expectedText?: string): Promise<HTMLElement> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const summary = document.querySelector<HTMLElement>(
      '[data-testid="verification-decision-summary"]'
    );
    if (summary && (!expectedText || summary.textContent?.includes(expectedText))) {
      return summary;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(
    expectedText
      ? `Verification decision summary did not render ${expectedText}`
      : 'Verification decision summary did not render'
  );
}

/**
 * Fire a desktop notification if the matching Settings toggle is enabled.
 * `defaultOn` mirrors the toggle's default so an unset preference behaves like
 * the Settings UI. Best-effort: never throws into the calling flow.
 */
async function notifyIfEnabled(
  prefKey: string,
  defaultOn: boolean,
  title: string,
  body: string
): Promise<void> {
  try {
    const raw = await getPreference(prefKey);
    const enabled = raw == null ? defaultOn : raw === 'true';
    if (enabled) await sendTrayNotification(title, body);
  } catch {
    // Notifications are best-effort; ignore permission/plugin failures.
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickReview() {
  const {
    selectedRepoPath,
    selectedProject,
    selectProject,
    ready: workspaceReady,
  } = useProjectWorkspace();
  const repoPath = selectedRepoPath ?? '';
  const reviewQualificationRequest = useMemo(
    () => (import.meta.env.DEV ? getReviewQualificationRequest() : null),
    []
  );
  const reviewQualificationStarted = useRef(false);
  // Mode: "create" shows the form, "view" shows past review results
  const [mode, setMode] = useState<'create' | 'view'>('create');
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [activeTab, setActiveTab] = useState<'branches' | 'prs'>('branches');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [projectDesc, setProjectDesc] = useState('');
  const [changeDesc, setChangeDesc] = useState('');
  const [taskGoal, setTaskGoal] = useState('');
  const [taskAcceptance, setTaskAcceptance] = useState('');
  const [taskNonGoals, setTaskNonGoals] = useState('');
  const [taskSourceLabel, setTaskSourceLabel] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [isFixing, setIsFixing] = useState<string | null>(null);
  const [fixProgress, setFixProgress] = useState<string[]>([]);
  const [fixResult, setFixResult] = useState<FixFindingsResult | null>(null);
  const [fixCompletedAt, setFixCompletedAt] = useState<string | null>(null);
  const fixLogRef = useRef<HTMLDivElement>(null);
  const [selectedFindings, setSelectedFindings] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<CliReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Blast radius analysis (graph-aware PR context)
  const [blastReport, setBlastReport] = useState<BlastRadiusReport | null>(null);
  const [blastLoading, setBlastLoading] = useState(false);
  const [blastError, setBlastError] = useState<string | null>(null);
  const [deepGraphImpact, setDeepGraphImpact] = useState<UnpackDeepGraphDetectChanges | null>(null);
  const [deepGraphImpactLoading, setDeepGraphImpactLoading] = useState(false);

  // Repo history context (read-only signals for review input: commits, prior agents, recurring)
  const [historyContext, setHistoryContext] = useState<RepoHistoryContext | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Whether the current view-mode review has a known repo path (for enabling fix)
  const [viewHasRepoPath, setViewHasRepoPath] = useState(true);

  // Past reviews
  const [pastReviews, setPastReviews] = useState<LocalReviewRow[]>([]);
  const [pastReviewsLoading, setPastReviewsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(true);

  // Code viewer state (view mode)
  const [selectedFindingIdx, setSelectedFindingIdx] = useState<number | null>(null);
  const [reviewDockTab, setReviewDockTab] = useState<ReviewDockTab>('findings');
  const [codeLines, setCodeLines] = useState<FileLineData[]>([]);
  const [codeFilePath, setCodeFilePath] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const sourceRequestIdRef = useRef(0);
  const [evidenceByFinding, setEvidenceByFinding] = useState<Record<string, FindingEvidence>>({});
  const [browserEvidenceByFinding, setBrowserEvidenceByFinding] = useState<
    Record<string, BrowserEvidenceRef>
  >({});
  const [evidenceCandidateStatuses, setEvidenceCandidateStatuses] = useState<
    Record<string, EvidenceCandidateStatus>
  >({});
  const [storedProcedureEvents, setStoredProcedureEvents] = useState<ReviewProcedureEvent[]>([]);
  const [packetCopied, setPacketCopied] = useState(false);
  const [timelinePacketCopiedId, setTimelinePacketCopiedId] = useState<string | null>(null);
  const [expandedTimelineItems, setExpandedTimelineItems] = useState<Set<string>>(new Set());
  const reviewId = result?.review_id ?? '';
  const resultAgent = result?.agent;
  const resultDiffRange = result?.diff_range;
  const resultEvidenceProcedureSteps = result?.evidence_procedure_steps;
  const [audienceBundle, setAudienceBundle] = useState<AudienceValidationBundle | null>(null);
  const activeProcedureSteps = useMemo(
    () => resultEvidenceProcedureSteps ?? [],
    [resultEvidenceProcedureSteps]
  );
  const [verificationCommand, setVerificationCommand] = useState('');
  const [verificationCommandTimeoutMs, setVerificationCommandTimeoutMs] = useState(120_000);
  const [verificationCommandRunning, setVerificationCommandRunning] = useState(false);
  const [verificationCommandCanceling, setVerificationCommandCanceling] = useState(false);
  const [verificationCommandRunId, setVerificationCommandRunId] = useState<string | null>(null);
  const [verificationCommandError, setVerificationCommandError] = useState<string | null>(null);
  const [verificationCommandSuggestions, setVerificationCommandSuggestions] = useState<
    ReviewVerificationCommandSuggestion[]
  >([]);
  const [verificationCommandSuggestionsLoading, setVerificationCommandSuggestionsLoading] =
    useState(false);

  useEffect(() => {
    sourceRequestIdRef.current += 1;
    setSourceLoading(false);
    setCodeLines([]);
    setCodeFilePath('');
    setCodeLanguage('');
    return () => {
      sourceRequestIdRef.current += 1;
    };
  }, [repoPath, reviewId]);

  // Synthetic user QA (browser loop → verification evidence)
  const [qaBaseUrl, setQaBaseUrl] = useState(CODEVETTER_REVIEW_SHELL.default_base_url);
  const [qaLoopId, setQaLoopId] = useState(CODEVETTER_REVIEW_SHELL.id);
  const [qaRunnerType, setQaRunnerType] = useState<QaRunnerType>('playwright_builtin');
  const [qaGoal, setQaGoal] = useState(CODEVETTER_REVIEW_SHELL.goal);
  const [qaTargetRoute, setQaTargetRoute] = useState(CODEVETTER_REVIEW_SHELL.route);
  const [qaTargetName, setQaTargetName] = useState(CODEVETTER_REVIEW_SHELL.label);
  const [qaActiveTargetId, setQaActiveTargetId] = useState('');
  const [qaTargets, setQaTargets] = useState<QaTargetPreset[]>([]);
  const [qaExternalCommand, setQaExternalCommand] = useState('');
  const [qaRepoSpecPath, setQaRepoSpecPath] = useState('');
  const [qaRepoTraceMode, setQaRepoTraceMode] = useState<QaRepoTraceMode>('retain-on-failure');
  const [qaSpecCandidates, setQaSpecCandidates] = useState<PlaywrightSpecCandidate[]>([]);
  const [qaSpecLoading, setQaSpecLoading] = useState(false);
  const [qaSpecError, setQaSpecError] = useState<string | null>(null);
  const [qaAuthMode, setQaAuthMode] = useState<QaAuthMode>('none');
  const [qaStorageStatePath, setQaStorageStatePath] = useState('');
  const [qaAllowRemoteTarget, setQaAllowRemoteTarget] = useState(false);
  const [qaWorkflowName, setQaWorkflowName] = useState(CODEVETTER_REVIEW_SHELL.label);
  const [qaActiveWorkflowId, setQaActiveWorkflowId] = useState('');
  const [qaWorkflows, setQaWorkflows] = useState<QaWorkflowPreset[]>([]);
  const [qaPresetLoaded, setQaPresetLoaded] = useState(false);
  const [qaPreferenceLoadedKey, setQaPreferenceLoadedKey] = useState('');
  const [qaRunHistory, setQaRunHistory] = useState<QaRunHistoryEntry[]>([]);
  const [warmVerificationEvidence, setWarmVerificationEvidence] = useState<{
    repoPath: string;
    projections: WarmVerificationProjection[];
  }>({ repoPath: '', projections: [] });
  const [differentialVerificationHistory, setDifferentialVerificationHistory] = useState<{
    repoPath: string;
    runs: StoredDifferentialVerificationRun[];
  }>({ repoPath: '', runs: [] });
  const [qaRunning, setQaRunning] = useState(false);
  const [postFixQaRunning, setPostFixQaRunning] = useState(false);
  const [qaLastRun, setQaLastRun] = useState<SyntheticQaRunResult | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaArtifactPreview, setQaArtifactPreview] = useState<{
    path: string;
    content: string;
    language: string;
    totalLines: number;
  } | null>(null);
  const [qaArtifactPreviewLoading, setQaArtifactPreviewLoading] = useState(false);
  const [commandSourcePreview, setCommandSourcePreview] = useState<{
    key: string;
    path: string;
    line: number;
    language: string;
    lines?: FileLineData[];
    items?: RawSessionContextItem[];
  } | null>(null);
  const [commandSourcePreviewLoading, setCommandSourcePreviewLoading] = useState<string | null>(
    null
  );

  const qaWorkflowPreferenceKey = useMemo(
    () => repoScopedPreferenceKey('quick_review_qa_workflows', repoPath),
    [repoPath]
  );
  const qaPresetPreferenceKey = useMemo(
    () => repoScopedPreferenceKey('quick_review_qa_preset', repoPath),
    [repoPath]
  );
  const qaWorkflowScopeLabel = repoPath.trim()
    ? `Repo workflow · ${repoLabelFromPath(repoPath)}`
    : 'Global QA workflow';
  const warmVerificationProjections =
    warmVerificationEvidence.repoPath === repoPath ? warmVerificationEvidence.projections : [];
  const differentialTimelineHistory = useMemo(
    () =>
      differentialVerificationHistory.repoPath === repoPath
        ? projectDifferentialVerificationHistory(
            differentialVerificationHistory.runs.map((run) => ({
              id: run.id,
              createdAt: run.created_at,
              summary: run.summary,
            }))
          )
        : [],
    [differentialVerificationHistory, repoPath]
  );
  const warmQaRunHistory = useMemo<QaRunHistoryEntry[]>(
    () =>
      warmVerificationProjections.map(({ comparisonRun, syntheticQa }) => ({
        ...comparisonRun,
        screenshotPath: syntheticQa.screenshot_path,
      })),
    [warmVerificationProjections]
  );
  const qaEvidenceHistory = useMemo(
    () =>
      [...qaRunHistory, ...warmQaRunHistory]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, 8),
    [qaRunHistory, warmQaRunHistory]
  );
  const warmExecutionFindings = useMemo<WarmExecutionFinding[]>(
    () =>
      warmVerificationProjections.flatMap((projection) =>
        projection.findings.map((finding) => ({
          runId: projection.provenance.run_id,
          finishedAt: projection.provenance.finished_at,
          finding,
          artifact: projection.findingEvidence.artifact,
          notes: projection.findingEvidence.notes,
        }))
      ),
    [warmVerificationProjections]
  );

  // Diff range derived from selection
  const [diffRange, setDiffRange] = useState('');
  const [proofCopied, setProofCopied] = useState(false);
  const [findingNoteCopied, setFindingNoteCopied] = useState(false);
  // Collapsed by default: the verification detail (procedure gates, event
  // timeline, intent check, unchecked-risk ledger) lives behind one toggle so
  // the right panel leads with the handoff-proof summary, not four stacked,
  // equal-weight sections.
  const [verificationOpen, setVerificationOpen] = useState(false);

  // ─── Load saved folder + branches on mount ───────────────────────────────

  const loadFolderData = useCallback(async (dir: string) => {
    const [branchResult, prs] = await Promise.allSettled([
      listGitBranches(dir),
      listPullRequests(dir),
    ]);
    if (branchResult.status === 'fulfilled') {
      const { branches: brList, current } = branchResult.value;
      setBranches(brList);
      setCurrentBranch(current ?? '');
      setBaseBranch(pickBaseBranch(brList));
    } else {
      setBranches([]);
      setCurrentBranch('');
    }
    setPullRequests(prs.status === 'fulfilled' ? prs.value : []);
    // Load persisted project description
    try {
      const saved = await getPreference(`quick_review_desc_${repoPrefKey(dir)}`);
      setProjectDesc(saved ?? '');
    } catch {
      setProjectDesc('');
    }
    await loadPersistedTaskContext(dir, {
      setTaskGoal,
      setTaskAcceptance,
      setTaskNonGoals,
      setTaskSourceLabel,
    });
  }, []);

  // ─── History context loader (for review-input panel; read-only, per AC) ─────
  const loadHistoryContext = useCallback(async (dir: string, range: string) => {
    if (!dir || !range || !isTauriAvailable()) {
      setHistoryContext(null);
      return;
    }
    setHistoryLoading(true);
    try {
      const ctx = await getRepoHistoryContext(dir, range);
      setHistoryContext(ctx);
    } catch (e) {
      // Non-fatal — panel just shows empty; review still works.
      console.warn('[Review] history context load failed (non-fatal):', e);
      setHistoryContext(null);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workspaceReady || !selectedRepoPath || !isTauriAvailable()) return;
    void loadFolderData(selectedRepoPath);
  }, [workspaceReady, selectedRepoPath, loadFolderData]);

  // Auto-load history signals when repo + diffRange ready (read-only panel in input)
  useEffect(() => {
    if (repoPath && diffRange) {
      void loadHistoryContext(repoPath, diffRange);
    } else {
      setHistoryContext(null);
    }
  }, [repoPath, diffRange, loadHistoryContext]);

  // ─── Load past reviews ───────────────────────────────────────────────────

  useEffect(() => {
    if (!isTauriAvailable()) {
      setPastReviewsLoading(false);
      return;
    }
    setPastReviewsLoading(true);
    void listReviews(20, 0)
      .then((reviews) => {
        return setPastReviews(reviews);
      })
      .catch((e) => console.error('[Review] failed to load past reviews:', e))
      .finally(() => setPastReviewsLoading(false));
  }, [result]); // reload after new review completes

  const handleLoadPastReview = useCallback(
    async (id: string) => {
      try {
        const [data, reviewManifest] = await Promise.all([getReview(id), getReviewManifest(id)]);
        const review = data.review;
        const findings = mapStoredFindings(data.findings ?? []);
        setFixResult(null);
        setFixCompletedAt(null);
        setSelectedFindings(new Set());
        setSelectedFindingIdx(null);
        setCodeLines([]);
        setCodeFilePath('');
        setCodeLanguage('');
        setDiffRange('');
        setEvidenceByFinding({});
        setBrowserEvidenceByFinding({});
        setResult(
          buildCliReviewResultFromStored(review, findings, reviewManifest, data.review_readiness)
        );
        setSelectedBranch('');
        setDiffRange(diffRangeFromSourceLabel(review.source_label));
        setViewHasRepoPath(!!review.repo_path);
        if (review.repo_path) {
          selectProject(review.repo_path);
          await loadFolderData(review.repo_path);
        } else {
          setBranches([]);
          setCurrentBranch('');
          setBaseBranch('main');
          setSelectedBranch('');
        }
        // Past reviews don't have a stored blast report — clear the panel.
        setBlastReport(null);
        setBlastError(null);
        setMode('view');
      } catch (e) {
        console.error('[CodeVetter] Failed to open past review:', e);
        setError("Couldn't open that review. Try again, or pick another one.");
      }
    },
    [loadFolderData, selectProject]
  );

  useEffect(() => {
    if (!reviewQualificationRequest || reviewQualificationStarted.current) return;
    reviewQualificationStarted.current = true;

    void (async () => {
      await runReviewQualification(
        reviewQualificationRequest.stateName,
        reviewQualificationRequest.reviewId,
        handleLoadPastReview
      );
      if (!completeReviewQualificationState(reviewQualificationRequest)) {
        throw new Error('Native Review qualification bridge was not awaiting completion');
      }
    })().catch(() => {
      failReviewQualificationState(reviewQualificationRequest);
    });
  }, [handleLoadPastReview, reviewQualificationRequest]);

  const handleDeletePastReview = useCallback(
    async (id: string) => {
      const ok = window.confirm('Delete this saved review? This only removes the local report.');
      if (!ok) return;
      try {
        await deleteReview(id);
        setPastReviews((prev) => prev.filter((r) => r.id !== id));
        if (result?.review_id === id) {
          setResult(null);
          setMode('create');
        }
      } catch (e) {
        console.error('[CodeVetter] Failed to delete past review:', e);
        setError("Couldn't delete that review. Try again.");
      }
    },
    [reviewId]
  );

  // ─── Branch/PR selection ─────────────────────────────────────────────────

  const handleSelectBranch = useCallback(
    (branch: string) => {
      setSelectedBranch(branch);
      setDiffRange(`${baseBranch}...${branch}`);
      setResult(null);
      setError(null);
    },
    [baseBranch]
  );

  const handleSelectPR = useCallback((pr: PullRequest) => {
    setSelectedBranch(pr.headRefName);
    setDiffRange(`${pr.baseRefName}...${pr.headRefName}`);
    setResult(null);
    setError(null);
  }, []);

  // ─── Persist project description on blur ─────────────────────────────────

  const handleProjectDescBlur = useCallback(() => {
    if (!repoPath || !isTauriAvailable()) return;
    const prefKey = `quick_review_desc_${repoPrefKey(repoPath)}`;
    setPreference(prefKey, projectDesc).catch(() => {});
  }, [repoPath, projectDesc]);

  const currentTaskContext = useMemo<TaskContext>(
    () => ({
      goal: taskGoal,
      acceptanceCriteria: taskAcceptance,
      nonGoals: taskNonGoals,
      sourceLabel: taskSourceLabel,
    }),
    [taskAcceptance, taskGoal, taskNonGoals, taskSourceLabel]
  );

  const handleTaskContextBlur = useCallback(() => {
    if (!repoPath || !isTauriAvailable()) return;
    const prefKey = `quick_review_task_${repoPrefKey(repoPath)}`;
    setPreference(prefKey, JSON.stringify(currentTaskContext)).catch(() => {});
  }, [currentTaskContext, repoPath]);

  // ─── Run review ──────────────────────────────────────────────────────────

  const handleReview = useCallback(async () => {
    if (!repoPath || !diffRange) return;

    setIsReviewing(true);
    setError(null);
    setResult(null);
    setBlastReport(null);
    setBlastError(null);
    setBlastLoading(true);
    setDeepGraphImpact(null);
    setDeepGraphImpactLoading(true);

    const deepGraphBaseRef = extractDeepGraphBaseRef(diffRange);
    void unpackDeepGraphStatus(repoPath)
      .then((status) => {
        if (!status.indexed) return null;
        return unpackDeepGraphDetectChanges(repoPath, 'compare', deepGraphBaseRef);
      })
      .then((impact) => setDeepGraphImpact(impact))
      .catch(() => setDeepGraphImpact(null))
      .finally(() => setDeepGraphImpactLoading(false));

    // Kick off blast-radius analysis in parallel with the LLM review.
    // It's deterministic and fast (git grep), so it usually returns first.
    const blastPromise = analyzeBlastRadius(repoPath, diffRange)
      .then((r) => {
        setBlastReport(r);
        return r;
      })
      .catch((e) => {
        setBlastError(String(e));
        return null;
      })
      .finally(() => setBlastLoading(false));

    try {
      const res = await runCliReview(repoPath, diffRange, projectDesc, changeDesc, 'claude', {
        // Warm rows are historical until exact-current qualification succeeds.
        // Do not let an older pass influence a new model review.
        qaRuns: qaRunsForReviewPrompt(qaRunHistory),
      });
      setResult(res);
      setFixCompletedAt(null);
      setMode('view');
      setViewHasRepoPath(true);
      setSelectedFindings(new Set());
      // Core action: a code review run completed (also fires `activated` once).
      trackCoreAction('review_run');
      void notifyIfEnabled(
        'notify_review_done',
        true,
        'Review complete',
        buildReviewCompleteMessage(res, diffRange)
      );
      await blastPromise;
    } catch (e) {
      console.error('[CodeVetter] CLI review failed:', e);
      const msg = String(e);
      setError(describeReviewError(msg));
      if (!msg.includes('TAURI_NOT_AVAILABLE')) {
        void notifyIfEnabled(
          'notify_agent_error',
          true,
          'Review failed',
          'The AI agent failed or timed out during the review.'
        );
      }
    } finally {
      setIsReviewing(false);
    }
  }, [repoPath, diffRange, projectDesc, changeDesc, qaRunHistory]);

  // ─── Back to create mode ─────────────────────────────────────────────────

  const handleNewReview = useCallback(() => {
    sourceRequestIdRef.current += 1;
    setMode('create');
    setResult(null);
    setError(null);
    setBlastReport(null);
    setBlastError(null);
    setSelectedBranch('');
    setDiffRange('');
    setHistoryContext(null);
    setSelectedFindingIdx(null);
    setCodeLines([]);
    setCodeFilePath('');
    setCodeLanguage('');
    setSourceLoading(false);
    // Re-fetch branches for the current folder
    if (repoPath) {
      loadFolderData(repoPath);
    }
  }, [repoPath, loadFolderData]);

  // ─── Sorted findings ────────────────────────────────────────────────────

  const sortedFindings = useMemo<CliReviewFinding[]>(
    () => (result ? sortFindingsBySeverity(result.findings) : []),
    [result]
  );

  const patchQueue = useMemo(
    () => sortedFindings.filter((_, idx) => selectedFindings.has(idx)),
    [selectedFindings, sortedFindings]
  );

  // Findings eligible for bulk "select all" — dismissed ones are excluded.
  const selectableFindingCount = useMemo(
    () => sortedFindings.filter((finding) => finding.disposition !== 'dismissed').length,
    [sortedFindings]
  );

  const patchQueueSeverityCounts = useMemo(() => countFindingsBySeverity(patchQueue), [patchQueue]);

  const selectedFindingIndexes = useMemo(
    () => Array.from(selectedFindings).sort((a, b) => a - b),
    [selectedFindings]
  );

  const selectedEvidence = useMemo(
    () => mapSelectedEvidence(selectedFindingIndexes, sortedFindings, evidenceByFinding),
    [evidenceByFinding, selectedFindingIndexes, sortedFindings]
  );

  const selectedBrowserEvidence = useMemo(
    () =>
      mapSelectedBrowserEvidence(selectedFindingIndexes, sortedFindings, browserEvidenceByFinding),
    [browserEvidenceByFinding, selectedFindingIndexes, sortedFindings]
  );

  const timelineEvidenceStatuses = useMemo(
    () =>
      sortedFindings.map(
        (finding, idx) =>
          ({
            ...defaultFindingEvidence,
            ...evidenceByFinding[findingEvidenceKey(finding, idx)],
          }).status
      ),
    [evidenceByFinding, sortedFindings]
  );

  const timelineSegmentFindingIndexes = useCallback(
    (segmentId: string) =>
      selectTimelineSegmentFindingIndexes({
        segmentId,
        findingsCount: sortedFindings.length,
        selectedFindingIndexes,
        activeFindingIndex: selectedFindingIdx,
        evidenceStatuses: timelineEvidenceStatuses,
      }),
    [selectedFindingIdx, selectedFindingIndexes, sortedFindings.length, timelineEvidenceStatuses]
  );

  const fixPacket = useMemo(
    () =>
      buildAgentFixPacket({
        repoPath,
        diffRange: result?.diff_range || diffRange,
        agent: result?.agent ?? 'claude',
        task: currentTaskContext,
        findings: selectedFindingIndexes
          .map((idx) => sortedFindings[idx])
          .filter((finding): finding is CliReviewFinding => Boolean(finding)),
        evidence: selectedEvidence,
        browserEvidence: selectedBrowserEvidence,
      }),
    [
      currentTaskContext,
      diffRange,
      repoPath,
      resultAgent,
      resultDiffRange,
      selectedBrowserEvidence,
      selectedEvidence,
      selectedFindingIndexes,
      sortedFindings,
    ]
  );

  const evidenceCounts = useMemo(
    () => computeEvidenceCounts(evidenceByFinding),
    [evidenceByFinding]
  );

  const procedureExecutionEvents = useMemo(() => {
    const stored = storedProcedureEvents.map(storedProcedureEventToExecutionEvent);
    const derived = buildProcedureExecutionEvents({
      steps: activeProcedureSteps,
      qaRunHistory,
      evidenceByFinding,
      browserEvidenceByFinding,
      fixResult,
    });
    return mergeProcedureExecutionEvents(stored, derived);
  }, [
    browserEvidenceByFinding,
    evidenceByFinding,
    fixResult,
    qaRunHistory,
    activeProcedureSteps,
    storedProcedureEvents,
  ]);

  const handleCancelReview = useCallback(async () => {
    if (!repoPath || !isReviewing) return;
    try {
      const result = await cancelCliReview(repoPath);
      if (!result.cancelled && result.reason === 'no_active_review') {
        setError('The review is already stopping or has finished.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [isReviewing, repoPath]);

  const qaPostFixComparison = useMemo(
    () => buildQaPostFixComparison(qaEvidenceHistory, fixCompletedAt),
    [fixCompletedAt, qaEvidenceHistory]
  );

  const reviewTimeline = useMemo(
    () =>
      buildReviewTimeline(
        reviewId,
        result,
        sortedFindings,
        selectedFindingIdx,
        taskGoal,
        isReviewing,
        qaRunning,
        postFixQaRunning,
        qaRunHistory,
        qaPostFixComparison,
        evidenceCounts,
        fixPacket,
        selectedFindingIndexes,
        isFixing,
        fixResult,
        historyContext,
        warmVerificationProjections,
        differentialTimelineHistory
      ),
    [
      evidenceCounts,
      fixPacket,
      fixResult,
      isFixing,
      isReviewing,
      postFixQaRunning,
      qaPostFixComparison,
      qaRunHistory,
      qaRunning,
      result,
      historyContext,
      reviewId,
      selectedFindingIdx,
      selectedFindingIndexes,
      sortedFindings,
      sortedFindings.length,
      taskGoal,
      differentialTimelineHistory,
      warmVerificationProjections,
    ]
  );

  const uncheckedFindings = useMemo(
    () =>
      sortedFindings.filter((finding, idx) => {
        const ev = evidenceByFinding[findingEvidenceKey(finding, idx)];
        return !ev || ev.status === 'not_checked';
      }),
    [sortedFindings, evidenceByFinding]
  );

  const uncheckedBySeverity = useMemo(
    () => groupUncheckedBySeverity(uncheckedFindings),
    [uncheckedFindings]
  );

  const historyFileSummaries = useMemo(
    () => (historyContext ? computeHistoryFileSummaries(historyContext) : []),
    [historyContext]
  );

  const historyFindingSummaries = useMemo(
    () =>
      historyContext ? computeHistoryFindingSummaries(historyContext, sortedFindings) : new Map(),
    [historyContext, sortedFindings]
  );

  const historyExplanations = useMemo(
    () => buildCodebaseHistoryExplanations(historyContext),
    [historyContext]
  );

  const selectedFindingHistoryExplanation = useMemo(() => {
    if (selectedFindingIdx == null) return null;
    const filePath = sortedFindings[selectedFindingIdx]?.filePath;
    if (!filePath) return null;
    if (historyExplanations.some((explanation) => explanation.file === filePath)) {
      return null;
    }
    return queryCodebaseHistoryExplanationForFile(historyContext, filePath);
  }, [historyContext, historyExplanations, selectedFindingIdx, sortedFindings]);

  const intentReport = useMemo(
    () =>
      result
        ? buildIntentReport(
            result,
            diffRange,
            changeDesc,
            sortedFindings,
            evidenceByFinding,
            historyContext,
            qaRunHistory,
            fixResult,
            blastReport
          )
        : null,
    [
      blastReport,
      changeDesc,
      diffRange,
      evidenceByFinding,
      fixResult,
      historyContext,
      qaRunHistory,
      result,
      sortedFindings,
    ]
  );

  const updateFindingEvidence = useCallback(
    (idx: number, patch: Partial<FindingEvidence>) => {
      const finding = sortedFindings[idx];
      if (!finding) return;
      const key = findingEvidenceKey(finding, idx);
      setEvidenceByFinding((prev) => ({
        ...prev,
        [key]: {
          ...defaultFindingEvidence,
          ...prev[key],
          ...patch,
        },
      }));
    },
    [sortedFindings]
  );

  const updateBrowserEvidence = useCallback(
    (idx: number, patch: Partial<BrowserEvidenceRef>) => {
      const finding = sortedFindings[idx];
      if (!finding) return;
      const key = findingEvidenceKey(finding, idx);
      setBrowserEvidenceByFinding((prev) => ({
        ...prev,
        [key]: {
          ...emptyBrowserEvidence(),
          ...prev[key],
          ...patch,
        },
      }));
    },
    [sortedFindings]
  );

  const updateEvidenceCandidateStatus = useCallback(
    (candidateId: string, status: EvidenceCandidateStatus) => {
      setEvidenceCandidateStatuses((prev) => ({
        ...prev,
        [candidateId]: status,
      }));
    },
    []
  );

  const toggleRevalidationItem = useCallback(
    (idx: number, itemId: string) => {
      const finding = sortedFindings[idx];
      if (!finding) return;
      const key = findingEvidenceKey(finding, idx);
      setEvidenceByFinding((prev) => {
        const current = { ...defaultFindingEvidence, ...prev[key] };
        const nextRevalidation = {
          ...current.revalidation,
          [itemId]: !current.revalidation?.[itemId],
        };
        return {
          ...prev,
          [key]: { ...current, revalidation: nextRevalidation },
        };
      });
    },
    [sortedFindings]
  );

  useEffect(() => {
    void loadReviewEvidence(
      reviewId,
      setEvidenceByFinding,
      setBrowserEvidenceByFinding,
      setEvidenceCandidateStatuses,
      setStoredProcedureEvents
    ).catch(() => {
      setEvidenceByFinding({});
      setBrowserEvidenceByFinding({});
      setEvidenceCandidateStatuses({});
    });
  }, [reviewId]);

  useEffect(() => {
    if (!reviewId || !isTauriAvailable()) {
      setStoredProcedureEvents([]);
      return;
    }

    void listReviewProcedureEvents(reviewId)
      .then(setStoredProcedureEvents)
      .catch(() => setStoredProcedureEvents([]));
  }, [reviewId]);

  useEffect(() => {
    if (!reviewId) return;
    void Promise.all([
      setPreference(`quick_review_evidence_${reviewId}`, JSON.stringify(evidenceByFinding)),
      setPreference(
        `quick_review_browser_evidence_${reviewId}`,
        JSON.stringify(browserEvidenceByFinding)
      ),
      setPreference(
        `quick_review_candidate_statuses_${reviewId}`,
        JSON.stringify(evidenceCandidateStatuses)
      ),
    ]).catch(() => {});
  }, [browserEvidenceByFinding, evidenceByFinding, evidenceCandidateStatuses, reviewId]);

  const recordProcedureExecutionEvents = useCallback(
    (events: ProcedureExecutionEvent[], metadata?: Record<string, unknown>) => {
      if (!reviewId || !isTauriAvailable() || events.length === 0) return;

      void Promise.all(
        events.map((event) =>
          recordReviewProcedureEvent({
            reviewId,
            stepId: event.stepId,
            status: event.status,
            source: event.source,
            summary: event.summary,
            artifact: event.artifact ?? null,
            metadata,
          })
        )
      )
        .then((stored) => {
          setStoredProcedureEvents((prev) => [...stored, ...prev]);
          return null;
        })
        .catch(() => {});
    },
    [reviewId]
  );

  const applyQaWorkflow = useCallback((workflow: Partial<QaWorkflowPreset>) => {
    applyQaWorkflowPreset(workflow, {
      setQaBaseUrl,
      setQaLoopId,
      setQaRunnerType,
      setQaGoal,
      setQaTargetRoute,
      setQaExternalCommand,
      setQaRepoSpecPath,
      setQaRepoTraceMode,
      setQaAuthMode,
      setQaStorageStatePath,
      setQaAllowRemoteTarget,
      setQaTargets,
      setQaActiveTargetId,
      setQaTargetName,
      setQaWorkflowName,
    });
  }, []);

  const currentQaWorkflow = useCallback(
    (id: string): QaWorkflowPreset => ({
      id,
      name: qaWorkflowName.trim() || CODEVETTER_REVIEW_SHELL.label,
      baseUrl: qaBaseUrl,
      loopId: qaLoopId,
      runnerType: qaRunnerType,
      goal: qaGoal,
      externalCommand: qaExternalCommand,
      repoSpecPath: qaRepoSpecPath,
      repoTraceMode: qaRepoTraceMode,
      authMode: qaAuthMode,
      storageStatePath: qaStorageStatePath,
      targetRoute: qaTargetRoute,
      allowRemoteTarget: qaAllowRemoteTarget,
      targets: qaTargets,
      updatedAt: new Date().toISOString(),
    }),
    [
      qaAllowRemoteTarget,
      qaAuthMode,
      qaBaseUrl,
      qaExternalCommand,
      qaGoal,
      qaLoopId,
      qaRepoSpecPath,
      qaRepoTraceMode,
      qaRunnerType,
      qaStorageStatePath,
      qaTargetRoute,
      qaTargets,
      qaWorkflowName,
    ]
  );

  useEffect(() => {
    setQaPresetLoaded(false);
    setQaPreferenceLoadedKey('');
    void loadQaWorkflowsFromPrefs(
      qaWorkflowPreferenceKey,
      qaPresetPreferenceKey,
      setQaWorkflows,
      setQaActiveWorkflowId,
      applyQaWorkflow,
      setQaPreferenceLoadedKey,
      setQaPresetLoaded
    );
  }, [applyQaWorkflow, qaPresetPreferenceKey, qaWorkflowPreferenceKey]);

  useEffect(() => {
    if (!qaPresetLoaded || qaPreferenceLoadedKey !== qaWorkflowPreferenceKey) return;
    const preset: QaPreset = {
      baseUrl: qaBaseUrl,
      loopId: qaLoopId,
      runnerType: qaRunnerType,
      goal: qaGoal,
      externalCommand: qaExternalCommand,
      repoSpecPath: qaRepoSpecPath,
      repoTraceMode: qaRepoTraceMode,
      authMode: qaAuthMode,
      storageStatePath: qaStorageStatePath,
      targetRoute: qaTargetRoute,
      allowRemoteTarget: qaAllowRemoteTarget,
    };
    void setPreference(qaPresetPreferenceKey, JSON.stringify(preset)).catch(() => {});
  }, [
    qaAuthMode,
    qaAllowRemoteTarget,
    qaBaseUrl,
    qaExternalCommand,
    qaGoal,
    qaLoopId,
    qaPresetLoaded,
    qaRepoSpecPath,
    qaRepoTraceMode,
    qaRunnerType,
    qaPreferenceLoadedKey,
    qaStorageStatePath,
    qaTargetRoute,
    qaPresetPreferenceKey,
    qaWorkflowPreferenceKey,
  ]);

  useEffect(() => {
    if (!qaPresetLoaded || qaPreferenceLoadedKey !== qaWorkflowPreferenceKey) return;
    void setPreference(qaWorkflowPreferenceKey, JSON.stringify(qaWorkflows)).catch(() => {});
  }, [qaPresetLoaded, qaPreferenceLoadedKey, qaWorkflowPreferenceKey, qaWorkflows]);

  const handleSelectQaWorkflow = useCallback(
    (workflowId: string) => {
      setQaActiveWorkflowId(workflowId);
      const workflow = qaWorkflows.find((candidate) => candidate.id === workflowId);
      if (workflow) applyQaWorkflow(workflow);
    },
    [applyQaWorkflow, qaWorkflows]
  );

  const handleSaveQaWorkflow = useCallback(() => {
    const id = qaActiveWorkflowId || `qa-workflow-${Date.now()}`;
    const next = currentQaWorkflow(id);
    setQaActiveWorkflowId(id);
    setQaWorkflows((prev) => {
      const exists = prev.some((workflow) => workflow.id === id);
      const updated = exists
        ? prev.map((workflow) => (workflow.id === id ? next : workflow))
        : [next, ...prev];
      return updated.slice(0, 12);
    });
  }, [currentQaWorkflow, qaActiveWorkflowId]);

  const handleDeleteQaWorkflow = useCallback(() => {
    if (!qaActiveWorkflowId) return;
    setQaWorkflows((prev) => prev.filter((workflow) => workflow.id !== qaActiveWorkflowId));
    setQaActiveWorkflowId('');
  }, [qaActiveWorkflowId]);

  const handleSelectQaTarget = useCallback(
    (targetId: string) => {
      setQaActiveTargetId(targetId);
      const target = qaTargets.find((candidate) => candidate.id === targetId);
      if (!target) return;
      setQaTargetName(target.name);
      setQaTargetRoute(target.route);
      setQaGoal(target.goal);
    },
    [qaTargets]
  );

  const handleSaveQaTarget = useCallback(() => {
    const id = qaActiveTargetId || `qa-target-${Date.now()}`;
    const next: QaTargetPreset = {
      id,
      name: qaTargetName.trim() || qaTargetRoute || CODEVETTER_REVIEW_SHELL.label,
      route: qaTargetRoute.trim() || CODEVETTER_REVIEW_SHELL.route,
      goal: qaGoal,
    };
    setQaActiveTargetId(id);
    const exists = qaTargets.some((target) => target.id === id);
    const updatedTargets = (
      exists ? qaTargets.map((target) => (target.id === id ? next : target)) : [next, ...qaTargets]
    ).slice(0, 16);
    setQaTargets(updatedTargets);
    if (qaActiveWorkflowId) {
      setQaWorkflows((prev) =>
        prev.map((workflow) =>
          workflow.id === qaActiveWorkflowId
            ? { ...currentQaWorkflow(workflow.id), targets: updatedTargets }
            : workflow
        )
      );
    }
  }, [
    currentQaWorkflow,
    qaActiveTargetId,
    qaActiveWorkflowId,
    qaGoal,
    qaTargets,
    qaTargetName,
    qaTargetRoute,
  ]);

  const handleDeleteQaTarget = useCallback(() => {
    if (!qaActiveTargetId) return;
    const updatedTargets = qaTargets.filter((target) => target.id !== qaActiveTargetId);
    setQaTargets(updatedTargets);
    if (qaActiveWorkflowId) {
      setQaWorkflows((prev) =>
        prev.map((workflow) =>
          workflow.id === qaActiveWorkflowId
            ? { ...currentQaWorkflow(workflow.id), targets: updatedTargets }
            : workflow
        )
      );
    }
    setQaActiveTargetId('');
  }, [currentQaWorkflow, qaActiveTargetId, qaActiveWorkflowId, qaTargets]);

  useEffect(() => {
    let canceled = false;
    setWarmVerificationEvidence({ repoPath, projections: [] });
    if (!repoPath || !isTauriAvailable()) return;

    void listWarmVerificationRuns({ repoPath, limit: 8 })
      .then((rows) => {
        if (!canceled) {
          setWarmVerificationEvidence({
            repoPath,
            projections: rows.map(({ result }) => projectWarmVerification(result)),
          });
        }
      })
      .catch(() => {
        if (!canceled) setWarmVerificationEvidence({ repoPath, projections: [] });
      });
    return () => {
      canceled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    let canceled = false;
    setDifferentialVerificationHistory({ repoPath, runs: [] });
    if (!repoPath || !isTauriAvailable()) return;

    void listDifferentialVerificationRuns({ repoPath, limit: 8 })
      .then((runs) => {
        if (!canceled) setDifferentialVerificationHistory({ repoPath, runs });
      })
      .catch(() => {
        if (!canceled) setDifferentialVerificationHistory({ repoPath, runs: [] });
      });
    return () => {
      canceled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    if (!reviewId) {
      setQaRunHistory([]);
      return;
    }
    const loadPreferenceFallback = async () => {
      const raw = await getPreference(`quick_review_qa_runs_${reviewId}`);
      if (!raw) {
        setQaRunHistory([]);
        return;
      }
      setQaRunHistory(JSON.parse(raw) as QaRunHistoryEntry[]);
    };

    void (async () => {
      try {
        if (isTauriAvailable()) {
          const rows = await listSyntheticQaRuns(reviewId, 8);
          if (rows.length > 0) {
            setQaRunHistory(rows.map(storedSyntheticQaRunToHistory));
            return;
          }
        }
        await loadPreferenceFallback();
      } catch {
        try {
          await loadPreferenceFallback();
        } catch {
          setQaRunHistory([]);
        }
      }
    })();
  }, [reviewId]);

  useEffect(() => {
    if (!reviewId) return;
    void setPreference(
      `quick_review_qa_runs_${reviewId}`,
      JSON.stringify(qaRunHistory.slice(0, 8))
    ).catch(() => {});
  }, [qaRunHistory, reviewId]);

  useEffect(() => {
    const finding = selectedFindingIdx !== null ? sortedFindings[selectedFindingIdx] : null;
    if (!repoPath || !isTauriAvailable()) {
      setVerificationCommandSuggestions([]);
      return;
    }

    setVerificationCommandSuggestionsLoading(true);
    const seenHistoryCommands = new Set<string>();
    const historyCommands = (historyContext?.command_signals ?? [])
      .filter((signal) => signal.command.trim() && signal.status !== 'stale')
      .filter((signal) => {
        const command = signal.command.trim();
        if (seenHistoryCommands.has(command)) return false;
        seenHistoryCommands.add(command);
        return true;
      })
      .slice(0, 8)
      .map((signal) => ({
        command: signal.command.trim(),
        date: signal.date,
        source: signal.source,
        status: signal.status ?? 'unknown',
        artifacts: signal.artifacts ?? [],
      }));
    void suggestReviewVerificationCommands({
      repoPath,
      changedFiles: sortedFindings
        .map((item) => item.filePath)
        .filter((path): path is string => Boolean(path)),
      findingFilePath: finding?.filePath ?? null,
      historyCommands,
    })
      .then((commands) => {
        setVerificationCommandSuggestions(commands);
        return null;
      })
      .catch(() => setVerificationCommandSuggestions([]))
      .finally(() => setVerificationCommandSuggestionsLoading(false));
  }, [historyContext, repoPath, selectedFindingIdx, sortedFindings]);

  const handleDiscoverQaSpecs = useCallback(async () => {
    if (!repoPath) {
      setQaSpecError('Select a repository first.');
      return;
    }
    if (!isTauriAvailable()) {
      setQaSpecError('Spec discovery requires the CodeVetter desktop app (Tauri).');
      return;
    }
    setQaSpecLoading(true);
    setQaSpecError(null);
    try {
      const discovered = await discoverPlaywrightSpecs(repoPath);
      setQaSpecCandidates(discovered.specs);
      if (!qaRepoSpecPath && discovered.specs[0]) {
        setQaRepoSpecPath(discovered.specs[0].path);
      }
      if (discovered.specs.length === 0) {
        setQaSpecError('No Playwright-looking specs found.');
      }
    } catch (err) {
      setQaSpecError(err instanceof Error ? err.message : String(err));
    } finally {
      setQaSpecLoading(false);
    }
  }, [qaRepoSpecPath, repoPath]);

  const runSyntheticQaFlow = useCallback(
    async (
      request: QaPreset,
      options?: { repoPathOverride?: string | null }
    ): Promise<QaRunHistoryEntry> => {
      if (!isTauriAvailable()) {
        throw new Error('Synthetic QA requires the CodeVetter desktop app (Tauri).');
      }
      const runRepoPath = options?.repoPathOverride || repoPath;
      const run = await runSyntheticQa(
        request.baseUrl,
        request.loopId,
        buildSyntheticQaRunConfig(request, runRepoPath)
      );
      setQaLastRun(run);
      const configFields = {
        externalCommand: request.externalCommand,
        repoSpecPath: request.repoSpecPath,
        repoTraceMode: request.repoTraceMode,
        storageStatePath: request.storageStatePath,
        allowRemoteTarget: request.allowRemoteTarget,
      };
      let entry: QaRunHistoryEntry = buildQaRunHistoryEntry(request, run);
      if (reviewId) {
        try {
          const storedRun = await recordSyntheticQaRun({
            reviewId,
            repoPath: runRepoPath,
            baseUrl: request.baseUrl,
            run,
          });
          entry = {
            ...storedSyntheticQaRunToHistory(storedRun),
            ...configFields,
          };
        } catch {
          // Preference-backed history below remains the fallback if DB persistence fails.
        }
      }
      setQaRunHistory((prev) => [entry, ...prev].slice(0, 8));
      recordProcedureExecutionEvents(procedureEventsForQaRun(activeProcedureSteps, entry), {
        loopId: entry.loopId,
        runnerType: entry.runnerType,
        route: entry.route,
        pass: entry.pass,
      });
      if (!run.pass) {
        trackCoreAction('review_run');
      }
      return entry;
    },
    [activeProcedureSteps, recordProcedureExecutionEvents, reviewId, repoPath]
  );

  const handleRunSyntheticQa = useCallback(async () => {
    setQaRunning(true);
    setQaError(null);
    try {
      await runSyntheticQaFlow(currentQaWorkflow(qaActiveWorkflowId || 'manual'));
    } catch (err) {
      setQaError(err instanceof Error ? err.message : String(err));
      setQaLastRun(null);
    } finally {
      setQaRunning(false);
    }
  }, [currentQaWorkflow, qaActiveWorkflowId, runSyntheticQaFlow]);

  const handleRunPostFixQa = useCallback(async () => {
    if (!qaPostFixComparison?.before) return;
    setPostFixQaRunning(true);
    setQaError(null);
    try {
      await runSyntheticQaFlow(
        qaRequestFromHistory(
          qaPostFixComparison.before,
          currentQaWorkflow(qaActiveWorkflowId || 'manual')
        ),
        {
          repoPathOverride: fixResult?.worktree_path,
        }
      );
    } catch (err) {
      setQaError(`Post-fix QA rerun failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPostFixQaRunning(false);
    }
  }, [currentQaWorkflow, fixResult, qaActiveWorkflowId, qaPostFixComparison, runSyntheticQaFlow]);

  const handleOpenQaArtifact = useCallback(async (artifact: string) => {
    if (!isTauriAvailable()) {
      setQaError('Opening artifacts requires the CodeVetter desktop app (Tauri).');
      return;
    }
    try {
      await openInApp('finder', artifact);
      setQaError(null);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handlePreviewQaArtifact = useCallback(async (artifact: string) => {
    if (!isTauriAvailable()) {
      setQaError('Previewing artifacts requires the CodeVetter desktop app (Tauri).');
      return;
    }
    if (!canPreviewQaArtifact(artifact)) {
      setQaError('Preview is only available for text-like artifacts.');
      return;
    }
    setQaArtifactPreviewLoading(true);
    setQaError(null);
    try {
      const preview = await readFilePreview(artifact, 60);
      setQaArtifactPreview({
        path: artifact,
        content: preview.content,
        language: preview.language,
        totalLines: preview.total_lines,
      });
    } catch (err) {
      setQaArtifactPreview(null);
      setQaError(err instanceof Error ? err.message : String(err));
    } finally {
      setQaArtifactPreviewLoading(false);
    }
  }, []);

  const handleOpenCommandSource = useCallback(async (sourcePath: string) => {
    if (!isTauriAvailable()) {
      setError('Opening command sources requires the CodeVetter desktop app (Tauri).');
      return;
    }
    try {
      await openInApp('finder', sourcePath);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handlePreviewCommandSource = useCallback(
    async (signal: NonNullable<RepoHistoryContext['command_signals']>[number], key: string) => {
      if (!signal.source_path) {
        setError('No transcript source path is attached to this command.');
        return;
      }
      if (!isTauriAvailable()) {
        setError('Previewing command sources requires the CodeVetter desktop app (Tauri).');
        return;
      }
      const line = Math.max(1, signal.source_line ?? 1);
      setCommandSourcePreviewLoading(key);
      setError(null);
      try {
        if (signal.source === 'raw_session') {
          const preview = await readRawSessionContext(signal.source_path, line, 8, 12);
          setCommandSourcePreview({
            key,
            path: preview.file_path,
            line: preview.target_line,
            language: 'transcript',
            items: preview.items,
          });
        } else {
          const preview = await readFileAroundLine(signal.source_path, line, 2, 2);
          setCommandSourcePreview({
            key,
            path: preview.file_path,
            line: preview.target_line,
            language: preview.language,
            lines: preview.lines,
          });
        }
      } catch (err) {
        setCommandSourcePreview(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setCommandSourcePreviewLoading(null);
      }
    },
    []
  );

  const applyQaToSelectedFinding = useCallback(() => {
    if (qaLastRun == null || selectedFindingIdx === null) return;
    updateFindingEvidence(selectedFindingIdx, syntheticQaToFindingEvidence(qaLastRun));
  }, [qaLastRun, selectedFindingIdx, updateFindingEvidence]);

  const addQaFailureFinding = useCallback(() => {
    if (qaLastRun == null || !result || qaLastRun.pass) return;
    const finding = syntheticQaFailureFinding(qaLastRun);
    const newIdx = result.findings.length;
    setResult({
      ...result,
      findings: [...result.findings, finding],
      findings_count: (result.findings_count ?? result.findings.length) + 1,
    });
    const key = findingEvidenceKey(finding, newIdx);
    setEvidenceByFinding((prev) => ({
      ...prev,
      [key]: syntheticQaToFindingEvidence(qaLastRun),
    }));
    setSelectedFindingIdx(newIdx);
  }, [qaLastRun, result]);

  const handleRecordTestCommandEvent = useCallback(() => {
    if (selectedFindingIdx === null) return;
    const finding = sortedFindings[selectedFindingIdx];
    if (!finding) return;
    const evidence = {
      ...defaultFindingEvidence,
      ...evidenceByFinding[findingEvidenceKey(finding, selectedFindingIdx)],
    };
    recordProcedureExecutionEvents(
      procedureEventsForFindingEvidence(activeProcedureSteps, evidence, finding),
      {
        findingTitle: finding.title,
        findingFile: finding.filePath ?? null,
        evidenceLevel: evidence.level,
        evidenceStatus: evidence.status,
        artifact: evidence.artifact || null,
      }
    );
  }, [
    activeProcedureSteps,
    evidenceByFinding,
    recordProcedureExecutionEvents,
    selectedFindingIdx,
    sortedFindings,
  ]);

  const handleRunVerificationCommand = useCallback(async () => {
    if (!repoPath || !reviewId || selectedFindingIdx === null) return;
    const command = verificationCommand.trim();
    if (!command) return;
    const finding = sortedFindings[selectedFindingIdx];
    if (!finding) return;
    const currentEvidence = {
      ...defaultFindingEvidence,
      ...evidenceByFinding[findingEvidenceKey(finding, selectedFindingIdx)],
    };

    setVerificationCommandRunning(true);
    setVerificationCommandCanceling(false);
    setVerificationCommandError(null);
    const runId = `review-command-${reviewId}-${Date.now()}`;
    setVerificationCommandRunId(runId);
    try {
      const run = await runReviewVerificationCommand({
        repoPath,
        reviewId,
        command,
        stepId: 'rerun_relevant_verification',
        timeoutMs: verificationCommandTimeoutMs,
        runId,
      });
      setStoredProcedureEvents((prev) => [run.event, ...prev]);
      const notes = buildVerificationCommandNotes(currentEvidence.notes, command, run);
      updateFindingEvidence(selectedFindingIdx, {
        level: run.canceled ? currentEvidence.level : 'test',
        status: run.passed ? 'not_reproduced' : run.canceled ? 'not_checked' : 'reproduced',
        artifact: run.artifact,
        notes,
      });
    } catch (err) {
      setVerificationCommandError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerificationCommandRunning(false);
      setVerificationCommandCanceling(false);
      setVerificationCommandRunId(null);
    }
  }, [
    evidenceByFinding,
    repoPath,
    reviewId,
    selectedFindingIdx,
    sortedFindings,
    updateFindingEvidence,
    verificationCommand,
    verificationCommandTimeoutMs,
  ]);

  const handleCancelVerificationCommand = useCallback(async () => {
    if (!verificationCommandRunId) return;
    setVerificationCommandCanceling(true);
    try {
      const result = await cancelReviewVerificationCommand(verificationCommandRunId);
      if (!result.canceled) {
        setVerificationCommandError('Command already finished.');
      }
    } catch (err) {
      setVerificationCommandError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerificationCommandCanceling(false);
    }
  }, [verificationCommandRunId]);

  // ─── Fix handlers ───────────────────────────────────────────────────────

  const toggleFinding = useCallback((idx: number) => {
    setSelectedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // Record / clear the owner's usefulness verdict on a finding. `idx` is into
  // the sorted list. Clicking the already-active verdict clears it to NULL.
  // Only persisted findings (loaded from a saved review, so they carry an id)
  // can be dispositioned; fresh in-webview findings have no row to write.
  const handleSetDisposition = useCallback(
    async (idx: number, disposition: FindingDisposition) => {
      await setFindingDispositionWithRollback(
        idx,
        disposition,
        sortedFindings,
        setResult,
        setSelectedFindings,
        setError
      );
    },
    [sortedFindings]
  );

  const toggleSelectAll = useCallback(() => {
    if (!result) return;
    // "Select all" targets everything not dismissed — dismissed findings are
    // excluded from bulk fix selection (but remain individually selectable).
    const selectable = sortedFindings.reduce<number[]>((acc, finding, idx) => {
      if (finding.disposition !== 'dismissed') acc.push(idx);
      return acc;
    }, []);
    setSelectedFindings((prev) =>
      prev.size >= selectable.length ? new Set() : new Set(selectable)
    );
  }, [result, sortedFindings]);

  const handleFixSelected = useCallback(async () => {
    if (!repoPath || !result || selectedFindings.size === 0) return;
    await applyFixAndPostFixQa(
      repoPath,
      result,
      fixPacket.findings,
      qaRunHistory,
      qaActiveWorkflowId,
      currentQaWorkflow,
      activeProcedureSteps,
      recordProcedureExecutionEvents,
      runSyntheticQaFlow,
      setIsFixing,
      setFixResult,
      setFixCompletedAt,
      setFixProgress,
      setError,
      setPostFixQaRunning,
      setQaError,
      fixLogRef
    );
  }, [
    activeProcedureSteps,
    currentQaWorkflow,
    fixPacket.findings,
    qaActiveWorkflowId,
    qaRunHistory,
    repoPath,
    recordProcedureExecutionEvents,
    result,
    runSyntheticQaFlow,
    selectedFindings.size,
  ]);

  const handleRevertFile = useCallback(
    async (filePath: string) => {
      if (!fixResult?.worktree_path) return;
      try {
        await revertFiles(fixResult.worktree_path, [filePath]);
        const remaining = await getLocalDiff(fixResult.worktree_path);
        setFixResult({ ...fixResult, diff: remaining.diff, changed_files: remaining.files });
      } catch (e) {
        setError(`Revert failed: ${String(e)}`);
      }
    },
    [fixResult]
  );

  const handleRevertHunk = useCallback(
    async (filePath: string, hunk: string) => {
      if (!fixResult?.worktree_path) return;
      try {
        await revertDiffHunk(fixResult.worktree_path, filePath, hunk);
        const remaining = await getLocalDiff(fixResult.worktree_path);
        setFixResult({ ...fixResult, diff: remaining.diff, changed_files: remaining.files });
      } catch (e) {
        setError(`Hunk revert failed: ${String(e)}`);
      }
    },
    [fixResult]
  );

  const handleMergeFix = useCallback(async () => {
    if (!repoPath || !fixResult?.worktree_branch) return;
    try {
      await mergeFix(repoPath, fixResult.worktree_branch, fixResult.worktree_path);
      setFixResult(null);
      setFixCompletedAt(null);
    } catch (e) {
      setError(`Merge failed: ${String(e)}`);
    }
  }, [repoPath, fixResult]);

  const handleDiscardFix = useCallback(async () => {
    if (!repoPath || !fixResult?.worktree_branch) return;
    try {
      await discardFix(repoPath, fixResult.worktree_branch, fixResult.worktree_path);
      setFixResult(null);
      setFixCompletedAt(null);
    } catch (e) {
      setError(`Discard failed: ${String(e)}`);
    }
  }, [repoPath, fixResult]);

  const handleOpenInIDE = useCallback(async () => {
    if (!repoPath || !isTauriAvailable()) return;
    try {
      // Try Cursor first, fall back to VS Code
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        await invoke('open_in_app', { appName: 'cursor', path: repoPath });
      } catch {
        await invoke('open_in_app', { appName: 'vscode', path: repoPath });
      }
    } catch (e) {
      setError(`Could not open IDE: ${String(e)}`);
    }
  }, [repoPath]);

  const handleCopyProof = useCallback(async () => {
    if (!result) return;
    await copyReviewerProof(
      result,
      sortedFindings,
      selectedFindingIdx,
      evidenceByFinding,
      evidenceCounts,
      evidenceCandidateStatuses,
      reviewTimeline,
      qaPostFixComparison,
      historyExplanations,
      historyContext,
      procedureExecutionEvents,
      intentReport,
      historyFindingSummaries,
      audienceBundle,
      setProofCopied
    );
  }, [
    result,
    sortedFindings,
    selectedFindingIdx,
    evidenceCounts,
    evidenceByFinding,
    evidenceCandidateStatuses,
    intentReport,
    procedureExecutionEvents,
    qaPostFixComparison,
    reviewTimeline,
    historyFindingSummaries,
    historyExplanations,
    historyContext,
    audienceBundle,
  ]);

  const handleCopyFindingNote = useCallback(async () => {
    if (!result || selectedFindingIdx === null) return;
    const finding = sortedFindings[selectedFindingIdx];
    if (!finding) return;
    const evidence = {
      ...defaultFindingEvidence,
      ...evidenceByFinding[findingEvidenceKey(finding, selectedFindingIdx)],
    };
    const focusedReviewMemoryGraph = buildFocusedReviewMemoryGraph(
      result.review_memory_graph,
      finding
    );
    const markdown = buildFindingHunkNoteMarkdown({
      diffRange: result.diff_range,
      finding,
      findingIndex: selectedFindingIdx,
      evidence,
      historySummary: historyFindingSummaries.get(selectedFindingIdx),
      focusedReviewMemoryGraph,
    });

    try {
      await navigator.clipboard.writeText(markdown);
      setFindingNoteCopied(true);
      setTimeout(() => setFindingNoteCopied(false), 2000);
    } catch {
      // clipboard unavailable — fail silently
    }
  }, [result, selectedFindingIdx, sortedFindings, evidenceByFinding, historyFindingSummaries]);

  const handleCopyFixPacket = useCallback(async () => {
    if (fixPacket.findings.length === 0) return;
    try {
      await navigator.clipboard.writeText(renderAgentFixPacketMarkdown(fixPacket));
      setPacketCopied(true);
      setTimeout(() => setPacketCopied(false), 2000);
    } catch {
      // clipboard unavailable — fail silently
    }
  }, [fixPacket]);

  const handleCopyTimelineSegmentPacket = useCallback(
    async (item: VerificationTimelineItem) => {
      await copyTimelineSegmentPacket(
        item,
        timelineSegmentFindingIndexes,
        sortedFindings,
        evidenceByFinding,
        browserEvidenceByFinding,
        currentTaskContext,
        repoPath,
        resultDiffRange,
        diffRange,
        resultAgent,
        setSelectedFindings,
        setTimelinePacketCopiedId
      );
    },
    [
      browserEvidenceByFinding,
      currentTaskContext,
      diffRange,
      evidenceByFinding,
      repoPath,
      resultAgent,
      resultDiffRange,
      sortedFindings,
      timelineSegmentFindingIndexes,
    ]
  );

  // Track which diff files are expanded
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const toggleFileExpanded = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Parse diff into files only when the fix diff changes, not on every render.
  const fixDiff = fixResult?.diff;
  const diffFiles = useMemo(() => (fixDiff ? parseDiffIntoFiles(fixDiff) : []), [fixDiff]);

  const hunkNavTargets = useMemo(
    () =>
      diffFiles.flatMap((file) =>
        file.hunks.map((_, hunkIndex) => ({
          key: `${file.path}:${hunkIndex}`,
          filePath: file.path,
          hunkIndex,
        }))
      ),
    [diffFiles]
  );
  const [activeHunkNavIndex, setActiveHunkNavIndex] = useState(0);
  const hunkNavRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    setActiveHunkNavIndex(0);
  }, [fixDiff]);

  useEffect(() => {
    if (!fixResult || hunkNavTargets.length === 0) return;
    const target = hunkNavTargets[Math.min(activeHunkNavIndex, hunkNavTargets.length - 1)];
    if (!target) return;
    setExpandedFiles((prev) => {
      if (prev.size === 0 || prev.has(target.filePath)) return prev;
      const next = new Set(prev);
      next.add(target.filePath);
      return next;
    });
    const node = hunkNavRefs.current.get(target.key);
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeHunkNavIndex, fixResult, hunkNavTargets]);

  useEffect(() => {
    if (!fixResult || hunkNavTargets.length === 0) return;
    function isInputFocused(event: KeyboardEvent): boolean {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (isInputFocused(event)) return;
      if (event.key !== '[' && event.key !== ']') return;
      event.preventDefault();
      setActiveHunkNavIndex((prev) => {
        if (event.key === '[') {
          return Math.max(0, prev - 1);
        }
        return Math.min(hunkNavTargets.length - 1, prev + 1);
      });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fixResult, hunkNavTargets]);

  const handleReReview = useCallback(() => {
    setFixResult(null);
    setFixCompletedAt(null);
    setSelectedFindings(new Set());
    setSelectedFindingIdx(null);
    setCodeLines([]);
    setCodeFilePath('');
    setCodeLanguage('');
    handleReview();
  }, [handleReview]);

  // ─── Finding click → load code ──────────────────────────────────────────

  const handleFindingClick = useCallback(
    async (idx: number) => {
      const requestId = ++sourceRequestIdRef.current;
      setSelectedFindingIdx(idx);
      const finding = sortedFindings[idx];
      if (!finding?.filePath || finding.line == null) {
        setCodeLines([]);
        setCodeFilePath(finding?.filePath ?? '');
        setCodeLanguage('');
        setSourceLoading(false);
        return;
      }
      setCodeLines([]);
      setCodeFilePath(finding.filePath);
      setCodeLanguage('');
      setSourceLoading(true);
      try {
        const res = await readFileAroundLine(
          `${repoPath}/${finding.filePath}`,
          finding.line,
          15,
          15
        );
        if (sourceRequestIdRef.current !== requestId) return;
        setCodeLines(res.lines);
        setCodeFilePath(res.file_path);
        setCodeLanguage(res.language);
        setSourceLoading(false);
      } catch (e) {
        if (sourceRequestIdRef.current !== requestId) return;
        console.error('[Review] failed to load code:', e);
        setCodeLines([]);
        setCodeFilePath(finding.filePath);
        setCodeLanguage('');
        setSourceLoading(false);
      }
    },
    [sortedFindings, repoPath]
  );

  useEffect(() => {
    if (
      mode !== 'view' ||
      fixResult ||
      selectedFindingIdx !== null ||
      sortedFindings.length === 0
    ) {
      return;
    }

    void handleFindingClick(0);
  }, [fixResult, handleFindingClick, mode, selectedFindingIdx, sortedFindings.length]);

  // ─── Jump from blast-radius caller → code viewer ─────────────────────────

  const handleJumpToCaller = useCallback(
    async (file: string, line: number) => {
      const requestId = ++sourceRequestIdRef.current;
      setSelectedFindingIdx(null);
      if (!repoPath) return;
      setCodeLines([]);
      setCodeFilePath(file);
      setCodeLanguage('');
      setSourceLoading(true);
      try {
        const res = await readFileAroundLine(`${repoPath}/${file}`, line, 15, 15);
        if (sourceRequestIdRef.current !== requestId) return;
        setCodeLines(res.lines);
        setCodeFilePath(res.file_path);
        setCodeLanguage(res.language);
        setSourceLoading(false);
      } catch (e) {
        if (sourceRequestIdRef.current !== requestId) return;
        console.error('[Review] failed to load caller code:', e);
        setCodeLines([]);
        setCodeFilePath(file);
        setCodeLanguage('');
        setSourceLoading(false);
      }
    },
    [repoPath]
  );

  const handleTimelineJump = useCallback(
    async (jump: VerificationTimelineJumpTarget) => {
      if (jump.kind === 'finding') {
        if (jump.findingIndex == null) return;
        await handleFindingClick(jump.findingIndex);
        return;
      }

      if (jump.kind === 'file') {
        const requestId = ++sourceRequestIdRef.current;
        setCodeLines([]);
        setCodeFilePath(jump.path ?? '');
        setCodeLanguage('');
        setSourceLoading(true);
        await handleTimelineFileJump(
          jump,
          repoPath,
          setSelectedFindingIdx,
          setCodeLines,
          setCodeFilePath,
          setCodeLanguage,
          () => sourceRequestIdRef.current === requestId
        );
        if (sourceRequestIdRef.current === requestId) setSourceLoading(false);
        return;
      }

      if (jump.kind === 'artifact') {
        await handleTimelineArtifactJump(jump, handlePreviewQaArtifact, handleOpenQaArtifact);
        return;
      }

      if (jump.kind === 'command_source') {
        await handleTimelineCommandSourceJump(
          jump,
          setError,
          setCommandSourcePreviewLoading,
          setCommandSourcePreview
        );
      }
    },
    [handleFindingClick, handleOpenQaArtifact, handlePreviewQaArtifact, repoPath]
  );

  // ─── Render ─────────────────────────────────────────────────────────────

  const audienceDefaultArtifact = resolveAudienceDefaultArtifact(qaLastRun, qaBaseUrl);

  // ─── View mode layout ────────────────────────────────────────────────────

  if (mode === 'view' && result) {
    const {
      activeFinding,
      activeCodePath,
      activeEvidence,
      activeBrowserEvidence,
      evidenceCandidates,
      evidenceProcedureSteps,
      reviewMemoryGraph,
      reviewManifest,
      coverageCounts,
      focusedReviewMemoryGraph,
      procedureEventsByStep,
    } = computeViewModeLocals(
      result,
      selectedFindingIdx,
      sortedFindings,
      codeFilePath,
      evidenceByFinding,
      browserEvidenceByFinding,
      procedureExecutionEvents
    );
    const sourceAvailable =
      !activeFinding ||
      sourceLoading ||
      codeLines.length > 0 ||
      fixResult !== null ||
      isFixing !== null;
    const projectName = selectedProject?.display_name ?? repoLabelFromPath(repoPath);
    const reviewDecision = deriveVerificationDecisionSummary({
      fixedCount: evidenceCounts.fixed,
      reproducedCount: evidenceCounts.reproduced,
      notReproducedCount: evidenceCounts.notReproduced,
      uncheckedCount: uncheckedFindings.length,
      executionFailureCount: 0,
      blockedProcedureCount: procedureExecutionEvents.filter((event) => event.status === 'blocked')
        .length,
      satisfiedProcedureCount: procedureExecutionEvents.filter(
        (event) => event.status === 'satisfied'
      ).length,
    });
    const sourcePanel = sourceAvailable ? (
      <section aria-label="Finding source" className="h-full min-h-0 min-w-0 overflow-hidden">
        <ReviewEditorPanel
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
          isFixing={isFixing}
          fixLogRef={fixLogRef}
          fixProgress={fixProgress}
          selectedFindingIdx={selectedFindingIdx}
          activeFinding={activeFinding}
          activeCodePath={activeCodePath}
          codeLanguage={codeLanguage}
          codeLines={codeLines}
          sourceLoading={sourceLoading}
        />
      </section>
    ) : (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#030405] px-8 text-center">
        <Zap size={22} className="text-slate-700" aria-hidden="true" />
        <p className="text-[13px] font-medium text-slate-300">Source snapshot unavailable</p>
        <p className="max-w-md text-[12px] leading-5 text-[var(--cv-text-muted)]">
          Reopen {projectName} to inspect the referenced line. The finding and recorded evidence
          remain available in the dock below.
        </p>
      </div>
    );
    const findingsPanel = (
      <FindingsListPanel
        sortedFindings={sortedFindings}
        patchQueue={patchQueue}
        handleCopyFixPacket={handleCopyFixPacket}
        packetCopied={packetCopied}
        fixPacket={fixPacket}
        taskGoal={taskGoal}
        taskAcceptance={taskAcceptance}
        patchQueueSeverityCounts={patchQueueSeverityCounts}
        handleFindingClick={handleFindingClick}
        evidenceByFinding={evidenceByFinding}
        findingEvidenceKey={findingEvidenceKey}
        historyFindingSummaries={historyFindingSummaries}
        selectedFindingIdx={selectedFindingIdx}
        selectedFindings={selectedFindings}
        toggleFinding={toggleFinding}
        handleSetDisposition={handleSetDisposition}
      />
    );
    const evidencePanel = (
      <div className="grid h-full min-h-0 grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)] divide-x divide-[var(--cv-line)] max-[1100px]:grid-cols-1 max-[1100px]:grid-rows-2 max-[1100px]:divide-x-0 max-[1100px]:divide-y">
        <div className="min-h-0 overflow-y-auto">
          <VerificationSummaryPanel
            sortedFindings={sortedFindings}
            evidenceProcedureSteps={evidenceProcedureSteps}
            procedureExecutionEvents={procedureExecutionEvents}
            intentReport={intentReport}
            uncheckedFindings={uncheckedFindings}
            verificationOpen={verificationOpen}
            setVerificationOpen={setVerificationOpen}
            evidenceCounts={evidenceCounts}
            handleCopyProof={handleCopyProof}
            proofCopied={proofCopied}
            handleCopyFindingNote={handleCopyFindingNote}
            findingNoteCopied={findingNoteCopied}
            selectedFindingIdx={selectedFindingIdx}
            procedureEventsByStep={procedureEventsByStep}
            procedureEventKey={procedureEventKey}
            procedureEventTimeLabel={procedureEventTimeLabel}
            uncheckedBySeverity={uncheckedBySeverity}
            warmExecutionFindings={warmExecutionFindings}
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {activeFinding ? (
            <SelectedFindingDetail
              activeFinding={activeFinding}
              selectedFindingIdx={selectedFindingIdx}
              repoPath={repoPath}
              selectedBranch={selectedBranch}
              baseBranch={baseBranch}
              reviewId={reviewId}
              qaWorkflowScopeLabel={qaWorkflowScopeLabel}
              qaActiveWorkflowId={qaActiveWorkflowId}
              qaWorkflows={qaWorkflows}
              qaWorkflowName={qaWorkflowName}
              setQaWorkflowName={setQaWorkflowName}
              handleSelectQaWorkflow={handleSelectQaWorkflow}
              handleSaveQaWorkflow={handleSaveQaWorkflow}
              handleDeleteQaWorkflow={handleDeleteQaWorkflow}
              qaActiveTargetId={qaActiveTargetId}
              qaTargets={qaTargets}
              handleSelectQaTarget={handleSelectQaTarget}
              qaBaseUrl={qaBaseUrl}
              setQaBaseUrl={setQaBaseUrl}
              qaAllowRemoteTarget={qaAllowRemoteTarget}
              setQaAllowRemoteTarget={setQaAllowRemoteTarget}
              qaTargetName={qaTargetName}
              setQaTargetName={setQaTargetName}
              qaTargetRoute={qaTargetRoute}
              setQaTargetRoute={setQaTargetRoute}
              qaAuthMode={qaAuthMode}
              setQaAuthMode={setQaAuthMode}
              qaStorageStatePath={qaStorageStatePath}
              setQaStorageStatePath={setQaStorageStatePath}
              qaLoopId={qaLoopId}
              setQaLoopId={setQaLoopId}
              setQaGoal={setQaGoal}
              qaGoal={qaGoal}
              qaRunnerType={qaRunnerType}
              setQaRunnerType={setQaRunnerType}
              qaRepoSpecPath={qaRepoSpecPath}
              setQaRepoSpecPath={setQaRepoSpecPath}
              qaSpecLoading={qaSpecLoading}
              qaSpecCandidates={qaSpecCandidates}
              qaSpecError={qaSpecError}
              handleDiscoverQaSpecs={handleDiscoverQaSpecs}
              qaRepoTraceMode={qaRepoTraceMode}
              setQaRepoTraceMode={setQaRepoTraceMode}
              qaExternalCommand={qaExternalCommand}
              setQaExternalCommand={setQaExternalCommand}
              handleSaveQaTarget={handleSaveQaTarget}
              handleDeleteQaTarget={handleDeleteQaTarget}
              handleRunSyntheticQa={handleRunSyntheticQa}
              qaRunning={qaRunning}
              qaError={qaError}
              qaLastRun={qaLastRun}
              qaArtifactPreview={qaArtifactPreview}
              qaArtifactPreviewLoading={qaArtifactPreviewLoading}
              handlePreviewQaArtifact={handlePreviewQaArtifact}
              handleOpenQaArtifact={handleOpenQaArtifact}
              setQaArtifactPreview={setQaArtifactPreview}
              applyQaToSelectedFinding={applyQaToSelectedFinding}
              addQaFailureFinding={addQaFailureFinding}
              qaEvidenceHistory={qaEvidenceHistory}
              qaPostFixComparison={qaPostFixComparison}
              postFixQaRunning={postFixQaRunning}
              handleRunPostFixQa={handleRunPostFixQa}
              activeEvidence={activeEvidence}
              updateFindingEvidence={updateFindingEvidence}
              activeBrowserEvidence={activeBrowserEvidence}
              updateBrowserEvidence={updateBrowserEvidence}
              verificationCommand={verificationCommand}
              setVerificationCommand={setVerificationCommand}
              verificationCommandSuggestions={verificationCommandSuggestions}
              verificationCommandSuggestionsLoading={verificationCommandSuggestionsLoading}
              verificationCommandTimeoutMs={verificationCommandTimeoutMs}
              setVerificationCommandTimeoutMs={setVerificationCommandTimeoutMs}
              verificationCommandRunning={verificationCommandRunning}
              handleRunVerificationCommand={handleRunVerificationCommand}
              verificationCommandRunId={verificationCommandRunId}
              verificationCommandCanceling={verificationCommandCanceling}
              handleCancelVerificationCommand={handleCancelVerificationCommand}
              verificationCommandError={verificationCommandError}
              handleRecordTestCommandEvent={handleRecordTestCommandEvent}
              toggleRevalidationItem={toggleRevalidationItem}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <CheckCircle size={20} className="text-emerald-300" />
              <p className="text-[13px] font-medium text-slate-200">No review findings</p>
              <p className="max-w-sm text-[12px] leading-5 text-[var(--cv-text-muted)]">
                Runtime evidence and coverage limits still determine shipping confidence.
              </p>
            </div>
          )}
        </div>
      </div>
    );
    const historyPanel = (
      <div className="grid h-full min-h-0 grid-cols-2 divide-x divide-[var(--cv-line)] overflow-hidden max-[1100px]:grid-cols-1 max-[1100px]:grid-rows-2 max-[1100px]:divide-x-0 max-[1100px]:divide-y">
        <div className="min-h-0 overflow-y-auto">
          <AgentStatusTimeline
            reviewTimeline={reviewTimeline}
            timelineSegmentFindingIndexes={timelineSegmentFindingIndexes}
            expandedTimelineItems={expandedTimelineItems}
            setExpandedTimelineItems={setExpandedTimelineItems}
            timelinePacketCopiedId={timelinePacketCopiedId}
            handleCopyTimelineSegmentPacket={handleCopyTimelineSegmentPacket}
            handleTimelineJump={handleTimelineJump}
          />
        </div>
        <div className="min-h-0 overflow-y-auto">
          <BlastRadiusSection
            blastReport={blastReport}
            blastLoading={blastLoading}
            blastError={blastError}
            deepGraphImpact={deepGraphImpact}
            deepGraphImpactLoading={deepGraphImpactLoading}
            handleJumpToCaller={handleJumpToCaller}
          />
          <MemoryGraphPanels
            reviewMemoryGraph={reviewMemoryGraph}
            focusedReviewMemoryGraph={focusedReviewMemoryGraph}
          />
        </div>
      </div>
    );
    const limitationsPanel = (
      <div className="grid h-full min-h-0 grid-cols-2 divide-x divide-[var(--cv-line)] overflow-hidden max-[1100px]:grid-cols-1 max-[1100px]:grid-rows-2 max-[1100px]:divide-x-0 max-[1100px]:divide-y">
        <div className="min-h-0 overflow-y-auto">
          <EvidenceInsightsPanel
            historyExplanations={historyExplanations}
            selectedFindingHistoryExplanation={selectedFindingHistoryExplanation}
            evidenceCandidates={evidenceCandidates}
            evidenceCandidateStatuses={evidenceCandidateStatuses}
            updateEvidenceCandidateStatus={updateEvidenceCandidateStatus}
          />
        </div>
        <div className="min-h-0 overflow-y-auto">
          <AudienceValidationPanel
            reviewId={reviewId}
            repoPath={repoPath}
            defaultArtifact={audienceDefaultArtifact}
            onBundleChange={setAudienceBundle}
          />
          <XrayExportPanel reviewId={reviewId} findings={sortedFindings} />
        </div>
      </div>
    );

    return (
      <ProjectWorkspaceShell mainClassName="overflow-hidden" showProjectSidebar={false}>
        <div className="flex h-full flex-col px-4 pb-4">
          <ResultHeader
            result={result}
            diffRange={diffRange}
            projectName={projectName}
            repoPath={repoPath}
            sortedFindings={sortedFindings}
            evidenceCounts={evidenceCounts}
            handleNewReview={handleNewReview}
          />

          {/* Error banner */}
          {error && (
            <div role="alert" className="shrink-0 bg-red-500/10 px-4 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {reviewManifest && (
            <ReviewReceipt
              reviewManifest={reviewManifest}
              coverageCounts={coverageCounts}
              readiness={result.review_readiness}
            />
          )}

          <InlineReviewWorkbench
            decision={reviewDecision}
            activeFinding={activeFinding}
            activeFindingIndex={selectedFindingIdx}
            findingCount={sortedFindings.length}
            verifiedCount={evidenceCounts.fixed + evidenceCounts.reproduced}
            activeEvidence={activeEvidence}
            selectedForPatch={
              selectedFindingIdx !== null && selectedFindings.has(selectedFindingIdx)
            }
            dockTab={reviewDockTab}
            onDockTabChange={setReviewDockTab}
            onTogglePatch={() => {
              if (selectedFindingIdx !== null) toggleFinding(selectedFindingIdx);
            }}
            onSetDisposition={(disposition) => {
              if (selectedFindingIdx !== null) {
                void handleSetDisposition(selectedFindingIdx, disposition);
              }
            }}
            source={sourcePanel}
            findings={findingsPanel}
            evidence={evidencePanel}
            history={historyPanel}
            limitations={limitationsPanel}
            footer={
              <FixFooter
                selectableFindingCount={selectableFindingCount}
                selectedFindings={selectedFindings}
                isFixing={isFixing}
                viewHasRepoPath={viewHasRepoPath}
                toggleSelectAll={toggleSelectAll}
                handleFixSelected={handleFixSelected}
              />
            }
          />
        </div>
      </ProjectWorkspaceShell>
    );
  }

  // ─── Create mode layout ─────────────────────────────────────────────────

  return (
    <ProjectWorkspaceShell mainClassName="flex flex-col overflow-hidden">
      {!repoPath ? (
        <ProjectWorkspaceEmpty
          title={VERIFICATION_COPY.reviewTitle}
          description="Select a project, then choose an exact branch or pull request. Review findings are leads; executable checks determine confidence."
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--cv-line)] px-4 py-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">
                {VERIFICATION_COPY.reviewTitle}
              </h1>
              <p className="truncate font-mono text-xs text-slate-500">
                {selectedProject?.display_name ?? repoPath.split('/').pop()} · {repoPath}
              </p>
            </div>
            <Link
              to="/settings?section=rubrics"
              title="Choose the standards pack CodeVetter applies when reviewing"
              className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-[var(--cv-accent)]"
            >
              <ClipboardCheck size={12} />
              Rubric
            </Link>
          </div>
          <div className="flex min-h-0 flex-1 gap-4 p-4">
            <ReviewSetupPanel
              repoPath={repoPath}
              error={error}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              pullRequests={pullRequests}
              branches={branches}
              handleSelectBranch={handleSelectBranch}
              selectedBranch={selectedBranch}
              currentBranch={currentBranch}
              baseBranch={baseBranch}
              handleSelectPR={handleSelectPR}
              diffRange={diffRange}
              projectDesc={projectDesc}
              setProjectDesc={setProjectDesc}
              handleProjectDescBlur={handleProjectDescBlur}
              changeDesc={changeDesc}
              setChangeDesc={setChangeDesc}
              taskGoal={taskGoal}
              setTaskGoal={setTaskGoal}
              handleTaskContextBlur={handleTaskContextBlur}
              taskAcceptance={taskAcceptance}
              setTaskAcceptance={setTaskAcceptance}
              taskNonGoals={taskNonGoals}
              setTaskNonGoals={setTaskNonGoals}
              taskSourceLabel={taskSourceLabel}
              setTaskSourceLabel={setTaskSourceLabel}
              historyLoading={historyLoading}
              historyContext={historyContext}
              historyFileSummaries={historyFileSummaries}
              commandSourcePreviewLoading={commandSourcePreviewLoading}
              handlePreviewCommandSource={handlePreviewCommandSource}
              handleOpenCommandSource={handleOpenCommandSource}
              commandSourcePreview={commandSourcePreview}
              setCommandSourcePreview={setCommandSourcePreview}
              handleReview={handleReview}
              handleCancelReview={handleCancelReview}
              isReviewing={isReviewing}
              pastReviewsLoading={pastReviewsLoading}
              pastReviews={pastReviews}
              showHistory={showHistory}
              setShowHistory={setShowHistory}
              handleLoadPastReview={handleLoadPastReview}
              handleDeletePastReview={handleDeletePastReview}
              result={result}
            />
            <CreatePreviewPanel isReviewing={isReviewing} />
          </div>
        </div>
      )}
    </ProjectWorkspaceShell>
  );
}

// ─── FindingItem ──────────────────────────────────────────────────────────────
