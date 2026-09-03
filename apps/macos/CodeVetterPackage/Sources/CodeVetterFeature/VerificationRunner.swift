import Foundation

public struct VerificationRequest: Sendable {
  public let requestID: String
  public let repositoryPath: String
  public let change: String
  public let task: String
  public let reviewAgent: String
  public let specPaths: [String]
  public let selectedRequirementIDs: [String]

  public init(
    requestID: String = UUID().uuidString.lowercased(),
    repositoryPath: String,
    change: String,
    task: String,
    reviewAgent: String = "claude",
    specPaths: [String] = [],
    selectedRequirementIDs: [String] = []
  ) {
    self.requestID = requestID
    self.repositoryPath = repositoryPath
    self.change = change
    self.task = task
    self.reviewAgent = reviewAgent
    self.specPaths = specPaths
    self.selectedRequirementIDs = selectedRequirementIDs
  }
}

public enum TrexChangeKind: String, Codable, CaseIterable, Identifiable, Sendable {
  case pullRequest = "pull_request"
  case range

  public var id: String { rawValue }

  var cliFlag: String {
    switch self {
    case .pullRequest: "--pr"
    case .range: "--range"
    }
  }
}

public struct TrexPreviewRequest: Sendable {
  public let repositoryPath: String
  public let changeKind: TrexChangeKind
  public let change: String
  public let previewURL: String
  public let targetRoute: String?
  public let targetGoal: String?

  public init(
    repositoryPath: String,
    changeKind: TrexChangeKind,
    change: String,
    previewURL: String,
    targetRoute: String? = nil,
    targetGoal: String? = nil
  ) {
    self.repositoryPath = repositoryPath
    self.changeKind = changeKind
    self.change = change
    self.previewURL = previewURL
    self.targetRoute = targetRoute
    self.targetGoal = targetGoal
  }
}

public struct TrexPreviewReceipt: Codable, Sendable {
  public let schemaVersion: UInt32
  public let runID: String
  public let repoPath: String
  public let source: TrexSourceReceipt
  public let preview: TrexPreviewIdentity
  public let routes: [TrexPreviewRoute]
  public let journeys: [TrexSyntheticJourney]
  public let verdict: TrexPreviewVerdict
  public let summary: String
  public let limitations: [String]
  public let durationMS: UInt64
  public let ranAt: String

  enum CodingKeys: String, CodingKey {
    case source, preview, routes, journeys, verdict, summary, limitations
    case schemaVersion = "schema_version"
    case runID = "run_id"
    case repoPath = "repo_path"
    case durationMS = "duration_ms"
    case ranAt = "ran_at"
  }
}

public struct TrexSourceReceipt: Codable, Sendable {
  public let kind: TrexChangeKind
  public let input: String
  public let baseSHA: String
  public let headSHA: String
  public let commits: [String]
  public let changedPaths: [String]

  enum CodingKeys: String, CodingKey {
    case kind, input, commits
    case baseSHA = "base_sha"
    case headSHA = "head_sha"
    case changedPaths = "changed_paths"
  }
}

public enum TrexPreviewIdentityStatus: String, Codable, Sendable {
  case verified
  case claimed
  case mismatch
}

public struct TrexPreviewIdentity: Codable, Sendable {
  public let status: TrexPreviewIdentityStatus
  public let requestedURL: String
  public let finalURL: String
  public let revision: String?
  public let evidence: String

  enum CodingKeys: String, CodingKey {
    case status, revision, evidence
    case requestedURL = "requested_url"
    case finalURL = "final_url"
  }
}

public struct TrexPreviewRoute: Codable, Identifiable, Sendable {
  public let route: String
  public let reason: String
  public let goal: String?

  public var id: String { "\(route)\u{0}\(reason)" }
}

public enum TrexPreviewVerdict: String, Codable, Sendable {
  case passedWithLimits = "passed_with_limits"
  case failed
  case noConfidence = "no_confidence"
}

public struct TrexSyntheticJourney: Codable, Identifiable, Sendable {
  public let loopID: String
  public let route: String
  public let goal: String
  public let pass: Bool
  public let notes: String
  public let screenshotPath: String?
  public let artifacts: [String]
  public let durationMS: UInt64
  public let trace: TrexSyntheticTrace
  public let error: String?
  public let runnerType: String?

  public var id: String { "\(loopID)\u{0}\(route)" }

  enum CodingKeys: String, CodingKey {
    case route, goal, pass, notes, artifacts, trace, error
    case loopID = "loop_id"
    case screenshotPath = "screenshot_path"
    case durationMS = "duration_ms"
    case runnerType = "runner_type"
  }
}

public struct TrexSyntheticTrace: Codable, Sendable {
  public let finalURL: String
  public let pageTitle: String
  public let consoleErrors: [String]
  public let stageTimingsMS: [String: Double]
  public let runnerRSSBytes: UInt64?

  enum CodingKeys: String, CodingKey {
    case finalURL = "final_url"
    case pageTitle = "page_title"
    case consoleErrors = "console_errors"
    case stageTimingsMS = "stage_timings_ms"
    case runnerRSSBytes = "runner_rss_bytes"
  }
}

public struct TrexPreviewRunResult: Sendable {
  public let receipt: TrexPreviewReceipt
  public let rawJSON: String
  public let processStatus: Int32
}

public struct QaTargetPreset: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let route: String
  public let goal: String
}

public struct QaWorkflow: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let baseURL: String
  public let loopID: String
  public let runnerType: String
  public let goal: String
  public let repoSpecPath: String
  public let repoTraceMode: String
  public let targetRoute: String
  public let allowRemoteTarget: Bool
  public let targets: [QaTargetPreset]
  public let updatedAt: String
  public let editable: Bool
  public let limitation: String?

  enum CodingKeys: String, CodingKey {
    case id, name, goal, targets, editable, limitation
    case baseURL = "base_url"
    case loopID = "loop_id"
    case runnerType = "runner_type"
    case repoSpecPath = "repo_spec_path"
    case repoTraceMode = "repo_trace_mode"
    case targetRoute = "target_route"
    case allowRemoteTarget = "allow_remote_target"
    case updatedAt = "updated_at"
  }
}

public struct QaSpecCandidate: Codable, Identifiable, Equatable, Sendable {
  public let path: String
  public let reason: String
  public var id: String { path }
}

public struct QaRerunRun: Codable, Equatable, Sendable {
  public let id: String
  public let createdAt: String
  public let runnerType: String
  public let baseURL: String
  public let loopID: String
  public let route: String
  public let goal: String
  public let pass: Bool
  public let durationMS: Int64

  enum CodingKeys: String, CodingKey {
    case id, route, goal, pass
    case createdAt = "created_at"
    case runnerType = "runner_type"
    case baseURL = "base_url"
    case loopID = "loop_id"
    case durationMS = "duration_ms"
  }
}

public struct QaPostFixPreparation: Codable, Equatable, Sendable {
  public let status: String
  public let summary: String
  public let before: QaRerunRun
  public let after: QaRerunRun?
}

public struct QaWorkspaceReceipt: Codable, Equatable, Sendable {
  public let schemaVersion: String
  public let repoPath: String
  public let preferenceKey: String
  public let source: String
  public let workflows: [QaWorkflow]
  public let specs: [QaSpecCandidate]
  public let postFix: QaPostFixPreparation?
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case source, workflows, specs, limitations
    case schemaVersion = "schema_version"
    case repoPath = "repo_path"
    case preferenceKey = "preference_key"
    case postFix = "post_fix"
  }
}

public struct QaWorkflowDraft: Equatable, Sendable {
  public var id: String
  public var name: String
  public var baseURL: String
  public var loopID: String
  public var runnerType: String
  public var goal: String
  public var repoSpecPath: String
  public var repoTraceMode: String
  public var targetRoute: String
  public var allowRemoteTarget: Bool
}

public enum WarmVerificationOutcome: String, Codable, Sendable {
  case passed
  case regression
  case noConfidence = "no_confidence"
}

public struct WarmVerificationRunReceipt: Codable, Sendable {
  public let id: String
  public let repoPath: String
  public let result: WarmVerificationResult
  public let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id, result
    case repoPath = "repo_path"
    case createdAt = "created_at"
  }
}

public struct WarmVerificationResult: Codable, Sendable {
  public let schemaVersion: UInt32
  public let protocolVersion: UInt32
  public let runID: String
  public let outcome: WarmVerificationOutcome
  public let startedAt: String
  public let finishedAt: String
  public let warm: Bool
  public let stale: Bool
  public let modelCallCount: UInt32
  public let source: WarmVerificationSource
  public let observationPolicy: WarmObservationPolicy
  public let selection: WarmVerificationSelection
  public let scenarios: [WarmScenarioOutcome]
  public let timings: [WarmVerificationTiming]
  public let observations: [WarmVerificationObservation]
  public let limitations: [WarmVerificationLimitation]
  public let artifacts: [WarmVerificationArtifact]
  public let cancellation: WarmCancellation

  enum CodingKeys: String, CodingKey {
    case outcome, warm, stale, source, selection, scenarios, timings, observations, limitations,
      artifacts, cancellation
    case schemaVersion = "schema_version"
    case protocolVersion = "protocol_version"
    case runID = "run_id"
    case startedAt = "started_at"
    case finishedAt = "finished_at"
    case modelCallCount = "model_call_count"
    case observationPolicy = "observation_policy"
  }
}

public struct WarmVerificationSource: Codable, Sendable {
  public let targetSHA: String
  public let changeSetKind: String
  public let changeSetIdentity: String
  public let changeSetRevision: String?
  public let configHash: String
  public let manifestHash: String
  public let sourceHashBefore: String
  public let sourceHashAfter: String

  enum CodingKeys: String, CodingKey {
    case targetSHA = "target_sha"
    case changeSetKind = "change_set_kind"
    case changeSetIdentity = "change_set_identity"
    case changeSetRevision = "change_set_revision"
    case configHash = "config_hash"
    case manifestHash = "manifest_hash"
    case sourceHashBefore = "source_hash_before"
    case sourceHashAfter = "source_hash_after"
  }
}

public struct WarmObservationPolicy: Codable, Sendable {
  public let schemaVersion: UInt32
  public let profileID: String

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case profileID = "profile_id"
  }
}

public struct WarmVerificationSelection: Codable, Sendable {
  public let changedPaths: [String]
  public let selectedScenarioIDs: [String]
  public let mandatorySmokeIDs: [String]
  public let fallbackScenarioIDs: [String]
  public let complete: Bool
  public let explanation: String

  enum CodingKeys: String, CodingKey {
    case complete, explanation
    case changedPaths = "changed_paths"
    case selectedScenarioIDs = "selected_scenario_ids"
    case mandatorySmokeIDs = "mandatory_smoke_ids"
    case fallbackScenarioIDs = "fallback_scenario_ids"
  }
}

public struct WarmScenarioOutcome: Codable, Identifiable, Sendable {
  public let scenarioID: String
  public let outcome: WarmVerificationOutcome
  public let durationMS: Double
  public var id: String { scenarioID }

  enum CodingKeys: String, CodingKey {
    case outcome
    case scenarioID = "scenario_id"
    case durationMS = "duration_ms"
  }
}

public struct WarmVerificationTiming: Codable, Identifiable, Sendable {
  public let stage: String
  public let durationMS: Double
  public let scenarioID: String?
  public var id: String { "\(stage)\u{0}\(scenarioID ?? "all")" }

  enum CodingKeys: String, CodingKey {
    case stage
    case durationMS = "duration_ms"
    case scenarioID = "scenario_id"
  }
}

public struct WarmVerificationObservation: Codable, Identifiable, Sendable {
  public let id: String
  public let scenarioID: String
  public let kind: String
  public let disposition: String
  public let policyID: String
  public let message: String
  public let checkpoint: String?
  public let occurredAt: String

  enum CodingKeys: String, CodingKey {
    case id, kind, disposition, message, checkpoint
    case scenarioID = "scenario_id"
    case policyID = "policy_id"
    case occurredAt = "occurred_at"
  }
}

public struct WarmVerificationLimitation: Codable, Identifiable, Sendable {
  public let code: String
  public let message: String
  public let affectsConfidence: Bool
  public let remediation: String?
  public let scenarioID: String?
  public var id: String { "\(code)\u{0}\(scenarioID ?? "all")\u{0}\(message)" }

  enum CodingKeys: String, CodingKey {
    case code, message, remediation
    case affectsConfidence = "affects_confidence"
    case scenarioID = "scenario_id"
  }
}

public struct WarmVerificationArtifact: Codable, Identifiable, Sendable {
  public let id: String
  public let kind: String
  public let relativePath: String
  public let sha256: String
  public let bytes: UInt64
  public let redacted: Bool
  public let createdAt: String
  public let retainedUntil: String
  public let scenarioID: String?

  enum CodingKeys: String, CodingKey {
    case id, kind, sha256, bytes, redacted
    case relativePath = "relative_path"
    case createdAt = "created_at"
    case retainedUntil = "retained_until"
    case scenarioID = "scenario_id"
  }
}

public struct WarmCancellation: Codable, Sendable {
  public let state: String
  public let requestedAt: String?
  public let completedAt: String?
  public let reason: String?

  enum CodingKeys: String, CodingKey {
    case state, reason
    case requestedAt = "requested_at"
    case completedAt = "completed_at"
  }
}

public struct WarmDaemonHealth: Codable, Sendable {
  public let schemaVersion: UInt32
  public let daemonPID: UInt32
  public let targetRoot: String
  public let targetSHA: String
  public let warm: Bool
  public let server: WarmRuntimeHealth
  public let browser: WarmRuntimeHealth
  public let activeRunIDs: [String]
  public let resources: WarmDaemonResources
  public let checkedAt: String

  enum CodingKeys: String, CodingKey {
    case warm, server, browser, resources
    case schemaVersion = "schema_version"
    case daemonPID = "daemon_pid"
    case targetRoot = "target_root"
    case targetSHA = "target_sha"
    case activeRunIDs = "active_run_ids"
    case checkedAt = "checked_at"
  }
}

public struct WarmRuntimeHealth: Codable, Sendable {
  public let kind: String
  public let state: String
  public let owned: Bool
  public let pid: UInt32?
  public let restartAttempts: UInt32

  enum CodingKeys: String, CodingKey {
    case kind, state, owned, pid
    case restartAttempts = "restart_attempts"
  }
}

public struct WarmDaemonResources: Codable, Sendable {
  public let rssBytes: UInt64
  public let heapUsedBytes: UInt64
  public let activeContexts: UInt32
  public let retainedArtifactBytes: UInt64

  enum CodingKeys: String, CodingKey {
    case rssBytes = "rss_bytes"
    case heapUsedBytes = "heap_used_bytes"
    case activeContexts = "active_contexts"
    case retainedArtifactBytes = "retained_artifact_bytes"
  }
}

public struct WarmVerificationRunResult: Sendable {
  public let receipt: WarmVerificationRunReceipt
  public let rawJSON: String
  public let processStatus: Int32
}

public enum DifferentialCandidateKind: String, Codable, CaseIterable, Identifiable, Sendable {
  case worktree
  case staged
  case commit
  case range

  public var id: String { rawValue }
}

public struct DifferentialRequest: Sendable {
  public let repositoryPath: String
  public let runID: String
  public let reference: String
  public let candidateKind: DifferentialCandidateKind
  public let candidateRevision: String?
}

public struct DifferentialPreparedReceipt: Codable, Sendable {
  public let schemaVersion: UInt32
  public let runID: String
  public let status: String
  public let referenceSHA: String?
  public let candidateKind: DifferentialCandidateKind
  public let candidateIdentity: String?
  public let selectionIdentity: String?
  public let scenarioCount: UInt32
  public let sourceCacheHits: UInt32
  public let dependencyCacheHit: Bool
  public let preparedBytes: UInt64
  public let reasonCodes: [String]
  public let modelCallCount: UInt32
  public let cleanupComplete: Bool

  enum CodingKeys: String, CodingKey {
    case status
    case schemaVersion = "schema_version"
    case runID = "run_id"
    case referenceSHA = "reference_sha"
    case candidateKind = "candidate_kind"
    case candidateIdentity = "candidate_identity"
    case selectionIdentity = "selection_identity"
    case scenarioCount = "scenario_count"
    case sourceCacheHits = "source_cache_hits"
    case dependencyCacheHit = "dependency_cache_hit"
    case preparedBytes = "prepared_bytes"
    case reasonCodes = "reason_codes"
    case modelCallCount = "model_call_count"
    case cleanupComplete = "cleanup_complete"
  }
}

public struct StoredDifferentialRun: Codable, Sendable {
  public let id: String
  public let repoPath: String
  public let summary: DifferentialSummary
  public let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id, summary
    case repoPath = "repo_path"
    case createdAt = "created_at"
  }
}

public struct DifferentialSummary: Codable, Sendable {
  public let schemaVersion: UInt32
  public let runID: String
  public let status: String
  public let classification: String
  public let planIdentity: String?
  public let referenceSHA: String?
  public let candidateKind: DifferentialCandidateKind
  public let candidateIdentity: String?
  public let scenarioCount: UInt32
  public let deltaCount: UInt32
  public let blockingDeltaCount: UInt32
  public let deltaPreviews: [DifferentialDeltaPreview]
  public let deltaPreviewsTruncated: Bool
  public let reasonCodes: [String]
  public let comparisonPolicyIdentities: [String]
  public let durationMS: Double
  public let cleanupComplete: Bool
  public let createsPassEvidence: Bool
  public let modelCallCount: UInt32

  enum CodingKeys: String, CodingKey {
    case status, classification
    case schemaVersion = "schema_version"
    case runID = "run_id"
    case planIdentity = "plan_identity"
    case referenceSHA = "reference_sha"
    case candidateKind = "candidate_kind"
    case candidateIdentity = "candidate_identity"
    case scenarioCount = "scenario_count"
    case deltaCount = "delta_count"
    case blockingDeltaCount = "blocking_delta_count"
    case deltaPreviews = "delta_previews"
    case deltaPreviewsTruncated = "delta_previews_truncated"
    case reasonCodes = "reason_codes"
    case comparisonPolicyIdentities = "comparison_policy_identities"
    case durationMS = "duration_ms"
    case cleanupComplete = "cleanup_complete"
    case createsPassEvidence = "creates_pass_evidence"
    case modelCallCount = "model_call_count"
  }
}

public struct DifferentialDeltaPreview: Codable, Identifiable, Sendable {
  public let id: String
  public let scenarioID: String
  public let kind: String
  public let direction: String
  public let blocking: Bool
  public let policyID: String

  enum CodingKeys: String, CodingKey {
    case id, kind, direction, blocking
    case scenarioID = "scenario_id"
    case policyID = "policy_id"
  }
}

public enum ScenarioCompilerAction: Sendable {
  case inspect(candidateID: String?)
  case generate(
    spec: String, section: String?, model: String, routes: [String], requestPolicy: Bool)
  case validate(candidateID: String)
  case dryRun(candidateID: String)
  case accept(candidateID: String, hash: String, destinations: [String], approveReplacements: Bool)
  case reject(candidateID: String, hash: String)

  var expectedReceiptAction: String {
    switch self {
    case .inspect: "inspect"
    case .generate: "generate"
    case .validate: "validate"
    case .dryRun: "dry_run"
    case .accept: "accept"
    case .reject: "reject"
    }
  }
}

public struct ScenarioCompilerReceipt: Codable, Sendable {
  public let schemaVersion: UInt32
  public let action: String
  public let status: String
  public let message: String
  public let candidate: ScenarioCandidate?
  public let candidates: [ScenarioCandidate]
  public let cleanup: ScenarioCleanup?

  enum CodingKeys: String, CodingKey {
    case action, status, message, candidate, candidates, cleanup
    case schemaVersion = "schema_version"
  }
}

public struct ScenarioCandidate: Codable, Identifiable, Sendable {
  public let schemaVersion: UInt32
  public let candidateID: String
  public let candidateHash: String
  public let status: String
  public let createdAt: String
  public let expiresAt: String
  public let specSourcePath: String
  public let specSection: String?
  public let targetSHA: String
  public let provider: ScenarioProvider
  public let providerDurationMS: UInt64
  public let cacheHit: Bool
  public let usage: ScenarioUsage
  public let unresolvedRequirements: [String]
  public let validation: ScenarioValidation
  public let dryRun: ScenarioDryRun
  public let files: [ScenarioFile]
  public let acceptedFileHashes: [String: String]
  public var id: String { candidateID }

  enum CodingKeys: String, CodingKey {
    case status, provider, usage, validation, files
    case schemaVersion = "schema_version"
    case candidateID = "candidate_id"
    case candidateHash = "candidate_hash"
    case createdAt = "created_at"
    case expiresAt = "expires_at"
    case specSourcePath = "spec_source_path"
    case specSection = "spec_section"
    case targetSHA = "target_sha"
    case providerDurationMS = "provider_duration_ms"
    case cacheHit = "cache_hit"
    case unresolvedRequirements = "unresolved_requirements"
    case dryRun = "dry_run"
    case acceptedFileHashes = "accepted_file_hashes"
  }
}

public struct ScenarioProvider: Codable, Sendable {
  public let kind: String
  public let provider: String
  public let model: String
  public let costClass: String
  public let paidApproved: Bool
  enum CodingKeys: String, CodingKey {
    case kind, provider, model
    case costClass = "cost_class"
    case paidApproved = "paid_approved"
  }
}

public struct ScenarioUsage: Codable, Sendable {
  public let inputTokens: UInt64?
  public let outputTokens: UInt64?
  public let estimatedCostUSD: Double?
  public let actualCostUSD: Double?
  enum CodingKeys: String, CodingKey {
    case inputTokens = "input_tokens"
    case outputTokens = "output_tokens"
    case estimatedCostUSD = "estimated_cost_usd"
    case actualCostUSD = "actual_cost_usd"
  }
}

public struct ScenarioValidation: Codable, Sendable {
  public let qualified: Bool
  public let issues: [ScenarioIssue]
}

public struct ScenarioIssue: Codable, Identifiable, Sendable {
  public let path: String
  public let message: String
  public let severity: String
  public var id: String { "\(path)\u{0}\(message)" }
}

public struct ScenarioDryRun: Codable, Sendable {
  public let status: String
  public let durationMS: UInt64?
  public let summary: String
  public let diagnostics: [String]
  public let evidencePersisted: Bool
  public let baselinesUpdated: Bool
  enum CodingKeys: String, CodingKey {
    case status, summary, diagnostics
    case durationMS = "duration_ms"
    case evidencePersisted = "evidence_persisted"
    case baselinesUpdated = "baselines_updated"
  }
}

public struct ScenarioFile: Codable, Identifiable, Sendable {
  public let kind: String
  public let destination: String
  public let sha256: String
  public let replacesExisting: Bool
  public let diff: String
  public var id: String { destination }
  enum CodingKeys: String, CodingKey {
    case kind, destination, sha256, diff
    case replacesExisting = "replaces_existing"
  }
}

public struct ScenarioCleanup: Codable, Sendable {
  public let removedCandidates: UInt32
  public let removedFiles: UInt32
  public let reclaimedBytes: UInt64
  public let retainedCandidates: UInt32
  enum CodingKeys: String, CodingKey {
    case removedCandidates = "removed_candidates"
    case removedFiles = "removed_files"
    case reclaimedBytes = "reclaimed_bytes"
    case retainedCandidates = "retained_candidates"
  }
}

public enum TrexWatcherAction: Sendable {
  case list
  case enable(intervalSeconds: UInt64, baseBranch: String?)
  case disable
  case poll
  case retry(prNumber: Int64)
  case runs(limit: UInt32)

  var receiptOperation: String {
    switch self {
    case .list: "list"
    case .enable: "enable"
    case .disable: "disable"
    case .poll: "poll"
    case .retry: "retry"
    case .runs: "runs"
    }
  }
}

public struct TrexWatcherReceipt: Codable, Sendable {
  public let schemaVersion: UInt32
  public let operation: String
  public let watcher: TrexWatcher?
  public let watchers: [TrexWatcher]
  public let runs: [TrexWatcherRun]
  public let inspectedPRs: UInt32
  public let skippedUnchanged: UInt32
  public let message: String

  enum CodingKeys: String, CodingKey {
    case operation, watcher, watchers, runs, message
    case schemaVersion = "schema_version"
    case inspectedPRs = "inspected_prs"
    case skippedUnchanged = "skipped_unchanged"
  }
}

public struct TrexWatcher: Codable, Identifiable, Sendable {
  public let repoPath: String
  public let intervalSeconds: UInt64
  public let enabled: Bool
  public let baseBranch: String?
  public let lastPolledAt: String?
  public let lastError: String?
  public let createdAt: String
  public var id: String { repoPath }

  enum CodingKeys: String, CodingKey {
    case enabled
    case repoPath = "repo_path"
    case intervalSeconds = "interval_secs"
    case baseBranch = "base_branch"
    case lastPolledAt = "last_polled_at"
    case lastError = "last_error"
    case createdAt = "created_at"
  }
}

public struct TrexWatcherRun: Codable, Identifiable, Sendable {
  public let id: String
  public let repoPath: String
  public let prNumber: Int64
  public let headSHA: String
  public let verdict: String
  public let confidence: Double
  public let summary: String
  public let statusState: String?
  public let statusError: String?
  public let durationMS: Int64
  public let ranAt: String

  enum CodingKeys: String, CodingKey {
    case id, verdict, confidence, summary
    case repoPath = "repo_path"
    case prNumber = "pr_number"
    case headSHA = "head_sha"
    case statusState = "status_state"
    case statusError = "status_error"
    case durationMS = "duration_ms"
    case ranAt = "ran_at"
  }
}

public enum PerformanceOperation: String, Codable, CaseIterable, Identifiable, Sendable {
  case plan
  case diagnose
  case inspect
  case verifyPaired = "verify_paired"

  public var id: String { rawValue }

  var cliValue: String {
    switch self {
    case .verifyPaired: "verify-paired"
    default: rawValue
    }
  }
}

public enum PerformanceAdapter: String, Codable, CaseIterable, Identifiable, Sendable {
  case goTest = "go-test"
  case vitest
  case nodeTest = "node-test"
  case nodeScript = "node-script"
  case playwright
  case goBench = "go-bench"

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .goTest: "Go test"
    case .vitest: "Vitest"
    case .nodeTest: "Node test"
    case .nodeScript: "Node script"
    case .playwright: "Playwright"
    case .goBench: "Go benchmark"
    }
  }
}

public struct PerformanceRunRequest: Sendable {
  public let requestID: String
  public let operation: PerformanceOperation
  public let repositoryPath: String
  public let adapter: PerformanceAdapter?
  public let target: String?
  public let name: String?
  public let samples: Int?
  public let warmups: Int?
  public let timeoutMS: Int?
  public let subjectRunID: String?
  public let baselineRepositoryPath: String?

  public init(
    requestID: String,
    operation: PerformanceOperation,
    repositoryPath: String,
    adapter: PerformanceAdapter? = nil,
    target: String? = nil,
    name: String? = nil,
    samples: Int? = nil,
    warmups: Int? = nil,
    timeoutMS: Int? = nil,
    subjectRunID: String? = nil,
    baselineRepositoryPath: String? = nil
  ) {
    self.requestID = requestID
    self.operation = operation
    self.repositoryPath = repositoryPath
    self.adapter = adapter
    self.target = target
    self.name = name
    self.samples = samples
    self.warmups = warmups
    self.timeoutMS = timeoutMS
    self.subjectRunID = subjectRunID
    self.baselineRepositoryPath = baselineRepositoryPath
  }
}

public enum PerformanceRunState: String, Codable, Sendable {
  case succeeded
  case completedWithRejection = "completed_with_rejection"
  case noConfidence = "no_confidence"
  case cancelled
}

public struct PerformanceCleanupReceipt: Codable, Sendable {
  public let ownedProcessReaped: Bool
  public let temporaryProfilesRetained: Bool

  enum CodingKeys: String, CodingKey {
    case ownedProcessReaped = "owned_process_reaped"
    case temporaryProfilesRetained = "temporary_profiles_retained"
  }
}

public struct PerformanceResourceReceipt: Codable, Sendable {
  public let sampler: String?
  public let sampleIntervalMS: UInt64
  public let samples: UInt32
  public let peakRSSBytes: UInt64?
  public let peakProcesses: UInt32?
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case sampler, samples, limitations
    case sampleIntervalMS = "sample_interval_ms"
    case peakRSSBytes = "peak_rss_bytes"
    case peakProcesses = "peak_processes"
  }
}

public indirect enum PerformanceJSONValue: Codable, Sendable {
  case object([String: PerformanceJSONValue])
  case array([PerformanceJSONValue])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([String: PerformanceJSONValue].self) {
      self = .object(value)
    } else if let value = try? container.decode([PerformanceJSONValue].self) {
      self = .array(value)
    } else {
      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Unsupported performance receipt JSON value."
      )
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .object(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .null: try container.encodeNil()
    }
  }

  public var objectValue: [String: PerformanceJSONValue]? {
    guard case .object(let value) = self else { return nil }
    return value
  }

  public var arrayValue: [PerformanceJSONValue]? {
    guard case .array(let value) = self else { return nil }
    return value
  }

  public var stringValue: String? {
    guard case .string(let value) = self else { return nil }
    return value
  }

  public var boolValue: Bool? {
    guard case .bool(let value) = self else { return nil }
    return value
  }

  public var numberValue: Double? {
    guard case .number(let value) = self else { return nil }
    return value
  }

  public var displayValue: String {
    switch self {
    case .string(let value): value
    case .number(let value):
      value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
    case .bool(let value): value ? "Yes" : "No"
    case .null: "—"
    case .array(let values): values.map(\.displayValue).joined(separator: ", ")
    case .object(let values):
      values.sorted { $0.key < $1.key }
        .prefix(3)
        .map { "\($0.key.replacingOccurrences(of: "_", with: " ")): \($0.value.displayValue)" }
        .joined(separator: " · ")
    }
  }

  public func value(at path: String...) -> PerformanceJSONValue? {
    path.reduce(Optional(self)) { value, key in value?.objectValue?[key] }
  }
}

public struct PerformanceRunReceipt: Codable, Sendable {
  public let schemaVersion: UInt32
  public let requestID: String
  public let operation: PerformanceOperation
  public let state: PerformanceRunState
  public let exitCode: Int32?
  public let durationMS: UInt64
  public let result: PerformanceJSONValue
  public let stderrSummary: String?
  public let cleanup: PerformanceCleanupReceipt
  public let resources: PerformanceResourceReceipt?

  enum CodingKeys: String, CodingKey {
    case operation, state, result, cleanup, resources
    case schemaVersion = "schema_version"
    case requestID = "request_id"
    case exitCode = "exit_code"
    case durationMS = "duration_ms"
    case stderrSummary = "stderr_summary"
  }

  public var outcome: String {
    result.value(at: "verdict", "status")?.stringValue
      ?? result.value(at: "decision", "status")?.stringValue
      ?? state.rawValue
  }

  public var summary: String {
    if operation == .inspect,
      let runID = result.value(at: "receipt", "run_id")?.stringValue,
      let state = result.value(at: "receipt", "state")?.stringValue
    {
      return "Recorded run \(runID) is \(state.replacingOccurrences(of: "_", with: " "))."
    }
    return result.value(at: "diagnosis", "summary")?.stringValue
      ?? result.value(at: "decision", "reason")?.stringValue
      ?? result.value(at: "next_action", "summary")?.stringValue
      ?? "The Rust performance engine returned a bounded receipt."
  }

  public var limitations: [String] {
    result.value(at: "limitations")?.arrayValue?.compactMap(\.stringValue) ?? []
  }

  public var blockers: [String] {
    result.value(at: "decision", "blockers")?.arrayValue?.compactMap(\.stringValue) ?? []
  }

  public var admitted: Bool {
    result.value(at: "decision", "status")?.stringValue == "admitted"
  }

  public func evidenceRows(_ key: String) -> [PerformanceJSONValue] {
    result.value(at: key)?.arrayValue ?? []
  }
}

public struct PerformanceRunResult: Sendable {
  public let receipt: PerformanceRunReceipt
  public let rawJSON: String
  public let processStatus: Int32
}

public enum XrayFormat: String, Codable, CaseIterable, Identifiable, Sendable {
  case html
  case markdown
  case json

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .html: "Static HTML"
    case .markdown: "Markdown"
    case .json: "JSON"
    }
  }

  public var pathExtension: String {
    switch self {
    case .html: "html"
    case .markdown: "md"
    case .json: "json"
    }
  }
}

public struct XrayRequest: Sendable {
  public let reviewID: String
  public let publicSourceConfirmed: Bool
  public let publicSource: String?
  public let approvedExcerptFindingIDs: [String]
  public let corpusState: String?

  public init(
    reviewID: String,
    publicSourceConfirmed: Bool,
    publicSource: String? = nil,
    approvedExcerptFindingIDs: [String] = [],
    corpusState: String? = nil
  ) {
    self.reviewID = reviewID
    self.publicSourceConfirmed = publicSourceConfirmed
    self.publicSource = publicSource
    self.approvedExcerptFindingIDs = approvedExcerptFindingIDs
    self.corpusState = corpusState
  }
}

public struct XrayBuildResult: Codable, Sendable {
  public let eligible: Bool
  public let missingRequirements: [String]
  public let sanitizerIssues: [String]
  public let payload: PerformanceJSONValue
  public let json: String
  public let markdown: String
  public let html: String

  enum CodingKeys: String, CodingKey {
    case eligible, payload, json, markdown, html
    case missingRequirements = "missing_requirements"
    case sanitizerIssues = "sanitizer_issues"
  }

  public var xrayID: String { payload.value(at: "xray_id")?.stringValue ?? "xray" }
  public var outcome: String { payload.value(at: "outcome")?.stringValue ?? "incomplete" }
  public var findings: [PerformanceJSONValue] {
    payload.value(at: "findings")?.arrayValue ?? []
  }
  public var stages: [PerformanceJSONValue] {
    payload.value(at: "stages")?.arrayValue ?? []
  }
  public var allIssues: [String] { missingRequirements + sanitizerIssues }
}

public struct XrayRunResult: Sendable {
  public let result: XrayBuildResult
  public let rawJSON: String
  public let processStatus: Int32
}

public struct AgentFixPacketReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let createdAt: String
  public let runID: String
  public let repoPath: String
  public let source: FixPacketSource
  public let agent: String
  public let task: FixPacketTask
  public let routeAdvice: String
  public let findings: [FixPacketFinding]
  public let evidence: [FixPacketEvidence]
  public let limitations: [String]
  public let markdown: String

  enum CodingKeys: String, CodingKey {
    case agent, task, findings, evidence, limitations, markdown, source
    case schemaVersion = "schema_version"
    case createdAt = "created_at"
    case runID = "run_id"
    case repoPath = "repo_path"
    case routeAdvice = "route_advice"
  }
}

public struct FixPacketSource: Codable, Sendable {
  public let input: String
  public let baseSHA: String
  public let headSHA: String

  enum CodingKeys: String, CodingKey {
    case input
    case baseSHA = "base_sha"
    case headSHA = "head_sha"
  }
}

public struct FixPacketTask: Codable, Sendable {
  public let goal: String
  public let acceptanceCriteria: [String]
  public let nonGoals: [String]
  public let source: String

  enum CodingKeys: String, CodingKey {
    case goal, source
    case acceptanceCriteria = "acceptance_criteria"
    case nonGoals = "non_goals"
  }
}

public struct FixPacketFinding: Codable, Identifiable, Sendable {
  public let id: String
  public let severity: String
  public let title: String
  public let summary: String
  public let suggestion: String?
  public let filePath: String
  public let line: Int?
  public let confidence: Double?

  enum CodingKeys: String, CodingKey {
    case id, severity, title, summary, suggestion, line, confidence
    case filePath = "file_path"
  }
}

public struct FixPacketEvidence: Codable, Identifiable, Sendable {
  public let kind: String
  public let status: String
  public let label: String
  public let artifact: String?
  public let qualification: String

  public var id: String { [kind, status, label, artifact ?? ""].joined(separator: "\u{0}") }
}

public struct FixAttemptReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let attemptID: String
  public let operation: String
  public let state: String
  public let sourceRunID: String
  public let repositoryPath: String
  public let source: FixAttemptSource
  public let worktree: FixAttemptWorktree
  public let agent: FixAttemptAgent
  public let change: FixAttemptChange
  public let recheck: FixAttemptRecheck
  public let limitations: [String]
  public let startedAt: String
  public let completedAt: String

  enum CodingKeys: String, CodingKey {
    case operation, state, source, worktree, agent, change, recheck, limitations
    case schemaVersion = "schema_version"
    case attemptID = "attempt_id"
    case sourceRunID = "source_run_id"
    case repositoryPath = "repository_path"
    case startedAt = "started_at"
    case completedAt = "completed_at"
  }
}

public struct FixAttemptSource: Codable, Sendable {
  public let input: String
  public let baseSHA: String
  public let headSHA: String

  enum CodingKeys: String, CodingKey {
    case input
    case baseSHA = "base_sha"
    case headSHA = "head_sha"
  }
}

public struct FixAttemptWorktree: Codable, Sendable {
  public let path: String
  public let detached: Bool
  public let retained: Bool
  public let sourceHeadSHA: String

  enum CodingKeys: String, CodingKey {
    case path, detached, retained
    case sourceHeadSHA = "source_head_sha"
  }
}

public struct FixAttemptAgent: Codable, Sendable {
  public let id: String
  public let status: String
  public let durationMS: UInt64
  public let diagnostic: String?

  enum CodingKeys: String, CodingKey {
    case id, status, diagnostic
    case durationMS = "duration_ms"
  }
}

public struct FixAttemptChange: Codable, Sendable {
  public let changedFiles: [String]
  public let diffSHA256: String?
  public let diffBytes: Int
  public let diffPreview: String
  public let previewTruncated: Bool

  enum CodingKeys: String, CodingKey {
    case changedFiles = "changed_files"
    case diffSHA256 = "diff_sha256"
    case diffBytes = "diff_bytes"
    case diffPreview = "diff_preview"
    case previewTruncated = "preview_truncated"
  }
}

public struct FixAttemptRecheck: Codable, Sendable {
  public let diffCheck: FixAttemptGate
  public let correctness: FixAttemptCorrectness
  public let review: FixAttemptReview
  public let findings: [FixFindingRecheck]

  enum CodingKeys: String, CodingKey {
    case correctness, review, findings
    case diffCheck = "diff_check"
  }
}

public struct FixAttemptGate: Codable, Sendable {
  public let status: String
  public let detail: String
}

public struct FixAttemptCorrectness: Codable, Sendable {
  public let status: String
  public let target: String?
  public let durationMS: UInt64
  public let evidence: PerformanceJSONValue
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case status, target, evidence, limitations
    case durationMS = "duration_ms"
  }
}

public struct FixAttemptReview: Codable, Sendable {
  public let status: String
  public let reviewID: String?
  public let summary: String?
  public let findings: [PerformanceJSONValue]
  public let limitation: String?

  enum CodingKeys: String, CodingKey {
    case status, summary, findings, limitation
    case reviewID = "review_id"
  }
}

public struct FixFindingRecheck: Codable, Identifiable, Sendable {
  public let findingID: String
  public let status: String
  public let reason: String

  public var id: String { findingID }

  enum CodingKeys: String, CodingKey {
    case status, reason
    case findingID = "finding_id"
  }
}

public struct VerificationReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let requestID: String?
  public let runID: String?
  public let ranAt: String
  public let repoPath: String
  public let task: String
  public let standardsPack: String?
  public let source: VerificationSource
  public let status: String?
  public let verdict: String?
  public let correctnessTarget: VerificationTarget?
  public let performanceTarget: VerificationTarget?
  public let stages: VerificationStages?
  public let specCoverage: VerificationSpecCoverage?
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case requestID = "request_id"
    case runID = "run_id"
    case ranAt = "ran_at"
    case repoPath = "repo_path"
    case task, source, status, verdict, stages, limitations
    case standardsPack = "standards_pack"
    case specCoverage = "spec_coverage"
    case correctnessTarget = "correctness_target"
    case performanceTarget = "performance_target"
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    schemaVersion = try container.decode(String.self, forKey: .schemaVersion)
    requestID = try container.decodeIfPresent(String.self, forKey: .requestID)
    runID = try container.decodeIfPresent(String.self, forKey: .runID)
    ranAt = try container.decode(String.self, forKey: .ranAt)
    repoPath = try container.decode(String.self, forKey: .repoPath)
    task = try container.decode(String.self, forKey: .task)
    standardsPack = try container.decodeIfPresent(String.self, forKey: .standardsPack)
    source = try container.decode(VerificationSource.self, forKey: .source)
    status = try container.decodeIfPresent(String.self, forKey: .status)
    verdict = try container.decodeIfPresent(String.self, forKey: .verdict)
    correctnessTarget = try container.decodeIfPresent(
      VerificationTarget.self, forKey: .correctnessTarget)
    performanceTarget = try container.decodeIfPresent(
      VerificationTarget.self, forKey: .performanceTarget)
    stages = try? container.decode(VerificationStages.self, forKey: .stages)
    specCoverage = try? container.decode(VerificationSpecCoverage.self, forKey: .specCoverage)
    limitations = (try? container.decode([String].self, forKey: .limitations)) ?? []
  }

  public var reviewFindings: [VerificationFinding] {
    stages?.review.evidence.value(at: "findings")?.arrayValue?
      .compactMap(VerificationFinding.init) ?? []
  }

  public var reviewSummary: String? {
    stages?.review.evidence.value(at: "summary")?.stringValue
  }

  public var reviewStageEvidence: PerformanceJSONValue? {
    stages?.review.evidence
  }

  public var reviewID: String? {
    reviewStageEvidence?.value(at: "review_manifest", "review_id")?.stringValue
  }
}

public struct VerificationSpecCoverage: Codable, Sendable {
  public let schemaVersion: String
  public let headSHA: String
  public let sources: [VerificationSpecSource]
  public let requirements: [VerificationRequirementCoverage]
  public let summary: VerificationSpecCoverageSummary
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case sources, requirements, summary, limitations
    case schemaVersion = "schema_version"
    case headSHA = "head_sha"
  }
}

public struct VerificationSpecSource: Codable, Identifiable, Sendable {
  public let path: String
  public let sha256: String
  public let bytes: Int
  public var id: String { sha256 }
}

public struct VerificationRequirementCoverage: Codable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let text: String
  public let sourcePath: String
  public let startLine: Int
  public let endLine: Int
  public let selectedForExecution: Bool
  public let suppliedToReview: Bool
  public let status: String
  public let evidence: VerificationSpecEvidenceReference?

  enum CodingKeys: String, CodingKey {
    case id, title, text, status, evidence
    case sourcePath = "source_path"
    case startLine = "start_line"
    case endLine = "end_line"
    case selectedForExecution = "selected_for_execution"
    case suppliedToReview = "supplied_to_review"
  }
}

public struct VerificationSpecEvidenceReference: Codable, Sendable {
  public let stage: String
  public let status: String
  public let adapter: String?
  public let target: String?
  public let source: String?
}

public struct VerificationSpecCoverageSummary: Codable, Sendable {
  public let totalRequirements: Int
  public let reviewInputRequirements: Int
  public let selectedForExecution: Int
  public let verified: Int
  public let contradicted: Int
  public let reviewOnly: Int
  public let unverified: Int
  public let reviewInputCoveragePercent: Int?
  public let executableEvidenceCoveragePercent: Int?
  public let verifiedCoveragePercent: Int?

  enum CodingKeys: String, CodingKey {
    case verified, contradicted, unverified
    case totalRequirements = "total_requirements"
    case reviewInputRequirements = "review_input_requirements"
    case selectedForExecution = "selected_for_execution"
    case reviewOnly = "review_only"
    case reviewInputCoveragePercent = "review_input_coverage_percent"
    case executableEvidenceCoveragePercent = "executable_evidence_coverage_percent"
    case verifiedCoveragePercent = "verified_coverage_percent"
  }
}

public struct VerificationStages: Codable, Sendable {
  public let review: VerificationStage
  public let correctness: VerificationStage
  public let performance: VerificationStage
  public let optimization: VerificationStage
}

public struct VerificationStage: Codable, Sendable {
  public let status: String
  public let durationMS: UInt64
  public let target: VerificationTarget?
  public let evidence: PerformanceJSONValue
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case status, target, evidence, limitations
    case durationMS = "duration_ms"
  }
}

public struct VerificationFinding: Identifiable, Sendable {
  public let persistedID: String?
  public let severity: String
  public let title: String
  public let summary: String
  public let suggestion: String?
  public let filePath: String?
  public let line: Int?
  public let confidence: Double?
  public let reviewers: [String]
  public let crossReviewClass: String?

  public var id: String {
    persistedID
      ?? [severity, title, filePath ?? "", line.map(String.init) ?? ""].joined(separator: "\u{0}")
  }

  fileprivate init?(_ value: PerformanceJSONValue) {
    guard let object = value.objectValue,
      let severity = object["severity"]?.stringValue,
      let title = object["title"]?.stringValue,
      let summary = object["summary"]?.stringValue
    else { return nil }
    self.severity = severity
    persistedID = object["id"]?.stringValue
    self.title = title
    self.summary = summary
    suggestion = object["suggestion"]?.stringValue
    filePath = object["filePath"]?.stringValue ?? object["file_path"]?.stringValue
    line = object["line"]?.numberValue.map(Int.init)
    confidence = object["confidence"]?.numberValue
    reviewers = object["reviewers"]?.arrayValue?.compactMap(\.stringValue) ?? []
    crossReviewClass = object["cross_review_class"]?.stringValue
  }
}

public struct StoredVerificationRun: Identifiable, Sendable {
  public let id: String
  public let kind: String
  public let repoPath: String?
  public let recordedAt: String
  public let title: String
  public let outcome: String
  public let receiptSchema: String
  public let sourceLabel: String?
  public let limitations: [String]
  public let localCheckReceipt: VerificationReceipt?
  public let changedPaths: [String]
  public let audienceResponses: [AudienceValidationResponseSummary]
  public let artifacts: [String]
  public let rawJSON: String

  public init(localCheck receipt: VerificationReceipt, rawJSON: String) {
    id = receipt.runID ?? "\(receipt.ranAt)-\(receipt.source.headSha)"
    kind = "local_check"
    repoPath = receipt.repoPath
    recordedAt = receipt.ranAt
    title = receipt.task
    outcome = receipt.verdict ?? receipt.status ?? "completed"
    receiptSchema = receipt.schemaVersion
    sourceLabel = String(receipt.source.headSha.prefix(12))
    limitations = receipt.limitations
    localCheckReceipt = receipt
    changedPaths = receipt.source.changedPaths
    audienceResponses = []
    artifacts = []
    self.rawJSON = rawJSON
  }

  fileprivate init(metadata: RunHistoryRecordMetadata, receiptData: Data, rawJSON: String) {
    let details = (try? JSONDecoder().decode(RunReceiptDetails.self, from: receiptData))
    id = metadata.id
    kind = metadata.kind
    repoPath = metadata.repoPath
    recordedAt = metadata.recordedAt
    title = metadata.title
    outcome = metadata.outcome
    receiptSchema = metadata.receiptSchema
    sourceLabel = metadata.sourceLabel
    limitations = metadata.limitations
    localCheckReceipt =
      metadata.kind == "local_check"
      ? try? JSONDecoder().decode(VerificationReceipt.self, from: receiptData) : nil
    changedPaths = details?.source?.changedPaths ?? []
    audienceResponses = details?.responses ?? []
    artifacts = details?.artifacts ?? []
    self.rawJSON = rawJSON
  }

  func exportCanonicalReceipt(to destination: URL) throws {
    try "\(rawJSON)\n".write(to: destination, atomically: true, encoding: .utf8)
  }
}

public struct AudienceValidationResponseSummary: Codable, Identifiable, Sendable {
  public let id: String
  public let participantID: String
  public let provenance: String
  public let criterion: String
  public let preferredCandidate: String?
  public let confidence: Double
  public let taskPassed: Bool?
  public let feedback: String?
  public let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id, provenance, criterion, confidence, feedback
    case participantID = "participant_id"
    case preferredCandidate = "preferred_candidate"
    case taskPassed = "task_passed"
    case createdAt = "created_at"
  }
}

private struct RunReceiptDetails: Decodable {
  let source: RunReceiptSourceDetails?
  let responses: [AudienceValidationResponseSummary]
  let artifacts: [String]

  enum CodingKeys: String, CodingKey {
    case source, responses, artifacts
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    source = try? container.decode(RunReceiptSourceDetails.self, forKey: .source)
    responses =
      (try? container.decode([AudienceValidationResponseSummary].self, forKey: .responses)) ?? []
    artifacts = (try? container.decode([String].self, forKey: .artifacts)) ?? []
  }
}

private struct RunReceiptSourceDetails: Decodable {
  let changedPaths: [String]

  enum CodingKeys: String, CodingKey {
    case changedPaths = "changed_paths"
  }
}

private struct RunHistoryRecordMetadata: Decodable {
  let id: String
  let kind: String
  let repoPath: String?
  let recordedAt: String
  let title: String
  let outcome: String
  let receiptSchema: String
  let sourceLabel: String?
  let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case id, kind, title, outcome, limitations
    case repoPath = "repo_path"
    case recordedAt = "recorded_at"
    case receiptSchema = "receipt_schema"
    case sourceLabel = "source_label"
  }
}

public struct VerificationTarget: Codable, Sendable {
  public let adapter: String
  public let target: String
  public let name: String?
  public let source: String
}

public struct VerificationSource: Codable, Sendable {
  public let kind: String
  public let input: String
  public let baseSha: String
  public let headSha: String
  public let changedPaths: [String]

  enum CodingKeys: String, CodingKey {
    case kind, input
    case baseSha = "base_sha"
    case headSha = "head_sha"
    case changedPaths = "changed_paths"
  }
}

public struct VerificationRunResult: Sendable {
  public let receipt: VerificationReceipt
  public let rawJSON: String
  public let processStatus: Int32
}

public struct VerificationProgress: Codable, Equatable, Sendable {
  public let schemaVersion: String
  public let requestID: String
  public let sequence: UInt32
  public let stage: String
  public let state: String

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case requestID = "request_id"
    case sequence
    case stage, state
  }
}

public enum VerificationRunnerError: LocalizedError {
  case executableUnavailable([String])
  case launchFailed(String)
  case emptyReceipt(String)
  case invalidReceipt(String)

  public var errorDescription: String? {
    switch self {
    case .executableUnavailable(let candidates):
      "The Rust CLI is not available. Build codevetter or set CODEVETTER_CLI_PATH. Checked: \(candidates.joined(separator: ", "))"
    case .launchFailed(let message):
      "The Rust verifier could not start: \(message)"
    case .emptyReceipt(let message):
      "The Rust verifier returned no receipt. \(message)"
    case .invalidReceipt(let message):
      "The Rust verifier returned an invalid receipt: \(message)"
    }
  }
}

public final class CodeVetterProcessRunner: @unchecked Sendable {
  private let lock = NSLock()
  private let repositoryQueryWorkerLock = NSLock()
  private let executableOverride: URL?
  private var process: Process?
  private var repositoryQueryWorker: RepositoryQueryWorker?
  private var activeRequestID: String?
  private var cancellationRequested = false

  public init(executableURL: URL? = nil) {
    executableOverride = executableURL
  }

  public func run(
    _ request: VerificationRequest,
    preflight: Bool,
    onProgress: @escaping @Sendable (VerificationProgress) -> Void
  ) async throws -> VerificationRunResult {
    let executable = try resolveExecutable()
    var arguments = [
      "check",
      "--request-id", request.requestID,
      "--repo", request.repositoryPath,
      "--range", request.change,
      "--task", request.task,
      "--agent", request.reviewAgent,
    ]
    for path in request.specPaths {
      arguments += ["--spec", path]
    }
    for requirementID in request.selectedRequirementIDs {
      arguments += ["--requirement", requirementID]
    }
    arguments += (preflight ? ["--preflight"] : ["--progress-json"]) + ["--json"]
    let execution = try await runTrackedProcess(
      executable: executable,
      arguments: arguments,
      requestID: request.requestID,
      onStderrLine: {
        decodeProgress($0, requestID: request.requestID, onProgress: onProgress)
      }
    )
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let receipt = try JSONDecoder().decode(VerificationReceipt.self, from: Data(output.utf8))
      guard receipt.requestID == request.requestID else {
        throw VerificationRunnerError.invalidReceipt(
          "Request identity did not match the supervised command."
        )
      }
      let expectedStatus: Int32
      if preflight {
        guard receipt.schemaVersion == "codevetter.local-check-preflight/v1",
          let status = receipt.status
        else {
          throw VerificationRunnerError.invalidReceipt(
            "Preflight returned the wrong receipt schema or omitted its status.")
        }
        expectedStatus = status == "ready" ? 0 : 2
      } else {
        guard receipt.schemaVersion == "codevetter.local-check/v1",
          let verdict = receipt.verdict
        else {
          throw VerificationRunnerError.invalidReceipt(
            "Verification returned the wrong receipt schema or omitted its verdict.")
        }
        expectedStatus =
          switch verdict {
          case "passed_with_limits": 0
          case "needs_attention", "failed": 1
          case "no_confidence": 2
          default:
            throw VerificationRunnerError.invalidReceipt(
              "Verification returned the unsupported verdict \(verdict).")
          }
      }
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "Receipt outcome conflicts with process status \(execution.status).")
      }
      return VerificationRunResult(
        receipt: receipt,
        rawJSON: output,
        processStatus: execution.status
      )
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runTrex(_ request: TrexPreviewRequest) async throws -> TrexPreviewRunResult {
    let executable = try resolveExecutable()
    var arguments = [
      "trex",
      "--repo", request.repositoryPath,
      request.changeKind.cliFlag, request.change,
      "--preview", request.previewURL,
    ]
    if let route = request.targetRoute, !route.isEmpty {
      arguments += ["--route", route]
    }
    if let goal = request.targetGoal, !goal.isEmpty {
      arguments += ["--journey-goal", goal]
    }
    arguments.append("--json")
    let execution = try await runTrackedProcess(
      executable: executable,
      arguments: arguments
    )
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let receipt = try JSONDecoder().decode(TrexPreviewReceipt.self, from: Data(output.utf8))
      guard receipt.schemaVersion == 1 else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported T-Rex receipt schema \(receipt.schemaVersion).")
      }
      let expectedStatus: Int32 =
        switch receipt.verdict {
        case .passedWithLimits: 0
        case .failed: 1
        case .noConfidence: 2
        }
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "T-Rex verdict \(receipt.verdict.rawValue) conflicts with process status \(execution.status)."
        )
      }
      return TrexPreviewRunResult(
        receipt: receipt,
        rawJSON: output,
        processStatus: execution.status
      )
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func loadQaWorkspace(repositoryPath: String, fixCompletedAt: String? = nil) async throws
    -> QaWorkspaceReceipt
  {
    var arguments = ["qa", "--operation", "inspect", "--repo", repositoryPath]
    if let fixCompletedAt, !fixCompletedAt.isEmpty {
      arguments += ["--fix-completed-at", fixCompletedAt]
    }
    return try await runQaWorkspace(arguments)
  }

  public func saveQaWorkflow(repositoryPath: String, draft: QaWorkflowDraft) async throws
    -> QaWorkspaceReceipt
  {
    var arguments = [
      "qa", "--operation", "save-workflow", "--repo", repositoryPath,
      "--workflow-id", draft.id, "--workflow-name", draft.name,
      "--loop-id", draft.loopID, "--runner", draft.runnerType,
      "--goal", draft.goal, "--target-route", draft.targetRoute,
      "--trace", draft.repoTraceMode,
    ]
    if !draft.baseURL.isEmpty { arguments += ["--base-url", draft.baseURL] }
    if !draft.repoSpecPath.isEmpty { arguments += ["--repo-spec", draft.repoSpecPath] }
    if draft.allowRemoteTarget { arguments.append("--allow-remote-target") }
    return try await runQaWorkspace(arguments)
  }

  public func deleteQaWorkflow(repositoryPath: String, workflowID: String) async throws
    -> QaWorkspaceReceipt
  {
    try await runQaWorkspace([
      "qa", "--operation", "delete-workflow", "--repo", repositoryPath,
      "--workflow-id", workflowID,
    ])
  }

  public func saveQaTarget(
    repositoryPath: String,
    workflowID: String,
    target: QaTargetPreset
  ) async throws -> QaWorkspaceReceipt {
    try await runQaWorkspace([
      "qa", "--operation", "save-target", "--repo", repositoryPath,
      "--workflow-id", workflowID, "--target-id", target.id,
      "--target-name", target.name, "--target-route", target.route,
      "--goal", target.goal,
    ])
  }

  public func deleteQaTarget(
    repositoryPath: String,
    workflowID: String,
    targetID: String
  ) async throws -> QaWorkspaceReceipt {
    try await runQaWorkspace([
      "qa", "--operation", "delete-target", "--repo", repositoryPath,
      "--workflow-id", workflowID, "--target-id", targetID,
    ])
  }

  private func runQaWorkspace(_ arguments: [String]) async throws -> QaWorkspaceReceipt {
    let executable = try resolveExecutable()
    let output = try await runReadOnly(executable: executable, arguments: arguments + ["--json"])
    do {
      let receipt = try JSONDecoder().decode(QaWorkspaceReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.qa-workspace/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported QA workspace schema \(receipt.schemaVersion).")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func warmHealth(repositoryPath: String) async throws -> WarmDaemonHealth? {
    let executable = try resolveExecutable()
    let execution = try await runTrackedProcess(
      executable: executable,
      arguments: [
        "warm", "--operation", "status", "--repo", repositoryPath, "--json",
      ]
    )
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      if output == "null" {
        guard execution.status == 2 else {
          throw VerificationRunnerError.invalidReceipt(
            "An unavailable warm daemon must return status 2.")
        }
        return nil
      }
      let health = try JSONDecoder().decode(WarmDaemonHealth.self, from: Data(output.utf8))
      guard health.schemaVersion == 1, execution.status == 0 else {
        throw VerificationRunnerError.invalidReceipt(
          "Warm daemon health schema or process status is inconsistent.")
      }
      return health
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runWarmChanged(
    repositoryPath: String,
    runID: String,
    detailed: Bool
  ) async throws -> WarmVerificationRunResult {
    let executable = try resolveExecutable()
    var arguments = [
      "warm", "--operation", "run", "--repo", repositoryPath,
      "--run-id", runID,
    ]
    if detailed { arguments.append("--detailed") }
    arguments.append("--json")
    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let receipt = try JSONDecoder().decode(
        WarmVerificationRunReceipt.self,
        from: Data(output.utf8)
      )
      guard receipt.result.schemaVersion == 1, receipt.result.protocolVersion == 1,
        receipt.result.runID == runID,
        receipt.repoPath == URL(fileURLWithPath: repositoryPath).resolvingSymlinksInPath().path
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The warm-verification receipt identity does not match the request.")
      }
      let expectedStatus: Int32 =
        switch receipt.result.outcome {
        case .passed: 0
        case .regression: 1
        case .noConfidence: 2
        }
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "Warm outcome \(receipt.result.outcome.rawValue) conflicts with process status \(execution.status)."
        )
      }
      return WarmVerificationRunResult(
        receipt: receipt,
        rawJSON: output,
        processStatus: execution.status
      )
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func prepareDifferential(_ request: DifferentialRequest) async throws
    -> DifferentialPreparedReceipt
  {
    let execution = try await runDifferentialProcess(request, operation: "prepare")
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(
        execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    do {
      let receipt = try JSONDecoder().decode(
        DifferentialPreparedReceipt.self, from: Data(output.utf8))
      guard receipt.schemaVersion == 1, receipt.runID == request.runID,
        receipt.candidateKind == request.candidateKind,
        execution.status == (receipt.status == "ready" ? 0 : 2)
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The differential preparation identity or status is inconsistent.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runDifferential(_ request: DifferentialRequest) async throws
    -> StoredDifferentialRun
  {
    let execution = try await runDifferentialProcess(request, operation: "run")
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(
        execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    do {
      let receipt = try JSONDecoder().decode(StoredDifferentialRun.self, from: Data(output.utf8))
      let expectedStatus: Int32 =
        switch receipt.summary.classification {
        case "regressed": 1
        case "incomparable": 2
        default: 0
        }
      guard receipt.summary.schemaVersion == 1, receipt.summary.runID == request.runID,
        receipt.summary.candidateKind == request.candidateKind,
        receipt.repoPath
          == URL(fileURLWithPath: request.repositoryPath).resolvingSymlinksInPath().path,
        execution.status == expectedStatus,
        receipt.summary.createsPassEvidence == false,
        receipt.summary.modelCallCount == 0
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The differential receipt identity, authority, or status is inconsistent.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  private func runDifferentialProcess(_ request: DifferentialRequest, operation: String)
    async throws -> TrackedProcessOutput
  {
    let executable = try resolveExecutable()
    var arguments = [
      "differential", "--operation", operation,
      "--repo", request.repositoryPath,
      "--run-id", request.runID,
      "--reference", request.reference,
      "--candidate", request.candidateKind.rawValue,
    ]
    if let revision = request.candidateRevision, !revision.isEmpty {
      arguments += ["--revision", revision]
    }
    arguments.append("--json")
    return try await runTrackedProcess(executable: executable, arguments: arguments)
  }

  public func runScenarioCompiler(
    repositoryPath: String,
    action: ScenarioCompilerAction
  ) async throws -> ScenarioCompilerReceipt {
    let executable = try resolveExecutable()
    var arguments = ["scenario", "--operation"]
    switch action {
    case .inspect(let candidateID):
      arguments.append("inspect")
      if let candidateID { arguments += ["--candidate-id", candidateID] }
    case .generate(let spec, let section, let model, let routes, let requestPolicy):
      arguments += ["generate", "--spec", spec, "--model", model]
      if let section, !section.isEmpty { arguments += ["--section", section] }
      for route in routes.sorted() { arguments += ["--route", route] }
      if requestPolicy { arguments.append("--request-policy") }
    case .validate(let candidateID):
      arguments += ["validate", "--candidate-id", candidateID]
    case .dryRun(let candidateID):
      arguments += ["dry-run", "--candidate-id", candidateID]
    case .accept(let candidateID, let hash, let destinations, let approveReplacements):
      arguments += ["accept", "--candidate-id", candidateID, "--candidate-hash", hash]
      for destination in destinations.sorted() {
        arguments += ["--destination", destination]
      }
      if approveReplacements { arguments.append("--approve-replacements") }
    case .reject(let candidateID, let hash):
      arguments += ["reject", "--candidate-id", candidateID, "--candidate-hash", hash]
    }
    arguments += ["--repo", repositoryPath, "--json"]
    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(
        execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    do {
      let receipt = try JSONDecoder().decode(ScenarioCompilerReceipt.self, from: Data(output.utf8))
      let expectedStatus: Int32 =
        switch receipt.status {
        case "ok": 0
        case "rejected": 1
        default: 2
        }
      guard receipt.schemaVersion == 1, receipt.action == action.expectedReceiptAction,
        execution.status == expectedStatus, receipt.candidates.count <= 20,
        receipt.candidate?.files.count ?? 0 <= 20
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The scenario compiler receipt action, bounds, or process status is inconsistent.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runTrexWatcher(
    repositoryPath: String?,
    action: TrexWatcherAction
  ) async throws -> TrexWatcherReceipt {
    let executable = try resolveExecutable()
    var arguments = ["watcher", "--operation", action.receiptOperation]
    switch action {
    case .list:
      break
    case .enable(let intervalSeconds, let baseBranch):
      guard let repositoryPath, !repositoryPath.isEmpty else {
        throw VerificationRunnerError.invalidReceipt("Watcher enable requires a repository.")
      }
      arguments += [
        "--repo", repositoryPath,
        "--interval-secs", String(max(intervalSeconds, 60)),
      ]
      if let baseBranch, !baseBranch.isEmpty {
        arguments += ["--base-branch", baseBranch]
      }
    case .disable:
      guard let repositoryPath, !repositoryPath.isEmpty else {
        throw VerificationRunnerError.invalidReceipt("Watcher disable requires a repository.")
      }
      arguments += ["--repo", repositoryPath]
    case .poll:
      guard let repositoryPath, !repositoryPath.isEmpty else {
        throw VerificationRunnerError.invalidReceipt("Watcher poll requires a repository.")
      }
      arguments += ["--repo", repositoryPath, "--confirm-run"]
    case .retry(let prNumber):
      guard let repositoryPath, !repositoryPath.isEmpty, prNumber > 0 else {
        throw VerificationRunnerError.invalidReceipt(
          "Watcher retry requires a repository and positive PR number.")
      }
      arguments += [
        "--repo", repositoryPath,
        "--pr-number", String(prNumber),
        "--confirm-run",
      ]
    case .runs(let limit):
      guard let repositoryPath, !repositoryPath.isEmpty else {
        throw VerificationRunnerError.invalidReceipt("Watcher run history requires a repository.")
      }
      arguments += ["--repo", repositoryPath, "--limit", String(min(max(limit, 1), 100))]
    }
    arguments.append("--json")

    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(
        execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    do {
      let receipt = try JSONDecoder().decode(TrexWatcherReceipt.self, from: Data(output.utf8))
      guard receipt.schemaVersion == 1, receipt.operation == action.receiptOperation,
        execution.status == 0, receipt.watchers.count <= 100, receipt.runs.count <= 100
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The watcher receipt operation, bounds, or process status is inconsistent.")
      }
      if let repositoryPath {
        let expected = URL(fileURLWithPath: repositoryPath).resolvingSymlinksInPath().path
        let receiptPaths =
          [receipt.watcher?.repoPath].compactMap { $0 }
          + receipt.runs.map(\.repoPath)
        guard receiptPaths.allSatisfy({ $0 == expected }) else {
          throw VerificationRunnerError.invalidReceipt(
            "The watcher receipt repository does not match the request.")
        }
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func resolveEvidenceScope(_ request: EvidenceScopeRequest) async throws
    -> EvidenceScopeRunResult
  {
    let executable = try resolveExecutable()
    var arguments = [
      "scope",
      "--consumer", request.consumer.rawValue,
      "--repo", request.repositoryPath,
      request.kind.cliFlag,
    ]
    if request.kind != .codebase {
      guard let value = request.value?.trimmingCharacters(in: .whitespacesAndNewlines),
        !value.isEmpty
      else {
        throw VerificationRunnerError.invalidReceipt(
          "Flow and change discovery require a non-empty scope value.")
      }
      arguments.append(value)
    }
    arguments.append("--json")
    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let plan = try JSONDecoder().decode(EvidenceScopePlan.self, from: Data(output.utf8))
      guard plan.schemaVersion == 1 else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported evidence-scope schema \(plan.schemaVersion).")
      }
      guard plan.consumer == request.consumer, plan.kind == request.kind else {
        throw VerificationRunnerError.invalidReceipt(
          "The evidence-scope receipt identity does not match the request.")
      }
      let expectedStatus: Int32 = plan.ready ? 0 : 2
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "Evidence-scope status \(plan.status) conflicts with process status \(execution.status)."
        )
      }
      return EvidenceScopeRunResult(
        plan: plan,
        rawJSON: output,
        processStatus: execution.status
      )
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runPerformance(_ request: PerformanceRunRequest) async throws
    -> PerformanceRunResult
  {
    let executable = try resolveExecutable()
    var arguments = [
      "performance",
      "--operation", request.operation.cliValue,
      "--repo", request.repositoryPath,
      "--request-id", request.requestID,
    ]
    if request.operation == .inspect {
      if let subjectRunID = request.subjectRunID {
        arguments += ["--subject-run-id", subjectRunID]
      }
    } else {
      if let adapter = request.adapter {
        arguments += ["--adapter", adapter.rawValue]
      }
      if let target = request.target {
        arguments += ["--target", target]
      }
      if let name = request.name, !name.isEmpty {
        arguments += ["--name", name]
      }
      if let samples = request.samples {
        arguments += ["--samples", String(samples)]
      }
      if let warmups = request.warmups {
        arguments += ["--warmups", String(warmups)]
      }
      if let timeoutMS = request.timeoutMS {
        arguments += ["--timeout-ms", String(timeoutMS)]
      }
      if let baseline = request.baselineRepositoryPath, !baseline.isEmpty {
        arguments += ["--baseline-repo", baseline]
      }
    }
    arguments.append("--json")

    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let receipt = try JSONDecoder().decode(
        PerformanceRunReceipt.self,
        from: Data(output.utf8)
      )
      guard receipt.schemaVersion == 1 else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported performance receipt schema \(receipt.schemaVersion).")
      }
      guard receipt.requestID == request.requestID, receipt.operation == request.operation else {
        throw VerificationRunnerError.invalidReceipt(
          "The performance receipt identity does not match the requested operation.")
      }
      let expectedStatus: Int32 =
        switch receipt.state {
        case .succeeded: 0
        case .completedWithRejection: 1
        case .noConfidence, .cancelled: 2
        }
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "Performance state \(receipt.state.rawValue) conflicts with process status \(execution.status)."
        )
      }
      return PerformanceRunResult(
        receipt: receipt,
        rawJSON: output,
        processStatus: execution.status
      )
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runUsage(timezone: String? = nil, refresh: Bool = false) async throws
    -> LocalUsageRunResult
  {
    let executable = try resolveExecutable()
    var arguments = ["usage"]
    if let timezone, !timezone.isEmpty {
      arguments += ["--timezone", timezone]
    }
    if refresh {
      arguments.append("--refresh")
    }
    arguments.append("--json")

    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let report = try JSONDecoder().decode(LocalUsageReport.self, from: Data(output.utf8))
      let expectedStatus: Int32 =
        switch report.status {
        case .ready: 0
        case .stale: 1
        case .unavailable: 2
        }
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "Usage state \(report.status.rawValue) conflicts with process status \(execution.status)."
        )
      }
      return LocalUsageRunResult(
        report: report,
        rawJSON: output,
        processStatus: execution.status
      )
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func listUnpackSnapshots(repositoryPath: String? = nil, limit: Int = 50) async throws
    -> UnpackHistoryReceipt
  {
    let executable = try resolveExecutable()
    var arguments = ["unpack", "--limit", String(min(max(limit, 1), 100)), "--json"]
    if let repositoryPath, !repositoryPath.isEmpty {
      arguments.insert(contentsOf: ["--repo", repositoryPath], at: 3)
    }
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(UnpackHistoryReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.unpack-history/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported Repo Unpack history schema \(receipt.schemaVersion).")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func inspectUnpackSnapshot(id: String) async throws -> UnpackSnapshotRecord {
    let executable = try resolveExecutable()
    let output = try await runReadOnly(
      executable: executable,
      arguments: ["unpack", "--report-id", id, "--json"]
    )
    do {
      return try JSONDecoder().decode(UnpackSnapshotRecord.self, from: output)
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func queryRepositoryEvidence(
    repositoryPath: String,
    domain: RepositoryQueryDomain,
    query: String,
    mode: RepositoryQueryMode = .search,
    target: String? = nil,
    direction: RepositoryGraphDirection? = nil,
    depth: Int? = nil,
    historySelector: RepositoryHistorySelectorKind? = nil,
    limit: Int = 40
  ) async throws -> RepositoryQueryReceipt {
    let executable = try resolveExecutable()
    let boundedLimit = min(max(limit, 1), 100)
    let normalizedDirection = mode == .impact ? direction ?? .outgoing : direction
    let normalizedDepth = mode == .impact ? depth ?? 3 : depth
    let receipt: RepositoryQueryReceipt
    do {
      receipt = try await worker(for: executable).query(
        repositoryPath: repositoryPath,
        domain: domain,
        mode: mode,
        query: query,
        target: target,
        direction: normalizedDirection,
        depth: normalizedDepth,
        historySelector: historySelector,
        limit: boundedLimit
      )
    } catch RepositoryQueryWorkerFailure.transport {
      // Older or test-only CLIs may not implement the persistent transport.
      // Preserve the exact canonical one-shot command as a supervised fallback.
      let execution = try await runTrackedProcess(
        executable: executable,
        arguments: repositoryQueryArguments(
          repositoryPath: repositoryPath,
          domain: domain,
          mode: mode,
          query: query,
          target: target,
          direction: normalizedDirection,
          depth: normalizedDepth,
          historySelector: historySelector,
          limit: boundedLimit
        )
      )
      let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
      guard execution.status == 0 else {
        throw VerificationRunnerError.launchFailed(errors)
      }
      receipt = try JSONDecoder().decode(RepositoryQueryReceipt.self, from: execution.stdout)
    } catch RepositoryQueryWorkerFailure.remote(let message) {
      throw VerificationRunnerError.launchFailed(message)
    }
    return try validateRepositoryQueryReceipt(
      receipt,
      repositoryPath: repositoryPath,
      domain: domain,
      mode: mode,
      query: query,
      target: target,
      direction: normalizedDirection,
      depth: normalizedDepth,
      historySelector: historySelector,
      limit: boundedLimit
    )
  }

  public func prepareRepositoryQuery(repositoryPath: String) async throws -> Bool {
    let executable = try resolveExecutable()
    do {
      return try await worker(for: executable).prepare(
        repositoryPath: repositoryPath,
        domain: .graph
      )
    } catch RepositoryQueryWorkerFailure.transport {
      // Preparation is advisory. A CLI without the worker still uses the
      // canonical supervised one-shot query path when the user submits.
      return false
    } catch RepositoryQueryWorkerFailure.remote(let message) {
      throw VerificationRunnerError.launchFailed(message)
    }
  }

  private func validateRepositoryQueryReceipt(
    _ receipt: RepositoryQueryReceipt,
    repositoryPath: String,
    domain: RepositoryQueryDomain,
    mode: RepositoryQueryMode,
    query: String,
    target: String?,
    direction: RepositoryGraphDirection?,
    depth: Int?,
    historySelector: RepositoryHistorySelectorKind?,
    limit: Int
  ) throws -> RepositoryQueryReceipt {
    let expectedPath = URL(fileURLWithPath: repositoryPath).resolvingSymlinksInPath().path
    let resultPresence = [
      receipt.graphResult != nil,
      receipt.graphExplanation != nil,
      receipt.graphImpact != nil,
      receipt.graphPath != nil,
      receipt.historyResult != nil,
      receipt.historyTrace != nil,
    ]
    let expectedIndex =
      switch (domain, mode) {
      case (.graph, .search): 0
      case (.graph, .explain): 1
      case (.graph, .impact): 2
      case (.graph, .path): 3
      case (.history, .search): 4
      case (.history, .trace): 5
      default: -1
      }
    let hasExpectedResult =
      receipt.status == "unavailable"
      ? resultPresence.allSatisfy { !$0 }
      : expectedIndex >= 0
        && resultPresence.enumerated().allSatisfy { index, present in
          present == (index == expectedIndex)
        }
    guard receipt.schemaVersion == "codevetter.repo-query/v2",
      receipt.authority == "read_only_projection",
      receipt.repoPath == expectedPath,
      receipt.domain == domain,
      receipt.mode == mode,
      receipt.query == query.trimmingCharacters(in: .whitespacesAndNewlines),
      receipt.target == target?.trimmingCharacters(in: .whitespacesAndNewlines),
      receipt.direction == direction,
      receipt.depth == depth,
      receipt.historySelector == historySelector,
      receipt.limit == limit,
      ["ready", "unavailable"].contains(receipt.status),
      hasExpectedResult
    else {
      throw VerificationRunnerError.invalidReceipt(
        "The repository query receipt identity, authority, status, or domain is inconsistent.")
    }
    return receipt
  }

  private func repositoryQueryArguments(
    repositoryPath: String,
    domain: RepositoryQueryDomain,
    mode: RepositoryQueryMode,
    query: String,
    target: String?,
    direction: RepositoryGraphDirection?,
    depth: Int?,
    historySelector: RepositoryHistorySelectorKind?,
    limit: Int
  ) -> [String] {
    var arguments = [
      "unpack", "--operation", "query", "--repo", repositoryPath,
      "--query-domain", domain.rawValue, "--query-mode", mode.rawValue,
      "--query", query, "--limit", String(limit), "--json",
    ]
    if let target { arguments.append(contentsOf: ["--query-target", target]) }
    if let direction { arguments.append(contentsOf: ["--query-direction", direction.rawValue]) }
    if let depth { arguments.append(contentsOf: ["--query-depth", String(depth)]) }
    if let historySelector {
      arguments.append(contentsOf: ["--history-selector", historySelector.rawValue])
    }
    return arguments
  }

  private func worker(for executable: URL) -> RepositoryQueryWorker {
    repositoryQueryWorkerLock.lock()
    defer { repositoryQueryWorkerLock.unlock() }
    if let repositoryQueryWorker {
      return repositoryQueryWorker
    }
    let worker = RepositoryQueryWorker(executableURL: executable)
    repositoryQueryWorker = worker
    return worker
  }

  public func scanUnpackRepository(repositoryPath: String) async throws -> UnpackScanReceipt {
    let executable = try resolveExecutable()
    let execution = try await runTrackedProcess(
      executable: executable,
      arguments: [
        "unpack", "--operation", "scan", "--repo", repositoryPath, "--json",
      ]
    )
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let receipt = try JSONDecoder().decode(UnpackScanReceipt.self, from: Data(output.utf8))
      let expectedPath = URL(fileURLWithPath: repositoryPath).resolvingSymlinksInPath().path
      guard execution.status == 0,
        receipt.schemaVersion == "codevetter.unpack-scan/v1",
        receipt.status == "scan_only",
        !receipt.reportID.isEmpty,
        receipt.inventory.repoPath == expectedPath,
        receipt.inventory.filesScanned >= 0,
        receipt.profiles.contains(where: { $0.stage == "full_scan" }),
        receipt.profiles.contains(where: { $0.stage == "local_scan_persist" })
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The Repo Unpack scan receipt identity, status, or profile boundary is inconsistent.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func compareUnpackSnapshots(
    repositoryPath: String,
    baseCommit: String,
    headCommit: String
  ) async throws -> UnpackSnapshotComparison {
    let executable = try resolveExecutable()
    let output = try await runReadOnly(
      executable: executable,
      arguments: [
        "unpack", "--operation", "compare", "--repo", repositoryPath,
        "--base-commit", baseCommit, "--head-commit", headCommit, "--json",
      ]
    )
    do {
      let comparison = try JSONDecoder().decode(UnpackSnapshotComparison.self, from: output)
      guard comparison.baseCommit == baseCommit,
        comparison.headCommit == headCommit,
        comparison.commits.count <= 24
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The Repo Unpack comparison identity or bound is inconsistent.")
      }
      return comparison
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func exportUnpackSnapshot(id: String, format: UnpackExportFormat) async throws
    -> UnpackExportReceipt
  {
    let executable = try resolveExecutable()
    let output = try await runReadOnly(
      executable: executable,
      arguments: [
        "unpack", "--operation", "export", "--report-id", id,
        "--format", format.rawValue, "--json",
      ]
    )
    do {
      let receipt = try JSONDecoder().decode(UnpackExportReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.unpack-export/v1",
        receipt.reportID == id,
        receipt.format == format.rawValue,
        !receipt.content.isEmpty
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The Repo Unpack export identity or content is inconsistent.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func loadNativeSettings() async throws -> NativeSettingsReceipt {
    try await runNativeSettings(arguments: ["settings", "--json"])
  }

  public func loadOpsStatus(windowDays: Int) async throws -> OpsStatusReceipt {
    guard [7, 30, 90].contains(windowDays) else {
      throw VerificationRunnerError.invalidReceipt("Unsupported Ops evidence window.")
    }
    let executable = try resolveExecutable()
    let output = try await runReadOnly(
      executable: executable,
      arguments: ["ops", "--window-days", String(windowDays), "--json"]
    )
    do {
      let receipt = try JSONDecoder().decode(OpsStatusReceipt.self, from: output)
      let taskTypes = receipt.observability.map(\.taskType)
      let excluded = Set(receipt.excludedSensitiveKeys)
      guard receipt.schemaVersion == "codevetter.ops-status/v1",
        receipt.windowDays == windowDays,
        receipt.observability.count <= 8,
        Set(taskTypes).count == taskTypes.count,
        receipt.observability.allSatisfy({
          $0.sessionCount >= 0 && $0.successCount >= 0 && $0.failureCount >= 0
            && (0...100).contains($0.successRatePercent)
        }),
        ["slack", "discord", "generic", "unknown"].contains(receipt.webhook.flavor),
        excluded
          == Set(["anthropic_admin_key", "openai_admin_key", "notif_webhook_url"])
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The Ops status receipt expanded its aggregate or credential boundary.")
      }
      if !receipt.databaseAvailable,
        receipt.billing.anthropicConfigured || receipt.billing.openaiConfigured
          || receipt.webhook.configured || !receipt.observability.isEmpty
      {
        throw VerificationRunnerError.invalidReceipt(
          "Unavailable Ops storage cannot report configured or aggregate evidence.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func loadOnboarding() async throws -> OnboardingReceipt {
    try await runOnboarding(arguments: ["onboarding", "--json"], expected: .inspect)
  }

  public func completeOnboarding(defaultAdapter: String) async throws -> OnboardingReceipt {
    guard ["codex", "claude-code"].contains(defaultAdapter) else {
      throw VerificationRunnerError.invalidReceipt("Unsupported onboarding adapter.")
    }
    return try await runOnboarding(
      arguments: [
        "onboarding", "--complete", "--default-adapter", defaultAdapter, "--json",
      ],
      expected: .complete
    )
  }

  private func runOnboarding(arguments: [String], expected: OnboardingOperation) async throws
    -> OnboardingReceipt
  {
    let executable = try resolveExecutable()
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(OnboardingReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.onboarding/v1",
        receipt.operation == expected,
        ["codex", "claude-code"].contains(receipt.defaultAdapter),
        receipt.tools.count <= 8,
        receipt.tools.allSatisfy({ $0.authentication == "not_inspected" })
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The onboarding receipt expanded authority or changed schema.")
      }
      if expected == .complete, !receipt.completed {
        throw VerificationRunnerError.invalidReceipt(
          "The onboarding completion receipt did not confirm persistence.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func saveNativeSetting(key: String, value: String) async throws
    -> NativeSettingsReceipt
  {
    try await runNativeSettings(arguments: ["settings", "--set", "\(key)=\(value)", "--json"])
  }

  public func loadHistoryRoots() async throws -> HistoryRootsReceipt {
    try await runHistoryRoots(arguments: ["history-roots", "--json"], expected: .read)
  }

  public func addHistoryRoot(path: String) async throws -> HistoryRootsReceipt {
    try await runHistoryRoots(
      arguments: ["history-roots", "--add", path, "--json"], expected: .add)
  }

  public func removeHistoryRoot(path: String) async throws -> HistoryRootsReceipt {
    try await runHistoryRoots(
      arguments: ["history-roots", "--remove", path, "--json"], expected: .remove)
  }

  private func runHistoryRoots(arguments: [String], expected: HistoryRootsOperation) async throws
    -> HistoryRootsReceipt
  {
    let executable = try resolveExecutable()
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(HistoryRootsReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.history-roots/v1",
        receipt.operation == expected,
        receipt.roots.count <= 16,
        Set(receipt.roots.map(\.path)).count == receipt.roots.count,
        receipt.roots.allSatisfy({ $0.path.hasPrefix("/") })
      else {
        throw VerificationRunnerError.invalidReceipt(
          "The history-roots receipt expanded its schema or path boundary.")
      }
      if expected != .read, receipt.changedRoot == nil {
        throw VerificationRunnerError.invalidReceipt(
          "The history-roots mutation did not confirm its changed path.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  private func runNativeSettings(arguments: [String]) async throws -> NativeSettingsReceipt {
    let executable = try resolveExecutable()
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(NativeSettingsReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.native-settings/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported native settings schema \(receipt.schemaVersion).")
      }
      let keys = receipt.settings.map(\.key)
      guard Set(keys).count == keys.count else {
        throw VerificationRunnerError.invalidReceipt(
          "Native settings contain duplicate preference identities.")
      }
      let sections = Set(NativeSettingsSection.allCases.map(\.rawValue))
      guard receipt.settings.allSatisfy({ sections.contains($0.section) }) else {
        throw VerificationRunnerError.invalidReceipt(
          "Native settings contain an unknown section.")
      }
      let agentIslandKeys: Set<String> = [
        "native_agent_island_enabled",
        "native_agent_island_speech_muted",
        "native_agent_island_speak_completion",
        "native_agent_island_speak_attention",
        "native_agent_island_speak_failure",
        "native_agent_island_speech_volume",
        "native_agent_island_speech_rate",
        "native_agent_island_speech_cooldown",
        "native_agent_island_quiet_start",
        "native_agent_island_quiet_end",
        "native_agent_island_codex_voice",
        "native_agent_island_claude_voice",
      ]
      let projectedIslandKeys = Set(
        receipt.settings.filter { $0.section == NativeSettingsSection.agentIsland.rawValue }
          .map(\.key)
      )
      guard projectedIslandKeys == agentIslandKeys else {
        throw VerificationRunnerError.invalidReceipt(
          "Native settings do not contain the complete Agent Island preference contract.")
      }
      guard receipt.settings.allSatisfy({ $0.key != "github_token" }) else {
        throw VerificationRunnerError.invalidReceipt(
          "Native settings projected a credential-bearing preference.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runSessionRetention(
    operation: SessionRetentionOperation,
    maxAgeDays: Int? = nil,
    maxArchiveMiB: Int? = nil,
    planID: String? = nil,
    vacuum: Bool = false
  ) async throws -> SessionRetentionReceipt {
    let executable = try resolveExecutable()
    var arguments = ["retention"]
    switch operation {
    case .plan:
      if let maxAgeDays { arguments += ["--max-age-days", String(maxAgeDays)] }
      if let maxArchiveMiB { arguments += ["--max-archive-mib", String(maxArchiveMiB)] }
    case .apply:
      guard let planID, !planID.isEmpty else {
        throw VerificationRunnerError.invalidReceipt("A reviewed retention plan is required.")
      }
      arguments += ["--apply", planID]
    case .checkpoint:
      arguments.append("--checkpoint")
      if vacuum { arguments.append("--vacuum") }
    }
    arguments.append("--json")
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(SessionRetentionReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.session-retention/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported session retention schema \(receipt.schemaVersion).")
      }
      guard receipt.operation == operation else {
        throw VerificationRunnerError.invalidReceipt(
          "Retention operation \(receipt.operation.rawValue) conflicts with the requested \(operation.rawValue)."
        )
      }
      if operation == .plan, receipt.plan == nil {
        throw VerificationRunnerError.invalidReceipt("Retention preview has no canonical plan.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runRubricSettings(
    operation: RubricSettingsOperation = .read,
    packID: String? = nil,
    pack: RubricPackInput? = nil
  ) async throws -> RubricSettingsReceipt {
    let executable = try resolveExecutable()
    var arguments = ["rubrics"]
    switch operation {
    case .read:
      break
    case .select:
      guard let packID, !packID.isEmpty else {
        throw VerificationRunnerError.invalidReceipt("A rubric pack id is required.")
      }
      arguments += ["--select", packID]
    case .upsert:
      guard let pack else {
        throw VerificationRunnerError.invalidReceipt("A complete custom rubric pack is required.")
      }
      arguments += ["--id", pack.id, "--name", pack.name, "--focus", pack.focus]
      for check in pack.checks { arguments += ["--check", check] }
    }
    arguments.append("--json")
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(RubricSettingsReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.rubric-settings/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported rubric settings schema \(receipt.schemaVersion).")
      }
      guard receipt.operation == operation else {
        throw VerificationRunnerError.invalidReceipt(
          "Rubric operation \(receipt.operation.rawValue) conflicts with the requested \(operation.rawValue)."
        )
      }
      if operation != .read, receipt.savedPackID == nil {
        throw VerificationRunnerError.invalidReceipt("Rubric mutation has no saved pack identity.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runMemories(
    operation: MemoryReceiptOperation = .list,
    sourceID: String? = nil
  ) async throws -> MemoryReceipt {
    let executable = try resolveExecutable()
    var arguments = ["memories"]
    switch operation {
    case .list:
      guard sourceID == nil else {
        throw VerificationRunnerError.invalidReceipt("Memory list cannot select a source.")
      }
    case .read, .diff:
      guard let sourceID, !sourceID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw VerificationRunnerError.invalidReceipt("A bounded memory source id is required.")
      }
      arguments += ["--source", sourceID]
      if operation == .diff { arguments.append("--diff") }
    }
    arguments.append("--json")
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(MemoryReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.memories/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported memories schema \(receipt.schemaVersion).")
      }
      guard receipt.operation == operation else {
        throw VerificationRunnerError.invalidReceipt(
          "Memory operation \(receipt.operation.rawValue) conflicts with the requested \(operation.rawValue)."
        )
      }
      guard receipt.sources.count <= receipt.limits.maxSources,
        receipt.sourcesTotal >= receipt.sources.count,
        receipt.candidateLocationsChecked >= receipt.sourcesTotal,
        Set(receipt.sources.map(\.id)).count == receipt.sources.count,
        receipt.sources.allSatisfy({ !$0.displayPath.hasPrefix("/") })
      else {
        throw VerificationRunnerError.invalidReceipt(
          "Memory source catalog violates its declared bound or path boundary.")
      }
      if operation == .list {
        guard receipt.selectedSourceID == nil, receipt.document == nil, receipt.diff == nil else {
          throw VerificationRunnerError.invalidReceipt("Memory list unexpectedly contains content.")
        }
      } else {
        guard receipt.selectedSourceID == sourceID,
          receipt.sources.contains(where: { $0.id == sourceID && $0.readable })
        else {
          throw VerificationRunnerError.invalidReceipt(
            "Memory receipt does not bind the selected readable source.")
        }
      }
      if operation == .read {
        guard receipt.document?.sourceID == sourceID, receipt.diff == nil else {
          throw VerificationRunnerError.invalidReceipt(
            "Memory read is missing its selected document boundary.")
        }
      }
      if operation == .diff {
        guard receipt.diff?.sourceID == sourceID, receipt.document == nil else {
          throw VerificationRunnerError.invalidReceipt(
            "Memory diff is missing its selected diff boundary.")
        }
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runXray(
    _ request: XrayRequest,
    format: XrayFormat = .html,
    destination: URL? = nil
  ) async throws -> XrayRunResult {
    let executable = try resolveExecutable()
    var arguments = ["xray", "--review-id", request.reviewID]
    if let source = request.publicSource?.trimmingCharacters(in: .whitespacesAndNewlines),
      !source.isEmpty
    {
      arguments += ["--public-source", source]
    }
    if request.publicSourceConfirmed { arguments.append("--confirm-public") }
    for findingID in request.approvedExcerptFindingIDs.sorted() {
      arguments += ["--approve-excerpt", findingID]
    }
    if let corpusState = request.corpusState, !corpusState.isEmpty {
      arguments += ["--corpus-state", corpusState]
    }
    arguments += ["--format", format.rawValue]
    if let destination { arguments += ["--save", destination.path(percentEncoded: false)] }
    arguments.append("--json")

    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let result = try JSONDecoder().decode(XrayBuildResult.self, from: Data(output.utf8))
      let expectedStatus: Int32 = result.eligible ? 0 : 2
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "X-Ray eligibility conflicts with process status \(execution.status).")
      }
      guard result.payload.value(at: "schema_version")?.numberValue == 1,
        !result.xrayID.isEmpty
      else {
        throw VerificationRunnerError.invalidReceipt("Unsupported or unidentified X-Ray payload.")
      }
      if destination != nil, !result.eligible {
        throw VerificationRunnerError.invalidReceipt(
          "An ineligible X-Ray cannot be saved as a public artifact.")
      }
      return XrayRunResult(result: result, rawJSON: output, processStatus: execution.status)
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func buildFixPacket(runID: String, findingIDs: [String]) async throws
    -> AgentFixPacketReceipt
  {
    let executable = try resolveExecutable()
    var arguments = ["fix-packet", "--run-id", runID]
    for findingID in findingIDs.sorted() {
      arguments += ["--finding", findingID]
    }
    arguments.append("--json")
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(AgentFixPacketReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.agent-fix-packet/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported agent fix-packet schema \(receipt.schemaVersion).")
      }
      guard receipt.runID == runID else {
        throw VerificationRunnerError.invalidReceipt(
          "The agent fix packet does not match the selected verification run.")
      }
      let requested = Set(findingIDs)
      let returned = Set(receipt.findings.map(\.id))
      guard requested.isEmpty || requested == returned else {
        throw VerificationRunnerError.invalidReceipt(
          "The agent fix packet does not match the selected finding set.")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func executeFixAttempt(
    runID: String,
    findingIDs: [String],
    agent: String,
    timeoutMS: UInt64 = 30_000
  ) async throws -> FixAttemptReceipt {
    var arguments = [
      "fix", "--operation", "execute", "--run-id", runID, "--agent", agent,
      "--confirm-run", "--timeout-ms", String(timeoutMS),
    ]
    for findingID in findingIDs.sorted() {
      arguments += ["--finding", findingID]
    }
    arguments.append("--json")
    let receipt = try await runFixCommand(arguments)
    guard receipt.operation == "execute", receipt.sourceRunID == runID else {
      throw VerificationRunnerError.invalidReceipt(
        "The isolated fix receipt does not match the selected verification run.")
    }
    guard Set(receipt.recheck.findings.map(\.findingID)) == Set(findingIDs) else {
      throw VerificationRunnerError.invalidReceipt(
        "The isolated fix receipt does not match the selected finding set.")
    }
    return receipt
  }

  public func inspectFixAttempt(attemptID: String) async throws -> FixAttemptReceipt {
    let receipt = try await runFixCommand([
      "fix", "--operation", "inspect", "--attempt-id", attemptID, "--json",
    ])
    guard receipt.attemptID == attemptID else {
      throw VerificationRunnerError.invalidReceipt(
        "The inspected fix receipt does not match the requested attempt.")
    }
    return receipt
  }

  public func discardFixAttempt(attemptID: String) async throws -> FixAttemptReceipt {
    let receipt = try await runFixCommand([
      "fix", "--operation", "discard", "--attempt-id", attemptID, "--confirm-discard",
      "--json",
    ])
    guard receipt.attemptID == attemptID, receipt.operation == "discard",
      receipt.state == "discarded", !receipt.worktree.retained
    else {
      throw VerificationRunnerError.invalidReceipt(
        "The discarded fix receipt does not prove worktree removal.")
    }
    return receipt
  }

  private func runFixCommand(_ arguments: [String]) async throws -> FixAttemptReceipt {
    let executable = try resolveExecutable()
    let execution = try await runTrackedProcess(executable: executable, arguments: arguments)
    let output = execution.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines)
    let errors = execution.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty else {
      throw VerificationRunnerError.emptyReceipt(errors)
    }
    do {
      let receipt = try JSONDecoder().decode(FixAttemptReceipt.self, from: Data(output.utf8))
      guard receipt.schemaVersion == "codevetter.fix-attempt/v1",
        !receipt.attemptID.isEmpty, !receipt.worktree.path.isEmpty
      else {
        throw VerificationRunnerError.invalidReceipt("Unsupported or incomplete fix receipt.")
      }
      let expectedStatus: Int32 =
        switch receipt.state {
        case "verified_fixed", "discarded": 0
        case "reproduced", "failed": 1
        default: 2
        }
      guard execution.status == expectedStatus else {
        throw VerificationRunnerError.invalidReceipt(
          "Fix state \(receipt.state) conflicts with process status \(execution.status).")
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func runMcpSettings(repositoryPath: String, operation: McpSettingsOperation = .read)
    async throws -> McpSettingsReceipt
  {
    let executable = try resolveExecutable()
    var arguments = ["mcp", "--repo", repositoryPath]
    if let flag = operation.cliFlag { arguments.append(flag) }
    arguments.append("--json")
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    do {
      let receipt = try JSONDecoder().decode(McpSettingsReceipt.self, from: output)
      guard receipt.schemaVersion == "codevetter.mcp-settings/v1" else {
        throw VerificationRunnerError.invalidReceipt(
          "Unsupported MCP settings schema \(receipt.schemaVersion).")
      }
      guard receipt.operation == operation else {
        throw VerificationRunnerError.invalidReceipt(
          "MCP operation \(receipt.operation.rawValue) conflicts with the requested \(operation.rawValue)."
        )
      }
      return receipt
    } catch let error as VerificationRunnerError {
      throw error
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
  }

  public func listRuns(repositoryPath: String? = nil, limit: Int = 50) async throws
    -> [StoredVerificationRun]
  {
    let executable = try resolveExecutable()
    var arguments = ["runs", "--json", "--limit", String(min(max(limit, 1), 100))]
    if let repositoryPath, !repositoryPath.isEmpty {
      arguments += ["--repo", repositoryPath]
    }
    let output = try await runReadOnly(executable: executable, arguments: arguments)
    return try Self.decodeRunHistory(output)
  }

  static func decodeRunHistory(_ output: Data) throws -> [StoredVerificationRun] {
    let object: Any
    do {
      object = try JSONSerialization.jsonObject(with: output)
    } catch {
      throw VerificationRunnerError.invalidReceipt(error.localizedDescription)
    }
    guard let root = object as? [String: Any],
      root["schema_version"] as? String == "codevetter.run-history/v1",
      let rows = root["runs"] as? [[String: Any]]
    else {
      throw VerificationRunnerError.invalidReceipt(
        "Run history is not a codevetter.run-history/v1 receipt.")
    }
    return try rows.map { row in
      let metadataData = try JSONSerialization.data(
        withJSONObject: row,
        options: [.sortedKeys]
      )
      let metadata = try JSONDecoder().decode(RunHistoryRecordMetadata.self, from: metadataData)
      guard let receiptObject = row["receipt"] else {
        throw VerificationRunnerError.invalidReceipt("Run \(metadata.id) has no canonical receipt.")
      }
      let receiptData = try JSONSerialization.data(
        withJSONObject: receiptObject,
        options: [.prettyPrinted, .sortedKeys]
      )
      return StoredVerificationRun(
        metadata: metadata,
        receiptData: receiptData,
        rawJSON: String(decoding: receiptData, as: UTF8.self)
      )
    }
  }

  @discardableResult
  public func cancel(requestID: String? = nil) -> Bool {
    lock.lock()
    let matches = requestID == nil || requestID == activeRequestID
    let active = matches ? process : nil
    if active != nil {
      cancellationRequested = true
    }
    lock.unlock()
    active?.terminate()
    repositoryQueryWorkerLock.lock()
    let queryWorker = repositoryQueryWorker
    repositoryQueryWorkerLock.unlock()
    queryWorker?.cancelAll()
    return active != nil || queryWorker != nil
  }

  private func resolveExecutable() throws -> URL {
    if let executableOverride {
      guard FileManager.default.isExecutableFile(atPath: executableOverride.path) else {
        throw VerificationRunnerError.executableUnavailable([executableOverride.path])
      }
      return executableOverride
    }
    let environment = ProcessInfo.processInfo.environment["CODEVETTER_CLI_PATH"]
    let bundled = Bundle.main.url(forAuxiliaryExecutable: "codevetter").flatMap { candidate in
      isDistinctBundledCLI(candidate, mainExecutable: Bundle.main.executableURL)
        ? candidate.path : nil
    }
    let cwd = FileManager.default.currentDirectoryPath
    var candidates = [
      environment,
      bundled,
      "/opt/homebrew/bin/codevetter",
      "/usr/local/bin/codevetter",
      "\(cwd)/apps/desktop/src-tauri/target/debug/codevetter",
      "\(cwd)/apps/desktop/src-tauri/target/release/codevetter",
    ].compactMap { $0 }
    #if DEBUG
      let sourceRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
      candidates.append(
        sourceRoot.appending(path: "apps/desktop/src-tauri/target/debug/codevetter").path)
    #endif
    if let path = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
      return URL(fileURLWithPath: path)
    }
    throw VerificationRunnerError.executableUnavailable(candidates)
  }

  private func runReadOnly(executable: URL, arguments: [String]) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      let process = Process()
      let stdout = LockedPipeCapture()
      let stderr = LockedPipeCapture()
      let stdoutPipe = Pipe()
      let stderrPipe = Pipe()
      stdoutPipe.fileHandleForReading.readabilityHandler = { stdout.consume(from: $0) }
      stderrPipe.fileHandleForReading.readabilityHandler = { stderr.consume(from: $0) }
      process.executableURL = executable
      process.arguments = arguments
      process.standardOutput = stdoutPipe
      process.standardError = stderrPipe
      process.terminationHandler = { completed in
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil
        let output = stdout.finish(from: stdoutPipe.fileHandleForReading)
        let errors = stderr.finish(from: stderrPipe.fileHandleForReading)
        guard completed.terminationStatus == 0 else {
          continuation.resume(
            throwing: VerificationRunnerError.launchFailed(
              String(decoding: errors, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)))
          return
        }
        continuation.resume(returning: output)
      }
      do {
        try process.run()
      } catch {
        continuation.resume(
          throwing: VerificationRunnerError.launchFailed(error.localizedDescription))
      }
    }
  }

  private func runTrackedProcess(
    executable: URL,
    arguments: [String],
    requestID: String? = nil,
    onStderrLine: (@Sendable (String) -> Void)? = nil
  ) async throws -> TrackedProcessOutput {
    let stdout = LockedPipeCapture()
    let stderr = LockedPipeCapture()
    let stdoutPipe = Pipe()
    let stderrPipe = Pipe()
    stdoutPipe.fileHandleForReading.readabilityHandler = { stdout.consume(from: $0) }
    stderrPipe.fileHandleForReading.readabilityHandler = { handle in
      stderr.consume(from: handle, onLine: onStderrLine)
    }

    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    process.standardOutput = stdoutPipe
    process.standardError = stderrPipe

    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        process.terminationHandler = { [weak self] completed in
          stdoutPipe.fileHandleForReading.readabilityHandler = nil
          stderrPipe.fileHandleForReading.readabilityHandler = nil
          let output = stdout.finish(from: stdoutPipe.fileHandleForReading)
          let errors = stderr.finish(
            from: stderrPipe.fileHandleForReading,
            onLine: onStderrLine
          )
          let wasCancelled = self?.clear(completed) ?? false
          if wasCancelled {
            continuation.resume(throwing: CancellationError())
          } else {
            continuation.resume(
              returning: TrackedProcessOutput(
                stdout: output,
                stderr: errors,
                status: completed.terminationStatus
              ))
          }
        }
        do {
          set(process, requestID: requestID)
          if Task.isCancelled {
            _ = clear(process)
            continuation.resume(throwing: CancellationError())
            return
          }
          try process.run()
        } catch {
          _ = clear(process)
          continuation.resume(
            throwing: VerificationRunnerError.launchFailed(error.localizedDescription)
          )
        }
      }
    } onCancel: {
      self.cancel()
    }
  }

  private func set(_ process: Process, requestID: String?) {
    lock.lock()
    self.process = process
    activeRequestID = requestID
    cancellationRequested = false
    lock.unlock()
  }

  @discardableResult
  private func clear(_ process: Process) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if self.process === process {
      self.process = nil
      activeRequestID = nil
      let wasCancelled = cancellationRequested
      cancellationRequested = false
      return wasCancelled
    }
    return false
  }
}

private struct TrackedProcessOutput: Sendable {
  let stdout: Data
  let stderr: Data
  let status: Int32

  var stdoutString: String { String(data: stdout, encoding: .utf8) ?? "" }
  var stderrString: String { String(data: stderr, encoding: .utf8) ?? "" }
}

func isDistinctBundledCLI(_ candidate: URL, mainExecutable: URL?) -> Bool {
  guard candidate.lastPathComponent == "codevetter" else { return false }
  return candidate.resolvingSymlinksInPath() != mainExecutable?.resolvingSymlinksInPath()
}

private func decodeProgress(
  _ line: String,
  requestID: String,
  onProgress: @escaping @Sendable (VerificationProgress) -> Void
) {
  guard let progress = try? JSONDecoder().decode(VerificationProgress.self, from: Data(line.utf8)),
    progress.schemaVersion == "codevetter.progress/v2",
    progress.requestID == requestID
  else { return }
  onProgress(progress)
}

private final class LockedPipeCapture: @unchecked Sendable {
  private let lock = NSLock()
  private var data = Data()
  private var pending = Data()
  private var finished = false

  func consume(
    from handle: FileHandle,
    onLine: (@Sendable (String) -> Void)? = nil
  ) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    append(handle.availableData, onLine: onLine)
  }

  func finish(
    from handle: FileHandle,
    onLine: (@Sendable (String) -> Void)? = nil
  ) -> Data {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return data }
    append(handle.readDataToEndOfFile(), onLine: onLine)
    if let onLine, !pending.isEmpty,
      let line = String(data: pending, encoding: .utf8)
    {
      onLine(line)
    }
    pending.removeAll()
    finished = true
    return data
  }

  private func append(_ chunk: Data, onLine: (@Sendable (String) -> Void)?) {
    guard !chunk.isEmpty else { return }
    data.append(chunk)
    guard let onLine else { return }
    pending.append(chunk)
    while let newline = pending.firstIndex(of: 0x0A) {
      let line = pending[..<newline]
      if let text = String(data: line, encoding: .utf8), !text.isEmpty {
        onLine(text)
      }
      pending.removeSubrange(...newline)
    }
  }
}
