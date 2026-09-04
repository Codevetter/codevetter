import SwiftUI

struct PremiumScenarioCompilerView: View {
  @Bindable var model: WorkbenchModel
  @Environment(\.dismiss) private var dismiss
  @State private var showsAuthoring = false
  @State private var showsCandidateList = false

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      HStack(spacing: 0) {
        if model.selectedScenarioCandidate == nil || showsAuthoring {
          authoringPanel.frame(width: 310)
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        }
        if model.selectedScenarioCandidate == nil || showsCandidateList {
          candidateList.frame(width: 250)
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        }
        candidateInspector
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      actionBar
    }
    .background(EvidenceStyle.canvas)
    .onAppear {
      if model.scenarioCandidates.isEmpty, model.scenarioState == .ready {
        model.inspectScenarioCandidates()
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("scenario-compiler-workspace")
  }

  private var header: some View {
    HStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("SCENARIO FOUNDRY")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.15).foregroundStyle(EvidenceStyle.amberForeground)
        Text("Turn intent into executable journeys—safely.")
          .font(.system(size: 20, weight: .semibold)).tracking(-0.3)
        Text("Generate · inspect · validate · dry-run · explicitly accept")
          .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
      }
      Spacer()
      StatusPill(label: model.scenarioState.rawValue, color: stateColor)
      if model.selectedScenarioCandidate != nil {
        Menu {
          Button(showsAuthoring ? "Hide setup" : "Edit setup") {
            showsAuthoring.toggle()
          }
          Button(showsCandidateList ? "Hide candidates" : "Browse candidates") {
            showsCandidateList.toggle()
          }
        } label: {
          Label("Details", systemImage: "sidebar.leading")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
      }
      Button("Done") { dismiss() }.buttonStyle(.bordered)
    }
    .padding(.horizontal, 24).frame(height: 88).background(EvidenceStyle.chrome)
  }

  private var authoringPanel: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 17) {
        PremiumFieldLabel("LOCAL GENERATION")
        PremiumInput(
          label: "SPECIFICATION", icon: "doc.text",
          placeholder: "docs/checkout.md", text: $model.scenarioSpecPath)
        PremiumInput(
          label: "SECTION (OPTIONAL)", icon: "text.quote",
          placeholder: "Checkout", text: $model.scenarioSpecSection)
        PremiumInput(
          label: "LOCAL MODEL", icon: "cpu",
          placeholder: "qwen2.5-coder:7b", text: $model.scenarioModel)
        PremiumInput(
          label: "ROUTES", icon: "point.topleft.down.to.point.bottomright.curvepath",
          placeholder: "/checkout, /receipt", text: $model.scenarioRoutes)
        Toggle("Include request policy", isOn: $model.scenarioIncludeRequestPolicy)
          .toggleStyle(.checkbox).tint(EvidenceStyle.amber)
          .font(.system(size: 10, weight: .semibold))
        Text(
          "Generation is free/local only. It creates an expiring candidate, never project files."
        )
        .font(.system(size: 9)).foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        if let issue = model.scenarioIssue ?? model.scenarioInputIssue {
          Label(issue, systemImage: "exclamationmark.triangle.fill")
            .font(.system(size: 9)).foregroundStyle(EvidenceStyle.warning)
            .fixedSize(horizontal: false, vertical: true)
        }
        Button("Generate candidate") { model.generateScenarioCandidate() }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .disabled(!model.canGenerateScenario)
          .frame(maxWidth: .infinity, alignment: .trailing)
        Divider()
        PremiumFieldLabel("SAFETY BOUNDARY")
        boundary("No provider spend", true)
        boundary("No evidence persistence in dry-run", true)
        boundary("No baseline updates in dry-run", true)
        boundary("Hash-bound acceptance", true)
        boundary("Per-file destination choice", true)
      }.padding(22)
    }.background(EvidenceStyle.inspector)
  }

  private var candidateList: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        PremiumFieldLabel("CANDIDATES")
        Spacer()
        Button {
          model.inspectScenarioCandidates()
        } label: {
          Image(systemName: "arrow.clockwise")
        }
        .buttonStyle(.borderless).disabled(model.scenarioState == .running)
        .accessibilityLabel("Refresh scenario candidates")
      }.padding(16)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 4) {
          if model.scenarioCandidates.isEmpty {
            Text("No candidates")
              .font(.system(size: 10)).foregroundStyle(.secondary).padding(16)
          }
          ForEach(model.scenarioCandidates) { candidate in
            Button {
              model.selectScenarioCandidate(candidate.candidateID)
            } label: {
              VStack(alignment: .leading, spacing: 6) {
                HStack {
                  Circle().fill(candidateColor(candidate)).frame(width: 7, height: 7)
                  Text(candidate.status.uppercased())
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                  Spacer()
                  if candidate.cacheHit {
                    Image(systemName: "bolt.fill").font(.system(size: 8)).foregroundStyle(
                      EvidenceStyle.amberForeground)
                  }
                }
                Text(candidate.specSourcePath)
                  .font(.system(size: 10, weight: .semibold, design: .monospaced)).lineLimit(2)
                Text("\(candidate.files.count) files · \(candidate.dryRun.status)")
                  .font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
              }
              .padding(12).frame(maxWidth: .infinity, alignment: .leading)
              .background(
                model.selectedScenarioCandidateID == candidate.candidateID
                  ? EvidenceStyle.amber.opacity(0.09) : Color.clear,
                in: RoundedRectangle(cornerRadius: 10)
              )
              .overlay {
                RoundedRectangle(cornerRadius: 10).stroke(
                  model.selectedScenarioCandidateID == candidate.candidateID
                    ? EvidenceStyle.amber.opacity(0.45) : EvidenceStyle.separator)
              }
            }.buttonStyle(.plain)
          }
        }.padding(12)
      }
    }.background(EvidenceStyle.chrome)
  }

  @ViewBuilder private var candidateInspector: some View {
    if let candidate = model.selectedScenarioCandidate {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          HStack {
            VStack(alignment: .leading, spacing: 4) {
              PremiumFieldLabel("CANDIDATE PROOF")
              Text(candidate.candidateID)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
            }
            Spacer()
            StatusPill(label: candidate.dryRun.status, color: dryRunColor(candidate.dryRun.status))
          }
          HStack(spacing: 10) {
            metric("VALID", candidate.validation.qualified ? "YES" : "NO")
            metric("FILES", "\(candidate.files.count)")
          }
          Text(
            "\(candidate.unresolvedRequirements.count) unresolved · \(candidate.usage.actualCostUSD.map { String(format: "$%.4f", $0) } ?? "$0") model cost"
          )
          .font(.system(size: 9, weight: .medium, design: .monospaced))
          .foregroundStyle(.secondary)
          if !candidate.validation.issues.isEmpty {
            PremiumFieldLabel("VALIDATION")
            ForEach(candidate.validation.issues) { issue in
              Label(
                "\(issue.path): \(issue.message)",
                systemImage: issue.severity == "error"
                  ? "xmark.octagon.fill" : "exclamationmark.triangle.fill"
              )
              .font(.system(size: 9)).foregroundStyle(
                issue.severity == "error" ? EvidenceStyle.failure : EvidenceStyle.warning
              )
              .fixedSize(horizontal: false, vertical: true)
            }
          }
          PremiumFieldLabel("CANDIDATE FILES")
          ForEach(candidate.files) { file in
            VStack(alignment: .leading, spacing: 9) {
              Toggle(isOn: destinationBinding(file.destination)) {
                HStack {
                  Image(systemName: file.replacesExisting ? "doc.badge.ellipsis" : "doc.badge.plus")
                    .foregroundStyle(
                      file.replacesExisting ? EvidenceStyle.warning : EvidenceStyle.success)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(file.destination)
                      .font(.system(size: 10, weight: .semibold, design: .monospaced)).lineLimit(2)
                    Text(
                      "\(file.kind) · \(file.replacesExisting ? "replaces existing" : "new file")"
                    )
                    .font(.system(size: 8)).foregroundStyle(.secondary)
                  }
                }
              }.toggleStyle(.checkbox).tint(EvidenceStyle.amber)
              if !file.diff.isEmpty {
                Text(String(file.diff.prefix(12_000)))
                  .font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
                  .textSelection(.enabled).padding(10)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .background(Color.black, in: RoundedRectangle(cornerRadius: 8))
              }
            }
            .padding(13).background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
          }
          if candidate.files.contains(where: {
            $0.replacesExisting && model.selectedScenarioDestinations.contains($0.destination)
          }) {
            Toggle("Approve selected replacements", isOn: $model.scenarioReplacementApproved)
              .toggleStyle(.checkbox).tint(EvidenceStyle.warning)
              .font(.system(size: 10, weight: .semibold))
          }
          Text(
            "Acceptance writes only checked destinations and revalidates the candidate hash. Dry-run evidence is never promoted into product proof."
          )
          .font(.system(size: 9)).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }.padding(20)
      }
    } else {
      ContentUnavailableView(
        "No candidate selected", systemImage: "doc.badge.gearshape",
        description: Text("Generate or inspect a bounded candidate."))
    }
  }

  private var actionBar: some View {
    HStack(spacing: 10) {
      if model.scenarioState == .running {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
      }
      Text(model.scenarioStatusMessage).font(.system(size: 10, weight: .medium)).foregroundStyle(
        .secondary
      ).lineLimit(2)
      Spacer()
      if model.scenarioState == .running {
        Button("Cancel", role: .destructive) { model.cancelScenarioAction() }.buttonStyle(.bordered)
      } else if model.selectedScenarioCandidate != nil {
        Button("Reject", role: .destructive) { model.rejectScenarioCandidate() }.buttonStyle(
          .bordered)
        Button("Validate") { model.validateScenarioCandidate() }.buttonStyle(.bordered)
        Button("Dry-run") { model.dryRunScenarioCandidate() }.buttonStyle(.bordered)
        Button("Accept selected") { model.acceptScenarioCandidate() }
          .buttonStyle(PremiumPrimaryButtonStyle()).disabled(!model.canAcceptScenario)
      }
    }.padding(.horizontal, 20).frame(minHeight: 68).background(EvidenceStyle.chrome)
  }

  private func destinationBinding(_ destination: String) -> Binding<Bool> {
    Binding(
      get: { model.selectedScenarioDestinations.contains(destination) },
      set: { _ in model.toggleScenarioDestination(destination) })
  }

  private func boundary(_ label: String, _ satisfied: Bool) -> some View {
    Label(label, systemImage: satisfied ? "checkmark.circle.fill" : "circle")
      .font(.system(size: 9, weight: .medium)).foregroundStyle(
        satisfied ? EvidenceStyle.success : .secondary)
  }

  private func metric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 14, weight: .semibold, design: .monospaced))
    }
    .padding(11).frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 10))
    .overlay { RoundedRectangle(cornerRadius: 10).stroke(EvidenceStyle.separator) }
  }

  private var stateColor: Color {
    switch model.scenarioState {
    case .running, .planning: EvidenceStyle.amber
    case .completed, .planned: EvidenceStyle.success
    case .limited: EvidenceStyle.warning
    case .failed: EvidenceStyle.failure
    case .ready, .cancelled: .secondary
    }
  }

  private func candidateColor(_ candidate: ScenarioCandidate) -> Color {
    if candidate.status != "candidate" { return .secondary }
    return candidate.validation.qualified && candidate.dryRun.status == "passed"
      ? EvidenceStyle.success : EvidenceStyle.warning
  }

  private func dryRunColor(_ value: String) -> Color {
    switch value {
    case "passed": EvidenceStyle.success
    case "failed": EvidenceStyle.failure
    default: .secondary
    }
  }
}
