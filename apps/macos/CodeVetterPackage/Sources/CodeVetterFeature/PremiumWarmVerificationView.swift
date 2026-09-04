import SwiftUI

private enum WarmReceiptMode: String, CaseIterable, Identifiable {
  case evidence = "Evidence"
  case json = "JSON"

  var id: String { rawValue }
}

struct PremiumWarmVerificationView: View {
  @Bindable var model: WorkbenchModel
  @Environment(\.dismiss) private var dismiss
  @State private var mode: WarmReceiptMode = .evidence
  @State private var showsReceiptDetails = false

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      if let receipt = model.warmReceipt {
        receiptDesk(receipt)
      } else {
        setupDesk
      }
    }
    .background(EvidenceStyle.canvas)
    .onAppear {
      if model.warmHealth == nil, model.warmState == .ready, !model.repositoryPath.isEmpty {
        model.inspectWarmVerifier()
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("warm-verification-workspace")
  }

  private var header: some View {
    HStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("WARM / CHANGED PROOF")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.15)
          .foregroundStyle(EvidenceStyle.amberForeground)
        Text("Keep the browser hot. Re-prove only what changed.")
          .font(.system(size: 20, weight: .semibold))
          .tracking(-0.3)
        Text("One repository-owned daemon · deterministic scenario selection · zero model calls")
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      Spacer()
      StatusPill(label: model.warmState.rawValue, color: stateColor)
      Button("Done") { dismiss() }.buttonStyle(.bordered)
    }
    .padding(.horizontal, 24)
    .frame(height: 88)
    .background(EvidenceStyle.chrome)
  }

  private var setupDesk: some View {
    HStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 8) {
            PremiumFieldLabel("EXACT REPOSITORY")
            Label(repositoryLabel, systemImage: "folder.fill")
              .font(.system(size: 12, weight: .semibold, design: .monospaced))
              .foregroundStyle(model.repositoryPath.isEmpty ? .secondary : .primary)
              .padding(15)
              .frame(maxWidth: .infinity, alignment: .leading)
              .premiumField()
            Text(
              "The Rust bridge discovers exactly one repository-owned verify script and rejects ambiguous package-manager lockfiles."
            )
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
          }

          VStack(alignment: .leading, spacing: 10) {
            PremiumFieldLabel("CHANGE CONTRACT")
            contractRow("Scope", "Current Git worktree", icon: "arrow.triangle.branch")
            contractRow("Selection", "Changed paths + mandatory smoke", icon: "scope")
            contractRow("Authority", "Repository verify manifest", icon: "checkmark.seal")
            contractRow("Network", "Owned local runtime only", icon: "lock.shield")
          }

          Toggle(isOn: $model.warmDetailedCapture) {
            VStack(alignment: .leading, spacing: 4) {
              Text("Retain bounded detailed artifacts")
                .font(.system(size: 12, weight: .semibold))
              Text(
                "Keep redacted screenshots, traces, network, console, and report artifacts under the verifier retention policy."
              )
              .font(.system(size: 10))
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
            }
          }
          .toggleStyle(.checkbox)
          .tint(EvidenceStyle.amber)
          .padding(15)
          .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

          if let issue = model.warmIssue {
            Label(issue, systemImage: "xmark.octagon.fill")
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(EvidenceStyle.failure)
              .padding(14)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(
                EvidenceStyle.failure.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
          }
        }
        .padding(28)
        .frame(maxWidth: 620, alignment: .leading)
      }

      Rectangle().fill(EvidenceStyle.separator).frame(width: 1)

      daemonInspector
        .frame(width: 330)
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      actionBar
    }
  }

  private var daemonInspector: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        HStack {
          PremiumFieldLabel("OWNED RUNTIME")
          Spacer()
          Button {
            model.inspectWarmVerifier()
          } label: {
            Image(systemName: "arrow.clockwise")
          }
          .buttonStyle(.borderless)
          .disabled(model.warmState == .running || model.repositoryPath.isEmpty)
          .accessibilityLabel("Refresh warm verifier health")
        }

        if let health = model.warmHealth {
          Label(
            health.warm ? "Warm and ready" : "Runtime reported cold",
            systemImage: health.warm ? "flame.fill" : "snowflake"
          )
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(health.warm ? EvidenceStyle.amberForeground : .secondary)
          telemetry("DAEMON", "PID \(health.daemonPID)")
          telemetry("SERVER", runtimeLabel(health.server))
          telemetry("BROWSER", runtimeLabel(health.browser))
          telemetry("ACTIVE RUNS", "\(health.activeRunIDs.count)")
          Divider()
          PremiumFieldLabel("RESOURCE SNAPSHOT")
          telemetry("RSS", byteLabel(health.resources.rssBytes))
          telemetry("HEAP", byteLabel(health.resources.heapUsedBytes))
          telemetry("CONTEXTS", "\(health.resources.activeContexts)")
          telemetry("ARTIFACTS", byteLabel(health.resources.retainedArtifactBytes))
          Divider()
          PremiumFieldLabel("TARGET SHA")
          Text(String(health.targetSHA.prefix(16)))
            .font(.system(size: 10, design: .monospaced))
            .textSelection(.enabled)
        } else {
          Label("Verifier is cold", systemImage: "moon.stars")
            .font(.system(size: 13, weight: .semibold))
          Text(
            "No owned daemon is reachable. A changed-proof run may start one, warm its declared server and browser, then return a versioned receipt."
          )
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }

        Divider()
        Label("codevetter warm", systemImage: "terminal.fill")
          .font(.system(size: 10, weight: .semibold, design: .monospaced))
          .foregroundStyle(EvidenceStyle.success)
        Text(
          "Swift never recreates daemon, scenario, observation, retention, or outcome semantics. Agents use this same CLI contract."
        )
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      }
      .padding(24)
    }
    .background(EvidenceStyle.inspector)
  }

  private var actionBar: some View {
    HStack(spacing: 12) {
      if model.warmState == .running {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
      }
      Text(model.warmStatusMessage)
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(2)
      Spacer()
      if model.warmState == .running {
        Button("Cancel", role: .destructive) { model.cancelWarmVerification() }
          .buttonStyle(.bordered)
      } else {
        Button("Run changed proof") { model.runWarmVerification() }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .disabled(!model.canRunWarmVerification)
          .keyboardShortcut(.return, modifiers: [.command])
      }
    }
    .padding(.horizontal, 22)
    .frame(minHeight: 68)
    .background(EvidenceStyle.chrome)
    .overlay(alignment: .top) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }
  }

  private func receiptDesk(_ receipt: WarmVerificationRunReceipt) -> some View {
    let result = receipt.result
    return VStack(spacing: 0) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text(result.outcome == .passed ? "CHANGED SCOPE QUALIFIED" : "CHANGED SCOPE EVIDENCE")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1)
            .foregroundStyle(outcomeColor(result.outcome))
          Text(model.warmStatusMessage)
            .font(.system(size: 16, weight: .semibold))
            .lineLimit(1)
          Text(
            "\(result.selection.changedPaths.count) paths · \(result.scenarios.count) scenarios · \(result.observations.count) observations"
          )
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
        }
        Spacer()
        StatusPill(label: outcomeLabel(result.outcome), color: outcomeColor(result.outcome))
        Button {
          showsReceiptDetails.toggle()
        } label: {
          Label(showsReceiptDetails ? "Hide details" : "Details", systemImage: "sidebar.leading")
        }
        .buttonStyle(.bordered)
        Button("Open in Runs") {
          model.showingWarmVerifier = false
          model.section = .runs
          model.loadRuns()
        }
        .buttonStyle(.bordered)
        Button("New proof") { model.resetWarmVerification() }.buttonStyle(.bordered)
      }
      .padding(.horizontal, 22)
      .frame(height: 76)
      .background(EvidenceStyle.chrome)
      .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }

      HStack(spacing: 0) {
        if showsReceiptDetails {
          scenarioIndex(result).frame(width: 250)
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        }
        VStack(spacing: 0) {
          HStack {
            PremiumFieldLabel("RUNTIME EVIDENCE")
            Spacer()
            Picker("Receipt mode", selection: $mode) {
              ForEach(WarmReceiptMode.allCases) { value in
                Text(value.rawValue).tag(value)
              }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 166)
            .tint(.secondary)
          }
          .padding(.horizontal, 16)
          .frame(height: 46)
          .background(EvidenceStyle.surface)
          .overlay(alignment: .bottom) {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
          }

          if mode == .json {
            ScrollView([.horizontal, .vertical]) {
              Text(model.warmReceiptJSON)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
          } else {
            evidenceColumn(result)
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        if showsReceiptDetails {
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
          receiptInspector(result).frame(width: 290)
        }
      }
    }
  }

  private func scenarioIndex(_ result: WarmVerificationResult) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      PremiumFieldLabel("SELECTED SCENARIOS").padding(16)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2) {
          if result.scenarios.isEmpty {
            Text("No scenarios selected")
              .font(.system(size: 10))
              .foregroundStyle(.secondary)
              .padding(16)
          }
          ForEach(result.scenarios) { scenario in
            HStack(spacing: 9) {
              Circle().fill(outcomeColor(scenario.outcome)).frame(width: 7, height: 7)
              VStack(alignment: .leading, spacing: 3) {
                Text(scenario.scenarioID)
                  .font(.system(size: 9, weight: .semibold, design: .monospaced))
                  .lineLimit(2)
                Text("\(Int(scenario.durationMS)) ms")
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(.secondary)
              }
              Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
          }
        }
      }
      Divider()
      VStack(alignment: .leading, spacing: 6) {
        PremiumFieldLabel("SELECTION")
        Text(result.selection.explanation)
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        Label(
          result.selection.complete ? "Selection complete" : "Selection incomplete",
          systemImage: result.selection.complete
            ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
        )
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(result.selection.complete ? EvidenceStyle.success : EvidenceStyle.warning)
      }
      .padding(16)
    }
    .background(EvidenceStyle.chrome)
  }

  private func evidenceColumn(_ result: WarmVerificationResult) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        HStack(spacing: 10) {
          metricCard("SCENARIOS", "\(result.scenarios.count)")
          metricCard("OBSERVATIONS", "\(result.observations.count)")
        }

        Text(
          "\(result.artifacts.count) retained artifacts · \(result.modelCallCount) model calls"
        )
        .font(.system(size: 9, weight: .medium, design: .monospaced))
        .foregroundStyle(.secondary)

        if result.observations.isEmpty {
          Label("No policy observations were recorded", systemImage: "checkmark.circle")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(EvidenceStyle.success)
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EvidenceStyle.success.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
        } else {
          PremiumFieldLabel("POLICY OBSERVATIONS")
          ForEach(result.observations) { observation in
            VStack(alignment: .leading, spacing: 8) {
              HStack {
                Label(
                  observation.kind.replacingOccurrences(of: "_", with: " "),
                  systemImage: observationIcon(observation.disposition)
                )
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(observationColor(observation.disposition))
                Spacer()
                Text(observation.scenarioID)
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(.secondary)
              }
              Text(observation.message)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
              Text(observation.policyID)
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
          }
        }

        if !result.artifacts.isEmpty {
          PremiumFieldLabel("REDACTED ARTIFACTS")
          ForEach(result.artifacts) { artifact in
            HStack(spacing: 10) {
              Image(systemName: "doc.badge.lock").foregroundStyle(EvidenceStyle.amberForeground)
              VStack(alignment: .leading, spacing: 3) {
                Text(artifact.relativePath)
                  .font(.system(size: 9, weight: .medium, design: .monospaced))
                  .lineLimit(2)
                Text(
                  "\(artifact.kind) · \(byteLabel(artifact.bytes)) · retained until \(artifact.retainedUntil)"
                )
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
              }
              Spacer(minLength: 0)
            }
            .padding(12)
            .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 10))
          }
        }
      }
      .padding(16)
    }
  }

  private func receiptInspector(_ result: WarmVerificationResult) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 17) {
        PremiumFieldLabel("PROOF IDENTITY")
        telemetry("RUN", result.runID)
        telemetry("TARGET", String(result.source.targetSHA.prefix(14)))
        telemetry("CHANGE", result.source.changeSetKind)
        telemetry("POLICY", result.observationPolicy.profileID)
        telemetry("WARM", result.warm ? "yes" : "no")
        telemetry("STALE", result.stale ? "yes" : "no")
        Divider()
        PremiumFieldLabel("TIMINGS")
        ForEach(result.timings.filter { $0.scenarioID == nil }.prefix(12)) { timing in
          telemetry(timing.stage.uppercased(), "\(Int(timing.durationMS)) ms")
        }
        Divider()
        PremiumFieldLabel("LIMITATIONS")
        if result.limitations.isEmpty {
          Label("No limitations recorded", systemImage: "checkmark.circle.fill")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(EvidenceStyle.success)
        } else {
          ForEach(result.limitations) { limitation in
            VStack(alignment: .leading, spacing: 4) {
              Label(limitation.code, systemImage: "exclamationmark.triangle")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(limitation.affectsConfidence ? EvidenceStyle.warning : .secondary)
              Text(limitation.message)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        Divider()
        Label("Rust validated + persisted", systemImage: "checkmark.seal.fill")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(EvidenceStyle.success)
      }
      .padding(20)
    }
    .background(EvidenceStyle.inspector)
  }

  private func contractRow(_ label: String, _ value: String, icon: String) -> some View {
    HStack(spacing: 11) {
      Image(systemName: icon).foregroundStyle(EvidenceStyle.amberForeground).frame(width: 16)
      Text(label).font(.system(size: 10, weight: .semibold))
      Spacer()
      Text(value).font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
    }
    .padding(12)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 10))
    .overlay { RoundedRectangle(cornerRadius: 10).stroke(EvidenceStyle.separator) }
  }

  private func metricCard(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 17, weight: .semibold, design: .monospaced))
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 10))
    .overlay { RoundedRectangle(cornerRadius: 10).stroke(EvidenceStyle.separator) }
  }

  private func telemetry(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 9, weight: .medium, design: .monospaced))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
        .lineLimit(2)
    }
  }

  private var repositoryLabel: String {
    model.repositoryPath.isEmpty
      ? "No repository selected"
      : URL(fileURLWithPath: model.repositoryPath).lastPathComponent
  }

  private var stateColor: Color {
    switch model.warmState {
    case .running: EvidenceStyle.amber
    case .completed, .planned: EvidenceStyle.success
    case .limited: EvidenceStyle.warning
    case .failed: EvidenceStyle.failure
    case .ready, .planning, .cancelled: .secondary
    }
  }

  private func outcomeLabel(_ outcome: WarmVerificationOutcome) -> String {
    outcome.rawValue.replacingOccurrences(of: "_", with: " ")
  }

  private func outcomeColor(_ outcome: WarmVerificationOutcome) -> Color {
    switch outcome {
    case .passed: EvidenceStyle.success
    case .regression: EvidenceStyle.failure
    case .noConfidence: EvidenceStyle.warning
    }
  }

  private func observationColor(_ disposition: String) -> Color {
    switch disposition {
    case "passed": EvidenceStyle.success
    case "regression": EvidenceStyle.failure
    case "no_confidence": EvidenceStyle.warning
    default: .secondary
    }
  }

  private func observationIcon(_ disposition: String) -> String {
    switch disposition {
    case "passed": "checkmark.circle.fill"
    case "regression": "xmark.octagon.fill"
    case "no_confidence": "exclamationmark.triangle.fill"
    default: "info.circle.fill"
    }
  }

  private func runtimeLabel(_ runtime: WarmRuntimeHealth) -> String {
    "\(runtime.state) · \(runtime.owned ? "owned" : "unowned")"
  }

  private func byteLabel(_ bytes: UInt64) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(clamping: bytes), countStyle: .memory)
  }
}
