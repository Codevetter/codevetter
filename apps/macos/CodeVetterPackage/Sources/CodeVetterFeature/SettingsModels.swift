import Foundation

public enum OnboardingOperation: String, Codable, Sendable {
  case inspect
  case complete
}

public struct OnboardingToolStatus: Codable, Identifiable, Sendable {
  public let id: String
  public let label: String
  public let available: Bool
  public let role: String
  public let authentication: String
}

public struct OnboardingReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let operation: OnboardingOperation
  public let completed: Bool
  public let completionSource: String
  public let defaultAdapter: String
  public let tools: [OnboardingToolStatus]
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case operation, completed, tools, limitations
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case completionSource = "completion_source"
    case defaultAdapter = "default_adapter"
  }
}

public enum NativeSettingKind: String, Codable, Sendable {
  case toggle
  case choice
  case text
}

public struct NativeSettingOption: Codable, Identifiable, Sendable {
  public let value: String
  public let label: String
  public var id: String { value }
}

public struct NativeSettingValue: Codable, Identifiable, Sendable {
  public let key: String
  public let section: String
  public let label: String
  public let description: String
  public let kind: NativeSettingKind
  public let value: String
  public let defaultValue: String
  public let options: [NativeSettingOption]
  public var id: String { key }

  enum CodingKeys: String, CodingKey {
    case key, section, label, description, kind, value, options
    case defaultValue = "default_value"
  }
}

public struct NativeSettingsReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let databaseAvailable: Bool
  public let savedKey: String?
  public let settings: [NativeSettingValue]
  public let excludedSensitiveKeys: [String]

  enum CodingKeys: String, CodingKey {
    case settings
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case databaseAvailable = "database_available"
    case savedKey = "saved_key"
    case excludedSensitiveKeys = "excluded_sensitive_keys"
  }
}

public enum HistoryRootsOperation: String, Codable, Equatable, Sendable {
  case read
  case add
  case remove
}

public struct HistoryRoot: Codable, Identifiable, Sendable {
  public let path: String
  public let displayPath: String
  public let exists: Bool
  public let sessionsAvailable: Bool
  public let archivedSessionsAvailable: Bool

  public var id: String { path }

  enum CodingKeys: String, CodingKey {
    case path, exists
    case displayPath = "display_path"
    case sessionsAvailable = "sessions_available"
    case archivedSessionsAvailable = "archived_sessions_available"
  }
}

public struct HistoryRootsReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let operation: HistoryRootsOperation
  public let databaseAvailable: Bool
  public let changedRoot: String?
  public let roots: [HistoryRoot]
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case operation, roots, limitations
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case databaseAvailable = "database_available"
    case changedRoot = "changed_root"
  }
}

public enum SessionRetentionOperation: String, Codable, Equatable, Sendable {
  case plan
  case apply
  case checkpoint
}

public struct SessionRetentionPolicy: Codable, Sendable {
  public let maxAgeDays: Int64?
  public let maxArchiveBytes: Int64?

  enum CodingKeys: String, CodingKey {
    case maxAgeDays = "maxAgeDays"
    case maxArchiveBytes = "maxArchiveBytes"
  }
}

public struct SessionRetentionEntry: Codable, Identifiable, Sendable {
  public let sessionID: String
  public let rows: Int64
  public let estimatedBytes: Int64
  public let lastActivity: String
  public let reasons: [String]

  public var id: String { sessionID }

  enum CodingKeys: String, CodingKey {
    case rows, reasons
    case sessionID = "sessionId"
    case estimatedBytes = "estimatedBytes"
    case lastActivity = "lastActivity"
  }
}

public struct SessionRetentionPlan: Codable, Identifiable, Sendable {
  public let id: String
  public let planIdentity: String
  public let archiveFingerprint: String
  public let policy: SessionRetentionPolicy
  public let archiveRows: Int64
  public let archiveBytes: Int64
  public let candidateRows: Int64
  public let candidateBytes: Int64
  public let candidates: [SessionRetentionEntry]
  public let protected: [SessionRetentionEntry]
  public let projectedRows: Int64
  public let projectedBytes: Int64
  public let createdAt: String
}

public struct SessionRetentionReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let operation: SessionRetentionOperation
  public let plan: SessionRetentionPlan?
  public let result: PerformanceJSONValue?

  enum CodingKeys: String, CodingKey {
    case operation, plan, result
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
  }
}

public enum RubricSettingsOperation: String, Codable, Equatable, Sendable {
  case read
  case select
  case upsert
}

public struct RubricPackInput: Sendable {
  public let id: String
  public let name: String
  public let focus: String
  public let checks: [String]
}

public struct RubricPackReceipt: Codable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let focus: String
  public let checks: [String]
  public let builtIn: Bool
  public let active: Bool
  public let reviewCount: Int64
  public let totalFindings: Int64
  public let promptPreview: String

  enum CodingKeys: String, CodingKey {
    case id, name, focus, checks, active
    case builtIn = "built_in"
    case reviewCount = "review_count"
    case totalFindings = "total_findings"
    case promptPreview = "prompt_preview"
  }
}

public struct RubricSettingsReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let operation: RubricSettingsOperation
  public let activePackID: String?
  public let customRules: [String]
  public let packs: [RubricPackReceipt]
  public let savedPackID: String?
  public let migratedLegacyConfig: Bool

  enum CodingKeys: String, CodingKey {
    case operation, packs
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case activePackID = "active_pack_id"
    case customRules = "custom_rules"
    case savedPackID = "saved_pack_id"
    case migratedLegacyConfig = "migrated_legacy_config"
  }
}

public enum MemoryReceiptOperation: String, Codable, Equatable, Sendable {
  case list
  case read
  case diff
}

public struct MemorySourceReceipt: Codable, Identifiable, Sendable {
  public let id: String
  public let tool: String
  public let label: String
  public let displayPath: String
  public let exists: Bool
  public let readable: Bool
  public let fileSizeBytes: UInt64?
  public let modifiedAt: String?
  public let sourceKind: String
  public let preview: String
  public let note: String

  enum CodingKeys: String, CodingKey {
    case id, tool, label, exists, readable, preview, note
    case displayPath = "display_path"
    case fileSizeBytes = "file_size_bytes"
    case modifiedAt = "modified_at"
    case sourceKind = "source_kind"
  }
}

public struct MemoryDocumentReceipt: Codable, Sendable {
  public let sourceID: String
  public let content: String
  public let truncated: Bool
  public let extractionNote: String

  enum CodingKeys: String, CodingKey {
    case content, truncated
    case sourceID = "source_id"
    case extractionNote = "extraction_note"
  }
}

public struct MemoryDiffReceipt: Codable, Sendable {
  public let sourceID: String
  public let hasChanges: Bool
  public let status: String
  public let diff: String

  enum CodingKeys: String, CodingKey {
    case status, diff
    case sourceID = "source_id"
    case hasChanges = "has_changes"
  }
}

public struct MemoryReceiptLimits: Codable, Sendable {
  public let maxSources: Int
  public let maxReadBytes: UInt64
  public let maxOutputChars: Int
  public let sourcesTruncated: Bool

  enum CodingKeys: String, CodingKey {
    case maxSources = "max_sources"
    case maxReadBytes = "max_read_bytes"
    case maxOutputChars = "max_output_chars"
    case sourcesTruncated = "sources_truncated"
  }
}

public struct MemoryReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let operation: MemoryReceiptOperation
  public let selectedSourceID: String?
  public let candidateLocationsChecked: Int
  public let sourcesTotal: Int
  public let sources: [MemorySourceReceipt]
  public let document: MemoryDocumentReceipt?
  public let diff: MemoryDiffReceipt?
  public let limits: MemoryReceiptLimits
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case operation, sources, document, diff, limits, limitations
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case selectedSourceID = "selected_source_id"
    case candidateLocationsChecked = "candidate_locations_checked"
    case sourcesTotal = "sources_total"
  }
}

public enum NativeSettingsSection: String, CaseIterable, Identifiable, Sendable {
  case general
  case appearance
  case integrations
  case agents
  case agentIsland = "agent_island"
  case mcp
  case notifications
  case usage
  case rubrics
  case ops
  case memories
  case about

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .general: "General"
    case .appearance: "Appearance"
    case .integrations: "Integrations"
    case .agents: "Agents"
    case .agentIsland: "Agent Island"
    case .mcp: "Agent MCP"
    case .notifications: "Notifications"
    case .usage: "Usage"
    case .rubrics: "Rubrics"
    case .ops: "Ops"
    case .memories: "Memories"
    case .about: "About"
    }
  }

  public var systemImage: String {
    switch self {
    case .general: "slider.horizontal.3"
    case .appearance: "circle.lefthalf.filled"
    case .integrations: "point.3.connected.trianglepath.dotted"
    case .agents: "terminal"
    case .agentIsland: "rectangle.topthird.inset.filled"
    case .mcp: "arrow.trianglehead.branch"
    case .notifications: "bell"
    case .usage: "chart.bar"
    case .rubrics: "checklist"
    case .ops: "bolt"
    case .memories: "memorychip"
    case .about: "info.circle"
    }
  }
}

public enum McpSettingsOperation: String, Codable, Equatable, Sendable {
  case read
  case enable
  case disable
  case clearAudit = "clear_audit"

  public var cliFlag: String? {
    switch self {
    case .read: nil
    case .enable: "--enable"
    case .disable: "--disable"
    case .clearAudit: "--clear-audit"
    }
  }
}

public struct McpAuditEntry: Codable, Identifiable, Sendable {
  public let id: Int64
  public let repoID: String
  public let serverSession: String
  public let operation: String
  public let status: String
  public let durationMS: UInt64
  public let resultCount: Int
  public let responseBytes: Int
  public let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id, operation, status
    case repoID = "repo_id"
    case serverSession = "server_session"
    case durationMS = "duration_ms"
    case resultCount = "result_count"
    case responseBytes = "response_bytes"
    case createdAt = "created_at"
  }
}

public struct McpRepositorySettings: Codable, Sendable {
  public let repoID: String?
  public let enabled: Bool
  public let indexed: Bool
  public let indexedHead: String?
  public let currentHead: String?
  public let stale: Bool
  public let serverPath: String
  public let clientConfig: PerformanceJSONValue?
  public let resourceKinds: [String]
  public let toolNames: [String]
  public let redactionRules: [String]
  public let limits: PerformanceJSONValue
  public let recentAudit: [McpAuditEntry]

  enum CodingKeys: String, CodingKey {
    case enabled, indexed, stale, limits
    case repoID = "repo_id"
    case indexedHead = "indexed_head"
    case currentHead = "current_head"
    case serverPath = "server_path"
    case clientConfig = "client_config"
    case resourceKinds = "resource_kinds"
    case toolNames = "tool_names"
    case redactionRules = "redaction_rules"
    case recentAudit = "recent_audit"
  }

  public var clientConfigJSON: String? {
    guard let clientConfig,
      let data = try? JSONEncoder.prettySorted.encode(clientConfig)
    else { return nil }
    return String(data: data, encoding: .utf8)
  }
}

public struct McpSettingsReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let operation: McpSettingsOperation
  public let clearedAuditRows: Int
  public let settings: McpRepositorySettings

  enum CodingKeys: String, CodingKey {
    case operation, settings
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case clearedAuditRows = "cleared_audit_rows"
  }
}

extension JSONEncoder {
  fileprivate static var prettySorted: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return encoder
  }
}
