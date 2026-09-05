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

  /// An unreadable Devin history is never the same claim as a quiet window, so the
  /// desk distinguishes the two instead of rendering both as zero activity.
  public func availability(for window: UsageWindow) -> DevinUsageAvailability {
    guard status == "ready" else { return .unavailable }
    return projection(for: window).sessions > 0 ? .active : .empty
  }
}

public enum DevinUsageAvailability: Equatable, Sendable {
  case unavailable
  case empty
  case active
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
    let calendar = usageCalendar()
    let referenceDay = usageDayKey(referenceDate)
    let cutoffDay = usageDayKey(cutoff)
    let lowerWeekDay = usageDayKey(
      calendar.date(byAdding: .day, value: -6, to: cutoff) ?? cutoff)
    let referenceMonth = String(referenceDay.prefix(7))
    let cutoffMonth = String(cutoffDay.prefix(7))
    return periods(for: scale).filter { period in
      switch scale {
      case .day:
        guard usagePeriodKeyIsValid(period.period, length: 10) else { return false }
        return period.period >= cutoffDay && period.period <= referenceDay
      case .week:
        guard usagePeriodKeyIsValid(period.period, length: 10) else { return false }
        return period.period >= lowerWeekDay && period.period <= referenceDay
      case .month:
        guard usagePeriodKeyIsValid(period.period, length: 7) else { return false }
        return period.period >= cutoffMonth && period.period <= referenceMonth
      }
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
    let cutoff = usageWindowCutoff(window, referenceDate: referenceDate)
    let cutoffKey = cutoff.map(usageUTCInstantKey)
    let referenceKey = usageUTCInstantKey(referenceDate)
    return sessions.filter { session in
      guard selectedAgents.contains(session.agent) else { return false }
      guard let cutoff else { return true }
      guard let raw = session.lastActivity else {
        return false
      }
      if let rawKey = usageUTCInstantKey(raw), let cutoffKey {
        return rawKey >= cutoffKey && rawKey <= referenceKey
      }
      guard let activity = usageTimestamp(raw) else { return false }
      return activity >= cutoff && activity <= referenceDate
    }
  }
}

public struct ProviderQuotaReceipt: Codable, Sendable {
  public let schemaVersion: String
  public let generatedAt: String
  public let providers: [ProviderQuotaStatus]
  public let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case providers, limitations
    case schemaVersion = "schema_version"
    case generatedAt = "generated_at"
  }
}

public struct ProviderQuotaStatus: Codable, Identifiable, Sendable {
  public let provider: String
  public let status: String
  public let source: String
  public let checkedAt: String
  public let plan: String?
  public let windows: [ProviderQuotaWindow]
  public let credits: ProviderCreditBalance?
  public let resetCredits: UInt64?
  public let message: String?

  public var id: String { provider }
  public var isReady: Bool { status == "ready" }

  enum CodingKeys: String, CodingKey {
    case provider, status, source, plan, windows, credits, message
    case checkedAt = "checked_at"
    case resetCredits = "reset_credits"
  }
}

public struct ProviderQuotaWindow: Codable, Identifiable, Sendable {
  public let id: String
  public let label: String
  public let usedPercent: Double
  public let remainingPercent: Double
  public let windowDurationMinutes: UInt64?
  public let resetsAtUnix: Int64?
  public let resetDescription: String?

  enum CodingKeys: String, CodingKey {
    case id, label
    case usedPercent = "used_percent"
    case remainingPercent = "remaining_percent"
    case windowDurationMinutes = "window_duration_minutes"
    case resetsAtUnix = "resets_at_unix"
    case resetDescription = "reset_description"
  }
}

public struct ProviderCreditBalance: Codable, Sendable {
  public let usedPercent: Double?
  public let remainingPercent: Double?
  public let usedAmount: Double?
  public let limitAmount: Double?
  public let currency: String?
  public let resetDescription: String?

  enum CodingKeys: String, CodingKey {
    case currency
    case usedPercent = "used_percent"
    case remainingPercent = "remaining_percent"
    case usedAmount = "used_amount"
    case limitAmount = "limit_amount"
    case resetDescription = "reset_description"
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

private nonisolated(unsafe) let usageTimestampFormatter = ISO8601DateFormatter()

private func usageTimestamp(_ raw: String) -> Date? {
  usageTimestampFormatter.date(from: raw)
}

private struct UsageUTCInstantKey: Comparable {
  let second: UInt64
  let nanosecond: UInt32

  static func < (left: Self, right: Self) -> Bool {
    left.second < right.second
      || (left.second == right.second && left.nanosecond < right.nanosecond)
  }
}

private func usageUTCInstantKey(_ date: Date) -> UsageUTCInstantKey {
  let seconds = floor(date.timeIntervalSince1970)
  let fraction = max(0, date.timeIntervalSince1970 - seconds)
  return UsageUTCInstantKey(
    second: usageUTCInstantKey(usageTimestampFormatter.string(from: date))?.second ?? 0,
    nanosecond: UInt32(min(fraction * 1_000_000_000, 999_999_999))
  )
}

private func usageUTCInstantKey(_ raw: String) -> UsageUTCInstantKey? {
  let bytes = Array(raw.utf8)
  guard bytes.count >= 20, bytes.last == 90,
    bytes[4] == 45, bytes[7] == 45, bytes[10] == 84,
    bytes[13] == 58, bytes[16] == 58
  else { return nil }
  var second: UInt64 = 0
  for index in [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] {
    guard bytes[index] >= 48, bytes[index] <= 57 else { return nil }
    second = second * 10 + UInt64(bytes[index] - 48)
  }
  var nanosecond: UInt32 = 0
  if bytes.count > 20, bytes[19] == 46 {
    var digits = 0
    var index = 20
    while index < bytes.count - 1, digits < 9 {
      guard bytes[index] >= 48, bytes[index] <= 57 else { return nil }
      nanosecond = nanosecond * 10 + UInt32(bytes[index] - 48)
      digits += 1
      index += 1
    }
    while digits < 9 {
      nanosecond *= 10
      digits += 1
    }
  } else if bytes.count != 20 {
    return nil
  }
  return UsageUTCInstantKey(second: second, nanosecond: nanosecond)
}

private func usageDayKey(_ date: Date) -> String {
  String(usageTimestampFormatter.string(from: date).prefix(10))
}

private func usagePeriodKeyIsValid(_ raw: String, length: Int) -> Bool {
  guard raw.count == length else { return false }
  let characters = Array(raw)
  guard characters.count == length, characters[4] == "-" else { return false }
  if length == 10, characters[7] != "-" { return false }
  return characters.enumerated().allSatisfy { index, character in
    index == 4 || (length == 10 && index == 7) || character.isNumber
  }
}

private func usageUTCSecondKey(_ raw: String) -> String? {
  guard raw.hasSuffix("Z"), raw.count >= 20 else { return nil }
  let key = raw.prefix(19)
  guard key[key.index(key.startIndex, offsetBy: 4)] == "-",
    key[key.index(key.startIndex, offsetBy: 7)] == "-",
    key[key.index(key.startIndex, offsetBy: 10)] == "T",
    key[key.index(key.startIndex, offsetBy: 13)] == ":",
    key[key.index(key.startIndex, offsetBy: 16)] == ":"
  else { return nil }
  return String(key)
}

public struct LocalUsageRunResult: Sendable {
  public let report: LocalUsageReport
  public let rawJSON: String
  public let processStatus: Int32
}
