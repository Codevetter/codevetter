import AppKit
import Foundation
import SwiftUI
import Testing

@testable import CodeVetterFeature

private func usageHistoryFixture() -> LocalUsageReport {
  let days = (1...28).map { day -> LocalUsagePeriod in
    let claude = localUsageTotals(UInt64(day * 1200))
    let codex = localUsageTotals(UInt64(day * 2400))
    let models = [
      LocalUsageModel(model: "Claude Sonnet", totals: claude, fallback: false, priced: true),
      LocalUsageModel(model: "GPT-5.6", totals: codex, fallback: false, priced: true),
    ]
    var row = LocalUsagePeriod(
      period: String(format: "2026-09-%02d", day), totals: claude.adding(codex),
      agents: [
        LocalUsageAgent(agent: "claude", totals: claude, models: [models[0]]),
        LocalUsageAgent(agent: "codex", totals: codex, models: [models[1]]),
      ], models: models)
    row.projects = [
      LocalUsageProject(project: "/workspace/CodeVetter", agent: "claude", totals: claude)
    ]
    return row
  }
  return LocalUsageReport(
    status: .ready, stale: false, error: nil,
    provenance: LocalUsageProvenance(
      engine: "ccusage", version: "20.0.20",
      generatedAt: "2026-09-28T12:00:00Z", timezone: "UTC", window: "all",
      detectedAgents: ["claude", "codex"], excludedAgents: [], codexRoots: [],
      sourceFingerprint: "fixture:usage-directions", pricingComplete: true,
      fallbackModels: [], unpricedModels: []),
    daily: days, weekly: [], monthly: [], sessions: [],
    totals: days.reduce(.zero) { $0.adding($1.totals) }, devin: nil)
}

@Test func usageHistoryMetricsAndGroupingsReconcileOnOneBoundary() throws {
  let report = usageHistoryFixture()
  let date = try #require(ISO8601DateFormatter().date(from: "2026-09-15T12:00:00Z"))
  for scale in UsageScale.allCases {
    for grouping in UsageGrouping.allCases {
      for metric in UsageMetric.allCases {
        let p = UsageViewProjection(
          report: report, selectedAgents: ["claude", "codex"],
          window: .oneWeek, scale: scale, referenceDate: date, grouping: grouping, metric: metric)
        #expect(abs(p.history.total - metric.value(p.totals)) < 0.000_001)
        #expect(abs(p.history.buckets.reduce(0) { $0 + $1.total } - p.history.total) < 0.000_001)
        #expect(p.activeDays == 7)
        #expect(p.history.grouping == grouping)
      }
    }
  }
  let weekly = UsageViewProjection(
    report: report, selectedAgents: ["claude"], window: .oneWeek,
    scale: .week, referenceDate: date
  ).history
  #expect(weekly.buckets.map(\.period) == ["2026-09-07", "2026-09-14"])
  #expect(weekly.series.count == 1)
}

@Test func usageProjectsKeepUnknownAndRejectExcessBreakdowns() throws {
  let report = usageHistoryFixture()
  let p = UsageHistoryProjection(
    periods: report.daily, agents: [], scale: .week,
    grouping: .project, metric: .tokens)
  #expect(p.series.count == 2)
  #expect(abs(p.unattributed / p.total - 2.0 / 3.0) < 0.000_001)
  var invalid = report.daily[0]
  invalid.projects = [LocalUsageProject(project: "bad", agent: "claude", totals: report.totals)]
  let rejected = UsageHistoryProjection(
    periods: [invalid], agents: ["claude"], scale: .day,
    grouping: .project, metric: .tokens)
  #expect(rejected.total == rejected.unattributed)
  let decoded = try JSONDecoder().decode(LocalUsageReport.self, from: JSONEncoder().encode(report))
  #expect(decoded.daily[0].projects?.first?.project == "/workspace/CodeVetter")
}

@Test func usageHistoryBoundsSeriesAndPeriodsWithoutDroppingTotals() {
  let rows = (0..<365).map { index in
    usagePeriod(
      String(format: "%04d-01-01", 2000 + index), agent: "codex",
      generated: UInt64(index + 1), model: "model-\(index % 12)")
  }
  let p = UsageHistoryProjection(
    periods: rows, agents: [], scale: .day, grouping: .model, metric: .tokens)
  #expect(p.buckets.count == 180)
  #expect(p.buckets.first?.period == "Earlier")
  #expect(p.visibleSeries.count == 5)
  #expect(p.total == rows.reduce(0) { $0 + Double($1.totals.generatedTokens) })
  for bucket in p.buckets {
    #expect(
      abs(p.visibleSeries.reduce(0) { $0 + p.value(in: bucket, series: $1) } - bucket.total)
        < 0.000_001)
  }
  #expect(p.chartValues.count == p.buckets.count)
  for (index, bucket) in p.buckets.enumerated() {
    #expect(p.chartValues[index].count == p.visibleSeries.count)
    for (seriesIndex, series) in p.visibleSeries.enumerated() {
      #expect(
        abs(p.chartValues[index][seriesIndex] - p.value(in: bucket, series: series)) < 0.000_001)
    }
  }
}

private func allowanceWindow(_ remaining: Double, reset: Int64?, duration: UInt64? = 10_080)
  -> ProviderQuotaWindow
{
  ProviderQuotaWindow(
    id: "weekly", label: "Weekly window", usedPercent: 100 - remaining,
    remainingPercent: remaining, windowDurationMinutes: duration,
    resetsAtUnix: reset, resetDescription: nil)
}

@Test func usageAllowanceColorsAndPaceRemainIndependent() throws {
  let date = try #require(ISO8601DateFormatter().date(from: "2026-09-15T12:00:00Z"))
  let checked = "2026-09-15T12:00:00Z"
  let reset = Int64(date.timeIntervalSince1970 + 604_800 * 0.10)
  for (remaining, level) in [
    (0.0, UsageAllowanceState.Level.exhausted), (13, .low), (20, .low),
    (20.1, .watch), (40, .watch), (40.1, .healthy), (100, .healthy),
  ] {
    #expect(
      UsageAllowanceState(
        window: allowanceWindow(remaining, reset: reset), checkedAt: checked,
        available: true, now: date
      ).level == level)
  }
  let lowButUnderPace = UsageAllowanceState(
    window: allowanceWindow(13, reset: reset), checkedAt: checked,
    available: true, now: date)
  #expect(lowButUnderPace.level == .low)
  #expect(abs((lowButUnderPace.paceDelta ?? 0) - 3) < 0.000_001)
  #expect(lowButUnderPace.paceLabel == "3 pp under even-use pace")
  for window in [
    allowanceWindow(13, reset: nil), allowanceWindow(13, reset: reset, duration: nil),
    allowanceWindow(13, reset: Int64(date.timeIntervalSince1970 - 1)),
  ] {
    #expect(
      UsageAllowanceState(window: window, checkedAt: checked, available: true, now: date).paceDelta
        == nil)
  }
  #expect(
    UsageAllowanceState(
      window: allowanceWindow(68, reset: reset), checkedAt: checked,
      available: false, now: date
    ).level == .unknown)
  #expect(
    UsageAllowanceState(
      window: allowanceWindow(68, reset: reset), checkedAt: checked,
      available: true, now: date.addingTimeInterval(301)
    ).level == .unknown)
  #expect(
    UsageAllowanceState(
      window: allowanceWindow(.nan, reset: reset), checkedAt: checked,
      available: true, now: date
    ).level == .unknown)
}

@MainActor @Test func usageProjectionCacheTracksGroupingAndMetric() {
  let model = WorkbenchModel()
  model.usageReport = usageHistoryFixture()
  model.usageWindow = .allTime
  let report = model.usageReport!
  #expect(model.usageProjection(for: report).history.grouping == .model)
  model.usageGrouping = .project
  #expect(model.usageDimension == .project)
  model.usageMetric = .cost
  let p = model.usageProjection(for: report)
  #expect(p.history.grouping == .project)
  #expect(p.history.metric == .cost)
  #expect(p.history.total == UsageMetric.cost.value(p.totals))
  model.usageDimension = .model
  model.usageMetric = .cache
  let cache = model.usageProjection(for: report)
  #expect(cache.history.grouping == .model)
  #expect(cache.history.metric == .cache)
  #expect(cache.history.total == Double(cache.totals.cacheReadTokens))
}

@MainActor @Test func usageApprovedDirectionRendersOffscreen() throws {
  let model = WorkbenchModel()
  // Prevent view lifecycle tasks from collecting real usage during fixture renders.
  model.usageLoading = true
  model.providerQuotaLoading = true
  model.section = .usage
  model.usageReport = usageHistoryFixture()
  model.usageWindow = .allTime
  model.usageScale = .week
  model.usageSelectedAgents = ["claude", "codex"]
  let checked = ISO8601DateFormatter().string(from: Date())
  let reset = Int64(Date().timeIntervalSince1970 + 604_800 * 0.22)
  let json = """
    {"schema_version":"codevetter.provider-quota/v1","generated_at":"\(checked)","limitations":[],"providers":[
    {"provider":"codex","status":"ready","source":"fixture","checked_at":"\(checked)","windows":[{"id":"weekly","label":"Weekly window","used_percent":87,"remaining_percent":13,"window_duration_minutes":10080,"resets_at_unix":\(reset)}]},
    {"provider":"claude","status":"ready","source":"fixture","checked_at":"\(checked)","windows":[{"id":"weekly","label":"Weekly window","used_percent":32,"remaining_percent":68,"window_duration_minutes":10080,"resets_at_unix":\(reset)}]}]}
    """
  model.providerQuotaReceipt = try JSONDecoder().decode(
    ProviderQuotaReceipt.self, from: Data(json.utf8))
  let directory = FileManager.default.temporaryDirectory.appending(
    path: "codevetter-usage-review-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  for width: CGFloat in [980, 1280, 1440] {
    for appearance in [NSAppearance.Name.darkAqua, .aqua] {
      try captureWorkbench(
        model, at: directory.appending(path: "model-\(Int(width))-\(appearance.rawValue).png"),
        appearance: appearance, width: width, height: width == 980 ? 640 : 900)
    }
  }
  model.usageGrouping = .project
  model.usageMetric = .cost
  try captureWorkbench(
    model, at: directory.appending(path: "project-cost.png"), appearance: .darkAqua, height: 900)
  let history = model.usageProjection(for: model.usageReport!).history
  for width: CGFloat in [390, 768, 1440] {
    let host = NSHostingView(
      rootView: UsageHistoryView(history: history, pricingComplete: true)
        .padding(20).frame(width: width, height: 540, alignment: .topLeading)
        .background(Color.black).preferredColorScheme(.dark))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: width, height: 540)
    host.layoutSubtreeIfNeeded()
    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
    host.cacheDisplay(in: host.bounds, to: bitmap)
    let data = try #require(bitmap.representation(using: .png, properties: [:]))
    try data.write(to: directory.appending(path: "history-\(Int(width)).png"))
  }
  print("USAGE_REVIEW_ARTIFACTS \(directory.path)")
}
