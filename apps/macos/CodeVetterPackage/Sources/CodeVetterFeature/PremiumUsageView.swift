import AppKit
import SwiftUI

struct UsageTrendPoint: Identifiable, Sendable {
  let period: String
  let generatedTokens: UInt64

  var id: String { period }
}

struct UsageViewProjection: Sendable {
  let totals: LocalUsageTotals
  let activeDays: Int
  let sessionCount: Int
  let recentSessions: [LocalUsageSession]
  let models: [LocalUsageModel]
  let trend: [UsageTrendPoint]

  init(
    report: LocalUsageReport,
    selectedAgents: Set<String>,
    window: UsageWindow,
    scale: UsageScale,
    referenceDate: Date = Date()
  ) {
    let dayPeriods = report.periods(for: .day, window: window, referenceDate: referenceDate)
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
      UsageMetric(
        value: compact(projection.totals.generatedTokens),
        label: "GENERATED TOKENS",
        detail: model.usageWindow.description
      )
      UsageMetric(
        value: compact(projection.totals.cacheReadTokens),
        label: "CACHE READ",
        detail: cacheShare(projection.totals)
      )
      UsageMetric(
        value: currency(projection.totals.costUSD),
        label: "LOCAL LOG COST",
        detail: report.provenance.pricingComplete ? "priced models complete" : "pricing has gaps"
      )
      UsageMetric(
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
          Text("Generated tokens from local agent logs · cache reads remain separate")
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
      }

      UsageTrendChart(
        points: projection.trend,
        scale: model.usageScale
      )
      .frame(height: 125)
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

private struct ProviderAllowanceCard: View {
  let provider: ProviderQuotaStatus

  private var accent: Color {
    if visibleWindows.contains(where: { $0.remainingPercent <= 10 }) {
      return EvidenceStyle.failure
    }
    return provider.provider == "claude" ? EvidenceStyle.amberForeground : Color.secondary
  }

  private var displayName: String {
    provider.provider == "claude" ? "Claude" : "Codex"
  }

  private var isDisplayReady: Bool {
    provider.isReady && !visibleWindows.isEmpty
  }

  private var availabilityLabel: String {
    guard isDisplayReady else { return "ALLOWANCE UNAVAILABLE" }
    return visibleWindows.contains(where: { $0.remainingPercent <= 10 })
      ? "ALLOWANCE LOW"
      : "ALLOWANCE AVAILABLE"
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
        .foregroundStyle(window.remainingPercent <= 10 ? EvidenceStyle.failure : .primary)
      Text("remaining")
        .font(.caption)
        .foregroundStyle(.secondary)
      GeometryReader { geometry in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.primary.opacity(0.07))
          Capsule()
            .fill(window.remainingPercent <= 10 ? EvidenceStyle.failure : accent)
            .frame(
              width: geometry.size.width * max(0, min(window.remainingPercent / 100, 1)))
        }
      }
      .frame(height: 4)
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

private struct UsageMetric: View {
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

private struct UsageTrendChart: View {
  let points: [UsageTrendPoint]
  let scale: UsageScale

  var body: some View {
    if points.isEmpty {
      ContentUnavailableView("No local activity", systemImage: "chart.bar")
    } else {
      GeometryReader { geometry in
        let values = points.map(\.generatedTokens)
        let maximum = max(values.max() ?? 0, 1)
        ZStack(alignment: .bottom) {
          HStack(alignment: .bottom, spacing: scale == .day ? 3 : 7) {
            ForEach(Array(zip(points.indices, points)), id: \.1.id) { index, point in
              RoundedRectangle(cornerRadius: 3)
                .fill(
                  index == points.indices.last
                    ? EvidenceStyle.amberForeground : Color.secondary.opacity(0.28)
                )
                .frame(
                  height: max(
                    3,
                    (geometry.size.height - 22)
                      * CGFloat(Double(point.generatedTokens) / Double(maximum))
                  )
                )
                .help("\(point.period): \(compact(point.generatedTokens)) generated tokens")
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(point.period)
                .accessibilityValue("\(point.generatedTokens) generated tokens")
            }
          }
          .padding(.bottom, 18)
          .overlay(alignment: .bottom) {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1).offset(y: -17)
          }
          HStack {
            Text(shortLabel(points.first?.period ?? ""))
            Spacer()
            Text(shortLabel(points.last?.period ?? ""))
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
