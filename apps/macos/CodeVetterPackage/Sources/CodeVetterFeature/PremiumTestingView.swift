import SwiftUI
import UniformTypeIdentifiers

private enum TestingDetailMode: String, CaseIterable, Identifiable {
  case evidence = "Evidence"
  case json = "JSON"

  var id: String { rawValue }
}

struct PremiumTestingView: View {
  @Bindable var model: WorkbenchModel
  @State private var detailMode: TestingDetailMode = .evidence
  @State private var showAdvancedSetup = false
  @State private var showReceiptDetails = false

  var body: some View {
    VStack(spacing: 0) {
      PremiumPageHeader(
        eyebrow: "Runtime evidence",
        title: "Testing",
        subtitle: "Exercise the exact changed experience and preserve routes, journeys, and limits"
      ) {
        StatusPill(label: model.testingState.rawValue, color: testingStatusColor)
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      Group {
        if let receipt = model.testingReceipt {
          receiptDesk(receipt)
        } else {
          testingSetup
        }
      }
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
    .sheet(isPresented: $model.showingWarmVerifier) {
      PremiumWarmVerificationView(model: model)
        .frame(minWidth: 980, minHeight: 680)
    }
    .sheet(isPresented: $model.showingDifferentialVerifier) {
      PremiumDifferentialVerificationView(model: model)
        .frame(minWidth: 980, minHeight: 680)
    }
    .sheet(isPresented: $model.showingScenarioCompiler) {
      PremiumScenarioCompilerView(model: model)
        .frame(minWidth: 1_020, minHeight: 700)
    }
    .sheet(isPresented: $model.showingTrexWatcher) {
      PremiumTrexWatcherView(model: model)
        .frame(minWidth: 1_080, minHeight: 720)
    }
    .sheet(isPresented: $model.showingQaWorkspace) {
      QaJourneyWorkspaceView(model: model)
        .frame(minWidth: 1_080, minHeight: 720)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("testing-workspace")
  }

  private var testingSetup: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          VStack(alignment: .leading, spacing: 5) {
            Text("Prove one changed experience")
              .font(.system(size: 18, weight: .semibold))
            Text("Choose the source and preview. CodeVetter resolves the rest before execution.")
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
          }

          PremiumFieldLabel("SOURCE")
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
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 15)
            .frame(height: 48)
            .premiumField()
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Choose testing repository")

          HStack(alignment: .bottom, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
              PremiumFieldLabel("CHANGE TYPE")
              Picker("Change identity", selection: $model.testingChangeKind) {
                Text("Git range").tag(TrexChangeKind.range)
                Text("GitHub pull request").tag(TrexChangeKind.pullRequest)
              }
              .pickerStyle(.segmented)
              .labelsHidden()
              .tint(.secondary)
              .frame(height: 48)
            }
            .fixedSize(horizontal: true, vertical: false)

            PremiumInput(
              label: model.testingChangeKind == .range ? "EXACT RANGE" : "PULL REQUEST",
              icon: "arrow.triangle.branch",
              placeholder: changePlaceholder,
              text: $model.testingChange
            )
          }

          PremiumInput(
            label: "DEPLOYED PREVIEW",
            icon: "safari",
            placeholder: "https://preview.example.com",
            text: $model.testingPreviewURL
          )

          Toggle(isOn: $model.testingConfirmed) {
            VStack(alignment: .leading, spacing: 4) {
              Text("Allow this bounded preview verification")
                .font(.system(size: 12, weight: .semibold))
              Text(
                "CodeVetter will contact the selected HTTP(S) preview and may run read-only browser journeys against derived routes."
              )
              .font(.system(size: 10))
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
            }
          }
          .toggleStyle(.checkbox)
          .tint(EvidenceStyle.amber)
          .accessibilityLabel("Allow this bounded preview verification")
          .accessibilityHint(
            "Contacts the selected HTTP or HTTPS preview and runs read-only browser journeys."
          )
          .padding(15)
          .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

          testingContractSummary

          DisclosureGroup(isExpanded: $showAdvancedSetup) {
            VStack(alignment: .leading, spacing: 16) {
              PremiumScopePlanner(
                title: "Changed-scope planner",
                subtitle:
                  "Resolve this change, one user flow, or a bounded codebase portfolio into Rust-owned runnable targets before browser execution.",
                kind: $model.testingScopeKind,
                value: testingScopeValue,
                plan: model.testingScopePlan,
                loading: model.testingScopeLoading,
                issue: model.testingScopeIssue ?? model.testingScopeInputIssue,
                canResolve: model.canResolveTestingScope,
                selectedCandidateID: model.selectedTestingScopeCandidateID,
                compact: false,
                accessibilityID: "testing-scope-planner",
                onResolve: model.resolveTestingScope,
                onSelect: model.selectTestingScopeCandidate
              )

              Button {
                model.openQaWorkspace()
              } label: {
                HStack(spacing: 12) {
                  Image(systemName: "point.3.connected.trianglepath.dotted")
                    .foregroundStyle(EvidenceStyle.amberForeground)
                    .frame(width: 24)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(
                      model.testingQaWorkflowName.isEmpty
                        ? "Journey setup" : model.testingQaWorkflowName
                    )
                    .font(.system(size: 12, weight: .semibold))
                    Text(
                      model.testingTargetRoute.isEmpty
                        ? "Saved targets, repository Playwright specs, and post-fix rerun setup"
                        : "\(model.testingTargetRoute) · \(model.testingTargetGoal)"
                    )
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                  }
                  Spacer()
                  Text("Configure").font(.system(size: 10, weight: .semibold))
                  Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                }
                .padding(13)
                .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
              }
              .buttonStyle(.plain)
              .disabled(model.repositoryPath.isEmpty)
              .accessibilityLabel("Configure saved QA journeys")

              TestingCapabilityStrip()
            }
            .padding(.top, 14)
          } label: {
            VStack(alignment: .leading, spacing: 3) {
              Text("Advanced testing setup").font(.system(size: 12, weight: .semibold))
              Text("Scope planning, saved journeys, and capability inventory")
                .font(.system(size: 10)).foregroundStyle(.secondary)
            }
          }
          .tint(EvidenceStyle.amberForeground)
          .accessibilityIdentifier("advanced-testing-setup")
          .padding(15)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

          if model.testingState == .failed || model.testingState == .cancelled {
            Label(
              model.testingStatusMessage,
              systemImage: model.testingState == .cancelled ? "stop.circle" : "xmark.octagon.fill"
            )
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(
              model.testingState == .cancelled ? Color.secondary : EvidenceStyle.failure
            )
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
              (model.testingState == .cancelled ? Color.secondary : EvidenceStyle.failure).opacity(
                0.08),
              in: RoundedRectangle(cornerRadius: 12)
            )
          }

        }
        .padding(PremiumPageLayout.horizontalInset)
        .frame(maxWidth: 760, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .top)
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      testingActionBar
    }
  }

  private var testingContractSummary: some View {
    HStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        PremiumFieldLabel("RUST EXECUTION CONTRACT")
        Text("Resolve → execute → persist")
          .font(.system(size: 12, weight: .semibold))
      }
      Spacer()
      Label("codevetter trex", systemImage: "checkmark.seal.fill")
        .font(.system(size: 10, weight: .semibold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.success)
    }
    .padding(15)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private var testingScopeValue: Binding<String> {
    Binding(
      get: {
        model.testingScopeKind == .change ? model.testingChange : model.testingScopeValue
      },
      set: { value in
        if model.testingScopeKind == .change {
          model.testingChange = value
        } else {
          model.testingScopeValue = value
        }
      }
    )
  }

  private var testingActionBar: some View {
    HStack(spacing: 12) {
      if model.testingState == .running {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(model.testingStatusMessage)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
          .lineLimit(2)
        if !model.canStartTesting, model.testingState != .running,
          let issue = model.testingInputIssue
        {
          Text(issue)
            .font(.system(size: 9))
            .foregroundStyle(.tertiary)
            .lineLimit(2)
        }
      }
      Spacer()
      Menu {
        Button("Warm changed proof") { model.showingWarmVerifier = true }
        Button("Differential") { model.showingDifferentialVerifier = true }
        Button("Scenarios") { model.showingScenarioCompiler = true }
        Divider()
        Button("PR watcher") { model.showingTrexWatcher = true }
      } label: {
        Label("Testing tools", systemImage: "ellipsis.circle")
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
      .disabled(model.repositoryPath.isEmpty || model.testingState == .running)
      if model.testingState == .running {
        Button("Cancel", role: .destructive) { model.cancelTesting() }
          .buttonStyle(.bordered)
      } else {
        Button("Run preview proof") { model.runTesting() }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .disabled(!model.canStartTesting)
          .keyboardShortcut(.return, modifiers: [.command])
      }
    }
    .padding(.horizontal, 22)
    .frame(minHeight: 68)
    .background(EvidenceStyle.chrome)
  }

  private func receiptDesk(_ receipt: TrexPreviewReceipt) -> some View {
    VStack(spacing: 0) {
      HStack(spacing: 16) {
        VStack(alignment: .leading, spacing: 4) {
          Text("T-REX PREVIEW RECEIPT")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1.1)
            .foregroundStyle(EvidenceStyle.amberForeground)
          Text(receipt.summary)
            .font(.system(size: 18, weight: .semibold))
            .lineLimit(1)
          Text(
            "\(receipt.source.input)  ·  \(receipt.routes.count) routes  ·  \(receipt.journeys.count) journeys"
          )
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
        }
        Spacer()
        StatusPill(label: verdictLabel(receipt.verdict), color: verdictColor(receipt.verdict))
        Button(
          showReceiptDetails ? "Hide details" : "Details",
          systemImage: "sidebar.trailing"
        ) {
          showReceiptDetails.toggle()
        }
        .buttonStyle(.bordered)
        Button("Open in Runs") {
          model.section = .runs
          model.loadRuns()
        }
        .buttonStyle(.bordered)
        Button("New test") { model.resetTesting() }
          .buttonStyle(.bordered)
      }
      .padding(.horizontal, 22)
      .frame(height: 82)
      .background(EvidenceStyle.chrome)
      .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }

      HStack(spacing: 0) {
        if showReceiptDetails {
          TestingSourceIndex(receipt: receipt).frame(width: 230)
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        }
        VStack(spacing: 0) {
          HStack {
            Text("EXECUTABLE PROOF")
              .font(.system(size: 9, weight: .bold, design: .monospaced))
              .tracking(0.9)
            Spacer()
            Picker("Detail", selection: $detailMode) {
              ForEach(TestingDetailMode.allCases) { mode in
                Text(mode.rawValue).tag(mode)
              }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .tint(.secondary)
          }
          .padding(.horizontal, 16)
          .frame(height: 48)
          .background(EvidenceStyle.surface)
          .overlay(alignment: .bottom) {
            Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
          }

          if detailMode == .evidence {
            TestingEvidenceView(receipt: receipt)
          } else {
            ScrollView([.horizontal, .vertical]) {
              Text(model.testingReceiptJSON)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        if showReceiptDetails {
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
          TestingReceiptInspector(receipt: receipt).frame(width: 290)
        }
      }
    }
  }

  private var repositoryLabel: String {
    guard !model.repositoryPath.isEmpty else { return "No repository selected" }
    return URL(fileURLWithPath: model.repositoryPath).lastPathComponent
  }

  private var changePlaceholder: String {
    switch model.testingChangeKind {
    case .range: "main…HEAD"
    case .pullRequest: "https://github.com/owner/repo/pull/42"
    }
  }

  private var testingStatusColor: Color {
    switch model.testingState {
    case .running: EvidenceStyle.amber
    case .completed, .planned: EvidenceStyle.success
    case .limited: EvidenceStyle.warning
    case .failed: EvidenceStyle.failure
    case .ready, .planning, .cancelled: .secondary
    }
  }
}

private struct TestingCapabilityStrip: View {
  private let capabilities = [
    ("Direct preview", "Available now", true),
    ("Changed scope", "Available now", true),
    ("Scenarios", "Available now", true),
    ("PR watchers", "Available now", true),
    ("Warm verify", "Available now", true),
    ("Differential", "Available now", true),
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        PremiumFieldLabel("TESTING COVERAGE")
        Spacer()
        Text("No hidden parity claims")
          .font(.system(size: 9, weight: .medium))
          .foregroundStyle(.secondary)
      }
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
        ForEach(capabilities, id: \.0) { capability in
          HStack(spacing: 8) {
            Circle()
              .fill(capability.2 ? EvidenceStyle.success : Color.secondary.opacity(0.45))
              .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 2) {
              Text(capability.0).font(.system(size: 10, weight: .semibold))
              Text(capability.1).font(.system(size: 8)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
          }
          .padding(10)
          .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 10))
          .overlay { RoundedRectangle(cornerRadius: 10).stroke(EvidenceStyle.separator) }
        }
      }
    }
  }
}

private struct TestingExecutionContract: View {
  let model: WorkbenchModel

  private let steps = [
    ("Resolve exact source", "PR or Git range becomes immutable SHAs"),
    ("Prove preview identity", "Revision header is verified, claimed, or mismatched"),
    ("Derive affected routes", "Changed paths select bounded browser scope"),
    ("Run browser journeys", "Read-only executable evidence and artifacts"),
    ("Persist the receipt", "Verdict and limitations remain inseparable"),
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      PremiumFieldLabel("RUST EXECUTION CONTRACT").padding(.bottom, 24)
      ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
        HStack(alignment: .top, spacing: 12) {
          VStack(spacing: 0) {
            ZStack {
              Circle().fill(stepColor(index).opacity(index == activeIndex ? 1 : 0.12))
              Text(String(format: "%02d", index + 1))
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .foregroundStyle(index == activeIndex ? EvidenceStyle.ink : .secondary)
            }
            .frame(width: 28, height: 28)
            if index < steps.count - 1 {
              Rectangle().fill(EvidenceStyle.separator).frame(width: 1, height: 48)
            }
          }
          VStack(alignment: .leading, spacing: 4) {
            Text(step.0).font(.system(size: 11, weight: .semibold))
            Text(step.1)
              .font(.system(size: 9))
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(.top, 2)
        }
      }
      Spacer()
      Divider()
      VStack(alignment: .leading, spacing: 9) {
        PremiumFieldLabel("CURRENT AUTHORITY")
        Label("codevetter trex", systemImage: "checkmark.seal.fill")
          .font(.system(size: 10, weight: .semibold, design: .monospaced))
          .foregroundStyle(EvidenceStyle.success)
        Text(
          "Swift validates the form and renders the receipt. Rust owns source resolution, network checks, route selection, execution, persistence, and verdict semantics."
        )
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.top, 16)
    }
    .padding(26)
    .background(EvidenceStyle.inspector)
  }

  private var activeIndex: Int {
    switch model.testingState {
    case .ready, .cancelled: 0
    case .running: 2
    case .completed, .limited, .failed: 4
    case .planning, .planned: 1
    }
  }

  private func stepColor(_ index: Int) -> Color {
    index == activeIndex ? EvidenceStyle.amber : .secondary
  }
}

private struct TestingSourceIndex: View {
  let receipt: TrexPreviewReceipt

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      PremiumFieldLabel("CHANGED PATHS").padding(16)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      if receipt.source.changedPaths.isEmpty {
        Text("No changed paths recorded")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .padding(16)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 2) {
            ForEach(receipt.source.changedPaths, id: \.self) { path in
              HStack(spacing: 8) {
                Image(systemName: "doc.text").foregroundStyle(EvidenceStyle.amberForeground)
                Text(path)
                  .font(.system(size: 9, design: .monospaced))
                  .lineLimit(2)
                Spacer(minLength: 0)
              }
              .padding(.horizontal, 14)
              .padding(.vertical, 8)
            }
          }
        }
      }
      Spacer(minLength: 0)
      Divider()
      VStack(alignment: .leading, spacing: 5) {
        PremiumFieldLabel("SOURCE")
        Text(receipt.source.kind == .range ? "Git range" : "GitHub pull request")
          .font(.system(size: 10, weight: .semibold))
        Text("\(receipt.source.commits.count) commits")
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(16)
    }
    .background(EvidenceStyle.chrome)
  }
}

private struct TestingEvidenceView: View {
  let receipt: TrexPreviewReceipt
  @State private var showsAllJourneys = false

  private var displayedJourneys: [TrexSyntheticJourney] {
    guard !showsAllJourneys else { return receipt.journeys }
    let prioritized = receipt.journeys.filter { !$0.pass } + receipt.journeys.filter(\.pass)
    return Array(prioritized.prefix(2))
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Label(
              previewStatusLabel(receipt.preview.status),
              systemImage: receipt.preview.status == .verified
                ? "checkmark.seal.fill" : "link.badge.plus"
            )
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(previewStatusColor(receipt.preview.status))
            Spacer()
            Text(receipt.preview.finalURL)
              .font(.system(size: 9, design: .monospaced))
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
          Text(receipt.preview.evidence)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(15)
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }

        HStack {
          PremiumFieldLabel("BROWSER JOURNEYS")
          Spacer()
          Text("\(receipt.journeys.filter(\.pass).count)/\(receipt.journeys.count) passed")
            .font(.system(size: 9, weight: .semibold, design: .monospaced))
            .foregroundStyle(.secondary)
        }

        if receipt.journeys.isEmpty {
          Label("No browser journey evidence was produced", systemImage: "exclamationmark.triangle")
            .font(.system(size: 11))
            .foregroundStyle(EvidenceStyle.warning)
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(EvidenceStyle.warning.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
        } else {
          ForEach(displayedJourneys) { journey in
            VStack(alignment: .leading, spacing: 9) {
              HStack {
                Label(
                  journey.route,
                  systemImage: journey.pass ? "checkmark.circle.fill" : "xmark.circle.fill"
                )
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(journey.pass ? EvidenceStyle.success : EvidenceStyle.failure)
                Spacer()
                Text("\(journey.durationMS) ms")
                  .font(.system(size: 9, design: .monospaced))
                  .foregroundStyle(.secondary)
              }
              Text(journey.notes)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
              if let error = journey.error {
                Text(error).font(.system(size: 10)).foregroundStyle(EvidenceStyle.failure)
              }
              if !journey.trace.consoleErrors.isEmpty {
                Label(
                  "\(journey.trace.consoleErrors.count) console errors",
                  systemImage: "terminal.fill"
                )
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(EvidenceStyle.warning)
              }
              let artifacts = journey.artifacts + [journey.screenshotPath].compactMap { $0 }
              if !artifacts.isEmpty {
                Text(artifacts.joined(separator: "  ·  "))
                  .font(.system(size: 8, design: .monospaced))
                  .foregroundStyle(.tertiary)
                  .lineLimit(2)
              }
            }
            .padding(15)
            .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
          }
          if receipt.journeys.count > 2 {
            Button(
              showsAllJourneys
                ? "Show priority journeys" : "Show all \(receipt.journeys.count) journeys"
            ) {
              showsAllJourneys.toggle()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
          }
        }
      }
      .padding(16)
    }
  }
}

private struct TestingReceiptInspector: View {
  let receipt: TrexPreviewReceipt

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        PremiumFieldLabel("PROOF IDENTITY")
        inspectorPair("REPOSITORY", URL(fileURLWithPath: receipt.repoPath).lastPathComponent)
        inspectorPair("RUN", receipt.runID)
        inspectorPair("HEAD", String(receipt.source.headSHA.prefix(12)))
        inspectorPair("PREVIEW", previewStatusLabel(receipt.preview.status))
        inspectorPair(
          "REVISION",
          receipt.preview.revision.map { String($0.prefix(12)) } ?? "Not exposed"
        )
        inspectorPair("DURATION", "\(receipt.durationMS) ms")
        Divider()
        PremiumFieldLabel("ROUTES")
        ForEach(receipt.routes) { route in
          VStack(alignment: .leading, spacing: 3) {
            Text(route.route).font(.system(size: 10, weight: .semibold, design: .monospaced))
            Text(route.reason).font(.system(size: 9)).foregroundStyle(.secondary)
          }
        }
        Divider()
        PremiumFieldLabel("LIMITATIONS")
        if receipt.limitations.isEmpty {
          Label("No limitations recorded", systemImage: "checkmark.circle")
            .font(.system(size: 10))
            .foregroundStyle(EvidenceStyle.success)
        } else {
          ForEach(receipt.limitations, id: \.self) { limitation in
            Label(limitation, systemImage: "exclamationmark.triangle")
              .font(.system(size: 9))
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        Divider()
        Label("Rust-persisted receipt", systemImage: "checkmark.seal.fill")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(EvidenceStyle.success)
      }
      .padding(20)
    }
    .background(EvidenceStyle.inspector)
  }

  private func inspectorPair(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      PremiumFieldLabel(label)
      Text(value)
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .textSelection(.enabled)
        .lineLimit(2)
    }
  }
}

private func verdictLabel(_ verdict: TrexPreviewVerdict) -> String {
  verdict.rawValue.replacingOccurrences(of: "_", with: " ")
}

private func verdictColor(_ verdict: TrexPreviewVerdict) -> Color {
  switch verdict {
  case .passedWithLimits: EvidenceStyle.success
  case .failed: EvidenceStyle.failure
  case .noConfidence: EvidenceStyle.warning
  }
}

private func previewStatusLabel(_ status: TrexPreviewIdentityStatus) -> String {
  switch status {
  case .verified: "Preview revision verified"
  case .claimed: "Preview identity claimed"
  case .mismatch: "Preview revision mismatch"
  }
}

private func previewStatusColor(_ status: TrexPreviewIdentityStatus) -> Color {
  switch status {
  case .verified: EvidenceStyle.success
  case .claimed: EvidenceStyle.warning
  case .mismatch: EvidenceStyle.failure
  }
}
