import SwiftUI
import UniformTypeIdentifiers

private let performanceEvidencePreviewLimit = 5

private enum PerformanceDetailMode: String, CaseIterable, Identifiable {
  case evidence = "Evidence"
  case json = "JSON"

  var id: String { rawValue }
}

struct PremiumPerformanceView: View {
  @Bindable var model: WorkbenchModel
  @State private var detailMode: PerformanceDetailMode = .evidence

  var body: some View {
    HStack(spacing: 0) {
      workloadControls.frame(width: 350)
      Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
      evidenceWorkspace
    }
    .background(EvidenceStyle.canvas)
    .fileImporter(
      isPresented: $model.choosingRepository,
      allowedContentTypes: [.folder],
      allowsMultipleSelection: false
    ) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      model.selectRepository(url)
    }
    .fileImporter(
      isPresented: $model.choosingPerformanceBaseline,
      allowedContentTypes: [.folder],
      allowsMultipleSelection: false
    ) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      model.performanceBaselineRepositoryPath = url.path(percentEncoded: false)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("performance-workspace")
  }

  private var workloadControls: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 21) {
          VStack(alignment: .leading, spacing: 6) {
            Text("PERFORMANCE / EXACT WORKLOAD")
              .font(.system(size: 9, weight: .bold, design: .monospaced))
              .tracking(1.15)
              .foregroundStyle(EvidenceStyle.amberForeground)
            Text("Measure what changed.")
              .font(.system(size: 25, weight: .semibold))
              .tracking(-0.4)
            Text("Admit one local workload, capture observed evidence, then compare one change.")
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }

          VStack(alignment: .leading, spacing: 14) {
            PremiumFieldLabel("REPOSITORY")
            Button {
              model.choosingRepository = true
            } label: {
              HStack(spacing: 10) {
                Image(systemName: "folder.fill").foregroundStyle(EvidenceStyle.amberForeground)
                Text(repositoryLabel)
                  .font(.system(size: 11, weight: .medium, design: .monospaced))
                  .foregroundStyle(model.repositoryPath.isEmpty ? .secondary : .primary)
                  .lineLimit(1)
                  .truncationMode(.middle)
                Spacer()
                Text("Choose…").font(.system(size: 9, weight: .semibold)).foregroundStyle(
                  .secondary)
              }
              .padding(.horizontal, 13)
              .frame(height: 43)
              .premiumField()
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Choose performance repository")

            VStack(alignment: .leading, spacing: 9) {
              HStack {
                PremiumFieldLabel("RECORDED RUN")
                Spacer()
                Text("DIGEST VERIFIED")
                  .font(.system(size: 8, weight: .bold, design: .monospaced))
                  .foregroundStyle(EvidenceStyle.success)
              }
              HStack(spacing: 8) {
                Image(systemName: "archivebox").foregroundStyle(EvidenceStyle.amberForeground)
                TextField("performance-run-7", text: $model.performanceRecordedRunID)
                  .textFieldStyle(.plain)
                  .font(.system(size: 10, design: .monospaced))
                  .accessibilityLabel("Recorded performance run ID")
                Button("Inspect") { model.inspectPerformanceRun() }
                  .buttonStyle(.borderless)
                  .disabled(!model.canInspectPerformanceRun)
              }
              .padding(.horizontal, 11)
              .frame(height: 38)
              .premiumField()
              if !model.performanceRecordedRunID.isEmpty,
                let issue = model.performanceInspectionInputIssue
              {
                Text(issue).font(.system(size: 9)).foregroundStyle(.tertiary)
              }
            }
            .padding(12)
            .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
            .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }

            PremiumScopePlanner(
              title: "Workload discovery",
              subtitle:
                "Turn one flow, exact change, or bounded portfolio into closed workload candidates.",
              kind: $model.performanceScopeKind,
              value: $model.performanceScopeValue,
              plan: model.performanceDiscoveryPlan,
              loading: model.performanceScopeLoading,
              issue: model.performanceScopeIssue ?? model.performanceScopeInputIssue,
              canResolve: model.canResolvePerformanceScope,
              selectedCandidateID: selectedPerformanceCandidateID,
              compact: true,
              accessibilityID: "performance-scope-planner",
              onResolve: model.resolvePerformanceScope,
              onSelect: model.applyPerformanceScopeCandidate
            )

            VStack(alignment: .leading, spacing: 7) {
              PremiumFieldLabel("ADAPTER")
              Picker("Performance adapter", selection: $model.performanceAdapter) {
                ForEach(PerformanceAdapter.allCases) { adapter in
                  Text(adapter.label).tag(adapter)
                }
              }
              .labelsHidden()
              .pickerStyle(.menu)
              .tint(EvidenceStyle.amber)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 9)
              .frame(height: 39)
              .premiumField()
            }

            PerformanceTextField(
              label: "RELATIVE TARGET",
              icon: "scope",
              placeholder: "src/cart/cart.test.ts",
              text: $model.performanceTarget
            )
            PerformanceTextField(
              label: "EXACT TEST OR BENCHMARK · OPTIONAL",
              icon: "line.3.horizontal.decrease",
              placeholder: "updates totals",
              text: $model.performanceName
            )

            HStack(spacing: 8) {
              PerformanceNumberField(
                label: "SAMPLES",
                value: $model.performanceSamples,
                range: 2...10
              )
              PerformanceNumberField(
                label: "WARMUPS",
                value: $model.performanceWarmups,
                range: 0...5
              )
              PerformanceNumberField(
                label: "TIMEOUT",
                value: Binding(
                  get: { max(1, model.performanceTimeoutMS / 1_000) },
                  set: { model.performanceTimeoutMS = $0 * 1_000 }
                ),
                range: 1...120,
                suffix: "s"
              )
            }
          }

          VStack(alignment: .leading, spacing: 9) {
            Label("Local · zero egress", systemImage: "network.slash")
            Label("Rust-owned admission", systemImage: "checkmark.shield")
            Label("Bounded process cleanup", systemImage: "wind")
          }
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(.secondary)
          .padding(13)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
          .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
        }
        .padding(22)
      }

      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      performanceActionBar
    }
    .background(EvidenceStyle.chrome)
  }

  private var selectedPerformanceCandidateID: String? {
    model.performanceDiscoveryPlan?.candidates.first(where: {
      $0.adapter == model.performanceAdapter.rawValue
        && $0.target == model.performanceTarget
        && ($0.name ?? "") == model.performanceName
    })?.id
  }

  private var performanceActionBar: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        if model.performanceState == .planning || model.performanceState == .running {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
        }
        Text(model.performanceStatusMessage)
          .font(.system(size: 9, weight: .medium))
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      HStack(spacing: 8) {
        if model.performanceState == .planning || model.performanceState == .running {
          Button("Cancel", role: .destructive) { model.cancelPerformance() }
            .buttonStyle(.bordered)
        } else {
          Button("Plan") { model.planPerformance() }
            .buttonStyle(.bordered)
            .disabled(!model.canPlanPerformance)
          Button("Capture evidence") { model.diagnosePerformance() }
            .buttonStyle(PremiumPrimaryButtonStyle())
            .disabled(!model.canDiagnosePerformance)
        }
        Spacer()
        StatusPill(label: model.performanceState.rawValue, color: performanceStateColor)
      }
      if let issue = currentInputIssue {
        Text(issue).font(.system(size: 9)).foregroundStyle(.tertiary).lineLimit(2)
      }
    }
    .padding(14)
    .frame(minHeight: 94)
  }

  private var evidenceWorkspace: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          Text(
            isInspectingRecordedRun ? "RECORDED RUN INSPECTION" : "PERFORMANCE EVIDENCE LANE"
          )
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.1)
          .foregroundStyle(EvidenceStyle.amberForeground)
          Text(
            isInspectingRecordedRun
              ? "Read the stored receipt. Verify its digest. Preserve its limits."
              : "Measure one flow. Change one thing. Prove it."
          )
          .font(.system(size: 17, weight: .semibold))
        }
        Spacer()
        if hasPerformanceReceipt {
          HStack(spacing: 2) {
            ForEach(PerformanceDetailMode.allCases) { mode in
              Button {
                detailMode = mode
              } label: {
                Text(mode.rawValue)
                  .font(.system(size: 10, weight: .semibold))
                  .foregroundStyle(detailMode == mode ? EvidenceStyle.ink : Color.secondary)
                  .padding(.horizontal, 13)
                  .frame(height: 28)
                  .background(
                    detailMode == mode ? EvidenceStyle.amber : Color.clear,
                    in: RoundedRectangle(cornerRadius: 7)
                  )
              }
              .buttonStyle(.plain)
              .accessibilityAddTraits(detailMode == mode ? .isSelected : [])
            }
          }
          .padding(2)
          .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 9))
          .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
          .accessibilityElement(children: .contain)
          .accessibilityLabel("Performance receipt detail")
        }
        Button("Reset") { model.resetPerformance() }
          .buttonStyle(.borderless)
          .disabled(!hasPerformanceReceipt)
      }
      .padding(.horizontal, 22)
      .frame(height: 72)
      .background(EvidenceStyle.chrome)

      if !isInspectingRecordedRun {
        PerformanceEvidenceLane(model: model)
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      }

      ScrollView {
        if detailMode == .json, hasPerformanceReceipt {
          PerformanceJSONDesk(model: model)
        } else if let inspection = model.performanceResultReceipt,
          inspection.operation == .inspect
        {
          PerformanceRecordedRunDesk(inspection: inspection)
        } else if let plan = model.performancePlanReceipt {
          PerformanceReceiptDesk(model: model, plan: plan)
        } else {
          emptyEvidence
        }
      }
    }
  }

  private var emptyEvidence: some View {
    VStack(spacing: 18) {
      Image(systemName: "gauge.with.dots.needle.67percent")
        .font(.system(size: 30, weight: .light))
        .foregroundStyle(EvidenceStyle.amberForeground)
      VStack(spacing: 7) {
        Text("No performance claim without admission.")
          .font(.system(size: 18, weight: .semibold))
        Text(
          "Planning fingerprints the repository, diff, and exact target before project code runs. A blocked plan remains evidence—not a hidden failure."
        )
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .frame(maxWidth: 430)
      }
      HStack(spacing: 24) {
        contractStep("01", "Admit", "Exact identity")
        contractStep("02", "Capture", "Observed proof")
        contractStep("03", "Diagnose", "Bounded inference")
        contractStep("04", "Compare", "Paired verdict")
      }
      .padding(.top, 8)
      Label("Authority: codevetter performance", systemImage: "checkmark.seal.fill")
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.success)
    }
    .frame(maxWidth: .infinity, minHeight: 450)
    .padding(28)
  }

  private func contractStep(_ index: String, _ title: String, _ detail: String) -> some View {
    VStack(spacing: 6) {
      Text(index).font(.system(size: 9, weight: .bold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.amberForeground)
      Text(title).font(.system(size: 11, weight: .semibold))
      Text(detail).font(.system(size: 9)).foregroundStyle(.secondary)
    }
  }

  private var repositoryLabel: String {
    guard !model.repositoryPath.isEmpty else { return "No repository selected" }
    return URL(fileURLWithPath: model.repositoryPath).lastPathComponent
  }

  private var isInspectingRecordedRun: Bool {
    model.performanceResultReceipt?.operation == .inspect
  }

  private var hasPerformanceReceipt: Bool {
    model.performancePlanReceipt != nil || model.performanceResultReceipt != nil
  }

  private var currentInputIssue: String? {
    guard model.performanceState != .planning, model.performanceState != .running else {
      return nil
    }
    if model.performancePlanReceipt?.admitted == true,
      model.performancePlanScopeFingerprint != model.performanceScopeFingerprint
    {
      return "The workload changed. Plan again before capture."
    }
    return model.performanceInputIssue
  }

  private var performanceStateColor: Color {
    switch model.performanceState {
    case .completed, .planned: EvidenceStyle.success
    case .limited: EvidenceStyle.warning
    case .failed: EvidenceStyle.failure
    case .planning, .running: EvidenceStyle.amber
    case .ready, .cancelled: .secondary
    }
  }
}

private struct PerformanceEvidenceLane: View {
  let model: WorkbenchModel

  var body: some View {
    HStack(spacing: 0) {
      step("01", "Scope", state: model.performanceInputIssue == nil ? .ready : .waiting)
      step("02", "Admit", state: admissionState)
      step("03", "Capture", state: captureState)
      step("04", "Compare", state: comparisonState)
    }
    .frame(height: 58)
  }

  private enum LaneState { case waiting, active, ready, blocked }

  private var admissionState: LaneState {
    if model.performanceState == .planning { return .active }
    guard let plan = model.performancePlanReceipt else { return .waiting }
    return plan.admitted ? .ready : .blocked
  }

  private var captureState: LaneState {
    if model.performanceState == .running, model.performanceResultReceipt == nil { return .active }
    guard let receipt = model.performanceResultReceipt else { return .waiting }
    return receipt.state == .succeeded ? .ready : .blocked
  }

  private var comparisonState: LaneState {
    if model.performanceState == .running,
      model.performanceResultReceipt?.operation == .diagnose
    {
      return .active
    }
    guard let receipt = model.performanceResultReceipt, receipt.operation == .verifyPaired else {
      return .waiting
    }
    return receipt.state == .succeeded ? .ready : .blocked
  }

  private func step(_ index: String, _ label: String, state: LaneState) -> some View {
    HStack(spacing: 9) {
      Text(index)
        .font(.system(size: 9, weight: .bold, design: .monospaced))
        .foregroundStyle(state == .active ? EvidenceStyle.ink : laneColor(state))
        .frame(width: 25, height: 25)
        .background(
          state == .active ? EvidenceStyle.amber : laneColor(state).opacity(0.1), in: Circle())
      Text(label).font(.system(size: 10, weight: .semibold))
      Spacer()
    }
    .padding(.horizontal, 13)
    .frame(maxWidth: .infinity)
    .overlay(alignment: .trailing) { Rectangle().fill(EvidenceStyle.separator).frame(width: 1) }
  }

  private func laneColor(_ state: LaneState) -> Color {
    switch state {
    case .ready: EvidenceStyle.success
    case .blocked: EvidenceStyle.failure
    case .active: EvidenceStyle.amber
    case .waiting: .secondary
    }
  }
}

private struct PerformanceReceiptDesk: View {
  @Bindable var model: WorkbenchModel
  let plan: PerformanceRunReceipt

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 15) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 6) {
            PremiumFieldLabel("EXECUTION PLAN")
            HStack(spacing: 8) {
              Circle().fill(plan.admitted ? EvidenceStyle.success : EvidenceStyle.failure)
                .frame(width: 7, height: 7)
              Text(plan.outcome.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.system(size: 20, weight: .semibold))
            }
            Text(plan.summary).font(.system(size: 11)).foregroundStyle(.secondary)
          }
          Spacer()
          StatusPill(
            label: plan.admitted ? "Admitted" : "Blocked",
            color: plan.admitted ? EvidenceStyle.success : EvidenceStyle.failure
          )
        }

        HStack(spacing: 8) {
          planMetric("MODE", plan.result.value(at: "mode")?.displayValue ?? "—")
          planMetric(
            "PROCESSES", plan.result.value(at: "limits", "max_processes")?.displayValue ?? "—")
          planMetric(
            "EGRESS",
            plan.result.value(at: "limits", "max_external_requests")?.displayValue == "0"
              ? "Blocked" : "Unknown")
          planMetric(
            "COST",
            plan.result.value(at: "limits", "max_cost_microusd")?.displayValue == "0"
              ? "$0" : "Unknown")
          planMetric("CLEANUP", plan.cleanup.ownedProcessReaped ? "Reaped" : "Unproven")
        }
      }
      .padding(22)

      if !plan.blockers.isEmpty {
        ReceiptList(title: "BLOCKERS", items: plan.blockers, color: EvidenceStyle.failure)
      }

      if let resources = model.performanceResultReceipt?.resources ?? plan.resources {
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        resourceEvidence(resources)
      }

      if let result = model.performanceResultReceipt {
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        VStack(alignment: .leading, spacing: 16) {
          HStack {
            VStack(alignment: .leading, spacing: 5) {
              PremiumFieldLabel(
                result.operation == .verifyPaired ? "PAIRED VERIFICATION" : "CAPTURED DIAGNOSIS")
              Text(result.outcome.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.system(size: 18, weight: .semibold))
              Text(result.summary).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(
              label: result.state.rawValue.replacingOccurrences(of: "_", with: " "),
              color: resultColor(result))
          }
          evidenceSection(
            "OBSERVED", rows: result.evidenceRows("observed"), color: EvidenceStyle.success)
          evidenceSection(
            "INFERRED", rows: result.evidenceRows("inferred"), color: EvidenceStyle.amber)
          evidenceSection(
            "UNVERIFIED", rows: result.evidenceRows("unverified"), color: EvidenceStyle.warning)
        }
        .padding(22)
      }

      if plan.admitted, model.performanceResultReceipt != nil {
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        pairedVerification
      }

      let limitations = (plan.limitations + (model.performanceResultReceipt?.limitations ?? []))
      if !limitations.isEmpty {
        ReceiptList(
          title: "LIMITATIONS", items: Array(Set(limitations)).sorted(),
          color: EvidenceStyle.warning)
      }
    }
  }

  private var pairedVerification: some View {
    let presentation = campaignPresentation
    return VStack(alignment: .leading, spacing: 12) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("AGENT CAMPAIGN HANDOFF")
          Text(presentation.summary)
            .font(.system(size: 11, weight: .medium))
        }
        Spacer()
        if model.performanceResultReceipt?.operation == .diagnose {
          Button("Choose baseline…") { model.choosingPerformanceBaseline = true }
            .buttonStyle(.bordered)
            .accessibilityLabel("Choose performance baseline repository")
          Button("Verify paired") { model.verifyPairedPerformance() }
            .buttonStyle(PremiumPrimaryButtonStyle())
            .disabled(!model.canVerifyPairedPerformance)
        }
      }
      HStack(spacing: 8) {
        campaignCell("BASELINE", presentation.baseline, ready: true)
        campaignCell("CANDIDATE", presentation.candidate, ready: presentation.confirmed)
        campaignCell("PROMOTION", presentation.promotion, ready: presentation.confirmed)
      }
      Text(baselineLabel)
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.middle)
      if model.performanceResultReceipt?.operation == .diagnose,
        !model.canVerifyPairedPerformance, let issue = model.performancePairedInputIssue
      {
        Text(issue).font(.system(size: 9)).foregroundStyle(.tertiary)
      }
    }
    .padding(22)
  }

  private var campaignPresentation:
    (
      summary: String, baseline: String, candidate: String, promotion: String, confirmed: Bool
    )
  {
    guard let result = model.performanceResultReceipt, result.operation == .verifyPaired else {
      return (
        "Change one thing, then compare it against an exact baseline checkout.",
        "Receipt captured",
        "Awaiting one change",
        "Requires paired proof",
        false
      )
    }
    let confirmed = result.outcome == "confirmed" && result.state == .succeeded
    return confirmed
      ? (
        "The paired candidate and baseline were compared under the same admitted scope.",
        "Paired baseline",
        "Candidate accepted",
        "Confirmed",
        true
      )
      : (
        "The paired comparison did not produce promotable evidence.",
        "Paired baseline",
        "Not comparable",
        "Blocked",
        false
      )
  }

  private func campaignCell(_ label: String, _ value: String, ready: Bool) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(ready ? EvidenceStyle.success : Color.secondary)
        .lineLimit(1)
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 9))
    .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
  }

  private var baselineLabel: String {
    model.performanceBaselineRepositoryPath.isEmpty
      ? "No baseline repository selected" : model.performanceBaselineRepositoryPath
  }

  private func planMetric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 10, weight: .semibold, design: .monospaced)).lineLimit(1)
    }
    .padding(11)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 9))
    .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
  }

  @ViewBuilder
  private func evidenceSection(_ title: String, rows: [PerformanceJSONValue], color: Color)
    -> some View
  {
    if !rows.isEmpty {
      LazyVStack(alignment: .leading, spacing: 8) {
        PremiumFieldLabel(title)
        ForEach(Array(rows.prefix(performanceEvidencePreviewLimit).enumerated()), id: \.offset) {
          _, row in
          HStack(alignment: .top, spacing: 9) {
            Circle().fill(color).frame(width: 5, height: 5).padding(.top, 5)
            VStack(alignment: .leading, spacing: 3) {
              Text(
                row.value(at: "summary")?.stringValue ?? row.value(at: "kind")?.displayValue
                  ?? "Evidence"
              )
              .font(.system(size: 10, weight: .semibold))
              Text(row.displayValue).font(.system(size: 9, design: .monospaced)).foregroundStyle(
                .secondary
              )
              .lineLimit(3)
            }
          }
        }
        if rows.count > performanceEvidencePreviewLimit {
          Text(
            "+ \(rows.count - performanceEvidencePreviewLimit) more evidence rows in canonical JSON"
          )
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
        }
      }
    }
  }

  private func resultColor(_ receipt: PerformanceRunReceipt) -> Color {
    switch receipt.state {
    case .succeeded: EvidenceStyle.success
    case .completedWithRejection: EvidenceStyle.failure
    case .noConfidence: EvidenceStyle.warning
    case .cancelled: .secondary
    }
  }

  private func resourceEvidence(_ resources: PerformanceResourceReceipt) -> some View {
    VStack(alignment: .leading, spacing: 11) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("OWNED PROCESS TREE")
          Text("Periodically sampled while the Rust-supervised operation was active.")
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        Spacer()
        StatusPill(
          label: resources.samples > 0 ? "Observed" : "Unavailable",
          color: resources.samples > 0 ? EvidenceStyle.success : EvidenceStyle.warning)
      }
      HStack(spacing: 8) {
        planMetric(
          "PEAK RSS",
          resources.peakRSSBytes.map {
            ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .memory)
          } ?? "—")
        planMetric("PEAK PROCESSES", resources.peakProcesses.map(String.init) ?? "—")
        planMetric("SAMPLES", String(resources.samples))
        planMetric("INTERVAL", "\(resources.sampleIntervalMS)ms")
      }
      ForEach(resources.limitations, id: \.self) { limitation in
        Text(limitation).font(.system(size: 9)).foregroundStyle(.tertiary)
      }
    }
    .padding(22)
  }
}

private struct PerformanceRecordedRunDesk: View {
  let inspection: PerformanceRunReceipt

  private var receipt: PerformanceJSONValue? { inspection.result.value(at: "receipt") }
  private var resultSummary: PerformanceJSONValue? {
    inspection.result.value(at: "result_summary")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 6) {
            PremiumFieldLabel("CANONICAL STORED RECEIPT")
            Text(runID)
              .font(.system(size: 20, weight: .semibold, design: .monospaced))
            Text(
              "The Rust core re-read the bounded receipt, verified its result digest, and returned only recorded evidence."
            )
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
          }
          Spacer()
          StatusPill(label: runState.replacingOccurrences(of: "_", with: " "), color: stateColor)
        }

        HStack(spacing: 8) {
          metric("ADAPTER", value("scope", "adapter"))
          metric("TARGET", value("scope", "target"))
          metric("REVISION", short(value("subject", "repository_revision")))
          metric("DIRTY", value("subject", "dirty"))
        }
      }
      .padding(22)

      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)

      LazyVGrid(
        columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
        alignment: .leading,
        spacing: 18
      ) {
        detail("CREATED", value("lifecycle", "created_at"))
        detail("STARTED", value("lifecycle", "started_at"))
        detail("COMPLETED", value("lifecycle", "completed_at"))
        detail("SAMPLES", value("policy", "samples"))
        detail("WARMUPS", value("policy", "warmups"))
        detail("TIMEOUT", milliseconds(value("policy", "timeout_ms")))
        detail("CHILD PID", value("child", "pid"))
        detail("EXIT", value("child", "exit_code"))
        detail("SIGNAL", value("child", "signal"))
        detail("RESULT BYTES", bytes(value("result", "bytes")))
        detail("STDOUT", bytes(value("capture", "stdout_bytes")))
        detail("STDERR", bytes(value("capture", "stderr_bytes")))
      }
      .padding(22)

      if let diagnosis = resultSummary?.value(at: "diagnosis", "summary")?.stringValue {
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        VStack(alignment: .leading, spacing: 9) {
          PremiumFieldLabel("RECORDED RESULT SUMMARY")
          Text(diagnosis).font(.system(size: 12, weight: .medium))
          if let verdict = resultSummary?.value(at: "verdict", "status")?.stringValue {
            Text("Verdict · \(verdict.replacingOccurrences(of: "_", with: " "))")
              .font(.system(size: 9, weight: .semibold, design: .monospaced))
              .foregroundStyle(EvidenceStyle.amberForeground)
          }
        }
        .padding(22)
      }

      let limitations = receipt?.value(at: "limitations")?.arrayValue?.map(\.displayValue) ?? []
      if !limitations.isEmpty {
        ReceiptList(title: "LIMITATIONS", items: limitations, color: EvidenceStyle.warning)
      }

      if let failure = receipt?.value(at: "failure"), failure.objectValue != nil,
        failure.displayValue != "—"
      {
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        VStack(alignment: .leading, spacing: 8) {
          PremiumFieldLabel("RECORDED FAILURE")
          Text(failure.value(at: "operational_error")?.displayValue ?? failure.displayValue)
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(EvidenceStyle.failure)
            .textSelection(.enabled)
        }
        .padding(22)
      }
    }
  }

  private var runID: String { value("run_id") }
  private var runState: String { value("state") }

  private var stateColor: Color {
    switch runState {
    case "succeeded": EvidenceStyle.success
    case "running", "initialized": EvidenceStyle.amber
    case "blocked", "failed", "timed_out", "signaled", "spawn_failed", "invalid_result":
      EvidenceStyle.failure
    default: .secondary
    }
  }

  private func value(_ path: String...) -> String {
    path.reduce(receipt) { current, key in current?.objectValue?[key] }?.displayValue ?? "—"
  }

  private func short(_ value: String) -> String {
    value.count > 12 ? String(value.prefix(12)) : value
  }

  private func milliseconds(_ value: String) -> String {
    guard let number = Double(value) else { return value }
    return number >= 1_000 ? String(format: "%.1fs", number / 1_000) : "\(Int(number))ms"
  }

  private func bytes(_ value: String) -> String {
    guard let number = Double(value) else { return value }
    return ByteCountFormatter.string(fromByteCount: Int64(number), countStyle: .file)
  }

  private func metric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .padding(11)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 9))
    .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
  }

  private func detail(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .lineLimit(1)
        .truncationMode(.middle)
    }
  }
}

private struct PerformanceJSONDesk: View {
  let model: WorkbenchModel

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      PremiumFieldLabel("CANONICAL RUST RECEIPT")
      Text(
        model.performanceResultReceiptJSON.isEmpty
          ? model.performancePlanReceiptJSON : model.performanceResultReceiptJSON
      )
      .font(.system(size: 9, design: .monospaced))
      .textSelection(.enabled)
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      if !model.performanceResultReceiptJSON.isEmpty {
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        PremiumFieldLabel("ADMISSION RECEIPT")
        Text(model.performancePlanReceiptJSON)
          .font(.system(size: 9, design: .monospaced))
          .textSelection(.enabled)
          .foregroundStyle(.secondary)
      }
    }
    .padding(22)
  }
}

private struct ReceiptList: View {
  let title: String
  let items: [String]
  let color: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      PremiumFieldLabel(title)
      ForEach(items, id: \.self) { item in
        HStack(alignment: .top, spacing: 8) {
          Circle().fill(color).frame(width: 5, height: 5).padding(.top, 5)
          Text(item).font(.system(size: 10)).foregroundStyle(.secondary)
        }
      }
    }
    .padding(.horizontal, 22)
    .padding(.vertical, 16)
  }
}

private struct PerformanceTextField: View {
  let label: String
  let icon: String
  let placeholder: String
  @Binding var text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      PremiumFieldLabel(label)
      HStack(spacing: 9) {
        Image(systemName: icon).foregroundStyle(EvidenceStyle.amberForeground)
        TextField(placeholder, text: $text)
          .textFieldStyle(.plain)
          .font(.system(size: 11, design: .monospaced))
      }
      .padding(.horizontal, 12)
      .frame(height: 41)
      .premiumField()
    }
  }
}

private struct PerformanceNumberField: View {
  let label: String
  @Binding var value: Int
  let range: ClosedRange<Int>
  var suffix = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      PremiumFieldLabel(label)
      Stepper(value: $value, in: range) {
        Text("\(value)\(suffix)")
          .font(.system(size: 10, weight: .semibold, design: .monospaced))
      }
      .labelsHidden()
      Text("\(value)\(suffix)")
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
        .frame(maxWidth: .infinity, alignment: .center)
    }
    .padding(9)
    .frame(maxWidth: .infinity)
    .premiumField()
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label.capitalized)
    .accessibilityValue("\(value)\(suffix)")
  }
}
