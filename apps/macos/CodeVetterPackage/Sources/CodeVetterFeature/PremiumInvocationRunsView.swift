import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct RunsWorkspaceView: View {
  @Bindable var model: WorkbenchModel

  var body: some View {
    VStack(spacing: 0) {
      Picker("Run history", selection: $model.runsShowsInvocations) {
        Text("Skill invocations").tag(true)
        Text("Verification results").tag(false)
      }
      .pickerStyle(.segmented)
      .frame(width: 340)
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      if model.runsShowsInvocations {
        PremiumInvocationRunsView(
          ledger: model.invocationRuns, repositoryPath: model.repositoryPath)
      } else {
        PremiumRunsView(model: model)
      }
    }
  }
}

struct PremiumInvocationRunsView: View {
  @Bindable var ledger: InvocationRunsModel
  var repositoryPath: String
  private var currentRepositoryOnly: Bool { ledger.query.repositoryPath != nil }
  @State private var exportIssue: String?
  @FocusState private var ledgerFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      PremiumPageHeader(
        eyebrow: "Invocation ledger", title: "Runs",
        subtitle: "Execution history, receipt integrity, and agent observations"
      ) {
        Button(ledger.query.ledgerPath.isEmpty ? "Choose ledger…" : "Change ledger…") {
          chooseLedger()
        }
        .buttonStyle(.bordered)
        Button("refresh", systemImage: "arrow.clockwise") { ledger.load() }
          .disabled(ledger.loading || ledger.query.ledgerPath.isEmpty)
      }
      if !ledger.query.ledgerPath.isEmpty {
        Text(ledger.query.ledgerPath).font(.system(size: 11, design: .monospaced))
          .lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
          .help("Explicit local recorder directory. No transcripts are discovered.")
        filters
      }
      Divider()
      if ledger.query.ledgerPath.isEmpty {
        ContentUnavailableView(
          "Choose a recorded invocation ledger", systemImage: "tray.full",
          description: Text(
            "Select the directory retained by a CodeVetter skill recorder. Legacy conversations are not backfilled."
          )
        ).frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let issue = ledger.issue {
        ContentUnavailableView(
          "Ledger unavailable", systemImage: "exclamationmark.triangle",
          description: Text(issue)
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if ledger.loading {
        ProgressView("Reading invocation history…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let receipt = ledger.receipt {
        HStack(spacing: 0) {
          history(receipt)
            .frame(width: 330).frame(maxHeight: .infinity, alignment: .top)
            .background(EvidenceStyle.chrome)
          Divider()
          if let event = ledger.selectedInvocation {
            InvocationReceiptInspector(event: event, receipt: receipt, ledger: ledger)
              .id(event.id)
              .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          } else {
            ContentUnavailableView(
              "No matching invocations", systemImage: "line.3.horizontal.decrease.circle",
              description: Text("Change the filters to inspect another invocation.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
        footer(receipt)
      }
      if let exportIssue { Text(exportIssue).foregroundStyle(EvidenceStyle.warning).padding(12) }
    }
    .background(EvidenceStyle.canvas)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("skill-invocation-ledger")
    .onChange(of: repositoryPath) {
      if currentRepositoryOnly {
        ledger.query.repositoryPath = repositoryPath
        ledger.load()
      }
    }
  }

  private var filters: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        Toggle(
          "Current repository",
          isOn: Binding(
            get: { currentRepositoryOnly },
            set: { enabled in
              ledger.query.repositoryPath = enabled ? repositoryPath : nil
              ledger.load()
            })
        )
        .disabled(repositoryPath.isEmpty)
        filter(
          "Skill", value: $ledger.query.skill,
          options: [
            "codevetter-review", "codevetter-testing", "codevetter-performance",
            "codevetter-evaluate",
          ])
        filter(
          "State", value: $ledger.query.state,
          options: [
            "running", "completed", "failed", "unavailable", "interrupted", "timed_out",
            "output_limit",
          ])
        filter(
          "Observation", value: $ledger.query.assessment,
          options: [
            "helped", "did_not_help", "inconclusive", "blocked", "unassessed", "unavailable",
          ])
      }
      HStack {
        TextField("Task UUID (optional)", text: $ledger.query.taskID)
          .textFieldStyle(.roundedBorder).font(.system(size: 11, design: .monospaced))
          .onSubmit { ledger.load() }
          .accessibilityLabel("Filter by task UUID")
        Button("apply task") { ledger.load() }.disabled(ledger.loading)
      }
    }
    .font(.system(size: 11))
    .padding(.horizontal, 20).padding(.vertical, 10)
  }

  private func filter(_ title: String, value: Binding<String>, options: [String]) -> some View {
    Picker(title, selection: value) {
      Text("All").tag("")
      ForEach(options, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) }
    }
    .onChange(of: value.wrappedValue) { ledger.load() }
  }

  private func history(_ receipt: InvocationLedgerReceipt) -> some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(receipt.invocations) { event in
            Button {
              ledger.selectedID = event.id
            } label: {
              VStack(alignment: .leading, spacing: 7) {
                HStack {
                  Text(event.skill.replacingOccurrences(of: "codevetter-", with: "").capitalized)
                    .font(.system(size: 12, weight: .semibold))
                  Spacer()
                  Text(event.state.replacingOccurrences(of: "_", with: " "))
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Text(event.command + (event.operation.map { " " + $0 } ?? ""))
                  .font(.system(size: 11, design: .monospaced)).lineLimit(1)
                Text(event.repoPath).font(.system(size: 10)).foregroundStyle(.secondary)
                  .lineLimit(1).truncationMode(.middle)
                HStack {
                  Text(event.startedAt).lineLimit(1)
                  Spacer()
                  Text(event.assessment.replacingOccurrences(of: "_", with: " "))
                }.font(.system(size: 9)).foregroundStyle(.secondary)
              }
              .padding(14).frame(maxWidth: .infinity, alignment: .leading)
              .background(ledger.selectedID == event.id ? EvidenceStyle.inspector : Color.clear)
              .overlay(alignment: .leading) {
                if ledger.selectedID == event.id {
                  Rectangle().fill(EvidenceStyle.amber).frame(width: 2)
                }
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(event.skill), \(event.command), \(event.state)")
            .accessibilityValue(ledger.selectedID == event.id ? "Selected" : "")
            .accessibilityAddTraits(ledger.selectedID == event.id ? .isSelected : [])
            .id(event.id)
            Divider()
          }
        }
      }
      .focusable().focusEffectDisabled().focused($ledgerFocused)
      .overlay {
        Rectangle().stroke(ledgerFocused ? EvidenceStyle.amber.opacity(0.5) : Color.clear)
      }
      .onMoveCommand { direction in
        if direction == .up {
          ledger.moveSelection(by: -1)
        } else if direction == .down {
          ledger.moveSelection(by: 1)
        }
        if let id = ledger.selectedID { proxy.scrollTo(id, anchor: .center) }
      }
    }
  }

  private func footer(_ receipt: InvocationLedgerReceipt) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Divider()
      HStack {
        Text(
          receipt.total == 0
            ? "0 matching invocations"
            : "\(receipt.offset + 1)–\(receipt.offset + receipt.invocations.count) of \(receipt.total) invocations"
        )
        Spacer()
        Button("previous") { ledger.page(by: -1) }.disabled(
          receipt.offset == 0 || ledger.loading || ledger.hasUnappliedTask)
        Button("next") { ledger.page(by: 1) }
          .disabled(
            receipt.offset + receipt.invocations.count >= receipt.total || ledger.loading
              || ledger.hasUnappliedTask)
        Button("export page…") { exportPage() }.disabled(ledger.receiptData == nil)
      }
      Text(
        "\(receipt.unreadableRecords) unreadable records · \(receipt.unattributedRecords) unattributed · \(receipt.unreadableAssessments) unreadable observations"
      )
      .foregroundStyle(.secondary)
      if !receipt.ingestionIssues.isEmpty || !receipt.unattributedIngestionIssues.isEmpty {
        Text(
          "Ingestion issues: "
            + (receipt.ingestionIssues + receipt.unattributedIngestionIssues)
            .map(\.code).joined(separator: ", ")
        ).foregroundStyle(EvidenceStyle.warning)
          .lineLimit(2).help(
            "The ledger may be incomplete; issue counts are not successful invocations.")
      }
    }
    .font(.system(size: 10)).padding(12)
  }

  private func chooseLedger() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.message = "Choose an explicitly retained CodeVetter skill recorder directory."
    guard panel.runModal() == .OK, let url = panel.url else { return }
    ledger.query.ledgerPath = url.path
    ledger.load()
  }

  private func exportPage() {
    guard let data = ledger.receiptData else { return }
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = "codevetter-invocations.json"
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    do {
      try data.write(to: destination, options: .atomic)
      exportIssue = nil
    } catch { exportIssue = error.localizedDescription }
  }
}

private struct InvocationReceiptInspector: View {
  let event: InvocationEvent
  let receipt: InvocationLedgerReceipt
  @Bindable var ledger: InvocationRunsModel
  @State private var pointer = ""
  @State private var exportIssue: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 8) {
          Text(event.command + (event.operation.map { " " + $0 } ?? ""))
            .font(.system(size: 20, weight: .semibold, design: .monospaced))
          Text("Invocation · \(event.state)").font(.system(size: 12)).foregroundStyle(.secondary)
        }
        section("Evidence strength") {
          field(
            "Independent benefit",
            event.independentlyVerifiedBenefit.map { $0 ? "Verified" : "Not established" })
          field("Agent observation", event.assessment.replacingOccurrences(of: "_", with: " "))
          field(
            "Receipt integrity", event.receiptIntegrity.replacingOccurrences(of: "_", with: " "))
          Text(
            "A reported ‘helped’ observation and matching hash do not establish independent benefit."
          )
          .font(.system(size: 11)).foregroundStyle(.secondary)
        }
        section("Execution") {
          field("Invocation", event.id)
          field("Repository", event.repoPath)
          field("Task", event.taskID)
          field("Parent", event.parentInvocationID)
          field("Agent", event.agent)
          field("Provider", event.provider)
          field("Started", event.startedAt)
          field("Finished", event.finishedAt)
          field("Duration", event.durationMS.map { "\($0) ms" })
          field("Context capture", event.contextCaptureMS.map { "\($0) ms" })
          field("Process exit", event.exitCode.map(String.init))
          field("CLI exit", event.cliExitCode.map(String.init))
        }
        section("Receipt integrity") {
          field("Integrity", event.receiptIntegrity.replacingOccurrences(of: "_", with: " "))
          field("SHA-256", event.receiptSHA256)
          field("Recorded path", event.receiptPath)
          Text(
            "A matching hash identifies captured bytes. It does not establish correctness. Recorded paths are informational and are not followed by this viewer."
          )
          .font(.system(size: 11)).foregroundStyle(.secondary)
        }
        section("Captured receipt") {
          TextField("JSON pointer (optional, e.g. /limitations)", text: $pointer)
            .textFieldStyle(.roundedBorder).font(.system(size: 11, design: .monospaced))
            .accessibilityLabel("Captured receipt JSON pointer")
          HStack {
            Button(ledger.inspecting ? "Reading…" : "Read captured receipt") {
              ledger.inspectReceipt(pointer: pointer.isEmpty ? nil : pointer)
            }
            .disabled(ledger.inspecting || event.receiptIntegrity != "hash_matched")
            Button("export receipt view…") { exportInspection() }
              .disabled(ledger.inspectionData == nil)
          }
          if event.receiptIntegrity != "hash_matched" {
            Text("Captured content is unavailable unless its recorded hash matches.")
              .font(.system(size: 11)).foregroundStyle(.secondary)
          }
          if let issue = ledger.inspectionIssue ?? exportIssue {
            Text(issue).font(.system(size: 11)).foregroundStyle(EvidenceStyle.warning)
          }
          if let inspection = ledger.inspection {
            field("Displayed selection", inspection.jsonPointer ?? "Whole captured receipt")
            Text(inspection.valueText).font(.system(size: 11, design: .monospaced))
              .fixedSize(horizontal: false, vertical: true)
            if inspection.displayTruncated {
              Text(
                "Display limited to 16 KiB. Use a narrower pointer or export the full selected view."
              )
              .font(.system(size: 11)).foregroundStyle(EvidenceStyle.warning)
            }
            ForEach(inspection.limitations, id: \.self) {
              Text($0).font(.system(size: 11)).foregroundStyle(.secondary)
            }
          }
        }
        section("Agent observation") {
          field("Reported usefulness", event.assessment.replacingOccurrences(of: "_", with: " "))
          field("Provenance", event.usefulness?.provenance)
          field(
            "Measured cost", event.usefulness?.measuredCostUSD.map { String(format: "$%.4f", $0) })
          Text(
            "Agent-reported usefulness is separate from a matched, independently verified with/without comparison."
          )
          .font(.system(size: 11)).foregroundStyle(.secondary)
        }
        section("Scope and limitations") {
          field("Evidence origin", receipt.evidenceOrigin.replacingOccurrences(of: "_", with: " "))
          ForEach(receipt.limitations, id: \.self) {
            Text($0).font(.system(size: 11)).foregroundStyle(.secondary)
          }
        }
      }.padding(24).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
    }
    .background(EvidenceStyle.inspector)
    .accessibilityIdentifier("invocation-receipt-inspector")
  }

  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content)
    -> some View
  {
    VStack(alignment: .leading, spacing: 10) {
      Text(title.lowercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(
        .secondary)
      content()
    }
  }

  private func field(_ name: String, _ value: String?) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Text(name).font(.system(size: 11)).foregroundStyle(.secondary).frame(
        width: 110, alignment: .leading)
      Text(value ?? "Unknown").font(.system(size: 11, design: .monospaced))
        .frame(maxWidth: .infinity, alignment: .leading).fixedSize(
          horizontal: false, vertical: true)
    }
  }

  private func exportInspection() {
    guard let data = ledger.inspectionData else { return }
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = "codevetter-invocation-receipt.json"
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    do {
      try data.write(to: destination, options: .atomic)
      exportIssue = nil
    } catch { exportIssue = error.localizedDescription }
  }
}
