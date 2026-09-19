import AppKit
import SwiftUI

struct UsageTrendPoint: Identifiable, Sendable {
  let period: String
  let generatedTokens: UInt64

  var id: String { period }
}

struct UsageSeriesPoint: Sendable {
  var tokens: UInt64 = 0
  var costUSD: Double = 0
  var cacheReadTokens: UInt64 = 0

  func value(for metric: UsageHistoryMetric) -> Double {
    switch metric {
    case .tokens: Double(tokens)
    case .cost: costUSD
    case .cache: Double(cacheReadTokens)
    }
  }
}

/// One ranked entity (model or project) with per-period values aligned to the
/// chart's period keys, so stacked bars and breakdown rows always reconcile.
struct UsageTrendSeries: Identifiable, Sendable {
  let name: String
  let detail: String?
  let points: [UsageSeriesPoint]

  var id: String { name }
  var totalTokens: UInt64 { points.reduce(0) { $0 + $1.tokens } }
  var totalCostUSD: Double { points.reduce(0) { $0 + $1.costUSD } }
}

struct UsageBreakdownRow: Identifiable, Sendable {
  let name: String
  let detail: String?
  let tokens: UInt64
  let costUSD: Double

  var id: String { name }
}

struct UsageViewProjection: Sendable {
  let history: UsageHistoryProjection
  let totals: LocalUsageTotals
  let activeDays: Int
  let sessionCount: Int
  let recentSessions: [LocalUsageSession]
  let models: [LocalUsageModel]
  let trend: [UsageTrendPoint]
  /// Period keys aligned with `trend` and every series' `points`.
  let trendPeriodKeys: [String]
  let modelSeries: [UsageTrendSeries]
  let projectSeries: [UsageTrendSeries]
  let projectBreakdown: [UsageBreakdownRow]
  /// Sessions with a recovered project; the rest render as Unattributed.
  let attributedSessionCount: Int

  init(
    report: LocalUsageReport,
    selectedAgents: Set<String>,
    window: UsageWindow,
    scale: UsageScale,
    referenceDate: Date = Date(),
    grouping: UsageGrouping = .model,
    metric: UsageMetric = .tokens
  ) {
    let dayPeriods = report.periods(for: .day, window: window, referenceDate: referenceDate)
    history = UsageHistoryProjection(
      periods: dayPeriods, agents: selectedAgents,
      scale: scale, grouping: grouping, metric: metric)
    var selectedTotals = LocalUsageTotals.zero
    var modelsByName: [String: LocalUsageModel] = [:]
    for period in dayPeriods {
      selectedTotals = selectedTotals.adding(period.totals(for: selectedAgents))
      for agent in period.agents where selectedAgents.contains(agent.agent) {
        for item in agent.models {
          if let current = modelsByName[item.model] {
            modelsByName[item.model] = LocalUsageModel(
              model: item.model,
              totals: current.totals.adding(item.totals),
              fallback: current.fallback || item.fallback,
              priced: current.priced && item.priced
            )
          } else {
            modelsByName[item.model] = item
          }
        }
      }
    }

    let matchingSessions = report.sessions(
      for: selectedAgents,
      window: window,
      referenceDate: referenceDate
    )
    let trendLimit =
      switch scale {
      case .day: 180
      case .week: 24
      case .month: 18
      }
    let trendPeriods = report.periods(for: scale, window: window, referenceDate: referenceDate)
      .suffix(trendLimit)

    totals = selectedTotals
    activeDays = dayPeriods.count
    sessionCount = matchingSessions.count
    recentSessions = Array(matchingSessions.prefix(8))
    models = modelsByName.values.sorted {
      $0.totals.generatedTokens > $1.totals.generatedTokens
    }
    trend = trendPeriods.map {
      UsageTrendPoint(
        period: $0.period,
        generatedTokens: $0.totals(for: selectedAgents).generatedTokens
      )
    }
    trendPeriodKeys = trendPeriods.map(\.period)

    // Model dimension: per-period model totals restricted to selected agents,
    // taken from the same normalized report as the chart — the breakdown and
    // the stacked segments therefore reconcile exactly.
    var modelAcc: [String: [UsageSeriesPoint]] = [:]
    for (index, period) in trendPeriods.enumerated() {
      for agent in period.agents where selectedAgents.contains(agent.agent) {
        for item in agent.models {
          var points = modelAcc[item.model]
            ?? Array(repeating: UsageSeriesPoint(), count: trendPeriods.count)
          points[index].tokens &+= item.totals.generatedTokens
          points[index].costUSD += item.totals.costUSD
          points[index].cacheReadTokens &+= item.totals.cacheReadTokens
          modelAcc[item.model] = points
        }
      }
    }
    modelSeries = modelAcc.map { name, points in
      UsageTrendSeries(name: name, detail: nil, points: points)
    }.sorted { $0.totalTokens > $1.totalTokens }

    // Project dimension: ccusage does not emit per-period project rows, so
    // sessions — which carry recovered project paths — are bucketed by their
    // last-activity day into the visible scale periods. Session totals count
    // once on that day only; they are never spread across a range. The day→
    // period-key map is built once so 2.5k-session projections stay cheap.
    var reportCalendar = Calendar(identifier: .gregorian)
    reportCalendar.timeZone = TimeZone(identifier: report.provenance.timezone) ?? .current
    var dayToPeriodIndex: [String: Int] = [:]
    for (index, key) in trendPeriodKeys.enumerated() {
      for day in Self.days(coveredBy: key, scale: scale, calendar: reportCalendar) {
        dayToPeriodIndex[day] = index
      }
    }
    let offsetSeconds = reportCalendar.timeZone.secondsFromGMT()
    var projectAcc: [String: [UsageSeriesPoint]] = [:]
    var projectBreakdownAcc: [String: (tokens: UInt64, costUSD: Double, detail: String?)] = [:]
    var attributed = 0
    for session in matchingSessions {
      let project = session.project
      if project != nil { attributed += 1 }
      let name = Self.projectName(project)
      let detail = Self.projectDetail(project)
      var row = projectBreakdownAcc[name] ?? (0, 0, detail)
      row.tokens &+= session.totals.generatedTokens
      row.costUSD += session.totals.costUSD
      projectBreakdownAcc[name] = row
      guard let activity = session.lastActivity,
            let day = Self.activityDay(activity, offsetSeconds: offsetSeconds, calendar: reportCalendar),
            let index = dayToPeriodIndex[day] else {
        continue
      }
      var points = projectAcc[name]
        ?? Array(repeating: UsageSeriesPoint(), count: trendPeriods.count)
      points[index].tokens &+= session.totals.generatedTokens
      points[index].costUSD += session.totals.costUSD
      points[index].cacheReadTokens &+= session.totals.cacheReadTokens
      projectAcc[name] = points
    }
    attributedSessionCount = attributed
    projectSeries = projectAcc.map { name, points in
      UsageTrendSeries(name: name, detail: projectBreakdownAcc[name]?.detail, points: points)
    }.sorted { $0.totalTokens > $1.totalTokens }
    projectBreakdown = projectBreakdownAcc.map { name, row in
      UsageBreakdownRow(name: name, detail: row.detail, tokens: row.tokens, costUSD: row.costUSD)
    }.sorted { $0.tokens > $1.tokens }
  }

  private static func projectName(_ project: String?) -> String {
    guard let project, let last = project.split(separator: "/").last else {
      return "Unattributed"
    }
    return String(last)
  }

  private static func projectDetail(_ project: String?) -> String? {
    project
  }

  /// Expands a ccusage period key into the report-timezone `YYYY-MM-DD` days
  /// it covers: the key itself for day, the seven days opening on the
  /// Monday-start key for week, every day of `YYYY-MM` for month.
  private static func days(coveredBy key: String, scale: UsageScale, calendar: Calendar) -> [String] {
    switch scale {
    case .day:
      return key.count == 10 ? [key] : []
    case .month:
      guard key.count == 7 else { return [] }
      return (1...31).compactMap { day in
        let candidate = "\(key)-\(String(format: "%02d", day))"
        return dayExists(candidate, calendar: calendar) ? candidate : nil
      }
    case .week:
      guard key.count == 10, let start = date(forDay: key, calendar: calendar) else { return [] }
      return (0..<7).compactMap { offset in
        calendar.date(byAdding: .day, value: offset, to: start).map {
          dayString($0, calendar: calendar)
        }
      }
    }
  }

  /// Extracts the report-timezone day for an ISO `lastActivity` without a
  /// full date parse: UTC day/time fields are sliced out and shifted by the
  /// timezone offset, crossing a day boundary only when the shift demands it.
  private static func activityDay(_ activity: String, offsetSeconds: Int, calendar: Calendar)
    -> String?
  {
    guard activity.count >= 16 else { return nil }
    let day = String(activity.prefix(10))
    guard let utcDay = date(forDay: day, calendar: calendar),
          let hour = Int(activity.dropFirst(11).prefix(2)),
          let minute = Int(activity.dropFirst(14).prefix(2)) else { return nil }
    let shifted = hour * 3600 + minute * 60 + offsetSeconds
    let shiftDays = Int(floor(Double(shifted) / 86_400))
    guard shiftDays != 0 else { return day }
    return calendar.date(byAdding: .day, value: shiftDays, to: utcDay).map {
      dayString($0, calendar: calendar)
    }
  }

  private static func date(forDay day: String, calendar: Calendar) -> Date? {
    var components = DateComponents()
    components.year = Int(day.prefix(4))
    components.month = Int(day.dropFirst(5).prefix(2))
    components.day = Int(day.dropFirst(8).prefix(2))
    return calendar.date(from: components)
  }

  private static func dayExists(_ day: String, calendar: Calendar) -> Bool {
    guard let date = date(forDay: day, calendar: calendar) else { return false }
    return dayString(date, calendar: calendar) == day
  }

  private static func dayString(_ date: Date, calendar: Calendar) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }
}

struct PremiumUsageView: View {
  @Bindable var model: WorkbenchModel
  @State private var localDetailsExpanded = false

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      usageDesk
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(EvidenceStyle.canvas)
    .onAppear { model.setUsageAutoRefreshSuspended(!NSApp.isActive) }
    .task {
      await model.prepareUsage()
      await model.runUsageAutoRefresh()
    }
    .onReceive(
      NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
    ) { _ in
      model.usageWindowBecameActive()
    }
    .onReceive(
      NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)
    ) { _ in
      model.setUsageAutoRefreshSuspended(true)
    }
  }

  private var header: some View {
    PremiumPageHeader(
      eyebrow: "Allowance and local history",
      title: "Usage",
      subtitle: "Live Claude and Codex allowance first, then bounded usage from local agent logs"
    ) {
      if let report = model.usageReport {
        let showingSavedData =
          model.usageShowingSavedSnapshot || model.providerQuotaShowingSavedSnapshot
        StatusPill(
          label: showingSavedData
            ? (model.usageLoading || model.providerQuotaLoading
              ? "Saved data · updating" : "Saved data")
            : report.status.label,
          color: showingSavedData ? EvidenceStyle.amber : report.status.color
        )
      }
      if let collectedAt = model.usageLastLoadedAt {
        Text("Updated \(Text(collectedAt, style: .relative)) ago")
          .font(.system(size: 10, weight: .medium, design: .monospaced))
          .foregroundStyle(.secondary)
          .monospacedDigit()
          .accessibilityLabel("Usage collected")
      }
      Button {
        model.loadUsage(refresh: true)
        model.loadProviderQuota()
      } label: {
        Label(
          model.usageLoading || model.providerQuotaLoading ? "Refreshing" : "Refresh",
          systemImage: "arrow.clockwise"
        )
      }
      .buttonStyle(.bordered)
      .disabled(model.usageLoading || model.providerQuotaLoading)
      .accessibilityLabel("Usage refresh")
    }
  }

  private var usageDesk: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        providerAllowance
        historicalUsage
        devinUsage

        Button {
          withAnimation(.easeInOut(duration: 0.18)) {
            localDetailsExpanded.toggle()
          }
        } label: {
          HStack(spacing: 8) {
            Image(systemName: "chart.bar.xaxis")
            Text(localDetailsExpanded ? "Hide usage diagnostics" : "Show usage diagnostics")
            Spacer()
            Image(systemName: localDetailsExpanded ? "chevron.up" : "chevron.down")
          }
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 14)
          .premiumHitTarget(minHeight: 40)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
          localDetailsExpanded ? "Hide usage diagnostics" : "Show usage diagnostics")

        if localDetailsExpanded {
          localUsageDetails
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
      }
      .padding(.horizontal, PremiumPageLayout.horizontalInset)
      .padding(.vertical, 14)
    }
  }

  @ViewBuilder
  private var historicalUsage: some View {
    if let report = model.usageReport {
      trendPanel(report, projection: model.usageProjection(for: report))
    }
  }

  // Devin is indexed from its own SQLite history and is never folded into the
  // ccusage totals above, so it reads as its own desk rather than a diagnostic.
  @ViewBuilder
  private var devinUsage: some View {
    if let devin = model.usageReport?.devin {
      devinPanel(devin)
    }
  }

  @ViewBuilder
  private var providerAllowance: some View {
    if let receipt = model.providerQuotaReceipt {
      HStack(alignment: .top, spacing: 12) {
        ForEach(receipt.providers) { provider in
          ProviderAllowanceCard(provider: provider)
        }
      }
    } else if model.providerQuotaLoading {
      allowanceStatus(
        icon: "arrow.triangle.2.circlepath",
        title: "Checking Claude and Codex…",
        detail: "Provider allowance loads independently from local activity.",
        color: EvidenceStyle.amber
      )
    } else {
      allowanceStatus(
        icon: "exclamationmark.triangle.fill",
        title: "Usage allowance unavailable",
        detail: model.providerQuotaIssue ?? "Press Refresh to check both providers.",
        color: EvidenceStyle.warning
      )
    }
  }

  private func allowanceStatus(icon: String, title: String, detail: String, color: Color)
    -> some View
  {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(color)
        .frame(width: 34, height: 34)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.system(size: 13, weight: .semibold))
        Text(detail).font(.system(size: 10)).foregroundStyle(.secondary)
      }
      Spacer()
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  @ViewBuilder
  private var localUsageDetails: some View {
    if let report = model.usageReport {
      let projection = model.usageProjection(for: report)
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          VStack(alignment: .leading, spacing: 3) {
            PremiumFieldLabel("LOCAL ACTIVITY · NOT PROVIDER ALLOWANCE")
            Text("Token and session evidence")
              .font(.system(size: 14, weight: .semibold))
          }
          Spacer()
          StatusPill(label: report.status.label, color: report.status.color)
        }
        metrics(report, projection: projection)
        adapterHealth(report)
        HStack(alignment: .top, spacing: 14) {
          modelPanel(projection)
          sessionsPanel(projection)
        }
      }
    } else {
      allowanceStatus(
        icon: model.usageLoading ? "arrow.triangle.2.circlepath" : "chart.bar.xaxis",
        title: model.usageLoading ? "Loading local activity…" : "Local activity unavailable",
        detail: model.usageIssue ?? "Local activity is optional and does not affect allowance.",
        color: model.usageLoading ? EvidenceStyle.amber : EvidenceStyle.warning
      )
    }
  }

  private func devinPanel(_ summary: DevinUsageSummary) -> some View {
    let projection = summary.projection(for: model.usageWindow)
    let availability = summary.availability(for: model.usageWindow)
    let title =
      switch availability {
      case .unavailable: "Devin local history unavailable"
      case .active: "Indexed Devin activity"
      case .empty: "No Devin activity \(model.usageWindow.description)"
      }
    let pillLabel =
      switch availability {
      case .unavailable: "unavailable"
      case .empty: "empty"
      case .active: "\(model.usageWindow.rawValue) local history"
      }
    return VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .center, spacing: 18) {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("DEVIN · SEPARATE LOCAL SOURCE")
          Text(title)
            .font(.system(size: 15, weight: .semibold))
          Text(summary.source)
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        .frame(width: 260, alignment: .leading)
        Divider().frame(height: 48)
        devinMetric(
          value: compact(UInt64(max(projection.sessions, 0))),
          label: "SESSIONS"
        )
        devinMetric(
          value: compact(UInt64(max(projection.generatedTokens, 0))),
          label: "GENERATED"
        )
        devinMetric(
          value: compact(UInt64(max(projection.cacheReadTokens, 0))),
          label: "CACHE READ"
        )
        devinMetric(
          value: currency(projection.costUSD),
          label: "LOCAL COST"
        )
        Spacer(minLength: 0)
        StatusPill(
          label: pillLabel,
          color: availability == .active ? EvidenceStyle.success : EvidenceStyle.warning
        )
      }

      HStack(spacing: 6) {
        if !projection.models.isEmpty {
          ForEach(projection.models.prefix(6)) { model in
            HStack(spacing: 6) {
              Text(model.model)
              Text(compact(UInt64(max(model.generatedTokens, 0))))
                .foregroundStyle(.secondary)
            }
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .padding(.horizontal, 9)
            .frame(height: 27)
            .background(EvidenceStyle.inspector, in: Capsule())
            .overlay { Capsule().stroke(EvidenceStyle.separator) }
          }
        }
        Spacer(minLength: 10)
        Text(summary.limitations.joined(separator: " · "))
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(.secondary)
          .lineLimit(2)
          .multilineTextAlignment(.trailing)
      }
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Separate Devin local usage")
  }

  private func devinMetric(value: String, label: String) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(value)
        .font(.system(size: 16, weight: .semibold, design: .monospaced))
      Text(label)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .tracking(0.8)
        .foregroundStyle(.secondary)
    }
    .frame(minWidth: 88, alignment: .leading)
  }

  private func metrics(_ report: LocalUsageReport, projection: UsageViewProjection) -> some View {
    HStack(spacing: 8) {
      UsageMetricCard(
        value: compact(projection.totals.generatedTokens),
        label: "GENERATED TOKENS",
        detail: model.usageWindow.description
      )
      UsageMetricCard(
        value: compact(projection.totals.cacheReadTokens),
        label: "CACHE READ",
        detail: cacheShare(projection.totals)
      )
      UsageMetricCard(
        value: currency(projection.totals.costUSD),
        label: "LOCAL LOG COST",
        detail: report.provenance.pricingComplete ? "priced models complete" : "pricing has gaps"
      )
      UsageMetricCard(
        value: compact(UInt64(projection.sessionCount)),
        label: "SESSIONS",
        detail: "\(projection.activeDays) active days"
      )
    }
  }

  private func trendPanel(_ report: LocalUsageReport, projection: UsageViewProjection) -> some View
  {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("LOCAL HISTORY · NOT PROVIDER ALLOWANCE")
          Text("Historical usage")
            .font(.system(size: 15, weight: .semibold))
          Text(
            model.usageMetric.caption
          )
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 6) {
          UsageWindowSwitch(selection: $model.usageWindow, scale: $model.usageScale)
          UsageScaleSwitch(selection: $model.usageScale)
        }
      }

      HStack(spacing: 6) {
        ForEach(report.provenance.detectedAgents, id: \.self) { agent in
          let selected = model.usageSelectedAgents.contains(agent)
          Button {
            model.toggleUsageAgent(agent)
          } label: {
            HStack(spacing: 5) {
              Circle().fill(agentColor(agent)).frame(width: 6, height: 6)
              Text(agent.capitalized)
            }
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(selected ? EvidenceStyle.amberForeground : Color.secondary)
            .padding(.horizontal, 10)
            .premiumHitTarget(minWidth: 70, minHeight: 36)
            .overlay(alignment: .bottom) {
              Rectangle()
                .fill(selected ? EvidenceStyle.amberForeground : EvidenceStyle.separator)
                .frame(height: selected ? 2 : 1)
            }
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Filter \(agent.capitalized)")
          .accessibilityValue(selected ? "Included" : "Excluded")
        }
        Spacer()
        UsageOptionSwitch(selection: $model.usageDimension)
        UsageOptionSwitch(selection: $model.usageMetric)
      }

      UsageHistoryView(
        history: projection.history, pricingComplete: report.provenance.pricingComplete)
    }
    .padding(16)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func adapterHealth(_ report: LocalUsageReport) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        PremiumFieldLabel("ADAPTER HEALTH")
        Spacer()
        Circle().fill(report.status.color).frame(width: 7, height: 7)
      }
      UsageFact(label: "ENGINE", value: "\(report.provenance.engine) \(report.provenance.version)")
      UsageFact(label: "TIMEZONE", value: report.provenance.timezone)
      UsageFact(label: "WINDOW", value: report.provenance.window)
      UsageFact(
        label: "PRICING",
        value: report.provenance.pricingComplete ? "Complete" : "Review gaps",
        color: report.provenance.pricingComplete ? EvidenceStyle.success : EvidenceStyle.warning
      )
      UsageFact(
        label: "SOURCE",
        value: report.provenance.sourceFingerprint.isEmpty
          ? "Unavailable" : String(report.provenance.sourceFingerprint.prefix(22)) + "…"
      )
      if !report.provenance.fallbackModels.isEmpty {
        Divider()
        PremiumFieldLabel("FALLBACK PRICING")
        Text(report.provenance.fallbackModels.joined(separator: " · "))
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(EvidenceStyle.warning)
          .lineLimit(3)
      }
      if let error = report.error {
        Divider()
        Label(error.message, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 10))
          .foregroundStyle(EvidenceStyle.warning)
      }
      Spacer(minLength: 0)
      Text("Read-only · offline · no quota inference")
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
        .foregroundStyle(.secondary)
    }
    .padding(18)
    .frame(minHeight: 286, alignment: .topLeading)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func modelPanel(_ projection: UsageViewProjection) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("MODEL MIX")
          Text("Work by model").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Text("generated")
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(16)
      Divider()
      let rows = projection.models
      if rows.isEmpty {
        Text("No model activity in this local report.")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .padding(18)
      } else {
        ForEach(rows.prefix(8)) { row in
          HStack(spacing: 10) {
            Circle().fill(row.priced ? EvidenceStyle.success : EvidenceStyle.warning)
              .frame(width: 6, height: 6)
            Text(row.model)
              .font(.system(size: 10, weight: .medium, design: .monospaced))
              .lineLimit(1)
            if row.fallback {
              Text("FALLBACK")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(EvidenceStyle.warning)
            }
            Spacer()
            Text(compact(row.totals.generatedTokens))
              .font(.system(size: 10, weight: .semibold, design: .monospaced))
          }
          .padding(.horizontal, 16)
          .frame(height: 34)
          .overlay(alignment: .bottom) {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .clipShape(RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func sessionsPanel(_ projection: UsageViewProjection) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("RECENT SESSIONS")
          Text("Local agent activity").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Text("showing \(projection.recentSessions.count) of \(projection.sessionCount)")
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(16)
      Divider()
      let sessions = projection.recentSessions
      if sessions.isEmpty {
        Text("No sessions match the selected agents.")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .padding(18)
      } else {
        ForEach(sessions) { session in
          HStack(spacing: 10) {
            Circle().fill(agentColor(session.agent)).frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 2) {
              Text(session.agent.capitalized)
                .font(.system(size: 10, weight: .semibold))
              Text(session.lastActivity ?? session.sessionID)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer()
            Text(compact(session.totals.generatedTokens))
              .font(.system(size: 10, weight: .semibold, design: .monospaced))
          }
          .padding(.horizontal, 16)
          .frame(height: 42)
          .overlay(alignment: .bottom) {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .clipShape(RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private var loadingDesk: some View {
    VStack(spacing: 14) {
      ProgressView().controlSize(.small)
      Text("Reading local usage evidence…")
        .font(.system(size: 12, weight: .medium))
      Text("The Rust adapter is normalizing pinned ccusage output offline.")
        .font(.system(size: 10))
        .foregroundStyle(.secondary)
    }
  }

  private var unavailableDesk: some View {
    ContentUnavailableView(
      "Local usage unavailable",
      systemImage: "chart.bar.xaxis",
      description: Text(
        model.usageIssue
          ?? "Refresh to read Claude, Codex, and Grok activity from the pinned local adapter."
      )
    )
  }

}

/// Allowance health bands approved for the unified Usage card: red at or
/// under 20 percent remaining, yellow through 40, green above, with zero
/// called out as exhausted. Pace is reported separately and only when the
/// provider window's duration/reset metadata is trustworthy.
private func allowanceHealth(_ remaining: Double) -> (label: String, color: Color) {
  switch remaining {
  case ..<Double.leastNonzeroMagnitude: ("Exhausted", EvidenceStyle.failure)
  case ...20: ("Low", EvidenceStyle.failure)
  case ...40: ("Watch", EvidenceStyle.warning)
  default: ("Healthy", EvidenceStyle.success)
  }
}

private struct ProviderAllowanceCard: View {
  let provider: ProviderQuotaStatus

  private var accent: Color {
    guard isDisplayReady else { return Color.secondary }
    return allowanceHealth(worstRemaining).color
  }

  private var worstRemaining: Double {
    visibleWindows.map(\.remainingPercent).min() ?? 100
  }

  private var displayName: String {
    provider.provider == "claude" ? "Claude" : "Codex"
  }

  private var isDisplayReady: Bool {
    provider.isReady && !visibleWindows.isEmpty
  }

  private var availabilityLabel: String {
    guard isDisplayReady else { return "ALLOWANCE UNAVAILABLE" }
    return "ALLOWANCE \(allowanceHealth(worstRemaining).label.uppercased())"
  }

  private var visibleWindows: [ProviderQuotaWindow] {
    if provider.provider == "claude" {
      return Array(
        provider.windows.filter {
          !$0.id.localizedCaseInsensitiveContains("model")
            && !$0.id.localizedCaseInsensitiveContains("fable")
        }.prefix(2))
    }
    return Array(provider.windows.prefix(1))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 9) {
        ProviderBrandMark(provider: provider.provider, accent: accent)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Text(displayName).font(.system(size: 14, weight: .semibold))
            if let plan = provider.plan {
              Text(plan.uppercased())
                .font(.caption2.weight(.bold).monospaced())
                .foregroundStyle(.secondary)
            }
          }
          Text(availabilityLabel)
            .font(.caption2.weight(.bold).monospaced())
            .tracking(0.5)
            .foregroundStyle(isDisplayReady ? accent : EvidenceStyle.warning)
        }
        Spacer()
        Circle()
          .fill(isDisplayReady ? accent : EvidenceStyle.warning)
          .frame(width: 7, height: 7)
      }
      .help(provider.source)

      if isDisplayReady {
        HStack(alignment: .top, spacing: 26) {
          ForEach(visibleWindows) { window in
            allowanceValue(window)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        HStack(spacing: 14) {
          if let credits = provider.credits, let creditText = creditText(credits) {
            Label(creditText, systemImage: "creditcard.fill")
          }
          if let count = provider.resetCredits {
            Label(
              "\(count) full \(count == 1 ? "reset" : "resets") available",
              systemImage: "arrow.counterclockwise.circle.fill")
          }
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
      } else {
        Text(provider.message ?? "Provider quota is unavailable.")
          .font(.caption)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, minHeight: 172, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("provider-allowance-\(provider.provider)")
  }

  private func allowanceValue(_ window: ProviderQuotaWindow) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(window.label.replacingOccurrences(of: " window", with: "").uppercased())
        .font(.caption2.weight(.bold).monospaced())
        .tracking(0.55)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      Text("\(window.remainingPercent, specifier: "%.0f")%")
        .font(.system(size: 32, weight: .semibold, design: .rounded))
        .foregroundStyle(allowanceHealth(window.remainingPercent).color)
      HStack(spacing: 5) {
        Text("remaining")
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(allowanceHealth(window.remainingPercent).label)
          .font(.caption2.weight(.bold).monospaced())
          .foregroundStyle(allowanceHealth(window.remainingPercent).color)
      }
      GeometryReader { geometry in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.primary.opacity(0.07))
          Capsule()
            .fill(allowanceHealth(window.remainingPercent).color)
            .frame(
              width: geometry.size.width * max(0, min(window.remainingPercent / 100, 1)))
        }
      }
      .frame(height: 4)
      if let pace = paceLabel(window) {
        Text(pace)
          .font(.caption2.monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      if let reset = resetLabel(window) {
        Text(reset)
          .font(.caption2.monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .frame(minWidth: 130, maxWidth: 190, alignment: .leading)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(
      [
        "\(window.label), \(Int(window.remainingPercent.rounded())) percent remaining",
        resetLabel(window),
      ].compactMap { $0 }.joined(separator: ". "))
  }

  private func creditText(_ credits: ProviderCreditBalance) -> String? {
    if let limit = credits.limitAmount, let used = credits.usedAmount {
      return "$\(Int(max(0, limit - used).rounded())) credits"
    }
    if let remaining = credits.remainingPercent {
      return "\(Int(remaining.rounded()))% credits"
    }
    return nil
  }

  /// Pace compares allowance remaining with the fraction of the provider
  /// window still open — percentage points over or under an even-use rate,
  /// never a spending forecast. Shown only when duration and reset metadata
  /// are both trustworthy; otherwise pace stays silent rather than healthy.
  private func paceLabel(_ window: ProviderQuotaWindow) -> String? {
    guard let duration = window.windowDurationMinutes, duration > 0,
          let resetsAt = window.resetsAtUnix else { return nil }
    let now = Date().timeIntervalSince1970
    let windowSeconds = Double(duration) * 60
    let remaining = (Double(resetsAt) - now) / windowSeconds
    guard remaining > 0, remaining <= 1 else { return nil }
    let delta = window.remainingPercent - remaining * 100
    if abs(delta) < 1 { return "On even-use pace" }
    return delta > 0
      ? "+\(Int(delta.rounded())) pts ahead of even pace"
      : "\(Int(delta.rounded())) pts behind even pace"
  }

  private func resetLabel(_ window: ProviderQuotaWindow) -> String? {
    if let description = window.resetDescription {
      return "Resets \(description)"
    }
    guard let timestamp = window.resetsAtUnix else { return nil }
    let date = Date(timeIntervalSince1970: TimeInterval(timestamp))
    return "Resets \(date.formatted(date: .abbreviated, time: .shortened))"
  }
}

enum ProviderBrandAsset {
  private static let images: [String: NSImage] = Dictionary(
    uniqueKeysWithValues: ["claude", "codex"].compactMap { provider in
      guard let url = resourceURL(for: provider), let image = NSImage(contentsOf: url) else {
        return nil
      }
      return (provider, image)
    })

  static func resourceURL(for provider: String) -> URL? {
    Bundle.module.url(forResource: "provider-\(provider)", withExtension: "svg")
  }

  static func image(for provider: String) -> NSImage? {
    images[provider]
  }
}

private struct ProviderBrandMark: View {
  let provider: String
  let accent: Color

  var body: some View {
    Group {
      if let image = ProviderBrandAsset.image(for: provider) {
        Image(nsImage: image)
          .renderingMode(provider == "codex" ? .template : .original)
          .resizable()
          .scaledToFit()
          .foregroundStyle(provider == "codex" ? Color.primary : accent)
      } else {
        Image(systemName: provider == "claude" ? "sparkles" : "terminal.fill")
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(accent)
      }
    }
    .frame(width: 26, height: 26)
    .padding(7)
    .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
    .accessibilityHidden(true)
  }
}

private struct UsageMetricCard: View {
  let value: String
  let label: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(value).font(.system(size: 24, weight: .medium, design: .rounded))
      PremiumFieldLabel(label)
      Text(detail).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }
}

private struct UsageFact: View {
  let label: String
  let value: String
  var color: Color = .primary

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .foregroundStyle(color)
        .lineLimit(1)
    }
  }
}

private struct UsageScaleSwitch: View {
  @Binding var selection: UsageScale

  var body: some View {
    HStack(spacing: 3) {
      ForEach(UsageScale.allCases) { scale in
        Button {
          selection = scale
        } label: {
          Text(scale.rawValue)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(
              selection == scale ? EvidenceStyle.amberForeground : Color.secondary
            )
            .premiumHitTarget(minWidth: 58, minHeight: 34)
            .overlay(alignment: .bottom) {
              Rectangle()
                .fill(selection == scale ? EvidenceStyle.amberForeground : Color.clear)
                .frame(height: 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityValue(selection == scale ? "Selected" : "")
        .accessibilityAddTraits(selection == scale ? .isSelected : [])
      }
    }
    .padding(3)
    .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))
    .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Usage scale")
  }
}

private struct UsageWindowSwitch: View {
  @Binding var selection: UsageWindow
  @Binding var scale: UsageScale

  var body: some View {
    HStack(spacing: 3) {
      ForEach(UsageWindow.allCases) { window in
        Button {
          selection = window
          if window == .oneWeek { scale = .day }
        } label: {
          Text(window.rawValue)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(
              selection == window ? EvidenceStyle.amberForeground : Color.secondary
            )
            .premiumHitTarget(minWidth: 40, minHeight: 34)
            .padding(.horizontal, 3)
            .overlay(alignment: .bottom) {
              Rectangle()
                .fill(selection == window ? EvidenceStyle.amberForeground : Color.clear)
                .frame(height: 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(window.description)
        .accessibilityValue(selection == window ? "Selected" : "")
        .accessibilityAddTraits(selection == window ? .isSelected : [])
      }
    }
    .padding(3)
    .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))
    .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Usage time range")
  }
}

/// Small segmented switch shared by the unified history card's dimension and
/// metric toggles, matching the window/scale switch styling.
private struct UsageOptionSwitch<Option: RawRepresentable & CaseIterable & Identifiable & Hashable>: View
where Option.RawValue == String
{
  @Binding var selection: Option

  var body: some View {
    HStack(spacing: 3) {
      ForEach(Array(Option.allCases), id: \.self) { option in
        Button {
          selection = option
        } label: {
          Text(option.rawValue)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(
              selection == option ? EvidenceStyle.amberForeground : Color.secondary
            )
            .premiumHitTarget(minWidth: 52, minHeight: 34)
            .overlay(alignment: .bottom) {
              Rectangle()
                .fill(selection == option ? EvidenceStyle.amberForeground : Color.clear)
                .frame(height: 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityValue(selection == option ? "Selected" : "")
        .accessibilityAddTraits(selection == option ? .isSelected : [])
      }
    }
    .padding(3)
    .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))
    .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
  }
}

/// Restrained series palette for the unified history chart. Model identity
/// stays in blue/lavender/neutral territory per the approved direction; quota
/// semantics keep red/yellow/green exclusively for allowance.
private let usageSeriesPalette: [Color] = [
  Color(red: 0.43, green: 0.63, blue: 0.96),
  Color(red: 0.62, green: 0.55, blue: 0.90),
  Color(red: 0.36, green: 0.72, blue: 0.66),
  Color(red: 0.85, green: 0.65, blue: 0.45),
  Color(red: 0.60, green: 0.64, blue: 0.70),
]

private func usageSeriesColor(_ index: Int) -> Color {
  usageSeriesPalette[index % usageSeriesPalette.count]
}

/// Stacked per-period bars sharing the exact series the ranked breakdown
/// lists, so segments and row totals always reconcile. The top five entities
/// render individually; the remainder collapse into Other.
private struct UsageStackedChart: View {
  let series: [UsageTrendSeries]
  let periodKeys: [String]
  let metric: UsageHistoryMetric
  let scale: UsageScale

  private var visibleSeries: [(name: String, points: [UsageSeriesPoint])] {
    let head = series.prefix(5).map { ($0.name, $0.points) }
    guard series.count > 5 else { return head }
    var other = Array(repeating: UsageSeriesPoint(), count: periodKeys.count)
    for tail in series.dropFirst(5) {
      for (index, point) in tail.points.enumerated() {
        other[index].tokens &+= point.tokens
        other[index].costUSD += point.costUSD
      }
    }
    return head + [("Other", other)]
  }

  private func color(for name: String, index: Int) -> Color {
    if name == "Unattributed" || name == "Other" { return Color.secondary.opacity(0.35) }
    return usageSeriesColor(index)
  }

  private func value(_ point: UsageSeriesPoint) -> Double {
    point.value(for: metric)
  }

  private func format(_ value: Double) -> String {
    metric == .tokens ? compact(UInt64(max(value, 0))) : currency(value)
  }

  var body: some View {
    let visible = visibleSeries
    if visible.isEmpty || periodKeys.isEmpty {
      ContentUnavailableView("No local activity", systemImage: "chart.bar")
    } else {
      GeometryReader { geometry in
        let periodTotals = periodKeys.indices.map { index in
          visible.reduce(0.0) { $0 + value($1.points[index]) }
        }
        let maximum = max(periodTotals.max() ?? 0, 1e-9)
        ZStack(alignment: .bottom) {
          HStack(alignment: .bottom, spacing: scale == .day ? 3 : 7) {
            ForEach(periodKeys.indices, id: \.self) { periodIndex in
              VStack(spacing: 0) {
                ForEach(visible.indices.reversed(), id: \.self) { seriesIndex in
                  let share = value(visible[seriesIndex].points[periodIndex]) / maximum
                  Rectangle()
                    .fill(color(for: visible[seriesIndex].name, index: seriesIndex))
                    .frame(
                      height: max(
                        share > 0 ? 2 : 0,
                        (geometry.size.height - 22) * CGFloat(share)
                      )
                    )
                }
              }
              .clipShape(RoundedRectangle(cornerRadius: 3))
              .help(
                "\(periodKeys[periodIndex]): "
                  + visible
                    .filter { value($0.points[periodIndex]) > 0 }
                    .map { "\($0.name) \(format(value($0.points[periodIndex])))" }
                    .joined(separator: " · ")
              )
              .frame(maxWidth: .infinity)
              .accessibilityElement(children: .ignore)
              .accessibilityLabel(periodKeys[periodIndex])
              .accessibilityValue(format(periodTotals[periodIndex]))
            }
          }
          .padding(.bottom, 18)
          .overlay(alignment: .bottom) {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1).offset(y: -17)
          }
          HStack {
            Text(shortLabel(periodKeys.first ?? ""))
            Spacer()
            Text(shortLabel(periodKeys.last ?? ""))
          }
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(.secondary)
        }
      }
    }
  }

  private func shortLabel(_ value: String) -> String {
    if value.count > 7 { return String(value.suffix(5)) }
    return value
  }
}

/// Ranked exact-value rows for the same series the chart stacks, with a share
/// bar relative to the window total. Unknown project sessions stay visible as
/// Unattributed rather than disappearing.
private struct UsageBreakdownList: View {
  let series: [UsageTrendSeries]
  let metric: UsageHistoryMetric

  private var grandTotal: Double {
    series.reduce(0.0) { $0 + value($1) }
  }

  private func value(_ series: UsageTrendSeries) -> Double {
    metric == .tokens ? Double(series.totalTokens) : series.totalCostUSD
  }

  private func format(_ value: Double) -> String {
    metric == .tokens ? compact(UInt64(max(value, 0))) : currency(value)
  }

  var body: some View {
    let total = max(grandTotal, 1e-9)
    VStack(spacing: 0) {
      ForEach(Array(series.prefix(8).enumerated()), id: \.element.id) { index, row in
        HStack(spacing: 10) {
          Circle()
            .fill(row.name == "Unattributed" ? Color.secondary.opacity(0.35) : usageSeriesColor(index))
            .frame(width: 6, height: 6)
          VStack(alignment: .leading, spacing: 1) {
            Text(row.name)
              .font(.system(size: 10, weight: .medium, design: .monospaced))
              .lineLimit(1)
            if let detail = row.detail {
              Text(detail)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
                .truncationMode(.middle)
            }
          }
          GeometryReader { geometry in
            ZStack(alignment: .leading) {
              Capsule().fill(Color.primary.opacity(0.05))
              Capsule()
                .fill(row.name == "Unattributed" ? Color.secondary.opacity(0.3) : usageSeriesColor(index))
                .frame(width: geometry.size.width * min(value(row) / total, 1))
            }
          }
          .frame(width: 90, height: 3)
          Text(String(format: "%.0f%%", value(row) / total * 100))
            .font(.system(size: 9, design: .monospaced))
            .foregroundStyle(.secondary)
            .frame(width: 32, alignment: .trailing)
          Text(format(value(row)))
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .frame(minWidth: 52, alignment: .trailing)
        }
        .frame(height: row.detail == nil ? 30 : 38)
        .overlay(alignment: .bottom) {
          Rectangle().fill(EvidenceStyle.separator.opacity(0.6)).frame(height: 1)
        }
      }
      if series.count > 8 {
        Text("+ \(series.count - 8) more \(series.count - 8 == 1 ? "entry" : "entries")")
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
          .frame(height: 24)
      }
    }
  }
}

extension LocalUsageStatus {
  fileprivate var label: String {
    switch self {
    case .ready: "Local data ready"
    case .stale: "Showing stale data"
    case .unavailable: "Adapter unavailable"
    }
  }

  fileprivate var color: Color {
    switch self {
    case .ready: EvidenceStyle.success
    case .stale: EvidenceStyle.warning
    case .unavailable: EvidenceStyle.failure
    }
  }
}

private func compact(_ value: UInt64) -> String {
  switch value {
  case 1_000_000_000...: String(format: "%.1fB", Double(value) / 1_000_000_000)
  case 1_000_000...: String(format: "%.1fM", Double(value) / 1_000_000)
  case 1_000...: String(format: "%.1fK", Double(value) / 1_000)
  default: String(value)
  }
}

private func currency(_ value: Double) -> String {
  if value >= 1_000 {
    return String(format: "$%.1fK", value / 1_000)
  }
  return String(format: "$%.2f", value)
}

private func cacheShare(_ totals: LocalUsageTotals) -> String {
  guard totals.totalTokens > 0 else { return "no token activity" }
  return String(
    format: "%.0f%% of all tokens",
    Double(totals.cacheReadTokens) / Double(totals.totalTokens) * 100
  )
}

private func agentColor(_ agent: String) -> Color {
  switch agent {
  case "claude": Color(red: 0.91, green: 0.47, blue: 0.28)
  case "codex": EvidenceStyle.success
  case "grok": Color(red: 0.43, green: 0.63, blue: 0.96)
  default: EvidenceStyle.amber
  }
}
