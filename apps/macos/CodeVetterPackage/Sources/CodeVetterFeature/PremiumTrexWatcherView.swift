import SwiftUI

struct PremiumTrexWatcherView: View {
  @Bindable var model: WorkbenchModel
  @Environment(\.dismiss) private var dismiss
  @State private var showingEnableConsent = false
  @State private var showingRawReceipt = false
  @State private var showsConfiguration = false
  @State private var showsAuthority = false

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      HStack(spacing: 0) {
        if model.currentTrexWatcher == nil || showsConfiguration {
          scheduleDesk.frame(width: 310)
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        }
        runLedger.frame(maxWidth: .infinity, maxHeight: .infinity)
        if showsAuthority {
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
          authorityRail.frame(width: 270)
        }
      }
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      actionBar
    }
    .background(EvidenceStyle.canvas)
    .task(id: model.repositoryPath) {
      if model.currentTrexWatcher == nil, model.trexWatcherState == .ready {
        model.loadTrexWatcher()
      }
    }
    .alert("Allow incoming PR verification?", isPresented: $showingEnableConsent) {
      Button("Not now", role: .cancel) {}
        .accessibilityIdentifier("cancel-watcher-consent")
      Button(model.currentTrexWatcher?.enabled == true ? "Allow this session" : "Enable watcher") {
        if model.currentTrexWatcher?.enabled == true {
          model.resumeTrexWatcherSession()
        } else {
          model.enableTrexWatcher(confirmRun: true)
        }
      }
    } message: {
      Text(
        "Each poll may contact GitHub, execute untrusted project code in an isolated worktree, invoke the configured agent, and post a commit status. Consent lasts only for this native app session."
      )
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("trex-watcher-workspace")
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 18) {
      VStack(alignment: .leading, spacing: 5) {
        Text("PR AUTOMATION")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .tracking(1.15)
          .foregroundStyle(EvidenceStyle.amberForeground)
        Text("Incoming PR Watcher").font(.system(size: 25, weight: .semibold))
        Text("Watch new and updated pull requests while CodeVetter is open")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer()
      StatusPill(label: watcherStatusLabel, color: watcherStatusColor)
      if model.currentTrexWatcher != nil {
        Menu {
          Button(showsConfiguration ? "Hide setup" : "Edit setup") {
            showsConfiguration.toggle()
          }
          Button(showsAuthority ? "Hide authority contract" : "Show authority contract") {
            showsAuthority.toggle()
          }
        } label: {
          Label("Details", systemImage: "sidebar.leading")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
      }
      Button("Done") { dismiss() }
        .buttonStyle(.bordered)
    }
    .padding(.horizontal, 22)
    .padding(.vertical, 17)
    .background(EvidenceStyle.chrome)
  }

  private var scheduleDesk: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        VStack(alignment: .leading, spacing: 5) {
          PremiumFieldLabel("SCHEDULE")
          Text(repositoryName)
            .font(.system(size: 17, weight: .semibold))
          Text(model.repositoryPath)
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .truncationMode(.middle)
        }

        VStack(alignment: .leading, spacing: 8) {
          PremiumFieldLabel("POLL INTERVAL")
          HStack {
            TextField(
              "Seconds",
              value: $model.trexWatcherIntervalSeconds,
              format: .number
            )
            .textFieldStyle(.plain)
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            Stepper(
              "",
              value: $model.trexWatcherIntervalSeconds,
              in: 60...86_400,
              step: 60
            )
            .labelsHidden()
          }
          .padding(.horizontal, 12)
          .frame(height: 42)
          .premiumField()
          Text("60 seconds minimum · 24 hours maximum")
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }

        PremiumInput(
          label: "BASE BRANCH",
          icon: "arrow.triangle.branch",
          placeholder: "Auto-detect from pull request",
          text: $model.trexWatcherBaseBranch
        )

        VStack(alignment: .leading, spacing: 9) {
          HStack {
            Image(
              systemName: model.trexWatcherSessionConfirmed
                ? "checkmark.shield.fill" : "shield.lefthalf.filled"
            )
            .foregroundStyle(
              model.trexWatcherSessionConfirmed ? EvidenceStyle.success : EvidenceStyle.warning)
            Text(
              model.trexWatcherSessionConfirmed
                ? "Execution allowed this session" : "Execution consent required"
            )
            .font(.system(size: 10, weight: .semibold))
          }
          Text(
            "The native app owns timing only while it is open. Rust owns repository discovery, worktree isolation, project execution, agent synthesis, GitHub statuses, and SQLite history."
          )
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        .padding(13)
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
        .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }

        if let watcher = model.currentTrexWatcher {
          VStack(alignment: .leading, spacing: 9) {
            watcherFact("PERSISTED", watcher.enabled ? "Enabled" : "Disabled")
            watcherFact("EVERY", "\(watcher.intervalSeconds)s")
            watcherFact("LAST POLL", watcher.lastPolledAt ?? "Never")
            if let error = watcher.lastError {
              Text(error)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(EvidenceStyle.failure)
                .textSelection(.enabled)
            }
          }
          .padding(13)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 11))
          .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
        }
      }
      .padding(18)
    }
    .background(EvidenceStyle.inspector)
  }

  private var runLedger: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("RECENT RUNS")
          Text("New & updated PR receipts").font(.system(size: 15, weight: .semibold))
        }
        Spacer()
        Text("\(model.trexWatcherRuns.count) retained")
          .font(.system(size: 10, weight: .semibold, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(18)
      .background(EvidenceStyle.surface)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)

      if model.trexWatcherRuns.isEmpty {
        ContentUnavailableView(
          "No incoming PR receipts",
          systemImage: "dot.radiowaves.left.and.right",
          description: Text(
            "A receipt appears when a new open pull request arrives or an existing pull request receives a head SHA that has not been verified."
          )
        )
      } else {
        ScrollView {
          LazyVStack(spacing: 8) {
            ForEach(model.trexWatcherRuns) { run in
              watcherRunRow(run)
            }
            if !model.trexWatcherReceiptJSON.isEmpty {
              DisclosureGroup("Latest canonical receipt", isExpanded: $showingRawReceipt) {
                ScrollView(.horizontal) {
                  Text(model.trexWatcherReceiptJSON)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 10)
                }
              }
              .font(.system(size: 10, weight: .semibold))
              .padding(14)
              .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 11))
              .overlay { RoundedRectangle(cornerRadius: 11).stroke(EvidenceStyle.separator) }
            }
          }
          .padding(16)
        }
      }
    }
  }

  private var authorityRail: some View {
    VStack(alignment: .leading, spacing: 18) {
      PremiumFieldLabel("AUTHORITY CONTRACT")
      authorityStep(
        "01", "Native schedule",
        "A cancellable app-lifetime task waits for the persisted interval.")
      authorityStep(
        "02", "Foreground poll",
        "The CLI requires explicit confirmation and stays supervised.")
      authorityStep(
        "03", "Incoming PR discovery",
        "Rust finds new or updated open PRs, then owns sandboxing, agent synthesis, and persistence."
      )
      authorityStep(
        "04", "GitHub receipt",
        "Commit status errors stay attached to the run instead of hiding evidence.")
      Spacer()
      VStack(alignment: .leading, spacing: 7) {
        Label("No hidden daemon", systemImage: "checkmark.seal.fill")
          .foregroundStyle(EvidenceStyle.success)
        Text(
          "Closing the native app stops its schedule. Saved configuration and run history remain."
        )
        .foregroundStyle(.secondary)
      }
      .font(.system(size: 10))
    }
    .padding(18)
    .background(EvidenceStyle.chrome)
  }

  private var actionBar: some View {
    HStack(spacing: 12) {
      if model.trexWatcherState == .running || model.trexWatcherState == .planning {
        ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(model.trexWatcherStatusMessage)
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(model.trexWatcherIssue == nil ? .secondary : EvidenceStyle.failure)
          .lineLimit(2)
        if !model.canConfigureTrexWatcher,
          model.trexWatcherIntervalSeconds < 60
            || model.trexWatcherIntervalSeconds > 86_400
        {
          Text("Choose an interval from 60 to 86,400 seconds.")
            .font(.system(size: 10))
            .foregroundStyle(EvidenceStyle.warning)
        }
      }
      Spacer()
      Button("Refresh") { model.loadTrexWatcher() }
        .buttonStyle(.bordered)
        .disabled(model.isBusy)
      if model.trexWatcherState == .running {
        Button("Cancel", role: .destructive) { model.cancelTrexWatcherAction() }
          .buttonStyle(.bordered)
      } else {
        if let watcher = model.currentTrexWatcher, watcher.enabled {
          Button("Disable", role: .destructive) { model.disableTrexWatcher() }
            .buttonStyle(.bordered)
            .disabled(model.isBusy)
          Button(model.trexWatcherSessionConfirmed ? "Poll now" : "Allow session") {
            if model.trexWatcherSessionConfirmed {
              model.pollTrexWatcher(confirmRun: false)
            } else {
              showingEnableConsent = true
            }
          }
          .buttonStyle(PremiumPrimaryButtonStyle())
          .disabled(model.isBusy)
        } else {
          Button("Enable watcher") { showingEnableConsent = true }
            .buttonStyle(PremiumPrimaryButtonStyle())
            .disabled(!model.canConfigureTrexWatcher)
        }
      }
    }
    .padding(.horizontal, 20)
    .frame(minHeight: 68)
    .background(EvidenceStyle.chrome)
  }

  private func watcherRunRow(_ run: TrexWatcherRun) -> some View {
    HStack(alignment: .top, spacing: 13) {
      ZStack {
        RoundedRectangle(cornerRadius: 8)
          .fill(verdictColor(run.verdict).opacity(0.12))
        Image(systemName: verdictIcon(run.verdict))
          .foregroundStyle(verdictColor(run.verdict))
      }
      .frame(width: 38, height: 38)
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          Text("PR #\(run.prNumber)")
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
          Text(String(run.headSHA.prefix(8)))
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(.secondary)
          Spacer()
          StatusPill(label: run.verdict, color: verdictColor(run.verdict))
        }
        Text(run.summary)
          .font(.system(size: 10))
          .lineLimit(2)
        HStack(spacing: 12) {
          Text("\(run.durationMS)ms")
          Text("\(Int((run.confidence * 100).rounded()))% confidence")
          Text(run.statusState ?? "status not posted")
          Spacer()
          Text(run.ranAt)
          if retryRecommended(run) {
            Button("Retry") { model.retryTrexWatcherRun(run) }
              .buttonStyle(.borderless)
              .foregroundStyle(EvidenceStyle.amberForeground)
              .disabled(model.isBusy || !model.trexWatcherSessionConfirmed)
              .help("Rerun this exact open PR after an infrastructure-limited attempt")
          }
        }
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(.secondary)
        if let error = run.statusError {
          Text(error)
            .font(.system(size: 10))
            .foregroundStyle(EvidenceStyle.warning)
            .lineLimit(2)
        }
      }
    }
    .padding(14)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func watcherFact(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundStyle(.secondary)
      Spacer()
      Text(value)
        .font(.system(size: 10, weight: .medium, design: .monospaced))
    }
  }

  private func authorityStep(_ number: String, _ title: String, _ detail: String) -> some View {
    HStack(alignment: .top, spacing: 11) {
      Text(number)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.amberForeground)
        .frame(width: 24, height: 24)
        .background(EvidenceStyle.amber.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.system(size: 10, weight: .semibold))
        Text(detail)
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var repositoryName: String {
    guard !model.repositoryPath.isEmpty else { return "No repository selected" }
    return URL(fileURLWithPath: model.repositoryPath).lastPathComponent
  }

  private var watcherStatusLabel: String {
    if model.trexWatcherState == .running { return "Executing" }
    if model.trexWatcherSessionConfirmed { return "Session active" }
    if model.currentTrexWatcher?.enabled == true { return "Consent paused" }
    if model.currentTrexWatcher != nil { return "Disabled" }
    return "Not configured"
  }

  private var watcherStatusColor: Color {
    if model.trexWatcherState == .failed { return EvidenceStyle.failure }
    if model.trexWatcherState == .running { return EvidenceStyle.amber }
    if model.trexWatcherSessionConfirmed { return EvidenceStyle.success }
    return .secondary
  }

  private func verdictColor(_ verdict: String) -> Color {
    switch verdict {
    case "APPROVE": EvidenceStyle.success
    case "NEEDS_REVIEW": EvidenceStyle.warning
    default: EvidenceStyle.failure
    }
  }

  private func verdictIcon(_ verdict: String) -> String {
    switch verdict {
    case "APPROVE": "checkmark.shield.fill"
    case "NEEDS_REVIEW": "exclamationmark.shield.fill"
    default: "xmark.shield.fill"
    }
  }

  private func retryRecommended(_ run: TrexWatcherRun) -> Bool {
    run.statusError != nil || run.confidence == 0
      || run.summary.localizedCaseInsensitiveContains("sandbox didn't complete")
      || run.summary.localizedCaseInsensitiveContains("could not be materialized")
  }
}
