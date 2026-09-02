import Foundation

public struct OpsBillingStatus: Codable, Sendable {
  public let anthropicConfigured: Bool
  public let openaiConfigured: Bool

  enum CodingKeys: String, CodingKey {
    case anthropicConfigured = "anthropic_configured"
    case openaiConfigured = "openai_configured"
  }
}

public struct OpsWebhookStatus: Codable, Sendable {
  public let configured: Bool
  public let flavor: String
}

public struct OpsObservabilityRow: Codable, Identifiable, Sendable {
  public let taskType: String
  public let sessionCount: Int64
  public let successCount: Int64
  public let failureCount: Int64
  public let successRatePercent: Double
  public let medianDurationSeconds: Double?
  public let p95DurationSeconds: Double?

  public var id: String { taskType }

  enum CodingKeys: String, CodingKey {
    case taskType = "task_type"
    case sessionCount = "session_count"
    case successCount = "success_count"
    case failureCount = "failure_count"
    case successRatePercent = "success_rate_pct"
    case medianDurationSeconds = "median_duration_seconds"
    case p95DurationSeconds = "p95_duration_seconds"
  }
}

public struct OpsStatusReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let databaseAvailable: Bool
  public let windowDays: Int
  public let billing: OpsBillingStatus
  public let webhook: OpsWebhookStatus
  public let observability: [OpsObservabilityRow]
  public let excludedSensitiveKeys: [String]
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case billing, webhook, observability, limitations
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
    case databaseAvailable = "database_available"
    case windowDays = "window_days"
    case excludedSensitiveKeys = "excluded_sensitive_keys"
  }
}
