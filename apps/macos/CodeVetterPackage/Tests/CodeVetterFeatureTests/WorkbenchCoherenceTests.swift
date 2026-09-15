import AppKit
import Foundation
import SwiftUI
import Testing

@testable import CodeVetterFeature

@MainActor
@Suite struct WorkbenchCoherenceTests {
  private func model() -> WorkbenchModel {
    // Never read the operator's data or invoke a real verification command.
    WorkbenchModel(
      runner: CodeVetterProcessRunner(executableURL: URL(fileURLWithPath: "/usr/bin/false")))
  }

  private func source(root: String = "/fixture/one", head: String = "head") throws
    -> NavigatorSnapshot
  {
    try JSONDecoder().decode(
      NavigatorSnapshot.self,
      from: Data(
        """
        {"id":0,"label":"Fixture","kind":"commit","root":"\(root)","head":"\(head)","base":"base",
         "files":[],"initialPath":null,"initialLine":1}
        """.utf8))
  }

  @Test func repositorySwitchClearsSourceAndRepositorySpecificInputs() throws {
    let model = model()
    model.selectRepository(URL(fileURLWithPath: "/fixture/one"), persist: false)
    model.navigator.snapshot = try source()
    model.navigator.showVerification = true
    model.navigator.showFullUnpack = true
    model.navigator.searchQuery = "old source"
    model.task = "Old instructions"
    model.testingChange = "old...branch"
    model.testingPreviewURL = "https://old.example.invalid"
    model.testingConfirmed = true
    model.performanceTarget = "old.test.ts"
    model.performanceName = "old benchmark"
    model.performanceBaselineRepositoryPath = "/fixture/old-baseline"
    model.performanceRecordedRunID = "old-run"
    model.scenarioSpecPath = "old-spec.md"
    model.selectRepository(URL(fileURLWithPath: "/fixture/two"), persist: false)
    #expect(model.navigator.snapshot == nil)
    #expect(model.navigator.input == "/fixture/two")
    #expect(!model.navigator.showVerification && !model.navigator.showFullUnpack)
    #expect(model.navigator.searchQuery.isEmpty)
    #expect(model.task.isEmpty && model.testingChange.isEmpty)
    #expect(model.testingPreviewURL.isEmpty && !model.testingConfirmed)
    #expect(model.performanceTarget.isEmpty && model.performanceName.isEmpty)
    #expect(model.performanceBaselineRepositoryPath.isEmpty)
    #expect(model.performanceRecordedRunID.isEmpty)
    #expect(model.performanceScopeKind == .codebase)
    #expect(model.scenarioSpecPath.isEmpty)
  }

  @Test func selectingSameRepositoryPreservesWorkInProgress() throws {
    let model = model()
    model.selectRepository(URL(fileURLWithPath: "/fixture/one"), persist: false)
    model.navigator.snapshot = try source()
    model.testingChange = "base...head"
    model.testingPreviewURL = "https://preview.example.invalid"
    model.testingConfirmed = true
    model.selectRepository(URL(fileURLWithPath: "/fixture/one/"), persist: false)
    #expect(model.navigator.snapshot != nil)
    #expect(model.testingChange == "base...head")
    #expect(model.testingConfirmed)
  }

  @Test func sourceOpeningUpdatesSharedContextWithoutAVisiblePage() throws {
    let model = model()
    model.repositoryPath = "/fixture/old"
    model.testingPreviewURL = "https://old.example.invalid"
    let snapshot = try source()
    model.navigator.snapshot = snapshot
    model.navigator.didOpen?(snapshot)
    #expect(model.repositoryPath == snapshot.root)
    #expect(model.navigator.snapshot?.head == snapshot.head)
    #expect(model.testingPreviewURL.isEmpty)
    model.navigator.unpackRoot = "/fixture/materialized"
    model.testingChange = "base...head"
    model.selectRepository(URL(fileURLWithPath: "/fixture/materialized"), persist: false)
    #expect(model.navigator.snapshot?.head == snapshot.head)
    #expect(model.testingChange == "base...head")
  }

  @Test func testingHandoffUsesOnlyAppliedMatchingComparison() throws {
    let model = model()
    model.repositoryPath = "/fixture/one"
    model.navigator.snapshot = try source()
    model.testingConfirmed = true
    model.useNavigatorComparisonForTesting()
    #expect(model.testingChange == "base...head")
    #expect(!model.testingConfirmed)
    model.navigator.reviewHead = "unapplied-branch"
    #expect(!model.canUseNavigatorComparisonForTesting)
    model.testingChange = "keep-existing"
    model.useNavigatorComparisonForTesting()
    #expect(model.testingChange == "keep-existing")
    model.navigator.reviewHead = "local"
    model.repositoryPath = "/fixture/two"
    #expect(!model.canUseNavigatorComparisonForTesting)
  }

  @Test func unpackDetailsRequireMatchingRepositoryAndRevision() throws {
    let model = model()
    model.navigator.snapshot = try source()
    func unpack(root: String, head: String) throws -> UnpackSnapshotRecord {
      try JSONDecoder().decode(
        UnpackSnapshotRecord.self,
        from: Data(
          """
          {"id":"unpack","repo_path":"\(root)","repo_name":"one","commit_sha":"\(head)",
           "status":"completed","files_scanned":1,"files_skipped":0,"created_at":"now",
           "analysis_ready":false,"bytes_scanned":1}
          """.utf8))
    }
    model.unpackSnapshot = try unpack(root: "/fixture/one", head: "head")
    #expect(model.hasMatchingUnpack)
    model.unpackSnapshot = try unpack(root: "/fixture/one", head: "old-head")
    #expect(!model.hasMatchingUnpack)
    model.unpackSnapshot = try unpack(root: "/fixture/two", head: "head")
    #expect(!model.hasMatchingUnpack)
    model.navigator.unpackRoot = "/fixture/two"
    #expect(model.hasMatchingUnpack)
  }

  @Test func settingsRefreshRoutesLoadingAndErrorsToTheVisibleSection() {
    for section in [NativeSettingsSection.mcp, .usage, .rubrics, .memories, .ops, .general] {
      let model = model()
      model.repositoryPath = "/fixture/one"
      model.settingsSection = section
      model.settingsIssue = "An unrelated preference failure"
      if section != .general { #expect(model.selectedSettingsIssue == nil) }
      model.refreshSelectedSettings()
      #expect(model.selectedSettingsLoading)
      switch section {
      case .mcp: #expect(model.mcpLoading && !model.settingsLoading)
      case .usage: #expect(model.historyRootsLoading && !model.settingsLoading)
      case .rubrics: #expect(model.rubricLoading && !model.settingsLoading)
      case .memories: #expect(model.memoryLoading && !model.settingsLoading)
      case .ops: #expect(model.opsLoading && !model.settingsLoading)
      default: #expect(model.settingsLoading)
      }
    }
  }

  @Test func runHandoffSelectsExactResultAndNeverSubstitutesMissingRun() throws {
    let model = model()
    let runs = try CodeVetterProcessRunner.decodeRunHistory(
      Data(
        """
        {"schema_version":"codevetter.run-history/v1","runs":[
          {"id":"new","kind":"preview","repo_path":"/fixture/one","recorded_at":"now",
           "title":"Preview","outcome":"passed","receipt_schema":"codevetter.trex-preview/v1",
           "limitations":[],"receipt":{}},
          {"id":"old","kind":"preview","repo_path":"/fixture/one","recorded_at":"before",
           "title":"Preview","outcome":"passed","receipt_schema":"codevetter.trex-preview/v1",
           "limitations":[],"receipt":{}}
        ]}
        """.utf8))
    model.selectedRunID = "old"
    model.applyLoadedRuns(runs, selecting: "new")
    #expect(model.selectedRun?.id == "new")
    model.applyLoadedRuns(runs, selecting: "missing")
    #expect(model.selectedRun == nil)
    #expect(model.runsIssue?.contains("No other result was substituted") == true)
  }

  @Test func setupPagesRenderOffscreenInBothAppearances() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("../../../../../artifacts/coherence-review").standardizedFileURL
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    for section in [WorkbenchSection.testing, .performance, .runs, .settings] {
      for dark in [true, false] {
        for width in [980, 1440] {
          let model = model()
          model.section = section
          model.settingsReceipt = try JSONDecoder().decode(
            NativeSettingsReceipt.self, from: nativeSettingsFixtureReceipt())
          let host = NSHostingView(
            rootView: PremiumWorkbenchRootView(model: model)
              .preferredColorScheme(dark ? .dark : .light))
          host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
          host.frame = NSRect(x: 0, y: 0, width: width, height: 800)
          host.layoutSubtreeIfNeeded()
          let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
          host.cacheDisplay(in: host.bounds, to: bitmap)
          let data = try #require(bitmap.representation(using: .png, properties: [:]))
          try data.write(
            to: root.appendingPathComponent(
              "\(section.rawValue)-\(width)-\(dark ? "dark" : "light").png"))
          #expect(host.window == nil)
        }
      }
    }
  }
}
