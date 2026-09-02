import SwiftUI
import UniformTypeIdentifiers

public struct EvidenceSidebarView: View {
  @Bindable private var model: WorkbenchModel

  public init(model: WorkbenchModel) {
    self.model = model
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 10) {
        ZStack {
          RoundedRectangle(cornerRadius: 8)
            .fill(EvidenceStyle.amber.gradient)
          Image(systemName: "checkmark.shield.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.black.opacity(0.82))
        }
        .frame(width: 30, height: 30)
        VStack(alignment: .leading, spacing: 1) {
          Text("CodeVetter").font(.system(size: 14, weight: .semibold))
          Text("Evidence Workbench")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.secondary)
        }
      }
      .padding(.horizontal, 14)
      .padding(.top, 14)
      .padding(.bottom, 18)

      navigationGroup("Workspace", sections: [.usage, .repository])
      navigationGroup("Verification", sections: [.review, .testing, .performance])
        .padding(.top, 12)
      navigationGroup("Evidence", sections: [.runs, .capabilities])
        .padding(.top, 12)

      Spacer()

      VStack(alignment: .leading, spacing: 8) {
        Label("Rust engine", systemImage: "shippingbox")
          .font(.system(size: 11, weight: .semibold))
        HStack(spacing: 6) {
          Circle().fill(EvidenceStyle.success).frame(width: 6, height: 6)
          Text("Contract loaded")
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
        }
        Text(model.registry.schemaVersion)
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.tertiary)
          .lineLimit(1)
      }
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 9))
      .padding(10)

      navigationButton(.settings)
        .padding(.horizontal, 8)
        .padding(.bottom, 10)
    }
    .background(.ultraThinMaterial)
  }

  private func navigationGroup(_ title: String, sections: [WorkbenchSection]) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title.uppercased())
        .font(.system(size: 9, weight: .bold))
        .foregroundStyle(.tertiary)
        .padding(.horizontal, 11)
        .padding(.bottom, 3)
      ForEach(sections) { section in navigationButton(section) }
    }
    .padding(.horizontal, 8)
  }

  private func navigationButton(_ section: WorkbenchSection) -> some View {
    Button {
      model.section = section
    } label: {
      HStack(spacing: 10) {
        Image(systemName: section.systemImage)
          .font(.system(size: 13, weight: .medium))
          .frame(width: 18)
        Text(section.rawValue)
          .font(.system(size: 13, weight: .medium))
        Spacer()
        if section == .runs {
          Text("0")
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
        }
      }
      .foregroundStyle(model.section == section ? .primary : .secondary)
      .padding(.horizontal, 11)
      .frame(height: 31)
      .background {
        RoundedRectangle(cornerRadius: 7)
          .fill(model.section == section ? Color.primary.opacity(0.09) : .clear)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(section.rawValue)
    .accessibilityValue(section == .runs ? "0 runs" : "")
    .accessibilityAddTraits(model.section == section ? .isSelected : [])
  }
}

public struct EvidenceWorkbenchView: View {
  @Bindable private var model: WorkbenchModel

  public init(model: WorkbenchModel) {
    self.model = model
  }

  public var body: some View {
    Group {
      switch model.section {
      case .review:
        VerifyView(model: model)
      case .capabilities:
        CapabilityCatalogView(model: model)
      case .usage:
        EmptyWorkbenchView(
          title: "Usage",
          message:
            "Local agent usage, cost, quota, model, and activity views will transfer here without changing their provider boundaries.",
          icon: "chart.bar.xaxis"
        )
      case .runs:
        EmptyWorkbenchView(
          title: "Runs",
          message: "Completed native receipts will appear here after the first verified run.",
          icon: "clock.arrow.circlepath"
        )
      case .repository:
        EmptyWorkbenchView(
          title: "Repo Unpack",
          message:
            "Overview, Handoff, Rules, Analysis, Activity, Inventory, Graph, and Delta will transfer against the existing Rust evidence store.",
          icon: "shippingbox"
        )
      case .testing:
        EmptyWorkbenchView(
          title: "Testing",
          message:
            "Direct previews, changed-capability verification, scenarios, watchers, and executable receipts remain part of the native product.",
          icon: "testtube.2"
        )
      case .performance:
        EmptyWorkbenchView(
          title: "Performance",
          message:
            "Workload admission, measurement, diagnosis, paired optimization proof, cleanup, and receipts will migrate intact.",
          icon: "gauge.with.dots.needle.67percent"
        )
      case .settings:
        EmptyWorkbenchView(
          title: "Settings",
          message:
            "Provider and runtime settings remain local and will migrate only after contract parity.",
          icon: "gearshape"
        )
      }
    }
    .background(EvidenceStyle.canvas)
  }
}

public struct EvidenceInspectorView: View {
  @Bindable private var model: WorkbenchModel

  public init(model: WorkbenchModel) {
    self.model = model
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        if model.section == .capabilities, let capability = model.selectedCapability {
          CapabilityInspector(capability: capability)
        } else {
          VerificationInspector(model: model)
        }
      }
      .padding(18)
    }
    .background(Color(nsColor: .underPageBackgroundColor))
  }
}

private struct VerifyView: View {
  @Bindable var model: WorkbenchModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 5) {
            Text("REVIEW")
              .font(.system(size: 9, weight: .bold))
              .tracking(0.8)
              .foregroundStyle(EvidenceStyle.amberForeground)
            Text("Verify a change")
              .font(.system(size: 24, weight: .semibold))
            Text(
              "Resolve the exact source, run executable checks, and keep the limitations attached."
            )
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
          }
          Spacer()
          StatusPill(label: model.verificationState.rawValue, color: stateColor)
        }

        EvidencePanel {
          VStack(alignment: .leading, spacing: 16) {
            panelHeading(
              "Change identity", caption: "Rust resolves these inputs before any claim is made.")
            VStack(spacing: 12) {
              LabeledContent("Repository") {
                HStack(spacing: 8) {
                  Text(
                    model.repositoryPath.isEmpty ? "No repository selected" : model.repositoryPath
                  )
                  .font(.system(size: 12, design: .monospaced))
                  .foregroundStyle(model.repositoryPath.isEmpty ? .secondary : .primary)
                  .lineLimit(1)
                  .truncationMode(.middle)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  Button("Choose…") { model.choosingRepository = true }
                    .controlSize(.small)
                }
              }
              Divider()
              LabeledContent("Change") {
                TextField("main...HEAD", text: $model.change)
                  .textFieldStyle(.roundedBorder)
                  .font(.system(size: 12, design: .monospaced))
              }
              Divider()
              LabeledContent("Task") {
                TextField("Describe the behavior this change must satisfy", text: $model.task)
                  .textFieldStyle(.roundedBorder)
              }
            }
            .font(.system(size: 12))
          }
        }

        EvidencePanel {
          VStack(alignment: .leading, spacing: 16) {
            panelHeading("Verification dossier", caption: model.statusMessage)
            VerificationRail(model: model)
            HStack(spacing: 10) {
              Button {
                model.plan()
              } label: {
                Label("Plan verification", systemImage: "list.bullet.clipboard")
              }
              .buttonStyle(.borderedProminent)
              .tint(EvidenceStyle.amber)
              .foregroundStyle(.black.opacity(0.84))
              .disabled(!model.canStart)
              .keyboardShortcut(.return, modifiers: [.command])

              Button {
                model.execute()
              } label: {
                Label("Execute", systemImage: "play.fill")
              }
              .buttonStyle(.bordered)
              .disabled(!model.canStart)

              if model.isBusy {
                Button("Cancel", role: .destructive) { model.cancel() }
              }
              Spacer()
              Text("Rust-owned receipt")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
            }
          }
        }

        if let receipt = model.receipt {
          ReceiptSummary(receipt: receipt)
        }
      }
      .padding(24)
      .frame(maxWidth: 940, alignment: .leading)
    }
    .fileImporter(
      isPresented: $model.choosingRepository,
      allowedContentTypes: [.folder],
      allowsMultipleSelection: false
    ) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      model.selectRepository(url)
    }
  }

  private var stateColor: Color {
    switch model.verificationState {
    case .completed, .planned: EvidenceStyle.success
    case .planning, .running: EvidenceStyle.amber
    case .limited: EvidenceStyle.warning
    case .failed: EvidenceStyle.failure
    case .ready, .cancelled: .secondary
    }
  }
}

private struct VerificationRail: View {
  let model: WorkbenchModel

  private let stages = [
    ("1", "Resolve", "Exact repository and revision"),
    ("2", "Correctness", "Discovered or explicit checks"),
    ("3", "Performance", "Bounded workload evidence"),
    ("4", "Review", "Model findings with runtime context"),
    ("5", "Verdict", "Measured outcome and limitations"),
  ]

  var body: some View {
    ViewThatFits(in: .horizontal) {
      horizontalRail
        .fixedSize(horizontal: true, vertical: false)
      compactRail
    }
  }

  private var horizontalRail: some View {
    HStack(alignment: .top, spacing: 0) {
      ForEach(Array(stages.enumerated()), id: \.offset) { index, stage in
        VStack(spacing: 7) {
          ZStack {
            Circle()
              .fill(index == activeIndex ? EvidenceStyle.amber : Color.primary.opacity(0.08))
            Text(stage.0)
              .font(.system(size: 10, weight: .bold, design: .rounded))
              .foregroundStyle(index == activeIndex ? .black : .secondary)
          }
          .frame(width: 24, height: 24)
          Text(stage.1)
            .font(.system(size: 11, weight: .semibold))
          Text(stage.2)
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .frame(width: 92)
        }
        if index < stages.count - 1 {
          Rectangle()
            .fill(Color.primary.opacity(0.09))
            .frame(height: 1)
            .padding(.top, 12)
            .frame(width: 18)
        }
      }
    }
  }

  private var compactRail: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(stages.enumerated()), id: \.offset) { index, stage in
        HStack(spacing: 11) {
          ZStack {
            Circle()
              .fill(index == activeIndex ? EvidenceStyle.amber : Color.primary.opacity(0.08))
            Text(stage.0)
              .font(.system(size: 10, weight: .bold, design: .rounded))
              .foregroundStyle(index == activeIndex ? .black : .secondary)
          }
          .frame(width: 24, height: 24)
          VStack(alignment: .leading, spacing: 2) {
            Text(stage.1)
              .font(.system(size: 11, weight: .semibold))
            Text(stage.2)
              .font(.system(size: 10))
              .foregroundStyle(.secondary)
          }
          Spacer()
          if index < activeIndex {
            Image(systemName: "checkmark.circle.fill")
              .foregroundStyle(EvidenceStyle.success)
          } else if index == activeIndex {
            Text("CURRENT")
              .font(.system(size: 8, weight: .bold))
              .foregroundStyle(EvidenceStyle.amberForeground)
          }
        }
        .padding(.vertical, 7)
        if index < stages.count - 1 {
          Divider().padding(.leading, 35)
        }
      }
    }
  }

  private var activeIndex: Int {
    switch model.verificationState {
    case .ready, .planning: 0
    case .planned: 1
    case .running: 2
    case .completed, .limited, .failed: 4
    case .cancelled: 0
    }
  }
}

private struct ReceiptSummary: View {
  let receipt: VerificationReceipt

  var body: some View {
    EvidencePanel {
      VStack(alignment: .leading, spacing: 14) {
        panelHeading("Canonical receipt", caption: receipt.schemaVersion)
        HStack(spacing: 16) {
          receiptMetric("Outcome", receipt.status ?? receipt.verdict ?? "completed")
          receiptMetric("Changed files", "\(receipt.source.changedPaths.count)")
          receiptMetric("Head", String(receipt.source.headSha.prefix(10)))
        }
        if !receipt.limitations.isEmpty {
          Divider()
          Label("Limitations", systemImage: "exclamationmark.triangle")
            .font(.system(size: 11, weight: .semibold))
          ForEach(receipt.limitations, id: \.self) { limitation in
            Text("• \(limitation)")
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
          }
        }
      }
    }
  }

  private func receiptMetric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label.uppercased())
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(.tertiary)
      Text(value.replacingOccurrences(of: "_", with: " "))
        .font(.system(size: 12, weight: .semibold, design: .monospaced))
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct CapabilityCatalogView: View {
  @Bindable var model: WorkbenchModel

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 5) {
          Text("Capabilities")
            .font(.system(size: 24, weight: .semibold))
          Text("One Rust-owned glossary for the UI, CLI, and AI agent surfaces.")
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
        }
        Spacer()
        Text(model.registry.schemaVersion)
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 9)
          .padding(.vertical, 5)
          .background(Color.primary.opacity(0.06), in: Capsule())
      }

      Grid(horizontalSpacing: 12, verticalSpacing: 0) {
        GridRow {
          header("Capability", alignment: .leading)
          header("Stage")
          header("UI")
          header("CLI")
          header("Agent")
        }
        Divider().gridCellColumns(5)
        ForEach(model.registry.capabilities) { capability in
          GridRow {
            Button {
              model.selectedCapabilityID = capability.id
            } label: {
              VStack(alignment: .leading, spacing: 3) {
                Text(capability.name)
                  .font(.system(size: 12, weight: .semibold))
                Text(capability.id)
                  .font(.system(size: 9, design: .monospaced))
                  .foregroundStyle(.tertiary)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            stageLabel(capability.stage)
            availabilityLabel(capability.surfaces.ui.availability)
            availabilityLabel(capability.surfaces.cli.availability)
            availabilityLabel(capability.surfaces.agent.availability)
          }
          .padding(.vertical, 10)
          .background(
            model.selectedCapabilityID == capability.id
              ? EvidenceStyle.amber.opacity(0.07)
              : .clear
          )
          Divider().gridCellColumns(5)
        }
      }
      .padding(12)
      .background(EvidenceStyle.panel.opacity(0.78), in: RoundedRectangle(cornerRadius: 12))
      .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
      Spacer()
    }
    .padding(24)
  }

  private func header(_ text: String, alignment: Alignment = .center) -> some View {
    Text(text.uppercased())
      .font(.system(size: 9, weight: .bold))
      .foregroundStyle(.tertiary)
      .frame(maxWidth: .infinity, alignment: alignment)
      .padding(.vertical, 8)
  }

  private func stageLabel(_ stage: CapabilityStage) -> some View {
    Text(stage.rawValue.capitalized)
      .font(.system(size: 10, weight: .medium))
      .foregroundStyle(stage == .current ? EvidenceStyle.success : .secondary)
      .frame(maxWidth: .infinity)
  }

  private func availabilityLabel(_ availability: Availability) -> some View {
    Image(
      systemName: availability == .available ? "checkmark.circle.fill" : symbol(for: availability)
    )
    .foregroundStyle(color(for: availability))
    .frame(maxWidth: .infinity)
    .accessibilityLabel(availability.rawValue)
  }

  private func symbol(for availability: Availability) -> String {
    switch availability {
    case .available: "checkmark.circle.fill"
    case .building: "hammer.circle.fill"
    case .planned: "clock"
    case .unavailable: "minus.circle"
    }
  }

  private func color(for availability: Availability) -> Color {
    switch availability {
    case .available: EvidenceStyle.success
    case .building: EvidenceStyle.amber
    case .planned, .unavailable: .secondary
    }
  }
}

private struct VerificationInspector: View {
  let model: WorkbenchModel

  var body: some View {
    Text("EVIDENCE")
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(.tertiary)
    if let receipt = model.receipt {
      inspectorPair("Schema", receipt.schemaVersion)
      inspectorPair("Source", receipt.source.input)
      inspectorPair("Base", String(receipt.source.baseSha.prefix(12)))
      inspectorPair("Head", String(receipt.source.headSha.prefix(12)))
      Divider()
      Text("RAW RECEIPT")
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(.tertiary)
      Text(model.receiptJSON)
        .textSelection(.enabled)
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(.secondary)
    } else {
      Text("PROOF STANDARD")
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(.tertiary)
      Text("A verdict earns its place here.")
        .font(.system(size: 17, weight: .semibold))
      Text("CodeVetter keeps the claim attached to what actually ran.")
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
      Divider()
      inspectorRequirement(
        "Exact change identity", "Repository, base, head, and changed paths are resolved first.",
        icon: "point.topleft.down.to.point.bottomright.curvepath")
      inspectorRequirement(
        "Executable evidence", "Checks and artifacts come from the supervised Rust engine.",
        icon: "terminal")
      inspectorRequirement(
        "Bounded verdict", "Known limitations remain visible beside the outcome.",
        icon: "scope")
      Divider()
      Label("The receipt stays pinned while you inspect the workbench.", systemImage: "pin")
        .font(.system(size: 10))
        .foregroundStyle(.tertiary)
    }
  }
}

private func inspectorRequirement(_ title: String, _ detail: String, icon: String) -> some View {
  HStack(alignment: .top, spacing: 10) {
    Image(systemName: icon)
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(EvidenceStyle.amberForeground)
      .frame(width: 18, height: 18)
    VStack(alignment: .leading, spacing: 3) {
      Text(title)
        .font(.system(size: 11, weight: .semibold))
      Text(detail)
        .font(.system(size: 10))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

private struct CapabilityInspector: View {
  let capability: Capability

  var body: some View {
    Text("CAPABILITY")
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(.tertiary)
    Text(capability.name)
      .font(.system(size: 17, weight: .semibold))
    Text(capability.purpose)
      .font(.system(size: 12))
      .foregroundStyle(.secondary)
    Divider()
    inspectorPair("Qualification", capability.qualification.rawValue)
    inspectorPair("Data boundary", capability.dataBoundary)
    Text("UNDERLYING TOOLS")
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(.tertiary)
    ForEach(capability.underlyingTools) { tool in
      VStack(alignment: .leading, spacing: 3) {
        Text(tool.name).font(.system(size: 11, weight: .semibold))
        Text(tool.role).font(.system(size: 10)).foregroundStyle(.secondary)
        Text(tool.requirement.uppercased())
          .font(.system(size: 8, weight: .bold))
          .foregroundStyle(.tertiary)
      }
    }
    if !capability.limitations.isEmpty {
      Divider()
      Text("LIMITATIONS")
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(.tertiary)
      ForEach(capability.limitations, id: \.self) { limitation in
        Text("• \(limitation)")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
    }
    Divider()
    Text("NEXT")
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(.tertiary)
    Text(capability.nextStep)
      .font(.system(size: 11, weight: .medium))
  }
}

private struct EmptyWorkbenchView: View {
  let title: String
  let message: String
  let icon: String

  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 34, weight: .light))
        .foregroundStyle(.tertiary)
      Text(title).font(.system(size: 22, weight: .semibold))
      Text(message)
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .frame(maxWidth: 420)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private func panelHeading(_ title: String, caption: String) -> some View {
  VStack(alignment: .leading, spacing: 4) {
    Text(title).font(.system(size: 13, weight: .semibold))
    Text(caption).font(.system(size: 11)).foregroundStyle(.secondary)
  }
}

private func inspectorPair(_ label: String, _ value: String) -> some View {
  VStack(alignment: .leading, spacing: 3) {
    Text(label.uppercased())
      .font(.system(size: 9, weight: .bold))
      .foregroundStyle(.tertiary)
    Text(value.replacingOccurrences(of: "_", with: " "))
      .font(.system(size: 11, design: label == "Data boundary" ? .default : .monospaced))
      .textSelection(.enabled)
  }
}
