import AppKit
import Darwin
import Foundation
import SwiftUI
import Testing

@testable import CodeVetterFeature

func resolveNativeColor(_ color: NSColor, in appearance: NSAppearance) -> NSColor? {
  var resolved: NSColor?
  appearance.performAsCurrentDrawingAppearance {
    resolved = color.usingColorSpace(.sRGB) ?? color
  }
  return resolved
}

func nativeContrastRatio(_ foreground: NSColor, against backgroundHex: UInt32) -> Double {
  let converted = foreground.usingColorSpace(.sRGB) ?? foreground
  let background = NSColor(
    srgbRed: CGFloat((backgroundHex >> 16) & 0xFF) / 255,
    green: CGFloat((backgroundHex >> 8) & 0xFF) / 255,
    blue: CGFloat(backgroundHex & 0xFF) / 255,
    alpha: 1
  )
  let foregroundLuminance = nativeRelativeLuminance(converted)
  let backgroundLuminance = nativeRelativeLuminance(background)
  return (max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (min(foregroundLuminance, backgroundLuminance) + 0.05)
}

func nativeRelativeLuminance(_ color: NSColor) -> Double {
  func linearize(_ component: CGFloat) -> Double {
    let value = Double(component)
    return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linearize(color.redComponent)
    + 0.7152 * linearize(color.greenComponent)
    + 0.0722 * linearize(color.blueComponent)
}

final class LockedProgress: @unchecked Sendable {
  private let lock = NSLock()
  private var storage: [VerificationProgress] = []

  var values: [VerificationProgress] {
    lock.lock()
    defer { lock.unlock() }
    return storage
  }

  func append(_ progress: VerificationProgress) {
    lock.lock()
    storage.append(progress)
    lock.unlock()
  }
}

@Test
func supervisedRunnerLoadsPersistedCanonicalRunHistory() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-runs-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let history = #"""
    {
      "schema_version": "codevetter.run-history/v1",
      "generated_at": "2026-08-31T00:00:02Z",
      "repo_path": null,
      "limit": 12,
      "returned": 4,
      "runs": [
        {
          "schema_version": "codevetter.run-record/v1",
          "id": "synthetic-fixture",
          "kind": "synthetic_qa",
          "repo_path": "/fixture/repo",
          "recorded_at": "2026-08-31T00:00:03Z",
          "title": "Verify the review flow",
          "outcome": "failed",
          "receipt_schema": "codevetter.synthetic-qa-run/v1",
          "source_label": "playwright_builtin",
          "limitations": ["Expected evidence was missing"],
          "receipt": {
            "schema_version": "codevetter.synthetic-qa-run/v1",
            "artifacts": ["trace.zip", "failure.png"],
            "pass": false
          }
        },
        {
          "schema_version": "codevetter.run-record/v1",
          "id": "audience-fixture",
          "kind": "audience_validation",
          "repo_path": "/fixture/repo",
          "recorded_at": "2026-08-31T00:00:02Z",
          "title": "Compare the evidence",
          "outcome": "complete",
          "receipt_schema": "codevetter.audience-validation-run/v1",
          "source_label": "maintainers",
          "limitations": [],
          "receipt": {
            "schema_version": "codevetter.audience-validation-run/v1",
            "responses": [{
              "id": "response-fixture",
              "participant_id": "maintainer-1",
              "provenance": "human",
              "criterion": "correctness",
              "preferred_candidate": "a",
              "confidence": 0.9,
              "task_passed": true,
              "feedback": "The receipt is inspectable.",
              "created_at": "2026-08-31T00:00:02Z"
            }]
          }
        },
        {
          "schema_version": "codevetter.run-record/v1",
          "id": "preview-fixture",
          "kind": "preview",
          "repo_path": "/fixture/repo",
          "recorded_at": "2026-08-31T00:00:01Z",
          "title": "Preview journey",
          "outcome": "no_confidence",
          "receipt_schema": "codevetter.trex-preview/v1",
          "source_label": "cccccccccccc",
          "limitations": ["No browser evidence"],
          "receipt": {"schema_version": 1, "verdict": "no_confidence"}
        },
        {
          "schema_version": "codevetter.run-record/v1",
          "id": "local-check-fixture",
          "kind": "local_check",
          "repo_path": "/fixture/repo",
          "recorded_at": "2026-08-31T00:00:00Z",
          "title": "Persist evidence",
          "outcome": "passed_with_limits",
          "receipt_schema": "codevetter.local-check/v1",
          "source_label": "bbbbbbbbbbbb",
          "limitations": ["Fixture limitation"],
          "receipt": {
            "schema_version": "codevetter.local-check/v1",
            "run_id": "local-check-fixture",
            "ran_at": "2026-08-31T00:00:00Z",
            "repo_path": "/fixture/repo",
            "task": "Persist evidence",
            "source": {
              "kind": "range",
              "input": "main...HEAD",
              "base_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              "changed_paths": ["src/main.rs"]
            },
            "stages": {"correctness": {"status": "passed"}},
            "verdict": "passed_with_limits",
            "limitations": ["Fixture limitation"]
          }
        }
      ]
    }
    """#
  try "#!/bin/sh\nprintf '%s\\n' '\(history)'\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runs = try await CodeVetterProcessRunner(executableURL: executable).listRuns(limit: 12)
  #expect(runs.count == 4)
  #expect(runs[0].id == "synthetic-fixture")
  #expect(runs[0].artifacts == ["trace.zip", "failure.png"])
  #expect(runs[1].kind == "audience_validation")
  #expect(runs[1].audienceResponses.first?.participantID == "maintainer-1")
  #expect(runs[1].audienceResponses.first?.taskPassed == true)
  #expect(runs[2].id == "preview-fixture")
  #expect(runs[2].localCheckReceipt == nil)
  #expect(runs[2].limitations == ["No browser evidence"])
  #expect(runs[3].outcome == "passed_with_limits")
  #expect(runs[3].kind == "local_check")
  #expect(runs[3].localCheckReceipt?.verdict == "passed_with_limits")
  #expect(runs[3].rawJSON.contains("\"stages\""))
}

@MainActor
@Test
func runLedgerSelectionMovesWithinTheBoundedHistory() throws {
  let history = #"""
    {
      "schema_version": "codevetter.run-history/v1",
      "runs": [
        {"id":"one","kind":"preview","repo_path":"/repo","recorded_at":"3","title":"One","outcome":"passed","receipt_schema":"one/v1","source_label":null,"limitations":[],"receipt":{}},
        {"id":"two","kind":"preview","repo_path":"/repo","recorded_at":"2","title":"Two","outcome":"passed","receipt_schema":"two/v1","source_label":null,"limitations":[],"receipt":{}},
        {"id":"three","kind":"preview","repo_path":"/repo","recorded_at":"1","title":"Three","outcome":"passed","receipt_schema":"three/v1","source_label":null,"limitations":[],"receipt":{}}
      ]
    }
    """#
  let model = WorkbenchModel()
  model.runs = try CodeVetterProcessRunner.decodeRunHistory(Data(history.utf8))
  model.selectedRunID = "one"

  model.moveRunSelection(by: 1)
  #expect(model.selectedRunID == "two")
  #expect(model.selectedRunPosition == "2 of 3")
  model.moveRunSelection(by: 20)
  #expect(model.selectedRunID == "three")
  model.moveRunSelection(by: -20)
  #expect(model.selectedRunID == "one")
}

@Test
func runLedgerExportPreservesTheSelectedCanonicalReceipt() throws {
  let history = #"""
    {
      "schema_version": "codevetter.run-history/v1",
      "runs": [
        {"id":"export","kind":"synthetic_qa","repo_path":"/repo","recorded_at":"1","title":"Export","outcome":"failed","receipt_schema":"codevetter.synthetic-qa-run/v1","source_label":"fixture","limitations":["bounded"],"receipt":{"schema_version":"codevetter.synthetic-qa-run/v1","pass":false,"artifacts":["failure.png"]}}
      ]
    }
    """#
  let run = try #require(
    CodeVetterProcessRunner.decodeRunHistory(Data(history.utf8)).first)
  let destination = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-export-\(UUID().uuidString).json")
  defer { try? FileManager.default.removeItem(at: destination) }

  try run.exportCanonicalReceipt(to: destination)

  let exported = try String(contentsOf: destination, encoding: .utf8)
  #expect(exported == "\(run.rawJSON)\n")
  let object = try #require(
    JSONSerialization.jsonObject(with: Data(exported.utf8)) as? [String: Any])
  #expect(object["schema_version"] as? String == "codevetter.synthetic-qa-run/v1")
}

@MainActor
@Test
func hundredRunLedgerDecodesAndRendersWithinTheNativeGate() throws {
  let responseRows: [[String: Any]] = (0..<100).map { index in
    [
      "id": "response-\(index)",
      "participant_id": "participant-\(index)",
      "provenance": "human",
      "criterion": "correctness",
      "preferred_candidate": index.isMultiple(of: 2) ? "a" : "b",
      "confidence": 0.9,
      "task_passed": true,
      "feedback": "Inspectable response \(index)",
      "created_at": "2026-08-31T00:00:00Z",
    ]
  }
  let runRows: [[String: Any]] = (0..<100).map { index in
    let audience = index == 0
    return [
      "schema_version": "codevetter.run-record/v1",
      "id": "run-\(index)",
      "kind": audience ? "audience_validation" : "preview",
      "repo_path": "/fixture/repo",
      "recorded_at": String(format: "2026-08-31T00:%02d:%02dZ", index / 60, index % 60),
      "title": audience ? "Audience evidence" : "Preview \(index)",
      "outcome": audience ? "complete" : "passed_with_limits",
      "receipt_schema": audience
        ? "codevetter.audience-validation-run/v1" : "codevetter.trex-preview/v1",
      "source_label": audience ? "maintainers" : "fixture",
      "limitations": [],
      "receipt": audience
        ? [
          "schema_version": "codevetter.audience-validation-run/v1",
          "responses": responseRows,
        ]
        : ["schema_version": 1, "limitations": []],
    ]
  }
  let payload = try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.run-history/v1",
    "generated_at": "2026-08-31T00:00:00Z",
    "repo_path": NSNull(),
    "limit": 100,
    "returned": 100,
    "runs": runRows,
  ])

  for _ in 0..<10 {
    _ = try CodeVetterProcessRunner.decodeRunHistory(payload)
  }
  var decodeSamples = [UInt64]()
  for _ in 0..<100 {
    let started = DispatchTime.now().uptimeNanoseconds
    _ = try CodeVetterProcessRunner.decodeRunHistory(payload)
    decodeSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }
  let runs = try CodeVetterProcessRunner.decodeRunHistory(payload)
  let model = WorkbenchModel()
  model.section = .runs
  model.runs = runs
  model.selectedRunID = runs.first?.id

  for _ in 0..<3 {
    renderLedger(model)
  }
  var renderSamples = [UInt64]()
  for _ in 0..<20 {
    let started = DispatchTime.now().uptimeNanoseconds
    renderLedger(model)
    renderSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let decodeP95 = percentile95(decodeSamples)
  let renderP95 = percentile95(renderSamples)
  if nativePerformanceGateEnabled() {
    #expect(decodeP95 < 25_000, "100-run decoding must stay below 25 ms p95")
    #expect(
      renderP95 < 150_000,
      "100-run/100-response host rendering must stay below 150 ms p95"
    )
  }
  print(
    "NATIVE_RUN_LEDGER_BENCHMARK_JSON "
      + "{\"decode_p95_us\":\(decodeP95),\"render_p95_us\":\(renderP95),"
      + "\"runs\":100,\"selected_responses\":100,\"decode_samples\":100,\"render_samples\":20}"
  )
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_RUNS_SCREENSHOT_PATH"
  ] {
    try captureLedger(model, at: URL(fileURLWithPath: screenshotPath))
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_RUNS_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureLedger(
      model,
      at: URL(fileURLWithPath: screenshotPath),
      appearance: .aqua
    )
  }
}

@MainActor
func renderLedger(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderCapabilities(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func captureCapabilities(_ model: WorkbenchModel, at destination: URL) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
  for _ in 0..<3 {
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.03))
  }
  try captureHost(host, at: destination)
}

@MainActor
func captureLedger(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name = .darkAqua
) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
  for _ in 0..<3 {
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.03))
  }
  try captureHost(host, at: destination)
}

@MainActor
func renderReview(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    _ = host.fittingSize
  }
}

@MainActor
func renderReviewProof(_ evidence: PerformanceJSONValue) {
  autoreleasepool {
    let host = NSHostingView(rootView: ReviewProofMapView(evidence: evidence))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 760, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderReviewIntent(_ evidence: PerformanceJSONValue) {
  autoreleasepool {
    let host = NSHostingView(
      rootView: ReviewIntentDiagnosticView(evidence: evidence, onVerifyInTesting: {})
    )
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 760, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderXray(_ model: WorkbenchModel, receipt: VerificationReceipt) {
  autoreleasepool {
    let host = NSHostingView(rootView: XrayExportView(model: model, receipt: receipt))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 860, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderFixPacket(_ model: WorkbenchModel, receipt: VerificationReceipt) {
  autoreleasepool {
    let host = NSHostingView(rootView: AgentFixPacketView(model: model, receipt: receipt))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 860, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderTesting(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderWarmVerification(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWarmVerificationView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_100, height: 720)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderDifferential(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumDifferentialVerificationView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_100, height: 720)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderScenarioCompiler(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumScenarioCompilerView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_180, height: 760)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderTrexWatcher(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumTrexWatcherView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_180, height: 760)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderPerformance(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderUsage(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderUnpack(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderUnpackQuery(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(
      rootView: PremiumUnpackView(model: model, startsInQueryDesk: true)
        .preferredColorScheme(.dark))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_520, height: 980)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func renderSettings(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
func captureSettings(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name
) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureHost<Content: View>(_ host: NSHostingView<Content>, at destination: URL) throws
{
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureUnpack(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name
) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureUnpackQuery(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name
) throws {
  let host = NSHostingView(
    rootView: PremiumUnpackView(model: model, startsInQueryDesk: true)
      .preferredColorScheme(appearance == .darkAqua ? .dark : .light))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 1_520, height: 980)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureUsage(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name
) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func capturePerformance(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name = .darkAqua
) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureReview(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name = .darkAqua
) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureReviewProof(_ evidence: PerformanceJSONValue, at destination: URL) throws {
  let host = NSHostingView(rootView: ReviewProofMapView(evidence: evidence))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 760, height: 800)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureReviewIntent(_ evidence: PerformanceJSONValue, at destination: URL) throws {
  let host = NSHostingView(
    rootView: ReviewIntentDiagnosticView(evidence: evidence, onVerifyInTesting: {})
  )
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 760, height: 800)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureXray(
  _ model: WorkbenchModel,
  receipt: VerificationReceipt,
  at destination: URL
) throws {
  let host = NSHostingView(rootView: XrayExportView(model: model, receipt: receipt))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 860, height: 640)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureFixPacket(
  _ model: WorkbenchModel,
  receipt: VerificationReceipt,
  at destination: URL
) throws {
  let host = NSHostingView(rootView: AgentFixPacketView(model: model, receipt: receipt))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 860, height: 640)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureTesting(
  _ model: WorkbenchModel,
  at destination: URL,
  appearance: NSAppearance.Name = .darkAqua
) throws {
  let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
  host.appearance = NSAppearance(named: appearance)
  host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureQaWorkspace(_ model: WorkbenchModel, at destination: URL) throws {
  let host = NSHostingView(rootView: QaJourneyWorkspaceView(model: model))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 1_180, height: 760)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureWarmVerification(_ model: WorkbenchModel, at destination: URL) throws {
  let host = NSHostingView(rootView: PremiumWarmVerificationView(model: model))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 1_100, height: 720)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureDifferential(_ model: WorkbenchModel, at destination: URL) throws {
  let host = NSHostingView(rootView: PremiumDifferentialVerificationView(model: model))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 1_100, height: 720)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureScenarioCompiler(_ model: WorkbenchModel, at destination: URL) throws {
  let host = NSHostingView(rootView: PremiumScenarioCompilerView(model: model))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 1_180, height: 760)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

@MainActor
func captureTrexWatcher(_ model: WorkbenchModel, at destination: URL) throws {
  let host = NSHostingView(rootView: PremiumTrexWatcherView(model: model))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 1_180, height: 760)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()
  guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
    throw CocoaError(.fileWriteUnknown)
  }
  host.cacheDisplay(in: host.bounds, to: bitmap)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CocoaError(.fileWriteUnknown)
  }
  try data.write(to: destination, options: .atomic)
}

func percentile95(_ values: [UInt64]) -> UInt64 {
  precondition(!values.isEmpty)
  let ordered = values.sorted()
  let nearestRank = Int(ceil(Double(ordered.count) * 0.95))
  return ordered[min(max(nearestRank - 1, 0), ordered.count - 1)]
}

func nativePerformanceGateEnabled() -> Bool {
  ProcessInfo.processInfo.environment["CODEVETTER_NATIVE_PERFORMANCE_GATE"] == "1"
}

func unpackFixturePayload(
  snapshotCount: Int,
  nodeCount: Int,
  rootChildren: Int
) throws -> (history: Data, record: Data) {
  let summaries: [[String: Any]] = (0..<snapshotCount).map { index in
    [
      "id": "snapshot-\(index)",
      "repo_path": "/fixture/repo",
      "repo_name": "CodeVetter",
      "commit_sha": String(repeating: String(index % 10), count: 40),
      "status": "scan_only",
      "error_message": NSNull(),
      "agent_used": NSNull(),
      "model_used": NSNull(),
      "files_scanned": 1_037 + index,
      "files_skipped": 80,
      "runtime_ms": 420,
      "cost_usd": NSNull(),
      "started_at": "2026-08-31T00:00:00Z",
      "completed_at": "2026-08-31T00:00:01Z",
      "created_at": "2026-08-31T00:00:01Z",
      "analysis_ready": false,
    ]
  }
  let graphNodes: [[String: Any]] = (0..<nodeCount).map { index in
    [
      "id": "node-\(index)",
      "kind": index.isMultiple(of: 4) ? "workspace" : "source",
      "label": "Node \(index)",
      "path": "Sources/Module\(index).swift",
      "detail": "Bounded structural lead",
      "sources": ["inventory"],
    ]
  }
  let graphEdges: [[String: Any]] = (1..<nodeCount).map { index in
    [
      "from": "node-\(index - 1)",
      "to": "node-\(index)",
      "kind": "contains",
      "evidence": "fixture",
      "sources": ["inventory"],
      "trust": "observed",
    ]
  }
  let treeChildren: [[String: Any]] = (0..<rootChildren).map { index in
    [
      "name": "Module\(index)",
      "path": "Sources/Module\(index)",
      "is_dir": true,
      "file_count": 1,
      "children": [],
    ]
  }
  let languages: [[String: Any]] = [
    ["language": "TypeScript", "files": 540, "bytes": 7_000_000],
    ["language": "Rust", "files": 290, "bytes": 4_000_000],
    ["language": "Swift", "files": 120, "bytes": 1_000_000],
  ]
  let workspaceUnits: [[String: Any]] = [
    [
      "path": "apps/desktop",
      "name": "Desktop",
      "kind": "application",
      "manifest_path": "apps/desktop/package.json",
      "build_system": "Vite",
      "file_count": 640,
      "languages": [["language": "TypeScript", "files": 540, "bytes": 7_000_000]],
      "scripts": ["test", "lint"],
      "entrypoints": ["src/main.tsx"],
      "test_files": ["tests/smoke.spec.ts"],
      "tags": ["React", "Tauri"],
    ]
  ]
  let recentCommits: [[String: Any]] = (0..<12).map { index in
    [
      "sha": String(repeating: String(index % 10), count: 40),
      "date": "2026-08-31T00:00:00Z",
      "subject": "Improve bounded native projection \(index)",
      "files": ["Sources/Module\(index).swift"],
    ]
  }
  let healthFiles: [[String: Any]] = (0..<8).map { index -> [String: Any] in
    let score = 4.5 + Double(index) / 2
    return [
      "path": "Sources/Hotspot\(index).swift",
      "score": score,
      "bucket": "review",
      "lines": 400 + index,
      "bytes": 20_000 + index,
      "churn": 10 + index,
      "has_test_signal": index.isMultiple(of: 2),
      "refactoring_targets": ["extract bounded projection"],
    ]
  }
  let inventory: [String: Any] = [
    "repo_path": "/fixture/repo",
    "repo_name": "CodeVetter",
    "commit_sha": String(repeating: "a", count: 40),
    "branch": "feat/native-macos-evidence-workbench",
    "files_scanned": 1_037,
    "files_skipped": 80,
    "bytes_scanned": 12_933_595,
    "max_files_hit": false,
    "languages": languages,
    "manifests": [],
    "entrypoints": [
      ["path": "apps/desktop/src/main.tsx", "kind": "app", "reason": "Vite entrypoint"],
      ["path": "apps/desktop/src-tauri/src/main.rs", "kind": "app", "reason": "Rust entrypoint"],
    ],
    "top_level_dirs": [],
    "docs": [],
    "config_files": ["package.json", "Cargo.toml"],
    "stack_tags": ["Tauri", "React", "Rust", "Swift", "Playwright", "Vite", "GitHub Actions"],
    "workspace_units": workspaceUnits,
    "repo_graph": [
      "schema_version": 1,
      "nodes": graphNodes,
      "edges": graphEdges,
      "truncated": nodeCount >= 700,
    ],
    "history_brief": [
      "summary": "Recent changes preserve the execution-backed verification boundary.",
      "recent_commits": recentCommits,
      "decisions": [
        ["marker": "decision", "text": "Rust owns authority", "source": "docs/architecture"]
      ],
      "test_hints": [
        ["path": "tests/native.swift", "reason": "Adjacent projection contract"]
      ],
      "sources": ["git"],
      "truncated": true,
    ],
    "repo_health": [
      "summary": "Deterministic review leads only.",
      "average_score": 7.8,
      "hotspot_count": 72,
      "files_analyzed": 1_037,
      "files_with_test_signal": 410,
      "top_files": healthFiles,
      "truncated": true,
    ],
    "coverage": [
      "strategy": "bounded_projection",
      "sampled_files": 1_037,
      "total_files": 1_117,
      "sample_percent": 92.8,
      "notes": ["Raw file inventory withheld from the client."],
    ],
    "all_files_capped": true,
    "dir_tree_preview": [
      "name": "CodeVetter",
      "path": "",
      "is_dir": true,
      "file_count": rootChildren,
      "children": treeChildren,
    ],
  ]
  let inventoryData = try JSONSerialization.data(withJSONObject: inventory)
  let record: [String: Any] = summaries[0].merging([
    "inventory_json": String(decoding: inventoryData, as: UTF8.self),
    "report_json": NSNull(),
    "bytes_scanned": 12_933_595,
  ]) { _, replacement in replacement }
  let history: [String: Any] = [
    "schema_version": "codevetter.unpack-history/v1",
    "generated_at": "2026-08-31T00:00:00Z",
    "database_available": true,
    "repo_path": "/fixture/repo",
    "limit": min(snapshotCount, 100),
    "returned": snapshotCount,
    "reports": summaries,
  ]
  return (
    history: try JSONSerialization.data(withJSONObject: history),
    record: try JSONSerialization.data(withJSONObject: record)
  )
}

func nativeSettingsFixtureReceipt(
  savedKey: String? = nil,
  reviewTone: String = "thorough"
) throws -> Data {
  let rows: [(String, String, String, String, String, String, [[String: String]])] = [
    (
      "review_tone", "general", "Default Review Tone", "Default tone for a new review.",
      "choice", reviewTone,
      [
        ["value": "concise", "label": "Concise"],
        ["value": "thorough", "label": "Thorough"],
        ["value": "strict", "label": "Strict"],
      ]
    ),
    (
      "compact_mode", "appearance", "Compact Mode", "Use denser workbench spacing.",
      "toggle", "false", []
    ),
    (
      "show_line_numbers", "appearance", "Show Line Numbers", "Show source identities.",
      "toggle", "true", []
    ),
    (
      "show_costs", "appearance", "Show Costs", "Show observed local cost evidence.",
      "toggle", "true", []
    ),
    (
      "default_adapter", "agents", "Default Adapter", "Preferred coding-agent adapter.",
      "choice", "claude-code",
      [
        ["value": "claude-code", "label": "Claude Code"],
        ["value": "codex", "label": "Codex"],
      ]
    ),
    (
      "default_role", "agents", "Default Role", "Role assigned to a new launch.",
      "choice", "coder", [["value": "coder", "label": "Coder"]]
    ),
    (
      "max_concurrent_agents", "agents", "Max Concurrent Agents", "Bounded local concurrency.",
      "choice", "3", [["value": "3", "label": "3"]]
    ),
    (
      "claude_cli_path", "agents", "Claude Code CLI", "Optional explicit path.", "text", "",
      []
    ),
    (
      "codex_cli_path", "agents", "Codex CLI", "Optional explicit path.", "text", "", []
    ),
    (
      "notify_review_done", "notifications", "Review Completed", "Notify on review completion.",
      "toggle", "true", []
    ),
    (
      "notify_agent_error", "notifications", "Agent Error", "Notify on terminal error.",
      "toggle", "true", []
    ),
    (
      "notify_task_complete", "notifications", "Task Completed", "Notify on task completion.",
      "toggle", "false", []
    ),
    (
      "notify_quota_thresholds", "notifications", "Provider Quota Thresholds",
      "Observed provider-window telemetry only.", "toggle", "true", []
    ),
    (
      "notify_session_usage_thresholds", "notifications", "Session Usage Thresholds",
      "Indexed session estimates when enabled.", "toggle", "false", []
    ),
    (
      "notification_sound", "notifications", "Notification Sounds", "Play a local tone.",
      "toggle", "true", []
    ),
    (
      "tray_refresh_cadence_secs", "notifications", "Menu Bar Refresh Cadence",
      "Polling cadence for observed live usage.", "choice", "300",
      [
        ["value": "manual", "label": "Manual only"],
        ["value": "300", "label": "Every 5 minutes"],
      ]
    ),
    (
      "native_agent_island_enabled", "agent_island", "Native Agent Island",
      "Retain the opt-in native presentation preference.", "toggle", "false", []
    ),
    (
      "native_agent_island_speech_muted", "agent_island", "Mute Voice Callouts",
      "Keep visual status without speaking updates.", "toggle", "false", []
    ),
    (
      "native_agent_island_speak_completion", "agent_island", "Speak Completions",
      "Announce completed turns.", "toggle", "true", []
    ),
    (
      "native_agent_island_speak_attention", "agent_island", "Speak Attention Requests",
      "Announce confirmed questions and permissions.", "toggle", "true", []
    ),
    (
      "native_agent_island_speak_failure", "agent_island", "Speak Failures",
      "Announce failed owned sessions.", "toggle", "true", []
    ),
    (
      "native_agent_island_speech_volume", "agent_island", "Voice Volume",
      "Set local voice volume.", "choice", "0.8",
      [
        ["value": "0.5", "label": "Quiet"],
        ["value": "0.8", "label": "Balanced"],
        ["value": "1", "label": "Full"],
      ]
    ),
    (
      "native_agent_island_speech_rate", "agent_island", "Voice Pace",
      "Choose a calm local speech rate.", "choice", "0.48",
      [
        ["value": "0.4", "label": "Measured"],
        ["value": "0.48", "label": "Balanced"],
        ["value": "0.56", "label": "Quick"],
      ]
    ),
    (
      "native_agent_island_speech_cooldown", "agent_island", "Repeat Cooldown",
      "Coalesce repeated callouts.", "choice", "30",
      [
        ["value": "15", "label": "15 seconds"],
        ["value": "30", "label": "30 seconds"],
        ["value": "60", "label": "1 minute"],
      ]
    ),
    (
      "native_agent_island_quiet_start", "agent_island", "Quiet Hours Start",
      "Optional local pause hour.", "choice", "",
      [
        ["value": "", "label": "Off"],
        ["value": "20", "label": "8 PM"],
        ["value": "21", "label": "9 PM"],
        ["value": "22", "label": "10 PM"],
        ["value": "23", "label": "11 PM"],
      ]
    ),
    (
      "native_agent_island_quiet_end", "agent_island", "Quiet Hours End",
      "Optional local resume hour.", "choice", "",
      [
        ["value": "", "label": "Off"],
        ["value": "6", "label": "6 AM"],
        ["value": "7", "label": "7 AM"],
        ["value": "8", "label": "8 AM"],
        ["value": "9", "label": "9 AM"],
      ]
    ),
    (
      "native_agent_island_codex_voice", "agent_island", "Codex Voice",
      "Optional macOS voice identifier.", "text", "", []
    ),
    (
      "native_agent_island_claude_voice", "agent_island", "Claude Voice",
      "Optional macOS voice identifier.", "text", "", []
    ),
  ]
  let settings: [[String: Any]] = rows.map { row in
    [
      "key": row.0,
      "section": row.1,
      "label": row.2,
      "description": row.3,
      "kind": row.4,
      "value": row.5,
      "default_value": row.5,
      "options": row.6,
    ]
  }
  let savedKeyValue: Any = savedKey.map { $0 as Any } ?? NSNull()
  return try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.native-settings/v1",
    "generated_at": "2026-09-01T00:00:00Z",
    "database_available": true,
    "saved_key": savedKeyValue,
    "settings": settings,
    "excluded_sensitive_keys": ["github_token"],
  ])
}

func opsStatusFixtureReceipt(windowDays: Int) throws -> Data {
  try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.ops-status/v1",
    "generated_at": "2026-09-02T00:00:00Z",
    "database_available": true,
    "window_days": windowDays,
    "billing": [
      "anthropic_configured": true,
      "openai_configured": false,
    ],
    "webhook": [
      "configured": true,
      "flavor": "slack",
    ],
    "observability": [
      [
        "task_type": "review",
        "session_count": 28,
        "success_count": 24,
        "failure_count": 3,
        "success_rate_pct": 85.7,
        "median_duration_seconds": 42.0,
        "p95_duration_seconds": 118.0,
      ],
      [
        "task_type": "indexed-session",
        "session_count": 116,
        "success_count": 116,
        "failure_count": 0,
        "success_rate_pct": 100.0,
        "median_duration_seconds": 780.0,
        "p95_duration_seconds": 3_240.0,
      ],
    ],
    "excluded_sensitive_keys": [
      "anthropic_admin_key",
      "openai_admin_key",
      "notif_webhook_url",
    ],
    "limitations": [
      "This read-only receipt never returns credentials or webhook URLs.",
      "It reads stored aggregate evidence only and never contacts a provider or webhook.",
      "Credential writes, live billing refresh, and webhook tests remain incumbent authority.",
      "Indexed sessions have no explicit failure signal and remain labelled as an aggregate proxy.",
    ],
  ])
}

func mcpSettingsFixtureReceipt(
  operation: String,
  enabled: Bool = false
) throws -> Data {
  let audit: [[String: Any]] = (0..<12).map { index in
    [
      "id": index + 1,
      "repo_id": "opaque-repo-id",
      "server_session": "session-\(index)",
      "operation": index.isMultiple(of: 2) ? "prepare_review" : "history_search",
      "status": "ok",
      "duration_ms": 8 + index,
      "result_count": 3,
      "response_bytes": 1_024 + index,
      "created_at": "2026-09-01T00:00:\(String(format: "%02d", index))Z",
    ]
  }
  let settings: [String: Any] = [
    "repo_id": "opaque-repo-id",
    "enabled": enabled,
    "indexed": true,
    "indexed_head": String(repeating: "a", count: 40),
    "current_head": String(repeating: "a", count: 40),
    "stale": false,
    "server_path": "/Applications/CodeVetter.app/Contents/MacOS/codevetter-mcp",
    "client_config": [
      "mcpServers": [
        "codevetter-history": [
          "command": "/Applications/CodeVetter.app/Contents/MacOS/codevetter-mcp",
          "args": ["--database", "/fixture/codevetter.db", "--repo-id", "opaque-repo-id"],
        ]
      ]
    ],
    "resource_kinds": ["repository", "release", "commit", "file", "evidence"],
    "tool_names": [
      "prepare_review", "history_search", "history_explain", "history_trace", "graph_query",
      "graph_impact", "graph_path",
    ],
    "redaction_rules": [
      "No raw transcripts, credentials, environment files, or arbitrary file reads",
      "Sensitive paths remain opaque",
      "Repository paths never appear in resource URIs or cursors",
    ],
    "limits": [
      "page_size": 50,
      "graph_nodes": 500,
      "graph_edges": 1_000,
      "response_bytes": 1_000_000,
    ],
    "recent_audit": audit,
  ]
  return try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.mcp-settings/v1",
    "generated_at": "2026-09-01T00:00:00Z",
    "operation": operation,
    "cleared_audit_rows": operation == "clear_audit" ? 12 : 0,
    "settings": settings,
  ])
}

func historyRootsFixtureReceipt(
  operation: String,
  changedRoot: String? = nil
) throws -> Data {
  let changedRootValue: Any = changedRoot.map { $0 as Any } ?? NSNull()
  return try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.history-roots/v1",
    "generated_at": "2026-09-02T00:00:00Z",
    "operation": operation,
    "database_available": true,
    "changed_root": changedRootValue,
    "roots": [
      [
        "path": "/fixture/codex",
        "display_path": "~/Archive/codex",
        "exists": true,
        "sessions_available": true,
        "archived_sessions_available": true,
      ]
    ],
    "limitations": [
      "Saving a root does not start reconciliation or read transcript content."
    ],
  ])
}

func sessionRetentionFixtureReceipt(operation: String) throws -> Data {
  let entry: [String: Any] = [
    "sessionId": "session-protected-fixture",
    "rows": 42,
    "estimatedBytes": 32_768,
    "lastActivity": "2026-08-31T00:00:00Z",
    "reasons": ["referenced by intent closure", "attached to active work item"],
  ]
  let plan: [String: Any] = [
    "id": "retention-plan:fixture",
    "planIdentity": "sha256:fixture-plan",
    "archiveFingerprint": "sha256:fixture-archive",
    "policy": ["maxAgeDays": 90, "maxArchiveBytes": 2_147_483_648],
    "archiveRows": 8_000,
    "archiveBytes": 9_437_184,
    "candidateRows": 120,
    "candidateBytes": 262_144,
    "candidates": [
      [
        "sessionId": "session-removable-fixture",
        "rows": 120,
        "estimatedBytes": 262_144,
        "lastActivity": "2025-01-01T00:00:00Z",
        "reasons": ["older than configured age"],
      ]
    ],
    "protected": [entry],
    "projectedRows": 7_880,
    "projectedBytes": 9_175_040,
    "createdAt": "2026-09-01T00:00:00Z",
  ]
  let result: Any =
    operation == "plan"
    ? NSNull()
    : [
      "checkpointed": operation == "checkpoint",
      "vacuumed": operation == "checkpoint",
      "sourceTranscriptsDeleted": false,
    ]
  let planValue: Any = operation == "plan" ? plan : NSNull()
  return try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.session-retention/v1",
    "generated_at": "2026-09-01T00:00:00Z",
    "operation": operation,
    "plan": planValue,
    "result": result,
  ])
}

func memoryFixtureReceipt(operation: String) throws -> Data {
  let sourceID = "memory:sha256:fixture"
  let sources: [[String: Any]] = [
    [
      "id": sourceID,
      "tool": "Codex",
      "label": "Codex memory registry",
      "display_path": "~/.codex/memories/MEMORY.md",
      "exists": true,
      "readable": true,
      "file_size_bytes": 8_192,
      "modified_at": "2026-09-01T18:30:00Z",
      "source_kind": "markdown",
      "preview": "Runtime evidence and release boundaries",
      "note": "Full Markdown memory registry.",
    ]
  ]
  let selectedSourceID: Any = operation == "list" ? NSNull() : sourceID
  let document: Any =
    operation == "read"
    ? [
      "source_id": sourceID,
      "content":
        "# Verification memory\n\n- Bind every claim to executable evidence.\n- Keep release authority explicit.\n- Preserve the incumbent until parity is proven.\n\n## Current native work\n\nThe Evidence Workbench uses a true-black canvas and restrained amber actions.",
      "truncated": false,
      "extraction_note": "Showing the full text with secret-looking lines redacted.",
    ]
    : NSNull()
  let diff: Any =
    operation == "diff"
    ? [
      "source_id": sourceID,
      "has_changes": true,
      "status": "modified",
      "diff":
        "diff --git a/MEMORY.md b/MEMORY.md\n@@ -2 +2 @@\n-Use evidence.\n+Bind every claim to executable evidence.",
    ]
    : NSNull()
  return try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.memories/v1",
    "generated_at": "2026-09-02T00:00:00Z",
    "operation": operation,
    "selected_source_id": selectedSourceID,
    "candidate_locations_checked": 79,
    "sources_total": 1,
    "sources": sources,
    "document": document,
    "diff": diff,
    "limits": [
      "max_sources": 128,
      "max_read_bytes": 524_288,
      "max_output_chars": 120_000,
      "sources_truncated": false,
    ],
    "limitations": [
      "This surface is read-only and cannot edit, create, or delete memory sources.",
      "Agent and MCP projections are unavailable.",
    ],
  ])
}

func rubricFixtureReceipt(
  operation: String,
  savedPackID: String? = nil
) throws -> Data {
  let definitions: [(String, String, String, [String], Bool)] = [
    (
      "product-safety", "Product Safety",
      "User-facing regressions, broken flows, data loss, and confusing states.",
      [
        "Flag behavior changes that can break an existing user workflow.",
        "Check loading, empty, error, and permission states for user-facing screens.",
        "Prioritize concrete reproduction steps over style commentary.",
      ], true
    ),
    (
      "security-boundary", "Security Boundary",
      "Auth, authorization, secret handling, trust boundaries, and injection risk.",
      [
        "Verify server-side authorization, not just hidden client controls.",
        "Flag secrets, tokens, PII, or prompts that can leak into logs or analytics.",
        "Check untrusted input before database, shell, network, or model calls.",
      ], false
    ),
    (
      "agent-handoff", "Agent Handoff",
      "Review quality for multi-agent workflows and future task continuity.",
      [
        "Call out missing tests or verification commands the next agent must run.",
        "Prefer findings with file paths, line numbers, and a bounded fix.",
        "Separate real blockers from optional cleanup so agents do not waste context.",
      ], false
    ),
    (
      "performance-proof", "Performance Proof", "Measured performance regressions.",
      ["Require a reproducible baseline.", "Reject unsupported improvement claims."], false
    ),
  ]
  let packs: [[String: Any]] = definitions.enumerated().map { index, definition in
    let preview =
      ([
        "CodeVetter review standards pack:",
        "- Pack: \(definition.1)",
        "- Focus: \(definition.2)",
      ] + definition.3.map { "- Check: \($0)" }).joined(separator: "\n")
    return [
      "id": definition.0,
      "name": definition.1,
      "focus": definition.2,
      "checks": definition.3,
      "built_in": index < 3,
      "active": definition.4,
      "review_count": 12 - index,
      "total_findings": 28 - index,
      "prompt_preview": preview,
    ]
  }
  let savedPackValue: Any = savedPackID.map { $0 as Any } ?? NSNull()
  return try JSONSerialization.data(withJSONObject: [
    "schema_version": "codevetter.rubric-settings/v1",
    "generated_at": "2026-09-01T00:00:00Z",
    "operation": operation,
    "active_pack_id": "product-safety",
    "custom_rules": [],
    "packs": packs,
    "saved_pack_id": savedPackValue,
    "migrated_legacy_config": false,
  ])
}

func performanceFixtureReceipt(
  requestID: String,
  operation: String,
  state: String = "succeeded",
  exitCode: Int = 0,
  result: String
) -> String {
  """
  {"schema_version":1,"request_id":"\(requestID)","operation":"\(operation)","state":"\(state)","exit_code":\(exitCode),"duration_ms":42,"result":\(result),"stderr_summary":null,"cleanup":{"owned_process_reaped":true,"temporary_profiles_retained":false}}
  """
}

func warmVerificationFixture() -> String {
  let hashA = String(repeating: "a", count: 64)
  let hashB = String(repeating: "b", count: 64)
  let sha = String(repeating: "c", count: 40)
  return """
    {"id":"stored-warm-fixture","repo_path":"/fixture/repo","created_at":"2026-09-01T00:00:01Z","result":{"schema_version":1,"protocol_version":1,"run_id":"native-warm-fixture","outcome":"passed","started_at":"2026-09-01T00:00:00Z","finished_at":"2026-09-01T00:00:01Z","warm":true,"stale":false,"model_call_count":0,"source":{"target_sha":"\(sha)","change_set_kind":"worktree","change_set_identity":"\(hashA)","config_hash":"\(hashB)","manifest_hash":"\(hashA)","source_hash_before":"\(hashA)","source_hash_after":"\(hashA)"},"observation_policy":{"schema_version":1,"profile_id":"read-only-browser-v1"},"selection":{"changed_paths":["src/checkout.tsx"],"selected_scenario_ids":["checkout-smoke"],"mandatory_smoke_ids":["checkout-smoke"],"fallback_scenario_ids":[],"complete":true,"explanation":"The checkout path selected its declared smoke scenario."},"scenarios":[{"scenario_id":"checkout-smoke","outcome":"passed","duration_ms":184.5}],"timings":[{"stage":"total","duration_ms":212.0}],"observations":[{"id":"observation-1","scenario_id":"checkout-smoke","kind":"accessibility_smoke","disposition":"passed","policy_id":"read-only-browser-v1","message":"Checkout controls retained accessible labels.","occurred_at":"2026-09-01T00:00:00Z"}],"limitations":[{"code":"other","message":"Fixture proves native decoding and rendering only.","affects_confidence":false}],"artifacts":[{"id":"artifact-1","kind":"screenshot","relative_path":"artifacts/warm/checkout.png","sha256":"\(hashB)","bytes":2048,"redacted":true,"created_at":"2026-09-01T00:00:00Z","retained_until":"2026-09-08T00:00:00Z","scenario_id":"checkout-smoke"}],"cancellation":{"state":"not_requested"}}}
    """
}

func differentialPreparedFixture() -> String {
  """
  {"schema_version":1,"run_id":"native-diff-fixture","status":"ready","reference_sha":"\(String(repeating: "a", count: 40))","candidate_kind":"range","candidate_identity":"\(String(repeating: "b", count: 64))","selection_identity":"\(String(repeating: "c", count: 64))","scenario_count":2,"source_cache_hits":1,"dependency_cache_hit":true,"prepared_bytes":4096,"reason_codes":[],"model_call_count":0,"cleanup_complete":false}
  """
}

func differentialStoredFixture() -> String {
  """
  {"id":"stored-diff-fixture","repo_path":"/fixture/repo","created_at":"2026-09-01T00:00:01Z","summary":{"schema_version":1,"run_id":"native-diff-fixture","status":"complete","classification":"regressed","plan_identity":"\(String(repeating: "d", count: 64))","reference_sha":"\(String(repeating: "a", count: 40))","candidate_kind":"range","candidate_identity":"\(String(repeating: "b", count: 64))","scenario_count":2,"delta_count":1,"blocking_delta_count":1,"delta_previews":[{"id":"delta-1","scenario_id":"checkout-smoke","kind":"assertion","direction":"candidate_only","blocking":true,"policy_id":"paired-browser-v1"}],"delta_previews_truncated":false,"reason_codes":["candidate_regression"],"comparison_policy_identities":["paired-browser-v1"],"duration_ms":284.5,"cleanup_complete":true,"creates_pass_evidence":false,"model_call_count":0}}
  """
}

func scenarioCompilerFixture(action: String) -> String {
  let hash = String(repeating: "a", count: 64)
  let sha = String(repeating: "b", count: 40)
  return """
    {"schema_version":1,"action":"\(action)","status":"ok","message":"Candidate validated and dry-run passed.","candidate":{"schema_version":1,"candidate_id":"candidate-fixture","candidate_hash":"\(hash)","cache_key":"\(hash)","status":"candidate","created_at":"2026-09-01T00:00:00Z","expires_at":"2026-09-02T00:00:00Z","spec_source_path":"docs/checkout.md","spec_section":"Checkout","spec_hash":"\(hash)","target_sha":"\(sha)","config_hash":"\(hash)","manifest_hash":"\(hash)","provider":{"kind":"local_command","provider":"local","model":"qwen2.5-coder:7b","cost_class":"free","paid_approved":false},"provider_duration_ms":240,"cache_hit":false,"usage":{"input_tokens":120,"output_tokens":80,"estimated_cost_usd":0,"actual_cost_usd":0},"unresolved_requirements":[],"validation":{"qualified":true,"issues":[]},"dry_run":{"status":"passed","duration_ms":180,"summary":"Scenario ran without writes.","diagnostics":[],"evidence_persisted":false,"baselines_updated":false},"files":[{"kind":"scenario","destination":".codevetter/scenarios/checkout.yaml","sha256":"\(hash)","replaces_existing":true,"diff":"+ id: checkout-smoke\\n+ route: /checkout"},{"kind":"provenance","destination":".codevetter/provenance/checkout.json","sha256":"\(hash)","replaces_existing":false,"diff":"+ {\\\"source\\\":\\\"docs/checkout.md\\\"}"}],"accepted_file_hashes":{}},"candidates":[],"cleanup":null}
    """
}

func trexWatcherFixture(operation: String) -> String {
  let headA = String(repeating: "a", count: 40)
  let headB = String(repeating: "b", count: 40)
  return """
    {"schema_version":1,"operation":"\(operation)","watcher":{"repo_path":"/fixture/repo","interval_secs":300,"enabled":true,"base_branch":"main","last_polled_at":"2026-09-01 00:05:00","last_error":null,"created_at":"2026-09-01 00:00:00"},"watchers":[],"runs":[{"id":"watcher-run-fixture","repo_path":"/fixture/repo","pr_number":42,"head_sha":"\(headA)","verdict":"APPROVE","confidence":0.97,"summary":"Checkout and receipt journeys passed in the isolated PR worktree.","status_state":"success","status_error":null,"duration_ms":1842,"ran_at":"2026-09-01T00:05:02Z"},{"id":"watcher-run-limited","repo_path":"/fixture/repo","pr_number":39,"head_sha":"\(headB)","verdict":"NEEDS_REVIEW","confidence":0.61,"summary":"Runtime checks completed, but one browser observation needs maintainer review.","status_state":"pending","status_error":"GitHub status remained pending while evidence was retained.","duration_ms":2310,"ran_at":"2026-09-01T00:02:00Z"}],"inspected_prs":4,"skipped_unchanged":2,"message":"Inspected 4 open PR(s); completed 2 new run(s); skipped 2 unchanged."}
    """
}

func usagePeriod(
  _ period: String,
  agent: String,
  generated: UInt64,
  model: String
) -> LocalUsagePeriod {
  let totals = localUsageTotals(generated)
  let modelUsage = LocalUsageModel(model: model, totals: totals, fallback: false, priced: true)
  return LocalUsagePeriod(
    period: period,
    totals: totals,
    agents: [LocalUsageAgent(agent: agent, totals: totals, models: [modelUsage])],
    models: [modelUsage]
  )
}

func usageSession(
  _ id: String,
  agent: String,
  activity: String?
) -> LocalUsageSession {
  LocalUsageSession(
    sessionID: id,
    agent: agent,
    lastActivity: activity,
    reasoningOutputTokens: 0,
    totals: localUsageTotals(10),
    models: []
  )
}

func localUsageTotals(_ generated: UInt64) -> LocalUsageTotals {
  LocalUsageTotals(
    inputTokens: generated / 2,
    cacheCreationTokens: generated / 4,
    cacheReadTokens: generated * 2,
    outputTokens: generated - generated / 2 - generated / 4,
    totalTokens: generated * 3,
    costUSD: Double(generated) / 100_000
  )
}

func usageTotals(_ generated: UInt64) -> [String: Any] {
  [
    "input_tokens": generated / 2,
    "cache_creation_tokens": generated / 4,
    "cache_read_tokens": generated * 2,
    "output_tokens": generated / 4,
    "total_tokens": generated * 3,
    "cost_usd": Double(generated) / 100_000,
  ]
}

@Test
func supervisedRunnerPassesTheRepositoryFilterToRust() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-filter-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let emptyHistory =
    #"{"schema_version":"codevetter.run-history/v1","generated_at":"2026-08-31T00:00:00Z","repo_path":"/fixture/repo","limit":20,"returned":0,"runs":[]}"#
  try "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\\n' '\(emptyHistory)'\n"
    .write(
      to: executable,
      atomically: true,
      encoding: .utf8
    )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runs = try await CodeVetterProcessRunner(executableURL: executable).listRuns(
    repositoryPath: "/fixture/repo",
    limit: 20
  )
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)

  #expect(runs.isEmpty)
  #expect(arguments.contains("runs --json --limit 20"))
  #expect(arguments.contains("--repo /fixture/repo"))
}
