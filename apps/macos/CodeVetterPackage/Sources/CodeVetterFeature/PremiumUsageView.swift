import SwiftUI

struct PremiumUsageView: View {
  @Bindable var model: WorkbenchModel

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      sourceBoundary(model.usageReport)
        .padding(.horizontal, 18)
        .padding(.top, 14)
      Group {
        if let report = model.usageReport {
          reportDesk(report)
        } else if model.usageLoading {
          loadingDesk
        } else {
          unavailableDesk
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(EvidenceStyle.canvas)
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 18) {
      VStack(alignment: .leading, spacing: 5) {
        Text("LOCAL COMPUTE LEDGER")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.1)
          .foregroundStyle(EvidenceStyle.amberForeground)
        Text("Usage").font(.system(size: 25, weight: .semibold))
        Text("Token, cache, cost, model, and session evidence from local agent logs")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer()
      if let report = model.usageReport {
        StatusPill(label: report.status.label, color: report.status.color)
      }
      Button {
        model.loadUsage(refresh: true)
      } label: {
        Label(model.usageLoading ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
      }
      .buttonStyle(.bordered)
      .disabled(model.usageLoading)
      .accessibilityLabel("Usage refresh")
    }
    .padding(.horizontal, 22)
    .padding(.vertical, 18)
    .background(EvidenceStyle.chrome)
  }

  private func reportDesk(_ report: LocalUsageReport) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        metrics(report)
        if let devin = report.devin {
          devinPanel(devin)
        }
        HStack(alignment: .top, spacing: 14) {
          trendPanel(report)
            .frame(maxWidth: .infinity)
          adapterHealth(report)
            .frame(width: 285)
        }
        HStack(alignment: .top, spacing: 14) {
          modelPanel(report)
          sessionsPanel(report)
        }
      }
      .padding(.horizontal, 18)
      .padding(.vertical, 14)
    }
  }

  private func sourceBoundary(_ report: LocalUsageReport?) -> some View {
    HStack(spacing: 8) {
      UsageBoundaryCard(
        eyebrow: "ACCOUNTED HERE",
        title: "Claude · Codex · Grok",
        detail: "ccusage \(report?.provenance.version ?? "20.0.20") · offline local logs",
        icon: "checkmark.seal.fill",
        color: EvidenceStyle.success
      )
      UsageBoundaryCard(
        eyebrow: "SEPARATE SOURCE",
        title: "Devin activity",
        detail: devinBoundaryDetail(report?.devin),
        icon: "arrow.triangle.branch",
        color: EvidenceStyle.amber
      )
      UsageBoundaryCard(
        eyebrow: "SEPARATE TELEMETRY",
        title: "Provider quotas",
        detail: "Live limits never inferred from spend",
        icon: "gauge.open.with.lines.needle.33percent",
        color: EvidenceStyle.amber
      )
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Usage provider boundaries")
  }

  private func devinBoundaryDetail(_ summary: DevinUsageSummary?) -> String {
    guard let summary else { return "Local history unavailable · never folded into ccusage" }
    guard summary.status == "ready" else {
      return "No indexed sessions · never folded into ccusage"
    }
    let projection = summary.projection(for: model.usageWindow)
    let cost = currency(projection.costUSD)
    return "\(projection.sessions) sessions · \(cost) \(model.usageWindow.rawValue) · separate"
  }

  private func devinPanel(_ summary: DevinUsageSummary) -> some View {
    let projection = summary.projection(for: model.usageWindow)
    let title =
      projection.sessions > 0
      ? "Indexed Devin activity" : "No Devin activity \(model.usageWindow.description)"
    return VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .center, spacing: 18) {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("DEVIN · SEPARATE LOCAL SOURCE")
          Text(title)
            .font(.system(size: 15, weight: .semibold))
          Text(summary.source)
            .font(.system(size: 9, design: .monospaced))
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
          label: projection.sessions > 0 ? "\(model.usageWindow.rawValue) local history" : "empty",
          color: projection.sessions > 0 ? EvidenceStyle.success : EvidenceStyle.warning
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
            .font(.system(size: 9, weight: .semibold, design: .monospaced))
            .padding(.horizontal, 9)
            .frame(height: 27)
            .background(EvidenceStyle.inspector, in: Capsule())
            .overlay { Capsule().stroke(EvidenceStyle.separator) }
          }
        }
        Spacer(minLength: 10)
        Text(summary.limitations.joined(separator: " · "))
          .font(.system(size: 8, design: .monospaced))
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
        .font(.system(size: 8, weight: .bold, design: .monospaced))
        .tracking(0.8)
        .foregroundStyle(.secondary)
    }
    .frame(minWidth: 88, alignment: .leading)
  }

  private func metrics(_ report: LocalUsageReport) -> some View {
    let totals = selectedTotals(report)
    let sessions = filteredSessions(report)
    let activeDays = report.periods(for: .day, window: model.usageWindow).count
    return HStack(spacing: 8) {
      UsageMetric(
        value: compact(totals.generatedTokens),
        label: "GENERATED TOKENS",
        detail: model.usageWindow.description
      )
      UsageMetric(
        value: compact(totals.cacheReadTokens),
        label: "CACHE READ",
        detail: cacheShare(totals)
      )
      UsageMetric(
        value: currency(totals.costUSD),
        label: "LOCAL LOG COST",
        detail: report.provenance.pricingComplete ? "priced models complete" : "pricing has gaps"
      )
      UsageMetric(
        value: compact(UInt64(sessions.count)),
        label: "SESSIONS",
        detail: "\(activeDays) active days"
      )
    }
  }

  private func trendPanel(_ report: LocalUsageReport) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("LOCAL ACTIVITY")
          Text("Generated token trend")
            .font(.system(size: 15, weight: .semibold))
          Text("Selected agents only · cache reads remain a separate efficiency signal")
            .font(.system(size: 9))
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
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(selected ? Color.primary : Color.secondary)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(selected ? EvidenceStyle.amber.opacity(0.12) : Color.clear, in: Capsule())
            .overlay {
              Capsule().stroke(
                selected ? EvidenceStyle.amber.opacity(0.34) : EvidenceStyle.separator)
            }
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Filter \(agent.capitalized)")
          .accessibilityValue(selected ? "Included" : "Excluded")
        }
      }

      UsageTrendChart(
        periods: boundedPeriods(report),
        selectedAgents: model.usageSelectedAgents,
        scale: model.usageScale
      )
      .frame(height: 190)
    }
    .padding(18)
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
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(EvidenceStyle.warning)
          .lineLimit(3)
      }
      if let error = report.error {
        Divider()
        Label(error.message, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 9))
          .foregroundStyle(EvidenceStyle.warning)
      }
      Spacer(minLength: 0)
      Text("Read-only · offline · no quota inference")
        .font(.system(size: 8, weight: .semibold, design: .monospaced))
        .foregroundStyle(.secondary)
    }
    .padding(18)
    .frame(minHeight: 286, alignment: .topLeading)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func modelPanel(_ report: LocalUsageReport) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("MODEL MIX")
          Text("Work by model").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Text("generated")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(16)
      Divider()
      let rows = aggregateModels(report)
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
                .font(.system(size: 7, weight: .bold, design: .monospaced))
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

  private func sessionsPanel(_ report: LocalUsageReport) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("RECENT SESSIONS")
          Text("Local agent activity").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Text("showing \(min(filteredSessions(report).count, 8))")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(16)
      Divider()
      let sessions = Array(filteredSessions(report).prefix(8))
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
                .font(.system(size: 9, weight: .semibold))
              Text(session.lastActivity ?? session.sessionID)
                .font(.system(size: 8, design: .monospaced))
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

  private func boundedPeriods(_ report: LocalUsageReport) -> [LocalUsagePeriod] {
    let limit =
      switch model.usageScale {
      case .day: 180
      case .week: 24
      case .month: 18
      }
    return Array(
      report.periods(for: model.usageScale, window: model.usageWindow).suffix(limit)
    )
  }

  private func aggregateModels(_ report: LocalUsageReport) -> [LocalUsageModel] {
    var models: [String: LocalUsageModel] = [:]
    for period in report.periods(for: .day, window: model.usageWindow) {
      for agent in period.agents where model.usageSelectedAgents.contains(agent.agent) {
        for item in agent.models {
          if let current = models[item.model] {
            models[item.model] = LocalUsageModel(
              model: item.model,
              totals: current.totals.adding(item.totals),
              fallback: current.fallback || item.fallback,
              priced: current.priced && item.priced
            )
          } else {
            models[item.model] = item
          }
        }
      }
    }
    return models.values.sorted { $0.totals.generatedTokens > $1.totals.generatedTokens }
  }

  private func filteredSessions(_ report: LocalUsageReport) -> [LocalUsageSession] {
    report.sessions(for: model.usageSelectedAgents, window: model.usageWindow)
  }

  private func selectedTotals(_ report: LocalUsageReport) -> LocalUsageTotals {
    report.totals(for: model.usageSelectedAgents, window: model.usageWindow)
  }
}

private struct UsageBoundaryCard: View {
  let eyebrow: String
  let title: String
  let detail: String
  let icon: String
  let color: Color

  var body: some View {
    HStack(spacing: 11) {
      Image(systemName: icon)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(color)
        .frame(width: 28, height: 28)
        .background(color.opacity(0.11), in: RoundedRectangle(cornerRadius: 8))
      VStack(alignment: .leading, spacing: 2) {
        Text(eyebrow)
          .font(.system(size: 7, weight: .bold, design: .monospaced))
          .tracking(0.7)
          .foregroundStyle(color)
        Text(title).font(.system(size: 10, weight: .semibold))
        Text(detail).font(.system(size: 8)).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(12)
    .frame(maxWidth: .infinity)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }
}

private struct UsageMetric: View {
  let value: String
  let label: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(value).font(.system(size: 24, weight: .medium, design: .rounded))
      PremiumFieldLabel(label)
      Text(detail).font(.system(size: 8)).foregroundStyle(.secondary).lineLimit(1)
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
        .font(.system(size: 9, weight: .medium, design: .monospaced))
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
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(selection == scale ? EvidenceStyle.ink : Color.secondary)
            .frame(width: 58, height: 26)
            .background(
              selection == scale ? EvidenceStyle.amber : Color.clear,
              in: RoundedRectangle(cornerRadius: 7)
            )
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
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(selection == window ? EvidenceStyle.ink : Color.secondary)
            .frame(minWidth: 34, minHeight: 24)
            .padding(.horizontal, 3)
            .background(
              selection == window ? EvidenceStyle.amber : Color.clear,
              in: RoundedRectangle(cornerRadius: 7)
            )
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

private struct UsageTrendChart: View {
  let periods: [LocalUsagePeriod]
  let selectedAgents: Set<String>
  let scale: UsageScale

  var body: some View {
    if periods.isEmpty {
      ContentUnavailableView("No local activity", systemImage: "chart.bar")
    } else {
      GeometryReader { geometry in
        let values = periods.map { $0.totals(for: selectedAgents).generatedTokens }
        let maximum = max(values.max() ?? 0, 1)
        ZStack(alignment: .bottom) {
          HStack(alignment: .bottom, spacing: scale == .day ? 3 : 7) {
            ForEach(Array(zip(periods.indices, periods)), id: \.1.id) { index, period in
              let value = period.totals(for: selectedAgents).generatedTokens
              RoundedRectangle(cornerRadius: 3)
                .fill(
                  index == periods.indices.last
                    ? EvidenceStyle.amber : EvidenceStyle.amber.opacity(0.34)
                )
                .frame(
                  height: max(
                    3,
                    (geometry.size.height - 22) * CGFloat(Double(value) / Double(maximum))
                  )
                )
                .help("\(period.period): \(compact(value)) generated tokens")
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(period.period)
                .accessibilityValue("\(value) generated tokens")
            }
          }
          .padding(.bottom, 18)
          .overlay(alignment: .bottom) {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1).offset(y: -17)
          }
          HStack {
            Text(shortLabel(periods.first?.period ?? ""))
            Spacer()
            Text(shortLabel(periods.last?.period ?? ""))
          }
          .font(.system(size: 7, design: .monospaced))
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
