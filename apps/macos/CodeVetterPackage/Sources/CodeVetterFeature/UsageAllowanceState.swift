import Foundation

struct UsageAllowanceState: Equatable {
  enum Level { case healthy, watch, low, exhausted, unknown }
  let level: Level
  let paceDelta: Double?

  init(
    window: ProviderQuotaWindow, checkedAt: String, available: Bool,
    now: Date = Date()
  ) {
    let parser = ISO8601DateFormatter()
    let checked =
      parser.date(from: checkedAt)
      ?? {
        parser.formatOptions.insert(.withFractionalSeconds)
        return parser.date(from: checkedAt)
      }()
    let age = checked.map { now.timeIntervalSince($0) }
    let isCurrent = available && age.map { $0 >= -60 && $0 <= 300 } == true
    let remaining = window.remainingPercent
    let expired = window.resetsAtUnix.map { Double($0) <= now.timeIntervalSince1970 } ?? false
    if !isCurrent || expired || !remaining.isFinite || !(0...100).contains(remaining) {
      level = .unknown
    } else if remaining == 0 {
      level = .exhausted
    } else if remaining <= 20 {
      level = .low
    } else if remaining <= 40 {
      level = .watch
    } else {
      level = .healthy
    }
    if level != .unknown, let minutes = window.windowDurationMinutes, minutes > 0,
      let reset = window.resetsAtUnix
    {
      let duration = Double(minutes) * 60
      let untilReset = Double(reset) - now.timeIntervalSince1970
      paceDelta =
        untilReset > 0 && untilReset <= duration
        ? remaining - untilReset / duration * 100 : nil
    } else {
      paceDelta = nil
    }
  }

  var label: String {
    switch level {
    case .healthy: "Healthy allowance"
    case .watch: "Watch allowance"
    case .low: "Low allowance"
    case .exhausted: "Allowance exhausted"
    case .unknown: "Allowance not current"
    }
  }
  var paceLabel: String {
    guard let delta = paceDelta else { return "Pace unavailable" }
    if abs(delta) < 1 { return "On even-use pace" }
    return String(format: "%.0f pp %@ even-use pace", abs(delta), delta < 0 ? "over" : "under")
  }
}
