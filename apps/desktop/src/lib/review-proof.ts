import type { ReviewIntentReport } from '@/lib/intent-debugger/types';
import type { FindingEvidence } from '@/lib/synthetic-qa/apply-evidence';
import { renderQualifiedGraphPath } from '@/lib/graph-trust';
import type {
  CliReviewFinding,
  EvidenceCandidate,
  EvidenceProcedureStep,
  RepoHistoryContext,
  ReviewMemoryGraph,
  TrustedReviewGraphContext,
} from '@/lib/tauri-ipc';

interface EvidenceCounts {
  fixed: number;
  reproduced: number;
  notReproduced: number;
}

export interface HistoryFindingSummary {
  findingIdx: number;
  file: string;
  commits: number;
  decisions: number;
  recurring: number;
  commands: number;
  claims: number;
  topDecision?: string;
  topCommit?: string;
  topClaim?: string;
  topCommands?: string[];
}

export interface RevalidationItem {
  id: string;
  label: string;
}

export type EvidenceCandidateStatus =
  | 'open'
  | 'confirmed'
  | 'needs_proof'
  | 'rejected'
  | 'irrelevant';

export interface ProcedureExecutionEvent {
  stepId: string;
  status: 'satisfied' | 'blocked' | 'observed';
  source: string;
  summary: string;
  artifact?: string;
  createdAt?: string;
}

type VerificationTimelineStatus = 'done' | 'active' | 'blocked' | 'idle';

type VerificationTimelineJumpKind = 'finding' | 'file' | 'artifact' | 'command_source';

export interface VerificationTimelineJumpTarget {
  kind: VerificationTimelineJumpKind;
  label: string;
  findingIndex?: number | null;
  path?: string | null;
  line?: number | null;
  source?: string | null;
}

export interface VerificationTimelineItem {
  id: string;
  phase: 'task' | 'review' | 'qa' | 'evidence' | 'fix' | 'worktree';
  label: string;
  detail: string;
  status: VerificationTimelineStatus;
  anchors?: VerificationTimelineAnchor[];
  jump?: VerificationTimelineJumpTarget | null;
}

/**
 * Read-only projection of a differential run. It intentionally has no pass
 * status, findings, or jump-to-artifact evidence: a comparison is additive
 * history and can never satisfy normal warm verification.
 */
export interface DifferentialVerificationHistoryItem {
  id: string;
  createdAt: string;
  summary: {
    classification: 'regressed' | 'improved' | 'unchanged' | 'incomparable';
    candidate_kind: 'worktree' | 'staged' | 'commit' | 'range';
    scenario_count: number;
    delta_count: number;
    blocking_delta_count: number;
    duration_ms: number;
    reason_codes: string[];
    creates_pass_evidence: false;
  };
}

export function projectDifferentialVerificationHistory(
  runs: readonly DifferentialVerificationHistoryItem[]
): VerificationTimelineItem[] {
  return [...runs]
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
    )
    .slice(0, 8)
    .map(({ id, createdAt, summary }) => {
      const reasons = summary.reason_codes.slice(0, 2).join(', ');
      return {
        id: `differential-history:${id}`,
        phase: 'qa',
        label: 'Differential comparison history',
        detail: [
          `recorded ${createdAt}`,
          summary.classification,
          `${summary.candidate_kind} candidate`,
          `${summary.scenario_count} scenarios`,
          `${summary.delta_count} deltas`,
          summary.blocking_delta_count > 0 ? `${summary.blocking_delta_count} blocking` : null,
          `${summary.duration_ms}ms`,
          reasons ? `reasons: ${reasons}` : null,
          'comparison-only; warm verification still required',
        ]
          .filter(Boolean)
          .join(' · '),
        // A differential result is deliberately never displayed as a passing
        // review-proof state, even when its classification is improved.
        status: 'idle',
      };
    });
}

interface VerificationTimelineAnchor {
  id: string;
  label: string;
  source: string;
  status?: 'passed' | 'failed' | 'stale' | 'unknown';
  contextExcerpt?: string[];
  conversationContext?: NonNullable<
    NonNullable<RepoHistoryContext['command_signals']>[number]['conversation_window']
  >;
  sourcePath?: string | null;
  sourceLine?: number | null;
  eventId?: string | null;
  sessionId?: string | null;
  artifact?: string | null;
  jump?: VerificationTimelineJumpTarget | null;
}

export interface VerificationTimelineInput {
  runId?: string | null;
  taskGoal?: string;
  review?: {
    findingsCount: number;
    mode?: string;
    riskTier?: string;
    selectedFindingIndex?: number | null;
    firstFindingPath?: string | null;
    firstFindingLine?: number | null;
    findingPaths?: string[];
  } | null;
  isReviewing?: boolean;
  qa?: {
    running?: boolean;
    latest?: {
      pass: boolean;
      runnerType: string;
      route?: string;
      goal: string;
      durationMs: number;
      screenshotPath?: string | null;
      artifacts?: string[];
    } | null;
    comparison?: QaPostFixComparison | null;
  };
  evidenceCounts: EvidenceCounts;
  fixPacket?: {
    selectedFindings: number;
    routeAdvice: string;
    selectedFindingIndex?: number | null;
  } | null;
  isFixing?: boolean;
  fixResult?: {
    success?: boolean;
    agent?: string;
    usingWorktree?: boolean;
    worktreePath?: string | null;
    changedFiles?: number;
    changedFileOrigins?: {
      path: string;
      status?: string | null;
    }[];
    findingsFixed?: number;
  } | null;
  history?: Pick<RepoHistoryContext, 'command_signals' | 'agent_claims'> | null;
}

export interface TimelineSegmentFindingSelectionInput {
  segmentId: string;
  findingsCount: number;
  selectedFindingIndexes?: number[];
  activeFindingIndex?: number | null;
  evidenceStatuses?: Array<FindingEvidence['status'] | null | undefined>;
}

export interface QaComparisonRun {
  createdAt: string;
  loopId: string;
  runnerType: string;
  baseUrl: string;
  goal: string;
  route?: string;
  pass: boolean;
  durationMs: number;
  notes: string;
  artifacts?: string[];
  consoleErrors: number;
  /** Exact execution-flow identity for richer runners such as warm verifyd. */
  flowKey?: string;
}

type QaPostFixComparisonStatus =
  | 'needs_rerun'
  | 'fixed'
  | 'still_broken'
  | 'regressed'
  | 'still_passing';

export interface QaPostFixComparison {
  status: QaPostFixComparisonStatus;
  summary: string;
  flowKey: string;
  before: QaComparisonRun;
  after?: QaComparisonRun;
}

export interface CodebaseHistoryExplanation {
  file: string;
  summary: string;
  confidence: 'strong' | 'thin';
  counts: {
    commits: number;
    decisions: number;
    recurring: number;
    agents: number;
    commands: number;
  };
  citations: string[];
}

export interface ReviewerProofInput {
  diffRange: string;
  score: number;
  agent: string;
  findings: CliReviewFinding[];
  evidence: FindingEvidence[];
  evidenceCounts: EvidenceCounts;
  evidenceCandidates?: EvidenceCandidate[];
  evidenceCandidateStatuses?: Record<string, EvidenceCandidateStatus>;
  evidenceProcedureSteps?: EvidenceProcedureStep[];
  reviewMemoryGraph?: ReviewMemoryGraph;
  focusedReviewMemoryGraph?: ReviewMemoryGraph | null;
  trustedGraphContext?: TrustedReviewGraphContext | null;
  verificationTimeline?: VerificationTimelineItem[];
  qaPostFixComparison?: QaPostFixComparison | null;
  historyExplanations?: CodebaseHistoryExplanation[];
  temporalHistory?: RepoHistoryContext['temporal_slice'];
  procedureExecutionEvents?: ProcedureExecutionEvent[];
  intentReport: ReviewIntentReport | null;
  historyFindingSummaries: Map<number, HistoryFindingSummary>;
}

export interface FindingHunkNoteInput {
  diffRange: string;
  finding: CliReviewFinding;
  findingIndex: number;
  evidence: FindingEvidence;
  historySummary?: HistoryFindingSummary;
  focusedReviewMemoryGraph?: ReviewMemoryGraph | null;
}

function graphNodeMatchesFinding(
  node: ReviewMemoryGraph['nodes'][number],
  finding: CliReviewFinding
): boolean {
  const filePath = finding.filePath?.trim();
  const title = finding.title.trim().toLowerCase();
  const summary = finding.summary.trim().toLowerCase();
  const nodeText = [node.label, node.file_path ?? '', node.detail ?? ''].join(' ').toLowerCase();

  if (filePath && (node.file_path === filePath || node.label === filePath)) {
    return true;
  }
  if (filePath && nodeText.includes(filePath.toLowerCase())) {
    return true;
  }
  if (title && nodeText.includes(title)) {
    return true;
  }
  return Boolean(summary && summary.length < 120 && nodeText.includes(summary));
}

export function buildFocusedReviewMemoryGraph(
  graph: ReviewMemoryGraph | null | undefined,
  finding: CliReviewFinding | null | undefined
): ReviewMemoryGraph | null {
  if (!graph || !finding || graph.nodes.length === 0) return null;

  const directIds = new Set(
    graph.nodes.filter((node) => graphNodeMatchesFinding(node, finding)).map((node) => node.id)
  );
  if (directIds.size === 0) return null;

  const edgeIds = new Set<string>();
  const nodeIds = new Set(directIds);
  for (const edge of graph.edges) {
    if (directIds.has(edge.from) || directIds.has(edge.to)) {
      edgeIds.add(`${edge.from}\u0000${edge.kind}\u0000${edge.to}`);
      nodeIds.add(edge.from);
      nodeIds.add(edge.to);
    }
  }

  const nodes = graph.nodes.filter((node) => nodeIds.has(node.id)).slice(0, 10);
  const keptNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter(
      (edge) =>
        edgeIds.has(`${edge.from}\u0000${edge.kind}\u0000${edge.to}`) &&
        keptNodeIds.has(edge.from) &&
        keptNodeIds.has(edge.to)
    )
    .slice(0, 12);

  return {
    schema_version: graph.schema_version,
    scope: finding.filePath ? `finding:${finding.filePath}` : `finding:${finding.title}`,
    nodes,
    edges,
    truncated: graph.truncated || nodes.length < nodeIds.size || edges.length < edgeIds.size,
  };
}

export function formatHistoryCommandEvidence(
  signal: NonNullable<RepoHistoryContext['command_signals']>[number]
): string {
  const parts = [
    signal.status && signal.status !== 'unknown' ? signal.status : null,
    signal.source ? `${signal.source}${signal.source_line ? `:${signal.source_line}` : ''}` : null,
    signal.event_id ? `event=${signal.event_id}` : null,
    signal.artifacts && signal.artifacts.length > 0
      ? `${signal.artifacts.length} artifact${signal.artifacts.length === 1 ? '' : 's'}`
      : null,
    signal.context_excerpt && signal.context_excerpt.length > 0
      ? `context=${signal.context_excerpt[0]}`
      : null,
    signal.source_path ? `source=${signal.source_path}` : null,
  ].filter(Boolean);
  return `${signal.agent}: ${signal.command}${parts.length > 0 ? ` [${parts.join('; ')}]` : ''}`;
}

function buildCommandTimelineAnchors(
  signals: NonNullable<RepoHistoryContext['command_signals']> | undefined
): VerificationTimelineAnchor[] {
  return (signals ?? []).slice(0, 4).map((signal, idx) => {
    const sourcePath = signal.source_path ?? null;
    const artifact = signal.artifacts?.[0] ?? null;
    const jump: VerificationTimelineJumpTarget | null = sourcePath
      ? {
          kind: 'command_source',
          label: 'Preview command source',
          path: sourcePath,
          line: signal.source_line ?? null,
          source: signal.source,
        }
      : artifact
        ? {
            kind: 'artifact',
            label: 'Open command artifact',
            path: artifact,
            source: signal.source,
          }
        : null;

    return {
      id: signal.event_id ?? signal.talk_id ?? signal.session_id ?? `command-${idx}`,
      label: signal.command,
      source: signal.source,
      status: signal.status ?? 'unknown',
      contextExcerpt: signal.context_excerpt?.slice(0, 2) ?? [],
      conversationContext: signal.conversation_window,
      sourcePath,
      sourceLine: signal.source_line ?? null,
      eventId: signal.event_id ?? null,
      sessionId: signal.session_id ?? null,
      artifact,
      jump,
    };
  });
}

function buildTranscriptReplayTimelineAnchors(
  commandAnchors: VerificationTimelineAnchor[]
): VerificationTimelineAnchor[] {
  const groups = new Map<string, VerificationTimelineAnchor[]>();
  commandAnchors
    .filter((anchor) => anchor.sourcePath && anchor.jump?.kind === 'command_source')
    .forEach((anchor) => {
      const key = `${anchor.sessionId ?? 'session'}:${anchor.source}:${anchor.sourcePath}`;
      groups.set(key, [...(groups.get(key) ?? []), anchor]);
    });

  return Array.from(groups.values())
    .filter((anchors) => anchors.length >= 2)
    .slice(0, 2)
    .map((anchors, idx) => {
      const ordered = [...anchors].sort((a, b) => (a.sourceLine ?? 0) - (b.sourceLine ?? 0));
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const failedCount = ordered.filter((anchor) => anchor.status === 'failed').length;
      const passedCount = ordered.filter((anchor) => anchor.status === 'passed').length;
      const status: VerificationTimelineAnchor['status'] =
        failedCount > 0 ? 'failed' : passedCount > 0 ? 'passed' : 'unknown';
      const contextExcerpt = ordered.slice(0, 4).map((anchor, eventIdx) => {
        const statusText = anchor.status ?? 'unknown';
        const lineText = anchor.sourceLine != null ? `line ${anchor.sourceLine}` : 'no line';
        return `${eventIdx + 1}. ${statusText} ${lineText}: ${anchor.label}`;
      });

      return {
        id: `transcript-replay:${first.sessionId ?? first.eventId ?? idx}:${first.sourcePath}`,
        label: `Multi-turn transcript replay: ${ordered.length} command events`,
        source: `transcript:${first.source}`,
        status,
        contextExcerpt,
        conversationContext: ordered.find((anchor) => anchor.conversationContext)
          ?.conversationContext,
        sourcePath: first.sourcePath ?? null,
        sourceLine: first.sourceLine ?? null,
        eventId: `${first.eventId ?? first.id}->${last.eventId ?? last.id}`,
        sessionId: first.sessionId ?? null,
        artifact: first.sourcePath ?? null,
        jump: first.jump ?? null,
      };
    });
}

function joinTimelinePath(base: string | null | undefined, path: string): string {
  if (!base || path.startsWith('/')) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function buildEditOriginTimelineAnchors(
  input: VerificationTimelineInput
): VerificationTimelineAnchor[] {
  const changedFiles = input.fixResult?.changedFileOrigins ?? [];
  const runId = input.runId?.trim() || 'active-review';
  const worktreePath = input.fixResult?.worktreePath?.trim() || null;
  const source = input.fixResult?.agent ? `fix:${input.fixResult.agent}` : 'fix';
  const status: VerificationTimelineAnchor['status'] =
    input.fixResult?.success === false
      ? 'failed'
      : input.fixResult?.success === true
        ? 'passed'
        : 'unknown';

  return changedFiles
    .filter((file) => file.path.trim().length > 0)
    .slice(0, 4)
    .map((file, idx) => {
      const filePath = file.path.trim();
      const jumpPath = joinTimelinePath(worktreePath, filePath);
      const eventId = `${runId}:edit:${idx}:${filePath}`;
      const label = `${file.status ?? 'modified'} ${filePath}`;

      return {
        id: eventId,
        label,
        source,
        status,
        sourcePath: jumpPath,
        sourceLine: null,
        eventId,
        sessionId: runId,
        artifact: filePath,
        jump: {
          kind: 'file',
          label: 'Open edited file',
          path: jumpPath,
        },
      };
    });
}

function qaComparisonStatusToTimelineStatus(
  status: QaPostFixComparisonStatus
): VerificationTimelineStatus {
  if (status === 'fixed' || status === 'still_passing') return 'done';
  if (status === 'needs_rerun') return 'active';
  return 'blocked';
}

function qaRunAnchorArtifact(run: QaComparisonRun): string | null {
  return run.artifacts?.find((artifact) => artifact.trim().length > 0) ?? null;
}

function buildQaComparisonTimelineAnchors(
  comparison: QaPostFixComparison | null | undefined
): VerificationTimelineAnchor[] {
  if (!comparison) return [];

  const runs = [
    { id: 'before', label: 'Before fix', run: comparison.before },
    comparison.after ? { id: 'after', label: 'After fix', run: comparison.after } : null,
  ].filter((item): item is { id: string; label: string; run: QaComparisonRun } => Boolean(item));

  return runs.map(({ id, label, run }) => {
    const artifact = qaRunAnchorArtifact(run);
    const eventId = `${comparison.flowKey}:${id}:${run.createdAt}`;
    return {
      id: eventId,
      label: `${label}: ${run.pass ? 'PASS' : 'FAIL'} ${run.route ?? run.loopId} (${run.durationMs}ms)`,
      source: `qa:${run.runnerType}`,
      status: run.pass ? 'passed' : 'failed',
      sourcePath: artifact,
      sourceLine: null,
      eventId,
      sessionId: comparison.flowKey,
      artifact,
      jump: artifact
        ? {
            kind: 'artifact',
            label: `Open ${label.toLowerCase()} artifact`,
            path: artifact,
          }
        : null,
    };
  });
}

function statusRank(status: VerificationTimelineAnchor['status']): number {
  if (status === 'failed') return 0;
  if (status === 'stale' || status === 'unknown') return 1;
  return 2;
}

function isPositiveVerificationClaim(claim: string): boolean {
  const normalized = claim.trim().toLowerCase();
  return [
    /\b(?:tests?|checks?|build|lint|typecheck|playwright|ci)\b.{0,48}\b(?:pass(?:ed|es|ing)?|green|succeed(?:ed|s|ing)?|successful|clean)\b/,
    /\b(?:pass(?:ed|es|ing)?|green|succeed(?:ed|s|ing)?|successful|clean)\b.{0,48}\b(?:tests?|checks?|build|lint|typecheck|playwright|ci)\b/,
    /\bno\s+(?:test\s+)?(?:failures|errors|regressions)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isVerificationCommandLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return [
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|build|typecheck|check|e2e|playwright)\b/,
    /\b(?:cargo\s+(?:test|clippy|build)|go\s+test|pytest|vitest|jest|tsc|eslint|playwright|cypress)\b/,
    /\b(?:test|lint|build|typecheck|check|e2e|qa|ci)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function latestQaArtifact(
  run: NonNullable<VerificationTimelineInput['qa']>['latest']
): string | null {
  if (!run) return null;
  return run.screenshotPath ?? run.artifacts?.[0] ?? null;
}

function normalizeTimelineRelativePath(path: string | null | undefined): string {
  return (path ?? '')
    .trim()
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function buildReviewedPathSet(review: VerificationTimelineInput['review']): Set<string> {
  const paths = [...(review?.findingPaths ?? []), review?.firstFindingPath ?? null]
    .map(normalizeTimelineRelativePath)
    .filter((path) => path.length > 0);
  return new Set(paths);
}

function buildFailedStaleCommandClaimAnchors(
  commandAnchors: VerificationTimelineAnchor[]
): VerificationTimelineAnchor[] {
  return commandAnchors
    .filter((anchor) => anchor.status === 'failed' || anchor.status === 'stale')
    .map((anchor) => ({
      ...anchor,
      id: `claim:${anchor.id}`,
      label:
        anchor.status === 'failed'
          ? `Claim/test mismatch: ${anchor.label}`
          : `Stale verification evidence: ${anchor.label}`,
    }));
}

function buildUnknownCommandClaimAnchors(
  commandAnchors: VerificationTimelineAnchor[]
): VerificationTimelineAnchor[] {
  return commandAnchors
    .filter((anchor) => anchor.status === 'unknown' && isVerificationCommandLabel(anchor.label))
    .slice(0, 2)
    .map((anchor) => ({
      ...anchor,
      id: `claim:unknown-command:${anchor.id}`,
      label: `Unverified command outcome: ${anchor.label}`,
      status: 'unknown' as const,
      contextExcerpt: anchor.contextExcerpt?.length
        ? anchor.contextExcerpt
        : [
            'Command was observed without a pass/fail status; rerun it or attach its log before trusting the claim.',
          ],
    }));
}

function buildAgentClaimAnchors(
  input: VerificationTimelineInput,
  commandAnchors: VerificationTimelineAnchor[],
  runId: string
): VerificationTimelineAnchor[] {
  const contradictingCommand = commandAnchors.find(
    (anchor) => anchor.status === 'failed' || anchor.status === 'stale'
  );
  return (input.history?.agent_claims ?? []).slice(0, 2).map((claim, idx) => {
    const id = claim.event_id ?? claim.talk_id ?? claim.session_id ?? `${runId}:agent-claim:${idx}`;
    const hasCommandContradiction = Boolean(
      contradictingCommand && isPositiveVerificationClaim(claim.claim)
    );
    const status: VerificationTimelineAnchor['status'] =
      hasCommandContradiction && contradictingCommand ? contradictingCommand.status : 'unknown';
    return {
      id: `claim:agent:${id}`,
      label: hasCommandContradiction
        ? `Contradicted agent claim: ${claim.claim}`
        : `Unverified agent claim: ${claim.claim}`,
      source: `claim:${claim.source}`,
      status,
      contextExcerpt:
        hasCommandContradiction && contradictingCommand
          ? [`${contradictingCommand.status} command: ${contradictingCommand.label}`]
          : [],
      sourceLine: claim.source_line ?? null,
      eventId: claim.event_id ?? null,
      sessionId: claim.session_id ?? claim.talk_id ?? runId,
      jump: hasCommandContradiction ? (contradictingCommand?.jump ?? null) : null,
    };
  });
}

function buildUncheckedEvidenceClaimAnchor(
  runId: string,
  uncheckedCount: number
): VerificationTimelineAnchor[] {
  if (uncheckedCount <= 0) return [];
  return [
    {
      id: `${runId}:claim:unchecked-evidence`,
      label: `${uncheckedCount} finding${uncheckedCount === 1 ? '' : 's'} without verification evidence`,
      source: 'review:evidence',
      status: 'unknown',
      eventId: `${runId}:claim:unchecked-evidence`,
      sessionId: runId,
    },
  ];
}

function buildLatestQaFailedClaimAnchor(
  input: VerificationTimelineInput,
  runId: string,
  qaComparison: QaPostFixComparison | null | undefined
): VerificationTimelineAnchor[] {
  if (!input.qa?.latest || input.qa.latest.pass || qaComparison) return [];
  const artifact = latestQaArtifact(input.qa.latest);
  return [
    {
      id: `${runId}:claim:latest-qa-failed`,
      label: `Latest QA still failing: ${input.qa.latest.route ?? input.qa.latest.goal}`,
      source: `qa:${input.qa.latest.runnerType}`,
      status: 'failed',
      sourcePath: artifact,
      eventId: `${runId}:claim:latest-qa-failed`,
      sessionId: runId,
      artifact,
      jump: artifact
        ? {
            kind: 'artifact',
            label: 'Open latest QA artifact',
            path: artifact,
          }
        : null,
    },
  ];
}

function buildScopeDriftClaimAnchor(
  input: VerificationTimelineInput,
  runId: string,
  reviewedPaths: Set<string>,
  changedFileOrigins: { path: string; status: string }[]
): VerificationTimelineAnchor[] {
  if (!input.fixResult || reviewedPaths.size === 0 || changedFileOrigins.length === 0) return [];
  const outsideReviewedPaths = changedFileOrigins.filter((file) => !reviewedPaths.has(file.path));
  if (outsideReviewedPaths.length === 0) return [];
  const source = input.fixResult.agent ? `fix:${input.fixResult.agent}` : 'fix';
  return [
    {
      id: `${runId}:claim:scope-drift`,
      label: `Possible scope drift: ${outsideReviewedPaths.length} edited file${outsideReviewedPaths.length === 1 ? '' : 's'} outside reviewed findings`,
      source,
      status: 'unknown',
      contextExcerpt: [
        `outside reviewed findings: ${outsideReviewedPaths
          .slice(0, 3)
          .map((file) => file.path)
          .join(', ')}`,
        `reviewed finding files: ${Array.from(reviewedPaths).slice(0, 3).join(', ')}`,
      ],
      sourcePath: input.fixResult.worktreePath ?? null,
      eventId: `${runId}:claim:scope-drift`,
      sessionId: runId,
      artifact: outsideReviewedPaths[0]?.path ?? null,
      jump:
        input.fixResult.worktreePath && outsideReviewedPaths[0]
          ? {
              kind: 'file',
              label: 'Open first out-of-scope edit',
              path: joinTimelinePath(input.fixResult.worktreePath, outsideReviewedPaths[0].path),
            }
          : null,
    },
  ];
}

function buildEditsWithoutEvidenceClaimAnchor(
  input: VerificationTimelineInput,
  runId: string,
  changedFileCount: number,
  evidenceTotal: number,
  passedVerificationCommandCount: number,
  successfulQaProofCount: number
): VerificationTimelineAnchor[] {
  if (
    !input.fixResult ||
    changedFileCount < 3 ||
    evidenceTotal !== 0 ||
    passedVerificationCommandCount + successfulQaProofCount !== 0
  )
    return [];
  const source = input.fixResult.agent ? `fix:${input.fixResult.agent}` : 'fix';
  return [
    {
      id: `${runId}:claim:edits-without-evidence-progress`,
      label: `Repeated edits without evidence progress: ${changedFileCount} files changed, 0 verified findings`,
      source,
      status: 'unknown',
      contextExcerpt: [
        `${input.evidenceCounts.reproduced} reproduced, ${input.evidenceCounts.fixed} fixed, ${input.evidenceCounts.notReproduced} not reproduced`,
        `${passedVerificationCommandCount} passed verification commands, ${successfulQaProofCount} QA proofs`,
      ],
      sourcePath: input.fixResult.worktreePath ?? null,
      eventId: `${runId}:claim:edits-without-evidence-progress`,
      sessionId: runId,
      artifact: input.fixResult.worktreePath ?? null,
      jump: input.fixResult.worktreePath
        ? {
            kind: 'artifact',
            label: 'Open fix worktree',
            path: input.fixResult.worktreePath,
          }
        : null,
    },
  ];
}

function buildQaComparisonClaimAnchor(
  qaComparison: QaPostFixComparison | null | undefined
): VerificationTimelineAnchor[] {
  if (!qaComparison) return [];
  const status = qaComparisonStatusToTimelineStatus(qaComparison.status);
  if (status === 'done') return [];
  const afterArtifact = qaComparison.after ? qaRunAnchorArtifact(qaComparison.after) : null;
  const beforeArtifact = qaRunAnchorArtifact(qaComparison.before);
  const artifact = afterArtifact ?? beforeArtifact;
  return [
    {
      id: `${qaComparison.flowKey}:claim:${qaComparison.status}`,
      label: `Post-fix QA ${qaComparison.status.replace('_', ' ')}: ${qaComparison.summary}`,
      source: `qa:${qaComparison.after?.runnerType ?? qaComparison.before.runnerType}`,
      status: status === 'blocked' ? 'failed' : 'unknown',
      sourcePath: artifact,
      eventId: `${qaComparison.flowKey}:claim:${qaComparison.status}`,
      sessionId: qaComparison.flowKey,
      artifact,
      jump: artifact
        ? {
            kind: 'artifact',
            label: 'Open QA comparison artifact',
            path: artifact,
          }
        : null,
    },
  ];
}

function buildPostFixQaMissingClaimAnchor(
  input: VerificationTimelineInput,
  runId: string,
  qaComparison: QaPostFixComparison | null | undefined
): VerificationTimelineAnchor[] {
  if (qaComparison || input.fixResult?.success !== true) return [];
  const source = input.fixResult.agent ? `fix:${input.fixResult.agent}` : 'fix';
  return [
    {
      id: `${runId}:claim:post-fix-qa-missing`,
      label: 'Fix completed without same-flow post-fix QA comparison',
      source,
      status: 'unknown',
      sourcePath: input.fixResult.worktreePath ?? null,
      eventId: `${runId}:claim:post-fix-qa-missing`,
      sessionId: runId,
      artifact: input.fixResult.worktreePath ?? null,
      jump: input.fixResult.worktreePath
        ? {
            kind: 'artifact',
            label: 'Open fix worktree',
            path: input.fixResult.worktreePath,
          }
        : null,
    },
  ];
}

function buildExecutableProofMissingClaimAnchor(
  input: VerificationTimelineInput,
  runId: string,
  priorAnchors: VerificationTimelineAnchor[],
  findingsCount: number,
  evidenceTotal: number,
  passedVerificationCommandCount: number,
  successfulQaProofCount: number
): VerificationTimelineAnchor[] {
  if (
    priorAnchors.length !== 0 ||
    findingsCount <= 0 ||
    evidenceTotal < findingsCount ||
    passedVerificationCommandCount + successfulQaProofCount !== 0
  )
    return [];
  return [
    {
      id: `${runId}:claim:executable-proof-missing`,
      label: `Executable proof missing: ${evidenceTotal} evidence status${evidenceTotal === 1 ? '' : 'es'} for ${findingsCount} finding${findingsCount === 1 ? '' : 's'}`,
      source: 'review:evidence-strength',
      status: 'unknown',
      contextExcerpt: [
        `${input.evidenceCounts.reproduced} reproduced, ${input.evidenceCounts.fixed} fixed, ${input.evidenceCounts.notReproduced} not reproduced`,
        '0 passed verification commands, 0 passing QA proofs',
      ],
      eventId: `${runId}:claim:executable-proof-missing`,
      sessionId: runId,
    },
  ];
}

function buildClaimCheckTimelineAnchors(
  input: VerificationTimelineInput,
  commandAnchors: VerificationTimelineAnchor[],
  qaComparison: QaPostFixComparison | null | undefined,
  evidenceTotal: number
): VerificationTimelineAnchor[] {
  const runId = input.runId?.trim() || 'active-review';
  const findingsCount = Math.max(0, input.review?.findingsCount ?? 0);
  const uncheckedCount = Math.max(0, findingsCount - evidenceTotal);
  const changedFileOrigins = (input.fixResult?.changedFileOrigins ?? [])
    .map((file) => ({
      path: normalizeTimelineRelativePath(file.path),
      status: file.status ?? 'modified',
    }))
    .filter((file) => file.path.length > 0);
  const changedFileCount = input.fixResult?.changedFiles ?? changedFileOrigins.length;
  const passedVerificationCommandCount = commandAnchors.filter(
    (anchor) => anchor.status === 'passed' && isVerificationCommandLabel(anchor.label)
  ).length;
  const successfulQaProofCount =
    (input.qa?.latest?.pass ? 1 : 0) +
    (qaComparison && qaComparisonStatusToTimelineStatus(qaComparison.status) === 'done' ? 1 : 0);
  const reviewedPaths = buildReviewedPathSet(input.review ?? null);

  const baseAnchors: VerificationTimelineAnchor[] = [
    ...buildFailedStaleCommandClaimAnchors(commandAnchors),
    ...buildUnknownCommandClaimAnchors(commandAnchors),
    ...buildAgentClaimAnchors(input, commandAnchors, runId),
    ...buildUncheckedEvidenceClaimAnchor(runId, uncheckedCount),
    ...buildLatestQaFailedClaimAnchor(input, runId, qaComparison),
    ...buildScopeDriftClaimAnchor(input, runId, reviewedPaths, changedFileOrigins),
    ...buildEditsWithoutEvidenceClaimAnchor(
      input,
      runId,
      changedFileCount,
      evidenceTotal,
      passedVerificationCommandCount,
      successfulQaProofCount
    ),
    ...buildQaComparisonClaimAnchor(qaComparison),
    ...buildPostFixQaMissingClaimAnchor(input, runId, qaComparison),
  ];

  const executableProofMissing = buildExecutableProofMissingClaimAnchor(
    input,
    runId,
    baseAnchors,
    findingsCount,
    evidenceTotal,
    passedVerificationCommandCount,
    successfulQaProofCount
  );

  return [...baseAnchors, ...executableProofMissing]
    .sort((a, b) => statusRank(a.status) - statusRank(b.status))
    .slice(0, 4);
}

function boundedUniqueIndexes(indexes: Array<number | null | undefined>, count: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const idx of indexes) {
    if (idx == null || idx < 0 || idx >= count || seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

export function selectTimelineSegmentFindingIndexes(
  input: TimelineSegmentFindingSelectionInput
): number[] {
  const count = Math.max(0, input.findingsCount);
  if (count === 0) return [];

  const selected = boundedUniqueIndexes(input.selectedFindingIndexes ?? [], count);
  const active = boundedUniqueIndexes([input.activeFindingIndex], count);
  const all = Array.from({ length: count }, (_, idx) => idx);
  const statuses = input.evidenceStatuses ?? [];
  const indexesWithStatus = (wanted: FindingEvidence['status'][]) =>
    all.filter((idx) => wanted.includes(statuses[idx] ?? 'not_checked'));

  switch (input.segmentId) {
    case 'review':
      return all;
    case 'evidence': {
      const reproduced = indexesWithStatus(['reproduced']);
      if (reproduced.length > 0) return reproduced;
      const unchecked = indexesWithStatus(['not_checked']);
      return unchecked.length > 0 ? unchecked : selected;
    }
    case 'qa':
      return indexesWithStatus(['reproduced']);
    case 'fix-packet':
      return selected.length > 0 ? selected : active;
    case 'worktree': {
      const fixed = indexesWithStatus(['fixed', 'not_reproduced']);
      if (fixed.length > 0) return fixed;
      return selected.length > 0 ? selected : active;
    }
    default:
      return [];
  }
}

function qaRunTimestamp(run: QaComparisonRun): number {
  const time = new Date(run.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function qaFlowKey(run: QaComparisonRun): string {
  if (run.flowKey?.trim()) return run.flowKey.trim();
  return [
    run.runnerType.trim(),
    run.baseUrl.trim(),
    run.loopId.trim(),
    (run.route || '').trim(),
    run.goal.trim(),
  ].join('\u0000');
}

function qaFlowLabel(run: QaComparisonRun): string {
  return run.route || run.loopId || run.goal;
}

export function buildQaPostFixComparison(
  runs: QaComparisonRun[],
  fixCompletedAt: string | null | undefined
): QaPostFixComparison | null {
  if (!fixCompletedAt || runs.length === 0) return null;
  const fixTime = new Date(fixCompletedAt).getTime();
  if (!Number.isFinite(fixTime)) return null;

  const sorted = [...runs].sort((a, b) => qaRunTimestamp(b) - qaRunTimestamp(a));
  const before = sorted.find((run) => qaRunTimestamp(run) <= fixTime);
  if (!before) return null;

  const flowKey = qaFlowKey(before);
  const after = sorted.find((run) => qaRunTimestamp(run) > fixTime && qaFlowKey(run) === flowKey);
  const flowLabel = qaFlowLabel(before);

  if (!after) {
    return {
      status: 'needs_rerun',
      summary: `Fix is ready for QA comparison: rerun ${flowLabel} with the same ${before.runnerType} flow.`,
      flowKey,
      before,
    };
  }

  const durationDelta = after.durationMs - before.durationMs;
  const durationText =
    durationDelta === 0 ? 'same duration' : `${durationDelta > 0 ? '+' : ''}${durationDelta}ms`;

  if (!before.pass && after.pass) {
    return {
      status: 'fixed',
      summary: `Post-fix QA passed ${flowLabel}; prior run failed, rerun passed (${durationText}).`,
      flowKey,
      before,
      after,
    };
  }
  if (!before.pass && !after.pass) {
    return {
      status: 'still_broken',
      summary: `Post-fix QA still fails ${flowLabel}; prior and rerun both failed (${durationText}).`,
      flowKey,
      before,
      after,
    };
  }
  if (before.pass && !after.pass) {
    return {
      status: 'regressed',
      summary: `Post-fix QA regressed ${flowLabel}; prior run passed, rerun failed (${durationText}).`,
      flowKey,
      before,
      after,
    };
  }

  return {
    status: 'still_passing',
    summary: `Post-fix QA still passes ${flowLabel}; prior and rerun both passed (${durationText}).`,
    flowKey,
    before,
    after,
  };
}

function buildReviewTimelineJump(
  selectedFindingIndex: number | null,
  firstFindingPath: string | undefined,
  firstFindingLine: number | null
): VerificationTimelineJumpTarget | null {
  if (selectedFindingIndex != null) {
    return {
      kind: 'finding',
      label: `Open finding ${selectedFindingIndex + 1}`,
      findingIndex: selectedFindingIndex,
    };
  }
  if (firstFindingPath) {
    return {
      kind: 'file',
      label: 'Open first finding file',
      path: firstFindingPath,
      line: firstFindingLine,
    };
  }
  return null;
}

function buildQaTimelineJump(
  firstQaArtifact: string | null,
  qaComparisonAnchors: VerificationTimelineAnchor[]
): VerificationTimelineJumpTarget | null {
  if (firstQaArtifact) {
    return {
      kind: 'artifact',
      label: 'Open QA artifact',
      path: firstQaArtifact,
    };
  }
  return qaComparisonAnchors.find((anchor) => anchor.jump)?.jump ?? null;
}

function computeQaTimelineStatus(
  input: VerificationTimelineInput,
  qaComparison: QaPostFixComparison | null,
  latestQa: NonNullable<VerificationTimelineInput['qa']>['latest']
): VerificationTimelineStatus {
  if (input.qa?.running) return 'active';
  if (qaComparison) return qaComparisonStatusToTimelineStatus(qaComparison.status);
  if (latestQa) return latestQa.pass ? 'done' : 'blocked';
  return 'idle';
}

function computeQaTimelineDetail(
  qaComparison: QaPostFixComparison | null,
  latestQa: NonNullable<VerificationTimelineInput['qa']>['latest']
): string {
  if (qaComparison) {
    return `${qaComparison.status.replace('_', ' ')} · ${qaComparison.summary}`;
  }
  if (latestQa) {
    return `${latestQa.runnerType} ${latestQa.pass ? 'passed' : 'failed'} ${latestQa.route ?? latestQa.goal} in ${latestQa.durationMs}ms`;
  }
  return 'No user-flow run attached';
}

function buildFixPacketJump(fixFindingIndex: number | null): VerificationTimelineJumpTarget | null {
  if (fixFindingIndex == null) return null;
  return {
    kind: 'finding',
    label: `Open selected finding ${fixFindingIndex + 1}`,
    findingIndex: fixFindingIndex,
  };
}

function buildWorktreeJump(
  worktreePath: string | undefined,
  editOriginAnchors: VerificationTimelineAnchor[]
): VerificationTimelineJumpTarget | null {
  if (worktreePath) {
    return {
      kind: 'artifact',
      label: 'Open fix worktree',
      path: worktreePath,
    };
  }
  return editOriginAnchors[0]?.jump ?? null;
}

function computeWorktreeDetail(
  input: VerificationTimelineInput,
  worktreeFallback: boolean,
  worktreePath: string | undefined,
  editOriginAnchors: VerificationTimelineAnchor[],
  changedFilesCount: number
): string {
  if (worktreeFallback) return 'Agent fell back to primary repo';
  if (!input.fixResult) return 'No fix run yet';
  const editOriginText =
    editOriginAnchors.length > 0
      ? ` · ${editOriginAnchors.length} edit origin${editOriginAnchors.length === 1 ? '' : 's'}`
      : '';
  const worktreeText = worktreePath ? ` · ${worktreePath}` : '';
  return `${input.fixResult.findingsFixed ?? 0} fixed across ${changedFilesCount} file${changedFilesCount === 1 ? '' : 's'}${editOriginText}${worktreeText}`;
}

function computeProofSignalDetail(
  passedVerificationCommandCount: number,
  successfulQaProofCount: number
): string {
  return [
    passedVerificationCommandCount > 0
      ? `${passedVerificationCommandCount} passed verification command${passedVerificationCommandCount === 1 ? '' : 's'}`
      : null,
    successfulQaProofCount > 0
      ? `${successfulQaProofCount} QA proof${successfulQaProofCount === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function computeClaimCheckStatus(
  claimCheckAnchors: VerificationTimelineAnchor[],
  input: VerificationTimelineInput,
  commandAnchors: VerificationTimelineAnchor[],
  qaComparison: QaPostFixComparison | null,
  hasFixResult: boolean
): VerificationTimelineStatus {
  const blockedClaimCount = claimCheckAnchors.filter((anchor) => anchor.status === 'failed').length;
  const pendingClaimCount = claimCheckAnchors.filter((anchor) => anchor.status !== 'failed').length;
  if (blockedClaimCount > 0) return 'blocked';
  if (pendingClaimCount > 0) return 'active';
  if (input.review || commandAnchors.length > 0 || qaComparison || hasFixResult) return 'done';
  return 'idle';
}

function computeClaimCheckDetail(
  claimCheckAnchors: VerificationTimelineAnchor[],
  claimCheckStatus: VerificationTimelineStatus,
  proofSignalDetail: string
): string {
  if (claimCheckAnchors.length > 0) {
    const blockedClaimCount = claimCheckAnchors.filter(
      (anchor) => anchor.status === 'failed'
    ).length;
    const pendingClaimCount = claimCheckAnchors.filter(
      (anchor) => anchor.status !== 'failed'
    ).length;
    return `${blockedClaimCount} blocking, ${pendingClaimCount} need proof`;
  }
  if (claimCheckStatus === 'done') {
    return `No claim/evidence gaps detected${proofSignalDetail ? ` · ${proofSignalDetail}` : ''}`;
  }
  return 'No claims checked yet';
}

function buildReviewTimelineDetail(review: VerificationTimelineInput['review']): string {
  if (!review) return 'No review loaded';
  return `${review.findingsCount} finding${review.findingsCount === 1 ? '' : 's'} · ${review.mode ?? 'standard'} · ${review.riskTier ?? 'unclassified'}`;
}

function computeReviewTimelineStatus(input: VerificationTimelineInput): VerificationTimelineStatus {
  if (input.isReviewing) return 'active';
  return input.review ? 'done' : 'idle';
}

function buildEvidenceTimelineDetail(
  evidenceCounts: EvidenceCounts,
  commandAnchors: VerificationTimelineAnchor[],
  transcriptReplayAnchors: VerificationTimelineAnchor[],
  failedCommandCount: number
): string {
  const commandText =
    commandAnchors.length > 0
      ? ` · ${commandAnchors.length} command anchor${commandAnchors.length === 1 ? '' : 's'}${failedCommandCount > 0 ? `, ${failedCommandCount} failed` : ''}`
      : '';
  const replayText =
    transcriptReplayAnchors.length > 0
      ? ` · ${transcriptReplayAnchors.length} replay packet${transcriptReplayAnchors.length === 1 ? '' : 's'}`
      : '';
  return `${evidenceCounts.reproduced} reproduced, ${evidenceCounts.fixed} fixed, ${evidenceCounts.notReproduced} not reproduced${commandText}${replayText}`;
}

function computeEvidenceTimelineStatus(
  input: VerificationTimelineInput,
  evidenceTotal: number
): VerificationTimelineStatus {
  if (input.qa?.running) return 'active';
  return evidenceTotal > 0 ? 'done' : 'idle';
}

function buildFixPacketTimelineDetail(
  fixSelected: number,
  routeAdvice: string | undefined
): string {
  return `${fixSelected} selected${routeAdvice ? ` - ${routeAdvice}` : ''}`;
}

function computeFixPacketTimelineStatus(
  input: VerificationTimelineInput,
  fixSelected: number
): VerificationTimelineStatus {
  if (input.isFixing) return 'active';
  return fixSelected > 0 ? 'done' : 'idle';
}

function computeWorktreeTimelineStatus(
  worktreeFallback: boolean,
  worktreePath: string | undefined,
  hasFixResult: boolean
): VerificationTimelineStatus {
  if (worktreeFallback) return 'blocked';
  return worktreePath || hasFixResult ? 'done' : 'idle';
}

export function buildVerificationTimeline(
  input: VerificationTimelineInput
): VerificationTimelineItem[] {
  const taskGoal = input.taskGoal?.trim() ?? '';
  const latestQa = input.qa?.latest ?? null;
  const qaComparison = input.qa?.comparison ?? null;
  const evidenceTotal =
    input.evidenceCounts.reproduced +
    input.evidenceCounts.fixed +
    input.evidenceCounts.notReproduced;
  const fixSelected = input.fixPacket?.selectedFindings ?? 0;
  const worktreeFallback = input.fixResult?.usingWorktree === false;
  const worktreePath = input.fixResult?.worktreePath?.trim();
  const commandAnchors = buildCommandTimelineAnchors(input.history?.command_signals);
  const transcriptReplayAnchors = buildTranscriptReplayTimelineAnchors(commandAnchors);
  const evidenceAnchors = [
    ...commandAnchors.slice(0, Math.max(0, 4 - transcriptReplayAnchors.length)),
    ...transcriptReplayAnchors,
  ];
  const editOriginAnchors = buildEditOriginTimelineAnchors(input);
  const qaComparisonAnchors = buildQaComparisonTimelineAnchors(qaComparison);
  const claimCheckAnchors = buildClaimCheckTimelineAnchors(
    input,
    commandAnchors,
    qaComparison,
    evidenceTotal
  );
  const failedCommandCount = commandAnchors.filter((anchor) => anchor.status === 'failed').length;
  const passedVerificationCommandCount = commandAnchors.filter(
    (anchor) => anchor.status === 'passed' && isVerificationCommandLabel(anchor.label)
  ).length;
  const successfulQaProofCount =
    (latestQa?.pass ? 1 : 0) +
    (qaComparison && qaComparisonStatusToTimelineStatus(qaComparison.status) === 'done' ? 1 : 0);
  const proofSignalDetail = computeProofSignalDetail(
    passedVerificationCommandCount,
    successfulQaProofCount
  );
  const selectedFindingIndex = input.review?.selectedFindingIndex ?? null;
  const firstFindingPath = input.review?.firstFindingPath?.trim();
  const firstFindingLine = input.review?.firstFindingLine ?? null;
  const firstQaArtifact = latestQa?.screenshotPath ?? latestQa?.artifacts?.[0] ?? null;
  const fixFindingIndex = input.fixPacket?.selectedFindingIndex ?? selectedFindingIndex;
  const reviewJump = buildReviewTimelineJump(
    selectedFindingIndex,
    firstFindingPath,
    firstFindingLine
  );
  const qaJump = buildQaTimelineJump(firstQaArtifact, qaComparisonAnchors);
  const qaStatus = computeQaTimelineStatus(input, qaComparison, latestQa);
  const qaDetail = computeQaTimelineDetail(qaComparison, latestQa);
  const evidenceJump = commandAnchors.find((anchor) => anchor.jump)?.jump ?? null;
  const fixPacketJump = buildFixPacketJump(fixFindingIndex);
  const worktreeJump = buildWorktreeJump(worktreePath, editOriginAnchors);
  const changedFilesCount =
    input.fixResult?.changedFiles ?? input.fixResult?.changedFileOrigins?.length ?? 0;
  const worktreeDetail = computeWorktreeDetail(
    input,
    worktreeFallback,
    worktreePath,
    editOriginAnchors,
    changedFilesCount
  );
  const claimCheckStatus = computeClaimCheckStatus(
    claimCheckAnchors,
    input,
    commandAnchors,
    qaComparison,
    Boolean(input.fixResult)
  );
  const claimCheckDetail = computeClaimCheckDetail(
    claimCheckAnchors,
    claimCheckStatus,
    proofSignalDetail
  );
  const claimCheckJump = claimCheckAnchors.find((anchor) => anchor.jump)?.jump ?? null;

  return [
    {
      id: 'task',
      phase: 'task',
      label: 'Task context',
      detail: taskGoal || 'No manual goal attached',
      status: taskGoal ? 'done' : 'idle',
    },
    {
      id: 'review',
      phase: 'review',
      label: 'Review',
      detail: buildReviewTimelineDetail(input.review),
      status: computeReviewTimelineStatus(input),
      jump: reviewJump,
    },
    {
      id: 'qa',
      phase: 'qa',
      label: 'Synthetic QA',
      detail: qaDetail,
      status: qaStatus,
      anchors: qaComparisonAnchors,
      jump: qaJump,
    },
    {
      id: 'evidence',
      phase: 'evidence',
      label: 'Evidence',
      detail: buildEvidenceTimelineDetail(
        input.evidenceCounts,
        commandAnchors,
        transcriptReplayAnchors,
        failedCommandCount
      ),
      status: computeEvidenceTimelineStatus(input, evidenceTotal),
      anchors: evidenceAnchors,
      jump: evidenceJump,
    },
    {
      id: 'claim-check',
      phase: 'evidence',
      label: 'Claim check',
      detail: claimCheckDetail,
      status: claimCheckStatus,
      anchors: claimCheckAnchors,
      jump: claimCheckJump,
    },
    {
      id: 'fix-packet',
      phase: 'fix',
      label: 'Fix packet',
      detail: buildFixPacketTimelineDetail(fixSelected, input.fixPacket?.routeAdvice),
      status: computeFixPacketTimelineStatus(input, fixSelected),
      jump: fixPacketJump,
    },
    {
      id: 'worktree',
      phase: 'worktree',
      label: 'Worktree',
      detail: worktreeDetail,
      status: computeWorktreeTimelineStatus(
        worktreeFallback,
        worktreePath,
        Boolean(input.fixResult)
      ),
      anchors: editOriginAnchors,
      jump: worktreeJump,
    },
  ];
}

// Compares two already-lowercased paths. Hoisting the lowercasing to the caller
// lets buildCodebaseHistoryExplanations normalize each signal path once instead
// of re-lowercasing it on every file iteration.
function lowerPathsMatch(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function citationText(value: string, limit = 140): string {
  const normalized = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  const out = normalized.slice(0, limit);
  return normalized.length > limit ? `${out}...` : out;
}

interface CodebaseHistoryFileSignals {
  commits: RepoHistoryContext['recent_commits'];
  decisions: NonNullable<RepoHistoryContext['prior_decisions']>;
  recurring: RepoHistoryContext['recurring_failures'];
  agents: RepoHistoryContext['prior_agent_activity'];
  commands: NonNullable<RepoHistoryContext['command_signals']>;
}

function collectCodebaseHistoryFileSignals(
  history: RepoHistoryContext,
  fileKey: string,
  decisionList: NonNullable<RepoHistoryContext['prior_decisions']>,
  commandList: NonNullable<RepoHistoryContext['command_signals']>,
  commitKeys: string[],
  decisionKeys: string[],
  recurringKeys: string[],
  agentKeys: string[][],
  commandKeys: (string | null)[]
): CodebaseHistoryFileSignals {
  const commits = history.recent_commits.filter((_, idx) =>
    lowerPathsMatch(commitKeys[idx], fileKey)
  );
  const decisions = decisionList.filter((_, idx) => lowerPathsMatch(decisionKeys[idx], fileKey));
  const recurring = history.recurring_failures.filter((_, idx) =>
    lowerPathsMatch(recurringKeys[idx], fileKey)
  );
  const agents = history.prior_agent_activity.filter((_, idx) =>
    agentKeys[idx].some((activityKey) => lowerPathsMatch(activityKey, fileKey))
  );
  const commands = commandList.filter((_, idx) => {
    const key = commandKeys[idx];
    return key != null && lowerPathsMatch(key, fileKey);
  });
  return { commits, decisions, recurring, agents, commands };
}

function buildCodebaseHistoryLead(signals: CodebaseHistoryFileSignals): string {
  const { decisions, commits, recurring, agents } = signals;
  if (decisions[0]) return `Prior decision: ${citationText(decisions[0].text, 110)}`;
  if (commits[0]) return `Recent change: ${citationText(commits[0].subject, 110)}`;
  if (recurring[0]) {
    return `Recurring review signal: ${citationText(recurring[0].examples?.[0] ?? 'past finding', 110)}`;
  }
  if (agents[0]) return `Prior agent context: ${citationText(agents[0].summary, 110)}`;
  return 'History exists but has thin explanatory evidence.';
}

function buildCodebaseHistorySupporting(signals: CodebaseHistoryFileSignals): string[] {
  const { decisions, commits, recurring, agents, commands } = signals;
  const recurringCount = recurring.reduce((sum, item) => sum + item.count, 0);
  return [
    decisions.length
      ? `${decisions.length} decision marker${decisions.length === 1 ? '' : 's'}`
      : null,
    commits.length ? `${commits.length} recent commit${commits.length === 1 ? '' : 's'}` : null,
    recurring.length
      ? `${recurringCount} recurring finding${recurringCount === 1 ? '' : 's'}`
      : null,
    agents.length ? `${agents.length} prior agent note${agents.length === 1 ? '' : 's'}` : null,
    commands.length ? `${commands.length} command anchor${commands.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];
}

function buildCodebaseHistoryCitations(signals: CodebaseHistoryFileSignals): string[] {
  const { decisions, commits, recurring } = signals;
  return [
    ...decisions
      .slice(0, 2)
      .map(
        (decision) =>
          `${decision.source}:${decision.file}${decision.line ? `:${decision.line}` : ''} - ${citationText(decision.text)}`
      ),
    ...commits
      .slice(0, 2)
      .map((commit) => `commit:${commit.sha} ${commit.file} - ${citationText(commit.subject)}`),
    ...recurring
      .slice(0, 1)
      .flatMap((failure) =>
        (failure.examples ?? [])
          .slice(0, 2)
          .map((example) => `finding:${failure.file} - ${citationText(example)}`)
      ),
  ].slice(0, 5);
}

function buildCodebaseHistoryExplanationForFile(
  file: string,
  history: RepoHistoryContext,
  decisionList: NonNullable<RepoHistoryContext['prior_decisions']>,
  commandList: NonNullable<RepoHistoryContext['command_signals']>,
  commitKeys: string[],
  decisionKeys: string[],
  recurringKeys: string[],
  agentKeys: string[][],
  commandKeys: (string | null)[]
): CodebaseHistoryExplanation | null {
  const fileKey = file.toLowerCase();
  const signals = collectCodebaseHistoryFileSignals(
    history,
    fileKey,
    decisionList,
    commandList,
    commitKeys,
    decisionKeys,
    recurringKeys,
    agentKeys,
    commandKeys
  );
  const { commits, decisions, recurring, agents, commands } = signals;
  const signalCount =
    commits.length + decisions.length + recurring.length + agents.length + commands.length;
  if (signalCount === 0) return null;

  const lead = buildCodebaseHistoryLead(signals);
  const supporting = buildCodebaseHistorySupporting(signals);
  const citations = buildCodebaseHistoryCitations(signals);
  const recurringCount = recurring.reduce((sum, item) => sum + item.count, 0);

  return {
    file,
    summary: `${lead}${supporting.length ? ` (${supporting.join(', ')})` : ''}.`,
    confidence: decisions.length + commits.length + recurring.length >= 2 ? 'strong' : 'thin',
    counts: {
      commits: commits.length,
      decisions: decisions.length,
      recurring: recurringCount,
      agents: agents.length,
      commands: commands.length,
    },
    citations,
  };
}

function codebaseHistoryExplanationScore(item: CodebaseHistoryExplanation): number {
  return (
    item.counts.decisions * 4 +
    item.counts.recurring * 3 +
    item.counts.agents * 2 +
    item.counts.commits
  );
}

export function buildCodebaseHistoryExplanations(
  history: RepoHistoryContext | null
): CodebaseHistoryExplanation[] {
  if (!history) return [];

  // Normalize every signal path to lowercase once up front. The per-file loop
  // below then matches against these cached keys by index, avoiding the
  // O(files × signals) redundant toLowerCase work the previous version incurred.
  const decisionList = history.prior_decisions ?? [];
  const commandList = history.command_signals ?? [];
  const commitKeys = history.recent_commits.map((commit) => commit.file.toLowerCase());
  const decisionKeys = decisionList.map((decision) => decision.file.toLowerCase());
  const recurringKeys = history.recurring_failures.map((failure) => failure.file.toLowerCase());
  const agentKeys = history.prior_agent_activity.map((activity) =>
    (activity.files ?? []).map((activityFile) => activityFile.toLowerCase())
  );
  const commandKeys = commandList.map((signal) => signal.source_path?.toLowerCase() ?? null);

  return history.files_analyzed
    .map((file) =>
      buildCodebaseHistoryExplanationForFile(
        file,
        history,
        decisionList,
        commandList,
        commitKeys,
        decisionKeys,
        recurringKeys,
        agentKeys,
        commandKeys
      )
    )
    .filter((item): item is CodebaseHistoryExplanation => Boolean(item))
    .sort((a, b) => codebaseHistoryExplanationScore(b) - codebaseHistoryExplanationScore(a))
    .slice(0, 5);
}

/** File-scoped history query for Review findings and Repo Unpacked hooks. */
export function queryCodebaseHistoryExplanationForFile(
  history: RepoHistoryContext | null,
  filePath: string
): CodebaseHistoryExplanation | null {
  const normalized = filePath.trim();
  if (!history || !normalized) return null;
  const [explanation] = buildCodebaseHistoryExplanations({
    ...history,
    files_analyzed: [normalized],
  });
  return explanation ?? null;
}

const TIMELINE_ANCHOR_PREVIEW_COUNT = 2;

export function shouldCollapseTimelineAnchors(anchorCount: number): boolean {
  return anchorCount > TIMELINE_ANCHOR_PREVIEW_COUNT + 1;
}

export function visibleTimelineAnchors<T extends { id: string }>(
  anchors: T[],
  expanded: boolean
): T[] {
  if (expanded || !shouldCollapseTimelineAnchors(anchors.length)) {
    return anchors;
  }
  return anchors.slice(0, TIMELINE_ANCHOR_PREVIEW_COUNT);
}

export function buildRevalidationChecklist(
  finding: CliReviewFinding,
  evidence: FindingEvidence
): RevalidationItem[] {
  const items: RevalidationItem[] = [];
  const loc = finding.filePath
    ? `${finding.filePath}${finding.line != null ? `:${finding.line}` : ''}`
    : null;

  items.push({
    id: 'original-gone',
    label: loc
      ? `Confirm the original failure no longer reproduces at ${loc}.`
      : 'Confirm the originally-described failure no longer reproduces.',
  });

  const artifact = evidence.artifact.trim();
  if (artifact) {
    items.push({
      id: 'rerun-artifact',
      label: `Re-run the recorded artifact (${artifact}) and confirm it now passes.`,
    });
  } else if (evidence.level !== 'static') {
    items.push({
      id: 'capture-artifact',
      label: 'Capture a fresh artifact (command output, screenshot, or trace) proving the fix.',
    });
  }

  if (evidence.level === 'static') {
    items.push({
      id: 'add-regression-test',
      label: 'Add or extend a test covering this case — the original signal was static-only.',
    });
  } else if (evidence.level === 'browser') {
    items.push({
      id: 'rerun-browser-flow',
      label: 'Walk the browser flow end-to-end and verify no console/network regressions.',
    });
  } else if (evidence.level === 'runtime') {
    items.push({
      id: 'watch-runtime',
      label: 'Watch the relevant logs / runtime trace for one more cycle to confirm silence.',
    });
  }

  if (evidence.notes.trim()) {
    items.push({
      id: 'recheck-notes',
      label: 'Re-read the QA notes and tick off each documented pass criterion.',
    });
  }

  items.push({
    id: 'scan-neighbors',
    label: 'Spot-check adjacent files in the same diff for the same pattern.',
  });

  return items;
}

function evidenceStatusIcon(status: FindingEvidence['status']): string {
  if (status === 'fixed') return '✅';
  if (status === 'reproduced') return '⚠️';
  if (status === 'not_reproduced') return '🔵';
  return '⏳';
}

function formatFindingLoc(finding: CliReviewFinding): string {
  return finding.filePath
    ? ` (\`${finding.filePath}${finding.line != null ? `:${finding.line}` : ''}\`)`
    : '';
}

function buildTimelineItemJumpParts(item: VerificationTimelineItem): string[] {
  if (!item.jump) return [];
  return [
    `jump=${item.jump.kind}`,
    item.jump.findingIndex != null ? `finding=${item.jump.findingIndex + 1}` : null,
    item.jump.path ? `path=${item.jump.path}` : null,
    item.jump.line != null ? `line=${item.jump.line}` : null,
  ].filter(Boolean) as string[];
}

function buildTimelineAnchorLines(anchor: VerificationTimelineAnchor): string[] {
  const lines: string[] = [];
  const loc = [
    anchor.source,
    anchor.sourcePath ? `source=${anchor.sourcePath}` : null,
    anchor.sourceLine != null ? `line=${anchor.sourceLine}` : null,
    anchor.eventId ? `event=${anchor.eventId}` : null,
    anchor.sessionId ? `session=${anchor.sessionId}` : null,
    anchor.artifact ? `artifact=${anchor.artifact}` : null,
    anchor.jump?.kind ? `jump=${anchor.jump.kind}` : null,
    anchor.jump?.path ? `jumpPath=${anchor.jump.path}` : null,
  ].filter(Boolean) as string[];
  lines.push(
    `  - ${anchor.status ?? 'unknown'} command: ${anchor.label}${loc.length > 0 ? ` (${loc.join(' · ')})` : ''}`
  );
  for (const excerpt of anchor.contextExcerpt?.slice(0, 2) ?? []) {
    lines.push(`    - transcript: ${excerpt}`);
  }
  for (const ctxItem of anchor.conversationContext?.items.slice(0, 4) ?? []) {
    lines.push(
      `    - intent context (${ctxItem.relative_position}, ${ctxItem.role}, source=${ctxItem.source_path}${ctxItem.source_line != null ? `:${ctxItem.source_line}` : ''}): ${ctxItem.text}`
    );
  }
  if (anchor.conversationContext) {
    lines.push('    - qualification: intent context only; not executable verification evidence');
  }
  return lines;
}

function buildVerificationTimelineSectionLines(timeline: VerificationTimelineItem[]): string[] {
  const lines: string[] = ['', '### Verification timeline'];
  for (const item of timeline) {
    const itemJump = buildTimelineItemJumpParts(item);
    lines.push(
      `- **${item.label}** — ${item.status}: ${item.detail}${itemJump.length > 0 ? ` (${itemJump.join(' · ')})` : ''}`
    );
    for (const anchor of item.anchors?.slice(0, 4) ?? []) {
      lines.push(...buildTimelineAnchorLines(anchor));
    }
  }
  return lines;
}

function buildIntentCheckSectionLines(intentReport: ReviewIntentReport): string[] {
  const lines: string[] = ['', '### Intent check'];
  lines.push(`Intent: ${intentReport.inferredIntent}`);
  lines.push(`Changed surfaces: ${intentReport.changedSurfaces.join(', ')}`);
  lines.push('', 'Verification gaps:');
  lines.push(
    ...(intentReport.verificationGaps.length
      ? intentReport.verificationGaps.map((gap) => `- ${gap}`)
      : ['- No obvious gaps.'])
  );
  return lines;
}

function buildQaPostFixComparisonSectionLines(comparison: QaPostFixComparison): string[] {
  const lines: string[] = ['', '### Synthetic QA post-fix comparison'];
  lines.push(`- **${comparison.status.replace('_', ' ')}** — ${comparison.summary}`);
  lines.push(
    `- Before: ${comparison.before.pass ? 'PASS' : 'FAIL'} ${comparison.before.runnerType} ${comparison.before.route ?? comparison.before.loopId} (${comparison.before.durationMs}ms)`
  );
  if (comparison.after) {
    lines.push(
      `- After: ${comparison.after.pass ? 'PASS' : 'FAIL'} ${comparison.after.runnerType} ${comparison.after.route ?? comparison.after.loopId} (${comparison.after.durationMs}ms)`
    );
  } else {
    lines.push('- After: not run yet');
  }
  return lines;
}

function buildEvidenceCandidatesSectionLines(
  candidates: EvidenceCandidate[],
  statuses: Record<string, EvidenceCandidateStatus> | undefined
): string[] {
  const lines: string[] = ['', '### Evidence candidates'];
  for (const candidate of candidates.slice(0, 6)) {
    const status = statuses?.[candidate.id] ?? 'open';
    lines.push(
      `- **${candidate.severity_hint.toUpperCase()}** ${candidate.kind} (${candidate.id}) — ${status.replace('_', ' ')} — ${candidate.why_it_matters}`
    );
    if (candidate.affected_files.length > 0) {
      lines.push(`  - Files: ${candidate.affected_files.slice(0, 5).join(', ')}`);
    }
    if (candidate.evidence_refs.length > 0) {
      const refs = candidate.evidence_refs
        .slice(0, 3)
        .map((ref) => `${ref.kind}:${ref.label}${ref.detail ? ` (${ref.detail})` : ''}`);
      lines.push(`  - Evidence refs: ${refs.join('; ')}`);
    }
    if (candidate.open_questions.length > 0) {
      lines.push(`  - Open question: ${candidate.open_questions[0]}`);
    }
    if (candidate.suggested_checks.length > 0) {
      lines.push(`  - Suggested check: ${candidate.suggested_checks[0]}`);
    }
  }
  return lines;
}

function buildProcedureGatesSectionLines(
  steps: EvidenceProcedureStep[],
  events: ProcedureExecutionEvent[] | undefined
): string[] {
  const lines: string[] = ['', '### Procedure gates'];
  for (const step of steps.slice(0, 6)) {
    const stepEvents = (events ?? []).filter((event) => event.stepId === step.id);
    lines.push(
      `- **${step.status.toUpperCase()}** ${step.procedure} (${step.id}) - ${step.action}`
    );
    lines.push(`  - Gate: ${step.gate}`);
    lines.push(`  - Artifact: ${step.artifact}`);
    if (step.candidate_ids.length > 0) {
      lines.push(`  - Candidates: ${step.candidate_ids.join(', ')}`);
    }
    if (step.blocked_on.length > 0) {
      lines.push(`  - Blocked on: ${step.blocked_on.join(', ')}`);
    }
    for (const event of stepEvents.slice(0, 3)) {
      lines.push(`  - Execution: ${event.status} via ${event.source} - ${event.summary}`);
      if (event.artifact) {
        lines.push(`    - Artifact: ${event.artifact}`);
      }
    }
  }
  return lines;
}

function buildMemoryGraphNodeLines(nodes: ReviewMemoryGraph['nodes'], limit: number): string[] {
  return nodes.slice(0, limit).map((node) => {
    const path = node.file_path && node.file_path !== node.label ? ` (${node.file_path})` : '';
    const detail = node.detail ? ` — ${node.detail}` : '';
    return `- [${node.kind}] ${node.label}${path}${detail}`;
  });
}

function buildMemoryGraphEdgeLines(edges: ReviewMemoryGraph['edges'], limit: number): string[] {
  return edges
    .slice(0, limit)
    .map(
      (edge) => `  - edge: ${edge.from} -> ${edge.to} (${edge.kind}, ${edge.confidence.toFixed(2)})`
    );
}

function buildReviewMemoryGraphSectionLines(graph: ReviewMemoryGraph): string[] {
  const lines: string[] = ['', '### Review memory graph'];
  lines.push(
    `Schema v${graph.schema_version} · ${graph.nodes.length} nodes · ${graph.edges.length} edges${graph.truncated ? ' · truncated' : ''}`
  );
  lines.push(...buildMemoryGraphNodeLines(graph.nodes, 8));
  lines.push(...buildMemoryGraphEdgeLines(graph.edges, 8));
  if ((graph.trusted_paths?.length ?? 0) > 0) {
    lines.push('', '#### Qualified native graph paths');
    for (const path of graph.trusted_paths?.slice(0, 4) ?? []) {
      lines.push('```text', renderQualifiedGraphPath(path), '```');
    }
  }
  return lines;
}

function buildFocusedReviewMemoryGraphSectionLines(graph: ReviewMemoryGraph): string[] {
  const lines: string[] = ['', '### Focused finding graph'];
  lines.push(
    `Scope ${graph.scope} · ${graph.nodes.length} nodes · ${graph.edges.length} edges${graph.truncated ? ' · truncated' : ''}`
  );
  lines.push(...buildMemoryGraphNodeLines(graph.nodes, 8));
  lines.push(...buildMemoryGraphEdgeLines(graph.edges, 8));
  return lines;
}

function buildTrustedGraphSectionLines(graph: TrustedReviewGraphContext): string[] {
  const lines: string[] = ['', '### Trusted structural graph'];
  lines.push(
    `Snapshot \`${graph.snapshot_id}\` · ${graph.engine_id}@${graph.engine_version} · schema v${graph.schema_version} · ${graph.stale ? 'stale' : 'current'}${graph.truncated ? ' · truncated' : ''}`
  );
  lines.push(
    `Coverage: ${graph.coverage.indexed_files}/${graph.coverage.discovered_files} files indexed · ${graph.coverage.error_files} errors · ${graph.coverage.skipped_files} skipped`
  );
  lines.push(`Qualification: ${graph.qualification}`);
  lines.push(
    '_Navigation context only. Graph topology is not a finding and is not verified runtime evidence._'
  );
  for (const node of graph.nodes.slice(0, 12)) {
    const source = node.sources[0];
    const sourceLabel = source
      ? ` · source: \`${source.path}${source.start_line != null ? `:${source.start_line}` : ''}\``
      : ' · source: unavailable';
    lines.push(
      `- node [${node.trust}/${node.origin}] ${node.label}${node.path ? ` (\`${node.path}\`)` : ''}${sourceLabel}`
    );
  }
  for (const edge of graph.edges.slice(0, 16)) {
    const source = edge.sources[0];
    const sourceLabel = source
      ? ` · source: \`${source.path}${source.start_line != null ? `:${source.start_line}` : ''}\``
      : ' · source: unavailable';
    lines.push(
      `  - edge: ${edge.from} -> ${edge.to} (${edge.kind}, ${edge.trust}/${edge.origin})${sourceLabel}`
    );
  }
  return lines;
}

function buildHistoryExplanationsSectionLines(
  explanations: CodebaseHistoryExplanation[]
): string[] {
  const lines: string[] = ['', '### Codebase history explanations'];
  for (const explanation of explanations.slice(0, 5)) {
    lines.push(`- **${explanation.file}** (${explanation.confidence}) — ${explanation.summary}`);
    for (const citation of explanation.citations.slice(0, 3)) {
      lines.push(`  - ${citation}`);
    }
  }
  return lines;
}

function buildTemporalHistorySectionLines(
  temporalHistory: NonNullable<RepoHistoryContext['temporal_slice']>
): string[] {
  const lines: string[] = ['', '### Temporal history graph'];
  lines.push(
    `Schema v${temporalHistory.schema_version} · ${temporalHistory.episodes.length} episodes · ${temporalHistory.stale ? 'stale' : 'current'}${temporalHistory.truncated ? ' · truncated' : ''}`
  );
  for (const event of temporalHistory.constraints.slice(0, 5)) {
    const source = event.sources[0]?.path ? ` · source: \`${event.sources[0].path}\`` : '';
    lines.push(
      `- [${event.stage}/${event.trust}] ${event.summary}${source} · event: \`${event.id}\``
    );
  }
  for (const event of temporalHistory.failures.slice(0, 5)) {
    lines.push(`- [prior failure/${event.trust}] ${event.summary} · event: \`${event.id}\``);
  }
  for (const gap of temporalHistory.gaps.slice(0, 5)) {
    lines.push(`- Gap: ${gap}`);
  }
  return lines;
}

function buildHistorySummaryCountsLines(summary: HistoryFindingSummary): string[] {
  const counts = [
    summary.decisions ? `${summary.decisions} decision` : null,
    summary.commits ? `${summary.commits} commit` : null,
    summary.recurring ? `${summary.recurring} recurring` : null,
    summary.commands ? `${summary.commands} command` : null,
    summary.claims ? `${summary.claims} claim` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const sample = summary.topDecision ?? summary.topCommit ?? summary.topClaim;
  const lines: string[] = [`  - History context: ${counts}${sample ? ` — ${sample}` : ''}`];
  for (const command of summary.topCommands ?? []) {
    lines.push(`  - Command evidence: ${command}`);
  }
  return lines;
}

function buildFindingEvidenceLines(
  finding: CliReviewFinding,
  ev: FindingEvidence,
  historySummary: HistoryFindingSummary | undefined
): string[] {
  const lines: string[] = [];
  const artifact = ev.artifact.trim() ? ` · artifact: \`${ev.artifact.trim()}\`` : '';
  lines.push(
    `- ${evidenceStatusIcon(ev.status)} **[${finding.severity.toUpperCase()}]** ${finding.title}${formatFindingLoc(finding)} — ${ev.status.replace('_', ' ')}${artifact}`
  );
  if (historySummary) {
    lines.push(...buildHistorySummaryCountsLines(historySummary));
  }
  const notes = ev.notes.trim();
  if (notes) {
    for (const line of notes.split('\n')) {
      lines.push(`  - ${line}`);
    }
  }
  return lines;
}

function buildFindingsAndEvidenceSectionLines(input: ReviewerProofInput): string[] {
  const lines: string[] = ['', '### Findings & evidence'];
  if (input.findings.length === 0) {
    lines.push('- _No findings._');
    return lines;
  }
  input.findings.forEach((finding, idx) => {
    const ev = input.evidence[idx];
    const historySummary = input.historyFindingSummaries.get(idx);
    lines.push(...buildFindingEvidenceLines(finding, ev, historySummary));
  });
  return lines;
}

function buildReviewerNextActionsLines(input: ReviewerProofInput): string[] {
  const nextActions: string[] = [];
  input.findings.forEach((finding, idx) => {
    const ev = input.evidence[idx];
    const sev = `[${finding.severity.toUpperCase()}]`;
    if (ev.status === 'not_checked') {
      nextActions.push(`- [ ] Verify **${sev}** ${finding.title}${formatFindingLoc(finding)}`);
    } else if (ev.status === 'reproduced') {
      const artifact = ev.artifact.trim() ? ` (artifact: \`${ev.artifact.trim()}\`)` : '';
      nextActions.push(
        `- [ ] Fix **${sev}** ${finding.title}${formatFindingLoc(finding)} — currently reproduced${artifact}`
      );
    } else if (ev.status === 'fixed') {
      buildRevalidationChecklist(finding, ev).forEach((item) => {
        if (!ev.revalidation[item.id]) {
          nextActions.push(`- [ ] ${item.label}`);
        }
      });
    }
  });
  return nextActions;
}

export function buildReviewerProofMarkdown(input: ReviewerProofInput): string {
  const notChecked =
    input.findings.length -
    input.evidenceCounts.reproduced -
    input.evidenceCounts.fixed -
    input.evidenceCounts.notReproduced;

  const lines: string[] = [];
  lines.push(`## Reviewer handoff — ${input.diffRange || 'local diff'}`);
  lines.push('');
  lines.push(
    `**Score:** ${Math.round(input.score)}/100 · **Agent:** ${input.agent} · **Findings:** ${input.findings.length}`
  );
  lines.push(
    `**Fixed:** ${input.evidenceCounts.fixed} · **Reproduced:** ${input.evidenceCounts.reproduced} · **Not reproduced:** ${input.evidenceCounts.notReproduced} · **Unchecked:** ${notChecked}`
  );

  if (input.intentReport) {
    lines.push(...buildIntentCheckSectionLines(input.intentReport));
  }

  if (input.verificationTimeline && input.verificationTimeline.length > 0) {
    lines.push(...buildVerificationTimelineSectionLines(input.verificationTimeline));
  }

  if (input.qaPostFixComparison) {
    lines.push(...buildQaPostFixComparisonSectionLines(input.qaPostFixComparison));
  }

  if (input.evidenceCandidates && input.evidenceCandidates.length > 0) {
    lines.push(
      ...buildEvidenceCandidatesSectionLines(
        input.evidenceCandidates,
        input.evidenceCandidateStatuses
      )
    );
  }

  if (input.evidenceProcedureSteps && input.evidenceProcedureSteps.length > 0) {
    lines.push(
      ...buildProcedureGatesSectionLines(
        input.evidenceProcedureSteps,
        input.procedureExecutionEvents
      )
    );
  }

  if (input.reviewMemoryGraph && input.reviewMemoryGraph.nodes.length > 0) {
    lines.push(...buildReviewMemoryGraphSectionLines(input.reviewMemoryGraph));
  }

  if (input.focusedReviewMemoryGraph && input.focusedReviewMemoryGraph.nodes.length > 0) {
    lines.push(...buildFocusedReviewMemoryGraphSectionLines(input.focusedReviewMemoryGraph));
  }

  if (input.trustedGraphContext && input.trustedGraphContext.nodes.length > 0) {
    lines.push(...buildTrustedGraphSectionLines(input.trustedGraphContext));
  }

  if (input.historyExplanations && input.historyExplanations.length > 0) {
    lines.push(...buildHistoryExplanationsSectionLines(input.historyExplanations));
  }

  if (input.temporalHistory) {
    lines.push(...buildTemporalHistorySectionLines(input.temporalHistory));
  }

  lines.push(...buildFindingsAndEvidenceSectionLines(input));

  const nextActions = buildReviewerNextActionsLines(input);
  if (nextActions.length > 0) {
    lines.push('', '### Next actions');
    lines.push(...nextActions);
  }

  return lines.join('\n');
}

function buildFindingHunkHistorySectionLines(summary: HistoryFindingSummary): string[] {
  const counts = [
    summary.decisions ? `${summary.decisions} decision` : null,
    summary.commits ? `${summary.commits} commit` : null,
    summary.recurring ? `${summary.recurring} recurring` : null,
    summary.commands ? `${summary.commands} command` : null,
    summary.claims ? `${summary.claims} claim` : null,
  ].filter(Boolean) as string[];
  const sample = summary.topDecision ?? summary.topCommit ?? summary.topClaim;
  const lines: string[] = ['', '## Local history context'];
  lines.push(`- ${counts.length ? counts.join(', ') : 'No linked history counts.'}`);
  if (sample) {
    lines.push(`- ${sample}`);
  }
  for (const command of summary.topCommands ?? []) {
    lines.push(`- Command evidence: ${command}`);
  }
  return lines;
}

function buildFindingHunkFocusedGraphLines(graph: ReviewMemoryGraph): string[] {
  const lines: string[] = ['', '## Focused memory graph'];
  lines.push(
    `Schema v${graph.schema_version}; scope ${graph.scope}; ${graph.nodes.length} nodes; ${graph.edges.length} edges${graph.truncated ? '; truncated' : ''}.`
  );
  for (const node of graph.nodes.slice(0, 8)) {
    const path = node.file_path && node.file_path !== node.label ? ` (${node.file_path})` : '';
    const detail = node.detail ? ` - ${node.detail}` : '';
    lines.push(`- [${node.kind}] ${node.label}${path}${detail}`);
  }
  for (const edge of graph.edges.slice(0, 8)) {
    lines.push(`- Edge: ${edge.from} -> ${edge.to} (${edge.kind}, ${edge.confidence.toFixed(2)})`);
  }
  return lines;
}

function buildFindingHunkNextActionsLines(
  finding: CliReviewFinding,
  evidence: FindingEvidence,
  loc: string
): string[] {
  const nextActions = buildRevalidationChecklist(finding, evidence)
    .filter((item) => !evidence.revalidation[item.id])
    .map((item) => `- [ ] ${item.label}`);
  if (evidence.status === 'not_checked') {
    nextActions.unshift(`- [ ] Verify this finding against ${loc}.`);
  } else if (evidence.status === 'reproduced') {
    nextActions.unshift(`- [ ] Fix the reproduced issue and attach fresh proof.`);
  }
  return nextActions;
}

export function buildFindingHunkNoteMarkdown(input: FindingHunkNoteInput): string {
  const finding = input.finding;
  const evidence = input.evidence;
  const loc = finding.filePath
    ? `${finding.filePath}${finding.line != null ? `:${finding.line}` : ''}`
    : 'unanchored';
  const lines: string[] = [];

  lines.push(`# CodeVetter finding note`);
  lines.push('');
  lines.push(`- Diff: ${input.diffRange || 'local diff'}`);
  lines.push(`- Finding: ${input.findingIndex + 1}`);
  lines.push(`- Severity: ${finding.severity.toUpperCase()}`);
  lines.push(`- Location: ${loc}`);
  lines.push(`- Evidence status: ${evidence.status.replace('_', ' ')}`);
  lines.push(`- Evidence level: ${evidence.level}`);
  if (evidence.artifact.trim()) {
    lines.push(`- Artifact: ${evidence.artifact.trim()}`);
  }

  lines.push('', '## Finding');
  lines.push(`**${finding.title}**`);
  lines.push('');
  lines.push(finding.summary.trim() || 'No summary provided.');
  if (finding.suggestion?.trim()) {
    lines.push('', '## Suggested action');
    lines.push(finding.suggestion.trim());
  }

  if (evidence.notes.trim()) {
    lines.push('', '## Evidence notes');
    for (const line of evidence.notes
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)) {
      lines.push(`- ${line}`);
    }
  }

  if (input.historySummary) {
    lines.push(...buildFindingHunkHistorySectionLines(input.historySummary));
  }

  if (input.focusedReviewMemoryGraph && input.focusedReviewMemoryGraph.nodes.length > 0) {
    lines.push(...buildFindingHunkFocusedGraphLines(input.focusedReviewMemoryGraph));
  }

  const nextActions = buildFindingHunkNextActionsLines(finding, evidence, loc);
  if (nextActions.length > 0) {
    lines.push('', '## Next verification actions', ...nextActions);
  }

  lines.push('', '## Agent-context instruction');
  lines.push(
    'Use this note as bounded local context. Validate every graph edge against source before editing, preserve unrelated files, and return fresh evidence for the same finding.'
  );

  return lines.join('\n');
}
