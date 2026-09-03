import SwiftUI

struct QaJourneyWorkspaceView: View {
  @Bindable var model: WorkbenchModel

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      HStack(spacing: 0) {
        workflowIndex
          .frame(width: 258)
        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        editor
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      actionBar
    }
    .background(EvidenceStyle.canvas)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("qa-journey-workspace")
  }

  private var header: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text("TESTING / JOURNEY SETUP")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.1)
          .foregroundStyle(EvidenceStyle.amberForeground)
        Text("Reuse the flow. Keep execution honest.")
          .font(.system(size: 20, weight: .semibold))
        Text("Rust owns saved targets, spec discovery, and post-fix comparison identity.")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer()
      if model.qaWorkspaceLoading {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
      }
      Button("Refresh") { model.loadQaWorkspace() }
        .buttonStyle(.bordered)
        .disabled(model.qaWorkspaceLoading)
      Button("Done") { model.showingQaWorkspace = false }
        .buttonStyle(.bordered)
    }
    .padding(.horizontal, 22)
    .frame(height: 84)
    .background(EvidenceStyle.chrome)
  }

  private var workflowIndex: some View {
    VStack(spacing: 0) {
      HStack {
        PremiumFieldLabel("SAVED WORKFLOWS")
        Spacer()
        Button {
          model.newQaWorkflow()
        } label: {
          Image(systemName: "plus")
        }
        .buttonStyle(.borderless)
        .help("New workflow")
      }
      .padding(.horizontal, 14)
      .frame(height: 44)

      ScrollView {
        LazyVStack(spacing: 6) {
          ForEach(model.qaWorkspaceReceipt?.workflows ?? []) { workflow in
            Button {
              model.selectQaWorkflow(workflow.id)
            } label: {
              VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                  Image(
                    systemName: workflow.editable
                      ? "point.3.filled.connected.trianglepath.dotted" : "lock.fill"
                  )
                  .font(.system(size: 9, weight: .semibold))
                  .foregroundStyle(
                    workflow.id == model.qaSelectedWorkflowID
                      ? EvidenceStyle.amberForeground : Color.secondary)
                  Text(workflow.name)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                  Spacer()
                }
                Text("\(workflow.runnerType) · \(workflow.targets.count) targets")
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(.secondary)
                  .lineLimit(1)
              }
              .padding(11)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(
                workflow.id == model.qaSelectedWorkflowID
                  ? EvidenceStyle.amber.opacity(0.09) : EvidenceStyle.surface,
                in: RoundedRectangle(cornerRadius: 10)
              )
              .overlay {
                RoundedRectangle(cornerRadius: 10)
                  .stroke(
                    workflow.id == model.qaSelectedWorkflowID
                      ? EvidenceStyle.amber.opacity(0.45) : EvidenceStyle.separator)
              }
            }
            .buttonStyle(.plain)
          }
        }
        .padding(10)
      }

      VStack(alignment: .leading, spacing: 5) {
        Label("Secret-safe projection", systemImage: "key.slash")
          .font(.system(size: 9, weight: .semibold))
        Text("Storage-state paths and arbitrary commands never enter this native receipt.")
          .font(.system(size: 8))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(12)
      .background(EvidenceStyle.surface)
    }
    .background(EvidenceStyle.chrome)
  }

  private var editor: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        if let postFix = model.qaWorkspaceReceipt?.postFix {
          postFixBanner(postFix)
        }

        if let issue = model.qaWorkspaceIssue {
          Label(issue, systemImage: "exclamationmark.triangle.fill")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(EvidenceStyle.failure)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EvidenceStyle.failure.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }

        HStack(alignment: .top, spacing: 18) {
          VStack(alignment: .leading, spacing: 14) {
            PremiumInput(
              label: "WORKFLOW NAME", icon: "bookmark",
              placeholder: "Checkout confidence", text: workflowBinding(\.name)
            )
            PremiumInput(
              label: "PREVIEW", icon: "safari", placeholder: "http://localhost:1420",
              text: workflowBinding(\.baseURL)
            )
            PremiumInput(
              label: "LOOP ID", icon: "arrow.triangle.2.circlepath",
              placeholder: "checkout", text: workflowBinding(\.loopID)
            )
            VStack(alignment: .leading, spacing: 7) {
              PremiumFieldLabel("RUNNER")
              Picker("Runner", selection: workflowBinding(\.runnerType)) {
                Text("Built-in browser").tag("playwright_builtin")
                Text("Repository Playwright").tag("repo_playwright")
              }
              .pickerStyle(.segmented)
              .labelsHidden()
              .tint(.secondary)
            }
          }
          VStack(alignment: .leading, spacing: 14) {
            PremiumInput(
              label: "PRIMARY ROUTE", icon: "point.topleft.down.curvedto.point.bottomright.up",
              placeholder: "/checkout", text: workflowBinding(\.targetRoute)
            )
            PremiumInput(
              label: "JOURNEY GOAL", icon: "scope", placeholder: "Complete checkout",
              text: workflowBinding(\.goal)
            )
            VStack(alignment: .leading, spacing: 7) {
              PremiumFieldLabel("REPOSITORY SPEC")
              Menu {
                Button("No repository spec") { model.chooseQaSpec("") }
                ForEach(model.qaWorkspaceReceipt?.specs ?? []) { spec in
                  Button(spec.path) { model.chooseQaSpec(spec.path) }
                }
              } label: {
                HStack {
                  Image(systemName: "doc.text.magnifyingglass")
                    .foregroundStyle(EvidenceStyle.amberForeground)
                  Text(
                    model.qaWorkflowDraft.repoSpecPath.isEmpty
                      ? "Choose discovered spec…" : model.qaWorkflowDraft.repoSpecPath
                  )
                  .font(.system(size: 10, design: .monospaced))
                  .lineLimit(1)
                  .truncationMode(.middle)
                  Spacer()
                  Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .frame(height: 42)
                .premiumField()
              }
              .menuStyle(.borderlessButton)
            }
            Toggle(
              "Permit an explicitly confirmed remote preview",
              isOn: workflowBinding(\.allowRemoteTarget)
            )
            .toggleStyle(.checkbox)
            .tint(EvidenceStyle.amber)
            .font(.system(size: 10, weight: .medium))
          }
        }

        targetDesk

        if let limitation = model.selectedQaWorkflow?.limitation {
          Label(limitation, systemImage: "lock.fill")
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
        }
      }
      .padding(24)
      .frame(maxWidth: 820, alignment: .leading)
    }
  }

  private var targetDesk: some View {
    VStack(alignment: .leading, spacing: 11) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("SAVED TARGETS")
          Text("A selected target becomes an explicit route and goal in the T-REX receipt.")
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
        }
        Spacer()
        Menu("Select target") {
          ForEach(model.selectedQaWorkflow?.targets ?? []) { target in
            Button(target.name) { model.selectQaTarget(target.id) }
          }
        }
        .disabled(model.selectedQaWorkflow == nil)
      }

      HStack(spacing: 10) {
        CompactQaField(placeholder: "Target name", text: $model.qaTargetName)
        CompactQaField(placeholder: "/route", text: $model.qaTargetRoute)
        CompactQaField(placeholder: "User goal", text: $model.qaTargetGoal)
        Button("Save target") { model.saveQaTarget() }
          .buttonStyle(.bordered)
          .disabled(
            model.qaSelectedWorkflowID == nil || model.qaWorkspaceLoading
              || model.selectedQaWorkflow?.editable == false)
        Button {
          model.deleteQaTarget()
        } label: {
          Image(systemName: "trash")
        }
        .buttonStyle(.bordered)
        .disabled(
          model.qaSelectedTargetID == nil || model.qaWorkspaceLoading
            || model.selectedQaWorkflow?.editable == false
        )
        .accessibilityLabel("Delete selected target")
      }
    }
    .padding(14)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func postFixBanner(_ preparation: QaPostFixPreparation) -> some View {
    HStack(spacing: 12) {
      Image(
        systemName: preparation.status == "needs_rerun"
          ? "arrow.clockwise.circle.fill" : "checkmark.seal.fill"
      )
      .foregroundStyle(
        preparation.status == "needs_rerun"
          ? EvidenceStyle.amberForeground : EvidenceStyle.success)
      VStack(alignment: .leading, spacing: 3) {
        Text(preparation.status == "needs_rerun" ? "POST-FIX RERUN READY" : "POST-FIX COMPARISON")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(0.8)
        Text(preparation.summary)
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer()
      if preparation.status == "needs_rerun" {
        Button("Use prior flow") {
          model.applyPostFixQaPreparation(preparation)
        }
        .buttonStyle(.bordered)
      }
    }
    .padding(14)
    .background(EvidenceStyle.amber.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.amber.opacity(0.25)) }
  }

  private var actionBar: some View {
    HStack(spacing: 10) {
      Text("\(model.qaWorkspaceReceipt?.specs.count ?? 0) specs discovered")
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(.secondary)
      Spacer()
      Button("Delete workflow", role: .destructive) { model.deleteQaWorkflow() }
        .buttonStyle(.bordered)
        .disabled(
          model.qaSelectedWorkflowID == nil || model.qaWorkspaceLoading
            || model.selectedQaWorkflow?.editable == false)
      Button("Save workflow") { model.saveQaWorkflow() }
        .buttonStyle(.bordered)
        .disabled(model.qaWorkspaceLoading || model.selectedQaWorkflow?.editable == false)
      Button("Apply to Testing") {
        model.applyQaWorkflowToTesting()
        model.showingQaWorkspace = false
      }
      .buttonStyle(PremiumPrimaryButtonStyle())
      .disabled(model.selectedQaWorkflow == nil)
    }
    .padding(.horizontal, 20)
    .frame(height: 66)
    .background(EvidenceStyle.chrome)
  }

  private func workflowBinding<Value>(_ keyPath: WritableKeyPath<QaWorkflowDraft, Value>)
    -> Binding<Value>
  {
    Binding(
      get: { model.qaWorkflowDraft[keyPath: keyPath] },
      set: { model.qaWorkflowDraft[keyPath: keyPath] = $0 }
    )
  }
}

private struct CompactQaField: View {
  let placeholder: String
  @Binding var text: String

  var body: some View {
    TextField(placeholder, text: $text)
      .textFieldStyle(.plain)
      .font(.system(size: 10))
      .padding(.horizontal, 10)
      .frame(height: 36)
      .premiumField()
  }
}
