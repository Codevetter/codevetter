import SwiftUI
import UniformTypeIdentifiers

struct NavigatorWorkspaceView: View {
  @Bindable var model: WorkbenchModel
  let mode: NavigatorMode
  @State private var inspectorVisible = true
  @State private var quickIndex = 0
  @FocusState private var quickFocused: Bool
  @FocusState private var searchFocused: Bool
  private var navigator: NavigatorModel { model.navigator }

  var body: some View {
    @Bindable var nav = navigator
    VStack(spacing: 0) {
      if nav.snapshot == nil {
        landing
      } else {
        toolbar
        divider
        if mode == .review {
          NavigatorReviewScopeBar(model: model)
          divider
        }
        HStack(spacing: 0) {
          sidebar.frame(width: 240)
          Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
          source.frame(maxWidth: .infinity, maxHeight: .infinity)
          if inspectorVisible {
            Rectangle().fill(EvidenceStyle.separator).frame(width: 1)
            inspector.frame(width: 290)
          }
        }
        divider
        statusBar
      }
    }
    .background(EvidenceStyle.canvas)
    .task {
      model.openSelectedRepositoryIfNeeded(review: mode == .review)
    }
    .sheet(isPresented: $nav.quickOpenPresented) { quickOpen }
    .sheet(isPresented: $nav.showFullUnpack) {
      PremiumUnpackView(model: model).frame(minWidth: 980, minHeight: 640)
    }
    .fileImporter(isPresented: $model.choosingRepository, allowedContentTypes: [.folder]) { result in
      guard case .success(let url) = result else { return }
      model.selectRepository(url)
      nav.open(url.path, review: mode == .review)
    }
    .background {
      Button("Find file") {
        nav.quickOpenPresented = true
        nav.quickFind()
      }.keyboardShortcut("p", modifiers: .command).hidden()
      Button("Search repository") { nav.searchPresented.toggle() }.keyboardShortcut(
        "f", modifiers: [.command, .shift]
      ).hidden()
      Button("File symbols") {
        nav.inspector = .symbols
        nav.search(operation: "symbols", query: "")
      }.keyboardShortcut("o", modifiers: [.command, .shift]).hidden()
      Button("Go back") { nav.navigate(back: true) }.keyboardShortcut("[", modifiers: .command)
        .hidden()
      Button("Go forward") { nav.navigate(back: false) }.keyboardShortcut("]", modifiers: .command)
        .hidden()
    }
    .task(id: "\(nav.snapshot?.id ?? 0):\(nav.status?.done ?? false):\(model.isBusy)") {
      guard nav.status?.done == true, nav.input.hasPrefix("https://github.com/"),
        !nav.automaticUnpackStarted, !model.isBusy, !model.unpackLoading
      else { return }
      nav.automaticUnpackStarted = true
      do {
        let root = try await nav.prepareUnpack()
        guard !Task.isCancelled else { return }
        model.selectRepository(URL(fileURLWithPath: root), persist: false)
        model.scanUnpackRepository()
      } catch { if !Task.isCancelled { nav.enrichmentIssue = error.localizedDescription } }
    }
    .onChange(of: nav.snapshot?.id) {
      guard let snapshot = nav.snapshot else { return }
      if snapshot.kind == "pull" || snapshot.kind == "commit" && snapshot.base != nil {
        model.section = .review
      } else if snapshot.kind != "local" {
        model.section = .repository
      }
      if !nav.input.hasPrefix("https:") {
        model.selectRepository(URL(fileURLWithPath: snapshot.root), persist: false)
        model.loadUnpackSnapshots()
      }
    }
  }

  private var landing: some View {
    @Bindable var nav = navigator
    return VStack(alignment: .leading, spacing: 24) {
      Spacer()
      Label("READ · UNDERSTAND · VERIFY", systemImage: "curlybraces")
        .font(.system(size: 11, weight: .semibold, design: .monospaced))
        .foregroundStyle(EvidenceStyle.amberForeground)
      VStack(alignment: .leading, spacing: 10) {
        Text("Get close to the code.").font(.system(size: 32, weight: .semibold))
          .accessibilityIdentifier("navigator-workspace")
        Text(
          "Open a repository or a change. Follow the source, understand the system, inspect the evidence."
        )
        .font(.system(size: 14)).foregroundStyle(.secondary).fixedSize(
          horizontal: false, vertical: true)
      }
      VStack(alignment: .leading, spacing: 10) {
        Text("Paste GitHub URL").font(.system(size: 13, weight: .semibold))
        HStack(spacing: 10) {
          Image(systemName: "link").foregroundStyle(.secondary)
          TextField("https://github.com/owner/repo", text: $nav.input)
            .textFieldStyle(.plain).font(.system(size: 13, design: .monospaced))
            .onSubmit { nav.open(review: mode == .review) }.accessibilityIdentifier(
              "navigator-github-url")
          Button {
            nav.open(review: mode == .review)
          } label: {
            Label(nav.opening ? "Opening…" : "Open", systemImage: "arrow.right")
          }.buttonStyle(PremiumPrimaryButtonStyle()).disabled(
            nav.opening || nav.input.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(12).background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 6))
        .overlay { RoundedRectangle(cornerRadius: 6).stroke(EvidenceStyle.separator) }
        Text(
          "Repository, pull request, commit, branch, or file · Public repositories need no account"
        )
        .font(.system(size: 11)).foregroundStyle(.secondary)
      }
      if nav.opening {
        HStack {
          ProgressView().controlSize(.small)
          Text("Resolving the revision and fetching source…")
          Spacer()
          Button("Cancel") { nav.cancelImport() }
        }
        .font(.system(size: 12))
      }
      if let issue = nav.issue {
        Label(issue, systemImage: "exclamationmark.triangle").font(.system(size: 12))
          .foregroundStyle(EvidenceStyle.warning).textSelection(.enabled)
      }
      HStack(spacing: 20) {
        Button("Open local repository…", systemImage: "folder") { model.choosingRepository = true }
        Button("Verify a local change", systemImage: "checkmark.shield") {
          nav.showVerification = true
          model.section = .review
        }
      }.buttonStyle(.borderless).font(.system(size: 12))
      HStack(alignment: .top, spacing: 32) {
        landingNote(
          "Review", detail: "Exact changes and source-linked findings", icon: "square.split.2x1")
        landingNote("Explore", detail: "Files, search, and source navigation", icon: "folder")
        landingNote("Unpack", detail: "Architecture beside the code", icon: "shippingbox")
      }.padding(.top, 22)
      Spacer()
      Text("Read-only by design. Repository code does not run when you open it.")
        .font(.system(size: 11)).foregroundStyle(.secondary)
    }
    .frame(maxWidth: 720, alignment: .leading).padding(40).frame(
      maxWidth: .infinity, maxHeight: .infinity)
  }

  private func landingNote(_ title: String, detail: String, icon: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(title, systemImage: icon).font(.system(size: 12, weight: .semibold))
      Text(detail).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(
        horizontal: false, vertical: true)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }

  private var toolbar: some View {
    @Bindable var nav = navigator
    return HStack(spacing: 12) {
      Menu {
        Button("Open GitHub URL…") { nav.showImport() }
        Button("Open local repository…") { model.choosingRepository = true }
        Button("Refresh source snapshot") { nav.refreshSource(review: mode == .review) }
      } label: {
        Label(nav.snapshot?.label ?? "Repository", systemImage: "folder")
      }
      .menuStyle(.borderlessButton).font(.system(size: 12, weight: .semibold)).frame(
        maxWidth: 250, alignment: .leading)
      Text(String(nav.snapshot?.head.prefix(12) ?? ""))
        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).textSelection(
          .enabled
        )
        .help(nav.snapshot?.head ?? "")
      Text(nav.snapshot?.kind == "local" ? "Worktree snapshot" : "Pinned revision")
        .font(.system(size: 10)).foregroundStyle(.secondary)
      Spacer(minLength: 4)
      Button {
        nav.quickOpenPresented = true
        nav.quickFind()
      } label: {
        Label("Find file  ⌘P", systemImage: "magnifyingglass")
      }
      if mode != .review {
        Button {
          model.section = .review
        } label: {
          Label("Review change", systemImage: "checkmark.shield")
        }
      }
      Button {
        inspectorVisible.toggle()
      } label: {
        Image(systemName: "sidebar.right")
      }.help("Toggle understanding panel")
    }
    .buttonStyle(.borderless).padding(.horizontal, 16).frame(height: 48).background(
      EvidenceStyle.chrome)
  }

  private var sidebar: some View {
    @Bindable var nav = navigator
    return VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text(mode == .review && nav.canReview ? "CHANGED FILES" : "REPOSITORY").font(
          .system(size: 10, weight: .semibold))
        Spacer()
        Button {
          nav.searchPresented.toggle()
        } label: {
          Image(systemName: "magnifyingglass")
        }.buttonStyle(.plain).help("Search source · ⇧⌘F")
      }.foregroundStyle(.secondary).padding(14)
      if nav.searchPresented {
        TextField("Search code", text: $nav.searchQuery).textFieldStyle(.roundedBorder).padding(
          .horizontal, 10
        )
        .focused($searchFocused)
        .task {
          await Task.yield()
          searchFocused = true
        }
        .onChange(of: nav.searchQuery) { nav.search() }.onSubmit { nav.search() }
        if nav.locations.truncated == true { Text("First 300 matches").font(.caption).padding(10) }
        locationList(nav.locations.locations)
        if let qualification = nav.locations.qualification {
          Text(qualification).font(.system(size: 10)).foregroundStyle(.secondary).padding(10)
        }
      } else if mode == .review && nav.canReview {
        ScrollView {
          LazyVStack(spacing: 1) {
            ForEach(nav.changedFiles) { entry in fileButton(entry.path, status: entry.status) }
          }.padding(.vertical, 4)
        }
        if nav.changedFiles.isEmpty {
          Text("No changes in this snapshot").font(.caption).foregroundStyle(.secondary).padding(14)
        }
        Button("Explore all files", systemImage: "folder") {
          model.section = .repository
          nav.setPresentation("Source")
        }.buttonStyle(.borderless).padding(14)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 1) {
            ForEach(treeRows, id: \.path) { row in
              if row.folder {
                Button {
                  if !nav.expandedFolders.insert(row.path).inserted {
                    nav.expandedFolders.remove(row.path)
                  }
                } label: {
                  Label(
                    row.path.split(separator: "/").last.map(String.init) ?? row.path,
                    systemImage: nav.expandedFolders.contains(row.path)
                      ? "chevron.down" : "chevron.right"
                  )
                  .font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                  .padding(.leading, CGFloat(row.depth * 12 + 10)).frame(height: 27).frame(
                    maxWidth: .infinity, alignment: .leading
                  ).contentShape(Rectangle())
                }.buttonStyle(.plain)
              } else {
                fileButton(row.path, compact: true).padding(.leading, CGFloat(row.depth * 12))
              }
            }
          }.padding(.vertical, 4)
        }
      }
    }.background(EvidenceStyle.chrome)
  }

  private struct TreeRow {
    let path: String
    let depth: Int
    let folder: Bool
  }
  private var treeRows: [TreeRow] {
    var rows: [TreeRow] = []
    var seen: Set<String> = []
    for entry in navigator.snapshot?.files ?? [] where entry.status != "D" {
      let parts = entry.path.split(separator: "/")
      var prefix = ""
      var visible = true
      for (depth, part) in parts.enumerated() {
        prefix = prefix.isEmpty ? String(part) : prefix + "/" + part
        let folder = depth < parts.count - 1
        if visible, seen.insert(prefix).inserted {
          rows.append(TreeRow(path: prefix, depth: depth, folder: folder))
        }
        if folder && !navigator.expandedFolders.contains(prefix) { visible = false }
      }
    }
    return rows
  }

  private func fileButton(_ path: String, status: String = "", compact: Bool = false) -> some View {
    Button {
      navigator.select(path)
    } label: {
      HStack(spacing: 7) {
        Image(systemName: "doc.text").foregroundStyle(.secondary)
        Text(compact ? path.split(separator: "/").last.map(String.init) ?? path : path).lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 2)
        if !status.isEmpty {
          Text(status).foregroundStyle(
            status == "D" ? EvidenceStyle.failure : EvidenceStyle.amberForeground)
        }
      }.font(.system(size: 11, design: .monospaced)).padding(.horizontal, 10).frame(height: 28)
        .background(navigator.selectedPath == path ? EvidenceStyle.amber.opacity(0.10) : .clear)
        .contentShape(Rectangle())
    }.buttonStyle(.plain).help(path).accessibilityLabel("Open \(path)")
  }

  private var source: some View {
    @Bindable var nav = navigator
    return VStack(spacing: 0) {
      HStack(spacing: 8) {
        Button {
          nav.navigate(back: true)
        } label: {
          Image(systemName: "chevron.left")
        }.disabled(nav.historyBack.isEmpty)
        Button {
          nav.navigate(back: false)
        } label: {
          Image(systemName: "chevron.right")
        }.disabled(nav.historyForward.isEmpty)
        Text(nav.selectedPath.replacingOccurrences(of: "/", with: " › ")).font(
          .system(size: 11, design: .monospaced)
        ).lineLimit(1).truncationMode(.middle)
        Spacer()
        if nav.canReview {
          Picker(
            "Source or diff",
            selection: Binding(get: { nav.presentation }, set: { nav.setPresentation($0) })
          ) {
            Text("Source").tag("Source")
            Text("Diff").tag("Diff")
          }.pickerStyle(.segmented).labelsHidden().controlSize(.small).frame(width: 125, height: 24)
        }
      }.buttonStyle(.borderless).padding(.horizontal, 12).frame(height: 38)
      divider
      HStack(spacing: 12) {
        if nav.presentation == "Diff" {
          Toggle("Split", isOn: $nav.split).toggleStyle(.checkbox)
          Button("Expand context") { nav.expandContext() }.disabled(nav.context >= 10000)
          Text(
            "\(String(nav.snapshot?.base?.prefix(8) ?? nav.snapshot?.head.prefix(8) ?? "")) → \(String(nav.snapshot?.head.prefix(8) ?? ""))"
          ).foregroundStyle(.secondary)
        } else {
          if nav.canReview {
            Picker("Revision", selection: Binding(get: { nav.side }, set: { nav.setSide($0) })) {
              Text("Base").tag("base")
              Text("Head").tag("head")
            }.pickerStyle(.segmented).labelsHidden().controlSize(.small).frame(
              width: 112, height: 24)
          }
          Text(
            nav.file.map { "\($0.totalLines) lines · \($0.bytes.formatted()) bytes" } ?? "Source"
          )
          .foregroundStyle(.secondary)
          Spacer()
          Text("Read only").foregroundStyle(.secondary)
        }
      }.font(.system(size: 10, design: .monospaced)).buttonStyle(.borderless).padding(
        .horizontal, 12
      ).frame(height: 32)
      divider
      if let issue = nav.issue {
        ContentUnavailableView(
          "Source unavailable", systemImage: "doc.questionmark", description: Text(issue)
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if nav.file?.binary == true && nav.presentation == "Source"
        || nav.diff?.binary == true && nav.presentation == "Diff"
      {
        ContentUnavailableView(
          "Binary file", systemImage: "doc",
          description: Text("Its Git identity is preserved. Text rendering is unavailable."))
      } else if nav.loadingFile {
        ProgressView("Reading source…").frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        NavigatorSourceView(
          file: nav.presentation == "Source" ? nav.file : nil,
          diff: nav.presentation == "Diff" ? nav.diff : nil,
          split: nav.presentation == "Diff" && nav.split, selectedLine: nav.selectedLine,
          documentIdentity: "\(nav.snapshot?.id ?? 0):\(nav.selectedPath):\(nav.context)",
          refreshToken: nav.refreshToken,
          findings: matchingFindings,
          onWindow: { line in Task { await nav.loadWindow(line: line) } },
          onSymbol: { _, operation, line, column in
            nav.resolveSymbol(operation: operation, line: line, column: column)
          },
          onLine: { nav.selectedLine = $0 })
        if nav.presentation == "Diff", nav.diff?.rows.isEmpty == true {
          Text("No diff for this file. Open Source to read the full file.").font(.caption)
            .foregroundStyle(.secondary).padding(12)
        }
        if nav.diff?.truncated == true, nav.presentation == "Diff" {
          Text("Diff display limit reached. Use Source to browse remaining lines.").font(.caption)
            .foregroundStyle(EvidenceStyle.warning).padding(8)
        }
        if let finding = matchingFindings.first(where: { $0.line == nav.selectedLine }) {
          VStack(alignment: .leading, spacing: 5) {
            Label("\(finding.severity) · \(finding.title)", systemImage: "exclamationmark.bubble")
              .font(.system(size: 12, weight: .semibold))
            Text(finding.summary).font(.system(size: 11)).foregroundStyle(.secondary)
          }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(
            EvidenceStyle.inspector)
        }
      }
    }
  }

  private var matchingFindings: [VerificationFinding] {
    guard let receipt = model.receipt, let snapshot = navigator.snapshot,
      receipt.repoPath == snapshot.root, receipt.source.headSha == snapshot.head,
      snapshot.kind != "local"
    else { return [] }
    return receipt.reviewFindings.filter { $0.filePath == navigator.selectedPath }
  }

  private var inspector: some View {
    @Bindable var nav = navigator
    return VStack(alignment: .leading, spacing: 0) {
      Picker("Understanding panel", selection: $nav.inspector) {
        ForEach(NavigatorInspector.allCases, id: \.self) { Text($0.rawValue).tag($0) }
      }.pickerStyle(.segmented).labelsHidden().controlSize(.small).frame(height: 24).padding(10)
        .onChange(of: nav.inspector) {
          if nav.inspector == .symbols { nav.search(operation: "symbols", query: "") }
          if nav.inspector == .history { nav.inspectHistory() }
        }
      divider
      switch nav.inspector {
      case .unpack:
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            Text("Understand this repository").font(.system(size: 14, weight: .semibold))
            Text(
              "Follow the repository’s own architecture, instructions, and entry points straight into source."
            )
            .font(.system(size: 11)).foregroundStyle(.secondary)
            existingUnpack
            if let overview = nav.overview {
              ForEach(Array(Set(overview.locations.map(\.kind))).sorted(), id: \.self) { kind in
                VStack(alignment: .leading, spacing: 6) {
                  Text(kind.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(
                    .secondary)
                  ForEach(overview.locations.filter { $0.kind == kind }.prefix(12)) { location in
                    locationButton(location)
                  }
                }
              }
              if !overview.dependencies.isEmpty {
                DisclosureGroup("Dependency declarations") {
                  ForEach(overview.dependencies.prefix(40)) { location in locationButton(location) }
                }.font(.system(size: 11))
              }
              Text(overview.qualification).font(.system(size: 10)).foregroundStyle(.secondary)
            } else {
              ProgressView("Mapping important source…").controlSize(.small)
            }
            Button(
              nav.preparingUnpack || model.unpackLoading ? "Unpacking…" : "Unpack this revision",
              systemImage: "shippingbox"
            ) {
              Task {
                do {
                  let root = try await nav.prepareUnpack()
                  guard !Task.isCancelled else { return }
                  model.selectRepository(URL(fileURLWithPath: root), persist: false)
                  model.scanUnpackRepository()
                } catch { nav.enrichmentIssue = error.localizedDescription }
              }
            }.buttonStyle(.borderless).font(.system(size: 11))
              .disabled(nav.preparingUnpack || model.unpackLoading || nav.status?.done != true)
            if let status = nav.status, status.skipped > 0 {
              Text(
                "Unpack covers \(status.indexed) indexed text files. \(status.skipped) binary, protected, or oversized files are excluded."
              )
              .font(.system(size: 10)).foregroundStyle(.secondary)
            }
            if model.hasMatchingUnpack {
              Button("Full Unpack details") { nav.showFullUnpack = true }.buttonStyle(.borderless)
                .font(.system(size: 11))
            }
          }.padding(14)
        }
      case .symbols:
        Text("JavaScript / TypeScript declarations").font(.system(size: 10)).foregroundStyle(
          .secondary
        ).padding(12)
        locationList(nav.locations.locations)
        if nav.locations.locations.isEmpty {
          Text("No indexed declarations in this file yet.").font(.caption).foregroundStyle(
            .secondary
          ).padding(12)
        }
      case .evidence:
        ScrollView {
          VStack(alignment: .leading, spacing: 12) {
            Text("CodeVetter evidence").font(.system(size: 13, weight: .semibold))
            if let receipt = model.receipt {
              Text("Recorded revision \(receipt.source.headSha.prefix(12))").font(
                .system(size: 10, design: .monospaced)
              ).foregroundStyle(.secondary)
              ForEach(receipt.reviewFindings) { finding in
                Button {
                  if let path = finding.filePath {
                    model.openNavigatorSource(path: path, line: finding.line, receipt: receipt)
                  }
                } label: {
                  VStack(alignment: .leading, spacing: 5) {
                    Text("\(finding.severity) · \(finding.title)").font(
                      .system(size: 11, weight: .medium))
                    Text(finding.filePath ?? "No source location").font(
                      .system(size: 10, design: .monospaced)
                    ).foregroundStyle(.secondary)
                  }.frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).disabled(finding.filePath == nil)
              }
              ForEach(navigatorRuntimeLocations(receipt)) { location in
                Button {
                  model.openNavigatorSource(
                    path: location.path, line: location.line, receipt: receipt)
                } label: {
                  Label(location.text, systemImage: "testtube.2").font(
                    .system(size: 10, design: .monospaced))
                }.buttonStyle(.borderless)
              }
            } else {
              Text(
                "No verification receipt is attached. Browsing and source structure do not establish a pass."
              ).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Button("Open verification", systemImage: "checkmark.shield") {
              nav.showVerification = true
              model.section = .review
            }.buttonStyle(.borderless)
          }.padding(14)
        }
      case .history:
        HStack {
          Button("Commits") { nav.inspectHistory() }
          Button("Blame here") { nav.inspectHistory(blame: true) }
        }.buttonStyle(.borderless).padding(12)
        ScrollView {
          if let history = nav.history {
            VStack(alignment: .leading, spacing: 12) {
              Text(history.text.isEmpty ? "No available history" : history.text).font(
                .system(size: 10, design: .monospaced)
              ).textSelection(.enabled)
              Text(history.qualification).font(.system(size: 10)).foregroundStyle(.secondary)
            }.padding(12)
          }
        }
      }
      Spacer(minLength: 0)
      if let issue = nav.enrichmentIssue {
        Text(issue).font(.system(size: 10)).foregroundStyle(EvidenceStyle.warning).padding(10)
      }
    }.background(EvidenceStyle.inspector)
  }

  private func locationList(_ locations: [NavigatorLocation]) -> some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10) {
        ForEach(locations) { location in locationButton(location) }
      }.padding(12)
    }
  }

  @ViewBuilder private var existingUnpack: some View {
    if model.hasMatchingUnpack {
      if let report = model.unpackReport {
        if let overview = report.overview {
          Text(overview).font(.system(size: 11)).foregroundStyle(.secondary)
        }
        ForEach(
          [report.systemMap, report.dataFlow, report.behaviorTraces, report.extensionPoints]
            .compactMap { $0 }, id: \.title
        ) { section in
          DisclosureGroup(section.title) {
            Text(section.summary).font(.system(size: 11)).foregroundStyle(.secondary)
            ForEach(section.claims) { claim in
              Text(claim.claim).font(.system(size: 11))
              ForEach(claim.sources, id: \.self) { source in unpackSourceButton(source) }
            }
          }.font(.system(size: 12, weight: .medium))
        }
      }
      if let inventory = model.unpackInventory {
        ForEach(inventory.workspaceUnits.prefix(12)) { unit in
          VStack(alignment: .leading, spacing: 5) {
            Text(unit.name).font(.system(size: 12, weight: .semibold))
            Text("\(unit.kind) · \(unit.fileCount) files").font(.system(size: 10)).foregroundStyle(
              .secondary)
            if let path = unit.manifestPath { unpackSourceButton(path) }
            ForEach(unit.entrypoints, id: \.self) { path in unpackSourceButton(path) }
          }
        }
        if !inventory.history.summary.isEmpty {
          Text(inventory.history.summary).font(.system(size: 11)).foregroundStyle(.secondary)
        }
        ForEach(inventory.history.decisions.prefix(8)) { decision in
          Text(decision.text).font(.system(size: 11))
          unpackSourceButton(decision.source)
        }
      }
    }
  }

  private func unpackSourceButton(_ source: String) -> some View {
    let parts = source.split(separator: ":")
    let path = parts.first.map(String.init) ?? source
    let line = parts.count > 1 ? Int(parts[1]) ?? 1 : 1
    return Button(source) {
      navigator.jump(NavigatorLocation(path: path, line: line, text: source, kind: "Unpack source"))
    }
    .buttonStyle(.borderless).font(.system(size: 10, design: .monospaced))
    .disabled(navigator.snapshot?.files.contains(where: { $0.path == path }) != true)
  }

  private func locationButton(_ location: NavigatorLocation) -> some View {
    Button {
      navigator.jump(location)
    } label: {
      VStack(alignment: .leading, spacing: 3) {
        Text(location.text).font(.system(size: 11)).lineLimit(2).multilineTextAlignment(.leading)
        Text("\(location.path):\(location.line)").font(.system(size: 9, design: .monospaced))
          .foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
      }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
    }.buttonStyle(.plain).help("Open \(location.path) at line \(location.line)")
  }

  private var statusBar: some View {
    HStack(spacing: 12) {
      Image(
        systemName: navigator.status?.done == true
          ? "checkmark.circle" : "arrow.triangle.2.circlepath"
      ).foregroundStyle(.secondary)
      Text(navigator.indexLabel).foregroundStyle(.secondary)
      Spacer()
      if let blob = navigator.file?.blob {
        Text("blob \(blob.prefix(12))").textSelection(.enabled).help(blob)
      }
      Text("Ln \(navigator.selectedLine)")
    }.font(.system(size: 10, design: .monospaced)).padding(.horizontal, 14).frame(height: 27)
      .background(EvidenceStyle.chrome)
  }

  private var quickOpen: some View {
    @Bindable var nav = navigator
    return VStack(alignment: .leading, spacing: 12) {
      HStack {
        Image(systemName: "magnifyingglass")
        TextField("Go to file…", text: $nav.quickQuery).textFieldStyle(.plain).onChange(
          of: nav.quickQuery
        ) { nav.quickFind() }
        .focused($quickFocused)
        .onSubmit { activateQuickSelection() }
        .onKeyPress(.downArrow) {
          quickIndex = min(nav.quickPaths.count - 1, quickIndex + 1)
          return .handled
        }
        .onKeyPress(.upArrow) {
          quickIndex = max(0, quickIndex - 1)
          return .handled
        }
        Button("Done") { nav.quickOpenPresented = false }.keyboardShortcut(.cancelAction)
      }.padding(8)
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(spacing: 2) {
            ForEach(Array(nav.quickPaths.enumerated()), id: \.element) { index, path in
              Button {
                nav.select(path)
                nav.quickOpenPresented = false
              } label: {
                Label(path, systemImage: "doc.text").font(.system(size: 12, design: .monospaced))
                  .lineLimit(1).truncationMode(.middle)
                  .padding(9).frame(maxWidth: .infinity, alignment: .leading)
                  .background(index == quickIndex ? EvidenceStyle.amber.opacity(0.12) : .clear)
              }.buttonStyle(.plain).id(index)
            }
          }
        }.onChange(of: quickIndex) { proxy.scrollTo(quickIndex) }
      }
      Text("↑↓ select · Return opens · Esc closes").font(.caption).foregroundStyle(.secondary)
    }.padding(16).frame(width: 620, height: 430)
      .onAppear {
        quickFocused = true
        quickIndex = 0
      }
      .onChange(of: nav.quickPaths) { quickIndex = 0 }
  }

  private func activateQuickSelection() {
    guard navigator.quickPaths.indices.contains(quickIndex) else { return }
    navigator.select(navigator.quickPaths[quickIndex])
    navigator.quickOpenPresented = false
  }

  private var divider: some View { Rectangle().fill(EvidenceStyle.separator).frame(height: 1) }
}
