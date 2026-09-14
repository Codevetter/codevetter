import AppKit
import Foundation
import SwiftUI
import Testing

@testable import CodeVetterFeature

@Test func navigatorRuntimeLocationParsingRejectsEscapesAndBacktrackingInputs() {
  let locations = navigatorRuntimeLocations(in: [
    "at run (/repo/src/session.ts:27:9)", "./src/session.ts:27",
    "../outside.ts:4 /elsewhere/file.ts:3 /repo/../escape.ts:5 src/missing.ts:0",
    "src/ok.ts:18",
  ], repository: "/repo")
  #expect(locations.map(\.path) == ["src/session.ts", "src/ok.ts"])
  #expect(locations.map(\.line) == [27, 18])
  let adversarial = String(repeating: "!/", count: 10_000) + "! src/ok.ts:12"
  let start = ContinuousClock.now
  let recovered = navigatorRuntimeLocations(in: [adversarial], repository: "/repo")
  #expect(start.duration(to: .now) < .seconds(1))
  #expect(recovered.map(\.path) == ["src/ok.ts"])
  #expect(recovered.first?.line == 12)
}

private func navigatorFixture() throws -> (URL, String, String) {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "navigator-\(UUID().uuidString)")
  try FileManager.default.createDirectory(
    at: root.appendingPathComponent("src"), withIntermediateDirectories: true)
  func git(_ arguments: [String]) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    process.arguments = arguments
    process.currentDirectoryURL = root
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = Pipe()
    process.environment = [
      "PATH": "/usr/bin:/bin", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
    ]
    try process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw CocoaError(.executableRuntimeMismatch) }
    return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
  }
  _ = try git(["init", "-b", "main"])
  try "# Session service\n\nAuthentication for browser sessions.\n".write(
    to: root.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
  try "export function validateSession(token: string) {\n  return token.length > 0;\n}\n".write(
    to: root.appendingPathComponent("src/session.ts"), atomically: true, encoding: .utf8)
  _ = try git(["add", "."])
  _ = try git([
    "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m",
    "Initial source",
  ])
  let base = try git(["rev-parse", "HEAD"])
  try
    "export function validateSession(token: string) {\n  return token.length > 4;\n}\n\nexport const active = validateSession('hello');\n"
    .write(to: root.appendingPathComponent("src/session.ts"), atomically: true, encoding: .utf8)
  _ = try git(["add", "."])
  _ = try git([
    "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m",
    "Validate session length",
  ])
  return (root, base, try git(["rev-parse", "HEAD"]))
}

@Test func navigatorFFIPreservesExactRevisionAndWindow() async throws {
  let (root, base, head) = try navigatorFixture()
  let bridge = NavigatorBridge()
  let snapshot: NavigatorSnapshot = try await bridge.call(
    NavigatorRequest(
      operation: "open", input: root.path, cache: root.path, revision: head, base: base))
  #expect(snapshot.head == head)
  let file: NavigatorFile = try await bridge.call(
    NavigatorRequest(
      operation: "file", session: snapshot.id, path: "src/session.ts", side: "base", start: 2,
      count: 1))
  #expect(file.lines == ["  return token.length > 0;"])
  #expect(file.revision == base)
  let diff: NavigatorDiff = try await bridge.call(
    NavigatorRequest(operation: "diff", session: snapshot.id, path: "src/session.ts"))
  #expect(diff.rows.contains { $0.kind == "add" && $0.new == 2 })
  let semantic: NavigatorLocations = try await bridge.call(
    NavigatorRequest(
      operation: "semantic", session: snapshot.id, path: "src/session.ts",
      side: "head", query: "definition", line: 5, column: 22,
      server: NavigatorBridge.semanticServerPath))
  #expect(semantic.locations.first?.path == "src/session.ts")
  #expect(semantic.locations.first?.line == 1)
  let _: NavigatorAcknowledgement = try await bridge.call(
    NavigatorRequest(operation: "close", session: snapshot.id))
}

@MainActor @Test func navigatorModelOpensSourceAndNavigatesWithoutRevisionDrift() async throws {
  let (root, base, head) = try navigatorFixture()
  let model = NavigatorModel()
  model.searchPresented = true
  model.searchQuery = "previous repository"
  model.inspector = .symbols
  model.open(root.path, revision: head, base: base, path: "src/session.ts", line: 2)
  let deadline = Date().addingTimeInterval(20)
  while model.file == nil && model.issue == nil && Date() < deadline {
    try await Task.sleep(for: .milliseconds(20))
  }
  #expect(model.issue == nil)
  #expect(model.file?.revision == head)
  #expect(model.selectedLine == 2)
  #expect(model.presentation == "Source")
  #expect(!model.searchPresented)
  #expect(model.searchQuery.isEmpty)
  #expect(model.inspector == .unpack)
  model.select("README.md")
  model.select("src/session.ts", line: 2)
  #expect(model.file?.path == "src/session.ts")
  model.navigate(back: true)
  #expect(model.selectedPath == "README.md")
  model.quickQuery = "ssn"
  model.quickFind()
  try await Task.sleep(for: .milliseconds(100))
  #expect(model.quickPaths.contains("src/session.ts"))
}

@MainActor @Test func navigatorOffscreenReviewAndExplore() async throws {
  let (root, base, head) = try navigatorFixture()
  let model = WorkbenchModel()
  let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("artifacts/navigator-review")
  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  try navigatorCapture(model, at: output.appendingPathComponent("landing.png"), width: 1280)
  for width in [390, 768] {
    let host = NSHostingView(
      rootView: NavigatorWorkspaceView(model: model, mode: .explore).preferredColorScheme(.dark))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: width, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
    host.cacheDisplay(in: host.bounds, to: bitmap)
    try #require(bitmap.representation(using: .png, properties: [:])).write(
      to: output.appendingPathComponent("landing-\(width).png"))
  }
  model.navigator.open(root.path, revision: head, base: base, path: "src/session.ts", line: 2)
  let deadline = Date().addingTimeInterval(20)
  while model.navigator.file == nil && model.navigator.issue == nil && Date() < deadline {
    try await Task.sleep(for: .milliseconds(20))
  }
  #expect(model.navigator.issue == nil)
  while model.navigator.status?.done != true && Date() < deadline {
    try await Task.sleep(for: .milliseconds(20))
  }
  model.section = .repository
  for width in [980, 1280, 1440] {
    try navigatorCapture(
      model, at: output.appendingPathComponent("explore-\(width).png"), width: CGFloat(width))
  }
  try navigatorCapture(
    model, at: output.appendingPathComponent("explore-light.png"), width: 1280, dark: false)
  model.section = .review
  model.navigator.setPresentation("Diff")
  await model.navigator.loadCurrentFile()
  try navigatorCapture(model, at: output.appendingPathComponent("review-unified.png"), width: 1280)
  model.navigator.split = true
  try navigatorCapture(model, at: output.appendingPathComponent("review-split.png"), width: 1440)
}

@MainActor @Test func navigatorWindowSizingRemainsOwnedByAppKit() {
  let model = WorkbenchModel()
  // No window is ordered on screen: this remains safe on the operator's desktop.
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
    styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
    backing: .buffered, defer: false)
  window.isReleasedWhenClosed = false
  window.minSize = NSSize(width: 980, height: 640)
  let initialFrame = window.frame
  let controller = makeWorkbenchHostingController(
    model: model, contentSize: window.contentView!.bounds.size)
  #expect(controller.sizingOptions.isEmpty)
  window.contentViewController = controller
  defer {
    window.contentViewController = nil
    window.close()
  }
  for section in [WorkbenchSection.review, .testing, .settings, .repository] {
    model.section = section
    controller.view.layoutSubtreeIfNeeded()
    #expect(window.frame == initialFrame)
    #expect(window.minSize == NSSize(width: 980, height: 640))
    #expect(!window.isVisible)
  }
}

@MainActor private func navigatorCapture(
  _ model: WorkbenchModel, at path: URL, width: CGFloat, dark: Bool = true
) throws {
  let host = NSHostingView(
    rootView: PremiumWorkbenchRootView(model: model).preferredColorScheme(dark ? .dark : .light))
  host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
  host.frame = NSRect(x: 0, y: 0, width: width, height: 800)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
  host.cacheDisplay(in: host.bounds, to: bitmap)
  let data = try #require(bitmap.representation(using: .png, properties: [:]))
  try data.write(to: path)
}

@MainActor @Test func navigatorAccessibleSelectionTracksSourceAndDiffKeyboard() {
  let canvas = NavigatorCanvas(frame: NSRect(x: 0, y: 0, width: 1000, height: 400))
  canvas.file = NavigatorFile(
    path: "a.ts", side: "head", revision: "head", blob: "blob",
    totalLines: 3, start: 1, lines: ["first", "second", "third"], binary: false, bytes: 18)
  canvas.updateAccessibleSelection()
  #expect(canvas.accessibilityValue() as? String == "Line 1: first")
  canvas.selectedSymbol = "stale"
  canvas.moveSelection(by: 1)
  #expect(canvas.accessibilityValue() as? String == "Line 2: second")
  #expect(canvas.selectedSymbol.isEmpty)
  canvas.moveColumn(by: 1)
  #expect(canvas.selectedSymbol == "second")
  #expect(canvas.selectedColumn == 1)
  canvas.moveSelection(by: 50)
  #expect(canvas.selectedLine == 3)
  canvas.diff = NavigatorDiff(
    rows: [
      NavigatorDiffLine(old: 1, new: nil, kind: "delete", text: "old"),
      NavigatorDiffLine(old: nil, new: 1, kind: "add", text: "new"),
      NavigatorDiffLine(old: 2, new: 2, kind: "context", text: "context"),
    ], truncated: false, binary: false)
  canvas.file = nil
  canvas.selectedRow = 0
  canvas.buildRows()
  canvas.moveSelection(by: 1)
  #expect(canvas.accessibilityValue() as? String == "add, base line none, head line 1: new")
  canvas.moveSelection(by: 1)
  #expect(canvas.selectedLine == 2)
  canvas.split = true
  canvas.buildRows()
  canvas.selectedRow = 0
  canvas.selectedRight = true
  canvas.updateAccessibleSelection()
  #expect(canvas.accessibilityValue() as? String == "add, base line none, head line 1: new")
}

@MainActor @Test func navigatorViewportRenderingRemainsBoundedOnHugeSource() throws {
  let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 1000, height: 640))
  let canvas = NavigatorCanvas(frame: NSRect(x: 0, y: 0, width: 1000, height: 2_100_000))
  scroll.documentView = canvas
  canvas.scroll = scroll
  var elapsed: [Double] = []
  for sample in 0..<100 {
    let line = sample * 900 + 1
    canvas.file = NavigatorFile(
      path: "huge.ts", side: "head", revision: "head", blob: "huge",
      totalLines: 100_000, start: line,
      lines: (0..<512).map { "export const item\(line + $0) = 'value';" }, binary: false,
      bytes: 4_000_000)
    scroll.contentView.scroll(to: NSPoint(x: 0, y: CGFloat(line - 1) * canvas.rowHeight))
    let bitmap = try #require(scroll.bitmapImageRepForCachingDisplay(in: scroll.bounds))
    let start = ContinuousClock.now
    scroll.cacheDisplay(in: scroll.bounds, to: bitmap)
    elapsed.append(Double(start.duration(to: .now).components.attoseconds) / 1e15)
    #expect(canvas.highlightCache.count <= 600)
  }
  elapsed.sort()
  print(
    "Navigator offscreen 100k-line viewport render p95: \(elapsed[94]) ms (not display frame timing)"
  )
}
