import Foundation

public enum LocalUsageStatus: String, Codable, Sendable {
  case ready
  case stale
  case unavailable
}

public enum UsageScale: String, CaseIterable, Identifiable, Sendable {
  case day = "Day"
  case week = "Week"
  case month = "Month"

  public var id: String { rawValue }
}

public enum UsageWindow: String, CaseIterable, Identifiable, Sendable {
  case oneWeek = "1w"
  case thirtyDays = "30d"
  case ninetyDays = "90d"
  case allTime = "All"

  public var id: String { rawValue }

  fileprivate var dayCount: Int? {
    switch self {
    case .oneWeek: 7
    case .thirtyDays: 30
    case .ninetyDays: 90
    case .allTime: nil
    }
  }

  public var description: String {
    switch self {
    case .oneWeek: "last week"
    case .thirtyDays: "last 30 days"
    case .ninetyDays: "last 90 days"
    case .allTime: "all time"
    }
  }

  var receiptKey: String {
    switch self {
    case .oneWeek: "1w"
    case .thirtyDays: "30d"
    case .ninetyDays: "90d"
    case .allTime: "all"
    }
  }
}

public struct LocalUsageTotals: Codable, Equatable, Sendable {
  public let inputTokens: UInt64
  public let cacheCreationTokens: UInt64
  public let cacheReadTokens: UInt64
  public let outputTokens: UInt64
  public let totalTokens: UInt64
  public let costUSD: Double

  enum CodingKeys: String, CodingKey {
    case inputTokens = "input_tokens"
    case cacheCreationTokens = "cache_creation_tokens"
    case cacheReadTokens = "cache_read_tokens"
    case outputTokens = "output_tokens"
    case totalTokens = "total_tokens"
    case costUSD = "cost_usd"
  }

  public static let zero = LocalUsageTotals(
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUSD: 0
  )

  public init(
    inputTokens: UInt64,
    cacheCreationTokens: UInt64,
    cacheReadTokens: UInt64,
    outputTokens: UInt64,
    totalTokens: UInt64,
    costUSD: Double
  ) {
    self.inputTokens = inputTokens
    self.cacheCreationTokens = cacheCreationTokens
    self.cacheReadTokens = cacheReadTokens
    self.outputTokens = outputTokens
    self.totalTokens = totalTokens
    self.costUSD = costUSD
  }

  public var generatedTokens: UInt64 {
    inputTokens &+ cacheCreationTokens &+ outputTokens
  }

  public func adding(_ other: LocalUsageTotals) -> LocalUsageTotals {
    LocalUsageTotals(
      inputTokens: inputTokens &+ other.inputTokens,
      cacheCreationTokens: cacheCreationTokens &+ other.cacheCreationTokens,
      cacheReadTokens: cacheReadTokens &+ other.cacheReadTokens,
      outputTokens: outputTokens &+ other.outputTokens,
      totalTokens: totalTokens &+ other.totalTokens,
      costUSD: costUSD + other.costUSD
    )
  }
}

public struct LocalUsageModel: Codable, Identifiable, Sendable {
  public let model: String
  public let totals: LocalUsageTotals
  public let fallback: Bool
  public let priced: Bool

  public var id: String { model }
}

public struct LocalUsageAgent: Codable, Identifiable, Sendable {
  public let agent: String
  public let totals: LocalUsageTotals
  public let models: [LocalUsageModel]

  public var id: String { agent }
}

public struct LocalUsagePeriod: Codable, Identifiable, Sendable {
  public let period: String
  public let totals: LocalUsageTotals
  public let agents: [LocalUsageAgent]
  public let models: [LocalUsageModel]

  public var id: String { period }

  public func totals(for selectedAgents: Set<String>) -> LocalUsageTotals {
    guard !selectedAgents.isEmpty else { return totals }
    return agents.lazy
      .filter { selectedAgents.contains($0.agent) }
      .reduce(.zero) { $0.adding($1.totals) }
  }
}

public struct LocalUsageSession: Codable, Identifiable, Sendable {
  public let sessionID: String
  public let agent: String
  public let lastActivity: String?
  public let reasoningOutputTokens: UInt64
  public let totals: LocalUsageTotals
  public let models: [LocalUsageModel]

  public var id: String { "\(agent)\u{0}\(sessionID)" }

  enum CodingKeys: String, CodingKey {
    case agent, totals, models
    case sessionID = "session_id"
    case lastActivity = "last_activity"
    case reasoningOutputTokens = "reasoning_output_tokens"
  }
}

public struct LocalUsageProvenance: Codable, Sendable {
  public let engine: String
  public let version: String
  public let generatedAt: String
  public let timezone: String
  public let window: String
  public let detectedAgents: [String]
  public let excludedAgents: [String]
  public let codexRoots: [String]
  public let sourceFingerprint: String
  public let pricingComplete: Bool
  public let fallbackModels: [String]
  public let unpricedModels: [String]

  enum CodingKeys: String, CodingKey {
    case engine, version, window
    case generatedAt = "generated_at"
    case detectedAgents = "detected_agents"
    case excludedAgents = "excluded_agents"
    case codexRoots = "codex_roots"
    case sourceFingerprint = "source_fingerprint"
    case pricingComplete = "pricing_complete"
    case fallbackModels = "fallback_models"
    case unpricedModels = "unpriced_models"
    case timezone
  }
}

public struct LocalUsageFailure: Codable, Sendable {
  public let category: String
  public let message: String
}

public struct DevinUsageModel: Codable, Identifiable, Sendable {
  public let model: String
  public let sessions: Int64
  public let generatedTokens: Int64
  public let cacheReadTokens: Int64
  public let costUSD: Double

  public var id: String { model }

  enum CodingKeys: String, CodingKey {
    case model, sessions
    case generatedTokens = "generated_tokens"
    case cacheReadTokens = "cache_read_tokens"
    case costUSD = "cost_usd"
  }
}

public struct DevinUsageWindow: Codable, Identifiable, Sendable {
  public let window: String
  public let since: String?
  public let sessions: Int64
  public let generatedTokens: Int64
  public let cacheReadTokens: Int64
  public let costUSD: Double
  public let models: [DevinUsageModel]

  public var id: String { window }

  enum CodingKeys: String, CodingKey {
    case window, since, sessions, models
    case generatedTokens = "generated_tokens"
    case cacheReadTokens = "cache_read_tokens"
    case costUSD = "cost_usd"
  }
}

public struct DevinUsageSummary: Codable, Sendable {
  public let status: String
  public let source: String
  public let sessions: Int64
  public let generatedTokens: Int64
  public let cacheReadTokens: Int64
  public let outputTokens: Int64
  public let costUSD: Double
  public let models: [DevinUsageModel]
  public let windows: [DevinUsageWindow]?
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case status, source, sessions, models, windows, limitations
    case generatedTokens = "generated_tokens"
    case cacheReadTokens = "cache_read_tokens"
    case outputTokens = "output_tokens"
    case costUSD = "cost_usd"
  }

  public func projection(for window: UsageWindow) -> DevinUsageWindow {
    if let projection = windows?.first(where: { $0.window == window.receiptKey }) {
      return projection
    }
    return DevinUsageWindow(
      window: "all",
      since: nil,
      sessions: sessions,
      generatedTokens: generatedTokens,
      cacheReadTokens: cacheReadTokens,
      costUSD: costUSD,
      models: models
    )
  }
}

public struct LocalUsageReport: Codable, Sendable {
  public let status: LocalUsageStatus
  public let stale: Bool
  public let error: LocalUsageFailure?
  public let provenance: LocalUsageProvenance
  public let daily: [LocalUsagePeriod]
  public let weekly: [LocalUsagePeriod]
  public let monthly: [LocalUsagePeriod]
  public let sessions: [LocalUsageSession]
  public let totals: LocalUsageTotals
  public let devin: DevinUsageSummary?

  public func periods(for scale: UsageScale) -> [LocalUsagePeriod] {
    switch scale {
    case .day: daily
    case .week: weekly
    case .month: monthly
    }
  }

  public func periods(
    for scale: UsageScale,
    window: UsageWindow,
    referenceDate: Date = Date()
  ) -> [LocalUsagePeriod] {
    guard let cutoff = usageWindowCutoff(window, referenceDate: referenceDate) else {
      return periods(for: scale)
    }
    return periods(for: scale).filter { period in
      guard let interval = usagePeriodInterval(period.period, scale: scale) else { return false }
      return interval.start <= referenceDate && interval.end >= cutoff
    }
  }

  public func totals(
    for selectedAgents: Set<String>,
    window: UsageWindow,
    referenceDate: Date = Date()
  ) -> LocalUsageTotals {
    periods(for: .day, window: window, referenceDate: referenceDate)
      .reduce(.zero) { $0.adding($1.totals(for: selectedAgents)) }
  }

  public func sessions(
    for selectedAgents: Set<String>,
    window: UsageWindow,
    referenceDate: Date = Date()
  ) -> [LocalUsageSession] {
    let agentSessions = sessions.filter { selectedAgents.contains($0.agent) }
    guard let cutoff = usageWindowCutoff(window, referenceDate: referenceDate) else {
      return agentSessions
    }
    return agentSessions.filter { session in
      guard let raw = session.lastActivity, let activity = usageTimestamp(raw) else { return false }
      return activity >= cutoff && activity <= referenceDate
    }
  }
}

private func usageCalendar() -> Calendar {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0)!
  return calendar
}

private func usageWindowCutoff(_ window: UsageWindow, referenceDate: Date) -> Date? {
  guard let dayCount = window.dayCount else { return nil }
  let calendar = usageCalendar()
  let today = calendar.startOfDay(for: referenceDate)
  return calendar.date(byAdding: .day, value: -(dayCount - 1), to: today)
}

private func usagePeriodInterval(_ raw: String, scale: UsageScale) -> DateInterval? {
  let parts = raw.split(separator: "-").compactMap { Int($0) }
  let calendar = usageCalendar()
  let components: DateComponents
  switch scale {
  case .day, .week:
    guard parts.count == 3 else { return nil }
    components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
  case .month:
    guard parts.count == 2 else { return nil }
    components = DateComponents(year: parts[0], month: parts[1], day: 1)
  }
  guard let start = calendar.date(from: components) else { return nil }
  let end: Date
  switch scale {
  case .day:
    end = calendar.date(byAdding: .day, value: 1, to: start)!.addingTimeInterval(-1)
  case .week:
    end = calendar.date(byAdding: .day, value: 7, to: start)!.addingTimeInterval(-1)
  case .month:
    end = calendar.date(byAdding: .month, value: 1, to: start)!.addingTimeInterval(-1)
  }
  return DateInterval(start: start, end: end)
}

private func usageTimestamp(_ raw: String) -> Date? {
  ISO8601DateFormatter().date(from: raw)
}

public struct LocalUsageRunResult: Sendable {
  public let report: LocalUsageReport
  public let rawJSON: String
  public let processStatus: Int32
}
