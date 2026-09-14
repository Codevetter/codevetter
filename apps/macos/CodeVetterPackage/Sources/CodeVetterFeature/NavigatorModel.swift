import Foundation
import Observation

enum NavigatorMode: String, CaseIterable {
  case explore = "Explore"
  case review = "Review"
}
enum NavigatorInspector: String, CaseIterable {
  case unpack = "Unpack"
  case symbols = "Symbols"
  case evidence = "Evidence"
  case history = "History"
}

@MainActor @Observable
final class NavigatorModel {
  var input = ""
  var snapshot: NavigatorSnapshot?
  var selectedPath = ""
  var selectedLine = 1
  var side = "head"
  var presentation = "Source"
  var split = false
  var file: NavigatorFile?
  var diff: NavigatorDiff?
  var status: NavigatorStatus?
  var overview: NavigatorOverview?
  var locations = NavigatorLocations()
  var history: NavigatorHistory?
  var inspector: NavigatorInspector = .unpack
  var searchQuery = ""
  var searchPresented = false
  var quickOpenPresented = false
  var quickQuery = ""
  var quickPaths: [String] = []
  var expandedFolders: Set<String> = []
  var opening = false
  var loadingFile = false
  var issue: String?
  var enrichmentIssue: String?
  var showVerification = false
  var showFullUnpack = false
  var context = 3
  var unpackRoot: String?
  var preparingUnpack = false
  var automaticUnpackStarted = false
  var historyBack: [(String, Int)] = []
  var historyForward: [(String, Int)] = []
  var refreshToken = UUID()
  private var epoch = UUID()
  private var selectionEpoch = UUID()
  private var queryEpoch = UUID()
  private var windowEpoch = UUID()
  private var fileCache: [String: NavigatorFile] = [:]
  private var diffCache: [String: NavigatorDiff] = [:]
  private var monitor: Task<Void, Never>?
  private let bridge: NavigatorBridge

  init(bridge: NavigatorBridge = NavigatorBridge()) { self.bridge = bridge }

  var changedFiles: [NavigatorEntry] { snapshot?.files.filter { !$0.status.isEmpty } ?? [] }
  var canReview: Bool { snapshot?.base != nil || snapshot?.kind == "local" }
  var indexLabel: String {
    guard let status else { return "Source ready · preparing navigation" }
    if status.done {
      return "\(status.indexed) files indexed"
        + (status.skipped > 0 ? " · \(status.skipped) excluded" : "")
    }
    return "Indexing \(status.indexed) / \(status.total) · browsing available"
  }

  func open(
    _ input: String? = nil, revision: String? = nil, base: String? = nil, path: String? = nil,
    line: Int = 1, review: Bool = false
  ) {
    let value = (input ?? self.input).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else {
      issue = "Paste a GitHub URL or choose a local repository."
      return
    }
    self.input = value
    let token = UUID()
    epoch = token
    selectionEpoch = UUID()
    monitor?.cancel()
    opening = true
    issue = nil
    enrichmentIssue = nil
    let previous = snapshot?.id
    Task {
      do {
        let cache = try FileManager.default.url(
          for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        .appendingPathComponent("CodeVetter/Navigator", isDirectory: true).path
        let opened: NavigatorSnapshot = try await bridge.call(
          NavigatorRequest(
            operation: "open", input: value, cache: cache, revision: revision, base: base))
        guard epoch == token else {
          let _: NavigatorAcknowledgement? = try? await bridge.call(
            NavigatorRequest(operation: "close", session: opened.id))
          return
        }
        snapshot = opened
        opening = false
        fileCache.removeAll()
        diffCache.removeAll()
        file = nil
        diff = nil
        overview = nil
        status = nil
        history = nil
        locations = NavigatorLocations()
        queryEpoch = UUID()
        searchPresented = false
        searchQuery = ""
        quickQuery = ""
        quickPaths = []
        inspector = .unpack
        unpackRoot = nil
        automaticUnpackStarted = false
        historyBack = []
        historyForward = []
        selectedPath = ""
        side = "head"
        presentation =
          path == nil && (opened.base != nil || opened.kind == "local" && review)
          ? "Diff" : "Source"
        expandedFolders = Set(
          opened.files.compactMap { $0.path.split(separator: "/").first.map(String.init) })
        select(path ?? opened.initialPath ?? "", line: path == nil ? opened.initialLine : line)
        if let previous {
          let _: NavigatorAcknowledgement? = try? await bridge.call(
            NavigatorRequest(operation: "close", session: previous))
        }
        // First requested file loads before bulk source enrichment begins.
        await loadCurrentFile()
        guard epoch == token else { return }
        let _: NavigatorAcknowledgement = try await bridge.call(
          NavigatorRequest(operation: "index", session: opened.id))
        monitorIndex(id: opened.id, token: token)
      } catch {
        guard epoch == token else { return }
        opening = false
        issue = error.localizedDescription
      }
    }
  }

  func cancelImport() {
    epoch = UUID()
    opening = false
  }

  func showImport() {
    let previous = snapshot?.id
    epoch = UUID()
    selectionEpoch = UUID()
    queryEpoch = UUID()
    monitor?.cancel()
    snapshot = nil
    file = nil
    diff = nil
    opening = false
    if let previous {
      Task {
        let _: NavigatorAcknowledgement? = try? await bridge.call(
          NavigatorRequest(operation: "close", session: previous))
      }
    }
  }

  func select(_ path: String, line: Int = 1, record: Bool = true) {
    guard !path.isEmpty else { return }
    if record, !selectedPath.isEmpty, selectedPath != path || selectedLine != line {
      historyBack.append((selectedPath, selectedLine))
      historyForward = []
    }
    selectionEpoch = UUID()
    selectedPath = path
    selectedLine = max(1, line)
    issue = nil
    var prefix = ""
    for part in path.split(separator: "/").dropLast() {
      prefix = prefix.isEmpty ? String(part) : prefix + "/" + part
      expandedFolders.insert(prefix)
    }
    if snapshot?.files.first(where: { $0.path == path })?.status == "D" { side = "base" }
    let key = fileKey(path: path, line: selectedLine)
    file = fileCache[key]
    diff = diffCache[diffKey(path)]
    refreshToken = UUID()
    Task { await loadCurrentFile() }
  }

  func navigate(back: Bool) {
    let destination = back ? historyBack.popLast() : historyForward.popLast()
    guard let destination else { return }
    if back {
      historyForward.append((selectedPath, selectedLine))
    } else {
      historyBack.append((selectedPath, selectedLine))
    }
    select(destination.0, line: destination.1, record: false)
  }

  func setSide(_ value: String) {
    side = value
    select(selectedPath, line: selectedLine, record: false)
  }
  func setPresentation(_ value: String) {
    presentation = value
    Task { await loadCurrentFile() }
  }
  func expandContext() {
    context = min(10000, context == 3 ? 30 : context * 4)
    Task { await loadCurrentFile() }
  }

  func loadCurrentFile() async {
    guard let snapshot, !selectedPath.isEmpty else { return }
    let token = selectionEpoch
    let session = snapshot.id
    let path = selectedPath
    loadingFile = file == nil && diff == nil
    do {
      if presentation == "Diff" {
        let key = diffKey(path)
        let value: NavigatorDiff
        if let cached = diffCache[key] {
          value = cached
        } else {
          value = try await bridge.call(
            NavigatorRequest(operation: "diff", session: session, path: path, context: context))
          guard snapshot.id == self.snapshot?.id else { return }
          if diffCache.count >= 24 { diffCache.removeAll() }
          diffCache[key] = value
        }
        guard selectionEpoch == token else { return }
        diff = value
      } else {
        await loadWindow(line: selectedLine)
      }
      guard selectionEpoch == token else { return }
      loadingFile = false
    } catch {
      guard selectionEpoch == token else { return }
      loadingFile = false
      issue = error.localizedDescription
    }
  }

  func loadWindow(line: Int) async {
    guard let snapshot else { return }
    let token = selectionEpoch
    let path = selectedPath
    let side = side
    let windowToken = UUID()
    windowEpoch = windowToken
    let start = max(0, (line - 1) / 256) * 256 + 1
    let key = fileKey(path: path, line: line)
    if let cached = fileCache[key] {
      file = cached
      loadingFile = false
      return
    }
    do {
      let value: NavigatorFile = try await bridge.call(
        NavigatorRequest(
          operation: "file", session: snapshot.id, path: path, side: side, start: start, count: 512)
      )
      guard self.snapshot?.id == snapshot.id else { return }
      if fileCache.count >= 96 { fileCache.removeAll() }
      fileCache[key] = value
      guard selectionEpoch == token, self.side == side, windowEpoch == windowToken else { return }
      file = value
      loadingFile = false
    } catch {
      guard selectionEpoch == token else { return }
      issue = error.localizedDescription
      loadingFile = false
    }
  }

  func quickFind() {
    guard let snapshot else { return }
    let query = quickQuery
    Task {
      do {
        let result: NavigatorPaths = try await bridge.call(
          NavigatorRequest(operation: "fuzzy", session: snapshot.id, query: query))
        guard quickQuery == query, self.snapshot?.id == snapshot.id else { return }
        quickPaths = result.paths
      } catch { enrichmentIssue = error.localizedDescription }
    }
  }

  func search(operation: String = "search", query: String? = nil) {
    guard let snapshot else { return }
    let value = query ?? searchQuery
    let token = UUID()
    queryEpoch = token
    if operation != "symbols" { searchPresented = true }
    Task {
      do {
        let result: NavigatorLocations = try await bridge.call(
          NavigatorRequest(
            operation: operation, session: snapshot.id,
            path: operation == "symbols" ? selectedPath : nil, query: value))
        guard queryEpoch == token, self.snapshot?.id == snapshot.id else { return }
        locations = result
      } catch {
        guard queryEpoch == token else { return }
        enrichmentIssue = error.localizedDescription
      }
    }
  }

  func inspectHistory(blame: Bool = false) {
    guard let snapshot else { return }
    let path = selectedPath
    inspector = .history
    Task {
      do {
        let result: NavigatorHistory = try await bridge.call(
          NavigatorRequest(
            operation: blame ? "blame" : "history", session: snapshot.id, path: path,
            line: selectedLine))
        guard selectedPath == path, self.snapshot?.id == snapshot.id else { return }
        history = result
      } catch { enrichmentIssue = error.localizedDescription }
    }
  }

  func resolveSymbol(operation: String, line: Int, column: Int) {
    guard let snapshot else { return }
    guard presentation == "Source" else {
      enrichmentIssue = "Open the base or head Source view for semantic navigation."
      return
    }
    let token = UUID()
    queryEpoch = token
    let path = selectedPath
    let sourceSide = side
    searchPresented = true
    locations = NavigatorLocations(qualification: "Resolving against the pinned source snapshot…")
    Task {
      do {
        let result: NavigatorLocations = try await bridge.call(
          NavigatorRequest(
            operation: "semantic", session: snapshot.id, path: path, side: sourceSide,
            query: operation, line: line, column: column, server: NavigatorBridge.semanticServerPath
          ))
        guard queryEpoch == token, self.snapshot?.id == snapshot.id,
          selectedPath == path, side == sourceSide
        else { return }
        locations = result
        enrichmentIssue = nil
      } catch {
        guard queryEpoch == token, self.snapshot?.id == snapshot.id else { return }
        locations = NavigatorLocations(
          qualification: "Semantic navigation unavailable: \(error.localizedDescription)")
      }
    }
  }

  func jump(_ location: NavigatorLocation) {
    presentation = "Source"
    select(location.path, line: location.line)
  }

  func prepareUnpack() async throws -> String {
    guard let snapshot else { throw NavigatorError.unavailable("Open a repository first.") }
    if let unpackRoot { return unpackRoot }
    preparingUnpack = true
    defer { preparingUnpack = false }
    let result: NavigatorMaterialization = try await bridge.call(
      NavigatorRequest(operation: "materialize", session: snapshot.id))
    guard self.snapshot?.id == snapshot.id else { throw CancellationError() }
    unpackRoot = result.path
    return result.path
  }

  private func fileKey(path: String, line: Int) -> String {
    "\(side):\(path):\(max(0, (line - 1) / 256))"
  }
  private func diffKey(_ path: String) -> String { "\(path):\(context)" }

  private func monitorIndex(id: UInt64, token: UUID) {
    monitor = Task {
      while !Task.isCancelled, epoch == token {
        do {
          let progress: NavigatorStatus = try await bridge.call(
            NavigatorRequest(operation: "status", session: id))
          let overview: NavigatorOverview = try await bridge.call(
            NavigatorRequest(operation: "understand", session: id))
          guard epoch == token, !Task.isCancelled else { return }
          status = progress
          self.overview = overview
          if progress.done {
            enrichmentIssue = progress.issue
            return
          }
          try await Task.sleep(for: .milliseconds(700))
        } catch {
          if !Task.isCancelled { enrichmentIssue = error.localizedDescription }
          return
        }
      }
    }
  }
}
