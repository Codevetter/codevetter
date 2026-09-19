import SwiftUI

/// One shared projection powers both the chart and its exact-value breakdown.
struct UsageHistoryView: View {
  let history: UsageHistoryProjection
  let pricingComplete: Bool
  @State private var selectedPeriod: String?
  @State private var expanded = false
  @Environment(\.colorScheme) private var colorScheme

  private var selected: UsageHistoryBucket? {
    history.buckets.first { $0.period == selectedPeriod }
  }
  private var rows: [UsageHistorySeries] {
    guard let selected else { return history.series }
    return history.series.map {
      UsageHistorySeries(id: $0.id, label: $0.label, value: selected.values[$0.id] ?? 0)
    }.filter { $0.value > 0 }.sorted { $0.value == $1.value ? $0.id < $1.id : $0.value > $1.value }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(history.metric.caption)
        .font(.system(size: 10)).foregroundStyle(.secondary)
      if history.buckets.isEmpty {
        Text("No local activity in this time range.")
          .font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 145)
      } else {
        // Keep one chart/picker/breakdown tree. ViewThatFits instantiated both
        // alternatives on every render, doubling the expensive native controls.
        UsageHistoryLayout {
          chart
          Divider()
          breakdown
        }
        if history.grouping == .project {
          Text(
            history.unattributed > 0
              ? "Partial project coverage · \(history.metric.formatted(history.unattributed)) unattributed. Claude project records only; other activity stays visible."
              : "Project attribution from ccusage Claude records · no repository identity is inferred."
          )
          .font(.system(size: 10)).foregroundStyle(.secondary)
        }
        if history.metric == .cost && !pricingComplete {
          Label("Pricing incomplete · known costs only", systemImage: "exclamationmark.triangle")
            .font(.system(size: 10)).foregroundStyle(EvidenceStyle.warning)
        }
      }
    }
    .onChange(of: history.grouping) {
      selectedPeriod = nil
      expanded = false
    }
    .onChange(of: history.metric) { selectedPeriod = nil }
    .onChange(of: history.buckets.map(\.period)) {
      if selected == nil { selectedPeriod = nil }
    }
  }

  private var chart: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        ForEach(Array(history.visibleSeries.enumerated()), id: \.element.id) { index, series in
          HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 1).fill(tone(index)).frame(width: 6, height: 6)
            Text(series.label).lineLimit(1).help(series.label)
          }.font(.system(size: 9)).foregroundStyle(.secondary)
        }
      }
      GeometryReader { geometry in
        let buckets = history.buckets
        let maximum = max(buckets.map(\.total).max() ?? 0, 1)
        let step = geometry.size.width / CGFloat(max(buckets.count, 1))
        Canvas { context, size in
          for fraction in [0.0, 0.5, 1.0] {
            let y = (size.height - 18) * fraction
            var path = Path()
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: size.width, y: y))
            context.stroke(path, with: .color(EvidenceStyle.separator), lineWidth: 0.5)
          }
          for (index, bucket) in buckets.enumerated() {
            let width = max(1, min(42, step - (buckets.count > 60 ? 1 : 5)))
            let x = CGFloat(index) * step + (step - width) / 2
            var y = size.height - 18
            for (seriesIndex, series) in history.visibleSeries.enumerated() {
              let height =
                CGFloat(history.value(in: bucket, series: series) / maximum) * (size.height - 38)
              y -= height
              context.fill(
                Path(CGRect(x: x, y: y, width: width, height: height)),
                with: .color(tone(seriesIndex)))
            }
            if buckets.count <= 12 {
              context.draw(
                Text(history.metric.formatted(bucket.total))
                  .font(.system(size: 9)).foregroundColor(.secondary),
                at: CGPoint(x: x + width / 2, y: y - 9))
            }
            if selectedPeriod == bucket.period {
              context.stroke(
                Path(
                  CGRect(
                    x: x - 2, y: y - 2, width: width + 4,
                    height: size.height - 18 - y + 4)),
                with: .color(EvidenceStyle.amberForeground), lineWidth: 1)
            }
          }
        }
        .contentShape(Rectangle())
        .gesture(
          SpatialTapGesture().onEnded { value in
            let index = min(max(Int(value.location.x / max(step, 1)), 0), buckets.count - 1)
            selectedPeriod = selectedPeriod == buckets[index].period ? nil : buckets[index].period
          }
        )
        .onContinuousHover { phase in
          if case .active(let location) = phase {
            let index = min(max(Int(location.x / max(step, 1)), 0), buckets.count - 1)
            hoverDetail = detail(buckets[index])
          }
        }
        .help(hoverDetail.isEmpty ? "Select a period to inspect its exact values" : hoverDetail)
        .accessibilityLabel("Historical usage chart")
        .accessibilityValue(
          "\(buckets.count) periods, \(history.metric.formatted(history.total, exact: true)) \(history.metric.rawValue)"
        )
        .overlay(alignment: .bottom) {
          HStack {
            Text(buckets.first?.period ?? "")
            Spacer()
            Text(buckets.last?.period ?? "")
          }.font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
        }
      }.frame(height: 156)
      HStack(spacing: 8) {
        // Menu contents are built on demand; the native Picker eagerly creates
        // every period item even when the inspection control is never opened.
        Menu {
          Button("Entire selected range") { selectedPeriod = nil }
          ForEach(history.buckets) { bucket in
            Button(bucket.period) { selectedPeriod = bucket.period }
          }
        } label: {
          Text(selectedPeriod ?? "Entire selected range")
        }
        .frame(maxWidth: 210).accessibilityLabel("Inspect usage period")
        .accessibilityValue(selectedPeriod ?? "Entire selected range")
        Spacer(minLength: 0)
        Text("Select a bar for detail").font(.system(size: 9)).foregroundStyle(.secondary)
      }.controlSize(.mini)
    }
  }

  @State private var hoverDetail = ""

  private func detail(_ bucket: UsageHistoryBucket) -> String {
    ([bucket.period]
      + history.series.compactMap { series in
        guard let value = bucket.values[series.id], value > 0 else { return nil }
        return "\(series.label): \(history.metric.formatted(value, exact: true))"
      }).joined(separator: "\n")
  }

  private var breakdown: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(selected?.period ?? "SELECTED RANGE")
        .font(.system(size: 9, weight: .medium, design: .monospaced)).foregroundStyle(.secondary)
      Text(history.metric.formatted(selected?.total ?? history.total))
        .font(.system(size: 25, weight: .semibold)).monospacedDigit()
        .help(history.metric.formatted(selected?.total ?? history.total, exact: true))
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          ForEach(expanded ? rows : Array(rows.prefix(6))) { row in
            VStack(alignment: .leading, spacing: 5) {
              HStack(spacing: 6) {
                Rectangle().fill(seriesTone(row.id)).frame(width: 6, height: 6)
                Text(row.label).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                Text(history.metric.formatted(row.value)).monospacedDigit()
              }.font(.system(size: 10))
              GeometryReader { geometry in
                Rectangle().fill(seriesTone(row.id))
                  .frame(
                    width: geometry.size.width
                      * min(1, row.value / max(selected?.total ?? history.total, 1)))
              }.frame(height: 3).background(EvidenceStyle.separator)
            }
            .help("\(row.label): \(history.metric.formatted(row.value, exact: true))")
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(row.label)
            .accessibilityValue(
              "\(history.metric.formatted(row.value, exact: true)) \(history.metric.rawValue)")
          }
          if rows.count > 6 {
            Button(
              expanded
                ? "Show fewer" : "Show all \(rows.count) \(history.grouping.rawValue.lowercased())s"
            ) {
              expanded.toggle()
            }.buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(
              EvidenceStyle.amberForeground)
          }
        }
      }.frame(height: 153)
    }
  }

  private func seriesTone(_ id: String) -> Color {
    let index = history.visibleSeries.firstIndex { $0.id == id } ?? 4
    return tone(index)
  }

  private func tone(_ index: Int) -> Color {
    let dark: [Double] = [0.69, 0.55, 0.43, 0.34, 0.27]
    let light: [Double] = [0.30, 0.42, 0.53, 0.63, 0.72]
    return Color(white: (colorScheme == .dark ? dark : light)[min(index, 4)])
  }
}

/// A single subview tree responds to the actual proposal, including the first
/// offscreen render. Geometry state updates arrive too late for first-frame layout.
private struct UsageHistoryLayout: Layout {
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 565
    let horizontal = width >= 565
    let chart = subviews[0].sizeThatFits(.init(width: horizontal ? width - 246 : width, height: nil))
    let breakdown = subviews[2].sizeThatFits(.init(width: horizontal ? 205 : width, height: nil))
    return CGSize(width: width, height: horizontal ? max(chart.height, breakdown.height)
      : chart.height + 16 + breakdown.height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let horizontal = bounds.width >= 565
    let chartWidth = horizontal ? bounds.width - 246 : bounds.width
    let chart = subviews[0].sizeThatFits(.init(width: chartWidth, height: nil))
    subviews[0].place(at: bounds.origin, anchor: .topLeading,
      proposal: .init(width: chartWidth, height: chart.height))
    subviews[1].place(at: CGPoint(x: bounds.minX + chartWidth + 20, y: bounds.minY),
      anchor: .topLeading, proposal: .init(width: horizontal ? 1 : 0, height: horizontal ? bounds.height : 0))
    subviews[2].place(at: CGPoint(x: horizontal ? bounds.minX + chartWidth + 41 : bounds.minX,
      y: horizontal ? bounds.minY : bounds.minY + chart.height + 16), anchor: .topLeading,
      proposal: .init(width: horizontal ? 205 : bounds.width, height: nil))
  }
}
