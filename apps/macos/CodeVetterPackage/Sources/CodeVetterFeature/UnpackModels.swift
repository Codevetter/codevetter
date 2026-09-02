import Foundation

public struct UnpackSnapshotSummary: Codable, Identifiable, Sendable {
  public let id: String
  public let repoPath: String
  public let repoName: String
  public let commitSHA: String?
  public let status: String
  public let errorMessage: String?
  public let agentUsed: String?
  public let modelUsed: String?
  public let filesScanned: Int
  public let filesSkipped: Int
  public let runtimeMS: Int?
  public let costUSD: Double?
  public let startedAt: String?
  public let completedAt: String?
  public let createdAt: String
  public let analysisReady: Bool

  enum CodingKeys: String, CodingKey {
    case id, status
    case repoPath = "repo_path"
    case repoName = "repo_name"
    case commitSHA = "commit_sha"
    case errorMessage = "error_message"
    case agentUsed = "agent_used"
    case modelUsed = "model_used"
    case filesScanned = "files_scanned"
    case filesSkipped = "files_skipped"
    case runtimeMS = "runtime_ms"
    case costUSD = "cost_usd"
    case startedAt = "started_at"
    case completedAt = "completed_at"
    case createdAt = "created_at"
    case analysisReady = "analysis_ready"
  }
}

public struct UnpackHistoryReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let databaseAvailable: Bool
  public let repoPath: String?
  public let limit: Int
  public let returned: Int
  public let reports: [UnpackSnapshotSummary]

  enum CodingKeys: String, CodingKey {
    case limit, returned, reports
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case databaseAvailable = "database_available"
    case repoPath = "repo_path"
  }
}

public struct UnpackSnapshotRecord: Codable, Identifiable, Sendable {
  public let id: String
  public let repoPath: String
  public let repoName: String
  public let commitSHA: String?
  public let status: String
  public let errorMessage: String?
  public let agentUsed: String?
  public let modelUsed: String?
  public let filesScanned: Int
  public let filesSkipped: Int
  public let runtimeMS: Int?
  public let costUSD: Double?
  public let startedAt: String?
  public let completedAt: String?
  public let createdAt: String
  public let analysisReady: Bool
  public let inventoryJSON: String?
  public let reportJSON: String?
  public let bytesScanned: Int

  enum CodingKeys: String, CodingKey {
    case id, status
    case repoPath = "repo_path"
    case repoName = "repo_name"
    case commitSHA = "commit_sha"
    case errorMessage = "error_message"
    case agentUsed = "agent_used"
    case modelUsed = "model_used"
    case filesScanned = "files_scanned"
    case filesSkipped = "files_skipped"
    case runtimeMS = "runtime_ms"
    case costUSD = "cost_usd"
    case startedAt = "started_at"
    case completedAt = "completed_at"
    case createdAt = "created_at"
    case analysisReady = "analysis_ready"
    case inventoryJSON = "inventory_json"
    case reportJSON = "report_json"
    case bytesScanned = "bytes_scanned"
  }

  public func decodeInventory() throws -> UnpackInventory? {
    guard let inventoryJSON else { return nil }
    return try JSONDecoder().decode(UnpackInventory.self, from: Data(inventoryJSON.utf8))
  }

  public func decodeReport() throws -> UnpackReport? {
    guard let reportJSON else { return nil }
    return try JSONDecoder().decode(UnpackReport.self, from: Data(reportJSON.utf8))
  }
}

public struct UnpackScanProfileStep: Codable, Identifiable, Sendable {
  public let id: String
  public let label: String
  public let ms: UInt64
  public let pct: Double
}

public struct UnpackScanProfile: Codable, Identifiable, Sendable {
  public let stage: String
  public let totalMS: UInt64
  public let peakRSSBytes: UInt64?
  public let steps: [UnpackScanProfileStep]
  public var id: String { stage }

  enum CodingKeys: String, CodingKey {
    case stage, steps
    case totalMS = "total_ms"
    case peakRSSBytes = "peak_rss_bytes"
  }
}

public struct UnpackScanReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let reportID: String
  public let status: String
  public let createdAt: String
  public let inventory: UnpackInventory
  public let profiles: [UnpackScanProfile]

  enum CodingKeys: String, CodingKey {
    case status, inventory, profiles
    case schemaVersion = "schema_version"
    case reportID = "report_id"
    case createdAt = "created_at"
  }
}

public enum RepositoryQueryDomain: String, Codable, CaseIterable, Identifiable, Sendable {
  case graph
  case history

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .graph: "Structure"
    case .history: "History"
    }
  }
}

public enum RepositoryQueryMode: String, Codable, Sendable {
  case search
  case explain
  case impact
  case path
  case trace
}

public enum RepositoryGraphDirection: String, Codable, CaseIterable, Identifiable, Sendable {
  case incoming
  case outgoing
  case both

  public var id: String { rawValue }
}

public enum RepositoryHistorySelectorKind: String, Codable, Sendable {
  case event
  case entity
  case revision
  case release
  case episode
}

public struct RepositoryQueryReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let authority: String
  public let repoPath: String
  public let query: String
  public let domain: RepositoryQueryDomain
  public let mode: RepositoryQueryMode
  public let target: String?
  public let direction: RepositoryGraphDirection?
  public let depth: Int?
  public let historySelector: RepositoryHistorySelectorKind?
  public let limit: Int
  public let status: String
  public let issue: String?
  public let graphStatus: RepositoryGraphStatus
  public let historyStatus: RepositoryHistoryStatus
  public let graphResult: RepositoryGraphSearchResult?
  public let graphExplanation: RepositoryGraphExplanation?
  public let graphImpact: RepositoryGraphImpactResult?
  public let graphPath: RepositoryGraphPathResult?
  public let historyResult: RepositoryHistorySearchResult?
  public let historyTrace: RepositoryHistoryTrace?

  public var resultCount: Int {
    graphResult?.hits.count
      ?? graphImpact?.affected.count
      ?? graphPath?.nodes.count
      ?? historyResult?.items.count
      ?? historyTrace?.episodes.count
      ?? (graphExplanation == nil ? 0 : 1)
  }

  enum CodingKeys: String, CodingKey {
    case authority, query, domain, mode, target, direction, depth, limit, status, issue
    case schemaVersion = "schema_version"
    case repoPath = "repo_path"
    case historySelector = "history_selector"
    case graphStatus = "graph_status"
    case historyStatus = "history_status"
    case graphResult = "graph_result"
    case graphExplanation = "graph_explanation"
    case graphImpact = "graph_impact"
    case graphPath = "graph_path"
    case historyResult = "history_result"
    case historyTrace = "history_trace"
  }
}

public struct RepositoryGraphStatus: Codable, Sendable {
  public let indexed: Bool
  public let stale: Bool
  public let currentHead: String?
  public let indexedHead: String?
  public let snapshotID: String?
  public let engineID: String?
  public let engineVersion: String?
  public let indexedFiles: Int
  public let nodeCount: Int
  public let edgeCount: Int
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case indexed, stale, truncated
    case currentHead = "current_head"
    case indexedHead = "indexed_head"
    case snapshotID = "snapshot_id"
    case engineID = "engine_id"
    case engineVersion = "engine_version"
    case indexedFiles = "indexed_files"
    case nodeCount = "node_count"
    case edgeCount = "edge_count"
  }
}

public struct RepositoryHistoryStatus: Codable, Sendable {
  public let indexed: Bool
  public let stale: Bool
  public let currentHead: String
  public let indexedHead: String?
  public let checkpointCount: Int
  public let eventCount: Int
  public let updatedAt: String?

  enum CodingKeys: String, CodingKey {
    case indexed, stale
    case currentHead = "current_head"
    case indexedHead = "indexed_head"
    case checkpointCount = "checkpoint_count"
    case eventCount = "event_count"
    case updatedAt = "updated_at"
  }
}

public struct RepositorySourceAnchor: Codable, Identifiable, Sendable {
  public let path: String
  public let startLine: UInt?
  public let endLine: UInt?
  public var id: String { "\(path)\u{0}\(startLine ?? 0)\u{0}\(endLine ?? 0)" }

  enum CodingKeys: String, CodingKey {
    case path
    case startLine = "start_line"
    case endLine = "end_line"
  }
}

public struct RepositoryGraphQueryNode: Codable, Identifiable, Sendable {
  public let id: String
  public let kind: String
  public let label: String
  public let qualifiedName: String?
  public let path: String?
  public let detail: String?
  public let language: String?
  public let communityID: String?
  public let trust: String
  public let sources: [RepositorySourceAnchor]

  enum CodingKeys: String, CodingKey {
    case id, kind, label, path, detail, language, trust, sources
    case qualifiedName = "qualified_name"
    case communityID = "community_id"
  }
}

public struct RepositoryGraphSearchHit: Codable, Identifiable, Sendable {
  public let node: RepositoryGraphQueryNode
  public let score: UInt
  public let matchedBy: String
  public var id: String { node.id }

  enum CodingKeys: String, CodingKey {
    case node, score
    case matchedBy = "matched_by"
  }
}

public struct RepositoryGraphSearchResult: Codable, Sendable {
  public let hits: [RepositoryGraphSearchHit]
  public let truncated: Bool
  public let nextCursor: String?

  enum CodingKeys: String, CodingKey {
    case hits, truncated
    case nextCursor = "next_cursor"
  }
}

public struct RepositoryGraphQueryEdge: Codable, Identifiable, Sendable {
  public let id: String
  public let from: String
  public let to: String
  public let kind: String
  public let evidence: String
  public let trust: String
  public let sources: [RepositorySourceAnchor]
}

public struct RepositoryGraphExplanation: Codable, Sendable {
  public let node: RepositoryGraphQueryNode
  public let incomingCount: Int
  public let outgoingCount: Int
  public let incomingKinds: [String]
  public let outgoingKinds: [String]
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case node, truncated
    case incomingCount = "incoming_count"
    case outgoingCount = "outgoing_count"
    case incomingKinds = "incoming_kinds"
    case outgoingKinds = "outgoing_kinds"
  }
}

public struct RepositoryGraphImpactResult: Codable, Sendable {
  public let root: RepositoryGraphQueryNode
  public let affected: [RepositoryGraphQueryNode]
  public let edges: [RepositoryGraphQueryEdge]
  public let depthReached: Int
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case root, affected, edges, truncated
    case depthReached = "depth_reached"
  }
}

public struct RepositoryGraphPathResult: Codable, Sendable {
  public let nodes: [RepositoryGraphQueryNode]
  public let edges: [RepositoryGraphQueryEdge]
  public let totalCost: Double
  public let visited: Int
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case nodes, edges, visited, truncated
    case totalCost = "total_cost"
  }
}

public struct RepositoryHistorySearchItem: Codable, Identifiable, Sendable {
  public let kind: String
  public let id: String
  public let label: String
  public let summary: String
  public let revision: String?
  public let recordedAt: String?
  public let trust: String
  public let sourceIDs: [String]

  enum CodingKeys: String, CodingKey {
    case kind, id, label, summary, revision, trust
    case recordedAt = "recorded_at"
    case sourceIDs = "source_ids"
  }
}

public struct RepositoryHistorySearchResult: Codable, Sendable {
  public let schemaVersion: Int
  public let items: [RepositoryHistorySearchItem]
  public let truncated: Bool
  public let nextOffset: Int?

  enum CodingKeys: String, CodingKey {
    case items, truncated
    case schemaVersion = "schema_version"
    case nextOffset = "next_offset"
  }
}

public struct RepositoryHistoryTrace: Codable, Sendable {
  public let schemaVersion: Int
  public let repoPath: String
  public let episodes: [RepositoryHistoryEpisode]
  public let indexedHead: String
  public let stale: Bool
  public let gaps: [String]
  public let scannedEvents: Int
  public let totalEvents: Int
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case episodes, stale, gaps, truncated
    case schemaVersion = "schema_version"
    case repoPath = "repo_path"
    case indexedHead = "indexed_head"
    case scannedEvents = "scanned_events"
    case totalEvents = "total_events"
  }
}

public struct RepositoryHistoryEpisode: Codable, Identifiable, Sendable {
  public let id: String
  public let events: [RepositoryHistoryCausalEvent]
  public let links: [RepositoryHistoryCausalLink]
  public let qualifiedLeads: [RepositoryHistoryCausalLink]
  public let stagesPresent: [String]
  public let gaps: [String]
  public let contradictions: [String]
  public let startedAt: String
  public let endedAt: String
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case id, events, links, gaps, contradictions, truncated
    case qualifiedLeads = "qualified_leads"
    case stagesPresent = "stages_present"
    case startedAt = "started_at"
    case endedAt = "ended_at"
  }
}

public struct RepositoryHistoryCausalEvent: Codable, Identifiable, Sendable {
  public let id: String
  public let revisionSHA: String?
  public let eventKind: String
  public let stage: String
  public let summary: String
  public let trust: String
  public let origin: String
  public let sourceID: String
  public let recordedAt: String
  public let sources: [RepositorySourceAnchor]

  enum CodingKeys: String, CodingKey {
    case id, stage, summary, trust, origin, sources
    case revisionSHA = "revision_sha"
    case eventKind = "event_kind"
    case sourceID = "source_id"
    case recordedAt = "recorded_at"
  }
}

public struct RepositoryHistoryCausalLink: Codable, Identifiable, Sendable {
  public let id: String
  public let fromEventID: String
  public let toEventID: String
  public let relation: String
  public let status: String
  public let trust: String
  public let evidence: String
  public let sources: [RepositorySourceAnchor]

  enum CodingKeys: String, CodingKey {
    case id, relation, status, trust, evidence, sources
    case fromEventID = "from_event_id"
    case toEventID = "to_event_id"
  }
}

public struct UnpackSnapshotChangedFile: Codable, Identifiable, Sendable {
  public let path: String
  public let additions: UInt64
  public let deletions: UInt64
  public var id: String { path }
}

public struct UnpackSnapshotCommit: Codable, Identifiable, Sendable {
  public let sha: String
  public let date: String
  public let author: String
  public let subject: String
  public let additions: UInt64
  public let deletions: UInt64
  public let files: [UnpackSnapshotChangedFile]
  public var id: String { sha }
}

public struct UnpackSnapshotComparison: Codable, Sendable {
  public let baseCommit: String
  public let headCommit: String
  public let commitCount: UInt64
  public let commits: [UnpackSnapshotCommit]
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case commits, truncated
    case baseCommit = "base_commit"
    case headCommit = "head_commit"
    case commitCount = "commit_count"
  }
}

public enum UnpackExportFormat: String, CaseIterable, Identifiable, Sendable {
  case markdown
  case html
  case repositoryGraphJSON = "repo_graph_json"
  case agentContextMarkdown = "agent_context_markdown"
  case repositoryMemoryMarkdown = "repo_memory_markdown"

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .markdown: "Full Markdown"
    case .html: "Offline HTML"
    case .repositoryGraphJSON: "Repository graph JSON"
    case .agentContextMarkdown: "Agent context Markdown"
    case .repositoryMemoryMarkdown: "Repository memory Markdown"
    }
  }

  public var pathExtension: String {
    switch self {
    case .html: "html"
    case .repositoryGraphJSON: "json"
    default: "md"
    }
  }
}

public struct UnpackExportReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let reportID: String
  public let format: String
  public let content: String

  enum CodingKeys: String, CodingKey {
    case format, content
    case schemaVersion = "schema_version"
    case reportID = "report_id"
  }
}

public struct UnpackReportClaim: Codable, Identifiable, Sendable {
  public let claim: String
  public let sources: [String]
  public let kind: String?
  public var id: String { "\(claim)\u{0}\(sources.first ?? "")" }
}

public struct UnpackReportSection: Codable, Sendable {
  public let title: String
  public let summary: String
  public let claims: [UnpackReportClaim]
}

public struct UnpackReport: Codable, Sendable {
  public let systemMap: UnpackReportSection?
  public let featureCatalog: UnpackReportSection?
  public let dataFlow: UnpackReportSection?
  public let behaviorTraces: UnpackReportSection?
  public let testingSignals: UnpackReportSection?
  public let riskMap: UnpackReportSection?
  public let extensionPoints: UnpackReportSection?
  public let agentHandoff: UnpackReportSection?
  public let agentPrompt: String?
  public let overview: String?

  enum CodingKeys: String, CodingKey {
    case overview
    case systemMap = "system_map"
    case featureCatalog = "feature_catalog"
    case dataFlow = "data_flow"
    case behaviorTraces = "behavior_traces"
    case testingSignals = "testing_signals"
    case riskMap = "risk_map"
    case extensionPoints = "extension_points"
    case agentHandoff = "agent_handoff"
    case agentPrompt = "agent_prompt"
  }
}

public struct UnpackLanguage: Codable, Identifiable, Sendable {
  public let language: String
  public let files: Int
  public let bytes: UInt64
  public var id: String { language }
}

public struct UnpackManifest: Codable, Identifiable, Sendable {
  public let path: String
  public let kind: String
  public let name: String?
  public let version: String?
  public let dependencies: [String]
  public let scripts: [String]
  public var id: String { path }
}

public struct UnpackEntrypoint: Codable, Identifiable, Sendable {
  public let path: String
  public let kind: String
  public let reason: String
  public var id: String { path }
}

public struct UnpackDirectorySummary: Codable, Identifiable, Sendable {
  public let path: String
  public let fileCount: Int
  public let bytes: UInt64
  public var id: String { path }

  enum CodingKeys: String, CodingKey {
    case path, bytes
    case fileCount = "file_count"
  }
}

public struct UnpackDocument: Codable, Identifiable, Sendable {
  public let path: String
  public let bytes: UInt64
  public let preview: String
  public var id: String { path }
}

public struct UnpackWorkspaceUnit: Codable, Identifiable, Sendable {
  public let path: String
  public let name: String
  public let kind: String
  public let manifestPath: String?
  public let buildSystem: String?
  public let fileCount: Int
  public let languages: [UnpackLanguage]
  public let scripts: [String]
  public let entrypoints: [String]
  public let testFiles: [String]
  public let tags: [String]
  public var id: String { path }

  enum CodingKeys: String, CodingKey {
    case path, name, kind, languages, scripts, entrypoints, tags
    case manifestPath = "manifest_path"
    case buildSystem = "build_system"
    case fileCount = "file_count"
    case testFiles = "test_files"
  }
}

public struct UnpackDirectoryNode: Codable, Identifiable, Sendable {
  public let name: String
  public let path: String
  public let isDirectory: Bool
  public let fileCount: Int
  public let children: [UnpackDirectoryNode]
  public var id: String { path.isEmpty ? "root" : path }

  enum CodingKeys: String, CodingKey {
    case name, path, children
    case isDirectory = "is_dir"
    case fileCount = "file_count"
  }
}

public struct UnpackGraph: Codable, Sendable {
  public let schemaVersion: Int
  public let nodes: [UnpackGraphNode]
  public let edges: [UnpackGraphEdge]
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case nodes, edges, truncated
    case schemaVersion = "schema_version"
  }
}

public struct UnpackGraphNode: Codable, Identifiable, Sendable {
  public let id: String
  public let kind: String
  public let label: String
  public let path: String?
  public let detail: String?
  public let sources: [String]
}

public struct UnpackGraphEdge: Codable, Identifiable, Sendable {
  public let from: String
  public let to: String
  public let kind: String
  public let evidence: String
  public let sources: [String]
  public let trust: String
  public var id: String { "\(from)\u{0}\(kind)\u{0}\(to)" }
}

public struct UnpackHistoryBrief: Codable, Sendable {
  public let summary: String
  public let recentCommits: [UnpackHistoryCommit]
  public let decisions: [UnpackHistoryDecision]
  public let testHints: [UnpackTestHint]
  public let sources: [String]
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case summary, decisions, sources, truncated
    case recentCommits = "recent_commits"
    case testHints = "test_hints"
  }
}

public struct UnpackHistoryCommit: Codable, Identifiable, Sendable {
  public let sha: String
  public let date: String?
  public let subject: String
  public let files: [String]
  public var id: String { sha }
}

public struct UnpackHistoryDecision: Codable, Identifiable, Sendable {
  public let marker: String
  public let text: String
  public let source: String
  public var id: String { "\(marker)\u{0}\(source)" }
}

public struct UnpackTestHint: Codable, Identifiable, Sendable {
  public let path: String
  public let reason: String
  public var id: String { path }
}

public struct UnpackHealth: Codable, Sendable {
  public let summary: String
  public let averageScore: Double
  public let hotspotCount: Int
  public let filesAnalyzed: Int
  public let filesWithTestSignal: Int
  public let topFiles: [UnpackHealthFile]
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case summary, truncated
    case averageScore = "average_score"
    case hotspotCount = "hotspot_count"
    case filesAnalyzed = "files_analyzed"
    case filesWithTestSignal = "files_with_test_signal"
    case topFiles = "top_files"
  }
}

public struct UnpackHealthFile: Codable, Identifiable, Sendable {
  public let path: String
  public let score: Double
  public let bucket: String
  public let lines: Int
  public let bytes: UInt64
  public let churn: Int
  public let hasTestSignal: Bool
  public let refactoringTargets: [String]
  public var id: String { path }

  enum CodingKeys: String, CodingKey {
    case path, score, bucket, lines, bytes, churn
    case hasTestSignal = "has_test_signal"
    case refactoringTargets = "refactoring_targets"
  }
}

public struct UnpackCoverage: Codable, Sendable {
  public let strategy: String
  public let sampledFiles: Int
  public let totalFiles: Int?
  public let samplePercent: Double?
  public let notes: [String]

  enum CodingKeys: String, CodingKey {
    case strategy, notes
    case sampledFiles = "sampled_files"
    case totalFiles = "total_files"
    case samplePercent = "sample_percent"
  }
}

public struct UnpackInventory: Codable, Sendable {
  public let repoPath: String
  public let repoName: String
  public let commitSHA: String?
  public let branch: String?
  public let filesScanned: Int
  public let filesSkipped: Int
  public let bytesScanned: UInt64
  public let maxFilesHit: Bool
  public let languages: [UnpackLanguage]
  public let manifests: [UnpackManifest]
  public let entrypoints: [UnpackEntrypoint]
  public let topLevelDirectories: [UnpackDirectorySummary]
  public let documents: [UnpackDocument]
  public let configFiles: [String]
  public let stackTags: [String]
  public let workspaceUnits: [UnpackWorkspaceUnit]
  public let graph: UnpackGraph
  public let history: UnpackHistoryBrief
  public let health: UnpackHealth
  public let coverage: UnpackCoverage
  public let allFilesCapped: Bool
  public let directoryTree: UnpackDirectoryNode

  enum CodingKeys: String, CodingKey {
    case branch, languages, manifests, entrypoints, coverage
    case repoPath = "repo_path"
    case repoName = "repo_name"
    case commitSHA = "commit_sha"
    case filesScanned = "files_scanned"
    case filesSkipped = "files_skipped"
    case bytesScanned = "bytes_scanned"
    case maxFilesHit = "max_files_hit"
    case topLevelDirectories = "top_level_dirs"
    case documents = "docs"
    case configFiles = "config_files"
    case stackTags = "stack_tags"
    case workspaceUnits = "workspace_units"
    case graph = "repo_graph"
    case history = "history_brief"
    case health = "repo_health"
    case allFilesCapped = "all_files_capped"
    case directoryTree = "dir_tree_preview"
  }
}
