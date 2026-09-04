import SwiftUI

struct PremiumOnboardingView: View {
  @Bindable var model: WorkbenchModel

  private let steps = ["Purpose", "Readiness", "Agent", "Workbench"]

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      footer
    }
    .frame(width: 760, height: 600)
    .background(EvidenceStyle.canvas)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("native-onboarding")
  }

  private var header: some View {
    HStack(spacing: 18) {
      HStack(spacing: 10) {
        CodeVetterBrandMark(size: 36)
        VStack(alignment: .leading, spacing: 2) {
          Text("CODEVETTER")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1.1)
            .foregroundStyle(EvidenceStyle.amberForeground)
          Text("Evidence Workbench").font(.system(size: 13, weight: .semibold))
        }
      }
      Spacer()
      HStack(spacing: 5) {
        ForEach(Array(steps.enumerated()), id: \.offset) { index, label in
          VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased())
              .font(.system(size: 7, weight: .bold, design: .monospaced))
              .foregroundStyle(index == model.onboardingStep ? Color.primary : Color.secondary)
            Capsule()
              .fill(index <= model.onboardingStep ? EvidenceStyle.amber : EvidenceStyle.separator)
              .frame(width: 64, height: 2)
          }
        }
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(
        "Step \(model.onboardingStep + 1) of \(steps.count), \(steps[model.onboardingStep])")
    }
    .padding(.horizontal, 24)
    .frame(height: 76)
    .background(EvidenceStyle.chrome)
  }

  @ViewBuilder
  private var content: some View {
    switch model.onboardingStep {
    case 0: purposeStep
    case 1: readinessStep
    case 2: agentStep
    default: workbenchStep
    }
  }

  private var purposeStep: some View {
    HStack(spacing: 38) {
      VStack(alignment: .leading, spacing: 18) {
        PremiumFieldLabel("THE STANDARD")
        Text("Judge code by\nwhat it proves.")
          .font(.system(size: 36, weight: .semibold))
          .tracking(-0.8)
        Text(
          "CodeVetter binds an exact change to executable checks, runtime evidence, and a measurable verdict. Model opinions remain leads—not proof."
        )
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        HStack(spacing: 7) {
          StatusPill(label: "Local first", color: EvidenceStyle.success)
          StatusPill(label: "Rust authority", color: EvidenceStyle.amber)
          StatusPill(label: "Fail closed", color: EvidenceStyle.warning)
        }
      }
      .frame(maxWidth: 410, alignment: .leading)
      ZStack {
        RoundedRectangle(cornerRadius: 24)
          .fill(EvidenceStyle.surface)
          .overlay { RoundedRectangle(cornerRadius: 24).stroke(EvidenceStyle.separator) }
        VStack(spacing: 15) {
          proofNode("TASK", "Exact intent", "scope")
          Image(systemName: "arrow.down").foregroundStyle(EvidenceStyle.amberForeground)
          proofNode("EXECUTE", "Repository checks", "terminal")
          Image(systemName: "arrow.down").foregroundStyle(EvidenceStyle.amberForeground)
          proofNode("VERDICT", "Evidence bounded", "checkmark.seal")
        }
      }
      .frame(width: 225, height: 340)
    }
    .padding(38)
  }

  private var readinessStep: some View {
    VStack(alignment: .leading, spacing: 18) {
      PremiumFieldLabel("LOCAL TOOL READINESS")
      Text("Know what is available. Assume nothing.")
        .font(.system(size: 27, weight: .semibold))
      Text(
        "The Rust receipt checks executable presence only. Authentication and credential contents are deliberately not inspected."
      )
      .font(.system(size: 11))
      .foregroundStyle(.secondary)
      VStack(spacing: 0) {
        ForEach(Array((model.onboardingReceipt?.tools ?? []).enumerated()), id: \.element.id) {
          index, tool in
          HStack(spacing: 14) {
            Image(systemName: tool.available ? "checkmark.circle.fill" : "minus.circle")
              .font(.system(size: 16))
              .foregroundStyle(tool.available ? EvidenceStyle.success : Color.secondary)
              .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
              Text(tool.label).font(.system(size: 12, weight: .semibold))
              Text(tool.role).font(.system(size: 9)).foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(
              label: tool.available ? "Available" : "Not found",
              color: tool.available ? EvidenceStyle.success : Color.secondary)
          }
          .padding(.horizontal, 18)
          .frame(height: 70)
          .accessibilityElement(children: .combine)
          if index < (model.onboardingReceipt?.tools.count ?? 0) - 1 {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
          }
        }
      }
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
      .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
      Label(
        "Missing tools do not become green checks. You can finish setup and install them later.",
        systemImage: "lock.shield"
      )
      .font(.system(size: 9))
      .foregroundStyle(.secondary)
    }
    .padding(38)
  }

  private var agentStep: some View {
    VStack(alignment: .leading, spacing: 20) {
      PremiumFieldLabel("DEFAULT REVIEW AGENT")
      Text("Choose the worker. Keep proof independent.")
        .font(.system(size: 27, weight: .semibold))
      Text(
        "This selects the default local agent adapter. It does not grant repository, network, or credential authority."
      )
      .font(.system(size: 11))
      .foregroundStyle(.secondary)
      HStack(spacing: 14) {
        agentChoice(
          id: "codex", title: "Codex", subtitle: "Use the local Codex CLI",
          symbol: "chevron.left.forwardslash.chevron.right")
        agentChoice(
          id: "claude-code", title: "Claude Code", subtitle: "Use the local Claude CLI",
          symbol: "sparkles")
      }
      HStack(spacing: 10) {
        Image(systemName: "equal.circle.fill").foregroundStyle(EvidenceStyle.amberForeground)
        Text("Both adapters produce leads. Rust-owned execution evidence determines confidence.")
          .font(.system(size: 10, weight: .medium))
      }
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(EvidenceStyle.amber.opacity(0.07), in: RoundedRectangle(cornerRadius: 11))
      .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.amber.opacity(0.22)) }
      Spacer()
    }
    .padding(38)
  }

  private var workbenchStep: some View {
    VStack(alignment: .leading, spacing: 18) {
      PremiumFieldLabel("ONE PRODUCT · THREE INTERFACES")
      Text("Start with the change. End with proof.")
        .font(.system(size: 27, weight: .semibold))
      HStack(spacing: 12) {
        tourCard(
          "APP", "Operate", "Review, Testing, Performance, and evidence inspection", "macwindow")
        tourCard(
          "CLI", "Automate", "The same versioned commands and canonical receipts", "terminal")
        tourCard(
          "AGENTS", "Integrate", "Scoped MCP reads and explicit execution boundaries",
          "point.3.connected.trianglepath.dotted")
      }
      VStack(spacing: 0) {
        workbenchRow("1", "Select an exact repository and change")
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        workbenchRow("2", "Plan correctness, runtime, and performance evidence")
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        workbenchRow("3", "Execute deliberately and inspect every limitation")
      }
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
      .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
    }
    .padding(38)
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if let issue = model.onboardingIssue {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 9))
          .foregroundStyle(EvidenceStyle.warning)
          .lineLimit(2)
      } else {
        Text("No credential values enter the onboarding receipt.")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      Spacer()
      if model.onboardingStep == 0 {
        Button("Not now") { model.dismissOnboarding() }
          .buttonStyle(.bordered)
          .disabled(model.onboardingLoading)
      } else {
        Button("Back") { model.onboardingStep -= 1 }
          .buttonStyle(.bordered)
          .keyboardShortcut(.leftArrow, modifiers: [.command])
          .disabled(model.onboardingLoading)
      }
      Button(model.onboardingStep == steps.count - 1 ? "Enter Workbench" : "Continue") {
        if model.onboardingStep == steps.count - 1 {
          model.completeNativeOnboarding()
        } else {
          model.onboardingStep += 1
        }
      }
      .buttonStyle(PremiumPrimaryButtonStyle())
      .keyboardShortcut(.return, modifiers: [])
      .disabled(model.onboardingLoading)
      .accessibilityIdentifier(
        model.onboardingStep == steps.count - 1 ? "onboarding-finish" : "onboarding-continue")
      if model.onboardingLoading {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
      }
    }
    .padding(.horizontal, 24)
    .frame(height: 70)
    .background(EvidenceStyle.chrome)
  }

  private func proofNode(_ eyebrow: String, _ title: String, _ symbol: String) -> some View {
    HStack(spacing: 12) {
      Image(systemName: symbol).foregroundStyle(EvidenceStyle.amberForeground).frame(width: 24)
      VStack(alignment: .leading, spacing: 2) {
        Text(eyebrow).font(.system(size: 7, weight: .bold, design: .monospaced)).foregroundStyle(
          .secondary)
        Text(title).font(.system(size: 11, weight: .semibold))
      }
      Spacer()
    }
    .padding(14)
    .frame(width: 176)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 11))
    .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
  }

  private func agentChoice(id: String, title: String, subtitle: String, symbol: String) -> some View
  {
    let selected = model.onboardingDefaultAdapter == id
    return Button {
      model.onboardingDefaultAdapter = id
    } label: {
      VStack(alignment: .leading, spacing: 15) {
        HStack {
          Image(systemName: symbol)
            .font(.system(size: 18))
            .foregroundStyle(EvidenceStyle.amberForeground)
          Spacer()
          Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(selected ? EvidenceStyle.amberForeground : Color.secondary)
        }
        Text(title).font(.system(size: 15, weight: .semibold))
        Text(subtitle).font(.system(size: 9)).foregroundStyle(.secondary)
        StatusPill(
          label: toolAvailable(for: id) ? "CLI available" : "CLI not found",
          color: toolAvailable(for: id) ? EvidenceStyle.success : Color.secondary)
      }
      .padding(18)
      .frame(maxWidth: .infinity, minHeight: 170, alignment: .topLeading)
      .background(
        selected ? EvidenceStyle.amber.opacity(0.09) : EvidenceStyle.surface,
        in: RoundedRectangle(cornerRadius: 14)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 14).stroke(
          selected ? EvidenceStyle.amber.opacity(0.55) : EvidenceStyle.separator)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(title), \(selected ? "selected" : "not selected")")
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private func toolAvailable(for adapter: String) -> Bool {
    let id = adapter == "codex" ? "codex" : "claude"
    return model.onboardingReceipt?.tools.first { $0.id == id }?.available ?? false
  }

  private func tourCard(_ eyebrow: String, _ title: String, _ detail: String, _ symbol: String)
    -> some View
  {
    VStack(alignment: .leading, spacing: 10) {
      Image(systemName: symbol)
        .font(.system(size: 18))
        .foregroundStyle(EvidenceStyle.amberForeground)
      Text(eyebrow).font(.system(size: 7, weight: .bold, design: .monospaced)).foregroundStyle(
        .secondary)
      Text(title).font(.system(size: 14, weight: .semibold))
      Text(detail).font(.system(size: 9)).foregroundStyle(.secondary).fixedSize(
        horizontal: false, vertical: true)
    }
    .padding(16)
    .frame(maxWidth: .infinity, minHeight: 145, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 13))
    .overlay { RoundedRectangle(cornerRadius: 13).stroke(EvidenceStyle.separator) }
  }

  private func workbenchRow(_ number: String, _ label: String) -> some View {
    HStack(spacing: 13) {
      Text(number)
        .font(.system(size: 9, weight: .bold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.ink)
        .frame(width: 23, height: 23)
        .background(EvidenceStyle.amber, in: Circle())
      Text(label).font(.system(size: 10, weight: .medium))
      Spacer()
    }
    .padding(.horizontal, 15)
    .frame(height: 43)
  }
}
