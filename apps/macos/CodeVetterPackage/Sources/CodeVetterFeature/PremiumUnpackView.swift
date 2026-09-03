import AppKit
import SwiftUI
import UniformTypeIdentifiers

private enum UnpackDeskSection: String, CaseIterable, Identifiable {
  case overview = "Overview"
  case brief = "Brief"
  case activity = "Activity"
  case inventory = "Inventory"
  case graph = "Graph"
  case analysis = "Analysis"
  case rules = "Rules"
  case handoff = "Handoff"
  case delta = "Delta"

  var id: String { rawValue }
}

struct PremiumUnpackView: View {
  @Bindable var model: WorkbenchModel
  @State private var section: UnpackDeskSection = .overview

  init(model: WorkbenchModel, startsInQueryDesk: Bool = false) {
    self.model = model
    _section = State(initialValue: startsInQueryDesk ? .graph : .overview)
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      scanBar
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      HStack(spacing: 0) {
        snapshotLedger
          .frame(width: 270)
        Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
        detailDesk
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
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("repo-unpack-workspace")
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 18) {
      VStack(alignment: .leading, spacing: 5) {
        Text("REPOSITORY MEMORY")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.1)
          .foregroundStyle(EvidenceStyle.amberForeground)
        Text("Repo Unpack").font(.system(size: 25, weight: .semibold))
        Text("Stored source maps, history leads, structural evidence, and explicit coverage")
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer()
      StatusPill(
        label: (model.unpackLoading || model.repositoryQueryLoading)
          ? "Rust operation active" : "Native scan + query",
        color: model.unpackIssue == nil ? EvidenceStyle.success : EvidenceStyle.warning
      )
      .accessibilityIdentifier("repo-unpack-read-only-status")
      Menu {
        ForEach(UnpackExportFormat.allCases) { format in
          Button(format.label) { chooseExport(format) }
        }
      } label: {
        Label("Export", systemImage: "square.and.arrow.up")
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
      .disabled(model.unpackSnapshot == nil || model.isBusy)
      .accessibilityIdentifier("repo-unpack-export")
      Button {
        model.loadUnpackSnapshots()
      } label: {
        Label("Refresh", systemImage: "arrow.clockwise")
      }
      .buttonStyle(.bordered)
      .disabled(model.unpackLoading)
      .accessibilityLabel("Refresh Repo Unpack snapshots")
    }
    .padding(.horizontal, 22)
    .padding(.vertical, 18)
    .background(EvidenceStyle.chrome)
  }

  private var scanBar: some View {
    HStack(spacing: 12) {
      Button {
        model.choosingRepository = true
      } label: {
        HStack(spacing: 9) {
          Image(systemName: "folder.fill").foregroundStyle(EvidenceStyle.amberForeground)
          Text(repositoryLabel)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(model.repositoryPath.isEmpty ? .secondary : .primary)
            .lineLimit(1)
            .truncationMode(.middle)
          Spacer(minLength: 8)
          Text("Choose…")
            .font(.system(size: 8, weight: .semibold))
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .frame(width: 310, height: 38)
        .premiumField()
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Choose repository to unpack")
      .accessibilityIdentifier("repo-unpack-choose-repository")

      VStack(alignment: .leading, spacing: 2) {
        PremiumFieldLabel(
          (model.unpackLoading || model.repositoryQueryLoading)
            ? "RUST OPERATION ACTIVE" : "DETERMINISTIC SNAPSHOT")
        Text(model.unpackStatusMessage)
          .font(.system(size: 9))
          .foregroundStyle(model.unpackIssue == nil ? Color.secondary : EvidenceStyle.warning)
          .lineLimit(1)
      }
      Spacer(minLength: 12)

      if model.unpackLoading || model.repositoryQueryLoading {
        Button("Cancel", role: .cancel) { model.cancelUnpackOperation() }
          .buttonStyle(.bordered)
          .accessibilityIdentifier("repo-unpack-cancel")
      } else {
        Button {
          model.scanUnpackRepository()
        } label: {
          Label("Unpack repository", systemImage: "shippingbox.and.arrow.backward.fill")
        }
        .buttonStyle(.borderedProminent)
        .tint(EvidenceStyle.amber)
        .foregroundStyle(Color.black)
        .disabled(!model.canScanUnpackRepository)
        .accessibilityIdentifier("repo-unpack-scan")
      }
    }
    .padding(.horizontal, 18)
    .frame(height: 58)
    .background(EvidenceStyle.surface)
  }

  private var repositoryLabel: String {
    guard !model.repositoryPath.isEmpty else { return "Choose a local repository" }
    return URL(fileURLWithPath: model.repositoryPath).lastPathComponent
  }

  private var snapshotLedger: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        PremiumFieldLabel("SNAPSHOT LEDGER")
        Spacer()
        Text("\(model.unpackSnapshots.count)")
          .font(.system(size: 9, weight: .semibold, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(16)
      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)

      if model.unpackSnapshots.isEmpty, !model.unpackLoading {
        ContentUnavailableView(
          "No stored snapshots",
          systemImage: "shippingbox",
          description: Text(
            model.unpackIssue ?? "Choose a repository above to create a deterministic snapshot.")
        )
      } else {
        ScrollView {
          LazyVStack(spacing: 5) {
            ForEach(model.unpackSnapshots) { snapshot in
              Button {
                model.selectUnpackSnapshot(snapshot.id)
              } label: {
                UnpackSnapshotRow(
                  snapshot: snapshot,
                  selected: snapshot.id == model.selectedUnpackSnapshotID
                )
              }
              .buttonStyle(.plain)
              .accessibilityLabel("\(snapshot.repoName) snapshot")
              .accessibilityValue(
                snapshot.id == model.selectedUnpackSnapshotID ? "Selected" : snapshot.status)
            }
          }
          .padding(10)
        }
      }

      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      VStack(alignment: .leading, spacing: 7) {
        Label("Rust-owned SQLite history", systemImage: "checkmark.seal.fill")
          .foregroundStyle(EvidenceStyle.success)
        Text(
          "Native creation, bounded comparison, canonical exports, and read-only graph/history queries use shared Rust boundaries. Model synthesis and cleanup remain separately gated."
        )
        .foregroundStyle(.secondary)
      }
      .font(.system(size: 8))
      .padding(14)
    }
    .background(EvidenceStyle.inspector)
  }

  @ViewBuilder
  private var detailDesk: some View {
    if let inventory = model.unpackInventory, let snapshot = model.unpackSnapshot {
      VStack(spacing: 0) {
        sectionRail(hasBrief: model.unpackReport != nil)
        Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
        switch section {
        case .overview:
          overviewDesk(snapshot, inventory: inventory)
        case .brief:
          briefDesk(model.unpackReport)
        case .activity:
          activityDesk(inventory)
        case .inventory:
          inventoryDesk(inventory)
        case .graph:
          graphDesk(inventory)
        case .analysis:
          analysisDesk(inventory)
        case .rules:
          rulesDesk(inventory)
        case .handoff:
          handoffDesk(inventory, report: model.unpackReport)
        case .delta:
          deltaDesk(snapshot)
        }
      }
    } else if model.unpackLoading {
      VStack(spacing: 12) {
        ProgressView().controlSize(.small)
        Text("Opening the bounded Rust snapshot…").font(.system(size: 12, weight: .medium))
        Text("The native client never opens or reinterprets SQLite directly.")
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ContentUnavailableView(
        "Select a stored snapshot",
        systemImage: "shippingbox",
        description: Text(model.unpackIssue ?? "Choose a repository snapshot from the ledger.")
      )
    }
  }

  private func sectionRail(hasBrief: Bool) -> some View {
    HStack(spacing: 6) {
      ForEach(UnpackDeskSection.allCases) { item in
        Button {
          section = item
        } label: {
          Text(item.rawValue)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(section == item ? Color.black : Color.secondary)
            .padding(.horizontal, 12)
            .frame(height: 29)
            .background(
              section == item ? EvidenceStyle.amber : Color.clear,
              in: RoundedRectangle(cornerRadius: 8)
            )
        }
        .buttonStyle(.plain)
        .disabled(item == .brief && !hasBrief)
        .accessibilityLabel("Repo Unpack \(item.rawValue)")
        .accessibilityValue(section == item ? "Selected" : "")
        .accessibilityIdentifier("repo-unpack-section-\(item.rawValue.lowercased())")
      }
      Spacer()
      Text(hasBrief ? "LOCAL + MODEL-LABELLED" : "LOCAL EVIDENCE ONLY")
        .font(.system(size: 7, weight: .bold, design: .monospaced))
        .foregroundStyle(hasBrief ? EvidenceStyle.warning : EvidenceStyle.success)
    }
    .padding(.horizontal, 14)
    .frame(height: 44)
    .background(EvidenceStyle.chrome)
  }

  private func overviewDesk(_ snapshot: UnpackSnapshotRecord, inventory: UnpackInventory)
    -> some View
  {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 14) {
        identity(snapshot, inventory: inventory)
        metrics(snapshot, inventory: inventory)
        HStack(alignment: .top, spacing: 14) {
          systemMap(inventory)
          sourceOutline(inventory)
            .frame(width: 330)
        }
        HStack(alignment: .top, spacing: 14) {
          historyPanel(inventory)
          healthPanel(inventory)
        }
      }
      .padding(18)
    }
  }

  private func identity(_ snapshot: UnpackSnapshotRecord, inventory: UnpackInventory) -> some View {
    HStack(alignment: .top, spacing: 18) {
      VStack(alignment: .leading, spacing: 6) {
        PremiumFieldLabel("SELECTED REPOSITORY")
        Text(snapshot.repoName).font(.system(size: 22, weight: .semibold))
        Text(snapshot.repoPath)
          .font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 7) {
        StatusPill(
          label: snapshot.status.replacingOccurrences(of: "_", with: " "),
          color: EvidenceStyle.success)
        HStack(spacing: 12) {
          UnpackIdentity(label: "BRANCH", value: inventory.branch ?? "detached")
          UnpackIdentity(
            label: "COMMIT",
            value: snapshot.commitSHA.map { String($0.prefix(12)) } ?? "unrecorded"
          )
        }
      }
    }
    .padding(18)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func metrics(_ snapshot: UnpackSnapshotRecord, inventory: UnpackInventory) -> some View {
    HStack(spacing: 8) {
      UnpackMetric(
        value: compactCount(snapshot.filesScanned), label: "FILES SCANNED",
        detail: "\(snapshot.filesSkipped) skipped")
      UnpackMetric(
        value: byteCount(snapshot.bytesScanned), label: "SOURCE BYTES",
        detail: inventory.coverage.strategy.replacingOccurrences(of: "_", with: " "))
      UnpackMetric(
        value: "\(inventory.graph.nodes.count)", label: "GRAPH NODES",
        detail: "\(inventory.graph.edges.count) relationships")
      UnpackMetric(
        value: String(format: "%.1f", inventory.health.averageScore), label: "HEALTH SCORE",
        detail: "\(inventory.health.hotspotCount) hotspots")
    }
  }

  private func systemMap(_ inventory: UnpackInventory) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("SYSTEM MAP")
          Text("Technology and workspace boundaries").font(.system(size: 15, weight: .semibold))
        }
        Spacer()
        Text("\(inventory.workspaceUnits.count) units")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: 72), spacing: 6)],
        alignment: .leading,
        spacing: 6
      ) {
        ForEach(inventory.stackTags, id: \.self) { tag in
          Text(tag)
            .font(.system(size: 8, weight: .semibold))
            .padding(.horizontal, 9)
            .frame(height: 25)
            .background(EvidenceStyle.amber.opacity(0.1), in: Capsule())
            .overlay { Capsule().stroke(EvidenceStyle.amber.opacity(0.25)) }
        }
      }
      Divider()
      ForEach(inventory.workspaceUnits.prefix(6)) { unit in
        HStack(spacing: 10) {
          Image(systemName: "shippingbox")
            .foregroundStyle(EvidenceStyle.amberForeground)
            .frame(width: 22)
          VStack(alignment: .leading, spacing: 2) {
            Text(unit.name).font(.system(size: 10, weight: .semibold))
            Text("\(unit.kind.replacingOccurrences(of: "_", with: " ")) · \(unit.fileCount) files")
              .font(.system(size: 8, design: .monospaced))
              .foregroundStyle(.secondary)
          }
          Spacer()
          Text(unit.languages.prefix(3).map(\.language).joined(separator: " · "))
            .font(.system(size: 8))
            .foregroundStyle(.secondary)
        }
        .frame(height: 36)
      }
      Divider()
      PremiumFieldLabel("LANGUAGE WEIGHT")
      ForEach(inventory.languages.prefix(6)) { language in
        HStack {
          Text(language.language).font(.system(size: 9, weight: .medium))
          Spacer()
          Text("\(language.files) files · \(byteCount(Int(language.bytes)))")
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func sourceOutline(_ inventory: UnpackInventory) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 3) {
        PremiumFieldLabel("SOURCE OUTLINE")
        Text("Entrypoints and bounded tree").font(.system(size: 15, weight: .semibold))
      }
      .padding(16)
      Divider()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(inventory.entrypoints.prefix(8)) { entry in
            HStack(spacing: 8) {
              Image(systemName: "arrow.right.square")
                .foregroundStyle(EvidenceStyle.amberForeground)
              VStack(alignment: .leading, spacing: 2) {
                Text(entry.path).font(.system(size: 9, weight: .medium, design: .monospaced))
                Text(entry.reason).font(.system(size: 8)).foregroundStyle(.secondary)
              }
              Spacer()
            }
            .padding(.horizontal, 14)
            .frame(height: 39)
          }
          Divider().padding(.vertical, 5)
          ForEach(inventory.directoryTree.children.prefix(20)) { node in
            HStack(spacing: 8) {
              Image(systemName: node.isDirectory ? "folder" : "doc")
                .foregroundStyle(
                  node.isDirectory ? EvidenceStyle.amberForeground : Color.secondary)
              Text(node.path.isEmpty ? node.name : node.path)
                .font(.system(size: 9, design: .monospaced))
                .lineLimit(1)
              Spacer()
              Text("\(node.fileCount)")
                .font(.system(size: 8, design: .monospaced))
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .frame(height: 28)
          }
        }
      }
      .frame(height: 290)
      Divider()
      Text(
        inventory.allFilesCapped
          ? "Raw file list withheld · tree projection only" : "Complete bounded tree projection"
      )
      .font(.system(size: 8, weight: .semibold, design: .monospaced))
      .foregroundStyle(inventory.allFilesCapped ? EvidenceStyle.warning : EvidenceStyle.success)
      .padding(14)
    }
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 14))
    .clipShape(RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func historyPanel(_ inventory: UnpackInventory) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("HISTORY LEADS")
          Text("Recent decisions and commits").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Text(inventory.history.truncated ? "BOUNDED" : "COMPLETE")
          .font(.system(size: 7, weight: .bold, design: .monospaced))
          .foregroundStyle(EvidenceStyle.warning)
      }
      Text(inventory.history.summary)
        .font(.system(size: 9))
        .foregroundStyle(.secondary)
        .lineLimit(3)
      ForEach(inventory.history.recentCommits.prefix(4)) { commit in
        HStack(alignment: .top, spacing: 9) {
          Text(String(commit.sha.prefix(7)))
            .font(.system(size: 8, weight: .semibold, design: .monospaced))
            .foregroundStyle(EvidenceStyle.amberForeground)
          Text(commit.subject).font(.system(size: 9)).lineLimit(2)
          Spacer()
        }
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  private func healthPanel(_ inventory: UnpackInventory) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          PremiumFieldLabel("DETERMINISTIC HEALTH")
          Text("Review leads, not runtime proof").font(.system(size: 14, weight: .semibold))
        }
        Spacer()
        Text("\(inventory.health.hotspotCount) hotspots")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(EvidenceStyle.warning)
      }
      ForEach(inventory.health.topFiles.prefix(4)) { file in
        HStack(spacing: 10) {
          Text(String(format: "%.1f", file.score))
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(file.score < 5 ? EvidenceStyle.warning : EvidenceStyle.success)
            .frame(width: 28)
          VStack(alignment: .leading, spacing: 2) {
            Text(file.path).font(.system(size: 9, weight: .medium, design: .monospaced)).lineLimit(
              1)
            Text(
              "\(file.lines) lines · churn \(file.churn) · \(file.hasTestSignal ? "test signal" : "no adjacent test")"
            )
            .font(.system(size: 8))
            .foregroundStyle(.secondary)
          }
          Spacer()
        }
      }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }

  @ViewBuilder
  private func briefDesk(_ report: UnpackReport?) -> some View {
    if let report {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          VStack(alignment: .leading, spacing: 7) {
            PremiumFieldLabel("SYNTHESIZED BRIEF")
            Text(report.overview ?? "Stored model-labelled repository brief")
              .font(.system(size: 18, weight: .semibold))
            Text(
              "Claims retain their recorded source citations. This brief is navigation context, not executable verification."
            )
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
          }
          .padding(18)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
          .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }

          ForEach(reportSections(report), id: \.0) { item in
            UnpackBriefSectionCard(sectionID: item.0, section: item.1)
          }

          if let prompt = report.agentPrompt, !prompt.isEmpty {
            DisclosureGroup("Recorded agent handoff prompt") {
              Text(prompt)
                .font(.system(size: 9, design: .monospaced))
                .textSelection(.enabled)
                .padding(.top, 10)
            }
            .font(.system(size: 10, weight: .semibold))
            .padding(16)
            .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
          }
        }
        .padding(18)
      }
    } else {
      ContentUnavailableView(
        "No synthesized brief",
        systemImage: "text.book.closed",
        description: Text(
          "This snapshot contains deterministic local evidence only. No model-labelled claims are implied."
        )
      )
    }
  }

  private func reportSections(_ report: UnpackReport) -> [(String, UnpackReportSection)] {
    [
      ("system-map", report.systemMap),
      ("feature-catalog", report.featureCatalog),
      ("data-flow", report.dataFlow),
      ("behavior-traces", report.behaviorTraces),
      ("testing-signals", report.testingSignals),
      ("risk-map", report.riskMap),
      ("extension-points", report.extensionPoints),
      ("agent-handoff", report.agentHandoff),
    ].compactMap { item in item.1.map { (item.0, $0) } }
  }

  private func activityDesk(_ inventory: UnpackInventory) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        UnpackDeskHeader(
          eyebrow: "ACTIVITY / SOURCE-BACKED LEADS",
          title: "History without invented causality",
          detail: inventory.history.summary
        )
        UnpackListPanel(title: "RECENT COMMITS", count: inventory.history.recentCommits.count) {
          ForEach(inventory.history.recentCommits.prefix(30)) { commit in
            UnpackEvidenceRow(
              icon: "point.topleft.down.curvedto.point.bottomright.up",
              title: commit.subject,
              detail:
                "\(String(commit.sha.prefix(10))) · \(commit.files.prefix(3).joined(separator: " · "))"
            )
          }
        }
        UnpackListPanel(title: "DECISION MARKERS", count: inventory.history.decisions.count) {
          ForEach(inventory.history.decisions.prefix(40)) { decision in
            UnpackEvidenceRow(
              icon: "quote.bubble",
              title: decision.text,
              detail: "\(decision.marker) · \(decision.source)"
            )
          }
        }
        UnpackListPanel(title: "TEST LEADS", count: inventory.history.testHints.count) {
          ForEach(inventory.history.testHints.prefix(40)) { hint in
            UnpackEvidenceRow(icon: "checkmark.diamond", title: hint.path, detail: hint.reason)
          }
        }
      }
      .padding(18)
    }
  }

  private func inventoryDesk(_ inventory: UnpackInventory) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        UnpackDeskHeader(
          eyebrow: "INVENTORY / BOUNDED SOURCE MAP",
          title: "What Rust actually observed",
          detail:
            "\(inventory.coverage.sampledFiles) sampled files · \(inventory.coverage.strategy.replacingOccurrences(of: "_", with: " "))"
        )
        HStack(alignment: .top, spacing: 12) {
          UnpackListPanel(title: "WORKSPACE UNITS", count: inventory.workspaceUnits.count) {
            ForEach(inventory.workspaceUnits.prefix(40)) { unit in
              UnpackEvidenceRow(
                icon: "shippingbox",
                title: unit.name,
                detail:
                  "\(unit.kind.replacingOccurrences(of: "_", with: " ")) · \(unit.fileCount) files · \(unit.path)"
              )
            }
          }
          UnpackListPanel(title: "MANIFESTS", count: inventory.manifests.count) {
            ForEach(inventory.manifests.prefix(40)) { manifest in
              UnpackEvidenceRow(
                icon: "doc.badge.gearshape",
                title: manifest.name ?? manifest.path,
                detail: "\(manifest.kind) · \(manifest.dependencies.count) dependencies"
              )
            }
          }
        }
        HStack(alignment: .top, spacing: 12) {
          UnpackListPanel(title: "DOCUMENTS", count: inventory.documents.count) {
            ForEach(inventory.documents.prefix(30)) { document in
              UnpackEvidenceRow(
                icon: "doc.text", title: document.path,
                detail: ByteCountFormatter.string(
                  fromByteCount: Int64(document.bytes), countStyle: .file))
            }
          }
          UnpackListPanel(title: "CONFIGURATION", count: inventory.configFiles.count) {
            ForEach(inventory.configFiles.prefix(40), id: \.self) { path in
              UnpackEvidenceRow(icon: "gearshape.2", title: path, detail: "Observed configuration")
            }
          }
        }
        sourceOutline(inventory)
      }
      .padding(18)
    }
  }

  private func graphDesk(_ inventory: UnpackInventory) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        UnpackDeskHeader(
          eyebrow: "QUERY DESK / CANONICAL READ MODEL",
          title: "Ask the repository, keep the provenance",
          detail:
            "Structural and historical retrieval reuse the same Rust services exposed to CLI and MCP. Results stay bounded, source-qualified, and freshness-aware."
        )
        repositoryQueryConsole
        repositoryQueryResults
        UnpackDeskHeader(
          eyebrow: "SNAPSHOT / QUALIFIED TOPOLOGY",
          title: "Recorded relationships remain visible",
          detail:
            "\(inventory.graph.nodes.count) nodes · \(inventory.graph.edges.count) edges · \(inventory.graph.truncated ? "bounded projection" : "complete recorded projection")"
        )
        HStack(alignment: .top, spacing: 12) {
          UnpackListPanel(title: "NODES", count: inventory.graph.nodes.count) {
            ForEach(inventory.graph.nodes.prefix(80)) { node in
              UnpackEvidenceRow(
                icon: "circle.hexagongrid",
                title: node.label,
                detail: "\(node.kind) · \(node.path ?? node.detail ?? node.id)"
              )
            }
          }
          UnpackListPanel(title: "RELATIONSHIPS", count: inventory.graph.edges.count) {
            ForEach(inventory.graph.edges.prefix(120)) { edge in
              UnpackEvidenceRow(
                icon: "arrow.triangle.branch",
                title: "\(edge.from) → \(edge.to)",
                detail: "\(edge.kind) · \(edge.trust) · \(edge.evidence)"
              )
            }
          }
        }
      }
      .padding(18)
    }
  }

  private var repositoryQueryConsole: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        HStack(spacing: 4) {
          ForEach(RepositoryQueryDomain.allCases) { domain in
            Button {
              model.repositoryQueryDomain = domain
              model.repositoryQueryReceipt = nil
              model.repositoryQueryDetailReceipt = nil
              model.repositoryQueryIssue = nil
              model.repositoryQueryDetailIssue = nil
              model.repositoryGraphPathOrigin = nil
            } label: {
              Text(domain.label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(
                  model.repositoryQueryDomain == domain ? Color.black : Color.secondary
                )
                .padding(.horizontal, 15)
                .frame(height: 30)
                .background(
                  model.repositoryQueryDomain == domain ? EvidenceStyle.amber : Color.clear,
                  in: RoundedRectangle(cornerRadius: 8)
                )
            }
            .buttonStyle(.plain)
            .accessibilityValue(model.repositoryQueryDomain == domain ? "Selected" : "")
          }
        }
        .padding(4)
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).stroke(EvidenceStyle.separator) }
        .accessibilityIdentifier("repo-query-domain")

        HStack(spacing: 9) {
          Image(
            systemName: model.repositoryQueryDomain == .graph
              ? "point.3.connected.trianglepath.dotted"
              : "clock.arrow.trianglehead.counterclockwise.rotate.90"
          )
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(EvidenceStyle.amberForeground)
          TextField(
            model.repositoryQueryDomain == .graph
              ? "Find a service, symbol, path, or responsibility"
              : "Find a commit, release, entity, or evidence event",
            text: $model.repositoryQueryText
          )
          .textFieldStyle(.plain)
          .font(.system(size: 11))
          .onSubmit { model.queryRepositoryEvidence() }
          .accessibilityIdentifier("repo-query-text")
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .premiumField()

        Button {
          model.queryRepositoryEvidence()
        } label: {
          if model.repositoryQueryLoading {
            ProgressView().controlSize(.small)
          } else {
            Label("Query", systemImage: "arrow.right")
          }
        }
        .buttonStyle(.borderedProminent)
        .tint(EvidenceStyle.amber)
        .foregroundStyle(Color.black)
        .frame(minWidth: 86)
        .disabled(!model.canQueryRepositoryEvidence)
        .accessibilityIdentifier("repo-query-submit")
      }

      HStack(spacing: 8) {
        PremiumFieldLabel("READ ONLY")
        Text("40-result bound")
        Text("•")
        Text("Canonical SQLite index")
        Text("•")
        Text("No repository mutation")
        Spacer()
        if let issue = model.repositoryQueryInputIssue,
          !model.repositoryQueryText.isEmpty
        {
          Text(issue).foregroundStyle(EvidenceStyle.warning)
        }
      }
      .font(.system(size: 8, design: .monospaced))
      .foregroundStyle(.secondary)
    }
    .padding(14)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  @ViewBuilder
  private var repositoryQueryResults: some View {
    if model.repositoryQueryLoading {
      HStack(spacing: 10) {
        ProgressView().controlSize(.small)
        Text("Rust is applying canonical ranking and freshness checks…")
          .font(.system(size: 10, weight: .medium))
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .premiumField()
    } else if let issue = model.repositoryQueryIssue {
      Label(issue, systemImage: "exclamationmark.triangle.fill")
        .font(.system(size: 9))
        .foregroundStyle(EvidenceStyle.warning)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .premiumField()
    } else if let receipt = model.repositoryQueryReceipt {
      VStack(alignment: .leading, spacing: 12) {
        repositoryQueryStatus(receipt)
        if receipt.status == "unavailable" {
          Label(
            receipt.issue ?? "The canonical index is unavailable.",
            systemImage: "square.stack.3d.up.slash"
          )
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(EvidenceStyle.warning)
          .padding(16)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(EvidenceStyle.warning.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        } else if let result = receipt.graphResult {
          UnpackListPanel(title: "STRUCTURAL MATCHES", count: result.hits.count) {
            ForEach(result.hits) { hit in
              repositoryGraphHit(hit)
            }
          }
        } else if let result = receipt.historyResult {
          UnpackListPanel(title: "HISTORY MATCHES", count: result.items.count) {
            ForEach(result.items) { item in
              repositoryHistoryHit(item)
            }
          }
        }
        repositoryQueryDetailResults
      }
    } else {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: "scope")
          .font(.system(size: 18, weight: .medium))
          .foregroundStyle(EvidenceStyle.amberForeground)
        VStack(alignment: .leading, spacing: 4) {
          Text("A query returns evidence, not a generated answer.")
            .font(.system(size: 11, weight: .semibold))
          Text(
            "Structure ranks indexed symbols and paths. History searches Git revisions plus persisted entities and events, with any coverage gap shown beside the result."
          )
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
        }
        Spacer()
      }
      .padding(16)
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
      .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
    }
  }

  private func repositoryGraphHit(_ hit: RepositoryGraphSearchHit) -> some View {
    VStack(alignment: .leading, spacing: 7) {
      Button {
        model.explainRepositoryGraphNode(hit.node)
      } label: {
        UnpackEvidenceRow(
          icon: "point.3.connected.trianglepath.dotted",
          title: hit.node.label,
          detail: graphHitDetail(hit)
        )
      }
      .buttonStyle(.plain)
      HStack(spacing: 7) {
        repositoryQueryAction("Explain", icon: "info.circle") {
          model.explainRepositoryGraphNode(hit.node)
        }
        repositoryQueryAction("Impact", icon: "scope") {
          model.queryRepositoryImpact(hit.node)
        }
        repositoryQueryAction(
          model.repositoryGraphPathOrigin == nil ? "Path origin" : "Route here",
          icon: model.repositoryGraphPathOrigin == nil
            ? "smallcircle.filled.circle" : "arrow.triangle.branch"
        ) {
          if model.repositoryGraphPathOrigin == nil {
            model.setRepositoryGraphPathOrigin(hit.node)
          } else {
            model.queryRepositoryPath(to: hit.node)
          }
        }
        Spacer()
      }
      .padding(.leading, 24)
    }
  }

  private func repositoryHistoryHit(_ item: RepositoryHistorySearchItem) -> some View {
    Button {
      model.traceRepositoryHistory(item)
    } label: {
      HStack(spacing: 8) {
        UnpackEvidenceRow(
          icon: historyIcon(item.kind),
          title: item.label,
          detail: historyHitDetail(item)
        )
        Image(systemName: "arrow.right")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(EvidenceStyle.amberForeground)
      }
    }
    .buttonStyle(.plain)
  }

  private func repositoryQueryAction(
    _ title: String,
    icon: String,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Label(title, systemImage: icon)
        .font(.system(size: 8, weight: .semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 8)
        .frame(height: 23)
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 6))
        .overlay { RoundedRectangle(cornerRadius: 6).stroke(EvidenceStyle.separator) }
    }
    .buttonStyle(.plain)
    .disabled(model.repositoryQueryDetailLoading)
  }

  @ViewBuilder
  private var repositoryQueryDetailResults: some View {
    if model.repositoryQueryDetailLoading {
      HStack(spacing: 10) {
        ProgressView().controlSize(.small)
        Text("Rust is resolving the bounded evidence detail…")
          .font(.system(size: 10, weight: .medium))
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .premiumField()
    } else if let issue = model.repositoryQueryDetailIssue {
      Label(issue, systemImage: "exclamationmark.triangle.fill")
        .font(.system(size: 9))
        .foregroundStyle(EvidenceStyle.warning)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .premiumField()
    } else if let receipt = model.repositoryQueryDetailReceipt {
      if let explanation = receipt.graphExplanation {
        repositoryGraphExplanation(explanation)
      } else if let impact = receipt.graphImpact {
        repositoryGraphImpact(impact, receipt: receipt)
      } else if let path = receipt.graphPath {
        repositoryGraphPath(path)
      } else if let trace = receipt.historyTrace {
        repositoryHistoryTrace(trace)
      }
    } else if let origin = model.repositoryGraphPathOrigin {
      HStack(spacing: 10) {
        Image(systemName: "smallcircle.filled.circle")
          .foregroundStyle(EvidenceStyle.amberForeground)
        VStack(alignment: .leading, spacing: 2) {
          Text("PATH ORIGIN")
            .font(.system(size: 8, weight: .bold, design: .monospaced))
            .foregroundStyle(EvidenceStyle.amberForeground)
          Text(origin.label).font(.system(size: 11, weight: .semibold))
          Text("Choose Route here on a different structural match.")
            .font(.system(size: 9)).foregroundStyle(.secondary)
        }
        Spacer()
        Button("Clear") { model.repositoryGraphPathOrigin = nil }
          .buttonStyle(.plain)
          .font(.system(size: 9, weight: .semibold))
      }
      .padding(14)
      .background(EvidenceStyle.amber.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
      .overlay { RoundedRectangle(cornerRadius: 10).stroke(EvidenceStyle.amber.opacity(0.28)) }
    }
  }

  private func repositoryGraphExplanation(_ explanation: RepositoryGraphExplanation) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          PremiumFieldLabel("NODE / CANONICAL IDENTITY")
          Text(explanation.node.label).font(.system(size: 15, weight: .semibold))
          Text(explanation.node.qualifiedName ?? explanation.node.id)
            .font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
        }
        Spacer()
        UnpackMetric(
          value: "\(explanation.incomingCount)", label: "INCOMING",
          detail: explanation.incomingKinds.joined(separator: ", "))
        UnpackMetric(
          value: "\(explanation.outgoingCount)", label: "OUTGOING",
          detail: explanation.outgoingKinds.joined(separator: ", "))
      }
      HStack(spacing: 8) {
        ForEach(RepositoryGraphDirection.allCases) { direction in
          Button {
            model.repositoryImpactDirection = direction
          } label: {
            Text(direction.rawValue.capitalized)
              .font(.system(size: 8, weight: .semibold))
              .foregroundStyle(
                model.repositoryImpactDirection == direction ? Color.black : Color.secondary
              )
              .padding(.horizontal, 9)
              .frame(height: 25)
              .background(
                model.repositoryImpactDirection == direction
                  ? EvidenceStyle.amber : EvidenceStyle.surface,
                in: RoundedRectangle(cornerRadius: 6))
          }
          .buttonStyle(.plain)
        }
        Stepper(
          "Depth \(model.repositoryImpactDepth)", value: $model.repositoryImpactDepth, in: 1...12
        )
        .font(.system(size: 8, weight: .semibold))
        .frame(width: 112)
        Spacer()
        repositoryQueryAction("Set path origin", icon: "smallcircle.filled.circle") {
          model.setRepositoryGraphPathOrigin(explanation.node)
        }
        Button {
          model.queryRepositoryImpact(explanation.node)
        } label: {
          Label("Trace impact", systemImage: "scope")
        }
        .buttonStyle(.borderedProminent)
        .tint(EvidenceStyle.amber)
        .foregroundStyle(Color.black)
        .controlSize(.small)
      }
      if let source = explanation.node.sources.first {
        Text("SOURCE  \(source.path):\(source.startLine ?? 1)")
          .font(.system(size: 8, weight: .bold, design: .monospaced))
          .foregroundStyle(.secondary)
      }
    }
    .padding(16)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func repositoryGraphImpact(
    _ impact: RepositoryGraphImpactResult,
    receipt: RepositoryQueryReceipt
  ) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      UnpackDeskHeader(
        eyebrow:
          "IMPACT / \((receipt.direction ?? .outgoing).rawValue.uppercased()) · DEPTH \(receipt.depth ?? 3)",
        title: impact.root.label,
        detail:
          "\(impact.affected.count) affected nodes · \(impact.edges.count) retained relationships · \(impact.truncated ? "bounded result" : "within requested bound")"
      )
      UnpackListPanel(title: "AFFECTED NODES", count: impact.affected.count) {
        ForEach(impact.affected) { node in
          UnpackEvidenceRow(
            icon: "arrow.triangle.branch", title: node.label,
            detail: "\(node.kind) · \(node.trust) · \(node.path ?? node.id)")
        }
      }
    }
    .padding(16)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func repositoryGraphPath(_ path: RepositoryGraphPathResult) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      UnpackDeskHeader(
        eyebrow: "DIRECTED PATH / \(path.edges.count) HOPS",
        title: path.nodes.map(\.label).joined(separator: " → "),
        detail:
          "Canonical trust-weighted cost \(String(format: "%.3f", path.totalCost)) · \(path.visited) visited · \(path.truncated ? "search bound reached" : "path resolved")"
      )
      ForEach(Array(path.nodes.enumerated()), id: \.element.id) { index, node in
        HStack(alignment: .top, spacing: 10) {
          Text(String(format: "%02d", index + 1))
            .font(.system(size: 8, weight: .bold, design: .monospaced))
            .foregroundStyle(EvidenceStyle.amberForeground)
          VStack(alignment: .leading, spacing: 2) {
            Text(node.label).font(.system(size: 10, weight: .semibold))
            Text(node.path ?? node.id).font(.system(size: 8, design: .monospaced))
              .foregroundStyle(.secondary)
            if index < path.edges.count {
              Text(path.edges[index].kind.uppercased())
                .font(.system(size: 7, weight: .bold, design: .monospaced))
                .foregroundStyle(EvidenceStyle.amberForeground)
            }
          }
        }
      }
    }
    .padding(16)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func repositoryHistoryTrace(_ trace: RepositoryHistoryTrace) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      UnpackDeskHeader(
        eyebrow: "CAUSAL THREAD / EVIDENCE QUALIFIED",
        title: "\(trace.episodes.count) change episode\(trace.episodes.count == 1 ? "" : "s")",
        detail:
          "\(trace.scannedEvents) of \(trace.totalEvents) indexed events scanned · adjacency remains a lead unless the link carries evidence"
      )
      ForEach(trace.episodes) { episode in
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            PremiumFieldLabel(
              episode.stagesPresent.map { $0.uppercased() }.joined(separator: " → "))
            Spacer()
            Text("\(episode.startedAt) — \(episode.endedAt)")
              .font(.system(size: 7, design: .monospaced)).foregroundStyle(.secondary)
          }
          ForEach(episode.events) { event in
            UnpackEvidenceRow(
              icon: "waveform.path.ecg", title: event.summary,
              detail:
                "\(event.stage) · \(event.trust) · \(event.eventKind) · \(event.sourceID)")
          }
          ForEach(episode.gaps, id: \.self) { gap in
            Label(gap, systemImage: "questionmark.diamond")
              .font(.system(size: 8)).foregroundStyle(EvidenceStyle.warning)
          }
        }
        .padding(12)
        .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
      }
    }
    .padding(16)
    .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }

  private func repositoryQueryStatus(_ receipt: RepositoryQueryReceipt) -> some View {
    HStack(spacing: 8) {
      StatusPill(
        label: receipt.status == "ready" ? "\(receipt.resultCount) matches" : "index unavailable",
        color: receipt.status == "ready" ? EvidenceStyle.success : EvidenceStyle.warning
      )
      StatusPill(
        label: receipt.domain == .graph
          ? (receipt.graphStatus.stale ? "graph stale" : "graph current")
          : (receipt.historyStatus.stale ? "history stale" : "history current"),
        color: (receipt.domain == .graph ? receipt.graphStatus.stale : receipt.historyStatus.stale)
          ? EvidenceStyle.warning : EvidenceStyle.success
      )
      Text(receipt.authority.replacingOccurrences(of: "_", with: " "))
        .font(.system(size: 8, weight: .bold, design: .monospaced))
        .foregroundStyle(.secondary)
      Spacer()
      Text(
        receipt.domain == .graph
          ? "\(receipt.graphStatus.nodeCount) nodes · \(receipt.graphStatus.edgeCount) edges"
          : "\(receipt.historyStatus.eventCount) events · \(receipt.historyStatus.checkpointCount) checkpoints"
      )
      .font(.system(size: 8, design: .monospaced))
      .foregroundStyle(.secondary)
    }
  }

  private func graphHitDetail(_ hit: RepositoryGraphSearchHit) -> String {
    let source = hit.node.sources.first?.path ?? hit.node.path ?? "no source anchor"
    return
      "\(hit.node.kind) · \(hit.node.trust) · score \(hit.score) · \(hit.matchedBy) · \(source)"
  }

  private func historyHitDetail(_ item: RepositoryHistorySearchItem) -> String {
    let timestamp = item.recordedAt ?? "time unavailable"
    let source = item.sourceIDs.first ?? "no source anchor"
    return "\(item.kind) · \(item.trust) · \(timestamp) · \(item.summary) · \(source)"
  }

  private func historyIcon(_ kind: String) -> String {
    switch kind {
    case "release": "tag"
    case "commit": "point.topleft.down.to.point.bottomright.curvepath"
    case "entity": "cube.transparent"
    case "event": "waveform.path.ecg"
    default: "note.text"
    }
  }

  private func analysisDesk(_ inventory: UnpackInventory) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        UnpackDeskHeader(
          eyebrow: "ANALYSIS / DETERMINISTIC LEADS",
          title: "Health signals stay separate from proof",
          detail: inventory.health.summary
        )
        HStack(spacing: 8) {
          UnpackMetric(
            value: String(format: "%.1f", inventory.health.averageScore),
            label: "AVERAGE HEALTH", detail: "heuristic score")
          UnpackMetric(
            value: "\(inventory.health.hotspotCount)", label: "HOTSPOTS",
            detail: "review leads")
          UnpackMetric(
            value: "\(inventory.health.filesWithTestSignal)", label: "TEST SIGNALS",
            detail: "\(inventory.health.filesAnalyzed) analyzed")
        }
        UnpackListPanel(title: "HEALTH LEADS", count: inventory.health.topFiles.count) {
          ForEach(inventory.health.topFiles.prefix(80)) { file in
            UnpackEvidenceRow(
              icon: "waveform.path.ecg",
              title: file.path,
              detail:
                "\(file.bucket) · score \(String(format: "%.1f", file.score)) · churn \(file.churn) · \(file.hasTestSignal ? "test signal" : "no adjacent test")"
            )
          }
        }
        HStack(alignment: .top, spacing: 12) {
          UnpackListPanel(title: "COVERAGE LIMITS", count: inventory.coverage.notes.count) {
            ForEach(inventory.coverage.notes, id: \.self) { note in
              UnpackEvidenceRow(icon: "scope", title: note, detail: inventory.coverage.strategy)
            }
          }
          UnpackListPanel(title: "VERIFICATION LEADS", count: inventory.history.testHints.count) {
            ForEach(inventory.history.testHints.prefix(40)) { hint in
              UnpackEvidenceRow(icon: "checkmark.diamond", title: hint.path, detail: hint.reason)
            }
          }
        }
      }
      .padding(18)
    }
  }

  private func rulesDesk(_ inventory: UnpackInventory) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        UnpackDeskHeader(
          eyebrow: "RULES / OBSERVED CONFIGURATION",
          title: "Files and scripts, not invented policy",
          detail:
            "This desk points to observed manifests, configuration, and documentation. Read the cited source before treating any convention as binding."
        )
        HStack(alignment: .top, spacing: 12) {
          UnpackListPanel(title: "MANIFEST SCRIPTS", count: inventory.manifests.count) {
            ForEach(inventory.manifests.prefix(40)) { manifest in
              UnpackEvidenceRow(
                icon: "terminal",
                title: manifest.path,
                detail:
                  manifest.scripts.isEmpty
                  ? "No declared scripts observed"
                  : manifest.scripts.prefix(6).joined(separator: " · ")
              )
            }
          }
          UnpackListPanel(title: "CONFIGURATION", count: inventory.configFiles.count) {
            ForEach(inventory.configFiles.prefix(80), id: \.self) { path in
              UnpackEvidenceRow(
                icon: "gearshape.2", title: path,
                detail: "Observed file · inspect before editing")
            }
          }
        }
        UnpackListPanel(title: "DOCUMENTATION SOURCES", count: inventory.documents.count) {
          ForEach(inventory.documents.prefix(50)) { document in
            UnpackEvidenceRow(
              icon: "doc.text",
              title: document.path,
              detail:
                "\(ByteCountFormatter.string(fromByteCount: Int64(document.bytes), countStyle: .file)) · bounded preview available"
            )
          }
        }
      }
      .padding(18)
    }
  }

  private func handoffDesk(_ inventory: UnpackInventory, report: UnpackReport?) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 12) {
        UnpackDeskHeader(
          eyebrow: "HANDOFF / SOURCE-QUALIFIED CONTEXT",
          title: report?.agentHandoff?.title ?? "Deterministic starting map",
          detail:
            report?.agentHandoff?.summary
            ?? "No model-labelled handoff is attached. The starting points below come directly from the stored inventory and history leads."
        )
        if let handoff = report?.agentHandoff {
          UnpackBriefSectionCard(sectionID: "agent-handoff-desk", section: handoff)
        }
        HStack(alignment: .top, spacing: 12) {
          UnpackListPanel(title: "START HERE", count: inventory.entrypoints.count) {
            ForEach(inventory.entrypoints.prefix(40)) { entry in
              UnpackEvidenceRow(icon: "arrow.right.square", title: entry.path, detail: entry.reason)
            }
          }
          UnpackListPanel(title: "VERIFY NEXT", count: inventory.history.testHints.count) {
            ForEach(inventory.history.testHints.prefix(40)) { hint in
              UnpackEvidenceRow(icon: "checkmark.diamond", title: hint.path, detail: hint.reason)
            }
          }
        }
        if let prompt = report?.agentPrompt, !prompt.isEmpty {
          VStack(alignment: .leading, spacing: 9) {
            PremiumFieldLabel("RECORDED AGENT PROMPT")
            Text(prompt)
              .font(.system(size: 9, design: .monospaced))
              .textSelection(.enabled)
          }
          .padding(16)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 12))
          .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
        }
      }
      .padding(18)
    }
  }

  @ViewBuilder
  private func deltaDesk(_ snapshot: UnpackSnapshotRecord) -> some View {
    if let comparison = model.unpackComparison {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          UnpackDeskHeader(
            eyebrow: "DELTA / BOUNDED GIT EVIDENCE",
            title: "\(comparison.commitCount) commits between retained snapshots",
            detail:
              "\(String(comparison.baseCommit.prefix(12))) → \(String(comparison.headCommit.prefix(12))). Commit subjects and numstat are leads, not proof that behavior changed correctly."
          )
          HStack(spacing: 8) {
            UnpackMetric(
              value: "\(comparison.commitCount)", label: "COMMITS",
              detail: comparison.truncated ? "first 24 shown" : "complete recorded range")
            UnpackMetric(
              value: compactCount(comparison.commits.reduce(0) { $0 + Int($1.additions) }),
              label: "ADDITIONS", detail: "git numstat")
            UnpackMetric(
              value: compactCount(comparison.commits.reduce(0) { $0 + Int($1.deletions) }),
              label: "DELETIONS", detail: "git numstat")
          }
          UnpackListPanel(title: "COMMITS", count: comparison.commits.count) {
            ForEach(comparison.commits) { commit in
              UnpackEvidenceRow(
                icon: "arrow.triangle.branch",
                title: commit.subject,
                detail:
                  "\(String(commit.sha.prefix(10))) · \(commit.date) · +\(commit.additions) −\(commit.deletions) · \(commit.files.count) files"
              )
            }
          }
        }
        .padding(18)
      }
    } else {
      ContentUnavailableView {
        Label("Compare retained snapshots", systemImage: "arrow.left.arrow.right")
      } description: {
        Text(
          model.unpackComparisonCandidate == nil
            ? "No older snapshot for this repository records a different concrete commit."
            : "Build a bounded Git range from the selected snapshot and its previous retained commit."
        )
      } actions: {
        Button("Compare with previous snapshot") { model.compareUnpackWithPrevious() }
          .buttonStyle(.borderedProminent)
          .tint(EvidenceStyle.amber)
          .foregroundStyle(Color.black)
          .disabled(!model.canCompareUnpackSnapshot)
          .accessibilityIdentifier("repo-unpack-compare")
      }
    }
  }

  private func chooseExport(_ format: UnpackExportFormat) {
    guard let snapshot = model.unpackSnapshot else { return }
    let panel = NSSavePanel()
    panel.allowedContentTypes = [UTType(filenameExtension: format.pathExtension) ?? .data]
    panel.canCreateDirectories = true
    panel.isExtensionHidden = false
    panel.nameFieldStringValue =
      "\(snapshot.repoName)-\(String(snapshot.id.prefix(8))).\(format.pathExtension)"
    panel.message = "Save the Rust-rendered snapshot export without reinterpreting its evidence."
    guard panel.runModal() == .OK, let destination = panel.url else { return }
    model.exportUnpackSnapshot(format, to: destination)
  }
}

private struct UnpackDeskHeader: View {
  let eyebrow: String
  let title: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(eyebrow)
        .font(.system(size: 8, weight: .bold, design: .monospaced))
        .tracking(0.9)
        .foregroundStyle(EvidenceStyle.amberForeground)
      Text(title).font(.system(size: 20, weight: .semibold))
      Text(detail).font(.system(size: 10)).foregroundStyle(.secondary)
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 14))
    .overlay { RoundedRectangle(cornerRadius: 14).stroke(EvidenceStyle.separator) }
  }
}

private struct UnpackListPanel<Content: View>: View {
  let title: String
  let count: Int
  let content: Content

  init(title: String, count: Int, @ViewBuilder content: () -> Content) {
    self.title = title
    self.count = count
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        PremiumFieldLabel(title)
        Spacer()
        Text("\(count)")
          .font(.system(size: 8, weight: .semibold, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      .padding(14)
      Divider()
      if count == 0 {
        Text("No recorded evidence in this bounded snapshot.")
          .font(.system(size: 9))
          .foregroundStyle(.secondary)
          .padding(14)
      } else {
        LazyVStack(alignment: .leading, spacing: 0) { content }
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }
}

private struct UnpackEvidenceRow: View {
  let icon: String
  let title: String
  let detail: String

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: icon)
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(EvidenceStyle.amberForeground)
        .frame(width: 17)
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 9, weight: .medium))
          .lineLimit(2)
        Text(detail)
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .overlay(alignment: .bottom) { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }
  }
}

private struct UnpackBriefSectionCard: View {
  let sectionID: String
  let section: UnpackReportSection

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        PremiumFieldLabel(sectionID.replacingOccurrences(of: "-", with: " ").uppercased())
        Spacer()
        Text("\(section.claims.count) claims")
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
      }
      Text(section.title).font(.system(size: 15, weight: .semibold))
      Text(section.summary).font(.system(size: 10)).foregroundStyle(.secondary)
      ForEach(section.claims.prefix(30)) { claim in
        VStack(alignment: .leading, spacing: 4) {
          Text(claim.claim).font(.system(size: 9, weight: .medium))
          Text(claim.sources.prefix(4).joined(separator: " · "))
            .font(.system(size: 8, design: .monospaced))
            .foregroundStyle(EvidenceStyle.amberForeground)
            .lineLimit(2)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).stroke(EvidenceStyle.separator) }
      }
    }
    .padding(16)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }
}

private struct UnpackSnapshotRow: View {
  let snapshot: UnpackSnapshotSummary
  let selected: Bool

  var body: some View {
    HStack(spacing: 10) {
      RoundedRectangle(cornerRadius: 2)
        .fill(selected ? EvidenceStyle.amber : Color.primary.opacity(0.12))
        .frame(width: 3, height: 38)
      VStack(alignment: .leading, spacing: 3) {
        HStack {
          Text(snapshot.repoName).font(.system(size: 10, weight: .semibold))
          Spacer()
          Text(snapshot.status.replacingOccurrences(of: "_", with: " "))
            .font(.system(size: 7, weight: .bold, design: .monospaced))
            .foregroundStyle(
              snapshot.errorMessage == nil ? EvidenceStyle.success : EvidenceStyle.warning)
        }
        Text(snapshot.repoPath)
          .font(.system(size: 8, design: .monospaced))
          .foregroundStyle(.secondary)
          .lineLimit(1)
        HStack {
          Text("\(snapshot.filesScanned) files")
          Spacer()
          Text(snapshot.commitSHA.map { String($0.prefix(7)) } ?? "no commit")
        }
        .font(.system(size: 7, design: .monospaced))
        .foregroundStyle(.secondary)
      }
    }
    .padding(10)
    .background(
      selected ? EvidenceStyle.amber.opacity(0.08) : Color.clear,
      in: RoundedRectangle(cornerRadius: 10)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 10).stroke(
        selected ? EvidenceStyle.amber.opacity(0.24) : EvidenceStyle.separator)
    }
  }
}

private struct UnpackMetric: View {
  let value: String
  let label: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(value).font(.system(size: 23, weight: .medium, design: .rounded))
      PremiumFieldLabel(label)
      Text(detail).font(.system(size: 8)).foregroundStyle(.secondary).lineLimit(1)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
  }
}

private struct UnpackIdentity: View {
  let label: String
  let value: String

  var body: some View {
    VStack(alignment: .trailing, spacing: 3) {
      PremiumFieldLabel(label)
      Text(value).font(.system(size: 9, weight: .medium, design: .monospaced))
    }
  }
}

private func compactCount(_ value: Int) -> String {
  value >= 1_000 ? String(format: "%.1fK", Double(value) / 1_000) : String(value)
}

private func byteCount(_ value: Int) -> String {
  ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
}
