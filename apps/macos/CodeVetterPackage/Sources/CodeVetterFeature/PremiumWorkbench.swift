import AppKit
import SwiftUI
import UniformTypeIdentifiers

public struct PremiumWorkbenchRootView: View {
  @Bindable private var model: WorkbenchModel

  public init(model: WorkbenchModel) {
    self.model = model
  }

  public var body: some View {
    VStack(spacing: 0) {
      PremiumTopBar(model: model)
      switch model.section {
      case .usage:
        PremiumUsageView(model: model)
      case .repository:
        PremiumUnpackView(model: model)
      case .review:
        PremiumReviewView(model: model)
      case .testing:
        PremiumTestingView(model: model)
      case .performance:
        PremiumPerformanceView(model: model)
      case .runs:
        PremiumRunsView(model: model)
      case .settings:
        PremiumSettingsView(model: model)
      }
    }
    .background(EvidenceStyle.canvas)
    .sheet(isPresented: $model.commandPalettePresented) {
      PremiumCommandPaletteView(model: model)
    }
    .sheet(isPresented: $model.onboardingPresented) {
      PremiumOnboardingView(model: model)
        .interactiveDismissDisabled(model.onboardingLoading)
    }
    .task {
      model.loadOnboarding()
    }
    .task(id: model.section) {
      if model.section == .usage {
        if model.usageReport == nil {
          model.loadUsage()
        }
        if model.providerQuotaReceipt == nil {
          model.loadProviderQuota()
        }
      } else if model.section == .repository, model.unpackSnapshots.isEmpty {
        model.loadUnpackSnapshots()
      } else if model.section == .settings, model.settingsReceipt == nil {
        model.loadNativeSettings()
      } else if model.section == .runs {
        model.loadRuns()
      }
    }
  }
}

private struct PremiumRunsView: View {
  @Bindable var model: WorkbenchModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var exportIssue: String?
  @State private var showsAllRuns = false
  @FocusState private var ledgerFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      PremiumPageHeader(
        eyebrow: "Evidence ledger",
        title: "Runs",
        subtitle: "Rust-persisted verification receipts and their recorded limitations"
      ) {
        Menu {
          Button("All repositories") {
            model.setRunLedgerScope(.all)
          }
          Button("Current repository") {
            model.setRunLedgerScope(.currentRepository)
          }
          .disabled(!model.canFilterRunsByRepository)
        } label: {
          Label(model.runLedgerScopeLabel, systemImage: "line.3.horizontal.decrease.circle")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("Filter the evidence ledger")
        Button {
          model.loadRuns()
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .disabled(model.runsLoading)
        .help("Refresh runs")
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)

      HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 0) {
          if let issue = model.runsIssue {
            Label(issue, systemImage: "exclamationmark.triangle.fill")
              .font(.system(size: 10))
              .foregroundStyle(EvidenceStyle.warning)
              .padding(18)
          } else if model.runs.isEmpty, !model.runsLoading {
            ContentUnavailableView(
              "No verification runs",
              systemImage: "checkmark.shield",
              description: Text(
                "Local checks, previews, T-Rex PR checks, synthetic QA, warm, differential, and audience receipts will appear here."
              )
            )
          } else {
            ScrollViewReader { proxy in
              ScrollView {
                LazyVStack(spacing: 5) {
                  ForEach(Array(model.runs.prefix(showsAllRuns ? model.runs.count : 4))) { run in
                    Button {
                      model.selectedRunID = run.id
                    } label: {
                      RunLedgerRow(run: run, selected: model.selectedRunID == run.id)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(run.kindLabel) run: \(run.title)")
                    .accessibilityValue(model.selectedRunID == run.id ? "Selected" : "")
                    .accessibilityAddTraits(model.selectedRunID == run.id ? .isSelected : [])
                    .id(run.id)
                  }
                  if model.runs.count > 4 {
                    Button(showsAllRuns ? "Show recent runs" : "Show all \(model.runs.count) runs")
                    {
                      showsAllRuns.toggle()
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 9, weight: .semibold))
                    .padding(.vertical, 8)
                  }
                }
                .padding(10)
              }
              .focusable()
              .focusEffectDisabled()
              .focused($ledgerFocused)
              .overlay {
                Rectangle()
                  .stroke(ledgerFocused ? EvidenceStyle.amber.opacity(0.48) : Color.clear)
              }
              .onAppear { ledgerFocused = true }
              .onMoveCommand { direction in
                switch direction {
                case .up: model.moveRunSelection(by: -1)
                case .down: model.moveRunSelection(by: 1)
                default: return
                }
                if let selectedRunID = model.selectedRunID {
                  if reduceMotion {
                    proxy.scrollTo(selectedRunID, anchor: .center)
                  } else {
                    withAnimation(.easeOut(duration: 0.12)) {
                      proxy.scrollTo(selectedRunID, anchor: .center)
                    }
                  }
                }
              }
            }
          }
        }
        .frame(width: 330)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(EvidenceStyle.chrome)

        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)

        if let run = model.selectedRun {
          StoredRunInspector(run: run, position: model.selectedRunPosition) {
            export(run)
          }
          .id(run.id)
        } else {
          ContentUnavailableView(
            "Select a receipt",
            systemImage: "doc.text.magnifyingglass",
            description: Text("The canonical Rust receipt remains the source of truth.")
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("runs-ledger")
    .overlay(alignment: .bottomTrailing) {
      if let exportIssue {
        Label(exportIssue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 10))
          .foregroundStyle(EvidenceStyle.warning)
          .padding(12)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
          .padding(16)
      }
    }
  }

  private func export(_ run: StoredVerificationRun) {
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.canCreateDirectories = true
    panel.isExtensionHidden = false
    panel.nameFieldStringValue = "\(run.kind)-\(run.id).json"
    panel.message = "Export the canonical Rust-owned receipt without reinterpretation."
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    do {
      try run.exportCanonicalReceipt(to: destination)
      exportIssue = nil
    } catch {
      exportIssue = "Export failed: \(error.localizedDescription)"
    }
  }
}

private struct RunLedgerRow: View {
  let run: StoredVerificationRun
  let selected: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack {
        StatusPill(label: verdict, color: verdictColor)
        Spacer()
        Text(run.sourceLabel ?? run.kindLabel.uppercased())
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      Text(run.title)
        .font(.system(size: 12, weight: .semibold))
        .lineLimit(2)
      HStack {
        Text(run.repositoryName)
        Spacer()
        Text(run.recordedAt)
      }
      .font(.system(size: 8, design: .monospaced))
      .foregroundStyle(.secondary)
      .lineLimit(1)
    }
    .padding(13)
    .background(
      selected ? Color.primary.opacity(0.08) : Color.clear,
      in: RoundedRectangle(cornerRadius: 11)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 11)
        .stroke(selected ? EvidenceStyle.amber.opacity(0.42) : Color.clear)
    }
  }

  private var verdict: String {
    run.outcome.replacingOccurrences(of: "_", with: " ")
  }

  private var verdictColor: Color {
    switch run.outcome.lowercased() {
    case "block", "blocked", "failed", "needs_attention", "regressed": EvidenceStyle.failure
    case "needs_review", "no_confidence", "incomparable", "collecting", "waived":
      EvidenceStyle.warning
    default: EvidenceStyle.success
    }
  }
}

private enum StoredRunDetailMode: String, CaseIterable, Identifiable {
  case evidence = "Evidence"
  case receipt = "JSON"

  var id: String { rawValue }
}

private struct StoredRunInspector: View {
  let run: StoredVerificationRun
  let position: String?
  let export: () -> Void
  @State private var detailMode: StoredRunDetailMode
  @State private var showsProofIdentity = false

  init(run: StoredVerificationRun, position: String?, export: @escaping () -> Void) {
    self.run = run
    self.position = position
    self.export = export
    _detailMode = State(initialValue: run.indexedEvidenceCount > 0 ? .evidence : .receipt)
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 5) {
          Text("CANONICAL VERIFICATION RECEIPT")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1)
            .foregroundStyle(EvidenceStyle.amberForeground)
          Text(run.title).font(.system(size: 20, weight: .semibold)).lineLimit(1)
          Text(run.id)
            .font(.system(size: 9, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        Spacer()
        if let position {
          Text(position)
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .foregroundStyle(.secondary)
            .accessibilityLabel("Run \(position)")
        }
        Button(
          showsProofIdentity ? "Hide details" : "Details",
          systemImage: "sidebar.trailing"
        ) {
          showsProofIdentity.toggle()
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        Button("Export JSON", systemImage: "square.and.arrow.up", action: export)
          .buttonStyle(.bordered)
          .controlSize(.small)
          .keyboardShortcut("e", modifiers: [.command, .shift])
        StatusPill(
          label: run.outcome.replacingOccurrences(of: "_", with: " "),
          color: outcomeColor
        )
      }
      .padding(.horizontal, 22)
      .frame(height: 84)
      .background(EvidenceStyle.chrome)
      .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }

      HStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 0) {
          HStack {
            PremiumFieldLabel(detailMode == .evidence ? "EVIDENCE INDEX" : "CANONICAL JSON")
            Spacer()
            if detailMode == .evidence {
              Text(String(run.indexedEvidenceCount))
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.secondary)
            } else {
              Text(run.receiptSchema)
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Picker("Receipt detail", selection: $detailMode) {
              ForEach(StoredRunDetailMode.allCases) { mode in
                Text(mode.rawValue).tag(mode)
              }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .tint(.secondary)
            .frame(width: 142)
          }
          .padding(.horizontal, 16)
          .frame(height: 44)
          .background(EvidenceStyle.surface)
          if detailMode == .evidence {
            RunEvidenceIndex(run: run)
          } else {
            ScrollView([.horizontal, .vertical]) {
              Text(run.rawJSON)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(18)
            }
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)

        if showsProofIdentity {
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)

          VStack(alignment: .leading, spacing: 18) {
            PremiumFieldLabel("PROOF IDENTITY")
            runPair("REPOSITORY", run.repositoryName)
            runPair("FAMILY", run.kindLabel)
            if let source = run.sourceLabel {
              runPair("SOURCE", source)
            }
            if let receipt = run.localCheckReceipt {
              runPair("BASE", String(receipt.source.baseSha.prefix(12)))
              runPair("HEAD", String(receipt.source.headSha.prefix(12)))
            }
            if !run.audienceResponses.isEmpty {
              runPair("RESPONSES", String(run.audienceResponses.count))
            }
            if !run.artifacts.isEmpty {
              runPair("ARTIFACTS", String(run.artifacts.count))
            }
            runPair("RECORDED", run.recordedAt)
            Divider()
            PremiumFieldLabel("LIMITATIONS")
            if run.limitations.isEmpty {
              Label("No limitations recorded", systemImage: "checkmark.circle")
                .font(.system(size: 10))
                .foregroundStyle(EvidenceStyle.success)
            } else {
              ForEach(run.limitations, id: \.self) { limitation in
                Label(limitation, systemImage: "exclamationmark.triangle")
                  .font(.system(size: 10))
                  .foregroundStyle(.secondary)
              }
            }
            Spacer()
            Label("Rust-persisted", systemImage: "checkmark.seal.fill")
              .font(.system(size: 10, weight: .semibold))
              .foregroundStyle(EvidenceStyle.success)
          }
          .padding(22)
          .frame(width: 270)
          .background(EvidenceStyle.inspector)
        }
      }
    }
  }

  private func runPair(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 10, weight: .medium, design: .monospaced)).lineLimit(1)
    }
  }

  private var outcomeColor: Color {
    switch run.outcome.lowercased() {
    case "block", "blocked", "failed", "needs_attention", "regressed": EvidenceStyle.failure
    case "needs_review", "no_confidence", "incomparable", "collecting", "waived":
      EvidenceStyle.warning
    default: EvidenceStyle.success
    }
  }
}

private struct RunEvidenceIndex: View {
  let run: StoredVerificationRun
  @State private var showsAllEvidence = false

  private var isEmpty: Bool {
    run.indexedEvidenceCount == 0
  }

  var body: some View {
    if isEmpty {
      ContentUnavailableView(
        "Receipt only",
        systemImage: "doc.text",
        description: Text("This family has no separately indexed evidence."))
    } else {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 5) {
          ForEach(
            Array(run.changedPaths.prefix(showsAllEvidence ? run.changedPaths.count : 3)),
            id: \.self
          ) { path in
            Label(path, systemImage: "doc.text")
              .font(.system(size: 10, design: .monospaced))
              .foregroundStyle(.secondary)
              .lineLimit(1)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 14)
              .frame(height: 30)
          }

          ForEach(
            Array(
              run.audienceResponses.prefix(
                showsAllEvidence ? run.audienceResponses.count : 3))
          ) { response in
            VStack(alignment: .leading, spacing: 6) {
              HStack {
                Text(response.participantID)
                  .font(.system(size: 10, weight: .semibold, design: .monospaced))
                Spacer()
                Text(response.provenance.uppercased())
                  .font(.system(size: 8, weight: .bold, design: .monospaced))
                  .foregroundStyle(EvidenceStyle.amberForeground)
              }
              Text(response.criterion)
                .font(.system(size: 10, weight: .medium))
              HStack {
                Text(response.preferredCandidate.map { "Preferred \($0)" } ?? "No preference")
                Spacer()
                Text(response.confidence, format: .percent.precision(.fractionLength(0)))
              }
              .font(.system(size: 9, design: .monospaced))
              .foregroundStyle(.secondary)
              if let feedback = response.feedback, !feedback.isEmpty {
                Text(feedback)
                  .font(.system(size: 9))
                  .foregroundStyle(.secondary)
                  .lineLimit(3)
              }
            }
            .padding(12)
            .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
            .overlay {
              RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
              "Audience response from \(response.participantID), \(response.criterion)")
          }

          ForEach(
            Array(run.artifacts.prefix(showsAllEvidence ? run.artifacts.count : 3)),
            id: \.self
          ) { artifact in
            Label(artifact, systemImage: "paperclip")
              .font(.system(size: 10, design: .monospaced))
              .foregroundStyle(.secondary)
              .lineLimit(2)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(12)
              .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
          }
          if run.indexedEvidenceCount > 3 {
            Button(
              showsAllEvidence
                ? "Show evidence summary" : "Show all \(run.indexedEvidenceCount) evidence items"
            ) {
              showsAllEvidence.toggle()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
          }
        }
        .padding(10)
      }
    }
  }
}

extension StoredVerificationRun {
  fileprivate var indexedEvidenceCount: Int {
    changedPaths.count + audienceResponses.count + artifacts.count
  }

  fileprivate var kindLabel: String {
    kind.replacingOccurrences(of: "_", with: " ").capitalized
  }

  fileprivate var repositoryName: String {
    guard let repoPath, !repoPath.isEmpty else { return "No repository recorded" }
    return URL(fileURLWithPath: repoPath).lastPathComponent
  }
}

func workbenchNavigationShowsLabel(
  for section: WorkbenchSection,
  selectedSection: WorkbenchSection,
  showAllLabels: Bool
) -> Bool {
  section != .settings && (showAllLabels || section == selectedSection)
}

private struct PremiumTopBar: View {
  @Bindable var model: WorkbenchModel

  var body: some View {
    HStack(spacing: 16) {
      HStack(spacing: 10) {
        CodeVetterBrandMark(size: 34)
        Text("CODEVETTER")
          .font(.system(size: 11, weight: .bold))
          .tracking(1.35)
      }

      Spacer(minLength: 8)
      ViewThatFits(in: .horizontal) {
        navigation(showLabels: true)
        navigation(showLabels: false)
      }
      Spacer(minLength: 8)

      HStack(spacing: 8) {
        Circle().fill(EvidenceStyle.success).frame(width: 6, height: 6)
        Text("RUST")
          .font(.system(size: 8, weight: .bold, design: .monospaced))
          .foregroundStyle(.secondary)
        Button {
          model.commandPalettePresented = true
        } label: {
          Text("⌘K")
            .font(.system(size: 9, weight: .semibold, design: .monospaced))
            .foregroundStyle(.secondary)
            .premiumHitTarget(minWidth: 42, minHeight: PremiumPageLayout.navigationControlHeight)
            .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help("Open command palette")
        .accessibilityLabel("Open command palette")
        .accessibilityHint("Search and switch CodeVetter workspaces")
      }
    }
    .padding(.horizontal, 20)
    .frame(height: 60)
    .background(EvidenceStyle.chrome)
    .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }
  }

  private func navigation(showLabels: Bool) -> some View {
    HStack(spacing: 3) {
      ForEach(WorkbenchSection.allCases) { section in
        let showsLabel = workbenchNavigationShowsLabel(
          for: section,
          selectedSection: model.section,
          showAllLabels: showLabels
        )
        Button {
          model.section = section
        } label: {
          HStack(spacing: 6) {
            Image(systemName: section.systemImage)
              .font(.system(size: 11, weight: .semibold))
            if showsLabel {
              Text(section.rawValue).font(.system(size: 11, weight: .semibold))
            }
          }
          .foregroundStyle(
            model.section == section ? EvidenceStyle.amberForeground : Color.secondary
          )
          .padding(.horizontal, showsLabel ? 9 : 8)
          .premiumHitTarget(
            minWidth: PremiumPageLayout.navigationControlHeight,
            minHeight: PremiumPageLayout.navigationControlHeight
          )
          .overlay(alignment: .bottom) {
            if model.section == section {
              Rectangle()
                .fill(EvidenceStyle.amberForeground)
                .frame(height: 1)
                .padding(.horizontal, 7)
            }
          }
        }
        .buttonStyle(.plain)
        .help(section.rawValue)
        .accessibilityLabel(section.rawValue)
        .accessibilityIdentifier(
          "workbench-section-\(section.rawValue.lowercased().replacingOccurrences(of: " ", with: "-"))"
        )
        .accessibilityAddTraits(model.section == section ? .isSelected : [])
        .accessibilityRemoveTraits(model.section == section ? [] : .isSelected)
      }
    }
  }
}

private struct PremiumReviewView: View {
  @Bindable var model: WorkbenchModel

  var body: some View {
    VStack(spacing: 0) {
      PremiumPageHeader(
        eyebrow: "Executable verification",
        title: "Review",
        subtitle: "Bind one exact change to runnable evidence before deciding whether it can ship"
      ) {
        StatusPill(label: model.verificationState.rawValue, color: statusColor)
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      Group {
        if model.receipt == nil {
          HStack(spacing: 0) {
            reviewSetup
            Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
            ProofSequenceView(model: model).frame(width: 330)
          }
        } else {
          ReceiptDeskView(model: model)
        }
      }
    }
    .fileImporter(
      isPresented: $model.choosingRepository,
      allowedContentTypes: [.folder],
      allowsMultipleSelection: false
    ) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      model.selectRepository(url)
    }
    .fileImporter(
      isPresented: $model.choosingSpecs,
      allowedContentTypes: [
        UTType(filenameExtension: "md") ?? .plainText,
        UTType(filenameExtension: "markdown") ?? .plainText,
      ],
      allowsMultipleSelection: true
    ) { result in
      guard case .success(let urls) = result else { return }
      model.selectSpecFiles(urls)
    }
  }

  private var reviewSetup: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        VStack(alignment: .leading, spacing: 15) {
          PremiumFieldLabel("REPOSITORY")
          Button {
            model.choosingRepository = true
          } label: {
            HStack(spacing: 11) {
              Image(systemName: "folder.fill").foregroundStyle(EvidenceStyle.amberForeground)
              Text(repositoryLabel)
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundStyle(model.repositoryPath.isEmpty ? .secondary : .primary)
                .lineLimit(1)
                .truncationMode(.middle)
              Spacer()
              Text("Choose…")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 15)
            .frame(height: 48)
            .premiumField()
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Choose repository")

          HStack(alignment: .top, spacing: 14) {
            PremiumInput(
              label: "CHANGE", icon: "arrow.triangle.branch", placeholder: "main…HEAD",
              text: $model.change)
            PremiumInput(
              label: "TASK", icon: "scope",
              placeholder: "Describe the behavior this change must satisfy", text: $model.task)
          }

          VStack(alignment: .leading, spacing: 7) {
            PremiumFieldLabel("REVIEW STRATEGY")
            Picker("Review strategy", selection: $model.reviewAgent) {
              Text("Claude").tag("claude")
              Text("Codex").tag("codex")
              Text("Claude + Codex").tag("cross")
            }
            .pickerStyle(.segmented)
            .tint(.secondary)
            .accessibilityIdentifier("review-strategy")
            Text(
              model.reviewAgent == "cross"
                ? "Runs independent Claude then Codex passes against the same immutable change. Agreement is coverage, not proof."
                : "One reviewer pass; executable correctness remains a separate gate."
            )
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
          }

          specContract
        }

        HStack(spacing: 14) {
          PremiumMetric(value: changedPaths, label: "CHANGED PATHS")
          PremiumMetric(value: discoveredChecks, label: "CHECKS FOUND")
          PremiumMetric(value: issuedClaims, label: "CLAIMS ISSUED")
        }

        if let plan = model.preflightReceipt, model.receipt == nil {
          PlannedChecksView(model: model, receipt: plan)
        }

        if model.verificationState == .failed || model.verificationState == .limited {
          Label(model.statusMessage, systemImage: "exclamationmark.triangle.fill")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(EvidenceStyle.warning)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EvidenceStyle.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        }

        HStack(spacing: 12) {
          Text(model.statusMessage)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
            .lineLimit(2)
          Spacer()
          if model.isBusy {
            Button("Cancel", role: .destructive) { model.cancel() }
              .buttonStyle(.bordered)
              .keyboardShortcut(.escape, modifiers: [])
              .accessibilityIdentifier("review-cancel")
          } else {
            Button("Plan") { model.plan() }
              .buttonStyle(.bordered)
              .disabled(!model.canStart)
              .keyboardShortcut(.return, modifiers: [.command, .shift])
              .accessibilityIdentifier("review-plan")
            Button("Execute proof") { model.execute() }
              .buttonStyle(PremiumPrimaryButtonStyle())
              .disabled(!model.canExecuteReview)
              .keyboardShortcut(.return, modifiers: [.command])
              .accessibilityIdentifier("review-execute")
          }
        }
      }
      .padding(PremiumPageLayout.horizontalInset)
      .frame(maxWidth: 850, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(EvidenceStyle.canvas)
  }

  private var repositoryLabel: String {
    guard !model.repositoryPath.isEmpty else { return "No repository selected" }
    return URL(fileURLWithPath: model.repositoryPath).lastPathComponent
  }

  private var specContract: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("ACCEPTANCE CONTRACT · OPTIONAL")
          Text("Bind explicit Markdown requirements to executable correctness evidence.")
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button("Add specs…", systemImage: "doc.badge.plus") { model.choosingSpecs = true }
          .buttonStyle(.bordered)
          .controlSize(.small)
          .disabled(model.repositoryPath.isEmpty || model.specPaths.count >= 8)
      }
      if model.specPaths.isEmpty {
        Text("No spec attached. CodeVetter will not invent acceptance requirements.")
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(.tertiary)
      } else {
        ForEach(model.specPaths, id: \.self) { path in
          HStack(spacing: 9) {
            Image(systemName: "doc.text").foregroundStyle(EvidenceStyle.amberForeground)
            Text(path)
              .font(.system(size: 10, design: .monospaced))
              .lineLimit(1)
              .truncationMode(.middle)
            Spacer()
            Button("Remove", systemImage: "xmark") { model.removeSpec(path) }
              .labelStyle(.iconOnly)
              .buttonStyle(.borderless)
              .help("Remove \(path)")
          }
          .padding(.horizontal, 11)
          .frame(height: 34)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 8))
        }
      }
      if let issue = model.specIssue {
        Label(issue, systemImage: "exclamationmark.triangle")
          .font(.system(size: 9))
          .foregroundStyle(EvidenceStyle.warning)
      }
    }
    .padding(14)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private var changedPaths: String {
    (model.receipt ?? model.preflightReceipt).map { String($0.source.changedPaths.count) } ?? "—"
  }

  private var discoveredChecks: String {
    guard let plan = model.preflightReceipt else { return "—" }
    return String([plan.correctnessTarget, plan.performanceTarget].compactMap { $0 }.count)
  }

  private var issuedClaims: String {
    model.receipt == nil ? "0" : "1"
  }

  private var statusColor: Color {
    switch model.verificationState {
    case .completed, .planned: EvidenceStyle.success
    case .planning, .running: EvidenceStyle.amber
    case .limited: EvidenceStyle.warning
    case .failed: EvidenceStyle.failure
    case .ready, .cancelled: .secondary
    }
  }
}

private struct PlannedChecksView: View {
  @Bindable var model: WorkbenchModel
  let receipt: VerificationReceipt

  var body: some View {
    VStack(alignment: .leading, spacing: 13) {
      HStack {
        Label(
          receipt.status == "ready"
            ? "Executable plan ready" : "No confidence — execution is blocked",
          systemImage: receipt.status == "ready"
            ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
        )
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(receipt.status == "ready" ? EvidenceStyle.success : EvidenceStyle.warning)
        Spacer()
        Text(String(receipt.source.headSha.prefix(12)))
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .accessibilityIdentifier(
        receipt.status == "ready" ? "review-plan-ready" : "review-no-confidence")
      plannedTarget("CORRECTNESS", receipt.correctnessTarget)
      plannedTarget("PERFORMANCE", receipt.performanceTarget)
      if let coverage = receipt.specCoverage {
        Divider()
        HStack {
          PremiumFieldLabel("EXPLICIT REQUIREMENTS")
          Spacer()
          Text(
            "\(model.selectedRequirementIDs.count) selected · \(coverage.summary.totalRequirements) extracted"
          )
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
        }
        ForEach(coverage.requirements) { requirement in
          Button {
            model.toggleRequirement(requirement.id)
          } label: {
            HStack(alignment: .top, spacing: 10) {
              Image(
                systemName: model.selectedRequirementIDs.contains(requirement.id)
                  ? "checkmark.square.fill" : "square"
              )
              .foregroundStyle(
                model.selectedRequirementIDs.contains(requirement.id)
                  ? EvidenceStyle.amberForeground : Color.secondary)
              VStack(alignment: .leading, spacing: 3) {
                Text(requirement.title).font(.system(size: 10, weight: .semibold))
                Text("\(requirement.id) · \(requirement.sourcePath):\(requirement.startLine)")
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(.secondary)
              }
              Spacer()
              Text(requirement.status.replacingOccurrences(of: "_", with: " "))
                .font(.system(size: 8, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
            }
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Select requirement \(requirement.title)")
        }
        if !model.reviewPlanIsCurrent {
          Text("Selection changed. Plan again to bind the exact requirements before execution.")
            .font(.system(size: 9))
            .foregroundStyle(EvidenceStyle.warning)
        }
      }
      if !receipt.limitations.isEmpty {
        Text(receipt.limitations.joined(separator: "  ·  "))
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      if receipt.status != "ready" {
        Text(
          "CodeVetter will not run or issue a verdict until the missing executable target or requirement binding is resolved and planned again."
        )
        .font(.system(size: 9, weight: .medium))
        .foregroundStyle(EvidenceStyle.warning)
        .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(16)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func plannedTarget(_ label: String, _ target: VerificationTarget?) -> some View {
    HStack(spacing: 12) {
      PremiumFieldLabel(label).frame(width: 86, alignment: .leading)
      if let target {
        Text("\(target.adapter)  \(target.target)")
          .font(.system(size: 10, weight: .medium, design: .monospaced))
          .lineLimit(1)
      } else {
        Text("No repository-native target discovered")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
    }
  }
}

struct PremiumFieldLabel: View {
  let text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    Text(text)
      .font(.system(.caption, design: .monospaced, weight: .bold))
      .tracking(0.9)
      .foregroundStyle(.secondary)
  }
}

struct PremiumInput: View {
  let label: String
  let icon: String
  let placeholder: String
  @Binding var text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      PremiumFieldLabel(label)
      HStack(spacing: 10) {
        Image(systemName: icon).foregroundStyle(EvidenceStyle.amberForeground)
        TextField(placeholder, text: $text)
          .textFieldStyle(.plain)
          .font(.system(size: 12, weight: .medium, design: .monospaced))
      }
      .padding(.horizontal, 14)
      .frame(height: 48)
      .premiumField()
    }
    .frame(maxWidth: .infinity)
  }
}

private struct PremiumMetric: View {
  let value: String
  let label: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(value).font(.system(size: 28, weight: .medium, design: .rounded))
      PremiumFieldLabel(label)
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }
}

private struct ProofSequenceView: View {
  let model: WorkbenchModel

  private let steps = [
    ("Resolve source", "Exact repository and revision"),
    ("Discover checks", "Repository-native commands first"),
    ("Execute", "Supervised local processes"),
    ("Measure", "Runtime evidence and limitations"),
    ("Issue verdict", "Bounded to observed proof"),
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("PROOF SEQUENCE")
        .font(.system(size: 9, weight: .bold, design: .monospaced))
        .tracking(1.1)
        .foregroundStyle(.secondary)
        .padding(.bottom, 26)
      ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
        HStack(alignment: .top, spacing: 14) {
          VStack(spacing: 0) {
            ZStack {
              Circle().fill(
                index == activeIndex ? EvidenceStyle.amber : Color.primary.opacity(0.07))
              if index < activeIndex {
                Image(systemName: "checkmark")
                  .font(.system(size: 8, weight: .bold))
                  .foregroundStyle(EvidenceStyle.success)
              } else {
                Text(String(format: "%02d", index + 1))
                  .font(.system(size: 8, weight: .bold, design: .monospaced))
                  .foregroundStyle(index == activeIndex ? EvidenceStyle.ink : .secondary)
              }
            }
            .frame(width: 28, height: 28)
            if index < steps.count - 1 {
              Rectangle().fill(EvidenceStyle.separator).frame(width: 1, height: 48)
            }
          }
          VStack(alignment: .leading, spacing: 4) {
            Text(step.0).font(.system(size: 12, weight: .semibold))
            Text(step.1).font(.system(size: 10)).foregroundStyle(.secondary)
          }
          .padding(.top, 2)
        }
      }
      Spacer()
      Divider()
      VStack(alignment: .leading, spacing: 9) {
        PremiumFieldLabel("CURRENT AUTHORITY")
        Label("codevetter-rust-core", systemImage: "checkmark.seal.fill")
          .font(.system(size: 10, weight: .semibold, design: .monospaced))
          .foregroundStyle(EvidenceStyle.success)
        Text("No verdict is displayed without a versioned receipt.")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      .padding(.top, 16)
    }
    .padding(28)
    .background(EvidenceStyle.inspector)
  }

  private var activeIndex: Int {
    switch model.verificationState {
    case .ready, .cancelled: 0
    case .planning: 1
    case .planned: 2
    case .running: 3
    case .completed, .limited, .failed: 4
    }
  }
}

private enum VerificationReceiptDetailMode: String, CaseIterable, Identifiable {
  case findings = "Findings"
  case proof = "Proof map"
  case intent = "Intent"
  case json = "JSON"

  var id: String { rawValue }
}

private struct ReceiptDeskView: View {
  let model: WorkbenchModel
  @State private var detailMode: VerificationReceiptDetailMode = .findings
  @State private var actionIssue: String?
  @State private var showingXray = false
  @State private var showingFixPacket = false
  @State private var showsProofSummary = false

  var body: some View {
    if let receipt = model.receipt {
      VStack(spacing: 0) {
        HStack {
          VStack(alignment: .leading, spacing: 4) {
            Text("VERIFICATION RECEIPT")
              .font(.system(size: 9, weight: .bold, design: .monospaced))
              .foregroundStyle(EvidenceStyle.amberForeground)
            Text(receipt.task).font(.system(size: 20, weight: .semibold)).lineLimit(1)
            Text("\(receipt.source.input)  ·  \(receipt.source.changedPaths.count) changed paths")
              .font(.system(size: 10, design: .monospaced))
              .foregroundStyle(.secondary)
          }
          Spacer()
          StatusPill(
            label: receipt.status ?? receipt.verdict ?? "Completed",
            color: receiptOutcomeColor(receipt)
          )
          Button(
            showsProofSummary ? "Hide details" : "Details",
            systemImage: "sidebar.trailing"
          ) {
            showsProofSummary.toggle()
          }
          .buttonStyle(.bordered)
          .controlSize(.small)
          Menu {
            if receipt.reviewID != nil {
              Button("Agent PR X-Ray", systemImage: "eye.trianglebadge.exclamationmark") {
                showingXray = true
              }
            }
            if receipt.runID != nil,
              receipt.reviewFindings.contains(where: { $0.persistedID != nil })
            {
              Button("Fix handoff", systemImage: "wrench.and.screwdriver") {
                showingFixPacket = true
              }
            }
            Button("Export JSON", systemImage: "square.and.arrow.up") {
              exportReceipt(receipt)
            }
          } label: {
            Label("More", systemImage: "ellipsis.circle")
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          Button("New verification") {
            model.resetVerification()
          }
          .buttonStyle(.bordered)
        }
        .padding(.horizontal, 22)
        .frame(height: 82)
        .background(EvidenceStyle.chrome)
        .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }

        HStack(spacing: 0) {
          if showsProofSummary {
            VStack(alignment: .leading, spacing: 0) {
              PremiumFieldLabel("CHANGED PATHS").padding(16)
              ScrollView {
                VStack(spacing: 2) {
                  ForEach(receipt.source.changedPaths, id: \.self) { path in
                    Button {
                      openSource(path: path, line: nil, receipt: receipt)
                    } label: {
                      HStack(spacing: 8) {
                        Image(systemName: "doc.text").foregroundStyle(EvidenceStyle.amberForeground)
                        Text(path)
                          .font(.system(size: 10, design: .monospaced))
                          .lineLimit(1)
                        Spacer()
                        Image(systemName: "arrow.up.forward.square")
                          .font(.system(size: 8))
                          .foregroundStyle(.tertiary)
                      }
                      .padding(.horizontal, 14)
                      .frame(height: 32)
                    }
                    .buttonStyle(.plain)
                    .help("Open source")
                  }
                }
              }
            }
            .frame(width: 230)
            .background(EvidenceStyle.surface)

            Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
          }

          VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
              Text(detailHeading)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
              Spacer()
              if detailMode == .findings {
                Text("\(receipt.reviewFindings.count) findings")
                  .font(.system(size: 9, design: .monospaced))
                  .foregroundStyle(.secondary)
              } else if detailMode == .proof {
                Text("recorded review context")
                  .font(.system(size: 9, design: .monospaced))
                  .foregroundStyle(.secondary)
              } else if detailMode == .intent {
                Text("human disposition required")
                  .font(.system(size: 9, design: .monospaced))
                  .foregroundStyle(.secondary)
              } else {
                Text(receipt.schemaVersion)
                  .font(.system(size: 9, design: .monospaced))
                  .foregroundStyle(.secondary)
              }
              Picker("Receipt detail", selection: $detailMode) {
                ForEach(VerificationReceiptDetailMode.allCases) { mode in
                  Text(mode.rawValue).tag(mode)
                }
              }
              .labelsHidden()
              .pickerStyle(.segmented)
              .tint(.secondary)
              .frame(width: 280)
            }
            .padding(.horizontal, 16)
            .frame(height: 40)
            .background(EvidenceStyle.surface)
            if detailMode == .findings {
              reviewEvidence(receipt)
            } else if detailMode == .proof, let evidence = receipt.reviewStageEvidence {
              ReviewProofMapView(
                evidence: evidence,
                repositoryPath: receipt.repoPath,
                onOpenTesting: { model.prepareTestingFromReview(receipt) }
              )
            } else if detailMode == .intent, let evidence = receipt.reviewStageEvidence {
              ReviewIntentDiagnosticView(
                evidence: evidence,
                onVerifyInTesting: { model.prepareTestingFromReview(receipt) }
              )
            } else {
              ScrollView([.horizontal, .vertical]) {
                Text(model.receiptJSON)
                  .font(.system(size: 10, design: .monospaced))
                  .foregroundStyle(.secondary)
                  .textSelection(.enabled)
                  .padding(18)
              }
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)

          if showsProofSummary {
            Rectangle().fill(EvidenceStyle.separator).frame(width: 1)

            VStack(alignment: .leading, spacing: 20) {
              PremiumFieldLabel("PROOF SUMMARY")
              Text(
                (receipt.status ?? receipt.verdict ?? "Completed").replacingOccurrences(
                  of: "_", with: " ")
              )
              .font(.system(size: 22, weight: .semibold))
              receiptPair("BASE", String(receipt.source.baseSha.prefix(12)))
              receiptPair("HEAD", String(receipt.source.headSha.prefix(12)))
              if let stages = receipt.stages {
                receiptPair(
                  "REVIEW", stages.review.status.replacingOccurrences(of: "_", with: " "))
                receiptPair(
                  "CORRECTNESS", stages.correctness.status.replacingOccurrences(of: "_", with: " "))
                receiptPair(
                  "PERFORMANCE", stages.performance.status.replacingOccurrences(of: "_", with: " "))
              }
              Divider()
              PremiumFieldLabel("LIMITATIONS")
              if receipt.limitations.isEmpty {
                Label("No limitations recorded", systemImage: "checkmark.circle")
                  .font(.system(size: 11))
                  .foregroundStyle(EvidenceStyle.success)
              } else {
                ForEach(receipt.limitations, id: \.self) { limitation in
                  Label(limitation, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                }
              }
              Spacer()
              if let actionIssue {
                Label(actionIssue, systemImage: "exclamationmark.triangle.fill")
                  .font(.system(size: 9))
                  .foregroundStyle(EvidenceStyle.warning)
                  .fixedSize(horizontal: false, vertical: true)
              }
              Label("Rust-owned receipt", systemImage: "checkmark.seal.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(EvidenceStyle.success)
            }
            .padding(22)
            .frame(width: 300)
            .background(EvidenceStyle.inspector)
          }
        }
      }
      .sheet(isPresented: $showingXray) {
        XrayExportView(model: model, receipt: receipt)
          .frame(minWidth: 860, minHeight: 640)
      }
      .sheet(isPresented: $showingFixPacket) {
        AgentFixPacketView(model: model, receipt: receipt)
          .frame(minWidth: 860, minHeight: 640)
      }
    }
  }

  @ViewBuilder
  private func reviewEvidence(_ receipt: VerificationReceipt) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 9) {
        if let coverage = receipt.specCoverage {
          SpecCoverageEvidenceCard(coverage: coverage)
        }
        if let crossReview = receipt.reviewStageEvidence?.value(at: "cross_review") {
          CrossReviewEvidenceCard(evidence: crossReview)
        }
        if receipt.reviewFindings.isEmpty {
          VStack(spacing: 9) {
            Image(
              systemName: receiptHasNoConfidence(receipt)
                ? "questionmark.diamond" : "checkmark.shield"
            )
            .font(.system(size: 24, weight: .light))
            .foregroundStyle(
              receiptHasNoConfidence(receipt) ? EvidenceStyle.warning : EvidenceStyle.success)
            Text(
              receiptHasNoConfidence(receipt)
                ? "No confidence — no qualified verdict" : "No qualified review findings"
            )
            .font(.system(size: 13, weight: .semibold))
            Text(
              emptyFindingExplanation(receipt)
            )
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
          }
          .padding(24)
          .frame(maxWidth: .infinity)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
          .accessibilityIdentifier(
            receiptHasNoConfidence(receipt)
              ? "review-receipt-no-confidence" : "review-receipt-no-findings")
        } else {
          if let summary = receipt.reviewSummary, !summary.isEmpty {
            Text(summary)
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(.secondary)
              .textSelection(.enabled)
              .padding(14)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 10))
          }
          ForEach(receipt.reviewFindings) { finding in
            VStack(alignment: .leading, spacing: 9) {
              HStack(spacing: 8) {
                StatusPill(label: finding.severity, color: findingColor(finding.severity))
                if let confidence = finding.confidence {
                  Text(confidence, format: .percent.precision(.fractionLength(0)))
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.secondary)
                }
                if let classification = finding.crossReviewClass {
                  StatusPill(
                    label: classification.replacingOccurrences(of: "_", with: " "),
                    color: classification == "conflicting"
                      ? EvidenceStyle.warning : EvidenceStyle.amberForeground
                  )
                }
                if !finding.reviewers.isEmpty {
                  Text(finding.reviewers.joined(separator: " + "))
                    .font(.system(size: 8, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
                }
                Spacer()
                if let path = finding.filePath {
                  Button("Open source", systemImage: "arrow.up.forward.square") {
                    openSource(path: path, line: finding.line, receipt: receipt)
                  }
                  .buttonStyle(.borderless)
                  .controlSize(.small)
                }
              }
              Text(finding.title).font(.system(size: 13, weight: .semibold))
              Text(finding.summary)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
              if let path = finding.filePath {
                Text(path + (finding.line.map { ":\($0)" } ?? ""))
                  .font(.system(size: 9, design: .monospaced))
                  .foregroundStyle(EvidenceStyle.amberForeground)
                  .lineLimit(1)
              }
              if let suggestion = finding.suggestion, !suggestion.isEmpty {
                Label(suggestion, systemImage: "wrench.and.screwdriver")
                  .font(.system(size: 9))
                  .foregroundStyle(.secondary)
              }
            }
            .padding(14)
            .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
          }
        }
      }
      .padding(14)
    }
  }

  private struct CrossReviewEvidenceCard: View {
    let evidence: PerformanceJSONValue
    @State private var showsQualificationDetails = false

    private var passes: [PerformanceJSONValue] {
      evidence.value(at: "passes")?.arrayValue ?? []
    }

    private var counts: PerformanceJSONValue? { evidence.value(at: "counts") }

    var body: some View {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Label("INDEPENDENT CROSS-REVIEW", systemImage: "person.2.badge.gearshape")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(EvidenceStyle.amberForeground)
          Spacer()
          StatusPill(
            label: evidence.value(at: "status")?.stringValue ?? "incomplete",
            color: evidence.value(at: "status")?.stringValue == "completed"
              ? EvidenceStyle.success : EvidenceStyle.warning
          )
        }
        HStack(spacing: 8) {
          crossMetric("BOTH", value: count("corroborated"))
          crossMetric("CONFLICTS", value: count("conflicting"))
        }
        DisclosureGroup(
          "Reviewer timing and qualification details", isExpanded: $showsQualificationDetails
        ) {
          VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
              crossMetric("CLAUDE ONLY", value: count("claude_only"))
              crossMetric("CODEX ONLY", value: count("codex_only"))
            }
            HStack(spacing: 8) {
              crossMetric("REJECTED", value: count("rejected"))
              crossMetric("STALE", value: count("stale"))
              crossMetric("UNRESOLVED", value: count("unresolved"))
              crossMetric("TOTAL TIME", value: "\(totalDuration) ms")
            }
            ForEach(Array(passes.enumerated()), id: \.offset) { _, pass in
              HStack {
                Text((pass.value(at: "reviewer")?.stringValue ?? "reviewer").uppercased())
                  .font(.system(size: 9, weight: .bold, design: .monospaced))
                Text(pass.value(at: "status")?.stringValue ?? "incomplete")
                  .font(.system(size: 9))
                  .foregroundStyle(.secondary)
                Spacer()
                if let duration = pass.value(at: "duration_ms")?.numberValue {
                  Text("\(Int(duration)) ms")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.secondary)
                }
              }
            }
            Text("USAGE  \(usageSummary)")
              .font(.system(size: 8, weight: .semibold, design: .monospaced))
              .foregroundStyle(.secondary)
          }
          .padding(.top, 8)
        }
        .font(.system(size: 9, weight: .semibold))
        .tint(EvidenceStyle.amberForeground)
        Text(
          evidence.value(at: "proof_boundary")?.stringValue
            ?? "Reviewer agreement is coverage, never executable proof."
        )
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
      }
      .padding(14)
      .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
      .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
      .accessibilityIdentifier("review-cross-review-summary")
    }

    private func count(_ key: String) -> String {
      guard let value = counts?.value(at: key)?.numberValue else { return "0" }
      return String(Int(value))
    }

    private var totalDuration: Int {
      passes.reduce(0) { total, pass in
        total + Int(pass.value(at: "duration_ms")?.numberValue ?? 0)
      }
    }

    private var usageSummary: String {
      passes.contains { pass in
        guard let usage = pass.value(at: "usage") else { return false }
        if case .null = usage { return false }
        return true
      } ? "recorded per reviewer" : "not reported by current executors"
    }

    private func crossMetric(_ label: String, value: String) -> some View {
      VStack(alignment: .leading, spacing: 2) {
        Text(value).font(.system(size: 15, weight: .semibold, design: .monospaced))
        Text(label)
          .font(.system(size: 7, weight: .bold, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(9)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
    }
  }

  private func exportReceipt(_ receipt: VerificationReceipt) {
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.canCreateDirectories = true
    panel.isExtensionHidden = false
    panel.nameFieldStringValue = "verification-\(receipt.runID ?? "receipt").json"
    panel.message = "Export the canonical Rust-owned receipt without reinterpretation."
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    do {
      try "\(model.receiptJSON)\n".write(to: destination, atomically: true, encoding: .utf8)
      actionIssue = nil
    } catch {
      actionIssue = "Export failed: \(error.localizedDescription)"
    }
  }

  private func openSource(path: String, line: Int?, receipt: VerificationReceipt) {
    let components = NSString(string: path).pathComponents
    guard !NSString(string: path).isAbsolutePath,
      !components.contains(".."), !components.contains("."), !path.contains("\0")
    else {
      actionIssue = "The receipt source path is not repository-contained."
      return
    }
    let root = URL(fileURLWithPath: receipt.repoPath, isDirectory: true).standardizedFileURL
    let target = root.appending(path: path).standardizedFileURL
    let rootPrefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
    guard target.path.hasPrefix(rootPrefix), FileManager.default.fileExists(atPath: target.path)
    else {
      actionIssue = "The recorded source path is no longer available in this checkout."
      return
    }
    if NSWorkspace.shared.open(target) {
      actionIssue = line.map {
        "Opened source at recorded line \($0); line positioning depends on the default editor."
      }
    } else {
      actionIssue = "macOS could not open the recorded source file."
    }
  }

  private func findingColor(_ severity: String) -> Color {
    switch severity.lowercased() {
    case "critical", "high": EvidenceStyle.failure
    case "medium": EvidenceStyle.warning
    default: .secondary
    }
  }

  private func receiptOutcomeColor(_ receipt: VerificationReceipt) -> Color {
    switch (receipt.verdict ?? receipt.status ?? "").lowercased() {
    case "failed", "needs_attention": EvidenceStyle.failure
    case "no_confidence": EvidenceStyle.warning
    default: EvidenceStyle.success
    }
  }

  private func receiptHasNoConfidence(_ receipt: VerificationReceipt) -> Bool {
    let outcome = (receipt.verdict ?? receipt.status ?? "").lowercased()
    return outcome == "no_confidence" || receipt.stages?.review.status == "no_confidence"
  }

  private func emptyFindingExplanation(_ receipt: VerificationReceipt) -> String {
    if receiptHasNoConfidence(receipt) {
      return receipt.limitations.first
        ?? receipt.reviewSummary
        ?? "The receipt lacks enough executable or review evidence to support a verdict."
    }
    return receipt.reviewSummary
      ?? "The Rust receipt did not include actionable source-qualified findings. Check coverage and limitations before treating this as a pass."
  }

  private var detailHeading: String {
    switch detailMode {
    case .findings: "QUALIFIED REVIEW EVIDENCE"
    case .proof: "DETERMINISTIC PROOF MAP"
    case .intent: "INTENT DIAGNOSTIC"
    case .json: "CANONICAL JSON"
    }
  }

  private func receiptPair(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 11, weight: .medium, design: .monospaced))
    }
  }
}

struct ReviewIntentDiagnosticView: View {
  let evidence: PerformanceJSONValue
  let onVerifyInTesting: (() -> Void)?
  @State private var showsSignalDetails = false

  init(evidence: PerformanceJSONValue, onVerifyInTesting: (() -> Void)? = nil) {
    self.evidence = evidence
    self.onVerifyInTesting = onVerifyInTesting
  }

  private var diagnostic: PerformanceJSONValue? { evidence.value(at: "intent_diagnostic") }

  var body: some View {
    ScrollView {
      if let diagnostic {
        LazyVStack(alignment: .leading, spacing: 12) {
          intentHero(diagnostic)
          intentSummary(diagnostic)
          gapsAndLimits(diagnostic)
          signalGrid(diagnostic)
          timeline(diagnostic)
        }
        .padding(14)
      } else {
        ContentUnavailableView(
          "No intent diagnostic",
          systemImage: "scope",
          description: Text(
            "This receipt predates the Rust-owned intent diagnostic. Its canonical evidence remains available in Proof map and JSON."
          )
        )
        .padding(28)
      }
    }
    .background(EvidenceStyle.canvas)
    .accessibilityIdentifier("review.intent-diagnostic")
  }

  private func intentHero(_ value: PerformanceJSONValue) -> some View {
    let closure = value.value(at: "closure")
    let closureStatus = text(closure, "status") ?? "unavailable"
    return HStack(alignment: .top, spacing: 14) {
      ZStack {
        RoundedRectangle(cornerRadius: 12).fill(statusColor(closureStatus).opacity(0.13))
        Image(systemName: "scope")
          .font(.system(size: 20, weight: .medium))
          .foregroundStyle(statusColor(closureStatus))
      }
      .frame(width: 46, height: 46)
      VStack(alignment: .leading, spacing: 5) {
        PremiumFieldLabel("RUST-OWNED INTENT DIAGNOSTIC")
        Text("Evidence around the goal—not an inferred success claim")
          .font(.system(size: 14, weight: .semibold))
        Text(text(closure, "reason") ?? "No closure rationale was recorded.")
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 8) {
        StatusPill(label: normalized(closureStatus), color: statusColor(closureStatus))
        if let onVerifyInTesting {
          Button("Verify in Testing", systemImage: "play.rectangle.on.rectangle") {
            onVerifyInTesting()
          }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .controlSize(.small)
          .accessibilityIdentifier("review.intent.open-testing")
        }
      }
    }
    .padding(16)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 13))
    .overlay { RoundedRectangle(cornerRadius: 13).stroke(EvidenceStyle.separator) }
  }

  private func intentSummary(_ value: PerformanceJSONValue) -> some View {
    let intent = value.value(at: "intent")
    let surfaces = strings(value, "changed_surfaces")
    return VStack(alignment: .leading, spacing: 11) {
      HStack {
        PremiumFieldLabel("ORIGINAL INTENT")
        Spacer()
        Text(text(intent, "source") ?? "unknown source")
          .font(.system(size: 8, weight: .medium, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      Text(text(intent, "summary") ?? "No explicit task intent captured")
        .font(.system(size: 16, weight: .semibold))
        .textSelection(.enabled)
      if !surfaces.isEmpty {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 7)], spacing: 7) {
          ForEach(surfaces, id: \.self) { surface in
            Label(normalized(surface), systemImage: surfaceIcon(surface))
              .font(.system(size: 8, weight: .semibold, design: .monospaced))
              .foregroundStyle(EvidenceStyle.amberForeground)
              .padding(.horizontal, 9)
              .frame(height: 28)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
          }
        }
      }
    }
    .padding(16)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 13))
    .overlay { RoundedRectangle(cornerRadius: 13).stroke(EvidenceStyle.separator) }
  }

  private func signalGrid(_ value: PerformanceJSONValue) -> some View {
    let signals = value.value(at: "signals")
    return VStack(alignment: .leading, spacing: 9) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
        diagnosticMetric("FINDINGS", text(signals, "findings") ?? "0")
        diagnosticMetric("HIGH RISK", text(signals, "high_risk_findings") ?? "0")
      }
      DisclosureGroup(isExpanded: $showsSignalDetails) {
        HStack(spacing: 8) {
          diagnosticMetric("QA PASSED", text(signals, "passed_qa_runs") ?? "0")
          diagnosticMetric("PATHS", text(signals, "changed_paths") ?? "0")
          diagnosticMetric("QA RUNS", text(signals, "qa_runs") ?? "0")
          diagnosticMetric("ARTIFACTS", text(signals, "qa_artifacts") ?? "0")
        }
        .padding(.top, 8)
      } label: {
        Text("Additional signal counts").font(.system(size: 9, weight: .semibold))
      }
      .tint(EvidenceStyle.amberForeground)
    }
  }

  private func diagnosticMetric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 17, weight: .semibold, design: .rounded))
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
    .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
  }

  private func timeline(_ value: PerformanceJSONValue) -> some View {
    let items = value.value(at: "timeline")?.arrayValue ?? []
    return VStack(alignment: .leading, spacing: 12) {
      PremiumFieldLabel("EVIDENCE TIMELINE")
      ForEach(Array(items.enumerated()), id: \.offset) { index, item in
        HStack(alignment: .top, spacing: 11) {
          VStack(spacing: 0) {
            Circle().fill(statusColor(text(item, "status") ?? "pending")).frame(width: 8, height: 8)
            if index < items.count - 1 {
              Rectangle().fill(EvidenceStyle.separator).frame(width: 1, height: 34)
            }
          }
          VStack(alignment: .leading, spacing: 3) {
            HStack {
              Text(text(item, "label") ?? "Evidence stage")
                .font(.system(size: 10, weight: .semibold))
              Spacer()
              Text(normalized(text(item, "status") ?? "pending"))
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .foregroundStyle(statusColor(text(item, "status") ?? "pending"))
            }
            Text(text(item, "detail") ?? "No detail recorded.")
              .font(.system(size: 8))
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }
    .padding(16)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 13))
    .overlay { RoundedRectangle(cornerRadius: 13).stroke(EvidenceStyle.separator) }
  }

  private func gapsAndLimits(_ value: PerformanceJSONValue) -> some View {
    let gaps = strings(value, "gaps")
    let limitations = strings(value, "limitations")
    return VStack(alignment: .leading, spacing: 10) {
      PremiumFieldLabel("WHAT STILL BLOCKS CLOSURE")
      if gaps.isEmpty {
        Label("No deterministic evidence gaps recorded", systemImage: "checkmark.circle")
          .font(.system(size: 10))
          .foregroundStyle(EvidenceStyle.success)
      } else {
        ForEach(gaps, id: \.self) { gap in
          Label(gap, systemImage: "exclamationmark.triangle")
            .font(.system(size: 9))
            .foregroundStyle(EvidenceStyle.warning)
        }
      }
      Divider()
      ForEach(limitations, id: \.self) { limitation in
        Label(limitation, systemImage: "person.crop.circle.badge.exclamationmark")
          .font(.system(size: 8))
          .foregroundStyle(.secondary)
      }
    }
    .padding(16)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 13))
    .overlay { RoundedRectangle(cornerRadius: 13).stroke(EvidenceStyle.separator) }
  }

  private func text(_ value: PerformanceJSONValue?, _ key: String) -> String? {
    guard let child = value?.value(at: key) else { return nil }
    switch child {
    case .null, .object, .array: return nil
    default: return child.displayValue
    }
  }

  private func strings(_ value: PerformanceJSONValue, _ key: String) -> [String] {
    value.value(at: key)?.arrayValue?.compactMap(\.stringValue) ?? []
  }

  private func normalized(_ value: String) -> String {
    value.replacingOccurrences(of: "_", with: " ")
  }

  private func statusColor(_ status: String) -> Color {
    switch status.lowercased() {
    case "done", "captured", "ready_for_human_disposition", "passed": EvidenceStyle.success
    case "evidence_conflict", "failed", "warning": EvidenceStyle.failure
    default: EvidenceStyle.warning
    }
  }

  private func surfaceIcon(_ surface: String) -> String {
    switch surface {
    case "user_interface": "macwindow"
    case "runtime": "gearshape.2"
    case "tests": "checkmark.diamond"
    case "documentation": "doc.text"
    case "automation": "bolt.horizontal"
    case "data": "cylinder"
    default: "square.stack.3d.up"
    }
  }
}

struct AgentFixPacketView: View {
  @Bindable var model: WorkbenchModel
  let receipt: VerificationReceipt
  @Environment(\.dismiss) private var dismiss
  @State private var copied = false

  private var selectableFindings: [VerificationFinding] {
    receipt.reviewFindings.filter { $0.persistedID != nil }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        Image(systemName: "wrench.and.screwdriver.fill")
          .font(.system(size: 18, weight: .medium))
          .foregroundStyle(EvidenceStyle.amberForeground)
        VStack(alignment: .leading, spacing: 3) {
          Text("Agent Fix Handoff").font(.system(size: 17, weight: .semibold))
          Text("Selected findings · exact task · evidence to preserve")
            .font(.system(size: 9, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        Spacer()
        Text(receipt.runID ?? "unpersisted")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
        Button("Done") { dismiss() }.buttonStyle(.bordered)
      }
      .padding(.horizontal, 20)
      .frame(height: 68)
      .background(EvidenceStyle.chrome)
      .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }

      HStack(spacing: 0) {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            PremiumFieldLabel("PATCH SCOPE")
            Text(
              "Choose only the findings one agent should fix together. Rust rebuilds the handoff from the persisted local-check receipt."
            )
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            ForEach(selectableFindings) { finding in
              if let findingID = finding.persistedID {
                Toggle(
                  isOn: Binding(
                    get: { model.fixPacketSelectedFindingIDs.contains(findingID) },
                    set: { _ in model.toggleFixPacketFinding(findingID) }
                  )
                ) {
                  VStack(alignment: .leading, spacing: 4) {
                    HStack {
                      Text(finding.title)
                        .font(.system(size: 10, weight: .semibold))
                        .lineLimit(2)
                      Spacer()
                      Text(finding.severity.uppercased())
                        .font(.system(size: 7, weight: .bold, design: .monospaced))
                        .foregroundStyle(severityColor(finding.severity))
                    }
                    if let path = finding.filePath {
                      Text(path + (finding.line.map { ":\($0)" } ?? ""))
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.secondary)
                    }
                  }
                }
                .toggleStyle(.checkbox)
                .padding(10)
                .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
              }
            }

            Button("Build handoff", systemImage: "arrow.right.circle.fill") {
              copied = false
              model.buildFixPacket()
            }
            .buttonStyle(PremiumPrimaryButtonStyle())
            .disabled(!model.canBuildFixPacket)
            .accessibilityIdentifier("build-fix-packet")

            if model.fixPacketLoading {
              ProgressView("Rust is binding the exact receipt…")
                .controlSize(.small)
                .font(.system(size: 9))
            }
            if let issue = model.fixPacketIssue {
              Label(issue, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 9))
                .foregroundStyle(EvidenceStyle.failure)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
          .padding(20)
        }
        .frame(width: 310)
        .background(EvidenceStyle.surface)

        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        packetDesk.frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(EvidenceStyle.canvas)
    .onAppear { model.prepareFixPacketSelection() }
  }

  @ViewBuilder
  private var packetDesk: some View {
    if let packet = model.fixPacketReceipt {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: "arrow.triangle.branch")
              .font(.system(size: 23))
              .foregroundStyle(EvidenceStyle.amberForeground)
            VStack(alignment: .leading, spacing: 4) {
              Text("Bounded patch handoff").font(.system(size: 16, weight: .semibold))
              Text(packet.routeAdvice)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button(
              copied ? "Copied" : "Copy Markdown",
              systemImage: copied ? "checkmark" : "doc.on.doc"
            ) {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(packet.markdown, forType: .string)
              copied = true
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityIdentifier("copy-fix-packet")
          }
          .padding(15)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

          HStack(spacing: 8) {
            metric("FINDINGS", "\(packet.findings.count)")
            metric("ACCEPTANCE", "\(packet.task.acceptanceCriteria.count)")
            metric("EVIDENCE", "\(packet.evidence.count)")
            metric("HEAD", String(packet.source.headSHA.prefix(10)))
          }

          isolatedExecution(packet)

          section("TASK CONTRACT", icon: "scope", color: EvidenceStyle.amber) {
            Text(packet.task.goal).font(.system(size: 11, weight: .semibold))
            if packet.task.acceptanceCriteria.isEmpty {
              Label(
                "No explicit acceptance requirements were attached.",
                systemImage: "exclamationmark.triangle"
              )
              .font(.system(size: 9))
              .foregroundStyle(EvidenceStyle.warning)
            } else {
              ForEach(packet.task.acceptanceCriteria, id: \.self) { criterion in
                Label(criterion, systemImage: "checkmark.circle")
                  .font(.system(size: 9))
                  .foregroundStyle(.secondary)
              }
            }
            Text("Non-goals are empty because CodeVetter does not infer them.")
              .font(.system(size: 8, design: .monospaced))
              .foregroundStyle(.secondary)
          }

          section("PATCH FINDINGS", icon: "wrench.adjustable", color: EvidenceStyle.failure) {
            ForEach(packet.findings) { finding in
              VStack(alignment: .leading, spacing: 5) {
                HStack {
                  Text(finding.title).font(.system(size: 10, weight: .semibold))
                  Spacer()
                  Text(finding.severity.uppercased())
                    .font(.system(size: 7, weight: .bold, design: .monospaced))
                    .foregroundStyle(severityColor(finding.severity))
                }
                Text(finding.summary).font(.system(size: 9)).foregroundStyle(.secondary)
                Text(finding.filePath + (finding.line.map { ":\($0)" } ?? ""))
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(EvidenceStyle.amberForeground)
                if let suggestion = finding.suggestion {
                  Label(suggestion, systemImage: "lightbulb")
                    .font(.system(size: 8))
                    .foregroundStyle(.secondary)
                }
              }
              .padding(10)
              .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
            }
          }

          section("EVIDENCE TO PRESERVE", icon: "checkmark.seal", color: EvidenceStyle.success) {
            ForEach(packet.evidence) { evidence in
              HStack(alignment: .top, spacing: 9) {
                Circle().fill(statusColor(evidence.status)).frame(width: 7, height: 7).padding(
                  .top, 4)
                VStack(alignment: .leading, spacing: 3) {
                  Text(evidence.label).font(.system(size: 9, weight: .semibold))
                  Text(evidence.qualification)
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.secondary)
                  if let artifact = evidence.artifact {
                    Text(artifact)
                      .font(.system(size: 8, design: .monospaced))
                      .foregroundStyle(EvidenceStyle.amberForeground)
                  }
                }
                Spacer()
                Text(evidence.status.replacingOccurrences(of: "_", with: " "))
                  .font(.system(size: 8, weight: .bold, design: .monospaced))
                  .foregroundStyle(statusColor(evidence.status))
              }
              .padding(9)
              .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
            }
          }

          ForEach(packet.limitations, id: \.self) { limitation in
            Label(limitation, systemImage: "exclamationmark.triangle")
              .font(.system(size: 8))
              .foregroundStyle(.secondary)
          }
        }
        .padding(18)
      }
    } else {
      ContentUnavailableView {
        Label("Select a bounded patch", systemImage: "wrench.and.screwdriver")
      } description: {
        Text(
          "The handoff binds the exact task, selected qualified findings, and recorded evidence without claiming the fix is correct."
        )
      }
    }
  }

  private func isolatedExecution(_ packet: AgentFixPacketReceipt) -> some View {
    section(
      "ISOLATED EXECUTION",
      icon: "shippingbox.and.arrow.backward",
      color: EvidenceStyle.amber
    ) {
      Text(
        "Run one coding agent against the exact recorded head in a detached app-data worktree. CodeVetter never commits, merges, pushes, or edits the selected checkout."
      )
      .font(.system(size: 9))
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)

      Picker("Coding agent", selection: $model.fixAttemptAgent) {
        Text("Codex").tag("codex")
        Text("Claude").tag("claude")
        Text("Gemini").tag("gemini")
      }
      .pickerStyle(.segmented)
      .tint(.secondary)
      .disabled(model.fixAttemptLoading)
      .accessibilityIdentifier("fix-attempt-agent")

      Toggle(isOn: $model.fixAttemptConfirmed) {
        Text("Allow one agent to edit the detached worktree and rerun recorded proof")
          .font(.system(size: 9, weight: .medium))
      }
      .toggleStyle(.checkbox)
      .disabled(model.fixAttemptLoading || model.fixAttemptReceipt != nil)
      .accessibilityIdentifier("confirm-fix-attempt")

      HStack {
        if model.fixAttemptLoading {
          ProgressView().controlSize(.small)
          Text("Agent is editing, then Rust will recheck the diff, target, and findings…")
            .font(.system(size: 8))
            .foregroundStyle(.secondary)
          Spacer()
          Button("Cancel", role: .cancel) { model.cancelFixAttempt() }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityIdentifier("cancel-fix-attempt")
        } else if model.fixAttemptReceipt == nil {
          Button("Execute isolated fix", systemImage: "play.fill") {
            model.executeFixAttempt()
          }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .disabled(!model.canExecuteFixAttempt)
          .accessibilityIdentifier("execute-fix-attempt")
          Spacer()
          Text("HEAD \(packet.source.headSHA.prefix(10))")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }

      if let issue = model.fixAttemptIssue {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 9))
          .foregroundStyle(EvidenceStyle.failure)
          .fixedSize(horizontal: false, vertical: true)
      }

      if let attempt = model.fixAttemptReceipt {
        fixAttemptReceiptDesk(attempt)
      }
    }
  }

  private func fixAttemptReceiptDesk(_ attempt: FixAttemptReceipt) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Image(
          systemName: attempt.state == "verified_fixed"
            ? "checkmark.seal.fill" : "shield.lefthalf.filled"
        )
        .foregroundStyle(statusColor(attempt.state))
        VStack(alignment: .leading, spacing: 2) {
          Text(attempt.state.replacingOccurrences(of: "_", with: " ").uppercased())
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .foregroundStyle(statusColor(attempt.state))
          Text(attempt.attemptID)
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        Spacer()
        if attempt.worktree.retained {
          Button("Reveal worktree", systemImage: "folder") {
            NSWorkspace.shared.activateFileViewerSelecting([
              URL(fileURLWithPath: attempt.worktree.path)
            ])
          }
          .buttonStyle(.bordered)
          .controlSize(.small)
          .accessibilityIdentifier("reveal-fix-worktree")
        }
      }

      HStack(spacing: 8) {
        metric("DIFF CHECK", attempt.recheck.diffCheck.status.uppercased())
        metric("TARGET", attempt.recheck.correctness.status.uppercased())
        metric("RE-REVIEW", attempt.recheck.review.status.uppercased())
        metric("FILES", "\(attempt.change.changedFiles.count)")
      }

      Text(attempt.worktree.path)
        .font(.system(size: 8, design: .monospaced))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)

      ForEach(attempt.recheck.findings) { finding in
        HStack(alignment: .top, spacing: 8) {
          Circle().fill(statusColor(finding.status)).frame(width: 7, height: 7).padding(.top, 4)
          VStack(alignment: .leading, spacing: 2) {
            Text("\(finding.findingID) · \(finding.status)")
              .font(.system(size: 8, weight: .bold, design: .monospaced))
            Text(finding.reason).font(.system(size: 8)).foregroundStyle(.secondary)
          }
        }
      }

      if !attempt.change.diffPreview.isEmpty {
        DisclosureGroup("Bounded diff preview · \(attempt.change.diffBytes) bytes") {
          ScrollView(.horizontal) {
            Text(attempt.change.diffPreview)
              .font(.system(size: 8, design: .monospaced))
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(9)
          }
          .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
        }
        .font(.system(size: 9, weight: .semibold))
      }

      ForEach(attempt.limitations, id: \.self) { limitation in
        Label(limitation, systemImage: "info.circle")
          .font(.system(size: 8))
          .foregroundStyle(.secondary)
      }

      if attempt.worktree.retained {
        Divider()
        Toggle(isOn: $model.fixAttemptDiscardConfirmed) {
          Text("Discard this retained unmerged worktree")
            .font(.system(size: 9, weight: .medium))
        }
        .toggleStyle(.checkbox)
        .accessibilityIdentifier("confirm-discard-fix-attempt")
        Button("Discard worktree", systemImage: "trash", role: .destructive) {
          model.discardFixAttempt()
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(!model.canDiscardFixAttempt)
        .accessibilityIdentifier("discard-fix-attempt")
      }
    }
    .padding(11)
    .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 9))
  }

  private func metric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 12, weight: .semibold, design: .rounded)).lineLimit(1)
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 9))
  }

  private func section<Content: View>(
    _ title: String,
    icon: String,
    color: Color,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(spacing: 7) {
        Image(systemName: icon).foregroundStyle(color)
        PremiumFieldLabel(title)
      }
      content()
    }
    .padding(13)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
    .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
  }

  private func severityColor(_ severity: String) -> Color {
    switch severity.lowercased() {
    case "critical", "high": EvidenceStyle.failure
    case "medium": EvidenceStyle.warning
    default: .secondary
    }
  }

  private func statusColor(_ status: String) -> Color {
    switch status.lowercased() {
    case "passed", "satisfied", "completed", "fixed", "verified_fixed", "discarded":
      EvidenceStyle.success
    case "failed", "blocked", "reproduced": EvidenceStyle.failure
    default: EvidenceStyle.warning
    }
  }
}

struct XrayExportView: View {
  @Bindable var model: WorkbenchModel
  let receipt: VerificationReceipt
  @Environment(\.dismiss) private var dismiss

  private var approvableFindings: [VerificationFinding] {
    receipt.reviewFindings.filter { $0.persistedID != nil && $0.suggestion?.isEmpty == false }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        Image(systemName: "eye.trianglebadge.exclamationmark")
          .font(.system(size: 19, weight: .medium))
          .foregroundStyle(EvidenceStyle.amberForeground)
        VStack(alignment: .leading, spacing: 3) {
          Text("Agent PR X-Ray").font(.system(size: 17, weight: .semibold))
          Text("Public-safe evidence export · no model rerun")
            .font(.system(size: 9, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        Spacer()
        if let reviewID = receipt.reviewID {
          Text(reviewID)
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Button("Done") { dismiss() }.buttonStyle(.bordered)
      }
      .padding(.horizontal, 20)
      .frame(height: 68)
      .background(EvidenceStyle.chrome)
      .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }

      HStack(spacing: 0) {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            PremiumFieldLabel("PUBLICATION BOUNDARY")
            Text(
              "The Rust core rebuilds a sanitized packet from persisted evidence and blocks local paths, credentials, private prompts, and raw provider output."
            )
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
              PremiumFieldLabel("PUBLIC SOURCE")
              TextField("owner/repository#123", text: $model.xrayPublicSource)
                .textFieldStyle(.plain)
                .padding(.horizontal, 11)
                .frame(height: 36)
                .premiumField()
                .accessibilityIdentifier("xray-public-source")
            }

            Toggle(
              "I confirm this source and the finding summaries are safe to publish.",
              isOn: $model.xrayPublicConfirmed
            )
            .toggleStyle(.checkbox)
            .font(.system(size: 10))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("xray-public-confirmation")

            VStack(alignment: .leading, spacing: 7) {
              PremiumFieldLabel("EXPORT FORMAT")
              Picker("Export format", selection: $model.xrayFormat) {
                ForEach(XrayFormat.allCases) { format in
                  Text(format.label).tag(format)
                }
              }
              .labelsHidden()
              .pickerStyle(.segmented)
              .tint(.secondary)
            }

            if !approvableFindings.isEmpty {
              VStack(alignment: .leading, spacing: 8) {
                PremiumFieldLabel("OPTIONAL SUGGESTION EXCERPTS")
                Text("Every excerpt needs explicit per-finding approval.")
                  .font(.system(size: 8))
                  .foregroundStyle(.secondary)
                ForEach(approvableFindings) { finding in
                  if let findingID = finding.persistedID {
                    Toggle(
                      finding.title,
                      isOn: Binding(
                        get: { model.xrayApprovedExcerptFindingIDs.contains(findingID) },
                        set: { _ in model.toggleXrayExcerpt(findingID) }
                      )
                    )
                    .toggleStyle(.checkbox)
                    .font(.system(size: 9))
                  }
                }
              }
              .padding(11)
              .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 10))
            }

            HStack(spacing: 8) {
              Button("Build preview", systemImage: "eye") { model.previewXray() }
                .buttonStyle(PremiumPrimaryButtonStyle())
                .disabled(!model.canPreviewXray)
                .accessibilityIdentifier("build-xray-preview")
              Button("Save…", systemImage: "square.and.arrow.down") { chooseDestination() }
                .buttonStyle(.bordered)
                .disabled(!model.canSaveXray)
                .accessibilityIdentifier("save-xray-export")
            }

            if model.xrayLoading {
              ProgressView("Rust is rebuilding the sanitized packet…")
                .controlSize(.small)
                .font(.system(size: 9))
            }
            if let issue = model.xrayIssue {
              Label(issue, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 9))
                .foregroundStyle(EvidenceStyle.failure)
                .fixedSize(horizontal: false, vertical: true)
            }
            if let path = model.xraySavedPath {
              Label("Saved \(path)", systemImage: "checkmark.circle.fill")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(EvidenceStyle.success)
                .textSelection(.enabled)
            }
          }
          .padding(20)
        }
        .frame(width: 310)
        .background(EvidenceStyle.surface)

        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)

        xrayResultDesk
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(EvidenceStyle.canvas)
      }
    }
    .background(EvidenceStyle.canvas)
  }

  @ViewBuilder
  private var xrayResultDesk: some View {
    if let result = model.xrayResult {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          HStack(alignment: .top, spacing: 12) {
            Image(
              systemName: result.eligible
                ? "checkmark.seal.fill" : "lock.trianglebadge.exclamationmark.fill"
            )
            .font(.system(size: 24))
            .foregroundStyle(result.eligible ? EvidenceStyle.success : EvidenceStyle.warning)
            VStack(alignment: .leading, spacing: 4) {
              Text(result.eligible ? "Ready to publish" : "Export blocked")
                .font(.system(size: 16, weight: .semibold))
              Text(
                result.eligible
                  ? "The current packet passed the Rust sanitizer and publication gates."
                  : "Resolve every recorded gate, then build a fresh preview."
              )
              .font(.system(size: 9))
              .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(
              label: result.outcome.replacingOccurrences(of: "_", with: " "),
              color: xrayOutcomeColor(result.outcome)
            )
          }
          .padding(15)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

          HStack(spacing: 8) {
            xrayMetric("FINDINGS", "\(result.findings.count)")
            xrayMetric("STAGES", "\(result.stages.count)")
            xrayMetric("FORMAT", model.xrayFormat.label)
            xrayMetric("SCHEMA", result.payload.value(at: "schema_version")?.displayValue ?? "—")
          }

          if !result.allIssues.isEmpty {
            xraySection("PUBLICATION GATES", icon: "lock.fill", color: EvidenceStyle.warning) {
              ForEach(result.allIssues, id: \.self) { issue in
                Label(issue, systemImage: "exclamationmark.triangle")
                  .font(.system(size: 9))
                  .foregroundStyle(.secondary)
              }
            }
          }

          xraySection(
            "EVIDENCE STAGES", icon: "point.3.connected.trianglepath.dotted",
            color: EvidenceStyle.amber
          ) {
            ForEach(Array(result.stages.enumerated()), id: \.offset) { _, stage in
              HStack(alignment: .top, spacing: 10) {
                Circle()
                  .fill(xrayOutcomeColor(stage.value(at: "status")?.stringValue ?? "incomplete"))
                  .frame(width: 7, height: 7)
                  .padding(.top, 4)
                VStack(alignment: .leading, spacing: 3) {
                  Text(stage.value(at: "label")?.stringValue ?? "Evidence stage")
                    .font(.system(size: 10, weight: .semibold))
                  Text(stage.value(at: "provenance")?.stringValue ?? "No provenance recorded")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.secondary)
                  if let omission = stage.value(at: "omission_reason")?.stringValue {
                    Text(omission).font(.system(size: 8)).foregroundStyle(EvidenceStyle.warning)
                  }
                }
                Spacer()
                Text(
                  (stage.value(at: "status")?.stringValue ?? "incomplete")
                    .replacingOccurrences(of: "_", with: " ")
                )
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .foregroundStyle(xrayOutcomeColor(stage.value(at: "status")?.stringValue ?? ""))
              }
              .padding(9)
              .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
            }
          }

          if !result.findings.isEmpty {
            xraySection("PUBLIC FINDINGS", icon: "scope", color: EvidenceStyle.failure) {
              ForEach(Array(result.findings.prefix(12).enumerated()), id: \.offset) { _, finding in
                VStack(alignment: .leading, spacing: 4) {
                  HStack {
                    Text(finding.value(at: "title")?.stringValue ?? "Finding")
                      .font(.system(size: 10, weight: .semibold))
                    Spacer()
                    Text(finding.value(at: "severity")?.stringValue ?? "unknown")
                      .font(.system(size: 8, weight: .bold, design: .monospaced))
                      .foregroundStyle(EvidenceStyle.failure)
                  }
                  Text(finding.value(at: "summary")?.stringValue ?? "")
                    .font(.system(size: 8))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                }
                .padding(9)
                .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
              }
            }
          }

          Text("Packet \(result.xrayID) · generated entirely from persisted local evidence")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        .padding(18)
      }
    } else {
      ContentUnavailableView {
        Label("Build a public-safe preview", systemImage: "eye")
      } description: {
        Text(
          "Preview first. Saving stays disabled until the exact current packet passes every Rust publication gate."
        )
      }
    }
  }

  private func chooseDestination() {
    let panel = NSSavePanel()
    let type = UTType(filenameExtension: model.xrayFormat.pathExtension) ?? .data
    panel.allowedContentTypes = [type]
    panel.canCreateDirectories = true
    panel.isExtensionHidden = false
    panel.nameFieldStringValue =
      "\(model.xrayResult?.xrayID ?? "agent-pr-xray").\(model.xrayFormat.pathExtension)"
    panel.message = "Save the current Rust-sanitized public evidence packet."
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    model.saveXray(to: destination)
  }

  private func xrayMetric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 12, weight: .semibold, design: .rounded)).lineLimit(1)
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 9))
  }

  private func xraySection<Content: View>(
    _ title: String,
    icon: String,
    color: Color,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(spacing: 7) {
        Image(systemName: icon).foregroundStyle(color)
        PremiumFieldLabel(title)
      }
      content()
    }
    .padding(13)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
    .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
  }

  private func xrayOutcomeColor(_ outcome: String) -> Color {
    switch outcome.lowercased() {
    case "verified", "passed", "complete": EvidenceStyle.success
    case "blocked", "failed": EvidenceStyle.failure
    default: EvidenceStyle.warning
    }
  }
}

struct ReviewProofMapView: View {
  let evidence: PerformanceJSONValue
  let repositoryPath: String?
  let onOpenTesting: (() -> Void)?
  @State private var artifactIssue: String?
  @State private var showsFullProofMap = false
  @State private var showsReadinessDetails = false

  init(
    evidence: PerformanceJSONValue,
    repositoryPath: String? = nil,
    onOpenTesting: (() -> Void)? = nil
  ) {
    self.evidence = evidence
    self.repositoryPath = repositoryPath
    self.onOpenTesting = onOpenTesting
  }

  private var readiness: PerformanceJSONValue? { evidence.value(at: "review_readiness") }
  private var manifest: PerformanceJSONValue? { evidence.value(at: "review_manifest") }
  private var graph: PerformanceJSONValue? { evidence.value(at: "review_memory_graph") }
  private var trustedGraph: PerformanceJSONValue? {
    guard let value = evidence.value(at: "trusted_graph_context") else { return nil }
    if case .null = value { return nil }
    return value
  }
  private var qaRuns: [PerformanceJSONValue] {
    evidence.value(at: "qa_evidence")?.arrayValue ?? []
  }
  private var candidates: [PerformanceJSONValue] {
    evidence.value(at: "evidence_candidates")?.arrayValue ?? []
  }
  private var procedures: [PerformanceJSONValue] {
    evidence.value(at: "evidence_procedure_steps")?.arrayValue ?? []
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        proofLegend
        if let readiness { readinessCard(readiness) }
        DisclosureGroup(isExpanded: $showsFullProofMap) {
          LazyVStack(alignment: .leading, spacing: 12) {
            if let manifest { manifestCard(manifest) }
            if let graph { graphCard(graph) }
            if let trustedGraph { trustedGraphCard(trustedGraph) }
            if !qaRuns.isEmpty { qaCard }
            if !candidates.isEmpty { candidateCard }
            if !procedures.isEmpty { procedureCard }
          }
          .padding(.top, 12)
        } label: {
          VStack(alignment: .leading, spacing: 3) {
            Text("Full proof map").font(.system(size: 11, weight: .semibold))
            Text("Manifest, graph context, QA evidence, leads, and procedure")
              .font(.system(size: 9)).foregroundStyle(.secondary)
          }
        }
        .tint(EvidenceStyle.amberForeground)
        .padding(14)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
        if readiness == nil && manifest == nil && graph == nil && trustedGraph == nil
          && qaRuns.isEmpty
          && candidates.isEmpty && procedures.isEmpty
        {
          emptyCard
        }
      }
      .padding(14)
    }
    .background(EvidenceStyle.canvas)
    .accessibilityIdentifier("review.proof-map")
  }

  private var proofLegend: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "point.3.connected.trianglepath.dotted")
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(EvidenceStyle.amberForeground)
        .frame(width: 24)
      VStack(alignment: .leading, spacing: 4) {
        Text("Evidence before interpretation")
          .font(.system(size: 12, weight: .semibold))
        Text(
          "Recorded execution is proof. Graph neighborhoods and candidate leads are bounded context, never ground truth."
        )
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      }
      Spacer()
      Label("Rust-owned", systemImage: "checkmark.seal.fill")
        .font(.system(size: 9, weight: .semibold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.success)
    }
    .padding(14)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func readinessCard(_ value: PerformanceJSONValue) -> some View {
    let status = text(value, "status") ?? "unavailable"
    let limitations = strings(value, "limitations")
    return proofSection("REVIEW READINESS", icon: "checkmark.shield", color: statusColor(status)) {
      HStack(spacing: 8) {
        proofMetric("STATUS", normalized(status))
        proofMetric("COVERAGE", yesNo(value.value(at: "complete_coverage")?.boolValue))
      }
      DisclosureGroup("Readiness details", isExpanded: $showsReadinessDetails) {
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            proofMetric("RUNTIME", text(value, "runtime_evidence_count") ?? "0")
            proofMetric("MCP CALLS", text(value, "codevetter_mcp_call_count") ?? "0")
          }
          LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            proofFact("Graph", normalized(text(value, "graph_status") ?? "unavailable"))
            proofFact("History", normalized(text(value, "history_status") ?? "empty"))
            proofFact("Conventions", normalized(text(value, "conventions_status") ?? "not present"))
            proofFact("Coordinator", normalized(text(value, "coordinator_status") ?? "not run"))
            proofFact("Context delivery", normalized(text(value, "context_delivery") ?? "internal"))
            proofFact("History chars", text(value, "history_chars") ?? "0")
          }
          ForEach(limitations.prefix(4), id: \.self) { limitation in
            limitationRow(limitation)
          }
        }
        .padding(.top, 8)
      }
      .font(.system(size: 9, weight: .semibold))
      .tint(EvidenceStyle.amberForeground)
    }
  }

  private func manifestCard(_ value: PerformanceJSONValue) -> some View {
    let units = value.value(at: "units")?.arrayValue ?? []
    let target = value.value(at: "target")
    let complete = value.value(at: "complete_coverage")?.boolValue ?? false
    let stale = value.value(at: "stale")?.boolValue ?? false
    let cancelled = value.value(at: "cancelled")?.boolValue ?? false
    return proofSection(
      "DETERMINISTIC MANIFEST", icon: "doc.badge.gearshape",
      color: complete && !stale && !cancelled ? EvidenceStyle.success : EvidenceStyle.warning
    ) {
      HStack(spacing: 8) {
        proofMetric("UNITS", "\(units.count)")
        proofMetric("COMPLETE", yesNo(complete))
        proofMetric("STALE", yesNo(stale))
        proofMetric("CANCELLED", yesNo(cancelled))
      }
      HStack(spacing: 18) {
        proofIdentity("RUN", text(value, "run_id") ?? "—")
        proofIdentity("REVIEW", text(value, "review_id") ?? "not persisted")
        proofIdentity("EXECUTOR", text(value, "executor_id") ?? "—")
      }
      if let counts = value.value(at: "qualification_counts") {
        HStack(spacing: 8) {
          proofMetric("QUALIFIED", text(counts, "qualified") ?? "0")
          proofMetric("STALE", text(counts, "stale") ?? "0")
          proofMetric("UNRESOLVED", text(counts, "unresolved") ?? "0")
          proofMetric("REJECTED", text(counts, "rejected") ?? "0")
        }
      }
      if let target {
        Text(
          [
            text(target, "diff_mode"), text(target, "requested_range"),
            text(target, "head_sha").map { String($0.prefix(12)) },
          ]
          .compactMap { $0 }.joined(separator: "  ·  ")
        )
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(EvidenceStyle.amberForeground)
        .lineLimit(1)
      }
      ForEach(Array(units.prefix(10).enumerated()), id: \.offset) { _, unit in
        HStack(spacing: 9) {
          Circle()
            .fill(coverageColor(text(unit, "coverage_state") ?? "failed"))
            .frame(width: 6, height: 6)
          Text(text(unit, "file_path") ?? "Unknown file")
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .lineLimit(1)
          Spacer()
          Text(text(unit, "file_status") ?? "—")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
          Text(formatBytes(unit.value(at: "diff_bytes")?.numberValue))
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
          Text(normalized(text(unit, "coverage_state") ?? "unknown"))
            .font(.system(size: 8, weight: .semibold, design: .monospaced))
            .foregroundStyle(coverageColor(text(unit, "coverage_state") ?? "failed"))
        }
        .padding(.vertical, 3)
      }
      if units.count > 10 {
        Text("+ \(units.count - 10) more manifest units in canonical JSON")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
    }
  }

  private func trustedGraphCard(_ value: PerformanceJSONValue) -> some View {
    let nodes = value.value(at: "nodes")?.arrayValue ?? []
    let edges = value.value(at: "edges")?.arrayValue ?? []
    let stale = value.value(at: "stale")?.boolValue ?? true
    return proofSection(
      "TRUSTED STRUCTURAL GRAPH", icon: "seal.fill",
      color: stale ? EvidenceStyle.warning : EvidenceStyle.success
    ) {
      HStack(spacing: 8) {
        proofMetric("QUALIFICATION", normalized(text(value, "qualification") ?? "unavailable"))
        proofMetric("NODES", "\(nodes.count)")
        proofMetric("EDGES", "\(edges.count)")
        proofMetric("STALE", yesNo(stale))
      }
      HStack(spacing: 16) {
        proofIdentity("ENGINE", text(value, "engine_id") ?? "—")
        proofIdentity(
          "INDEXED HEAD", text(value, "indexed_head").map { String($0.prefix(12)) } ?? "—")
        proofIdentity(
          "CURRENT HEAD", text(value, "current_head").map { String($0.prefix(12)) } ?? "—")
      }
      Text("Graph edges are accepted only under the recorded qualification and revision identity.")
        .font(.system(size: 8))
        .foregroundStyle(.secondary)
    }
  }

  private func graphCard(_ value: PerformanceJSONValue) -> some View {
    let nodes = value.value(at: "nodes")?.arrayValue ?? []
    let edges = value.value(at: "edges")?.arrayValue ?? []
    let trustedPaths = value.value(at: "trusted_paths")?.arrayValue ?? []
    let contextNodes = nodes.filter { text($0, "kind") != "file" }
    return proofSection(
      "REVIEW MEMORY GRAPH", icon: "point.3.filled.connected.trianglepath.dotted",
      color: EvidenceStyle.amber
    ) {
      HStack(spacing: 8) {
        proofMetric("NODES", "\(nodes.count)")
        proofMetric("EDGES", "\(edges.count)")
        proofMetric("TRUSTED PATHS", "\(trustedPaths.count)")
        proofMetric("TRUNCATED", yesNo(value.value(at: "truncated")?.boolValue))
      }
      Text("Context neighborhood · not proof")
        .font(.system(size: 8, weight: .bold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.warning)
      ForEach(Array(contextNodes.prefix(8).enumerated()), id: \.offset) { _, node in
        HStack(alignment: .top, spacing: 9) {
          Image(systemName: graphIcon(text(node, "kind") ?? "context"))
            .foregroundStyle(EvidenceStyle.amberForeground)
            .frame(width: 15)
          VStack(alignment: .leading, spacing: 2) {
            Text(text(node, "label") ?? text(node, "id") ?? "Context node")
              .font(.system(size: 9, weight: .semibold))
            if let detail = text(node, "detail") {
              Text(detail).font(.system(size: 8)).foregroundStyle(.secondary)
            }
            if let path = text(node, "file_path") {
              Text(path).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
            }
          }
          Spacer()
          Text(normalized(text(node, "kind") ?? "context"))
            .font(.system(size: 7, weight: .bold, design: .monospaced))
            .foregroundStyle(.secondary)
        }
        .padding(9)
        .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
      }
    }
  }

  private var qaCard: some View {
    proofSection(
      "RECORDED QA EVIDENCE", icon: "play.rectangle.on.rectangle", color: EvidenceStyle.success
    ) {
      if let onOpenTesting {
        HStack {
          Text("Review reads evidence; Testing owns browser execution and confirmation.")
            .font(.system(size: 8))
            .foregroundStyle(.secondary)
          Spacer()
          Button("Open Testing", systemImage: "arrow.right") {
            onOpenTesting()
          }
          .buttonStyle(.borderless)
          .controlSize(.mini)
          .accessibilityIdentifier("review.qa.open-testing")
        }
      }
      ForEach(Array(qaRuns.prefix(5).enumerated()), id: \.offset) { _, run in
        let passed = run.value(at: "pass")?.boolValue ?? false
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            StatusPill(
              label: passed ? "passed" : "failed",
              color: passed ? EvidenceStyle.success : EvidenceStyle.failure)
            Text(text(run, "runner_type") ?? "recorded runner")
              .font(.system(size: 8, weight: .semibold, design: .monospaced))
              .foregroundStyle(.secondary)
            Spacer()
            Text(duration(run.value(at: "duration_ms")?.numberValue))
              .font(.system(size: 8, design: .monospaced))
              .foregroundStyle(.secondary)
          }
          Text(text(run, "goal") ?? "Recorded synthetic journey")
            .font(.system(size: 10, weight: .semibold))
          HStack(spacing: 12) {
            proofIdentity("ROUTE", text(run, "route") ?? "—")
            proofIdentity("CONSOLE", text(run, "console_errors") ?? "0 errors")
            proofIdentity("ARTIFACTS", "\(run.value(at: "artifacts")?.arrayValue?.count ?? 0)")
          }
          let artifacts = artifactPaths(run)
          if !artifacts.isEmpty {
            HStack(spacing: 7) {
              ForEach(Array(artifacts.prefix(3).enumerated()), id: \.offset) { index, artifact in
                Button {
                  revealArtifact(artifact)
                } label: {
                  Label(artifactLabel(artifact), systemImage: "folder")
                }
                .buttonStyle(.borderless)
                .controlSize(.mini)
                .help(artifact)
                .accessibilityIdentifier("review.qa-artifact.\(index)")
              }
            }
          }
        }
        .padding(10)
        .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 9))
      }
      if let artifactIssue {
        Label(artifactIssue, systemImage: "info.circle")
          .font(.system(size: 8))
          .foregroundStyle(.secondary)
      }
    }
  }

  private var candidateCard: some View {
    proofSection("EVIDENCE LEADS", icon: "scope", color: EvidenceStyle.warning) {
      Text("Ranked context candidates · investigate before treating as proof")
        .font(.system(size: 8, weight: .bold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.warning)
      ForEach(Array(candidates.prefix(6).enumerated()), id: \.offset) { _, candidate in
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            StatusPill(
              label: text(candidate, "severity_hint") ?? "lead",
              color: severityColor(text(candidate, "severity_hint") ?? "")
            )
            Text(normalized(text(candidate, "kind") ?? "candidate"))
              .font(.system(size: 9, weight: .semibold))
            Spacer()
            Text(confidence(candidate.value(at: "confidence")?.numberValue))
              .font(.system(size: 8, design: .monospaced))
              .foregroundStyle(.secondary)
          }
          Text(text(candidate, "why_it_matters") ?? "No rationale recorded.")
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
          let paths = strings(candidate, "affected_files")
          if !paths.isEmpty {
            Text(paths.prefix(3).joined(separator: "  ·  "))
              .font(.system(size: 8, design: .monospaced))
              .foregroundStyle(EvidenceStyle.amberForeground)
              .lineLimit(1)
          }
          let checks = strings(candidate, "suggested_checks")
          if let check = checks.first {
            Label(check, systemImage: "checklist")
              .font(.system(size: 8))
              .foregroundStyle(.secondary)
          }
        }
        .padding(10)
        .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 9))
      }
    }
  }

  private var procedureCard: some View {
    proofSection("EVIDENCE PROCEDURE", icon: "list.number", color: EvidenceStyle.amber) {
      ForEach(Array(procedures.prefix(8).enumerated()), id: \.offset) { index, step in
        HStack(alignment: .top, spacing: 10) {
          Text(String(format: "%02d", index + 1))
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(EvidenceStyle.amberForeground)
            .frame(width: 22)
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Text(normalized(text(step, "procedure") ?? text(step, "id") ?? "procedure"))
                .font(.system(size: 10, weight: .semibold))
              Spacer()
              Text(normalized(text(step, "status") ?? "planned"))
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .foregroundStyle(statusColor(text(step, "status") ?? "planned"))
            }
            if let action = text(step, "action") {
              Text(action).font(.system(size: 9)).foregroundStyle(.secondary)
            }
            if let output = text(step, "output") {
              Text("OUTPUT · \(output)")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.secondary)
            }
            if let artifact = text(step, "artifact"), !artifact.isEmpty {
              Text("ARTIFACT · \(artifact)")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(EvidenceStyle.amberForeground)
            }
            if let gate = text(step, "gate") {
              Label(gate, systemImage: "shield.lefthalf.filled")
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
            }
          }
        }
        .padding(10)
        .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 9))
      }
    }
  }

  private var emptyCard: some View {
    VStack(spacing: 8) {
      Image(systemName: "questionmark.diamond")
        .font(.system(size: 20, weight: .light))
        .foregroundStyle(.secondary)
      Text("No deterministic proof map was recorded")
        .font(.system(size: 11, weight: .semibold))
      Text("The canonical JSON remains available; this receipt predates proof-map evidence.")
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
    }
    .padding(24)
    .frame(maxWidth: .infinity)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
  }

  private func proofSection<Content: View>(
    _ title: String,
    icon: String,
    color: Color,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 11) {
      HStack(spacing: 8) {
        Image(systemName: icon).foregroundStyle(color)
        PremiumFieldLabel(title)
        Spacer()
      }
      content()
    }
    .padding(14)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func proofMetric(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 12, weight: .semibold, design: .rounded))
        .lineLimit(1)
    }
    .padding(9)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
  }

  private func proofFact(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label).font(.system(size: 8, weight: .medium)).foregroundStyle(.secondary)
      Spacer()
      Text(value).font(.system(size: 8, weight: .semibold, design: .monospaced))
    }
    .padding(8)
    .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 8))
  }

  private func proofIdentity(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 8, weight: .medium, design: .monospaced))
        .lineLimit(1)
    }
  }

  private func limitationRow(_ value: String) -> some View {
    Label(value, systemImage: "exclamationmark.triangle")
      .font(.system(size: 8))
      .foregroundStyle(.secondary)
  }

  private func text(_ value: PerformanceJSONValue, _ key: String) -> String? {
    guard let child = value.value(at: key) else { return nil }
    switch child {
    case .null, .object, .array: return nil
    default: return child.displayValue
    }
  }

  private func strings(_ value: PerformanceJSONValue, _ key: String) -> [String] {
    value.value(at: key)?.arrayValue?.compactMap(\.stringValue) ?? []
  }

  private func normalized(_ value: String) -> String {
    value.replacingOccurrences(of: "_", with: " ")
  }

  private func yesNo(_ value: Bool?) -> String {
    guard let value else { return "—" }
    return value ? "Yes" : "No"
  }

  private func confidence(_ value: Double?) -> String {
    guard let value else { return "—" }
    return String(format: "%.0f%% confidence", value * 100)
  }

  private func duration(_ value: Double?) -> String {
    guard let value else { return "—" }
    return value >= 1_000 ? String(format: "%.1fs", value / 1_000) : "\(Int(value))ms"
  }

  private func artifactPaths(_ run: PerformanceJSONValue) -> [String] {
    var paths = strings(run, "artifacts")
    if let screenshot = text(run, "screenshot_path"), !screenshot.isEmpty,
      !paths.contains(screenshot)
    {
      paths.insert(screenshot, at: 0)
    }
    return paths
  }

  private func artifactLabel(_ path: String) -> String {
    let filename = URL(fileURLWithPath: path).lastPathComponent
    return filename.isEmpty ? "Reveal artifact" : filename
  }

  private func revealArtifact(_ path: String) {
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, !trimmed.contains("\0") else {
      artifactIssue = "The recorded artifact path is invalid."
      return
    }
    let raw = NSString(string: trimmed)
    let target: URL
    if raw.isAbsolutePath {
      target = URL(fileURLWithPath: trimmed).standardizedFileURL
    } else {
      guard let repositoryPath,
        !raw.pathComponents.contains(".."), !raw.pathComponents.contains(".")
      else {
        artifactIssue = "The relative artifact path is not repository-contained."
        return
      }
      let root = URL(fileURLWithPath: repositoryPath, isDirectory: true).standardizedFileURL
      target = root.appending(path: trimmed).standardizedFileURL
      let rootPrefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
      guard target.path.hasPrefix(rootPrefix) else {
        artifactIssue = "The relative artifact path escaped the repository."
        return
      }
    }
    guard FileManager.default.fileExists(atPath: target.path) else {
      artifactIssue = "The recorded artifact is no longer available."
      return
    }
    NSWorkspace.shared.activateFileViewerSelecting([target])
    artifactIssue = "Revealed the recorded artifact in Finder."
  }

  private func formatBytes(_ value: Double?) -> String {
    guard let value else { return "—" }
    return ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
  }

  private func statusColor(_ status: String) -> Color {
    switch status.lowercased() {
    case "ready", "completed", "satisfied", "reviewed", "reused", "passed":
      EvidenceStyle.success
    case "failed", "cancelled", "blocked", "incomplete": EvidenceStyle.failure
    default: EvidenceStyle.warning
    }
  }

  private func coverageColor(_ state: String) -> Color {
    switch state.lowercased() {
    case "reviewed", "reused": EvidenceStyle.success
    case "skipped": EvidenceStyle.warning
    default: EvidenceStyle.failure
    }
  }

  private func severityColor(_ severity: String) -> Color {
    switch severity.lowercased() {
    case "critical", "high": EvidenceStyle.failure
    case "medium": EvidenceStyle.warning
    default: .secondary
    }
  }

  private func graphIcon(_ kind: String) -> String {
    switch kind {
    case "blast_radius": "scope"
    case "history_context": "clock.arrow.circlepath"
    case "evidence_candidate": "sparkle.magnifyingglass"
    case "procedure_gate": "checklist"
    default: "point.3.connected.trianglepath.dotted"
    }
  }
}

private struct SpecCoverageEvidenceCard: View {
  let coverage: VerificationSpecCoverage
  @State private var showsDetails = false

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("ACCEPTANCE COVERAGE")
          Text("Explicit requirements, never inferred")
            .font(.system(size: 12, weight: .semibold))
        }
        Spacer()
        Text(String(coverage.headSHA.prefix(12)))
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      HStack(spacing: 8) {
        coverageMetric(
          "EXECUTABLE", coverage.summary.executableEvidenceCoveragePercent,
          "\(coverage.summary.selectedForExecution)/\(coverage.summary.totalRequirements)")
        coverageMetric(
          "VERIFIED", coverage.summary.verifiedCoveragePercent,
          "\(coverage.summary.verified)/\(coverage.summary.totalRequirements)")
      }
      DisclosureGroup("Requirement details", isExpanded: $showsDetails) {
        VStack(alignment: .leading, spacing: 9) {
          coverageMetric(
            "REVIEW INPUT", coverage.summary.reviewInputCoveragePercent,
            "\(coverage.summary.reviewInputRequirements)/\(coverage.summary.totalRequirements)")
          ForEach(coverage.requirements) { requirement in
            HStack(alignment: .top, spacing: 10) {
              Image(systemName: statusIcon(requirement.status))
                .foregroundStyle(statusColor(requirement.status))
                .frame(width: 16)
              VStack(alignment: .leading, spacing: 4) {
                HStack {
                  Text(requirement.title).font(.system(size: 10, weight: .semibold))
                  Spacer()
                  Text(requirement.status.replacingOccurrences(of: "_", with: " "))
                    .font(.system(size: 8, weight: .semibold, design: .monospaced))
                    .foregroundStyle(statusColor(requirement.status))
                }
                Text("\(requirement.id) · \(requirement.sourcePath):\(requirement.startLine)")
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(.secondary)
                if let evidence = requirement.evidence {
                  Text(
                    [evidence.stage, evidence.adapter, evidence.target]
                      .compactMap { $0 }.joined(separator: " · ")
                  )
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(EvidenceStyle.amberForeground)
                }
              }
            }
            .padding(10)
            .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
          }
          ForEach(coverage.limitations, id: \.self) { limitation in
            Label(limitation, systemImage: "exclamationmark.triangle")
              .font(.system(size: 9))
              .foregroundStyle(.secondary)
          }
        }
        .padding(.top, 8)
      }
      .font(.system(size: 9, weight: .semibold))
      .tint(EvidenceStyle.amberForeground)
    }
    .padding(14)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func coverageMetric(_ label: String, _ percent: Int?, _ count: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(percent.map { "\($0)%" } ?? "—")
        .font(.system(size: 16, weight: .semibold, design: .rounded))
      Text(count).font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary)
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.canvas, in: RoundedRectangle(cornerRadius: 9))
  }

  private func statusColor(_ status: String) -> Color {
    switch status {
    case "verified": EvidenceStyle.success
    case "contradicted": EvidenceStyle.failure
    case "review_only": EvidenceStyle.warning
    default: .secondary
    }
  }

  private func statusIcon(_ status: String) -> String {
    switch status {
    case "verified": "checkmark.seal.fill"
    case "contradicted": "xmark.octagon.fill"
    case "review_only": "eye.fill"
    default: "questionmark.circle"
    }
  }
}

struct PremiumPrimaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 12, weight: .bold))
      .foregroundStyle(isEnabled ? EvidenceStyle.amberForeground : Color.secondary)
      .padding(.horizontal, 18)
      .frame(minHeight: 40)
      .contentShape(Rectangle())
      .background(
        isEnabled
          ? EvidenceStyle.amber.opacity(configuration.isPressed ? 0.12 : 0.035)
          : EvidenceStyle.surface,
        in: RoundedRectangle(cornerRadius: 6)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 6)
          .stroke(
            isEnabled ? EvidenceStyle.amberForeground.opacity(0.65) : EvidenceStyle.separator)
      }
      .opacity(isEnabled ? 1 : 0.72)
  }
}

extension View {
  func premiumField() -> some View {
    background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 6))
      .overlay { RoundedRectangle(cornerRadius: 6).stroke(EvidenceStyle.separator) }
  }
}
