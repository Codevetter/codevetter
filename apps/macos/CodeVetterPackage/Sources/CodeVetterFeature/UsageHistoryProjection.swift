import Foundation

public enum UsageGrouping: String, CaseIterable, Identifiable, Sendable {
  case model = "Model"
  case project = "Project"
  public var id: String { rawValue }
}

public enum UsageMetric: String, CaseIterable, Identifiable, Sendable {
  case tokens = "Tokens"
  case cost = "Cost"
  case cache = "Cache reads"
  public var id: String { rawValue }

  var caption: String {
    switch self {
    case .tokens: "Generated tokens · input + cache creation + output"
    case .cost: "Reported / estimated USD · not subscription spend"
    case .cache: "Cache-read tokens · separate from generated tokens"
    }
  }

  func value(_ totals: LocalUsageTotals) -> Double {
    switch self {
    case .tokens: Double(totals.generatedTokens)
    case .cost: totals.costUSD.isFinite ? max(0, totals.costUSD) : 0
    case .cache: Double(totals.cacheReadTokens)
    }
  }

  func formatted(_ value: Double, exact: Bool = false) -> String {
    if self == .cost { return String(format: exact ? "$%.4f" : "$%.2f", value) }
    if exact { return value.formatted(.number.precision(.fractionLength(0))) }
    if value >= 1_000_000_000 { return String(format: "%.1fB", value / 1_000_000_000) }
    if value >= 1_000_000 { return String(format: "%.1fM", value / 1_000_000) }
    if value >= 1_000 { return String(format: "%.1fK", value / 1_000) }
    return String(format: "%.0f", value)
  }
}

struct UsageHistorySeries: Identifiable, Sendable {
  let id: String
  let label: String
  let value: Double
}

struct UsageHistoryBucket: Identifiable, Sendable {
  let period: String
  let values: [String: Double]
  var id: String { period }
  var total: Double { values.values.reduce(0, +) }
}

struct UsageHistoryProjection: Sendable {
  let series: [UsageHistorySeries]
  let buckets: [UsageHistoryBucket]
  let total: Double
  let unattributed: Double
  let grouping: UsageGrouping
  let metric: UsageMetric
  static let unknown = "unattributed"
  static let other = "other"

  init(
    periods: [LocalUsagePeriod], agents: Set<String>, scale: UsageScale,
    grouping: UsageGrouping, metric: UsageMetric
  ) {
    self.grouping = grouping
    self.metric = metric
    var grouped: [String: [String: Double]] = [:]
    var totals: [String: Double] = [:]
    var labels = [Self.unknown: "Unattributed", Self.other: "Other"]
    for period in periods {
      let key = Self.periodKey(period.period, scale: scale)
      for agent in period.agents where agents.isEmpty || agents.contains(agent.agent) {
        let amount = metric.value(agent.totals)
        var attributed: [String: Double] = [:]
        if grouping == .model {
          for model in agent.models {
            let id = "model:\(model.model)"
            labels[id] = model.model
            attributed[id, default: 0] += metric.value(model.totals)
          }
        } else {
          for project in period.projects ?? [] where project.agent == agent.agent {
            let id = "project:\(project.project)"
            labels[id] = project.project
            attributed[id, default: 0] += metric.value(project.totals)
          }
        }
        let sum = attributed.values.reduce(0, +)
        // Never let inconsistent breakdowns inflate the canonical daily ledger.
        if sum > amount + 0.000_001 { attributed.removeAll() }
        let remainder = max(0, amount - attributed.values.reduce(0, +))
        if remainder > 0 { attributed[Self.unknown] = remainder }
        for (id, value) in attributed where value > 0 {
          grouped[key, default: [:]][id, default: 0] += value
          totals[id, default: 0] += value
        }
        if grouped[key] == nil { grouped[key] = [:] }
      }
    }
    total = totals.values.reduce(0, +)
    unattributed = totals[Self.unknown] ?? 0
    series = totals.map {
      UsageHistorySeries(id: $0.key, label: labels[$0.key] ?? $0.key, value: $0.value)
    }
    .sorted { $0.value == $1.value ? $0.id < $1.id : $0.value > $1.value }
    var points = grouped.keys.sorted().map { UsageHistoryBucket(period: $0, values: grouped[$0]!) }
    // Keep all totals while bounding render work, even for all-time daily history.
    if points.count > 180 {
      var earlier: [String: Double] = [:]
      for point in points.prefix(points.count - 179) {
        for (id, value) in point.values { earlier[id, default: 0] += value }
      }
      points = [UsageHistoryBucket(period: "Earlier", values: earlier)] + points.suffix(179)
    }
    buckets = points
  }

  var visibleSeries: [UsageHistorySeries] {
    guard series.count > 5 else { return series }
    let first = Array(series.prefix(4))
    return first + [
      UsageHistorySeries(
        id: Self.other, label: "Other (\(series.count - 4))",
        value: series.dropFirst(4).reduce(0) { $0 + $1.value })
    ]
  }

  func value(in bucket: UsageHistoryBucket, series item: UsageHistorySeries) -> Double {
    if item.id != Self.other { return bucket.values[item.id] ?? 0 }
    let visible = Set(series.prefix(4).map(\.id))
    return bucket.values.filter { !visible.contains($0.key) }.values.reduce(0, +)
  }

  private static func periodKey(_ day: String, scale: UsageScale) -> String {
    if scale == .day { return day }
    if scale == .month { return String(day.prefix(7)) }
    let parts = day.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return day }
    var calendar = Calendar(identifier: .iso8601)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard
      let date = calendar.date(
        from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
      let monday = calendar.date(
        byAdding: .day, value: -((calendar.component(.weekday, from: date) + 5) % 7), to: date)
    else { return day }
    let c = calendar.dateComponents([.year, .month, .day], from: monday)
    return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
  }
}
