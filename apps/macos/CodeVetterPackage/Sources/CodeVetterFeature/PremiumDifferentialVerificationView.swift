import SwiftUI

struct PremiumDifferentialVerificationView: View {
  @Bindable var model: WorkbenchModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 14) {
        VStack(alignment: .leading, spacing: 4) {
          Text("DIFFERENTIAL / PAIRED EVIDENCE")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1.1).foregroundStyle(EvidenceStyle.amberForeground)
          Text("Compare behavior, not just code.")
            .font(.system(size: 21, weight: .semibold)).tracking(-0.3)
          Text("Exact reference · exact candidate · same scenarios · zero model calls")
            .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
        }
        Spacer()
        StatusPill(label: model.differentialState.rawValue, color: stateColor)
        Button("Done") { dismiss() }.buttonStyle(.bordered)
      }
      .padding(.horizontal, 24).frame(height: 88).background(EvidenceStyle.chrome)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      if let receipt = model.differentialReceipt {
        receiptDesk(receipt)
      } else {
        setupDesk
      }
    }
    .background(EvidenceStyle.canvas)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("differential-verification-workspace")
  }

  private var setupDesk: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        ScrollView {
          VStack(alignment: .leading, spacing: 22) {
            PremiumFieldLabel("COMPARISON PAIR")
            PremiumInput(
              label: "REFERENCE REVISION", icon: "arrow.uturn.backward",
              placeholder: "main", text: $model.differentialReference)
            VStack(alignment: .leading, spacing: 8) {
              PremiumFieldLabel("CANDIDATE SOURCE")
              Picker("Candidate source", selection: $model.differentialCandidateKind) {
                ForEach(DifferentialCandidateKind.allCases) { kind in
                  Text(kind.rawValue.capitalized).tag(kind)
                }
              }
              .pickerStyle(.segmented).labelsHidden().tint(.secondary)
            }
            if model.differentialCandidateKind == .commit
              || model.differentialCandidateKind == .range
            {
              PremiumInput(
                label: model.differentialCandidateKind == .commit
                  ? "CANDIDATE COMMIT" : "CANDIDATE RANGE",
                icon: "point.topleft.down.to.point.bottomright.curvepath",
                placeholder: model.differentialCandidateKind == .commit
                  ? "HEAD" : "main...HEAD",
                text: $model.differentialCandidateRevision)
            }

            VStack(alignment: .leading, spacing: 10) {
              PremiumFieldLabel("PARITY CONTRACT")
              row("Scenario set", "Shared and bounded")
              row("Observation policy", "Identical on both sides")
              row("Timing", "Parity-gated")
              row("Pass authority", "Never created by differential")
              row("Model calls", "0")
            }

            if let issue = model.differentialIssue ?? model.differentialInputIssue {
              Label(issue, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(
                  model.differentialIssue == nil ? EvidenceStyle.warning : EvidenceStyle.failure
                )
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(
                  EvidenceStyle.warning.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
            }
          }
          .padding(28).frame(maxWidth: 620, alignment: .leading)
        }
        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        preparationInspector.frame(width: 330)
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      actionBar
    }
  }

  private var preparationInspector: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        PremiumFieldLabel("PREPARATION RECEIPT")
        if let prepared = model.differentialPrepared {
          Label(
            prepared.status == "ready" ? "Pair ready" : "Pair incomparable",
            systemImage: prepared.status == "ready"
              ? "checkmark.seal.fill" : "questionmark.diamond.fill"
          )
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(
            prepared.status == "ready" ? EvidenceStyle.success : EvidenceStyle.warning)
          datum("RUN", prepared.runID)
          datum("REFERENCE", prepared.referenceSHA.map { String($0.prefix(14)) } ?? "unresolved")
          datum("CANDIDATE", prepared.candidateKind.rawValue)
          datum("SCENARIOS", "\(prepared.scenarioCount)")
          datum("SOURCE CACHE", "\(prepared.sourceCacheHits)/2")
          datum("DEPENDENCIES", prepared.dependencyCacheHit ? "cache hit" : "prepared")
          datum("PREPARED", bytes(prepared.preparedBytes))
          datum("MODEL CALLS", "\(prepared.modelCallCount)")
          if !prepared.reasonCodes.isEmpty {
            Divider()
            PremiumFieldLabel("REASON CODES")
            ForEach(prepared.reasonCodes, id: \.self) { reason in
              Text(reason).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
            }
          }
        } else {
          Label("Not prepared", systemImage: "square.dashed")
            .font(.system(size: 13, weight: .semibold))
          Text(
            "Preparation materializes and validates the exact pair before comparison can execute."
          )
          .font(.system(size: 10)).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        Divider()
        Label("codevetter differential", systemImage: "terminal.fill")
          .font(.system(size: 10, weight: .semibold, design: .monospaced))
          .foregroundStyle(EvidenceStyle.success)
        Text(
          "Swift renders the contract. Rust owns source materialization, parity, comparison, cleanup, persistence, and classification."
        )
        .font(.system(size: 9)).foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      }
      .padding(24)
    }
    .background(EvidenceStyle.inspector)
  }

  private var actionBar: some View {
    HStack(spacing: 12) {
      if model.differentialState == .planning || model.differentialState == .running {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
      }
      Text(model.differentialStatusMessage)
        .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary).lineLimit(2)
      Spacer()
      if model.differentialState == .planning || model.differentialState == .running {
        Button("Cancel", role: .destructive) { model.cancelDifferentialVerification() }
          .buttonStyle(.bordered)
      } else {
        Button("Prepare pair") { model.prepareDifferential() }
          .buttonStyle(.bordered).disabled(!model.canPrepareDifferential)
        Button("Run comparison") { model.runDifferentialVerification() }
          .buttonStyle(PremiumPrimaryButtonStyle()).disabled(!model.canRunDifferential)
      }
    }
    .padding(.horizontal, 22).frame(minHeight: 68).background(EvidenceStyle.chrome)
  }

  private func receiptDesk(_ receipt: StoredDifferentialRun) -> some View {
    let summary = receipt.summary
    return VStack(spacing: 0) {
      HStack(spacing: 14) {
        VStack(alignment: .leading, spacing: 4) {
          Text("COMPARISON RECORDED")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1).foregroundStyle(classificationColor(summary.classification))
          Text(model.differentialStatusMessage).font(.system(size: 16, weight: .semibold))
          Text(
            "\(summary.scenarioCount) scenarios · \(summary.deltaCount) deltas · \(summary.blockingDeltaCount) blocking"
          )
          .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
        }
        Spacer()
        StatusPill(
          label: summary.classification, color: classificationColor(summary.classification))
        Button("Open in Runs") {
          model.showingDifferentialVerifier = false
          model.section = .runs
          model.loadRuns()
        }.buttonStyle(.bordered)
        Button("New pair") { model.resetDifferentialVerification() }.buttonStyle(.bordered)
      }
      .padding(.horizontal, 22).frame(height: 76).background(EvidenceStyle.chrome)
      .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }

      HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 16) {
          PremiumFieldLabel("EXACT PAIR")
          datum("REFERENCE", summary.referenceSHA.map { String($0.prefix(16)) } ?? "unresolved")
          datum("CANDIDATE", summary.candidateKind.rawValue)
          datum("IDENTITY", summary.candidateIdentity.map { String($0.prefix(16)) } ?? "unresolved")
          datum("DURATION", "\(Int(summary.durationMS)) ms")
          datum("CLEANUP", summary.cleanupComplete ? "complete" : "incomplete")
          datum("MODEL CALLS", "\(summary.modelCallCount)")
          Divider()
          Text("Differential evidence never creates pass evidence.")
            .font(.system(size: 9, weight: .semibold)).foregroundStyle(EvidenceStyle.warning)
            .fixedSize(horizontal: false, vertical: true)
          Spacer()
          Label("Rust validated + persisted", systemImage: "checkmark.seal.fill")
            .font(.system(size: 10, weight: .semibold)).foregroundStyle(EvidenceStyle.success)
        }
        .padding(22).frame(width: 260, alignment: .topLeading).background(EvidenceStyle.chrome)
        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
              metric("SCENARIOS", "\(summary.scenarioCount)")
              metric("DELTAS", "\(summary.deltaCount)")
              metric("BLOCKING", "\(summary.blockingDeltaCount)")
            }
            PremiumFieldLabel("DELTA PREVIEWS")
            if summary.deltaPreviews.isEmpty {
              Label("No behavioral deltas recorded", systemImage: "equal.circle.fill")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(EvidenceStyle.success)
                .padding(15).frame(maxWidth: .infinity, alignment: .leading)
                .background(
                  EvidenceStyle.success.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
            }
            ForEach(summary.deltaPreviews) { delta in
              VStack(alignment: .leading, spacing: 8) {
                HStack {
                  Label(
                    delta.kind,
                    systemImage: delta.blocking ? "xmark.octagon.fill" : "arrow.left.arrow.right"
                  )
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundStyle(delta.blocking ? EvidenceStyle.failure : EvidenceStyle.warning)
                  Spacer()
                  Text(delta.direction).font(.system(size: 9, design: .monospaced)).foregroundStyle(
                    .secondary)
                }
                Text(delta.scenarioID).font(.system(size: 10, design: .monospaced))
                Text(delta.policyID).font(.system(size: 8, design: .monospaced)).foregroundStyle(
                  .tertiary)
              }
              .padding(14).background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
              .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
            }
            if !summary.reasonCodes.isEmpty {
              PremiumFieldLabel("REASON CODES")
              ForEach(summary.reasonCodes, id: \.self) { reason in
                Text(reason).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
              }
            }
          }.padding(18)
        }
      }
    }
  }

  private func row(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label).font(.system(size: 10, weight: .semibold))
      Spacer()
      Text(value).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
    }
    .padding(12).background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 10))
  }

  private func datum(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 9, weight: .medium, design: .monospaced)).foregroundStyle(
        .secondary
      ).textSelection(.enabled).lineLimit(2)
    }
  }

  private func metric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 18, weight: .semibold, design: .monospaced))
    }
    .padding(13).frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
    .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
  }

  private var stateColor: Color {
    switch model.differentialState {
    case .running, .planning: EvidenceStyle.amber
    case .completed, .planned: EvidenceStyle.success
    case .limited: EvidenceStyle.warning
    case .failed: EvidenceStyle.failure
    case .ready, .cancelled: .secondary
    }
  }

  private func classificationColor(_ value: String) -> Color {
    switch value {
    case "regressed": EvidenceStyle.failure
    case "improved": EvidenceStyle.success
    case "unchanged": .secondary
    default: EvidenceStyle.warning
    }
  }

  private func bytes(_ value: UInt64) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(clamping: value), countStyle: .memory)
  }
}
