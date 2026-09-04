import Foundation
import Observation

private struct UsageProjectionCacheKey: Hashable {
  let agents: String
  let window: String
  let scale: String
}

public enum WorkbenchSection: String, CaseIterable, Hashable, Identifiable, Sendable {
  case usage = "Usage"
  case repository = "Repo Unpack"
  case review = "Review"
  case testing = "Testing"
  case performance = "Performance"
  case runs = "Runs"
  case settings = "Settings"

  public var id: String { rawValue }

  public var systemImage: String {
    switch self {
    case .usage: "chart.bar.xaxis"
    case .repository: "shippingbox"
    case .review: "checkmark.shield"
    case .testing: "testtube.2"
    case .performance: "gauge.with.dots.needle.67percent"
    case .runs: "clock.arrow.circlepath"
    case .settings: "gearshape"
    }
  }
}

public enum VerificationState: String, Sendable {
  case ready = "Ready"
  case planning = "Planning"
  case planned = "Plan ready"
  case running = "Running"
  case completed = "Completed"
  case limited = "Completed with limits"
  case failed = "Needs attention"
  case cancelled = "Cancelled"
}

public enum RunLedgerScope: String, Sendable {
  case all
  case currentRepository
}

@MainActor
@Observable
public final class WorkbenchModel {
  public var section: WorkbenchSection = .review
  public var commandPalettePresented = false
  public var selectedCapabilityID = "verification.local_check"
  public var repositoryPath = ""
  public var change = "main...HEAD"
  public var task = ""
  public var reviewAgent = "claude"
  public var choosingRepository = false
  public var choosingSpecs = false
  public var specPaths: [String] = []
  public var selectedRequirementIDs: Set<String> = []
  public var specIssue: String?
  public var verificationState: VerificationState = .ready
  public var statusMessage = "Select a repository and describe the intended behavior."
  public var preflightReceipt: VerificationReceipt?
  public var preflightReceiptJSON = ""
  public var receipt: VerificationReceipt?
  public var receiptJSON = ""
  public var xrayPublicSource = ""
  public var xrayPublicConfirmed = false
  public var xrayFormat: XrayFormat = .html
  public var xrayApprovedExcerptFindingIDs: Set<String> = []
  public var xrayResult: XrayBuildResult?
  public var xrayLoading = false
  public var xrayIssue: String?
  public var xraySavedPath: String?
  public var fixPacketSelectedFindingIDs: Set<String> = []
  public var fixPacketReceipt: AgentFixPacketReceipt?
  public var fixPacketLoading = false
  public var fixPacketIssue: String?
  public var fixAttemptAgent = "codex"
  public var fixAttemptConfirmed = false
  public var fixAttemptDiscardConfirmed = false
  public var fixAttemptReceipt: FixAttemptReceipt?
  public var fixAttemptLoading = false
  public var fixAttemptIssue: String?
  public var testingChangeKind: TrexChangeKind = .range
  public var testingChange = "main...HEAD"
  public var testingPreviewURL = ""
  public var testingTargetRoute = ""
  public var testingTargetGoal = ""
  public var testingQaWorkflowName = ""
  public var testingConfirmed = false
  public var testingState: VerificationState = .ready
  public var testingStatusMessage =
    "Select an exact change and the deployed preview that should represent it."
  public var testingReceipt: TrexPreviewReceipt?
  public var testingReceiptJSON = ""
  public var testingScopeKind: EvidenceScopeKind = .change
  public var testingScopeValue = "main...HEAD"
  public var testingScopePlan: EvidenceScopePlan?
  public var testingScopeLoading = false
  public var testingScopeIssue: String?
  public var selectedTestingScopeCandidateID: String?
  public var showingQaWorkspace = false
  public var qaWorkspaceReceipt: QaWorkspaceReceipt?
  public var qaWorkspaceLoading = false
  public var qaWorkspaceIssue: String?
  public var qaSelectedWorkflowID: String?
  public var qaSelectedTargetID: String?
  public var qaWorkflowDraft = QaWorkflowDraft(
    id: "", name: "", baseURL: "", loopID: "generic-page-smoke",
    runnerType: "playwright_builtin", goal: "Verify the selected user journey",
    repoSpecPath: "", repoTraceMode: "retain-on-failure", targetRoute: "/",
    allowRemoteTarget: false
  )
  public var qaTargetName = ""
  public var qaTargetRoute = "/"
  public var qaTargetGoal = "Verify the selected user journey"
  public var showingWarmVerifier = false
  public var warmDetailedCapture = false
  public var warmHealth: WarmDaemonHealth?
  public var warmReceipt: WarmVerificationRunReceipt?
  public var warmReceiptJSON = ""
  public var warmState: VerificationState = .ready
  public var warmStatusMessage =
    "Inspect the repository-owned daemon, then verify only the current changed scope."
  public var warmIssue: String?
  public var showingDifferentialVerifier = false
  public var differentialReference = "main"
  public var differentialCandidateKind: DifferentialCandidateKind = .worktree
  public var differentialCandidateRevision = ""
  public var differentialPrepared: DifferentialPreparedReceipt?
  public var differentialReceipt: StoredDifferentialRun?
  public var differentialReceiptJSON = ""
  public var differentialState: VerificationState = .ready
  public var differentialStatusMessage =
    "Prepare an exact reference/candidate pair before executing comparison."
  public var differentialIssue: String?
  public var showingScenarioCompiler = false
  public var scenarioSpecPath = ""
  public var scenarioSpecSection = ""
  public var scenarioModel = "qwen2.5-coder:7b"
  public var scenarioRoutes = ""
  public var scenarioIncludeRequestPolicy = true
  public var scenarioCandidates: [ScenarioCandidate] = []
  public var selectedScenarioCandidateID: String?
  public var selectedScenarioDestinations: Set<String> = []
  public var scenarioReplacementApproved = false
  public var scenarioState: VerificationState = .ready
  public var scenarioStatusMessage =
    "Inspect existing candidates or generate one from a repository specification."
  public var scenarioIssue: String?
  public var showingTrexWatcher = false
  public var trexWatchers: [TrexWatcher] = []
  public var trexWatcherRuns: [TrexWatcherRun] = []
  public var trexWatcherIntervalSeconds = 300
  public var trexWatcherBaseBranch = ""
  public var trexWatcherSessionConfirmed = false
  public var trexWatcherState: VerificationState = .ready
  public var trexWatcherStatusMessage =
    "Load the saved watcher configuration. Polling always requires consent for this app session."
  public var trexWatcherIssue: String?
  public var trexWatcherReceiptJSON = ""
  public var performanceAdapter: PerformanceAdapter = .vitest
  public var performanceTarget = ""
  public var performanceName = ""
  public var performanceSamples = 3
  public var performanceWarmups = 1
  public var performanceTimeoutMS = 30_000
  public var performanceBaselineRepositoryPath = ""
  public var performanceRecordedRunID = ""
  public var choosingPerformanceBaseline = false
  public var performanceState: VerificationState = .ready
  public var performanceStatusMessage =
    "Choose one exact repository-owned workload. Planning never executes project code."
  public var performancePlanReceipt: PerformanceRunReceipt?
  public var performancePlanReceiptJSON = ""
  public var performanceResultReceipt: PerformanceRunReceipt?
  public var performanceResultReceiptJSON = ""
  public var performanceScopeKind: EvidenceScopeKind = .flow
  public var performanceScopeValue = ""
  public var performanceDiscoveryPlan: EvidenceScopePlan?
  public var performanceScopeLoading = false
  public var performanceScopeIssue: String?
  var performancePlanScopeFingerprint: String?
  public var usageReport: LocalUsageReport? {
    didSet {
      usageProjectionCache.removeAll(keepingCapacity: true)
      usageProjectionReferenceDate = Date()
    }
  }
  public var usageReportJSON = ""
  public var providerQuotaReceipt: ProviderQuotaReceipt?
  public var providerQuotaLoading = false
  public var providerQuotaIssue: String?
  public var usageScale: UsageScale = .day
  public var usageWindow: UsageWindow = .thirtyDays
  public var usageSelectedAgents: Set<String> = []
  public var usageTimezone = TimeZone.current.identifier
  public var usageLoading = false
  public var usageIssue: String?
  public private(set) var usageShowingSavedSnapshot = false
  public private(set) var providerQuotaShowingSavedSnapshot = false
  public var unpackSnapshots: [UnpackSnapshotSummary] = []
  public var selectedUnpackSnapshotID: String?
  public var unpackSnapshot: UnpackSnapshotRecord?
  public var unpackInventory: UnpackInventory?
  public var unpackReport: UnpackReport?
  public var unpackComparison: UnpackSnapshotComparison?
  public var repositoryQueryDomain: RepositoryQueryDomain = .graph
  public var repositoryQueryText = ""
  public var repositoryQueryReceipt: RepositoryQueryReceipt?
  public var repositoryQueryDetailReceipt: RepositoryQueryReceipt?
  public var repositoryQueryLoading = false
  public var repositoryQueryDetailLoading = false
  public var repositoryQueryIssue: String?
  public var repositoryQueryDetailIssue: String?
  public var repositoryGraphPathOrigin: RepositoryGraphQueryNode?
  public var repositoryImpactDirection: RepositoryGraphDirection = .incoming
  public var repositoryImpactDepth = 3
  public var unpackLoading = false
  public var unpackStatusMessage =
    "Choose a repository to create a deterministic Rust-owned snapshot, or inspect retained history."
  public var unpackIssue: String?
  public var onboardingReceipt: OnboardingReceipt?
  public var onboardingPresented = false
  public var onboardingStep = 0
  public var onboardingDefaultAdapter = "claude-code"
  public var onboardingLoading = false
  public var onboardingIssue: String?
  public var settingsReceipt: NativeSettingsReceipt?
  public var settingsSection: NativeSettingsSection = .general
  public var settingsLoading = false
  public var settingsSavingKeys: Set<String> = []
  public var settingsIssue: String?
  public var opsReceipt: OpsStatusReceipt?
  public var opsWindowDays = 30
  public var opsLoading = false
  public var opsIssue: String?
  public var historyRootsReceipt: HistoryRootsReceipt?
  public var historyRootsLoading = false
  public var historyRootsIssue: String?
  public var choosingHistoryRoot = false
  public var mcpSettingsReceipt: McpSettingsReceipt?
  public var mcpLoading = false
  public var mcpIssue: String?
  public var retentionReceipt: SessionRetentionReceipt?
  public var retentionLoading = false
  public var retentionIssue: String?
  public var rubricReceipt: RubricSettingsReceipt?
  public var rubricLoading = false
  public var rubricIssue: String?
  public var memoryReceipt: MemoryReceipt?
  public var memoryDocument: MemoryDocumentReceipt?
  public var memoryDiff: MemoryDiffReceipt?
  public var selectedMemorySourceID: String?
  public var memoryLoading = false
  public var memoryIssue: String?
  public var runs: [StoredVerificationRun] = []
  public var selectedRunID: String?
  public var runLedgerScope: RunLedgerScope = .all
  public var runsLoading = false
  public var runsIssue: String?
  public let registry: CapabilityRegistry
  public let registryIssue: String?

  private let runner: CodeVetterProcessRunner
  private let repositoryAccessStore: RepositoryAccessStore?
  private let usageSnapshotStore: UsageSnapshotStore
  private var runTask: Task<Void, Never>?
  private var activeReviewRequestID: String?
  private var reviewPlanFingerprint: String?
  private var xrayPreviewFingerprint: String?
  private var xrayTask: Task<Void, Never>?
  private var fixPacketTask: Task<Void, Never>?
  private var fixAttemptTask: Task<Void, Never>?
  private var testingTask: Task<Void, Never>?
  private var qaWorkspaceTask: Task<Void, Never>?
  private var warmTask: Task<Void, Never>?
  private var differentialTask: Task<Void, Never>?
  private var scenarioTask: Task<Void, Never>?
  private var trexWatcherTask: Task<Void, Never>?
  private var trexWatcherScheduleTask: Task<Void, Never>?
  private var differentialPreparedFingerprint: String?
  private var differentialRunID: String?
  private var performanceTask: Task<Void, Never>?
  private var testingScopeTask: Task<Void, Never>?
  private var performanceScopeTask: Task<Void, Never>?
  private var usageTask: Task<Void, Never>?
  private var providerQuotaTask: Task<Void, Never>?
  private var usageSnapshotRestoreTask: Task<RestoredUsageSnapshots, Never>?
  private var usageSnapshotsRestored = false
  private var usageLastLoadedAt: Date?
  private var providerQuotaLastLoadedAt: Date?
  @ObservationIgnored private var usageProjectionCache:
    [UsageProjectionCacheKey: UsageViewProjection] = [:]
  @ObservationIgnored private var usageProjectionReferenceDate = Date()
  private var unpackTask: Task<Void, Never>?
  private var repositoryQueryWarmTask: Task<Void, Never>?
  private var repositoryQueryTask: Task<Void, Never>?
  private var repositoryQueryDetailTask: Task<Void, Never>?
  private var onboardingTask: Task<Void, Never>?
  private var settingsTask: Task<Void, Never>?
  private var opsTask: Task<Void, Never>?
  private var historyRootsTask: Task<Void, Never>?
  private var mcpTask: Task<Void, Never>?
  private var retentionTask: Task<Void, Never>?
  private var rubricTask: Task<Void, Never>?
  private var memoryTask: Task<Void, Never>?
  private var runsTask: Task<Void, Never>?

  public init(
    runner: CodeVetterProcessRunner = CodeVetterProcessRunner(),
    repositoryAccessStore: RepositoryAccessStore? = nil,
    usageSnapshotStore: UsageSnapshotStore = UsageSnapshotStore()
  ) {
    self.runner = runner
    self.repositoryAccessStore = repositoryAccessStore
    self.usageSnapshotStore = usageSnapshotStore
    do {
      registry = try CapabilityRegistry.bundled()
      registryIssue = nil
    } catch {
      registry = CapabilityRegistry(
        schemaVersion: "unavailable",
        authority: "codevetter-rust-core",
        capabilities: []
      )
      registryIssue = error.localizedDescription
    }
    if let restoredRepository = repositoryAccessStore?.restore() {
      selectRepository(restoredRepository, persist: false)
      statusMessage = "Restored the last repository. Ready to resolve the exact change."
    }
  }

  public var selectedCapability: Capability? {
    registry.capabilities.first { $0.id == selectedCapabilityID }
  }

  public var canStart: Bool {
    !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !change.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !task.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && specIssue == nil
      && !isBusy
  }

  public var canExecuteReview: Bool {
    canStart && hasExecutableReviewPlan && reviewPlanFingerprint == reviewInputFingerprint
  }

  public var hasExecutableReviewPlan: Bool {
    preflightReceipt?.status == "ready"
  }

  public var reviewPlanIsCurrent: Bool {
    preflightReceipt != nil && reviewPlanFingerprint == reviewInputFingerprint
  }

  public var reviewInputFingerprint: String {
    ([repositoryPath, change, task, reviewAgent] + specPaths.sorted()
      + selectedRequirementIDs.sorted())
      .joined(separator: "\u{0}")
  }

  public var isBusy: Bool {
    verificationState == .planning || verificationState == .running
      || testingState == .running
      || performanceState == .planning || performanceState == .running || usageLoading
      || unpackLoading || repositoryQueryLoading || repositoryQueryDetailLoading
      || onboardingLoading || settingsLoading
      || !settingsSavingKeys.isEmpty
      || mcpLoading
      || retentionLoading || testingScopeLoading || performanceScopeLoading
      || qaWorkspaceLoading
      || rubricLoading || xrayLoading || fixPacketLoading || fixAttemptLoading
      || warmState == .running
      || differentialState == .running || differentialState == .planning
      || scenarioState == .running || trexWatcherState == .running
      || trexWatcherState == .planning
  }

  public var testingInputIssue: String? {
    if repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return "Choose the repository that owns this change."
    }
    if testingChange.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return
        testingChangeKind == .range
        ? "Enter an exact Git range." : "Enter the canonical GitHub pull request URL."
    }
    let preview = testingPreviewURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let components = URLComponents(string: preview),
      let scheme = components.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      components.host?.isEmpty == false,
      components.user == nil,
      components.password == nil
    else {
      return "Enter an HTTP(S) preview URL without embedded credentials."
    }
    let targetRoute = testingTargetRoute.trimmingCharacters(in: .whitespacesAndNewlines)
    if !targetRoute.isEmpty,
      !targetRoute.hasPrefix("/") || targetRoute.hasPrefix("//") || targetRoute.count > 240
    {
      return "The selected QA target must be a bounded browser path beginning with /."
    }
    if testingTargetGoal.count > 500 {
      return "The selected QA journey goal must be at most 500 characters."
    }
    if !testingConfirmed {
      return "Confirm that CodeVetter may contact this preview and run read-only browser journeys."
    }
    return nil
  }

  public var canStartTesting: Bool {
    testingInputIssue == nil && !isBusy
  }

  public var canRunWarmVerification: Bool {
    !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && warmState != .running && !isBusy
  }

  public var differentialInputIssue: String? {
    if repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return "Choose the repository to compare."
    }
    if differentialReference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return "Enter an exact reference revision."
    }
    let needsRevision = differentialCandidateKind == .commit || differentialCandidateKind == .range
    if needsRevision != !differentialCandidateRevision.trimmingCharacters(
      in: .whitespacesAndNewlines
    ).isEmpty {
      return needsRevision
        ? "Commit and range candidates require an exact revision."
        : "Worktree and staged candidates do not accept a revision."
    }
    return nil
  }

  public var differentialInputFingerprint: String {
    [
      repositoryPath, differentialReference, differentialCandidateKind.rawValue,
      differentialCandidateRevision,
    ].joined(separator: "\u{0}")
  }

  public var canPrepareDifferential: Bool {
    differentialInputIssue == nil && differentialState != .planning && differentialState != .running
      && !isBusy
  }

  public var canRunDifferential: Bool {
    differentialPrepared?.status == "ready"
      && differentialPreparedFingerprint == differentialInputFingerprint
      && differentialRunID != nil && differentialState != .running && !isBusy
  }

  public var selectedScenarioCandidate: ScenarioCandidate? {
    scenarioCandidates.first { $0.candidateID == selectedScenarioCandidateID }
  }

  public var scenarioInputIssue: String? {
    if repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return "Choose the repository that owns the scenarios."
    }
    let spec = scenarioSpecPath.trimmingCharacters(in: .whitespacesAndNewlines)
    let hasParentTraversal = spec.split(separator: "/", omittingEmptySubsequences: false)
      .contains("..")
    if spec.isEmpty || NSString(string: spec).isAbsolutePath || hasParentTraversal {
      return "Enter a contained repository-relative specification path."
    }
    if scenarioModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return "Choose the exact local model."
    }
    if !scenarioIncludeRequestPolicy && scenarioRouteList.isEmpty {
      return "Select at least one route or include the request policy."
    }
    return nil
  }

  public var canGenerateScenario: Bool {
    scenarioInputIssue == nil && scenarioState != .running && !isBusy
  }

  public var canAcceptScenario: Bool {
    guard let candidate = selectedScenarioCandidate else { return false }
    let selectedFiles = candidate.files.filter {
      selectedScenarioDestinations.contains($0.destination)
    }
    let replacementNeeded = selectedFiles.contains(where: \.replacesExisting)
    return candidate.status == "candidate" && candidate.validation.qualified
      && candidate.dryRun.status == "passed" && candidate.unresolvedRequirements.isEmpty
      && !selectedFiles.isEmpty && (!replacementNeeded || scenarioReplacementApproved)
      && scenarioState != .running && !isBusy
  }

  public var currentTrexWatcher: TrexWatcher? {
    guard !repositoryPath.isEmpty else { return nil }
    let expected = URL(fileURLWithPath: repositoryPath).resolvingSymlinksInPath().path
    return trexWatchers.first { $0.repoPath == expected }
  }

  public var canConfigureTrexWatcher: Bool {
    !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (60...86_400).contains(trexWatcherIntervalSeconds) && !isBusy
  }

  public var canPollTrexWatcher: Bool {
    currentTrexWatcher != nil && trexWatcherSessionConfirmed && !isBusy
  }

  public var performanceInputIssue: String? {
    if repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return "Choose the repository that owns this workload."
    }
    let target = performanceTarget.trimmingCharacters(in: .whitespacesAndNewlines)
    if target.isEmpty {
      return "Enter a contained repository-relative target."
    }
    let path = NSString(string: target)
    let components = target.split(separator: "/", omittingEmptySubsequences: false)
    if path.isAbsolutePath || target.hasPrefix("~")
      || components.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
    {
      return "The target must stay inside the repository and may not contain dot segments."
    }
    if !(2...10).contains(performanceSamples) {
      return "Samples must be between 2 and 10."
    }
    if !(0...5).contains(performanceWarmups) {
      return "Warmups must be between 0 and 5."
    }
    if !(100...120_000).contains(performanceTimeoutMS) {
      return "Timeout must be between 100 milliseconds and 120 seconds."
    }
    return nil
  }

  public var performanceScopeFingerprint: String {
    [
      repositoryPath,
      performanceAdapter.rawValue,
      performanceTarget.trimmingCharacters(in: .whitespacesAndNewlines),
      performanceName.trimmingCharacters(in: .whitespacesAndNewlines),
      String(performanceSamples),
      String(performanceWarmups),
      String(performanceTimeoutMS),
    ].joined(separator: "\u{0}")
  }

  public var canPlanPerformance: Bool {
    performanceInputIssue == nil && !isBusy
  }

  public var canDiagnosePerformance: Bool {
    canPlanPerformance && performancePlanReceipt?.admitted == true
      && performancePlanScopeFingerprint == performanceScopeFingerprint
  }

  public var performancePairedInputIssue: String? {
    guard canDiagnosePerformance else {
      return "Admit the current exact workload before paired verification."
    }
    guard performanceResultReceipt?.operation == .diagnose else {
      return "Capture a diagnosis before comparing a candidate with a baseline."
    }
    let baseline = performanceBaselineRepositoryPath.trimmingCharacters(
      in: .whitespacesAndNewlines)
    if baseline.isEmpty || !NSString(string: baseline).isAbsolutePath {
      return "Choose an absolute baseline repository."
    }
    return nil
  }

  public var canVerifyPairedPerformance: Bool {
    performancePairedInputIssue == nil && !isBusy
  }

  public var performanceInspectionInputIssue: String? {
    if repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return "Choose the repository that owns the recorded run."
    }
    let runID = performanceRecordedRunID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !runID.isEmpty, runID.count <= 80,
      runID.first?.isLetter == true || runID.first?.isNumber == true,
      runID.allSatisfy({ $0.isLowercase || $0.isNumber || $0 == "-" })
    else {
      return "Run IDs use at most 80 lowercase letters, digits, and hyphens."
    }
    return nil
  }

  public var canInspectPerformanceRun: Bool {
    performanceInspectionInputIssue == nil && !isBusy
  }

  public func selectRepository(_ url: URL, persist: Bool = true) {
    let selectedURL =
      persist ? repositoryAccessStore?.remember(url) ?? url : url
    let selectedPath = selectedURL.path(percentEncoded: false)
    repositoryPath =
      selectedPath.count > 1 && selectedPath.hasSuffix("/")
      ? String(selectedPath.dropLast()) : selectedPath
    specPaths = []
    selectedRequirementIDs = []
    specIssue = nil
    mcpSettingsReceipt = nil
    mcpIssue = nil
    clearProof()
    clearTestingProof()
    resetTrexWatcherProjection()
    clearPerformanceProof()
    clearScopeDiscovery()
    testingConfirmed = false
    testingTargetRoute = ""
    testingTargetGoal = ""
    testingQaWorkflowName = ""
    qaWorkspaceTask?.cancel()
    qaWorkspaceReceipt = nil
    qaSelectedWorkflowID = nil
    qaSelectedTargetID = nil
    qaWorkspaceIssue = nil
    statusMessage = "Ready to resolve the exact change and executable targets."
    verificationState = .ready
    testingStatusMessage = "Ready to bind this repository to an exact preview."
    testingState = .ready
    performanceStatusMessage =
      "Ready to inspect one exact workload before any project code executes."
    performanceState = .ready
  }

  public func prepareTestingFromReview(_ receipt: VerificationReceipt) {
    section = .testing
    repositoryPath = receipt.repoPath
    testingChangeKind = receipt.source.kind.lowercased().contains("pull") ? .pullRequest : .range
    testingChange = receipt.source.input
    testingScopeKind = .change
    testingScopeValue = receipt.source.input
    testingConfirmed = false
    testingTargetRoute = ""
    testingTargetGoal = ""
    testingQaWorkflowName = ""
    clearTestingProof()
    testingScopePlan = nil
    selectedTestingScopeCandidateID = nil
    testingScopeIssue = nil
    testingState = .ready
    testingStatusMessage =
      "Review handed off the exact change. Add its preview, inspect the scope, and confirm read-only browser execution."
  }

  public func selectSpecFiles(_ urls: [URL]) {
    specIssue = nil
    guard !repositoryPath.isEmpty else {
      specIssue = "Choose the repository before adding its specification files."
      return
    }
    let root = URL(fileURLWithPath: repositoryPath, isDirectory: true)
      .resolvingSymlinksInPath().standardizedFileURL
    let rootPrefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
    var next = specPaths
    for url in urls {
      let candidate = url.resolvingSymlinksInPath().standardizedFileURL
      guard candidate.path.hasPrefix(rootPrefix),
        ["md", "markdown"].contains(candidate.pathExtension.lowercased()),
        (try? candidate.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
      else {
        specIssue = "Specs must be contained Markdown files in the selected repository."
        continue
      }
      let relative = String(candidate.path.dropFirst(rootPrefix.count))
      if !next.contains(relative) { next.append(relative) }
    }
    guard next.count <= 8 else {
      specIssue = "At most eight specification files can be checked together."
      return
    }
    specPaths = next.sorted()
    selectedRequirementIDs.removeAll()
    clearProof()
    verificationState = .ready
    statusMessage = "Plan to extract explicit requirements from the selected specs."
  }

  public func removeSpec(_ path: String) {
    specPaths.removeAll { $0 == path }
    selectedRequirementIDs.removeAll()
    specIssue = nil
    clearProof()
  }

  public func toggleRequirement(_ id: String) {
    if selectedRequirementIDs.contains(id) {
      selectedRequirementIDs.remove(id)
    } else {
      selectedRequirementIDs.insert(id)
    }
    verificationState = .ready
    statusMessage = "Requirement selection changed. Plan again before executing proof."
  }

  public func plan() {
    start(preflight: true)
  }

  public func execute() {
    start(preflight: false)
  }

  public func cancel() {
    if testingState == .running {
      cancelTesting()
      return
    }
    if performanceState == .planning || performanceState == .running {
      cancelPerformance()
      return
    }
    runner.cancel(requestID: activeReviewRequestID)
    runTask?.cancel()
    verificationState = .cancelled
    statusMessage = "The supervised Rust process was asked to stop. No success claim was recorded."
  }

  public func resetVerification() {
    runner.cancel(requestID: activeReviewRequestID)
    runTask?.cancel()
    clearProof()
    verificationState = .ready
    statusMessage = "Ready to plan another executable verification."
  }

  public var xrayRequestFingerprint: String? {
    guard let reviewID = receipt?.reviewID else { return nil }
    return
      ([reviewID, xrayPublicSource, String(xrayPublicConfirmed), xrayFormat.rawValue]
      + xrayApprovedExcerptFindingIDs.sorted()).joined(separator: "\u{0}")
  }

  public var canPreviewXray: Bool {
    receipt?.reviewID != nil && !xrayLoading
  }

  public var canSaveXray: Bool {
    canPreviewXray && xrayResult?.eligible == true
      && xrayPreviewFingerprint == xrayRequestFingerprint
  }

  public func toggleXrayExcerpt(_ findingID: String) {
    if xrayApprovedExcerptFindingIDs.contains(findingID) {
      xrayApprovedExcerptFindingIDs.remove(findingID)
    } else {
      xrayApprovedExcerptFindingIDs.insert(findingID)
    }
    xraySavedPath = nil
  }

  public func previewXray() {
    runXray(destination: nil)
  }

  public func saveXray(to destination: URL) {
    guard canSaveXray else { return }
    runXray(destination: destination)
  }

  private func runXray(destination: URL?) {
    guard let reviewID = receipt?.reviewID, !xrayLoading else { return }
    let fingerprint = xrayRequestFingerprint
    let request = XrayRequest(
      reviewID: reviewID,
      publicSourceConfirmed: xrayPublicConfirmed,
      publicSource: xrayPublicSource.trimmingCharacters(in: .whitespacesAndNewlines),
      approvedExcerptFindingIDs: xrayApprovedExcerptFindingIDs.sorted()
    )
    xrayLoading = true
    xrayIssue = nil
    xraySavedPath = nil
    xrayTask = Task { [weak self] in
      guard let self else { return }
      defer {
        xrayLoading = false
        xrayTask = nil
      }
      do {
        let run = try await runner.runXray(request, format: xrayFormat, destination: destination)
        guard !Task.isCancelled else { return }
        xrayResult = run.result
        xrayPreviewFingerprint = fingerprint
        if let destination {
          xraySavedPath = destination.path(percentEncoded: false)
        }
      } catch is CancellationError {
        xrayIssue = "X-Ray generation was cancelled."
      } catch {
        xrayIssue = error.localizedDescription
      }
    }
  }

  public func prepareFixPacketSelection() {
    guard fixPacketSelectedFindingIDs.isEmpty, fixPacketReceipt == nil else { return }
    fixPacketSelectedFindingIDs = Set(receipt?.reviewFindings.compactMap(\.persistedID) ?? [])
  }

  public func toggleFixPacketFinding(_ findingID: String) {
    if fixPacketSelectedFindingIDs.contains(findingID) {
      fixPacketSelectedFindingIDs.remove(findingID)
    } else {
      fixPacketSelectedFindingIDs.insert(findingID)
    }
    fixPacketReceipt = nil
    fixPacketIssue = nil
    resetFixAttempt()
  }

  public var canBuildFixPacket: Bool {
    receipt?.runID != nil && !fixPacketSelectedFindingIDs.isEmpty && !fixPacketLoading
  }

  public func buildFixPacket() {
    guard let runID = receipt?.runID, canBuildFixPacket else { return }
    let selected = fixPacketSelectedFindingIDs.sorted()
    fixPacketLoading = true
    fixPacketIssue = nil
    fixPacketReceipt = nil
    resetFixAttempt()
    fixPacketTask = Task { [weak self] in
      guard let self else { return }
      defer {
        fixPacketLoading = false
        fixPacketTask = nil
      }
      do {
        let packet = try await runner.buildFixPacket(runID: runID, findingIDs: selected)
        guard !Task.isCancelled else { return }
        fixPacketReceipt = packet
      } catch is CancellationError {
        fixPacketIssue = "Agent fix-packet generation was cancelled."
      } catch {
        fixPacketIssue = error.localizedDescription
      }
    }
  }

  public var canExecuteFixAttempt: Bool {
    fixPacketReceipt != nil && !fixPacketSelectedFindingIDs.isEmpty && fixAttemptConfirmed
      && !fixAttemptLoading
  }

  public func executeFixAttempt() {
    guard let packet = fixPacketReceipt, canExecuteFixAttempt else { return }
    let selected = fixPacketSelectedFindingIDs.sorted()
    fixAttemptLoading = true
    fixAttemptIssue = nil
    fixAttemptReceipt = nil
    fixAttemptDiscardConfirmed = false
    fixAttemptTask = Task { [weak self] in
      guard let self else { return }
      defer {
        fixAttemptLoading = false
        fixAttemptTask = nil
      }
      do {
        let attempt = try await runner.executeFixAttempt(
          runID: packet.runID,
          findingIDs: selected,
          agent: fixAttemptAgent
        )
        guard !Task.isCancelled else { return }
        fixAttemptReceipt = attempt
        fixAttemptConfirmed = false
      } catch is CancellationError {
        fixAttemptIssue =
          "Fix execution was cancelled. Inspect app-data fix attempts before discarding any retained worktree."
      } catch {
        fixAttemptIssue = error.localizedDescription
      }
    }
  }

  public func cancelFixAttempt() {
    fixAttemptTask?.cancel()
    runner.cancel()
  }

  public var canDiscardFixAttempt: Bool {
    fixAttemptReceipt?.worktree.retained == true && fixAttemptDiscardConfirmed
      && !fixAttemptLoading
  }

  public func discardFixAttempt() {
    guard let attemptID = fixAttemptReceipt?.attemptID, canDiscardFixAttempt else { return }
    fixAttemptLoading = true
    fixAttemptIssue = nil
    fixAttemptTask = Task { [weak self] in
      guard let self else { return }
      defer {
        fixAttemptLoading = false
        fixAttemptTask = nil
      }
      do {
        fixAttemptReceipt = try await runner.discardFixAttempt(attemptID: attemptID)
        fixAttemptDiscardConfirmed = false
      } catch {
        fixAttemptIssue = error.localizedDescription
      }
    }
  }

  public func openQaWorkspace() {
    guard !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    showingQaWorkspace = true
    loadQaWorkspace()
  }

  public func loadQaWorkspace() {
    guard !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !qaWorkspaceLoading
    else { return }
    qaWorkspaceLoading = true
    qaWorkspaceIssue = nil
    let fixCompletedAt =
      fixAttemptReceipt?.repositoryPath == repositoryPath ? fixAttemptReceipt?.completedAt : nil
    qaWorkspaceTask = Task { [weak self] in
      guard let self else { return }
      defer {
        qaWorkspaceLoading = false
        qaWorkspaceTask = nil
      }
      do {
        let receipt = try await runner.loadQaWorkspace(
          repositoryPath: repositoryPath,
          fixCompletedAt: fixCompletedAt
        )
        guard !Task.isCancelled else { return }
        acceptQaWorkspace(receipt)
      } catch {
        qaWorkspaceIssue = error.localizedDescription
      }
    }
  }

  public func newQaWorkflow() {
    qaSelectedWorkflowID = nil
    qaSelectedTargetID = nil
    qaWorkflowDraft = QaWorkflowDraft(
      id: "qa-workflow-\(UUID().uuidString.lowercased())",
      name: "",
      baseURL: testingPreviewURL,
      loopID: "generic-page-smoke",
      runnerType: "playwright_builtin",
      goal: "Verify the selected user journey",
      repoSpecPath: "",
      repoTraceMode: "retain-on-failure",
      targetRoute: testingTargetRoute.isEmpty ? "/" : testingTargetRoute,
      allowRemoteTarget: false
    )
    qaTargetName = ""
    qaTargetRoute = qaWorkflowDraft.targetRoute
    qaTargetGoal = qaWorkflowDraft.goal
  }

  public func selectQaWorkflow(_ id: String) {
    guard let workflow = qaWorkspaceReceipt?.workflows.first(where: { $0.id == id }) else {
      return
    }
    qaSelectedWorkflowID = id
    qaSelectedTargetID = nil
    qaWorkflowDraft = QaWorkflowDraft(
      id: workflow.id,
      name: workflow.name,
      baseURL: workflow.baseURL,
      loopID: workflow.loopID,
      runnerType: workflow.runnerType,
      goal: workflow.goal,
      repoSpecPath: workflow.repoSpecPath,
      repoTraceMode: workflow.repoTraceMode,
      targetRoute: workflow.targetRoute,
      allowRemoteTarget: workflow.allowRemoteTarget
    )
    qaTargetName = ""
    qaTargetRoute = workflow.targetRoute
    qaTargetGoal = workflow.goal
  }

  public func selectQaTarget(_ id: String) {
    guard let workflow = selectedQaWorkflow,
      let target = workflow.targets.first(where: { $0.id == id })
    else { return }
    qaSelectedTargetID = id
    qaTargetName = target.name
    qaTargetRoute = target.route
    qaTargetGoal = target.goal
  }

  public var selectedQaWorkflow: QaWorkflow? {
    guard let id = qaSelectedWorkflowID else { return nil }
    return qaWorkspaceReceipt?.workflows.first { $0.id == id }
  }

  public func chooseQaSpec(_ path: String) {
    qaWorkflowDraft.repoSpecPath = path
    qaWorkflowDraft.runnerType = path.isEmpty ? "playwright_builtin" : "repo_playwright"
  }

  public func applyQaWorkflowToTesting() {
    guard let workflow = selectedQaWorkflow ?? qaWorkspaceReceipt?.workflows.first else { return }
    let target = workflow.targets.first { $0.id == qaSelectedTargetID }
    testingPreviewURL = workflow.baseURL
    testingTargetRoute = target?.route ?? workflow.targetRoute
    testingTargetGoal = target?.goal ?? workflow.goal
    testingQaWorkflowName = workflow.name
    testingConfirmed = false
    clearTestingProof()
    testingStatusMessage =
      "Applied \(workflow.name) to \(testingTargetRoute). Confirm preview access before browser execution."
  }

  public func applyPostFixQaPreparation(_ preparation: QaPostFixPreparation) {
    testingPreviewURL = preparation.before.baseURL
    testingTargetRoute = preparation.before.route
    testingTargetGoal = preparation.before.goal
    testingQaWorkflowName = "Post-fix rerun"
    testingConfirmed = false
    clearTestingProof()
    testingStatusMessage =
      "Prepared the prior flow at \(preparation.before.route). Confirm preview access before browser execution."
    showingQaWorkspace = false
  }

  public func saveQaWorkflow() {
    guard !qaWorkspaceLoading else { return }
    if qaWorkflowDraft.id.isEmpty {
      qaWorkflowDraft.id = "qa-workflow-\(UUID().uuidString.lowercased())"
    }
    qaWorkspaceLoading = true
    qaWorkspaceIssue = nil
    let draft = qaWorkflowDraft
    qaWorkspaceTask = Task { [weak self] in
      guard let self else { return }
      defer {
        qaWorkspaceLoading = false
        qaWorkspaceTask = nil
      }
      do {
        let receipt = try await runner.saveQaWorkflow(
          repositoryPath: repositoryPath,
          draft: draft
        )
        qaSelectedWorkflowID = draft.id
        acceptQaWorkspace(receipt, preserveSelection: true)
      } catch {
        qaWorkspaceIssue = error.localizedDescription
      }
    }
  }

  public func deleteQaWorkflow() {
    guard let id = qaSelectedWorkflowID, !qaWorkspaceLoading else { return }
    qaWorkspaceLoading = true
    qaWorkspaceIssue = nil
    qaWorkspaceTask = Task { [weak self] in
      guard let self else { return }
      defer {
        qaWorkspaceLoading = false
        qaWorkspaceTask = nil
      }
      do {
        let receipt = try await runner.deleteQaWorkflow(
          repositoryPath: repositoryPath,
          workflowID: id
        )
        qaSelectedWorkflowID = nil
        qaSelectedTargetID = nil
        acceptQaWorkspace(receipt)
      } catch {
        qaWorkspaceIssue = error.localizedDescription
      }
    }
  }

  public func saveQaTarget() {
    guard let workflowID = qaSelectedWorkflowID, !qaWorkspaceLoading else { return }
    let target = QaTargetPreset(
      id: qaSelectedTargetID ?? "qa-target-\(UUID().uuidString.lowercased())",
      name: qaTargetName,
      route: qaTargetRoute,
      goal: qaTargetGoal
    )
    qaWorkspaceLoading = true
    qaWorkspaceIssue = nil
    qaWorkspaceTask = Task { [weak self] in
      guard let self else { return }
      defer {
        qaWorkspaceLoading = false
        qaWorkspaceTask = nil
      }
      do {
        let receipt = try await runner.saveQaTarget(
          repositoryPath: repositoryPath,
          workflowID: workflowID,
          target: target
        )
        qaSelectedTargetID = target.id
        acceptQaWorkspace(receipt, preserveSelection: true)
      } catch {
        qaWorkspaceIssue = error.localizedDescription
      }
    }
  }

  public func deleteQaTarget() {
    guard let workflowID = qaSelectedWorkflowID, let targetID = qaSelectedTargetID,
      !qaWorkspaceLoading
    else { return }
    qaWorkspaceLoading = true
    qaWorkspaceIssue = nil
    qaWorkspaceTask = Task { [weak self] in
      guard let self else { return }
      defer {
        qaWorkspaceLoading = false
        qaWorkspaceTask = nil
      }
      do {
        let receipt = try await runner.deleteQaTarget(
          repositoryPath: repositoryPath,
          workflowID: workflowID,
          targetID: targetID
        )
        qaSelectedTargetID = nil
        acceptQaWorkspace(receipt, preserveSelection: true)
      } catch {
        qaWorkspaceIssue = error.localizedDescription
      }
    }
  }

  private func acceptQaWorkspace(_ receipt: QaWorkspaceReceipt, preserveSelection: Bool = false) {
    qaWorkspaceReceipt = receipt
    let existingWorkflowID = preserveSelection ? qaSelectedWorkflowID : nil
    let existingTargetID = preserveSelection ? qaSelectedTargetID : nil
    if let id = existingWorkflowID, receipt.workflows.contains(where: { $0.id == id }) {
      selectQaWorkflow(id)
      if let targetID = existingTargetID,
        selectedQaWorkflow?.targets.contains(where: { $0.id == targetID }) == true
      {
        selectQaTarget(targetID)
      }
    } else if let first = receipt.workflows.first {
      selectQaWorkflow(first.id)
    } else {
      newQaWorkflow()
    }
  }

  public func runTesting() {
    guard canStartTesting else { return }
    testingReceipt = nil
    testingReceiptJSON = ""
    testingState = .running
    testingStatusMessage =
      "Rust is resolving source identity, proving the preview revision, and executing bounded routes…"
    let request = TrexPreviewRequest(
      repositoryPath: repositoryPath,
      changeKind: testingChangeKind,
      change: testingChange.trimmingCharacters(in: .whitespacesAndNewlines),
      previewURL: testingPreviewURL.trimmingCharacters(in: .whitespacesAndNewlines),
      targetRoute: testingTargetRoute.trimmingCharacters(in: .whitespacesAndNewlines),
      targetGoal: testingTargetGoal.trimmingCharacters(in: .whitespacesAndNewlines)
    )
    testingTask = Task { [weak self] in
      guard let self else { return }
      defer { testingTask = nil }
      do {
        let result = try await runner.runTrex(request)
        guard !Task.isCancelled else { return }
        testingReceipt = result.receipt
        testingReceiptJSON = result.rawJSON
        switch result.receipt.verdict {
        case .passedWithLimits, .noConfidence:
          testingState = .limited
        case .failed:
          testingState = .failed
        }
        testingStatusMessage = result.receipt.summary
        loadRuns()
      } catch is CancellationError {
        testingState = .cancelled
        testingStatusMessage =
          "The supervised Rust process was stopped. No successful T-Rex receipt was accepted."
      } catch {
        if Task.isCancelled {
          testingState = .cancelled
        } else {
          testingState = .failed
          testingStatusMessage = error.localizedDescription
        }
      }
    }
  }

  public func cancelTesting() {
    testingTask?.cancel()
    runner.cancel()
    testingState = .cancelled
    testingStatusMessage =
      "The supervised Rust process was asked to stop. No success claim was recorded."
  }

  public func resetTesting() {
    testingTask?.cancel()
    runner.cancel()
    clearTestingProof()
    testingState = .ready
    testingStatusMessage = "Ready to test another exact change against a deployed preview."
  }

  public func inspectWarmVerifier() {
    guard !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      warmState != .running
    else { return }
    warmState = .running
    warmIssue = nil
    warmStatusMessage = "Checking the owned verifier runtime without executing scenarios…"
    warmTask = Task { [weak self] in
      guard let self else { return }
      defer { warmTask = nil }
      do {
        let health = try await runner.warmHealth(repositoryPath: repositoryPath)
        guard !Task.isCancelled else { return }
        warmHealth = health
        warmState = .ready
        warmStatusMessage =
          health == nil
          ? "The verifier is cold. Running changed proof will start its owned runtime."
          : "The verifier is warm and ready for the current repository revision."
      } catch is CancellationError {
        warmState = .cancelled
        warmStatusMessage = "Warm verifier inspection was cancelled."
      } catch {
        warmState = .failed
        warmIssue = error.localizedDescription
        warmStatusMessage = "The repository-owned verifier could not be inspected."
      }
    }
  }

  public func runWarmVerification() {
    guard canRunWarmVerification else { return }
    let runID = "native-warm-\(UUID().uuidString.lowercased())"
    warmReceipt = nil
    warmReceiptJSON = ""
    warmIssue = nil
    warmState = .running
    warmStatusMessage =
      "Warming the owned runtime and executing the current changed-scenario selection…"
    warmTask = Task { [weak self] in
      guard let self else { return }
      defer { warmTask = nil }
      do {
        let result = try await runner.runWarmChanged(
          repositoryPath: repositoryPath,
          runID: runID,
          detailed: warmDetailedCapture
        )
        guard !Task.isCancelled else { return }
        warmReceipt = result.receipt
        warmReceiptJSON = result.rawJSON
        warmState =
          switch result.receipt.result.outcome {
          case .passed: result.receipt.result.limitations.isEmpty ? .completed : .limited
          case .regression: .failed
          case .noConfidence: .limited
          }
        warmStatusMessage = warmSummary(result.receipt.result)
        loadRuns()
      } catch is CancellationError {
        warmState = .cancelled
        warmStatusMessage =
          "The owned verifier client was stopped and no successful receipt was accepted."
      } catch {
        warmState = .failed
        warmIssue = error.localizedDescription
        warmStatusMessage = error.localizedDescription
      }
    }
  }

  public func cancelWarmVerification() {
    warmTask?.cancel()
    runner.cancel()
    warmState = .cancelled
    warmStatusMessage =
      "Cancellation was sent to the supervised verifier client. No success claim was recorded."
  }

  public func resetWarmVerification() {
    warmTask?.cancel()
    runner.cancel()
    warmReceipt = nil
    warmReceiptJSON = ""
    warmIssue = nil
    warmState = .ready
    warmStatusMessage =
      "Inspect the repository-owned daemon, then verify only the current changed scope."
  }

  public func prepareDifferential() {
    guard canPrepareDifferential else { return }
    let runID = "native-diff-\(UUID().uuidString.lowercased())"
    let request = differentialRequest(runID: runID)
    differentialPrepared = nil
    differentialReceipt = nil
    differentialReceiptJSON = ""
    differentialIssue = nil
    differentialState = .planning
    differentialStatusMessage = "Materializing the exact comparison pair without model calls…"
    differentialTask = Task { [weak self] in
      guard let self else { return }
      defer { differentialTask = nil }
      do {
        let receipt = try await runner.prepareDifferential(request)
        guard !Task.isCancelled else { return }
        differentialPrepared = receipt
        differentialRunID = runID
        differentialPreparedFingerprint = differentialInputFingerprint
        differentialState = receipt.status == "ready" ? .planned : .limited
        differentialStatusMessage =
          receipt.status == "ready"
          ? "The exact pair is prepared. Execute to compare scenario evidence."
          : "The pair is incomparable; inspect reason codes before changing the selection."
      } catch is CancellationError {
        differentialState = .cancelled
        differentialStatusMessage = "Differential preparation was cancelled."
      } catch {
        differentialState = .failed
        differentialIssue = error.localizedDescription
        differentialStatusMessage = error.localizedDescription
      }
    }
  }

  public func runDifferentialVerification() {
    guard canRunDifferential, let runID = differentialRunID else { return }
    let request = differentialRequest(runID: runID)
    differentialState = .running
    differentialIssue = nil
    differentialStatusMessage =
      "Running the prepared reference/candidate scenarios under the shared parity policy…"
    differentialTask = Task { [weak self] in
      guard let self else { return }
      defer { differentialTask = nil }
      do {
        let receipt = try await runner.runDifferential(request)
        guard !Task.isCancelled else { return }
        differentialReceipt = receipt
        differentialReceiptJSON = String(
          decoding: try JSONEncoder().encode(receipt), as: UTF8.self)
        differentialState =
          switch receipt.summary.classification {
          case "regressed": .failed
          case "incomparable": .limited
          default: .completed
          }
        differentialStatusMessage =
          "Differential comparison: \(receipt.summary.classification) · \(receipt.summary.deltaCount) deltas."
        loadRuns()
      } catch is CancellationError {
        differentialState = .cancelled
        differentialStatusMessage = "Differential verification was cancelled without a pass claim."
      } catch {
        differentialState = .failed
        differentialIssue = error.localizedDescription
        differentialStatusMessage = error.localizedDescription
      }
    }
  }

  public func cancelDifferentialVerification() {
    differentialTask?.cancel()
    runner.cancel()
    differentialState = .cancelled
    differentialStatusMessage = "The supervised differential client was stopped."
  }

  public func resetDifferentialVerification() {
    differentialTask?.cancel()
    runner.cancel()
    differentialPrepared = nil
    differentialReceipt = nil
    differentialReceiptJSON = ""
    differentialIssue = nil
    differentialRunID = nil
    differentialPreparedFingerprint = nil
    differentialState = .ready
    differentialStatusMessage =
      "Prepare an exact reference/candidate pair before executing comparison."
  }

  private func differentialRequest(runID: String) -> DifferentialRequest {
    DifferentialRequest(
      repositoryPath: repositoryPath,
      runID: runID,
      reference: differentialReference.trimmingCharacters(in: .whitespacesAndNewlines),
      candidateKind: differentialCandidateKind,
      candidateRevision: differentialCandidateRevision.trimmingCharacters(
        in: .whitespacesAndNewlines
      ).isEmpty
        ? nil : differentialCandidateRevision.trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }

  public func inspectScenarioCandidates() {
    runScenarioAction(.inspect(candidateID: nil), message: "Loading bounded scenario candidates…")
  }

  public func generateScenarioCandidate() {
    guard canGenerateScenario else { return }
    runScenarioAction(
      .generate(
        spec: scenarioSpecPath.trimmingCharacters(in: .whitespacesAndNewlines),
        section: scenarioSpecSection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          ? nil : scenarioSpecSection.trimmingCharacters(in: .whitespacesAndNewlines),
        model: scenarioModel.trimmingCharacters(in: .whitespacesAndNewlines),
        routes: scenarioRouteList,
        requestPolicy: scenarioIncludeRequestPolicy
      ),
      message: "Generating a bounded candidate with the selected local model…"
    )
  }

  public func validateScenarioCandidate() {
    guard let id = selectedScenarioCandidateID else { return }
    runScenarioAction(
      .validate(candidateID: id), message: "Validating candidate structure and policy…")
  }

  public func dryRunScenarioCandidate() {
    guard let id = selectedScenarioCandidateID else { return }
    runScenarioAction(
      .dryRun(candidateID: id), message: "Dry-running without persistence or baseline updates…")
  }

  public func acceptScenarioCandidate() {
    guard let candidate = selectedScenarioCandidate, canAcceptScenario else { return }
    runScenarioAction(
      .accept(
        candidateID: candidate.candidateID,
        hash: candidate.candidateHash,
        destinations: selectedScenarioDestinations.sorted(),
        approveReplacements: scenarioReplacementApproved
      ),
      message: "Accepting only the selected destinations against the current candidate hash…"
    )
  }

  public func rejectScenarioCandidate() {
    guard let candidate = selectedScenarioCandidate, scenarioState != .running else { return }
    runScenarioAction(
      .reject(candidateID: candidate.candidateID, hash: candidate.candidateHash),
      message: "Rejecting the exact candidate without writing project files…"
    )
  }

  public func selectScenarioCandidate(_ id: String) {
    selectedScenarioCandidateID = id
    selectedScenarioDestinations = []
    scenarioReplacementApproved = false
  }

  public func toggleScenarioDestination(_ destination: String) {
    if selectedScenarioDestinations.contains(destination) {
      selectedScenarioDestinations.remove(destination)
    } else {
      selectedScenarioDestinations.insert(destination)
    }
  }

  public func cancelScenarioAction() {
    scenarioTask?.cancel()
    runner.cancel()
    scenarioState = .cancelled
    scenarioStatusMessage = "Scenario action was cancelled without accepting project files."
  }

  private func runScenarioAction(_ action: ScenarioCompilerAction, message: String) {
    guard scenarioState != .running, !repositoryPath.isEmpty else { return }
    scenarioState = .running
    scenarioIssue = nil
    scenarioStatusMessage = message
    scenarioTask = Task { [weak self] in
      guard let self else { return }
      defer { scenarioTask = nil }
      do {
        let receipt = try await runner.runScenarioCompiler(
          repositoryPath: repositoryPath, action: action)
        guard !Task.isCancelled else { return }
        let merged = ([receipt.candidate].compactMap { $0 } + receipt.candidates)
          .reduce(into: [String: ScenarioCandidate]()) { $0[$1.candidateID] = $1 }
          .values.sorted { $0.createdAt > $1.createdAt }
        scenarioCandidates = Array(merged.prefix(20))
        if let current = receipt.candidate?.candidateID {
          selectScenarioCandidate(current)
        } else if !scenarioCandidates.contains(where: {
          $0.candidateID == selectedScenarioCandidateID
        }) {
          if let first = scenarioCandidates.first {
            selectScenarioCandidate(first.candidateID)
          } else {
            selectedScenarioCandidateID = nil
            selectedScenarioDestinations = []
          }
        }
        scenarioState = receipt.status == "ok" ? .completed : .limited
        scenarioStatusMessage = receipt.message
      } catch is CancellationError {
        scenarioState = .cancelled
        scenarioStatusMessage = "Scenario action was cancelled without accepting project files."
      } catch {
        scenarioState = .failed
        scenarioIssue = error.localizedDescription
        scenarioStatusMessage = error.localizedDescription
      }
    }
  }

  private var scenarioRouteList: [String] {
    Array(
      Set(
        scenarioRoutes.split(separator: ",").map {
          $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty })
    ).sorted()
  }

  public func loadTrexWatcher() {
    guard !repositoryPath.isEmpty, trexWatcherState != .running else { return }
    trexWatcherTask?.cancel()
    trexWatcherState = .planning
    trexWatcherIssue = nil
    trexWatcherStatusMessage = "Reading Rust-owned watcher configuration and run history…"
    trexWatcherTask = Task { [weak self] in
      guard let self else { return }
      defer { trexWatcherTask = nil }
      do {
        let configurations = try await runner.runTrexWatcher(
          repositoryPath: nil, action: .list)
        let history = try await runner.runTrexWatcher(
          repositoryPath: repositoryPath, action: .runs(limit: 50))
        guard !Task.isCancelled else { return }
        applyTrexWatcherReceipt(configurations)
        applyTrexWatcherReceipt(history)
        trexWatcherState = .ready
        trexWatcherStatusMessage =
          currentTrexWatcher == nil
          ? "No watcher is saved for this repository."
          : "Configuration loaded. Allow execution for this app session before polling."
      } catch is CancellationError {
        trexWatcherState = .cancelled
        trexWatcherStatusMessage = "Watcher inspection was cancelled."
      } catch {
        trexWatcherState = .failed
        trexWatcherIssue = error.localizedDescription
        trexWatcherStatusMessage = error.localizedDescription
      }
    }
  }

  public func enableTrexWatcher(confirmRun: Bool) {
    guard canConfigureTrexWatcher else { return }
    trexWatcherTask?.cancel()
    trexWatcherScheduleTask?.cancel()
    trexWatcherSessionConfirmed = confirmRun
    trexWatcherState = .running
    trexWatcherIssue = nil
    trexWatcherStatusMessage = "Saving the watcher schedule without starting a hidden daemon…"
    let interval = UInt64(max(trexWatcherIntervalSeconds, 60))
    let baseBranch = trexWatcherBaseBranch.trimmingCharacters(in: .whitespacesAndNewlines)
    trexWatcherTask = Task { [weak self] in
      guard let self else { return }
      defer { trexWatcherTask = nil }
      do {
        let receipt = try await runner.runTrexWatcher(
          repositoryPath: repositoryPath,
          action: .enable(
            intervalSeconds: interval,
            baseBranch: baseBranch.isEmpty ? nil : baseBranch
          )
        )
        guard !Task.isCancelled else { return }
        applyTrexWatcherReceipt(receipt)
        trexWatcherState = .completed
        trexWatcherStatusMessage =
          confirmRun
          ? "Watcher enabled for this app session. The first poll waits for the configured interval."
          : "Watcher configuration saved. Poll execution is paused until you consent."
        restartTrexWatcherSchedule()
      } catch is CancellationError {
        trexWatcherState = .cancelled
        trexWatcherStatusMessage = "Watcher configuration was cancelled."
      } catch {
        trexWatcherState = .failed
        trexWatcherIssue = error.localizedDescription
        trexWatcherStatusMessage = error.localizedDescription
      }
    }
  }

  public func disableTrexWatcher() {
    guard currentTrexWatcher != nil, !isBusy else { return }
    trexWatcherScheduleTask?.cancel()
    trexWatcherScheduleTask = nil
    trexWatcherSessionConfirmed = false
    trexWatcherState = .running
    trexWatcherIssue = nil
    trexWatcherStatusMessage = "Disabling future polls without deleting run history…"
    trexWatcherTask = Task { [weak self] in
      guard let self else { return }
      defer { trexWatcherTask = nil }
      do {
        let receipt = try await runner.runTrexWatcher(
          repositoryPath: repositoryPath, action: .disable)
        guard !Task.isCancelled else { return }
        applyTrexWatcherReceipt(receipt)
        trexWatcherState = .completed
        trexWatcherStatusMessage = receipt.message
      } catch is CancellationError {
        trexWatcherState = .cancelled
        trexWatcherStatusMessage = "Watcher disable was cancelled."
      } catch {
        trexWatcherState = .failed
        trexWatcherIssue = error.localizedDescription
        trexWatcherStatusMessage = error.localizedDescription
      }
    }
  }

  public func pollTrexWatcher(confirmRun: Bool) {
    if confirmRun { trexWatcherSessionConfirmed = true }
    guard currentTrexWatcher != nil, trexWatcherSessionConfirmed, !isBusy else { return }
    trexWatcherTask?.cancel()
    trexWatcherState = .running
    trexWatcherIssue = nil
    trexWatcherStatusMessage =
      "Looking for new or updated open PRs and completing each newly discovered sandbox receipt…"
    trexWatcherTask = Task { [weak self] in
      guard let self else { return }
      defer { trexWatcherTask = nil }
      await executeTrexWatcherPoll()
      restartTrexWatcherSchedule()
    }
  }

  public func retryTrexWatcherRun(_ run: TrexWatcherRun) {
    guard currentTrexWatcher != nil, trexWatcherSessionConfirmed, !isBusy else { return }
    trexWatcherTask?.cancel()
    trexWatcherState = .running
    trexWatcherIssue = nil
    trexWatcherStatusMessage =
      "Retrying PR #\(run.prNumber) at its current exact head with this session's consent…"
    trexWatcherTask = Task { [weak self] in
      guard let self else { return }
      defer { trexWatcherTask = nil }
      do {
        let receipt = try await runner.runTrexWatcher(
          repositoryPath: repositoryPath,
          action: .retry(prNumber: run.prNumber)
        )
        guard !Task.isCancelled else { return }
        applyTrexWatcherReceipt(receipt)
        trexWatcherState = .completed
        trexWatcherStatusMessage = receipt.message
        restartTrexWatcherSchedule()
      } catch is CancellationError {
        trexWatcherState = .cancelled
        trexWatcherStatusMessage =
          "The supervised watcher retry was stopped. No success claim was recorded."
      } catch {
        trexWatcherState = .failed
        trexWatcherIssue = error.localizedDescription
        trexWatcherStatusMessage = error.localizedDescription
        restartTrexWatcherSchedule()
      }
    }
  }

  public func resumeTrexWatcherSession() {
    guard let watcher = currentTrexWatcher, watcher.enabled, !isBusy else { return }
    trexWatcherSessionConfirmed = true
    trexWatcherState = .completed
    trexWatcherStatusMessage =
      "App-lifetime scheduling is active. The first poll waits for the configured interval."
    restartTrexWatcherSchedule()
  }

  public func cancelTrexWatcherAction() {
    trexWatcherTask?.cancel()
    trexWatcherScheduleTask?.cancel()
    runner.cancel()
    trexWatcherState = .cancelled
    trexWatcherStatusMessage =
      "The supervised watcher process was stopped. No success claim was recorded."
  }

  private func executeTrexWatcherPoll() async {
    do {
      let receipt = try await runner.runTrexWatcher(
        repositoryPath: repositoryPath, action: .poll)
      guard !Task.isCancelled else { return }
      applyTrexWatcherReceipt(receipt)
      trexWatcherState = .completed
      trexWatcherStatusMessage = receipt.message
    } catch is CancellationError {
      trexWatcherState = .cancelled
      trexWatcherStatusMessage =
        "The supervised watcher process was stopped. No success claim was recorded."
    } catch {
      trexWatcherState = .failed
      trexWatcherIssue = error.localizedDescription
      trexWatcherStatusMessage = error.localizedDescription
    }
  }

  private func restartTrexWatcherSchedule() {
    trexWatcherScheduleTask?.cancel()
    guard trexWatcherSessionConfirmed, let watcher = currentTrexWatcher, watcher.enabled else {
      trexWatcherScheduleTask = nil
      return
    }
    let interval = watcher.intervalSeconds
    trexWatcherScheduleTask = Task { [weak self] in
      while !Task.isCancelled {
        do {
          try await Task.sleep(nanoseconds: interval * 1_000_000_000)
        } catch {
          return
        }
        guard let self, !Task.isCancelled else { return }
        if isBusy { continue }
        trexWatcherState = .running
        trexWatcherIssue = nil
        trexWatcherStatusMessage =
          "Scheduled incoming PR poll is looking for new or updated heads with this session's consent…"
        await executeTrexWatcherPoll()
      }
    }
  }

  private func applyTrexWatcherReceipt(_ receipt: TrexWatcherReceipt) {
    if !receipt.watchers.isEmpty {
      trexWatchers = receipt.watchers
    }
    if let watcher = receipt.watcher {
      trexWatchers.removeAll { $0.repoPath == watcher.repoPath }
      trexWatchers.append(watcher)
      if watcher.repoPath
        == URL(fileURLWithPath: repositoryPath).resolvingSymlinksInPath().path
      {
        trexWatcherIntervalSeconds = Int(watcher.intervalSeconds)
        trexWatcherBaseBranch = watcher.baseBranch ?? ""
      }
    }
    if !receipt.runs.isEmpty || receipt.operation == "runs" {
      let merged = (receipt.runs + trexWatcherRuns)
        .reduce(into: [String: TrexWatcherRun]()) { result, run in
          result[run.id] = run
        }
        .values.sorted { $0.ranAt > $1.ranAt }
      trexWatcherRuns = Array(merged.prefix(50))
    }
    if let encoded = try? JSONEncoder().encode(receipt) {
      trexWatcherReceiptJSON = String(decoding: encoded, as: UTF8.self)
    }
  }

  public var testingScopeInputIssue: String? {
    scopeInputIssue(kind: testingScopeKind, value: testingScopeRequestValue)
  }

  public var canResolveTestingScope: Bool {
    !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && testingScopeInputIssue == nil && !isBusy
  }

  public func resolveTestingScope() {
    guard canResolveTestingScope else { return }
    testingScopeLoading = true
    testingScopeIssue = nil
    selectedTestingScopeCandidateID = nil
    let request = EvidenceScopeRequest(
      repositoryPath: repositoryPath,
      consumer: .testing,
      kind: testingScopeKind,
      value: testingScopeKind == .codebase ? nil : testingScopeRequestValue
    )
    testingScopeTask = Task { [weak self] in
      guard let self else { return }
      defer {
        testingScopeLoading = false
        testingScopeTask = nil
      }
      do {
        let result = try await runner.resolveEvidenceScope(request)
        guard !Task.isCancelled else { return }
        testingScopePlan = result.plan
        selectedTestingScopeCandidateID = result.plan.candidates.first?.id
      } catch is CancellationError {
        // A cancelled discovery produces no accepted plan.
      } catch {
        testingScopeIssue = error.localizedDescription
      }
    }
  }

  public func selectTestingScopeCandidate(_ candidate: EvidenceScopeCandidate) {
    selectedTestingScopeCandidateID = candidate.id
  }

  public var performanceScopeInputIssue: String? {
    scopeInputIssue(kind: performanceScopeKind, value: performanceScopeValue)
  }

  public var canResolvePerformanceScope: Bool {
    !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && performanceScopeInputIssue == nil && !isBusy
  }

  public func resolvePerformanceScope() {
    guard canResolvePerformanceScope else { return }
    performanceScopeLoading = true
    performanceScopeIssue = nil
    let request = EvidenceScopeRequest(
      repositoryPath: repositoryPath,
      consumer: .performance,
      kind: performanceScopeKind,
      value: performanceScopeKind == .codebase ? nil : performanceScopeValue
    )
    performanceScopeTask = Task { [weak self] in
      guard let self else { return }
      defer {
        performanceScopeLoading = false
        performanceScopeTask = nil
      }
      do {
        let result = try await runner.resolveEvidenceScope(request)
        guard !Task.isCancelled else { return }
        performanceDiscoveryPlan = result.plan
        if let candidate = result.plan.candidates.first {
          applyPerformanceScopeCandidate(candidate)
        }
      } catch is CancellationError {
        // A cancelled discovery produces no accepted plan.
      } catch {
        performanceScopeIssue = error.localizedDescription
      }
    }
  }

  public func applyPerformanceScopeCandidate(_ candidate: EvidenceScopeCandidate) {
    guard let adapter = PerformanceAdapter(rawValue: candidate.adapter) else {
      performanceScopeIssue =
        "The discovered \(candidate.adapter) target is not supported by the performance runner."
      return
    }
    performanceAdapter = adapter
    performanceTarget = candidate.target
    performanceName = candidate.name ?? ""
    clearPerformanceProof()
  }

  public func planPerformance() {
    startPerformance(.plan)
  }

  public func diagnosePerformance() {
    startPerformance(.diagnose)
  }

  public func verifyPairedPerformance() {
    startPerformance(.verifyPaired)
  }

  public func inspectPerformanceRun() {
    startPerformance(.inspect)
  }

  public func cancelPerformance() {
    performanceTask?.cancel()
    runner.cancel()
    performanceState = .cancelled
    performanceStatusMessage =
      "The supervised Rust process was asked to stop. No success claim was recorded."
  }

  public func resetPerformance() {
    performanceTask?.cancel()
    runner.cancel()
    clearPerformanceProof()
    performanceState = .ready
    performanceStatusMessage =
      "Ready to inspect another exact workload before project code executes."
  }

  public func restoreUsageSnapshots() async {
    guard !usageSnapshotsRestored else { return }
    let restoreTask: Task<RestoredUsageSnapshots, Never>
    if let usageSnapshotRestoreTask {
      restoreTask = usageSnapshotRestoreTask
    } else {
      let store = usageSnapshotStore
      let task = Task.detached(priority: .utility) {
        store.restore()
      }
      usageSnapshotRestoreTask = task
      restoreTask = task
    }

    let snapshots = await restoreTask.value
    guard !Task.isCancelled else { return }
    if usageReport == nil, let report = snapshots.usageReport {
      usageReport = report
      usageReportJSON = snapshots.usageReportJSON
      usageLastLoadedAt = snapshots.usageSavedAt
      usageShowingSavedSnapshot = true
      let detected = Set(report.provenance.detectedAgents)
      usageSelectedAgents = detected
    }
    if providerQuotaReceipt == nil, let receipt = snapshots.providerQuota {
      providerQuotaReceipt = receipt
      providerQuotaLastLoadedAt = snapshots.providerQuotaSavedAt
      providerQuotaShowingSavedSnapshot = true
    }
    usageSnapshotsRestored = true
    usageSnapshotRestoreTask = nil
  }

  public func prepareUsage() async {
    await restoreUsageSnapshots()
    let now = Date()
    if usageReport == nil
      || usageReport?.provenance.timezone != usageTimezone
      || needsUsageRefresh(loadedAt: usageLastLoadedAt, now: now, interval: 5 * 60)
    {
      loadUsage()
    }
    if providerQuotaReceipt == nil
      || needsUsageRefresh(loadedAt: providerQuotaLastLoadedAt, now: now, interval: 2 * 60)
    {
      loadProviderQuota()
    }
  }

  public func warmUsage() async {
    await restoreUsageSnapshots()
    if usageReport == nil {
      loadUsage()
    }
    if providerQuotaReceipt == nil {
      loadProviderQuota()
    }
  }

  public func loadUsage(refresh: Bool = false) {
    guard !usageLoading else { return }
    usageLoading = true
    usageIssue = nil
    usageTask = Task { [weak self] in
      guard let self else { return }
      defer {
        usageLoading = false
        usageTask = nil
      }
      do {
        let result = try await runner.runUsage(timezone: usageTimezone, refresh: refresh)
        guard !Task.isCancelled else { return }
        usageReport = result.report
        usageReportJSON = result.rawJSON
        usageLastLoadedAt = Date()
        usageShowingSavedSnapshot = false
        let detected = Set(result.report.provenance.detectedAgents)
        usageSelectedAgents.formIntersection(detected)
        if usageSelectedAgents.isEmpty {
          usageSelectedAgents = detected
        }
        let store = usageSnapshotStore
        let rawJSON = result.rawJSON
        Task.detached(priority: .utility) {
          try? store.saveUsage(rawJSON: rawJSON)
        }
      } catch is CancellationError {
        // Navigation may cancel this bounded read without changing the last accepted report.
      } catch {
        usageIssue = error.localizedDescription
      }
    }
  }

  public func loadProviderQuota() {
    guard !providerQuotaLoading else { return }
    providerQuotaLoading = true
    providerQuotaIssue = nil
    providerQuotaTask = Task { [weak self] in
      guard let self else { return }
      defer {
        providerQuotaLoading = false
        providerQuotaTask = nil
      }
      do {
        let runner = self.runner
        let collection = Task.detached(priority: .utility) {
          try await runner.runProviderQuota()
        }
        let receipt = try await withTaskCancellationHandler {
          try await collection.value
        } onCancel: {
          collection.cancel()
        }
        guard !Task.isCancelled else { return }
        providerQuotaReceipt = receipt
        providerQuotaLastLoadedAt = Date()
        providerQuotaShowingSavedSnapshot = false
        let store = usageSnapshotStore
        Task.detached(priority: .utility) {
          try? store.saveProviderQuota(receipt)
        }
      } catch is CancellationError {
        // Navigation may cancel this bounded read without changing the last accepted receipt.
      } catch {
        providerQuotaIssue = error.localizedDescription
      }
    }
  }

  private func needsUsageRefresh(loadedAt: Date?, now: Date, interval: TimeInterval) -> Bool {
    guard let loadedAt else { return true }
    let age = now.timeIntervalSince(loadedAt)
    return age < 0 || age >= interval
  }

  public func toggleUsageAgent(_ agent: String) {
    if usageSelectedAgents.contains(agent) {
      guard usageSelectedAgents.count > 1 else { return }
      usageSelectedAgents.remove(agent)
    } else {
      usageSelectedAgents.insert(agent)
    }
  }

  func usageProjection(for report: LocalUsageReport) -> UsageViewProjection {
    let key = UsageProjectionCacheKey(
      agents: usageSelectedAgents.sorted().joined(separator: "\u{0}"),
      window: usageWindow.rawValue,
      scale: usageScale.rawValue
    )
    if let cached = usageProjectionCache[key] {
      return cached
    }
    let projection = UsageViewProjection(
      report: report,
      selectedAgents: usageSelectedAgents,
      window: usageWindow,
      scale: usageScale,
      referenceDate: usageProjectionReferenceDate
    )
    if usageProjectionCache.count >= 32 {
      usageProjectionCache.removeAll(keepingCapacity: true)
    }
    usageProjectionCache[key] = projection
    return projection
  }

  public func loadUnpackSnapshots() {
    guard !unpackLoading else { return }
    repositoryQueryWarmTask?.cancel()
    unpackLoading = true
    unpackIssue = nil
    unpackTask = Task { [weak self] in
      guard let self else { return }
      defer {
        unpackLoading = false
        unpackTask = nil
      }
      do {
        let history = try await runner.listUnpackSnapshots(limit: 50)
        unpackSnapshots = history.reports
        let selection =
          selectedUnpackSnapshotID.flatMap { selected in
            history.reports.first(where: { $0.id == selected })?.id
          } ?? history.reports.first?.id
        selectedUnpackSnapshotID = selection
        unpackComparison = nil
        repositoryQueryReceipt = nil
        repositoryQueryDetailReceipt = nil
        repositoryQueryIssue = nil
        repositoryQueryDetailIssue = nil
        repositoryGraphPathOrigin = nil
        if let selection {
          let snapshot = try await runner.inspectUnpackSnapshot(id: selection)
          unpackSnapshot = snapshot
          unpackInventory = try snapshot.decodeInventory()
          unpackReport = try snapshot.decodeReport()
          unpackStatusMessage = "Opened retained snapshot \(String(selection.prefix(8)))."
          warmRepositoryQuery(for: snapshot.repoPath)
        } else {
          unpackSnapshot = nil
          unpackInventory = nil
          unpackReport = nil
          unpackStatusMessage = "No retained Repo Unpack snapshots are available yet."
        }
      } catch {
        unpackIssue = error.localizedDescription
        unpackStatusMessage = "Repo Unpack history is unavailable."
      }
    }
  }

  public func selectUnpackSnapshot(_ id: String) {
    guard id != selectedUnpackSnapshotID || unpackSnapshot?.id != id else { return }
    unpackTask?.cancel()
    repositoryQueryWarmTask?.cancel()
    selectedUnpackSnapshotID = id
    unpackSnapshot = nil
    unpackInventory = nil
    unpackReport = nil
    unpackComparison = nil
    repositoryQueryReceipt = nil
    repositoryQueryDetailReceipt = nil
    repositoryQueryIssue = nil
    repositoryQueryDetailIssue = nil
    repositoryGraphPathOrigin = nil
    unpackLoading = true
    unpackIssue = nil
    unpackTask = Task { [weak self] in
      guard let self else { return }
      defer {
        unpackLoading = false
        unpackTask = nil
      }
      do {
        let snapshot = try await runner.inspectUnpackSnapshot(id: id)
        unpackSnapshot = snapshot
        unpackInventory = try snapshot.decodeInventory()
        unpackReport = try snapshot.decodeReport()
        unpackStatusMessage = "Opened retained snapshot \(String(id.prefix(8)))."
        warmRepositoryQuery(for: snapshot.repoPath)
      } catch {
        unpackIssue = error.localizedDescription
        unpackStatusMessage = "The selected snapshot could not be opened."
      }
    }
  }

  public var repositoryQueryInputIssue: String? {
    guard unpackSnapshot != nil else { return "Select a stored repository snapshot first." }
    let query = repositoryQueryText.trimmingCharacters(in: .whitespacesAndNewlines)
    if query.isEmpty { return "Describe the structure or history evidence to find." }
    if query.utf8.count > 4_096 || query.contains(where: { $0.isNewline || $0 == "\0" }) {
      return "Repository queries must be one bounded line."
    }
    return nil
  }

  public var canQueryRepositoryEvidence: Bool {
    repositoryQueryInputIssue == nil && !isBusy
  }

  public func queryRepositoryEvidence() {
    guard canQueryRepositoryEvidence, let snapshot = unpackSnapshot else {
      repositoryQueryIssue = repositoryQueryInputIssue
      return
    }
    repositoryQueryTask?.cancel()
    repositoryQueryLoading = true
    repositoryQueryIssue = nil
    repositoryQueryReceipt = nil
    repositoryQueryDetailReceipt = nil
    repositoryQueryDetailIssue = nil
    repositoryGraphPathOrigin = nil
    let domain = repositoryQueryDomain
    let query = repositoryQueryText
    unpackStatusMessage = "Querying canonical \(domain.label.lowercased()) evidence read-only…"
    repositoryQueryTask = Task { [weak self] in
      guard let self else { return }
      defer {
        repositoryQueryLoading = false
        repositoryQueryTask = nil
      }
      do {
        let receipt = try await runner.queryRepositoryEvidence(
          repositoryPath: snapshot.repoPath,
          domain: domain,
          query: query,
          limit: 40
        )
        repositoryQueryReceipt = receipt
        if receipt.status == "ready" {
          unpackStatusMessage =
            "Found \(receipt.resultCount) \(domain.label.lowercased()) evidence records with canonical freshness attached."
        } else {
          unpackStatusMessage = receipt.issue ?? "Canonical repository evidence is unavailable."
        }
      } catch is CancellationError {
        unpackStatusMessage = "Repository query cancelled."
      } catch {
        repositoryQueryIssue = error.localizedDescription
        unpackStatusMessage = "Repository query failed without accepting a receipt."
      }
    }
  }

  public func explainRepositoryGraphNode(_ node: RepositoryGraphQueryNode) {
    runRepositoryQueryDetail(
      domain: .graph,
      mode: .explain,
      query: node.id,
      status: "Reading canonical relationships for \(node.label)…"
    )
  }

  public func queryRepositoryImpact(_ node: RepositoryGraphQueryNode) {
    let depth = min(max(repositoryImpactDepth, 1), 12)
    runRepositoryQueryDetail(
      domain: .graph,
      mode: .impact,
      query: node.id,
      direction: repositoryImpactDirection,
      depth: depth,
      status: "Tracing bounded \(repositoryImpactDirection.rawValue) impact from \(node.label)…"
    )
  }

  public func setRepositoryGraphPathOrigin(_ node: RepositoryGraphQueryNode) {
    repositoryGraphPathOrigin = node
    repositoryQueryDetailIssue = nil
    unpackStatusMessage = "Path origin set to \(node.label). Choose another structural match."
  }

  public func queryRepositoryPath(to node: RepositoryGraphQueryNode) {
    guard let origin = repositoryGraphPathOrigin else {
      setRepositoryGraphPathOrigin(node)
      return
    }
    guard origin.id != node.id else {
      repositoryQueryDetailIssue = "Choose a different destination node for the path."
      return
    }
    runRepositoryQueryDetail(
      domain: .graph,
      mode: .path,
      query: origin.id,
      target: node.id,
      status: "Finding the bounded directed path from \(origin.label) to \(node.label)…"
    )
  }

  public func traceRepositoryHistory(_ item: RepositoryHistorySearchItem) {
    let selector: RepositoryHistorySelectorKind
    let value: String
    switch item.kind {
    case "event":
      selector = .event
      value = item.id
    case "entity":
      selector = .entity
      value = item.id
    case "commit":
      selector = .revision
      value = item.revision ?? item.id
    case "release":
      selector = .release
      value = item.label
    default:
      repositoryQueryDetailIssue =
        "Causal traces are available for indexed events, entities, commits, and releases."
      return
    }
    runRepositoryQueryDetail(
      domain: .history,
      mode: .trace,
      query: value,
      historySelector: selector,
      status: "Tracing evidence-qualified history around \(item.label)…"
    )
  }

  private func runRepositoryQueryDetail(
    domain: RepositoryQueryDomain,
    mode: RepositoryQueryMode,
    query: String,
    target: String? = nil,
    direction: RepositoryGraphDirection? = nil,
    depth: Int? = nil,
    historySelector: RepositoryHistorySelectorKind? = nil,
    status: String
  ) {
    guard let snapshot = unpackSnapshot, !repositoryQueryLoading else { return }
    repositoryQueryDetailTask?.cancel()
    repositoryQueryDetailLoading = true
    repositoryQueryDetailIssue = nil
    repositoryQueryDetailReceipt = nil
    unpackStatusMessage = status
    repositoryQueryDetailTask = Task { [weak self] in
      guard let self else { return }
      defer {
        repositoryQueryDetailLoading = false
        repositoryQueryDetailTask = nil
      }
      do {
        let receipt = try await runner.queryRepositoryEvidence(
          repositoryPath: snapshot.repoPath,
          domain: domain,
          query: query,
          mode: mode,
          target: target,
          direction: direction,
          depth: depth,
          historySelector: historySelector,
          limit: 40
        )
        repositoryQueryDetailReceipt = receipt
        unpackStatusMessage =
          receipt.status == "ready"
          ? "Opened \(mode.rawValue) evidence with canonical freshness attached."
          : receipt.issue ?? "Canonical repository evidence is unavailable."
      } catch is CancellationError {
        unpackStatusMessage = "Repository evidence detail cancelled."
      } catch {
        repositoryQueryDetailIssue = error.localizedDescription
        unpackStatusMessage = "Repository evidence detail failed without accepting a receipt."
      }
    }
  }

  private func warmRepositoryQuery(for repositoryPath: String) {
    repositoryQueryWarmTask?.cancel()
    repositoryQueryWarmTask = Task { [weak self] in
      guard let self else { return }
      do {
        _ = try await runner.prepareRepositoryQuery(repositoryPath: repositoryPath)
      } catch is CancellationError {
        // Snapshot selection changed before the read-only index was prepared.
      } catch {
        // Preparation is an advisory latency optimization. The visible query
        // path retains the supervised one-shot fallback and reports its errors.
      }
    }
  }

  public var unpackScanInputIssue: String? {
    let path = repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
    if path.isEmpty { return "Choose the repository to scan." }
    if path.count > 4_096 || path.contains(where: { $0.isNewline || $0 == "\0" }) {
      return "Repository paths must be one bounded line."
    }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      return "The selected repository directory is unavailable."
    }
    return nil
  }

  public var canScanUnpackRepository: Bool {
    unpackScanInputIssue == nil && !isBusy
  }

  public func scanUnpackRepository() {
    guard canScanUnpackRepository else {
      unpackIssue = unpackScanInputIssue
      return
    }
    unpackTask?.cancel()
    unpackLoading = true
    unpackIssue = nil
    unpackStatusMessage =
      "Rust is walking source, graph, history, and deterministic health evidence…"
    let path = repositoryPath
    unpackTask = Task { [weak self] in
      guard let self else { return }
      defer {
        unpackLoading = false
        unpackTask = nil
      }
      do {
        let receipt = try await runner.scanUnpackRepository(repositoryPath: path)
        let history = try await runner.listUnpackSnapshots(repositoryPath: path, limit: 50)
        unpackSnapshots = history.reports
        selectedUnpackSnapshotID = receipt.reportID
        let snapshot = try await runner.inspectUnpackSnapshot(id: receipt.reportID)
        unpackSnapshot = snapshot
        unpackInventory = try snapshot.decodeInventory()
        unpackReport = try snapshot.decodeReport()
        unpackComparison = nil
        repositoryQueryReceipt = nil
        repositoryQueryDetailReceipt = nil
        repositoryQueryIssue = nil
        repositoryQueryDetailIssue = nil
        repositoryGraphPathOrigin = nil
        unpackStatusMessage =
          "Saved \(receipt.inventory.filesScanned) files with \(receipt.inventory.graph.nodes.count) bounded graph nodes."
        warmRepositoryQuery(for: snapshot.repoPath)
      } catch is CancellationError {
        unpackStatusMessage = "Repository scan cancelled before a receipt was accepted."
      } catch {
        unpackIssue = error.localizedDescription
        unpackStatusMessage = "Repository scan failed without accepting a success receipt."
      }
    }
  }

  public func cancelUnpackOperation() {
    unpackTask?.cancel()
    repositoryQueryWarmTask?.cancel()
    repositoryQueryTask?.cancel()
    repositoryQueryDetailTask?.cancel()
    runner.cancel()
  }

  public var unpackComparisonCandidate: UnpackSnapshotSummary? {
    guard let selectedID = selectedUnpackSnapshotID,
      let selectedIndex = unpackSnapshots.firstIndex(where: { $0.id == selectedID })
    else { return nil }
    let selected = unpackSnapshots[selectedIndex]
    guard let selectedCommit = selected.commitSHA else { return nil }
    return unpackSnapshots.dropFirst(selectedIndex + 1).first { candidate in
      candidate.repoPath == selected.repoPath
        && candidate.commitSHA != nil
        && candidate.commitSHA != selectedCommit
    }
  }

  public var canCompareUnpackSnapshot: Bool {
    unpackSnapshot?.commitSHA != nil && unpackComparisonCandidate != nil && !isBusy
  }

  public func compareUnpackWithPrevious() {
    guard canCompareUnpackSnapshot,
      let current = unpackSnapshot,
      let headCommit = current.commitSHA,
      let prior = unpackComparisonCandidate,
      let baseCommit = prior.commitSHA
    else {
      unpackIssue = "A prior snapshot with a different recorded commit is required."
      return
    }
    unpackTask?.cancel()
    unpackLoading = true
    unpackIssue = nil
    unpackStatusMessage =
      "Comparing \(String(baseCommit.prefix(7))) → \(String(headCommit.prefix(7))) through bounded Git evidence…"
    unpackTask = Task { [weak self] in
      guard let self else { return }
      defer {
        unpackLoading = false
        unpackTask = nil
      }
      do {
        unpackComparison = try await runner.compareUnpackSnapshots(
          repositoryPath: current.repoPath,
          baseCommit: baseCommit,
          headCommit: headCommit
        )
        unpackStatusMessage =
          "Compared \(unpackComparison?.commitCount ?? 0) commits without changing either snapshot."
      } catch is CancellationError {
        unpackStatusMessage = "Snapshot comparison cancelled."
      } catch {
        unpackIssue = error.localizedDescription
        unpackStatusMessage = "Snapshot comparison failed closed."
      }
    }
  }

  public func exportUnpackSnapshot(_ format: UnpackExportFormat, to destination: URL) {
    guard let snapshot = unpackSnapshot, destination.isFileURL, !isBusy else {
      unpackIssue = "Select one stored snapshot and a local export destination."
      return
    }
    unpackTask?.cancel()
    unpackLoading = true
    unpackIssue = nil
    unpackStatusMessage = "Rendering \(format.label) from the canonical local snapshot…"
    unpackTask = Task { [weak self] in
      guard let self else { return }
      defer {
        unpackLoading = false
        unpackTask = nil
      }
      do {
        let receipt = try await runner.exportUnpackSnapshot(id: snapshot.id, format: format)
        try "\(receipt.content)\n".write(to: destination, atomically: true, encoding: .utf8)
        unpackStatusMessage = "Saved \(format.label) to \(destination.lastPathComponent)."
      } catch is CancellationError {
        unpackStatusMessage = "Snapshot export cancelled before a file was accepted."
      } catch {
        unpackIssue = error.localizedDescription
        unpackStatusMessage = "Snapshot export failed without changing the stored evidence."
      }
    }
  }

  public func loadNativeSettings() {
    guard !settingsLoading else { return }
    settingsLoading = true
    settingsIssue = nil
    settingsTask = Task { [weak self] in
      guard let self else { return }
      defer {
        settingsLoading = false
        settingsTask = nil
      }
      do {
        settingsReceipt = try await runner.loadNativeSettings()
      } catch {
        settingsIssue = error.localizedDescription
      }
    }
  }

  public func loadOpsStatus(windowDays: Int? = nil) {
    guard !opsLoading else { return }
    let selectedWindow = windowDays ?? opsWindowDays
    guard [7, 30, 90].contains(selectedWindow) else {
      opsIssue = "Ops evidence supports only 7, 30, or 90 day windows."
      return
    }
    opsWindowDays = selectedWindow
    opsLoading = true
    opsIssue = nil
    opsTask = Task { [weak self] in
      guard let self else { return }
      defer {
        opsLoading = false
        opsTask = nil
      }
      do {
        opsReceipt = try await runner.loadOpsStatus(windowDays: selectedWindow)
      } catch {
        opsIssue = error.localizedDescription
      }
    }
  }

  public func loadOnboarding() {
    guard onboardingReceipt == nil, !onboardingLoading else { return }
    onboardingLoading = true
    onboardingIssue = nil
    onboardingTask = Task { [weak self] in
      guard let self else { return }
      defer {
        onboardingLoading = false
        onboardingTask = nil
      }
      do {
        let receipt = try await runner.loadOnboarding()
        onboardingReceipt = receipt
        onboardingDefaultAdapter = receipt.defaultAdapter
        onboardingPresented = !receipt.completed
      } catch {
        onboardingIssue = error.localizedDescription
      }
    }
  }

  public func presentOnboarding() {
    onboardingStep = 0
    onboardingIssue = nil
    onboardingPresented = true
  }

  public func dismissOnboarding() {
    guard !onboardingLoading else { return }
    onboardingPresented = false
  }

  public func completeNativeOnboarding() {
    guard !onboardingLoading else { return }
    onboardingLoading = true
    onboardingIssue = nil
    let adapter = onboardingDefaultAdapter
    onboardingTask = Task { [weak self] in
      guard let self else { return }
      defer {
        onboardingLoading = false
        onboardingTask = nil
      }
      do {
        let receipt = try await runner.completeOnboarding(defaultAdapter: adapter)
        onboardingReceipt = receipt
        onboardingDefaultAdapter = receipt.defaultAdapter
        onboardingPresented = !receipt.completed
        settingsReceipt = nil
      } catch {
        onboardingIssue = error.localizedDescription
      }
    }
  }

  public func saveNativeSetting(key: String, value: String) {
    guard !settingsSavingKeys.contains(key) else { return }
    settingsSavingKeys.insert(key)
    settingsIssue = nil
    Task { [weak self] in
      guard let self else { return }
      defer { settingsSavingKeys.remove(key) }
      do {
        let receipt = try await runner.saveNativeSetting(key: key, value: value)
        guard receipt.savedKey == key else {
          throw VerificationRunnerError.invalidReceipt(
            "The settings receipt did not confirm \(key).")
        }
        settingsReceipt = receipt
      } catch {
        settingsIssue = error.localizedDescription
      }
    }
  }

  public func loadHistoryRoots() {
    runHistoryRoots(operation: .read)
  }

  public func addHistoryRoot(_ url: URL) {
    runHistoryRoots(operation: .add, path: url.path)
  }

  public func removeHistoryRoot(path: String) {
    runHistoryRoots(operation: .remove, path: path)
  }

  private func runHistoryRoots(operation: HistoryRootsOperation, path: String? = nil) {
    guard !historyRootsLoading else { return }
    historyRootsLoading = true
    historyRootsIssue = nil
    historyRootsTask = Task { [weak self] in
      guard let self else { return }
      defer {
        historyRootsLoading = false
        historyRootsTask = nil
      }
      do {
        let receipt: HistoryRootsReceipt
        switch operation {
        case .read:
          receipt = try await runner.loadHistoryRoots()
        case .add:
          guard let path else {
            throw VerificationRunnerError.invalidReceipt("A selected history root is required.")
          }
          receipt = try await runner.addHistoryRoot(path: path)
        case .remove:
          guard let path else {
            throw VerificationRunnerError.invalidReceipt("A stored history root is required.")
          }
          receipt = try await runner.removeHistoryRoot(path: path)
        }
        historyRootsReceipt = receipt
      } catch {
        historyRootsIssue = error.localizedDescription
      }
    }
  }

  public func loadMcpSettings() {
    runMcpSettings(operation: .read)
  }

  public func previewSessionRetention(maxAgeDays: Int?, maxArchiveMiB: Int?) {
    runSessionRetention(
      operation: .plan,
      maxAgeDays: maxAgeDays,
      maxArchiveMiB: maxArchiveMiB
    )
  }

  public func applyReviewedRetentionPlan() {
    guard let planID = retentionReceipt?.plan?.id else {
      retentionIssue = "Preview cleanup and review its exact plan before applying it."
      return
    }
    runSessionRetention(operation: .apply, planID: planID)
  }

  public func checkpointSessionArchive(vacuum: Bool) {
    runSessionRetention(operation: .checkpoint, vacuum: vacuum)
  }

  public func clearRetentionPreview() {
    if retentionReceipt?.operation == .plan { retentionReceipt = nil }
  }

  private func runSessionRetention(
    operation: SessionRetentionOperation,
    maxAgeDays: Int? = nil,
    maxArchiveMiB: Int? = nil,
    planID: String? = nil,
    vacuum: Bool = false
  ) {
    guard !retentionLoading else { return }
    retentionLoading = true
    retentionIssue = nil
    retentionTask = Task { [weak self] in
      guard let self else { return }
      defer {
        retentionLoading = false
        retentionTask = nil
      }
      do {
        retentionReceipt = try await runner.runSessionRetention(
          operation: operation,
          maxAgeDays: maxAgeDays,
          maxArchiveMiB: maxArchiveMiB,
          planID: planID,
          vacuum: vacuum
        )
      } catch {
        retentionIssue = error.localizedDescription
      }
    }
  }

  public func loadRubrics() {
    runRubricSettings(operation: .read)
  }

  public func selectRubricPack(_ id: String) {
    runRubricSettings(operation: .select, packID: id)
  }

  public func saveRubricPack(_ pack: RubricPackInput) {
    runRubricSettings(operation: .upsert, pack: pack)
  }

  private func runRubricSettings(
    operation: RubricSettingsOperation,
    packID: String? = nil,
    pack: RubricPackInput? = nil
  ) {
    guard !rubricLoading else { return }
    rubricLoading = true
    rubricIssue = nil
    rubricTask = Task { [weak self] in
      guard let self else { return }
      defer {
        rubricLoading = false
        rubricTask = nil
      }
      do {
        rubricReceipt = try await runner.runRubricSettings(
          operation: operation,
          packID: packID,
          pack: pack
        )
      } catch {
        rubricIssue = error.localizedDescription
      }
    }
  }

  public func loadMemories() {
    guard !memoryLoading else { return }
    memoryLoading = true
    memoryIssue = nil
    memoryTask = Task { [weak self] in
      guard let self else { return }
      defer {
        memoryLoading = false
        memoryTask = nil
      }
      do {
        let listed = try await runner.runMemories()
        memoryReceipt = listed
        let selected =
          listed.sources.first(where: {
            $0.id == selectedMemorySourceID && $0.readable
          }) ?? listed.sources.first(where: \.readable)
        guard let selected else {
          selectedMemorySourceID = nil
          memoryDocument = nil
          memoryDiff = nil
          return
        }
        selectedMemorySourceID = selected.id
        let read = try await runner.runMemories(operation: .read, sourceID: selected.id)
        memoryReceipt = read
        memoryDocument = read.document
        memoryDiff = nil
      } catch {
        memoryIssue = error.localizedDescription
      }
    }
  }

  public func selectMemorySource(_ id: String) {
    runMemoryOperation(.read, sourceID: id)
  }

  public func loadSelectedMemoryDiff() {
    guard let selectedMemorySourceID else {
      memoryIssue = "Select one readable memory source before requesting its diff."
      return
    }
    runMemoryOperation(.diff, sourceID: selectedMemorySourceID)
  }

  public func showSelectedMemoryDocument() {
    guard let selectedMemorySourceID else { return }
    runMemoryOperation(.read, sourceID: selectedMemorySourceID)
  }

  private func runMemoryOperation(_ operation: MemoryReceiptOperation, sourceID: String) {
    guard !memoryLoading else { return }
    memoryLoading = true
    memoryIssue = nil
    memoryTask = Task { [weak self] in
      guard let self else { return }
      defer {
        memoryLoading = false
        memoryTask = nil
      }
      do {
        let receipt = try await runner.runMemories(operation: operation, sourceID: sourceID)
        memoryReceipt = receipt
        selectedMemorySourceID = sourceID
        if let document = receipt.document {
          memoryDocument = document
          memoryDiff = nil
        }
        if let diff = receipt.diff { memoryDiff = diff }
      } catch {
        memoryIssue = error.localizedDescription
      }
    }
  }

  public func runMcpSettings(operation: McpSettingsOperation) {
    guard !mcpLoading else { return }
    let repoPath = repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !repoPath.isEmpty else {
      mcpIssue = "Choose the repository whose local MCP authority you want to inspect."
      return
    }
    mcpLoading = true
    mcpIssue = nil
    mcpTask = Task { [weak self] in
      guard let self else { return }
      defer {
        mcpLoading = false
        mcpTask = nil
      }
      do {
        mcpSettingsReceipt = try await runner.runMcpSettings(
          repositoryPath: repoPath,
          operation: operation
        )
      } catch {
        mcpIssue = error.localizedDescription
      }
    }
  }

  public func loadRuns() {
    guard !runsLoading else { return }
    runsLoading = true
    runsIssue = nil
    runsTask = Task { [weak self] in
      guard let self else { return }
      defer {
        runsLoading = false
        runsTask = nil
      }
      do {
        let loaded = try await runner.listRuns(
          repositoryPath: runLedgerScope == .currentRepository ? repositoryPath : nil,
          limit: 50
        )
        runs = loaded
        if selectedRunID == nil || !loaded.contains(where: { $0.id == selectedRunID }) {
          selectedRunID = loaded.first?.id
        }
      } catch {
        runsIssue = error.localizedDescription
      }
    }
  }

  public var selectedRun: StoredVerificationRun? {
    runs.first { $0.id == selectedRunID }
  }

  public var selectedRunPosition: String? {
    guard let index = runs.firstIndex(where: { $0.id == selectedRunID }) else { return nil }
    return "\(index + 1) of \(runs.count)"
  }

  public func moveRunSelection(by offset: Int) {
    guard !runs.isEmpty else { return }
    let current = runs.firstIndex(where: { $0.id == selectedRunID }) ?? 0
    let destination = min(max(current + offset, 0), runs.count - 1)
    selectedRunID = runs[destination].id
  }

  public var canFilterRunsByRepository: Bool {
    !repositoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  public var runLedgerScopeLabel: String {
    guard runLedgerScope == .currentRepository, canFilterRunsByRepository else {
      return "All repositories"
    }
    return URL(fileURLWithPath: repositoryPath).lastPathComponent
  }

  public func setRunLedgerScope(_ scope: RunLedgerScope) {
    guard scope != .currentRepository || canFilterRunsByRepository else { return }
    guard runLedgerScope != scope else { return }
    runLedgerScope = scope
    selectedRunID = nil
    runs = []
    loadRuns()
  }

  private func start(preflight: Bool) {
    guard preflight ? canStart : canExecuteReview else { return }
    let inputFingerprint = reviewInputFingerprint
    if preflight {
      clearProof()
    } else {
      receipt = nil
      receiptJSON = ""
      clearXray()
    }
    verificationState = preflight ? .planning : .running
    statusMessage =
      preflight
      ? "Resolving source identity and verification targets…"
      : "The Rust engine is executing the planned checks…"
    let requestID = UUID().uuidString.lowercased()
    activeReviewRequestID = requestID
    let request = VerificationRequest(
      requestID: requestID,
      repositoryPath: repositoryPath,
      change: change,
      task: task,
      reviewAgent: reviewAgent,
      specPaths: specPaths,
      selectedRequirementIDs: selectedRequirementIDs.sorted()
    )
    runTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if activeReviewRequestID == requestID { activeReviewRequestID = nil }
        runTask = nil
      }
      do {
        let result = try await runner.run(request, preflight: preflight) { progress in
          Task { @MainActor in
            let stage = progress.stage.replacingOccurrences(of: "_", with: " ").capitalized
            self.statusMessage = "\(stage): \(progress.state)."
          }
        }
        guard !Task.isCancelled else { return }
        if preflight {
          preflightReceipt = result.receipt
          preflightReceiptJSON = result.rawJSON
          reviewPlanFingerprint = inputFingerprint
          if let coverage = result.receipt.specCoverage {
            let known = Set(coverage.requirements.map(\.id))
            selectedRequirementIDs.formIntersection(known)
          }
        } else {
          receipt = result.receipt
          receiptJSON = result.rawJSON
          let stored = StoredVerificationRun(localCheck: result.receipt, rawJSON: result.rawJSON)
          runs.removeAll { $0.id == stored.id }
          runs.insert(stored, at: 0)
          selectedRunID = stored.id
        }
        let outcome = result.receipt.status ?? result.receipt.verdict ?? "completed"
        verificationState =
          result.processStatus == 0
          ? (preflight ? .planned : .completed)
          : .limited
        statusMessage = "Rust receipt: \(outcome.replacingOccurrences(of: "_", with: " "))."
      } catch is CancellationError {
        verificationState = .cancelled
      } catch {
        if Task.isCancelled {
          verificationState = .cancelled
        } else {
          verificationState = .failed
          statusMessage = error.localizedDescription
        }
      }
    }
  }

  private func clearProof() {
    preflightReceipt = nil
    preflightReceiptJSON = ""
    receipt = nil
    receiptJSON = ""
    reviewPlanFingerprint = nil
    clearXray()
  }

  private func clearXray() {
    xrayTask?.cancel()
    xrayPublicSource = ""
    xrayPublicConfirmed = false
    xrayApprovedExcerptFindingIDs = []
    xrayResult = nil
    xrayIssue = nil
    xraySavedPath = nil
    xrayPreviewFingerprint = nil
    clearFixPacket()
  }

  private func clearFixPacket() {
    fixPacketTask?.cancel()
    fixPacketSelectedFindingIDs = []
    fixPacketReceipt = nil
    fixPacketIssue = nil
    resetFixAttempt()
  }

  private func resetFixAttempt() {
    fixAttemptTask?.cancel()
    fixAttemptConfirmed = false
    fixAttemptDiscardConfirmed = false
    fixAttemptReceipt = nil
    fixAttemptIssue = nil
  }

  private func clearTestingProof() {
    testingReceipt = nil
    testingReceiptJSON = ""
    resetWarmVerification()
    resetDifferentialVerification()
    scenarioTask?.cancel()
    scenarioCandidates = []
    selectedScenarioCandidateID = nil
    selectedScenarioDestinations = []
    scenarioIssue = nil
    scenarioState = .ready
  }

  private func resetTrexWatcherProjection() {
    trexWatcherTask?.cancel()
    trexWatcherScheduleTask?.cancel()
    trexWatcherTask = nil
    trexWatcherScheduleTask = nil
    trexWatchers = []
    trexWatcherRuns = []
    trexWatcherSessionConfirmed = false
    trexWatcherIssue = nil
    trexWatcherReceiptJSON = ""
    trexWatcherState = .ready
    trexWatcherStatusMessage =
      "Load the saved watcher configuration. Polling always requires consent for this app session."
  }

  private func warmSummary(_ result: WarmVerificationResult) -> String {
    let passed = result.scenarios.filter { $0.outcome == .passed }.count
    switch result.outcome {
    case .passed:
      return "Warm verification passed \(passed)/\(result.scenarios.count) selected scenarios."
    case .regression:
      return "Warm verification recorded a reproducible regression in the changed scope."
    case .noConfidence:
      return "Warm verification completed without enough evidence for a pass claim."
    }
  }

  private func clearScopeDiscovery() {
    testingScopeTask?.cancel()
    performanceScopeTask?.cancel()
    testingScopePlan = nil
    testingScopeIssue = nil
    selectedTestingScopeCandidateID = nil
    performanceDiscoveryPlan = nil
    performanceScopeIssue = nil
  }

  private func scopeInputIssue(kind: EvidenceScopeKind, value: String) -> String? {
    if kind == .codebase { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return kind == .flow
        ? "Describe the user flow to discover runnable evidence targets."
        : "Enter an exact Git range or pull request URL."
    }
    if trimmed.count > 512 || trimmed.contains(where: { $0.isNewline || $0 == "\0" }) {
      return "Scope input must be one bounded line of at most 512 characters."
    }
    return nil
  }

  private var testingScopeRequestValue: String {
    testingScopeKind == .change ? testingChange : testingScopeValue
  }

  private func startPerformance(_ operation: PerformanceOperation) {
    switch operation {
    case .plan:
      guard canPlanPerformance else { return }
      clearPerformanceProof()
    case .diagnose:
      guard canDiagnosePerformance else { return }
      performanceResultReceipt = nil
      performanceResultReceiptJSON = ""
    case .verifyPaired:
      guard canVerifyPairedPerformance else { return }
    case .inspect:
      guard canInspectPerformanceRun else { return }
      clearPerformanceProof()
    }

    let scopeFingerprint = performanceScopeFingerprint
    performanceState = operation == .plan ? .planning : .running
    performanceStatusMessage =
      switch operation {
      case .plan:
        "Rust is inspecting source identity and the zero-egress execution boundary…"
      case .diagnose:
        "Rust is capturing the admitted workload and attributing observed evidence…"
      case .verifyPaired:
        "Rust is comparing the candidate and baseline under the identical bounded scope…"
      case .inspect:
        "Rust is inspecting the recorded performance receipt…"
      }
    let request = PerformanceRunRequest(
      requestID: "perf-\(UUID().uuidString.lowercased())",
      operation: operation,
      repositoryPath: repositoryPath,
      adapter: operation == .inspect ? nil : performanceAdapter,
      target: operation == .inspect
        ? nil : performanceTarget.trimmingCharacters(in: .whitespacesAndNewlines),
      name: operation == .inspect
        ? nil : performanceName.trimmingCharacters(in: .whitespacesAndNewlines),
      samples: operation == .inspect ? nil : performanceSamples,
      warmups: operation == .inspect ? nil : performanceWarmups,
      timeoutMS: operation == .inspect ? nil : performanceTimeoutMS,
      subjectRunID: operation == .inspect
        ? performanceRecordedRunID.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
      baselineRepositoryPath: operation == .verifyPaired
        ? performanceBaselineRepositoryPath.trimmingCharacters(in: .whitespacesAndNewlines) : nil
    )
    performanceTask = Task { [weak self] in
      guard let self else { return }
      defer { performanceTask = nil }
      do {
        let result = try await runner.runPerformance(request)
        guard !Task.isCancelled else { return }
        if operation == .plan {
          performancePlanReceipt = result.receipt
          performancePlanReceiptJSON = result.rawJSON
          performancePlanScopeFingerprint = scopeFingerprint
          performanceState = result.receipt.admitted ? .planned : .limited
        } else {
          performanceResultReceipt = result.receipt
          performanceResultReceiptJSON = result.rawJSON
          performanceState =
            switch result.receipt.state {
            case .succeeded: .completed
            case .completedWithRejection: .failed
            case .noConfidence: .limited
            case .cancelled: .cancelled
            }
        }
        performanceStatusMessage = result.receipt.summary
      } catch is CancellationError {
        performanceState = .cancelled
        performanceStatusMessage =
          "The supervised Rust process was stopped. No successful performance receipt was accepted."
      } catch {
        if Task.isCancelled {
          performanceState = .cancelled
        } else {
          performanceState = .failed
          performanceStatusMessage = error.localizedDescription
        }
      }
    }
  }

  private func clearPerformanceProof() {
    performancePlanReceipt = nil
    performancePlanReceiptJSON = ""
    performanceResultReceipt = nil
    performanceResultReceiptJSON = ""
    performancePlanScopeFingerprint = nil
  }
}
