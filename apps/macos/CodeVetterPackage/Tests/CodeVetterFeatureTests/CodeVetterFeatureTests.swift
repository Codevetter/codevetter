import AppKit
import Darwin
import Foundation
import SwiftUI
import Testing

@testable import CodeVetterFeature

@Test func evidenceForegroundTokensMeetNormalTextContrastInBothAppearances() throws {
  let darkAppearance = try #require(NSAppearance(named: .darkAqua))
  let lightAppearance = try #require(NSAppearance(named: .aqua))
  let tokens = [
    EvidenceStyle.amberForegroundNSColor,
    EvidenceStyle.successNSColor,
    EvidenceStyle.warningNSColor,
    EvidenceStyle.failureNSColor,
  ]

  for token in tokens {
    let darkForeground = try #require(resolveNativeColor(token, in: darkAppearance))
    let lightForeground = try #require(resolveNativeColor(token, in: lightAppearance))
    #expect(nativeContrastRatio(darkForeground, against: 0x000000) >= 4.5)
    #expect(nativeContrastRatio(lightForeground, against: 0xF7F6F3) >= 4.5)
    #expect(nativeContrastRatio(lightForeground, against: 0xFFFFFF) >= 4.5)
  }
}

@Test func providerBrandMarksAreBundledAndDecodable() throws {
  for provider in ["claude", "codex"] {
    #expect(ProviderBrandAsset.resourceURL(for: provider) != nil)
    let image = try #require(ProviderBrandAsset.image(for: provider))
    #expect(image.size.width > 0)
    #expect(image.size.height > 0)
  }
}

@MainActor
@Test func usageSnapshotsRestoreBeforeLiveCollectionFinishes() async throws {
  let directory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-usage-snapshots-\(UUID().uuidString)", directoryHint: .isDirectory)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = UsageSnapshotStore(directory: directory)
  let usageJSON =
    #"{"status":"ready","stale":false,"error":null,"provenance":{"engine":"ccusage","version":"20.0.20","generated_at":"2026-09-04T00:00:00Z","timezone":"UTC","window":"all","detected_agents":["claude","codex"],"excluded_agents":[],"codex_roots":[],"source_fingerprint":"sha256:snapshot","pricing_complete":true,"fallback_models":[],"unpriced_models":[]},"daily":[],"weekly":[],"monthly":[],"sessions":[],"totals":{"input_tokens":1,"cache_creation_tokens":2,"cache_read_tokens":3,"output_tokens":4,"total_tokens":10,"cost_usd":0.25}}"#
  let quotaJSON =
    #"{"schema_version":"codevetter.provider-quota/v1","generated_at":"2026-09-04T00:00:00Z","providers":[{"provider":"codex","status":"ready","source":"fixture","checked_at":"2026-09-04T00:00:00Z","plan":"pro","windows":[{"id":"codex.primary","label":"Weekly window","used_percent":25,"remaining_percent":75,"window_duration_minutes":10080,"resets_at_unix":null,"reset_description":null}],"credits":null,"reset_credits":null,"message":null}],"limitations":[]}"#
  let quota = try JSONDecoder().decode(ProviderQuotaReceipt.self, from: Data(quotaJSON.utf8))
  try store.saveUsage(rawJSON: usageJSON)
  try store.saveProviderQuota(quota)
  let usagePermissions = try FileManager.default.attributesOfItem(
    atPath: directory.appending(path: "local-usage.json").path
  )[.posixPermissions] as? NSNumber

  let model = WorkbenchModel(usageSnapshotStore: store)
  await model.restoreUsageSnapshots()

  #expect(model.usageReport?.totals.totalTokens == 10)
  #expect(model.usageReportJSON == usageJSON)
  #expect(model.usageSelectedAgents == ["claude", "codex"])
  #expect(model.providerQuotaReceipt?.providers.first?.provider == "codex")
  #expect(model.usageShowingSavedSnapshot)
  #expect(model.providerQuotaShowingSavedSnapshot)
  #expect(!model.usageLoading)
  #expect(!model.providerQuotaLoading)
  #expect(usagePermissions?.intValue == 0o600)
}

@Test func usageSnapshotStoreIgnoresMalformedFiles() throws {
  let directory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-invalid-usage-snapshots-\(UUID().uuidString)", directoryHint: .isDirectory)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  try Data("not-json".utf8).write(to: directory.appending(path: "local-usage.json"))
  try Data("[]".utf8).write(to: directory.appending(path: "provider-quota.json"))

  let restored = UsageSnapshotStore(directory: directory).restore()

  #expect(restored.usageReport == nil)
  #expect(restored.usageReportJSON.isEmpty)
  #expect(restored.providerQuota == nil)
}

@MainActor
@Test func staleUsageSnapshotsStayVisibleWhileCollectorsRevalidate() async throws {
  let root = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-stale-usage-\(UUID().uuidString)", directoryHint: .isDirectory)
  let snapshotDirectory = root.appending(path: "snapshots", directoryHint: .isDirectory)
  let executable = root.appending(path: "codevetter")
  defer { try? FileManager.default.removeItem(at: root) }
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  let usageJSON =
    #"{"status":"ready","stale":false,"error":null,"provenance":{"engine":"ccusage","version":"20.0.20","generated_at":"2026-09-04T00:00:00Z","timezone":"UTC","window":"all","detected_agents":["codex"],"excluded_agents":[],"codex_roots":[],"source_fingerprint":"sha256:snapshot","pricing_complete":true,"fallback_models":[],"unpriced_models":[]},"daily":[],"weekly":[],"monthly":[],"sessions":[],"totals":{"input_tokens":1,"cache_creation_tokens":2,"cache_read_tokens":3,"output_tokens":4,"total_tokens":10,"cost_usd":0.25}}"#
  let quotaJSON =
    #"{"schema_version":"codevetter.provider-quota/v1","generated_at":"2026-09-04T00:00:00Z","providers":[{"provider":"codex","status":"ready","source":"fixture","checked_at":"2026-09-04T00:00:00Z","plan":"pro","windows":[{"id":"codex.primary","label":"Weekly window","used_percent":25,"remaining_percent":75,"window_duration_minutes":10080,"resets_at_unix":null,"reset_description":null}],"credits":null,"reset_credits":null,"message":null}],"limitations":[]}"#
  let store = UsageSnapshotStore(directory: snapshotDirectory)
  let quota = try JSONDecoder().decode(ProviderQuotaReceipt.self, from: Data(quotaJSON.utf8))
  try store.saveUsage(rawJSON: usageJSON)
  try store.saveProviderQuota(quota)
  let staleDate = Date().addingTimeInterval(-10 * 60)
  for file in ["local-usage.json", "provider-quota.json"] {
    try FileManager.default.setAttributes(
      [.modificationDate: staleDate],
      ofItemAtPath: snapshotDirectory.appending(path: file).path
    )
  }
  try """
  #!/bin/sh
  sleep 0.25
  if [ "$1" = "usage" ]; then
    printf '%s' '\(usageJSON)'
  else
    printf '%s' '\(quotaJSON)'
  fi
  """.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)

  let model = WorkbenchModel(
    runner: CodeVetterProcessRunner(executableURL: executable),
    usageSnapshotStore: store
  )
  model.usageTimezone = "UTC"
  await model.prepareUsage()

  #expect(model.usageReport?.totals.totalTokens == 10)
  #expect(model.providerQuotaReceipt?.providers.first?.provider == "codex")
  #expect(model.usageShowingSavedSnapshot)
  #expect(model.providerQuotaShowingSavedSnapshot)
  #expect(model.usageLoading)
  #expect(model.providerQuotaLoading)

  while model.usageLoading || model.providerQuotaLoading {
    try await Task.sleep(for: .milliseconds(20))
  }
  #expect(!model.usageShowingSavedSnapshot)
  #expect(!model.providerQuotaShowingSavedSnapshot)
}

@MainActor
private struct UsageAutoRefreshHarness {
  let root: URL
  let model: WorkbenchModel

  init(sameFingerprintOnEveryCall: Bool) throws {
    root = FileManager.default.temporaryDirectory
      .appending(path: "codevetter-usage-poll-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let executable = root.appending(path: "codevetter")
    let usageCalls = root.appending(path: "usage-calls").path
    let quotaCalls = root.appending(path: "quota-calls").path
    let fingerprint =
      sameFingerprintOnEveryCall ? "sha256:constant" : #"sha256:call-'"$count"'"#
    let quotaJSON =
      #"{"schema_version":"codevetter.provider-quota/v1","generated_at":"2026-09-04T00:00:00Z","providers":[{"provider":"codex","status":"ready","source":"fixture","checked_at":"2026-09-04T00:00:00Z","plan":"pro","windows":[],"credits":null,"reset_credits":null,"message":null}],"limitations":[]}"#
    try """
    #!/bin/sh
    if [ "$1" = "usage" ]; then
      printf 'x' >> "\(usageCalls)"
      count=$(wc -c < "\(usageCalls)" | tr -d ' ')
      printf '{"status":"ready","stale":false,"error":null,"provenance":{"engine":"ccusage","version":"20.0.20","generated_at":"2026-09-04T00:00:0'"$count"'Z","timezone":"UTC","window":"all","detected_agents":["codex"],"excluded_agents":[],"codex_roots":[],"source_fingerprint":"\(fingerprint)","pricing_complete":true,"fallback_models":[],"unpriced_models":[]},"daily":[],"weekly":[],"monthly":[],"sessions":[],"totals":{"input_tokens":1,"cache_creation_tokens":2,"cache_read_tokens":3,"output_tokens":4,"total_tokens":10,"cost_usd":0.25}}'
    else
      printf 'x' >> "\(quotaCalls)"
      printf '%s' '\(quotaJSON)'
    fi
    """.write(to: executable, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700], ofItemAtPath: executable.path)

    model = WorkbenchModel(
      runner: CodeVetterProcessRunner(executableURL: executable),
      usageSnapshotStore: UsageSnapshotStore(
        directory: root.appending(path: "snapshots", directoryHint: .isDirectory))
    )
    model.usageTimezone = "UTC"
    model.usageAutoRefreshTick = 0.05
    model.usageAutoRefreshInterval = 0.1
    model.providerQuotaAutoRefreshInterval = 600
  }

  func usageCollectionCount() -> Int {
    let data = try? Data(contentsOf: root.appending(path: "usage-calls"))
    return data?.count ?? 0
  }

  func cleanUp() {
    try? FileManager.default.removeItem(at: root)
  }

  func settle() async throws {
    while model.usageLoading || model.providerQuotaLoading {
      try await Task.sleep(for: .milliseconds(20))
    }
  }

  func waitForUsageCollections(atLeast target: Int) async throws -> Bool {
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline {
      if usageCollectionCount() >= target { return true }
      try await Task.sleep(for: .milliseconds(20))
    }
    return false
  }
}

@MainActor
@Test func usageRecollectsOnItsOwnAfterTheCadenceElapses() async throws {
  let harness = try UsageAutoRefreshHarness(sameFingerprintOnEveryCall: false)
  defer { harness.cleanUp() }
  let model = harness.model

  await model.prepareUsage()
  try await harness.settle()
  #expect(harness.usageCollectionCount() == 1)
  let firstCollectedAt = try #require(model.usageLastLoadedAt)

  let poll = Task { await model.runUsageAutoRefresh() }
  let recollected = try await harness.waitForUsageCollections(atLeast: 3)
  try await harness.settle()
  poll.cancel()

  #expect(recollected)
  #expect(!model.usageShowingSavedSnapshot)
  #expect((model.usageLastLoadedAt ?? firstCollectedAt) > firstCollectedAt)
}

@MainActor
@Test func usageAutoRefreshStaysQuietWhileTheAppIsNotFrontmost() async throws {
  let harness = try UsageAutoRefreshHarness(sameFingerprintOnEveryCall: false)
  defer { harness.cleanUp() }
  let model = harness.model

  await model.prepareUsage()
  try await harness.settle()
  model.setUsageAutoRefreshSuspended(true)

  let poll = Task { await model.runUsageAutoRefresh() }
  try await Task.sleep(for: .milliseconds(500))
  let suspendedCount = harness.usageCollectionCount()
  model.usageWindowBecameActive()
  let resumed = try await harness.waitForUsageCollections(atLeast: suspendedCount + 1)
  poll.cancel()

  #expect(suspendedCount == 1)
  #expect(resumed)
}

@MainActor
@Test func repeatUsageCollectionKeepsTheAcceptedReportWhenSourcesAreUnchanged() async throws {
  let harness = try UsageAutoRefreshHarness(sameFingerprintOnEveryCall: true)
  defer { harness.cleanUp() }
  let model = harness.model

  model.loadUsage()
  try await harness.settle()
  let firstGeneratedAt = model.usageReport?.provenance.generatedAt
  #expect(firstGeneratedAt == "2026-09-04T00:00:01Z")

  model.loadUsage()
  try await harness.settle()

  #expect(harness.usageCollectionCount() == 2)
  #expect(model.usageReport?.provenance.generatedAt == firstGeneratedAt)
  #expect(model.usageReportJSON.contains("2026-09-04T00:00:01Z"))
  #expect(!model.usageShowingSavedSnapshot)
}

private func devinSummary(status: String, sessions: Int64) -> DevinUsageSummary {
  let json = """
    {"status":"\(status)","source":"CodeVetter SQLite · indexed Devin sessions.db",
     "sessions":\(sessions),"generated_tokens":1200,"cache_read_tokens":200,
     "output_tokens":300,"cost_usd":0.42,
     "models":[{"model":"glm-5.2","sessions":\(sessions),"generated_tokens":1200,
                "cache_read_tokens":200,"cost_usd":0.42}],
     "windows":[{"window":"30d","since":"2026-08-06","sessions":\(sessions),
                 "generated_tokens":1200,"cache_read_tokens":200,"cost_usd":0.42,
                 "models":[]}],
     "limitations":["This local history is not live quota telemetry."]}
    """
  return try! JSONDecoder().decode(DevinUsageSummary.self, from: Data(json.utf8))
}

@Test func devinDistinguishesAnUnreadableHistoryFromAQuietWindow() throws {
  let active = devinSummary(status: "ready", sessions: 3)
  #expect(active.availability(for: .thirtyDays) == .active)

  let quiet = devinSummary(status: "ready", sessions: 0)
  #expect(quiet.availability(for: .thirtyDays) == .empty)

  // A source CodeVetter could not read must never be reported as zero activity,
  // even when the projected counters are zero.
  let unreadable = devinSummary(status: "unavailable", sessions: 0)
  #expect(unreadable.availability(for: .thirtyDays) == .unavailable)

  // Nor when stale counters survive alongside a failed status.
  let staleCounters = devinSummary(status: "unavailable", sessions: 3)
  #expect(staleCounters.availability(for: .thirtyDays) == .unavailable)
}

@Test func nativeUpdaterConfigurationFailsClosedUntilEverySigningInputExists() throws {
  let preview = NativeUpdaterConfiguration(
    feedURL: URL(string: "https://updates.example.test/appcast.xml"),
    publicEdKey: "fixture-public-key",
    productionBundle: false
  )
  #expect(!preview.ready)
  #expect(preview.status.contains("Preview"))

  let unsigned = NativeUpdaterConfiguration(
    feedURL: URL(string: "https://updates.example.test/appcast.xml"),
    publicEdKey: nil,
    productionBundle: true
  )
  #expect(!unsigned.ready)
  #expect(unsigned.status.contains("EdDSA"))

  let insecure = NativeUpdaterConfiguration(
    feedURL: URL(string: "http://updates.example.test/appcast.xml"),
    publicEdKey: "fixture-public-key",
    productionBundle: true
  )
  #expect(!insecure.ready)
  #expect(insecure.status.contains("secure Sparkle appcast"))

  let ready = NativeUpdaterConfiguration(
    feedURL: URL(string: "https://updates.example.test/appcast.xml"),
    publicEdKey: "fixture-public-key",
    productionBundle: true
  )
  #expect(ready.ready)
  #expect(ready.status == "Signed Sparkle updates are available.")
}

private func sharedSurfaceParityFixture(
  named name: String = "evidence-scope-v1"
) throws -> [String: Any] {
  var repositoryRoot = URL(fileURLWithPath: #filePath)
  for _ in 0..<6 {
    repositoryRoot.deleteLastPathComponent()
  }
  let fixtureURL =
    repositoryRoot
    .appending(path: "crates/codevetter-core/tests/fixtures/surface-parity/\(name).json")
  return try #require(
    JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any]
  )
}

@Test func bundledCapabilitiesPreserveRustAuthorityAndSurfaceGaps() throws {
  let registry = try CapabilityRegistry.bundled()
  #expect(registry.schemaVersion == "codevetter.capabilities.v1")
  #expect(registry.authority == "codevetter-rust-core")
  #expect(
    registry.capabilities.contains { capability in
      capability.id == "verification.local_check"
        && capability.surfaces.cli.availability == .available
        && capability.surfaces.cli.entrypoints.contains("codevetter fix")
        && capability.surfaces.agent.availability == .available
        && capability.surfaces.agent.authority == .readExecute
        && capability.surfaces.agent.entrypoints.contains {
          $0.contains("verification_get_receipt")
        }
    })
  #expect(registry.capabilities.contains { $0.stage == .future })
}

@MainActor
@Test
func nativeCapabilitiesRenderTheMCPAndCollectorAuthoritySplit() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .capabilities
  model.selectedCapabilityID = "machine.repository_mcp"

  let collectors = try #require(
    model.registry.capabilities.first { $0.id == "evidence.tool_collectors" }
  )
  #expect(collectors.surfaces.ui.availability == .planned)
  #expect(collectors.surfaces.ui.authority == .none)
  #expect(collectors.surfaces.cli.authority == .readExecute)
  #expect(collectors.surfaces.agent.authority == .none)

  for _ in 0..<5 { renderCapabilities(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_CAPABILITIES_SCREENSHOT_PATH"
  ] {
    try captureCapabilities(model, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test func commandPaletteRendersEveryRetainedWorkspaceWithoutChangingSelection() throws {
  let model = WorkbenchModel()
  model.section = .review
  let host = NSHostingView(rootView: PremiumCommandPaletteView(model: model))
  host.appearance = NSAppearance(named: .darkAqua)
  host.frame = NSRect(x: 0, y: 0, width: 520, height: 520)
  host.layoutSubtreeIfNeeded()
  host.displayIfNeeded()

  #expect(WorkbenchSection.allCases.count == 7)
  #expect(model.section == .review)
  #expect(host.fittingSize.width <= 520)
  #expect(host.fittingSize.height <= 520)

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_COMMAND_PALETTE_SCREENSHOT_PATH"
  ] {
    try captureHost(host, at: URL(fileURLWithPath: screenshotPath))
  }
}

@Test func compactNavigationKeepsOnlyTheSelectedWorkspaceLabel() {
  #expect(
    workbenchNavigationShowsLabel(
      for: .testing,
      selectedSection: .testing,
      showAllLabels: false
    ))
  #expect(
    !workbenchNavigationShowsLabel(
      for: .review,
      selectedSection: .testing,
      showAllLabels: false
    ))
  #expect(
    workbenchNavigationShowsLabel(
      for: .review,
      selectedSection: .testing,
      showAllLabels: true
    ))
  #expect(
    !workbenchNavigationShowsLabel(
      for: .settings,
      selectedSection: .settings,
      showAllLabels: true
    ))
}

@Test func statusPillsHumanizeMachineStyleLabels() {
  #expect(evidenceStatusLabel("needs_attention") == "needs attention")
  #expect(evidenceStatusLabel("Rust-owned receipt") == "Rust-owned receipt")
}

@Test func bundledCLICannotResolveToTheCaseInsensitiveApplicationExecutable() {
  let application = URL(fileURLWithPath: "/Applications/CodeVetter.app/Contents/MacOS/CodeVetter")
  #expect(!isDistinctBundledCLI(application, mainExecutable: application))
  #expect(
    !isDistinctBundledCLI(
      URL(fileURLWithPath: "/Applications/CodeVetter.app/Contents/MacOS/CodeVetter"),
      mainExecutable: URL(fileURLWithPath: "/tmp/CodeVetter")
    ))
  #expect(
    isDistinctBundledCLI(
      URL(fileURLWithPath: "/tmp/CodeVetter.app/Contents/MacOS/codevetter"),
      mainExecutable: URL(fileURLWithPath: "/tmp/CodeVetter.app/Contents/MacOS/CodeVetterNative")
    ))
}

@Test
func supervisedRunnerDecodesTheCanonicalRustReceiptBoundary() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-runner-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let requestID = "native-preflight-fixture"
  let receipt =
    #"{"schema_version":"codevetter.local-check-preflight/v1","request_id":"native-preflight-fixture","ran_at":"2026-08-31T00:00:00Z","repo_path":"/fixture/repo","task":"Preserve output","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/main.rs"]},"correctness_target":{"adapter":"cargo-test","target":"tests/output.rs","name":null,"source":"discovered:fixture"},"performance_target":null,"status":"ready","limitations":["Fixture proves transport only."]}"#
  try "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\\n' '\(receipt)'\n"
    .write(
      to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let result = try await CodeVetterProcessRunner(executableURL: executable).run(
    VerificationRequest(
      requestID: requestID,
      repositoryPath: "/fixture/repo",
      change: "main...HEAD",
      task: "Preserve output",
      specPaths: ["docs/output.md"],
      selectedRequirementIDs: ["output-stable"]
    ),
    preflight: true,
    onProgress: { _ in }
  )

  #expect(result.processStatus == 0)
  #expect(result.receipt.schemaVersion == "codevetter.local-check-preflight/v1")
  #expect(result.receipt.source.headSha == String(repeating: "b", count: 40))
  #expect(result.receipt.correctnessTarget?.adapter == "cargo-test")
  #expect(result.receipt.correctnessTarget?.target == "tests/output.rs")
  #expect(result.receipt.limitations == ["Fixture proves transport only."])
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "check --repo /fixture/repo --range main...HEAD --task Preserve output --agent claude --spec docs/output.md --requirement output-stable --preflight --json"
      .replacingOccurrences(
        of: "check ", with: "check --request-id \(requestID) ", options: .anchored)
  )
}

@Test
func supervisedRunnerPreservesTheSharedLocalCheckReceiptAndExitSemantics() async throws {
  let fixture = try sharedSurfaceParityFixture(named: "local-check-v1")
  let authority = try #require(fixture["authority"] as? [String: Any])
  let request = try #require(fixture["request"] as? [String: Any])
  let expected = try #require(fixture["expected"] as? [String: Any])
  let canonicalReceipt = try #require(fixture["canonical_receipt"] as? [String: Any])
  let receiptData = try JSONSerialization.data(
    withJSONObject: canonicalReceipt, options: [.sortedKeys])
  let receiptJSON = try #require(String(data: receiptData, encoding: .utf8))
  let requestID = try #require(request["request_id"] as? String)
  let repositoryPath = try #require(request["repo_path"] as? String)
  let change = try #require(request["change"] as? String)
  let task = try #require(request["task"] as? String)
  let expectedExitCode = Int32(try #require(expected["exit_code"] as? Int))

  #expect(authority["native"] as? String == "supervised_execution")
  #expect(authority["mcp"] as? String == "read_only_projection")
  #expect(authority["mcp_may_execute"] as? Bool == false)

  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-local-check-parity-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    printf '%s\n' '\(receiptJSON)'
    exit \(expectedExitCode)
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let result = try await CodeVetterProcessRunner(executableURL: executable).run(
    VerificationRequest(
      requestID: requestID,
      repositoryPath: repositoryPath,
      change: change,
      task: task
    ),
    preflight: false,
    onProgress: { _ in }
  )

  #expect(result.processStatus == expectedExitCode)
  #expect(result.receipt.schemaVersion == expected["receipt_schema"] as? String)
  #expect(result.receipt.requestID == requestID)
  #expect(result.receipt.runID == expected["run_id"] as? String)
  #expect(result.receipt.verdict == expected["verdict"] as? String)
  #expect(result.receipt.stages?.performance.status == expected["performance_status"] as? String)
  #expect(result.receipt.limitations.contains(try #require(expected["limitation"] as? String)))
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "check --request-id \(requestID) --repo \(repositoryPath) --range \(change) --task \(task) --agent claude --progress-json --json"
  )

  let mismatchedScript = script.replacingOccurrences(
    of: "exit \(expectedExitCode)", with: "exit 0")
  try mismatchedScript.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  do {
    _ = try await CodeVetterProcessRunner(executableURL: executable).run(
      VerificationRequest(
        requestID: requestID,
        repositoryPath: repositoryPath,
        change: change,
        task: task
      ),
      preflight: false,
      onProgress: { _ in }
    )
    Issue.record("Native must reject a receipt whose verdict conflicts with the CLI exit code")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("process status"))
  }
}

@Test
func supervisedRunnerProjectsTheSelectedCrossReviewStrategy() async throws {
  let directory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-cross-review-runner-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let executable = directory.appending(path: "codevetter")
  let argumentsFile = directory.appending(path: "arguments.txt")
  let receipt =
    #"{"schema_version":"codevetter.local-check-preflight/v1","request_id":"cross-request","ran_at":"2026-09-02T00:00:00Z","repo_path":"/fixture/repo","task":"Review independently","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","commits":[],"changed_paths":["src/a.rs"]},"correctness_target":{"adapter":"node-test","target":"test/a.test.mjs","name":null,"source":"fixture"},"performance_target":null,"status":"ready","limitations":[]}"#
  try "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\\n' '\(receipt)'\n"
    .write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  _ = try await CodeVetterProcessRunner(executableURL: executable).run(
    VerificationRequest(
      requestID: "cross-request",
      repositoryPath: "/fixture/repo",
      change: "main...HEAD",
      task: "Review independently",
      reviewAgent: "cross"
    ),
    preflight: true,
    onProgress: { _ in }
  )

  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "check --request-id cross-request --repo /fixture/repo --range main...HEAD --task Review independently --agent cross --preflight --json"
  )
}

@Test
func supervisedRunnerPreservesTheExactPublicSafeXrayRequest() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-xray-runner-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let result =
    ##"{"eligible":false,"missing_requirements":["Confirm that the source repository and change are public."],"sanitizer_issues":[],"payload":{"schema_version":1,"xray_id":"xray-fixture","outcome":"incomplete","findings":[],"stages":[]},"json":"{}","markdown":"# X-Ray","html":"<html></html>"}"##
  try
    "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\\n' '\(result)'\nexit 2\n"
    .write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let run = try await CodeVetterProcessRunner(executableURL: executable).runXray(
    XrayRequest(
      reviewID: "review-7",
      publicSourceConfirmed: true,
      publicSource: "owner/repo#7",
      approvedExcerptFindingIDs: ["finding-1"]
    ),
    format: .markdown
  )

  #expect(!run.result.eligible)
  #expect(run.result.xrayID == "xray-fixture")
  #expect(run.processStatus == 2)
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "xray --review-id review-7 --public-source owner/repo#7 --confirm-public --approve-excerpt finding-1 --format markdown --json"
  )
}

@Test
func supervisedRunnerPreservesTheExactSelectedFixPacketScope() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-fix-packet-runner-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let receipt =
    ##"{"schema_version":"codevetter.agent-fix-packet/v1","created_at":"2026-09-01T00:00:00Z","run_id":"local-check-7","repo_path":"/fixture/repo","source":{"input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"agent":"claude","task":{"goal":"Preserve checkout totals","acceptance_criteria":["Charge the discounted amount."],"non_goals":[],"source":"persisted_local_check_receipt"},"route_advice":"Use an isolated worktree.","findings":[{"id":"finding-1","severity":"high","title":"Stale total","summary":"Uses stale state.","suggestion":"Use discounted total.","file_path":"src/cart.ts","line":42,"confidence":0.94},{"id":"finding-2","severity":"low","title":"Copy","summary":"Label is unclear.","suggestion":null,"file_path":"src/cart.ts","line":9,"confidence":null}],"evidence":[{"kind":"correctness","status":"failed","label":"vitest · src/cart.test.ts","artifact":null,"qualification":"versioned local-check stage"}],"limitations":["This packet is not proof."],"markdown":"# Agent Fix Packet"}"##
  try "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\\n' '\(receipt)'\n"
    .write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let packet = try await CodeVetterProcessRunner(executableURL: executable).buildFixPacket(
    runID: "local-check-7",
    findingIDs: ["finding-2", "finding-1"]
  )

  #expect(packet.schemaVersion == "codevetter.agent-fix-packet/v1")
  #expect(packet.findings.count == 2)
  #expect(packet.task.acceptanceCriteria == ["Charge the discounted amount."])
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "fix-packet --run-id local-check-7 --finding finding-1 --finding finding-2 --json"
  )
}

@Test
func supervisedRunnerExecutesOneConfirmedIsolatedFixAndValidatesItsReceipt() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-fix-attempt-runner-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let receipt =
    ##"{"schema_version":"codevetter.fix-attempt/v1","attempt_id":"fix-attempt-abc123","operation":"execute","state":"verified_fixed","source_run_id":"local-check-7","repository_path":"/fixture/repo","source":{"input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"worktree":{"path":"/fixture/app-data/fix-attempts/fix-attempt-abc123/worktree","detached":true,"retained":true,"source_head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"agent":{"id":"codex","status":"completed","duration_ms":1200,"diagnostic":null},"change":{"changed_files":["src/cart.ts"],"diff_sha256":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","diff_bytes":420,"diff_preview":"diff --git a/src/cart.ts b/src/cart.ts","preview_truncated":false},"recheck":{"diff_check":{"status":"passed","detail":"git diff --check passed"},"correctness":{"status":"passed","target":"vitest · src/cart.test.ts","duration_ms":90,"evidence":{"verdict":"passed"},"limitations":[]},"review":{"status":"completed","review_id":"review-8","summary":"No finding reproduced.","findings":[],"limitation":null},"findings":[{"finding_id":"finding-1","status":"fixed","reason":"Executable target passed and re-review did not reproduce it."}]},"limitations":["Worktree retained; nothing was merged."],"started_at":"2026-09-01T00:00:00Z","completed_at":"2026-09-01T00:00:02Z"}"##
  try "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\n' '\(receipt)'\n"
    .write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let attempt = try await CodeVetterProcessRunner(executableURL: executable).executeFixAttempt(
    runID: "local-check-7",
    findingIDs: ["finding-1"],
    agent: "codex",
    timeoutMS: 45_000
  )

  #expect(attempt.state == "verified_fixed")
  #expect(attempt.worktree.retained)
  #expect(attempt.recheck.findings.first?.status == "fixed")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "fix --operation execute --run-id local-check-7 --agent codex --confirm-run --timeout-ms 45000 --finding finding-1 --json"
  )
}

@MainActor
@Test
func nativeReviewReceiptPromotesQualifiedFindingsAboveRawJSON() throws {
  let payload = Data(
    #"{"schema_version":"codevetter.local-check/v1","run_id":"local-check-review-fixture","ran_at":"2026-09-01T00:00:00Z","repo_path":"/fixture/repo","task":"Preserve checkout totals","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/cart.ts"]},"stages":{"review":{"status":"needs_attention","duration_ms":140,"target":null,"evidence":{"summary":"One source-qualified correctness issue remains.","findings":[{"severity":"high","title":"Checkout total uses the stale subtotal","summary":"The recorded line reads the pre-discount subtotal after the discount is applied.","suggestion":"Use the post-discount total.","filePath":"src/cart.ts","line":42,"confidence":0.94}]},"limitations":[]},"correctness":{"status":"passed","duration_ms":90,"target":{"adapter":"vitest","target":"src/cart.test.ts","name":null,"source":"discovered:fixture"},"evidence":{"verdict":{"status":"passed"}},"limitations":[]},"performance":{"status":"no_confidence","duration_ms":0,"target":null,"evidence":{},"limitations":["No dedicated workload matched."]},"optimization":{"status":"ready","duration_ms":0,"target":null,"evidence":{},"limitations":[]}},"spec_coverage":{"schema_version":"codevetter.spec-coverage/v1","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sources":[{"path":"docs/checkout.md","sha256":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","bytes":512}],"requirements":[{"id":"checkout-total-stable","title":"Discounted checkout total","text":"The charged total uses the post-discount amount.","source_path":"docs/checkout.md","start_line":8,"end_line":10,"selected_for_execution":true,"supplied_to_review":true,"status":"contradicted","evidence":{"stage":"correctness","status":"failed","adapter":"vitest","target":"src/cart.test.ts","source":"selected:checkout-total-stable"}},{"id":"checkout-receipt-readable","title":"Readable receipt","text":"The receipt explains each adjustment.","source_path":"docs/checkout.md","start_line":12,"end_line":14,"selected_for_execution":false,"supplied_to_review":true,"status":"review_only","evidence":null}],"summary":{"total_requirements":2,"review_input_requirements":2,"selected_for_execution":1,"verified":0,"contradicted":1,"review_only":1,"unverified":0,"review_input_coverage_percent":100,"executable_evidence_coverage_percent":50,"verified_coverage_percent":0},"limitations":["One requirement has review input but no executable binding."]},"verdict":"needs_attention","limitations":["No dedicated workload matched."]}"#
      .utf8
  )
  let receipt = try JSONDecoder().decode(VerificationReceipt.self, from: payload)
  let finding = try #require(receipt.reviewFindings.first)
  #expect(finding.severity == "high")
  #expect(finding.filePath == "src/cart.ts")
  #expect(finding.line == 42)
  #expect(receipt.reviewSummary == "One source-qualified correctness issue remains.")
  #expect(receipt.specCoverage?.summary.totalRequirements == 2)
  #expect(receipt.specCoverage?.summary.contradicted == 1)
  #expect(receipt.specCoverage?.requirements.first?.evidence?.target == "src/cart.test.ts")
  #expect(receipt.reviewStageEvidence?.value(at: "summary")?.stringValue != nil)

  let model = WorkbenchModel()
  model.section = .review
  model.repositoryPath = "/fixture/repo"
  model.receipt = receipt
  model.receiptJSON = String(decoding: payload, as: UTF8.self)
  model.verificationState = .limited
  renderReview(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_REVIEW_FINDINGS_SCREENSHOT_PATH"
  ] {
    try captureReview(model, at: URL(fileURLWithPath: screenshotPath))
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_REVIEW_FINDINGS_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureReview(
      model,
      at: URL(fileURLWithPath: screenshotPath),
      appearance: .aqua
    )
  }
}

@MainActor
@Test
func nativeCrossReviewReceiptShowsIndependentProvenanceAndDisagreement() throws {
  let payload = Data(
    #"{"schema_version":"codevetter.local-check/v1","run_id":"local-check-cross-review","ran_at":"2026-09-02T00:00:00Z","repo_path":"/fixture/repo","task":"Review authentication independently","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/auth.ts"]},"stages":{"review":{"status":"needs_attention","duration_ms":2120,"target":null,"evidence":{"review_id":"cross-review-1","agent":"cross","review_status":"completed","review_readiness":{"status":"ready","complete_coverage":true,"limitations":[]},"summary":"Independent Claude and Codex passes reconciled by source-qualified identity.","findings":[{"id":"finding-shared","severity":"critical","title":"Session validation can be bypassed","summary":"Both reviewers identified the same exact source boundary with different severity.","suggestion":"Reject the unverified session before dispatch.","filePath":"src/auth.ts","line":42,"sourceAnchor":"return dispatch(session);","confidence":0.96,"cross_review_class":"conflicting","reviewers":["claude","codex"]},{"id":"finding-codex","severity":"high","title":"Expired token remains accepted","summary":"Codex alone found the stale expiry comparison.","filePath":"src/auth.ts","line":57,"sourceAnchor":"if token.expiry < now","confidence":0.91,"cross_review_class":"codex_only","reviewers":["codex"]}],"cross_review":{"schema_version":"codevetter.cross-review/v1","strategy":"claude_then_codex_independent","status":"completed","target_identity":"target-1","passes":[{"reviewer":"claude","status":"completed","review_id":"claude-review","duration_ms":920,"findings_count":1},{"reviewer":"codex","status":"completed","review_id":"codex-review","duration_ms":1200,"findings_count":2}],"counts":{"corroborated":0,"claude_only":0,"codex_only":1,"conflicting":1},"findings":[],"unresolved":[],"limitations":[],"authority":"deterministic_source_qualified_union","proof_boundary":"Reviewer agreement is review coverage, never executable proof."}},"limitations":[]},"correctness":{"status":"passed","duration_ms":90,"target":null,"evidence":{},"limitations":[]},"performance":{"status":"no_confidence","duration_ms":0,"target":null,"evidence":{},"limitations":[]},"optimization":{"status":"ready","duration_ms":0,"target":null,"evidence":{},"limitations":[]}},"verdict":"needs_attention","limitations":["Performance evidence was not selected."]}"#
      .utf8
  )
  let receipt = try JSONDecoder().decode(VerificationReceipt.self, from: payload)
  #expect(receipt.reviewFindings.count == 2)
  #expect(receipt.reviewFindings.first?.reviewers == ["claude", "codex"])
  #expect(receipt.reviewFindings.first?.crossReviewClass == "conflicting")

  let model = WorkbenchModel()
  model.section = .review
  model.repositoryPath = "/fixture/repo"
  model.receipt = receipt
  model.receiptJSON = String(decoding: payload, as: UTF8.self)
  model.verificationState = .limited
  renderReview(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_CROSS_REVIEW_SCREENSHOT_PATH"
  ] {
    try captureReview(model, at: URL(fileURLWithPath: screenshotPath))
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_CROSS_REVIEW_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureReview(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func reviewHandsExactChangeToTestingWithoutCarryingExecutionConsent() throws {
  let receipt = try JSONDecoder().decode(
    VerificationReceipt.self,
    from: Data(
      #"{"schema_version":"codevetter.local-check/v1","run_id":"local-check-handoff","ran_at":"2026-09-01T00:00:00Z","repo_path":"/fixture/repo","task":"Preserve checkout totals","source":{"kind":"pull_request","input":"https://github.com/owner/repo/pull/42","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/cart.ts"]},"stages":{"review":{"status":"completed","duration_ms":12,"target":null,"evidence":{},"limitations":[]},"correctness":{"status":"passed","duration_ms":10,"target":null,"evidence":{},"limitations":[]},"performance":{"status":"no_confidence","duration_ms":0,"target":null,"evidence":{},"limitations":[]},"optimization":{"status":"ready","duration_ms":0,"target":null,"evidence":{},"limitations":[]}},"verdict":"passed_with_limits","limitations":[]}"#
        .utf8
    )
  )
  let model = WorkbenchModel()
  model.testingConfirmed = true
  model.testingPreviewURL = "https://preview.example.test"
  model.testingReceiptJSON = "stale receipt"

  model.prepareTestingFromReview(receipt)

  #expect(model.section == .testing)
  #expect(model.repositoryPath == "/fixture/repo")
  #expect(model.testingChangeKind == .pullRequest)
  #expect(model.testingChange == "https://github.com/owner/repo/pull/42")
  #expect(model.testingScopeKind == .change)
  #expect(model.testingScopeValue == model.testingChange)
  #expect(!model.testingConfirmed)
  #expect(model.testingReceiptJSON.isEmpty)
  #expect(model.testingPreviewURL == "https://preview.example.test")
}

@MainActor
@Test
func nativeReviewProofMapRendersCanonicalReadinessManifestAndExecutionEvidence() throws {
  let object: [String: Any] = [
    "review_readiness": [
      "status": "ready",
      "graph_status": "ready",
      "graph_built_for_review": true,
      "history_status": "ready",
      "history_chars": 3_820,
      "conventions_status": "ready",
      "runtime_evidence_count": 1,
      "coordinator_status": "completed",
      "complete_coverage": true,
      "codevetter_mcp_call_count": 2,
      "context_delivery": "mixed",
      "limitations": ["The review memory graph is bounded context, not ground truth."],
    ],
    "intent_diagnostic": [
      "schema_version": "codevetter.review-intent-diagnostic/v1",
      "intent": [
        "summary": "Apply a discount and preserve the charged total",
        "status": "captured",
        "source": "operator_task",
      ],
      "changed_surfaces": ["runtime", "tests", "user_interface"],
      "signals": [
        "changed_paths": 2,
        "findings": 1,
        "high_risk_findings": 1,
        "qa_runs": 1,
        "passed_qa_runs": 1,
        "failed_qa_runs": 0,
        "qa_artifacts": 2,
        "complete_review_coverage": true,
      ],
      "gaps": ["1 high-risk finding requires disposition and executable re-check."],
      "timeline": [
        [
          "id": "intent", "label": "Intent captured",
          "detail": "Apply a discount and preserve the charged total", "status": "done",
        ],
        [
          "id": "review", "label": "Source review",
          "detail": "1 finding across 2 changed paths; 1 high risk.", "status": "warning",
        ],
        [
          "id": "synthetic_qa", "label": "Synthetic QA",
          "detail": "1 passed, 0 failed, 2 retained artifact references.", "status": "done",
        ],
        [
          "id": "human_disposition", "label": "Intent disposition",
          "detail": "Requires an explicit human decision.", "status": "pending",
        ],
      ],
      "closure": [
        "status": "evidence_conflict",
        "reason": "A high-risk finding still conflicts with the stated intent.",
        "requires_human_disposition": true,
      ],
      "limitations": [
        "Intent closure is never inferred from review or test output.",
        "Legacy synthetic QA is recorded evidence and is not assumed revision-exact.",
      ],
    ],
    "review_manifest": [
      "schema_version": 1,
      "run_id": "review-run-fixture",
      "review_id": "review-fixture",
      "target": [
        "schema_version": 1,
        "identity": "target-fixture",
        "repository_root": "/fixture/repo",
        "diff_mode": "range",
        "requested_range": "main...HEAD",
        "head_sha": String(repeating: "b", count: 40),
        "base_sha": String(repeating: "a", count: 40),
        "source_fingerprint": "source-fixture",
      ],
      "executor_id": "claude",
      "executor_version": "fixture",
      "policy_fingerprint": "policy-fixture",
      "units": [
        [
          "id": "unit-cart",
          "file_path": "src/cart.ts",
          "file_status": "modified",
          "fingerprint": "unit-fixture",
          "diff_bytes": 2_048,
          "prompt_budget_bytes": 81_920,
          "coverage_state": "reviewed",
          "coverage_reason": NSNull(),
        ],
        [
          "id": "unit-test",
          "file_path": "src/cart.test.ts",
          "file_status": "modified",
          "fingerprint": "unit-test-fixture",
          "diff_bytes": 1_024,
          "prompt_budget_bytes": 81_920,
          "coverage_state": "reused",
          "coverage_reason": "fingerprint_match",
        ],
      ],
      "qualification_counts": [
        "qualified": 1, "stale": 0, "unresolved": 0, "rejected": 0,
      ],
      "complete_coverage": true,
      "stale": false,
      "cancelled": false,
      "created_at": "2026-09-01T00:00:00Z",
      "completed_at": "2026-09-01T00:00:03Z",
    ],
    "review_memory_graph": [
      "schema_version": 1,
      "scope": "review_changed_files",
      "nodes": [
        [
          "id": "file-src-cart-ts", "kind": "file", "label": "src/cart.ts",
          "file_path": "src/cart.ts", "detail": "changed file",
        ],
        [
          "id": "blast-radius", "kind": "blast_radius", "label": "Blast-radius summary",
          "file_path": NSNull(), "detail": "computed from repo relationships",
        ],
        [
          "id": "history-context", "kind": "history_context",
          "label": "Prior commits, decisions, agents, and command evidence",
          "file_path": NSNull(), "detail": "3820 chars in prompt section",
        ],
      ],
      "edges": [
        [
          "from": "file-src-cart-ts", "to": "blast-radius", "kind": "has_blast_radius",
          "confidence": 0.68,
        ]
      ],
      "trusted_paths": [],
      "truncated": false,
    ],
    "trusted_graph_context": [
      "schema_version": 1,
      "snapshot_id": "graph-fixture",
      "engine_id": "codevetter-structural-graph",
      "engine_version": "1",
      "indexed_head": String(repeating: "b", count: 40),
      "current_head": String(repeating: "b", count: 40),
      "stale": false,
      "coverage": [:],
      "nodes": [["id": "cart", "kind": "symbol", "label": "checkoutTotal"]],
      "edges": [["from": "cart", "to": "receipt", "kind": "calls"]],
      "truncated": false,
      "qualification": "revision_exact",
    ],
    "qa_evidence": [
      [
        "loop_id": "checkout-flow",
        "runner_type": "playwright",
        "goal": "Apply a discount and verify the charged total",
        "route": "/checkout",
        "pass": true,
        "duration_ms": 1_240,
        "artifacts": ["artifacts/checkout.png", "artifacts/checkout-trace.zip"],
        "console_errors": 0,
      ]
    ],
    "evidence_candidates": [
      [
        "id": "candidate-checkout-total",
        "kind": "behavioral_regression",
        "severity_hint": "high",
        "confidence": 0.91,
        "affected_files": ["src/cart.ts", "src/cart.test.ts"],
        "evidence_refs": [],
        "scale": "flow",
        "why_it_matters": "The charged amount crosses a payment boundary.",
        "caveats": ["Candidate context is not proof."],
        "open_questions": [],
        "suggested_checks": ["Run the exact checkout total scenario."],
      ]
    ],
    "evidence_procedure_steps": [
      [
        "id": "procedure-checkout",
        "procedure": "execute_exact_checkout_scenario",
        "status": "satisfied",
        "candidate_ids": ["candidate-checkout-total"],
        "input": "src/cart.test.ts",
        "action": "Run the exact checkout total test and preserve the receipt.",
        "output": "A versioned executable verdict.",
        "artifact": "artifacts/checkout-receipt.json",
        "gate": "The scenario must pass at the pinned revision.",
        "blocked_on": [],
      ]
    ],
  ]
  let payload = try JSONSerialization.data(withJSONObject: object)
  let evidence = try JSONDecoder().decode(PerformanceJSONValue.self, from: payload)
  #expect(evidence.value(at: "review_readiness", "status")?.stringValue == "ready")
  #expect(
    evidence.value(at: "intent_diagnostic", "closure", "status")?.stringValue
      == "evidence_conflict")
  #expect(evidence.value(at: "review_manifest", "units")?.arrayValue?.count == 2)
  #expect(evidence.value(at: "qa_evidence")?.arrayValue?.count == 1)
  renderReviewProof(evidence)
  renderReviewIntent(evidence)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_REVIEW_INTENT_SCREENSHOT_PATH"
  ] {
    try captureReviewIntent(evidence, at: URL(fileURLWithPath: screenshotPath))
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_REVIEW_PROOF_MAP_SCREENSHOT_PATH"
  ] {
    try captureReviewProof(evidence, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test
func nativeXrayExportShowsEligibilityStagesAndExplicitExcerptApproval() throws {
  let receiptPayload = Data(
    ##"{"schema_version":"codevetter.local-check/v1","run_id":"local-check-xray-fixture","ran_at":"2026-09-01T00:00:00Z","repo_path":"/fixture/repo","task":"Preserve checkout totals","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/cart.ts"]},"stages":{"review":{"status":"needs_attention","duration_ms":140,"target":null,"evidence":{"review_manifest":{"review_id":"review-7"},"findings":[{"id":"finding-1","severity":"high","title":"Checkout total uses the stale subtotal","summary":"The charged total uses stale state.","suggestion":"Use the post-discount total.","filePath":"src/cart.ts","line":42,"confidence":0.94}]},"limitations":[]},"correctness":{"status":"failed","duration_ms":90,"target":null,"evidence":{},"limitations":[]},"performance":{"status":"no_confidence","duration_ms":0,"target":null,"evidence":{},"limitations":[]},"optimization":{"status":"ready","duration_ms":0,"target":null,"evidence":{},"limitations":[]}},"verdict":"needs_attention","limitations":[]}"##
      .utf8
  )
  let resultPayload = Data(
    ##"{"eligible":true,"missing_requirements":[],"sanitizer_issues":[],"payload":{"schema_version":1,"xray_id":"xray-public-fixture","source":"owner/repo#7","outcome":"needs_review","confidence":"bounded","review_status":"completed","findings":[{"severity":"high","title":"Checkout total uses the stale subtotal","summary":"The charged total uses stale state.","locator":{"file_path":"src/cart.ts","line":42}}],"stages":[{"id":"review","label":"Source review","status":"passed","provenance":"persisted_local_review","recorded_at":"2026-09-01T00:00:00Z","evidence":["One qualified finding"],"caveats":[],"omission_reason":null},{"id":"performance","label":"Performance","status":"missing","provenance":"local_check","recorded_at":null,"evidence":[],"caveats":["No workload"],"omission_reason":"No dedicated workload matched."}]},"json":"{\"schema_version\":1}","markdown":"# Agent PR X-Ray","html":"<html><body>Agent PR X-Ray</body></html>"}"##
      .utf8
  )
  let receipt = try JSONDecoder().decode(VerificationReceipt.self, from: receiptPayload)
  let result = try JSONDecoder().decode(XrayBuildResult.self, from: resultPayload)
  #expect(receipt.reviewID == "review-7")
  #expect(receipt.reviewFindings.first?.persistedID == "finding-1")
  #expect(result.eligible)
  #expect(result.stages.count == 2)

  let model = WorkbenchModel()
  model.receipt = receipt
  model.xrayPublicSource = "owner/repo#7"
  model.xrayPublicConfirmed = true
  model.xrayApprovedExcerptFindingIDs = ["finding-1"]
  model.xrayResult = result
  renderXray(model, receipt: receipt)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_XRAY_SCREENSHOT_PATH"
  ] {
    try captureXray(model, receipt: receipt, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test
func nativeFixPacketShowsTaskFindingsAndEvidenceWithoutClaimingSuccess() throws {
  let receiptPayload = Data(
    ##"{"schema_version":"codevetter.local-check/v1","run_id":"local-check-7","ran_at":"2026-09-01T00:00:00Z","repo_path":"/fixture/repo","task":"Preserve checkout totals","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/cart.ts"]},"stages":{"review":{"status":"needs_attention","duration_ms":140,"target":null,"evidence":{"findings":[{"id":"finding-1","severity":"high","title":"Checkout total uses the stale subtotal","summary":"The charged total uses stale state.","suggestion":"Use the post-discount total.","filePath":"src/cart.ts","line":42,"confidence":0.94}]},"limitations":[]},"correctness":{"status":"failed","duration_ms":90,"target":null,"evidence":{},"limitations":[]},"performance":{"status":"no_confidence","duration_ms":0,"target":null,"evidence":{},"limitations":[]},"optimization":{"status":"ready","duration_ms":0,"target":null,"evidence":{},"limitations":[]}},"verdict":"needs_attention","limitations":[]}"##
      .utf8
  )
  let packetPayload = Data(
    ##"{"schema_version":"codevetter.agent-fix-packet/v1","created_at":"2026-09-01T00:00:00Z","run_id":"local-check-7","repo_path":"/fixture/repo","source":{"input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"agent":"claude","task":{"goal":"Preserve checkout totals","acceptance_criteria":["Discounted total: Charge the post-discount amount."],"non_goals":[],"source":"persisted_local_check_receipt"},"route_advice":"Use a full coding agent in an isolated worktree; require executable proof before merge.","findings":[{"id":"finding-1","severity":"high","title":"Checkout total uses the stale subtotal","summary":"The charged total uses stale state.","suggestion":"Use the post-discount total.","file_path":"src/cart.ts","line":42,"confidence":0.94}],"evidence":[{"kind":"correctness","status":"failed","label":"vitest · src/cart.test.ts","artifact":null,"qualification":"versioned local-check stage"},{"kind":"synthetic_qa","status":"passed","label":"Verify checkout","artifact":"artifacts/checkout.png","qualification":"recorded runtime evidence"}],"limitations":["This packet is a deterministic handoff, not proof that a proposed fix is correct."],"markdown":"# Agent Fix Packet\n\nGoal: Preserve checkout totals"}"##
      .utf8
  )
  let attemptPayload = Data(
    ##"{"schema_version":"codevetter.fix-attempt/v1","attempt_id":"fix-attempt-abc123","operation":"execute","state":"verified_fixed","source_run_id":"local-check-7","repository_path":"/fixture/repo","source":{"input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"worktree":{"path":"/fixture/app-data/fix-attempts/fix-attempt-abc123/worktree","detached":true,"retained":true,"source_head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"agent":{"id":"codex","status":"completed","duration_ms":1200,"diagnostic":null},"change":{"changed_files":["src/cart.ts"],"diff_sha256":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","diff_bytes":420,"diff_preview":"diff --git a/src/cart.ts b/src/cart.ts\n- stale\n+ current","preview_truncated":false},"recheck":{"diff_check":{"status":"passed","detail":"git diff --check passed"},"correctness":{"status":"passed","target":"vitest · src/cart.test.ts","duration_ms":90,"evidence":{"verdict":"passed"},"limitations":[]},"review":{"status":"completed","review_id":"review-8","summary":"No finding reproduced.","findings":[],"limitation":null},"findings":[{"finding_id":"finding-1","status":"fixed","reason":"Executable target passed and re-review did not reproduce it."}]},"limitations":["The isolated worktree is retained for inspection; nothing was committed or merged."],"started_at":"2026-09-01T00:00:00Z","completed_at":"2026-09-01T00:00:02Z"}"##
      .utf8
  )
  let receipt = try JSONDecoder().decode(VerificationReceipt.self, from: receiptPayload)
  let packet = try JSONDecoder().decode(AgentFixPacketReceipt.self, from: packetPayload)
  let attempt = try JSONDecoder().decode(FixAttemptReceipt.self, from: attemptPayload)
  #expect(packet.findings.first?.id == "finding-1")
  #expect(packet.evidence.count == 2)
  #expect(packet.limitations.first?.contains("not proof") == true)

  let model = WorkbenchModel()
  model.receipt = receipt
  model.fixPacketSelectedFindingIDs = ["finding-1"]
  model.fixPacketReceipt = packet
  #expect(!model.canExecuteFixAttempt)
  model.fixAttemptConfirmed = true
  #expect(model.canExecuteFixAttempt)
  model.fixAttemptConfirmed = false
  model.fixAttemptReceipt = attempt
  model.fixAttemptDiscardConfirmed = true
  #expect(model.canDiscardFixAttempt)
  renderFixPacket(model, receipt: receipt)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_FIX_PACKET_SCREENSHOT_PATH"
  ] {
    try captureFixPacket(model, receipt: receipt, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test
func nativeReviewPlansContainedSpecsAndRequiresAnExactRequirementBinding() throws {
  let receipt = try JSONDecoder().decode(
    VerificationReceipt.self,
    from: Data(
      #"{"schema_version":"codevetter.local-check-preflight/v1","ran_at":"2026-09-01T00:00:00Z","repo_path":"/fixture/repo","task":"Preserve checkout totals","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/cart.ts"]},"spec_coverage":{"schema_version":"codevetter.spec-coverage/v1","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sources":[{"path":"docs/checkout.md","sha256":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","bytes":512}],"requirements":[{"id":"checkout-total-stable","title":"Discounted checkout total","text":"The charged total uses the post-discount amount.","source_path":"docs/checkout.md","start_line":8,"end_line":10,"selected_for_execution":false,"supplied_to_review":false,"status":"unverified","evidence":null},{"id":"checkout-receipt-readable","title":"Readable receipt","text":"The receipt explains each adjustment.","source_path":"docs/checkout.md","start_line":12,"end_line":14,"selected_for_execution":false,"supplied_to_review":false,"status":"unverified","evidence":null}],"summary":{"total_requirements":2,"review_input_requirements":0,"selected_for_execution":0,"verified":0,"contradicted":0,"review_only":0,"unverified":2,"review_input_coverage_percent":0,"executable_evidence_coverage_percent":0,"verified_coverage_percent":0},"limitations":["Select at least one explicit requirement for execution."]},"correctness_target":{"adapter":"vitest","target":"src/cart.test.ts","name":null,"source":"discovered:fixture"},"performance_target":null,"status":"no_confidence","limitations":["No extracted requirement is bound to correctness."]}"#
        .utf8
    )
  )
  let model = WorkbenchModel()
  model.section = .review
  model.repositoryPath = "/fixture/repo"
  model.change = "main...HEAD"
  model.task = "Preserve checkout totals"
  model.specPaths = ["docs/checkout.md"]
  model.preflightReceipt = receipt
  model.verificationState = .limited
  #expect(receipt.specCoverage?.requirements.count == 2)
  #expect(!model.hasExecutableReviewPlan)
  #expect(!model.canExecuteReview)
  model.toggleRequirement("checkout-total-stable")
  #expect(model.selectedRequirementIDs == Set(["checkout-total-stable"]))
  #expect(!model.reviewPlanIsCurrent)
  #expect(!model.canExecuteReview)
  renderReview(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_REVIEW_SPEC_SETUP_SCREENSHOT_PATH"
  ] {
    try captureReview(model, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test
func nativeReviewRejectsSpecFilesOutsideTheSelectedRepository() throws {
  let root = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-spec-root-\(UUID().uuidString)")
  let outsideRoot = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-spec-outside-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  try FileManager.default.createDirectory(at: outsideRoot, withIntermediateDirectories: true)
  defer {
    try? FileManager.default.removeItem(at: root)
    try? FileManager.default.removeItem(at: outsideRoot)
  }
  let inside = root.appending(path: "acceptance.md")
  let outside = outsideRoot.appending(path: "private.md")
  try "### Requirement: Stable output\n".write(to: inside, atomically: true, encoding: .utf8)
  try "outside\n".write(to: outside, atomically: true, encoding: .utf8)

  let model = WorkbenchModel()
  model.selectRepository(root)
  model.selectSpecFiles([inside])
  #expect(model.specPaths == ["acceptance.md"])
  #expect(model.specIssue == nil)
  model.selectSpecFiles([outside])
  #expect(model.specPaths == ["acceptance.md"])
  #expect(model.specIssue?.contains("contained Markdown") == true)
}

@MainActor
@Test
func nativeRepositorySelectionPersistsAndRestoresTheFolderGrant() throws {
  let root = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-repository-bookmark-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }

  let suiteName = "com.codevetter.tests.repository-bookmark.\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defaults.removePersistentDomain(forName: suiteName)
  defer { defaults.removePersistentDomain(forName: suiteName) }

  let firstModel = WorkbenchModel(
    repositoryAccessStore: RepositoryAccessStore(defaults: defaults))
  #expect(firstModel.repositoryPath.isEmpty)
  firstModel.selectRepository(root)
  #expect(firstModel.repositoryPath == root.resolvingSymlinksInPath().standardizedFileURL.path)

  let restoredModel = WorkbenchModel(
    repositoryAccessStore: RepositoryAccessStore(defaults: defaults))
  #expect(restoredModel.repositoryPath == firstModel.repositoryPath)
  #expect(restoredModel.statusMessage.contains("Restored the last repository"))
}

@MainActor
@Test
func nativeRepositoryRestoreFailsClosedWhenTheFolderMoved() throws {
  let root = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-missing-bookmark-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

  let suiteName = "com.codevetter.tests.missing-bookmark.\(UUID().uuidString)"
  let defaults = try #require(UserDefaults(suiteName: suiteName))
  defaults.removePersistentDomain(forName: suiteName)
  defer { defaults.removePersistentDomain(forName: suiteName) }

  let store = RepositoryAccessStore(defaults: defaults)
  #expect(store.remember(root) != nil)
  try FileManager.default.removeItem(at: root)

  let restoredModel = WorkbenchModel(
    repositoryAccessStore: RepositoryAccessStore(defaults: defaults))
  #expect(restoredModel.repositoryPath.isEmpty)
}

@Test
func supervisedRunnerStreamsStructuredProgressAndCancelsWithoutAReceipt() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-progress-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let requestID = "native-progress-fixture"
  let receipt =
    #"{"schema_version":"codevetter.local-check/v1","request_id":"native-progress-fixture","ran_at":"2026-08-31T00:00:00Z","repo_path":"/fixture/repo","task":"Prove output","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/main.rs"]},"verdict":"passed_with_limits","limitations":[]}"#
  let progress =
    #"{"schema_version":"codevetter.progress/v2","request_id":"native-progress-fixture","sequence":0,"stage":"correctness","state":"running"}"#
  let foreignProgress =
    #"{"schema_version":"codevetter.progress/v2","request_id":"another-request","sequence":0,"stage":"review","state":"running"}"#
  let script = """
    #!/bin/sh
    case " $* " in
      *" --progress-json "*) ;;
      *) exit 9 ;;
    esac
    printf '%s\\n' '\(foreignProgress)' >&2
    printf '%s\\n' '\(progress)' >&2
    printf '%s\\n' '\(receipt)'
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  for _ in 0..<20 {
    let observed = LockedProgress()
    let result = try await CodeVetterProcessRunner(executableURL: executable).run(
      VerificationRequest(
        requestID: requestID,
        repositoryPath: "/fixture/repo",
        change: "main...HEAD",
        task: "Prove output"
      ),
      preflight: false,
      onProgress: { observed.append($0) }
    )
    #expect(result.processStatus == 0)
    #expect(
      observed.values == [
        VerificationProgress(
          schemaVersion: "codevetter.progress/v2",
          requestID: requestID,
          sequence: 0,
          stage: "correctness",
          state: "running"
        )
      ])
  }

  let sleeper = fixtureDirectory.appending(path: "codevetter-sleeper")
  try "#!/bin/sh\nexec sleep 30\n".write(to: sleeper, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: sleeper.path)
  let runner = CodeVetterProcessRunner(executableURL: sleeper)
  let cancellationRequestID = "native-cancellation-fixture"
  let task = Task {
    try await runner.run(
      VerificationRequest(
        requestID: cancellationRequestID,
        repositoryPath: "/fixture/repo",
        change: "main...HEAD",
        task: "Cancel me"
      ),
      preflight: false,
      onProgress: { _ in }
    )
  }
  try await Task.sleep(for: .milliseconds(100))
  #expect(!runner.cancel(requestID: "foreign-request"))
  #expect(runner.cancel(requestID: cancellationRequestID))
  do {
    _ = try await task.value
    Issue.record("Cancellation must not produce a successful receipt")
  } catch is CancellationError {
    // Expected: cancellation is a terminal state without a receipt.
  }
}

@Test
func supervisedRunnerRejectsAReceiptFromAnotherRequest() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-request-mismatch-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let receipt =
    #"{"schema_version":"codevetter.local-check/v1","request_id":"foreign-request","ran_at":"2026-09-01T00:00:00Z","repo_path":"/fixture/repo","task":"Reject foreign receipt","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":[]},"verdict":"passed_with_limits","limitations":[]}"#
  try "#!/bin/sh\nprintf '%s\\n' '\(receipt)'\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  do {
    _ = try await CodeVetterProcessRunner(executableURL: executable).run(
      VerificationRequest(
        requestID: "native-request",
        repositoryPath: "/fixture/repo",
        change: "main...HEAD",
        task: "Reject foreign receipt"
      ),
      preflight: false,
      onProgress: { _ in }
    )
    Issue.record("A receipt from another request must not be accepted")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("Request identity"))
  }
}

@Test
func supervisedWorkerMeetsProgressCancellationAndCrashRecoveryGates() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-runtime-gates-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let requestID = "native-runtime-fixture"
  let receipt =
    #"{"schema_version":"codevetter.local-check/v1","request_id":"native-runtime-fixture","ran_at":"2026-09-01T00:00:00Z","repo_path":"/fixture/repo","task":"Runtime gate","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","changed_paths":["src/main.rs"]},"verdict":"passed_with_limits","limitations":["Fixture runtime only."]}"#
  let progress =
    #"{"schema_version":"codevetter.progress/v2","request_id":"native-runtime-fixture","sequence":0,"stage":"correctness","state":"running"}"#
  let request = VerificationRequest(
    requestID: requestID,
    repositoryPath: "/fixture/repo",
    change: "main...HEAD",
    task: "Runtime gate"
  )

  let progressExecutable = fixtureDirectory.appending(path: "codevetter-progress")
  let progressScript = """
    #!/bin/sh
    index=0
    while [ "$index" -lt 1000 ]; do
      printf '%s\\n' '\(progress)' >&2
      index=$((index + 1))
    done
    printf '%s\\n' '\(receipt)'
    """
  try progressScript.write(to: progressExecutable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes(
    [.posixPermissions: 0o755], ofItemAtPath: progressExecutable.path)
  let observed = LockedProgress()
  let progressStarted = DispatchTime.now().uptimeNanoseconds
  _ = try await CodeVetterProcessRunner(executableURL: progressExecutable).run(
    request,
    preflight: false,
    onProgress: { observed.append($0) }
  )
  let progressMilliseconds =
    Double(DispatchTime.now().uptimeNanoseconds - progressStarted) / 1_000_000
  #expect(observed.values.count == 1000)
  #expect(progressMilliseconds < 2_000, "1,000 progress events must arrive within 2 seconds")

  let sleeper = fixtureDirectory.appending(path: "codevetter-sleeper")
  try "#!/bin/sh\nexec sleep 30\n".write(to: sleeper, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: sleeper.path)
  let cancellationRunner = CodeVetterProcessRunner(executableURL: sleeper)
  let cancellationTask = Task {
    try await cancellationRunner.run(request, preflight: false, onProgress: { _ in })
  }
  try await Task.sleep(for: .milliseconds(100))
  let cancellationStarted = DispatchTime.now().uptimeNanoseconds
  cancellationTask.cancel()
  do {
    _ = try await cancellationTask.value
    Issue.record("Cancellation must not produce a receipt")
  } catch is CancellationError {
    // Expected.
  }
  let cancellationMilliseconds =
    Double(DispatchTime.now().uptimeNanoseconds - cancellationStarted) / 1_000_000
  #expect(cancellationMilliseconds < 500, "Cancellation must settle within 500 ms")

  let crashMarker = fixtureDirectory.appending(path: "crashed-once")
  let crashExecutable = fixtureDirectory.appending(path: "codevetter-crash-recovery")
  let crashScript = """
    #!/bin/sh
    if [ ! -f '\(crashMarker.path)' ]; then
      : > '\(crashMarker.path)'
      kill -KILL $$
    fi
    printf '%s\\n' '\(receipt)'
    """
  try crashScript.write(to: crashExecutable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes(
    [.posixPermissions: 0o755], ofItemAtPath: crashExecutable.path)
  let recoveryRunner = CodeVetterProcessRunner(executableURL: crashExecutable)
  do {
    _ = try await recoveryRunner.run(request, preflight: false, onProgress: { _ in })
    Issue.record("A crashed worker must not produce a successful receipt")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("returned no receipt"))
  }
  let recoveryStarted = DispatchTime.now().uptimeNanoseconds
  let recovered = try await recoveryRunner.run(request, preflight: false, onProgress: { _ in })
  let recoveryMilliseconds =
    Double(DispatchTime.now().uptimeNanoseconds - recoveryStarted) / 1_000_000
  #expect(recovered.receipt.verdict == "passed_with_limits")
  #expect(recoveryMilliseconds < 1_000, "A fresh worker must recover within 1 second")

  print(
    String(
      format:
        "native_runtime_gates progress_events=1000 progress_ms=%.3f cancellation_ms=%.3f recovery_ms=%.3f",
      progressMilliseconds,
      cancellationMilliseconds,
      recoveryMilliseconds
    ))
}

@Test
func supervisedTrexRunnerPreservesRangeAndPullRequestContracts() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-trex-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let rangeReceipt =
    #"{"schema_version":1,"run_id":"trex-range","repo_path":"/fixture/repo","source":{"kind":"range","input":"main...HEAD","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","commits":["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"changed_paths":["src/app.tsx"]},"preview":{"status":"claimed","requested_url":"https://preview.example.test","final_url":"https://preview.example.test/","revision":null,"evidence":"No supported revision header."},"routes":[{"route":"/","reason":"Required root smoke"}],"journeys":[],"verdict":"no_confidence","summary":"No browser evidence was produced.","limitations":["Browser adapter unavailable."],"duration_ms":42,"ran_at":"2026-08-31T00:00:00Z"}"#
  let pullRequestReceipt =
    #"{"schema_version":1,"run_id":"trex-pr","repo_path":"/fixture/repo","source":{"kind":"pull_request","input":"https://github.com/acme/widget/pull/42","base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","head_sha":"cccccccccccccccccccccccccccccccccccccccc","commits":["cccccccccccccccccccccccccccccccccccccccc"],"changed_paths":["src/app.tsx"]},"preview":{"status":"verified","requested_url":"https://preview.example.test","final_url":"https://preview.example.test/","revision":"cccccccccccccccccccccccccccccccccccccccc","evidence":"Revision header matched."},"routes":[{"route":"/","reason":"Required root smoke"}],"journeys":[{"loop_id":"root","route":"/","goal":"smoke","pass":true,"notes":"Rendered","screenshot_path":null,"artifacts":[],"duration_ms":12,"trace":{"final_url":"https://preview.example.test/","page_title":"Widget","console_errors":[],"stage_timings_ms":{"load":4.5},"runner_rss_bytes":2048},"error":null,"runner_type":"chromiumoxide_builtin"}],"verdict":"passed_with_limits","summary":"One route passed with bounded evidence.","limitations":["Fixture limitation."],"duration_ms":55,"ran_at":"2026-08-31T00:00:01Z"}"#
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    case " $* " in
      *" --pr "*)
        printf '%s\n' '\(pullRequestReceipt)'
        exit 0
        ;;
      *)
        printf '%s\n' '\(rangeReceipt)'
        exit 2
        ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let runner = CodeVetterProcessRunner(executableURL: executable)

  let range = try await runner.runTrex(
    TrexPreviewRequest(
      repositoryPath: "/fixture/repo",
      changeKind: .range,
      change: "main...HEAD",
      previewURL: "https://preview.example.test"
    ))
  let rangeArguments = try String(contentsOf: argumentsFile, encoding: .utf8)
  #expect(range.processStatus == 2)
  #expect(range.receipt.verdict == .noConfidence)
  #expect(range.receipt.source.changedPaths == ["src/app.tsx"])
  #expect(
    rangeArguments
      == "trex --repo /fixture/repo --range main...HEAD --preview https://preview.example.test --json"
  )

  let pullRequest = try await runner.runTrex(
    TrexPreviewRequest(
      repositoryPath: "/fixture/repo",
      changeKind: .pullRequest,
      change: "https://github.com/acme/widget/pull/42",
      previewURL: "https://preview.example.test"
    ))
  let pullRequestArguments = try String(contentsOf: argumentsFile, encoding: .utf8)
  #expect(pullRequest.processStatus == 0)
  #expect(pullRequest.receipt.source.kind == .pullRequest)
  #expect(pullRequest.receipt.preview.status == .verified)
  #expect(pullRequest.receipt.journeys.first?.trace.stageTimingsMS["load"] == 4.5)
  #expect(
    pullRequestArguments
      == "trex --repo /fixture/repo --pr https://github.com/acme/widget/pull/42 --preview https://preview.example.test --json"
  )
}

@Test
func supervisedTrexRunnerCancelsWithoutAcceptingAReceipt() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-trex-cancel-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  try "#!/bin/sh\nexec sleep 30\n".write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let runner = CodeVetterProcessRunner(executableURL: executable)
  let task = Task {
    try await runner.runTrex(
      TrexPreviewRequest(
        repositoryPath: "/fixture/repo",
        changeKind: .range,
        change: "main...HEAD",
        previewURL: "https://preview.example.test"
      ))
  }
  try await Task.sleep(for: .milliseconds(100))
  task.cancel()
  do {
    _ = try await task.value
    Issue.record("Cancellation must not produce a successful T-Rex receipt")
  } catch is CancellationError {
    // Expected: cancellation is terminal and no receipt is accepted.
  }
}

@Test
func supervisedWarmRunnerPreservesTheOwnedChangedProofContract() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-warm-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let receipt = warmVerificationFixture()
  try "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\\n' '\(receipt)'\n"
    .write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let result = try await CodeVetterProcessRunner(executableURL: executable).runWarmChanged(
    repositoryPath: "/fixture/repo",
    runID: "native-warm-fixture",
    detailed: true
  )

  #expect(result.processStatus == 0)
  #expect(result.receipt.result.outcome == .passed)
  #expect(result.receipt.result.selection.selectedScenarioIDs == ["checkout-smoke"])
  #expect(result.receipt.result.modelCallCount == 0)
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "warm --operation run --repo /fixture/repo --run-id native-warm-fixture --detailed --json"
  )
}

@MainActor
@Test
func nativeWarmReceiptRendersScenarioObservationArtifactAndLimitations() throws {
  let payload = Data(warmVerificationFixture().utf8)
  let receipt = try JSONDecoder().decode(WarmVerificationRunReceipt.self, from: payload)
  let model = WorkbenchModel()
  model.repositoryPath = "/fixture/repo"
  model.warmReceipt = receipt
  model.warmReceiptJSON = String(decoding: payload, as: UTF8.self)
  model.warmState = .limited
  model.warmStatusMessage = "Warm verification passed 1/1 selected scenarios."
  renderWarmVerification(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_WARM_SCREENSHOT_PATH"
  ] {
    try captureWarmVerification(model, at: URL(fileURLWithPath: screenshotPath))
  }
}

@Test
func supervisedDifferentialRunnerPreservesPreparationAndExactPair() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-differential-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }
  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let prepared = differentialPreparedFixture()
  let stored = differentialStoredFixture()
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    case " $* " in
      *" --operation prepare "*) printf '%s\n' '\(prepared)' ;;
      *) printf '%s\n' '\(stored)'; exit 1 ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let runner = CodeVetterProcessRunner(executableURL: executable)
  let request = DifferentialRequest(
    repositoryPath: "/fixture/repo", runID: "native-diff-fixture",
    reference: "main", candidateKind: .range, candidateRevision: "main...HEAD")

  let preparation = try await runner.prepareDifferential(request)
  #expect(preparation.status == "ready")
  #expect(preparation.modelCallCount == 0)
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "differential --operation prepare --repo /fixture/repo --run-id native-diff-fixture --reference main --candidate range --revision main...HEAD --json"
  )
  let run = try await runner.runDifferential(request)
  #expect(run.summary.classification == "regressed")
  #expect(!run.summary.createsPassEvidence)
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "differential --operation run --repo /fixture/repo --run-id native-diff-fixture --reference main --candidate range --revision main...HEAD --json"
  )
}

@MainActor
@Test
func nativeDifferentialReceiptRendersBlockingDeltaAndNoPassBoundary() throws {
  let payload = Data(differentialStoredFixture().utf8)
  let receipt = try JSONDecoder().decode(StoredDifferentialRun.self, from: payload)
  let model = WorkbenchModel()
  model.repositoryPath = "/fixture/repo"
  model.differentialReceipt = receipt
  model.differentialReceiptJSON = String(decoding: payload, as: UTF8.self)
  model.differentialState = .failed
  model.differentialStatusMessage = "Differential comparison: regressed · 1 deltas."
  renderDifferential(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_DIFFERENTIAL_SCREENSHOT_PATH"
  ] {
    try captureDifferential(model, at: URL(fileURLWithPath: screenshotPath))
  }
}

@Test
func supervisedScenarioRunnerPreservesHashBoundSelectedFileAcceptance() async throws {
  let directory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-scenario-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let executable = directory.appending(path: "codevetter")
  let argumentsFile = directory.appending(path: "arguments.txt")
  let receipt = scenarioCompilerFixture(action: "accept")
  try "#!/bin/sh\nprintf '%s' \"$*\" > '\(argumentsFile.path)'\nprintf '%s\\n' '\(receipt)'\n"
    .write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let hash = String(repeating: "a", count: 64)
  let result = try await CodeVetterProcessRunner(executableURL: executable).runScenarioCompiler(
    repositoryPath: "/fixture/repo",
    action: .accept(
      candidateID: "candidate-fixture", hash: hash,
      destinations: [
        ".codevetter/scenarios/checkout.yaml", ".codevetter/provenance/checkout.json",
      ],
      approveReplacements: true)
  )
  #expect(result.action == "accept")
  #expect(result.candidate?.dryRun.evidencePersisted == false)
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "scenario --operation accept --candidate-id candidate-fixture --candidate-hash \(hash) --destination .codevetter/provenance/checkout.json --destination .codevetter/scenarios/checkout.yaml --approve-replacements --repo /fixture/repo --json"
  )
}

@MainActor
@Test
func nativeScenarioFoundryRendersQualifiedDryRunAndPerFileAcceptance() throws {
  let payload = Data(scenarioCompilerFixture(action: "inspect").utf8)
  let receipt = try JSONDecoder().decode(ScenarioCompilerReceipt.self, from: payload)
  let candidate = try #require(receipt.candidate)
  let model = WorkbenchModel()
  model.repositoryPath = "/fixture/repo"
  model.scenarioSpecPath = "docs/checkout.md"
  model.scenarioSpecSection = "Checkout"
  model.scenarioRoutes = "/checkout, /receipt"
  model.scenarioCandidates = [candidate]
  model.selectedScenarioCandidateID = candidate.candidateID
  model.selectedScenarioDestinations = [candidate.files[0].destination]
  model.scenarioReplacementApproved = true
  model.scenarioState = .completed
  model.scenarioStatusMessage = "Candidate validated and dry-run passed."
  renderScenarioCompiler(model)
  if let path = ProcessInfo.processInfo.environment["CODEVETTER_SCENARIO_SCREENSHOT_PATH"] {
    try captureScenarioCompiler(model, at: URL(fileURLWithPath: path))
  }
}

@Test
func supervisedWatcherRunnerRequiresConfirmedForegroundPolling() async throws {
  let directory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-watcher-(UUID().uuidString)")
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let executable = directory.appending(path: "codevetter")
  let argumentsFile = directory.appending(path: "arguments.txt")
  let pollReceipt = trexWatcherFixture(operation: "poll")
  let retryReceipt = trexWatcherFixture(operation: "retry")
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    case " $* " in
      *" --operation poll "*) printf '%s\n' '\(pollReceipt)' ;;
      *" --operation retry "*) printf '%s\n' '\(retryReceipt)' ;;
      *) exit 9 ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let result = try await CodeVetterProcessRunner(executableURL: executable).runTrexWatcher(
    repositoryPath: "/fixture/repo",
    action: .poll
  )
  #expect(result.operation == "poll")
  #expect(result.runs.first?.prNumber == 42)
  #expect(result.runs.first?.statusState == "success")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "watcher --operation poll --repo /fixture/repo --confirm-run --json"
  )

  let retry = try await CodeVetterProcessRunner(executableURL: executable).runTrexWatcher(
    repositoryPath: "/fixture/repo",
    action: .retry(prNumber: 42)
  )
  #expect(retry.operation == "retry")
  #expect(retry.runs.first?.prNumber == 42)
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "watcher --operation retry --repo /fixture/repo --pr-number 42 --confirm-run --json"
  )
}

@MainActor
@Test
func nativeWatcherRendersScheduleAuthorityAndHeadSHAReceipts() throws {
  let payload = Data(trexWatcherFixture(operation: "poll").utf8)
  let receipt = try JSONDecoder().decode(TrexWatcherReceipt.self, from: payload)
  let watcher = try #require(receipt.watcher)
  let model = WorkbenchModel()
  model.repositoryPath = "/fixture/repo"
  model.trexWatchers = [watcher]
  model.trexWatcherRuns = receipt.runs
  model.trexWatcherIntervalSeconds = Int(watcher.intervalSeconds)
  model.trexWatcherBaseBranch = watcher.baseBranch ?? ""
  model.trexWatcherSessionConfirmed = true
  model.trexWatcherState = .completed
  model.trexWatcherStatusMessage = receipt.message
  model.trexWatcherReceiptJSON = String(decoding: payload, as: UTF8.self)
  renderTrexWatcher(model)
  if let path = ProcessInfo.processInfo.environment["CODEVETTER_WATCHER_SCREENSHOT_PATH"] {
    try captureTrexWatcher(model, at: URL(fileURLWithPath: path))
  }
}

@Test
func supervisedPerformanceRunnerPreservesTheClosedCLIContract() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-performance-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let planReceipt = performanceFixtureReceipt(
    requestID: "perf-plan",
    operation: "plan",
    result:
      #"{"schema_version":"performance-execution-plan/v1","decision":{"status":"admitted","reason":"Admitted.","blockers":[]},"limitations":[]}"#
  )
  let diagnosisReceipt = performanceFixtureReceipt(
    requestID: "perf-diagnose",
    operation: "diagnose",
    result:
      #"{"schema_version":"runtime-performance-diagnosis/v1","diagnosis":{"summary":"Observed hotspot."},"observed":[],"inferred":[],"unverified":[],"verdict":{"status":"diagnosed"},"limitations":[]}"#
  )
  let pairedReceipt = performanceFixtureReceipt(
    requestID: "perf-paired",
    operation: "verify_paired",
    result:
      #"{"schema_version":"paired-performance-verification/v1","diagnosis":{"summary":"Candidate improved."},"observed":[],"verdict":{"status":"confirmed"},"limitations":[]}"#
  )
  let inspectReceipt = performanceFixtureReceipt(
    requestID: "perf-inspect",
    operation: "inspect",
    result: #"{"schema_version":"performance-run-inspection/v1","verdict":{"status":"recorded"}}"#
  )
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    case " $* " in
      *" --operation plan "*) printf '%s\n' '\(planReceipt)' ;;
      *" --operation diagnose "*) printf '%s\n' '\(diagnosisReceipt)' ;;
      *" --operation verify-paired "*) printf '%s\n' '\(pairedReceipt)' ;;
      *" --operation inspect "*) printf '%s\n' '\(inspectReceipt)' ;;
      *) exit 9 ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let runner = CodeVetterProcessRunner(executableURL: executable)

  let plan = try await runner.runPerformance(
    PerformanceRunRequest(
      requestID: "perf-plan",
      operation: .plan,
      repositoryPath: "/fixture/repo",
      adapter: .vitest,
      target: "src/cart.test.ts",
      name: "updates totals",
      samples: 3,
      warmups: 1,
      timeoutMS: 30_000
    ))
  #expect(plan.receipt.admitted)
  #expect(plan.receipt.outcome == "admitted")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "performance --operation plan --repo /fixture/repo --request-id perf-plan --adapter vitest --target src/cart.test.ts --name updates totals --samples 3 --warmups 1 --timeout-ms 30000 --json"
  )

  let diagnosis = try await runner.runPerformance(
    PerformanceRunRequest(
      requestID: "perf-diagnose",
      operation: .diagnose,
      repositoryPath: "/fixture/repo",
      adapter: .nodeTest,
      target: "test/performance.test.mjs",
      samples: 4,
      warmups: 0,
      timeoutMS: 5_000
    ))
  #expect(diagnosis.receipt.summary == "Observed hotspot.")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "performance --operation diagnose --repo /fixture/repo --request-id perf-diagnose --adapter node-test --target test/performance.test.mjs --samples 4 --warmups 0 --timeout-ms 5000 --json"
  )

  _ = try await runner.runPerformance(
    PerformanceRunRequest(
      requestID: "perf-paired",
      operation: .verifyPaired,
      repositoryPath: "/fixture/candidate",
      adapter: .goBench,
      target: "internal/bench_test.go",
      name: "BenchmarkRender",
      samples: 5,
      warmups: 2,
      timeoutMS: 12_000,
      baselineRepositoryPath: "/fixture/baseline"
    ))
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "performance --operation verify-paired --repo /fixture/candidate --request-id perf-paired --adapter go-bench --target internal/bench_test.go --name BenchmarkRender --samples 5 --warmups 2 --timeout-ms 12000 --baseline-repo /fixture/baseline --json"
  )

  _ = try await runner.runPerformance(
    PerformanceRunRequest(
      requestID: "perf-inspect",
      operation: .inspect,
      repositoryPath: "/fixture/repo",
      subjectRunID: "run-42"
    ))
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "performance --operation inspect --repo /fixture/repo --request-id perf-inspect --subject-run-id run-42 --json"
  )
}

@Test
func supervisedPerformanceRunnerRejectsStateExitMismatchAndCancellation() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-performance-terminal-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let mismatchExecutable = fixtureDirectory.appending(path: "codevetter-mismatch")
  let receipt = performanceFixtureReceipt(
    requestID: "perf-mismatch",
    operation: "plan",
    result: #"{"decision":{"status":"admitted"}}"#
  )
  try "#!/bin/sh\nprintf '%s\\n' '\(receipt)'\nexit 2\n".write(
    to: mismatchExecutable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes(
    [.posixPermissions: 0o755],
    ofItemAtPath: mismatchExecutable.path
  )
  do {
    _ = try await CodeVetterProcessRunner(executableURL: mismatchExecutable).runPerformance(
      PerformanceRunRequest(
        requestID: "perf-mismatch",
        operation: .plan,
        repositoryPath: "/fixture/repo",
        adapter: .vitest,
        target: "src/cart.test.ts"
      ))
    Issue.record("A success receipt must not survive an exit-status mismatch")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("conflicts with process status"))
  }

  let sleeper = fixtureDirectory.appending(path: "codevetter-sleeper")
  try "#!/bin/sh\nexec sleep 30\n".write(to: sleeper, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: sleeper.path)
  let runner = CodeVetterProcessRunner(executableURL: sleeper)
  let task = Task {
    try await runner.runPerformance(
      PerformanceRunRequest(
        requestID: "perf-cancel",
        operation: .diagnose,
        repositoryPath: "/fixture/repo",
        adapter: .nodeScript,
        target: "scripts/benchmark.mjs"
      ))
  }
  try await Task.sleep(for: .milliseconds(100))
  task.cancel()
  do {
    _ = try await task.value
    Issue.record("Cancellation must not produce a successful performance receipt")
  } catch is CancellationError {
    // Expected: cancellation is terminal and no receipt is accepted.
  }
}

@Test
func supervisedEvidenceScopeRunnerPreservesTheSharedDiscoveryContract() async throws {
  let surfaceFixture = try sharedSurfaceParityFixture()
  let authority = try #require(surfaceFixture["authority"] as? [String: Any])
  let request = try #require(surfaceFixture["request"] as? [String: Any])
  let expected = try #require(surfaceFixture["expected"] as? [String: Any])
  let expectedCandidate = try #require(expected["first_candidate"] as? [String: Any])
  let canonicalReceipt = try #require(surfaceFixture["canonical_receipt"] as? [String: Any])
  let planData = try JSONSerialization.data(
    withJSONObject: canonicalReceipt, options: [.sortedKeys])
  let plan = try #require(String(data: planData, encoding: .utf8))
  #expect(authority["native"] as? String == "supervised_projection")
  #expect(authority["mcp_may_execute"] as? Bool == false)

  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-scope-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    printf '%s\n' '\(plan)'
    exit 0
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let result = try await CodeVetterProcessRunner(executableURL: executable).resolveEvidenceScope(
    EvidenceScopeRequest(
      repositoryPath: "/fixture/repo",
      consumer: .performance,
      kind: .flow,
      value: try #require(request["value"] as? String)
    )
  )
  #expect(result.plan.ready)
  #expect(result.plan.schemaVersion == UInt32(try #require(expected["schema_version"] as? Int)))
  #expect(result.plan.status == expected["status"] as? String)
  #expect(result.plan.candidates.count == expected["candidate_count"] as? Int)
  #expect(result.plan.candidates.first?.id == expectedCandidate["id"] as? String)
  #expect(result.plan.candidates.first?.target == expectedCandidate["target"] as? String)
  #expect(result.plan.candidates.first?.confidenceLabel == "95.0%")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "scope --consumer performance --repo /fixture/repo --flow coupon total --json"
  )
}

@Test
func supervisedUsageRunnerPreservesArgumentsAndInspectableNonzeroStates() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-usage-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let report =
    #"{"status":"stale","stale":true,"error":{"category":"timeout","message":"Using the last accepted local snapshot."},"provenance":{"engine":"ccusage","version":"20.0.20","generated_at":"2026-08-31T00:00:00Z","timezone":"Asia/Kolkata","window":"all","detected_agents":["claude","codex","grok"],"excluded_agents":["devin"],"codex_roots":["/fixture/codex"],"source_fingerprint":"sha256:fixture","pricing_complete":true,"fallback_models":[],"unpriced_models":[]},"daily":[],"weekly":[],"monthly":[],"sessions":[],"totals":{"input_tokens":1,"cache_creation_tokens":2,"cache_read_tokens":3,"output_tokens":4,"total_tokens":10,"cost_usd":0.25},"devin":{"status":"ready","source":"CodeVetter SQLite · indexed Devin sessions.db","sessions":3,"generated_tokens":1200,"cache_read_tokens":200,"output_tokens":300,"cost_usd":0.42,"models":[{"model":"glm-5.2","sessions":3,"generated_tokens":1200,"cache_read_tokens":200,"cost_usd":0.42}],"limitations":["This local history is not live quota telemetry."]}}"#
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    printf '%s\n' '\(report)'
    exit 1
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let result = try await CodeVetterProcessRunner(executableURL: executable).runUsage(
    timezone: "Asia/Kolkata",
    refresh: true
  )
  #expect(result.processStatus == 1)
  #expect(result.report.status == .stale)
  #expect(result.report.totals.generatedTokens == 7)
  #expect(result.report.provenance.excludedAgents == ["devin"])
  #expect(result.report.devin?.sessions == 3)
  #expect(result.report.devin?.models.first?.model == "glm-5.2")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "usage --timezone Asia/Kolkata --refresh --json"
  )
}

@Test
func supervisedUsageRunnerRejectsStatusExitMismatch() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-usage-mismatch-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let report =
    #"{"status":"ready","stale":false,"error":null,"provenance":{"engine":"ccusage","version":"20.0.20","generated_at":"2026-08-31T00:00:00Z","timezone":"UTC","window":"all","detected_agents":[],"excluded_agents":[],"codex_roots":[],"source_fingerprint":"sha256:fixture","pricing_complete":true,"fallback_models":[],"unpriced_models":[]},"daily":[],"weekly":[],"monthly":[],"sessions":[],"totals":{"input_tokens":0,"cache_creation_tokens":0,"cache_read_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0}}"#
  try "#!/bin/sh\nprintf '%s\\n' '\(report)'\nexit 2\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  do {
    _ = try await CodeVetterProcessRunner(executableURL: executable).runUsage()
    Issue.record("A ready report must not survive a nonzero process status")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("conflicts with process status"))
  }
}

@Test
func supervisedProviderQuotaRunnerPreservesRemainingWindowsAndPartialAvailability() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-quota-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let receipt =
    #"{"schema_version":"codevetter.provider-quota/v1","generated_at":"2026-09-03T00:00:00Z","providers":[{"provider":"claude","status":"ready","source":"Claude Code /usage","checked_at":"2026-09-03T00:00:00Z","plan":"Claude Team","windows":[{"id":"current","label":"Current window","used_percent":3,"remaining_percent":97,"window_duration_minutes":null,"resets_at_unix":null,"reset_description":"2:20am (Asia/Calcutta)"},{"id":"weekly","label":"Weekly window","used_percent":32,"remaining_percent":68,"window_duration_minutes":null,"resets_at_unix":null,"reset_description":"Sep 6 at 5:30pm (Asia/Calcutta)"}],"credits":{"used_percent":0,"remaining_percent":100,"used_amount":0,"limit_amount":150,"currency":"USD","reset_description":"Oct 1 (Asia/Calcutta)"},"reset_credits":null,"message":null},{"provider":"codex","status":"unavailable","source":"codex app-server account/rateLimits/read","checked_at":"2026-09-03T00:00:00Z","plan":null,"windows":[],"credits":null,"reset_credits":null,"message":"Sign in with Codex."}],"limitations":["Unavailable provider telemetry is never represented as zero usage."]}"#
  let script = """
    #!/bin/sh
    printf '%s' "$*" > '\(argumentsFile.path)'
    printf '%s\n' '\(receipt)'
    exit 1
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let result = try await CodeVetterProcessRunner(executableURL: executable).runProviderQuota()
  #expect(result.providers.count == 2)
  #expect(result.providers[0].windows[0].remainingPercent == 97)
  #expect(result.providers[0].credits?.limitAmount == 150)
  #expect(result.providers[1].status == "unavailable")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "quota --provider all --json"
  )
}

@Test
func supervisedProviderQuotaRunnerRejectsAvailabilityExitMismatch() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-quota-mismatch-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let receipt =
    #"{"schema_version":"codevetter.provider-quota/v1","generated_at":"2026-09-03T00:00:00Z","providers":[{"provider":"codex","status":"ready","source":"codex app-server account/rateLimits/read","checked_at":"2026-09-03T00:00:00Z","plan":"pro","windows":[{"id":"codex.primary","label":"Weekly window","used_percent":92,"remaining_percent":8,"window_duration_minutes":10080,"resets_at_unix":1788750854,"reset_description":null}],"credits":null,"reset_credits":1,"message":null}],"limitations":[]}"#
  try "#!/bin/sh\nprintf '%s\\n' '\(receipt)'\nexit 2\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  do {
    _ = try await CodeVetterProcessRunner(executableURL: executable).runProviderQuota()
    Issue.record("A ready provider quota receipt must not survive exit 2")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("conflicts with process status"))
  }
}

@Test
func supervisedUnpackRunnerPreservesScanComparisonAndExportContracts() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-unpack-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let fixture = try unpackFixturePayload(snapshotCount: 2, nodeCount: 4, rootChildren: 4)
  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let workerRequestsFile = fixtureDirectory.appending(path: "worker-requests.txt")
  let history = String(decoding: fixture.history, as: UTF8.self)
  let record = String(decoding: fixture.record, as: UTF8.self)
  let repository = fixtureDirectory.appending(path: "repository", directoryHint: .isDirectory)
  try FileManager.default.createDirectory(at: repository, withIntermediateDirectories: true)
  let recordObject = try #require(
    JSONSerialization.jsonObject(with: fixture.record) as? [String: Any])
  let inventoryText = try #require(recordObject["inventory_json"] as? String)
  var inventory = try #require(
    JSONSerialization.jsonObject(with: Data(inventoryText.utf8)) as? [String: Any])
  inventory["repo_path"] = repository.resolvingSymlinksInPath().path
  let scanReceipt = try JSONSerialization.data(
    withJSONObject: [
      "schema_version": "codevetter.unpack-scan/v1",
      "report_id": "scan-fixture",
      "status": "scan_only",
      "created_at": "2026-09-01T00:00:00Z",
      "inventory": inventory,
      "profiles": [
        ["stage": "full_scan", "total_ms": 12, "peak_rss_bytes": 1_024, "steps": []],
        [
          "stage": "local_scan_persist", "total_ms": 2, "peak_rss_bytes": 1_024,
          "steps": [],
        ],
      ],
    ]
  )
  let scan = String(decoding: scanReceipt, as: UTF8.self)
  let baseCommit = String(repeating: "1", count: 40)
  let headCommit = String(repeating: "2", count: 40)
  let comparison =
    "{\"base_commit\":\"\(baseCommit)\",\"head_commit\":\"\(headCommit)\",\"commit_count\":1,\"commits\":[{\"sha\":\"\(headCommit)\",\"date\":\"2026-09-01\",\"author\":\"Fixture\",\"subject\":\"Improve evidence desk\",\"additions\":12,\"deletions\":3,\"files\":[]}],\"truncated\":false}"
  let export =
    "{\"schema_version\":\"codevetter.unpack-export/v1\",\"report_id\":\"snapshot-0\",\"format\":\"repo_memory_markdown\",\"content\":\"# Repository memory\"}"
  let queryReceipt = """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"\(repository.resolvingSymlinksInPath().path)","query":"verification service","domain":"graph","mode":"search","limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":12,"node_count":24,"edge_count":31,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","checkpoint_count":2,"event_count":8,"updated_at":"2026-09-01T00:00:00Z"},"graph_result":{"hits":[{"node":{"id":"node-1","kind":"function","label":"run_verification","qualified_name":"verification::run","path":"src/review.rs","detail":"canonical runner","language":"rust","community_id":"community-1","trust":"extracted","sources":[{"path":"src/review.rs","start_line":42,"end_line":88}]},"score":991000,"matched_by":"label"}],"truncated":false,"next_cursor":null},"history_result":null}
    """
  let historyQueryReceipt = """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"\(repository.resolvingSymlinksInPath().path)","query":"regression","domain":"history","mode":"search","limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":12,"node_count":24,"edge_count":31,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","checkpoint_count":2,"event_count":8,"updated_at":"2026-09-01T00:00:00Z"},"graph_result":null,"history_result":{"schema_version":1,"items":[{"kind":"event","id":"event-1","label":"verification_failed","summary":"Regression evidence recorded","revision":"\(headCommit)","recorded_at":"2026-09-01T00:00:00Z","trust":"extracted","source_ids":["verification-ledger"]}],"truncated":false,"next_offset":null}}
    """
  let graphExplainReceipt = """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"\(repository.resolvingSymlinksInPath().path)","query":"node-1","domain":"graph","mode":"explain","limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":12,"node_count":24,"edge_count":31,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","checkpoint_count":2,"event_count":8,"updated_at":"2026-09-01T00:00:00Z"},"graph_explanation":{"node":{"id":"node-1","kind":"function","label":"run_verification","path":"src/review.rs","trust":"extracted","sources":[{"path":"src/review.rs","start_line":42,"end_line":88}]},"incoming_count":3,"outgoing_count":5,"incoming_kinds":["calls"],"outgoing_kinds":["calls","uses"],"truncated":false}}
    """
  let graphImpactReceipt = """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"\(repository.resolvingSymlinksInPath().path)","query":"node-1","domain":"graph","mode":"impact","direction":"incoming","depth":2,"limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":12,"node_count":24,"edge_count":31,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","checkpoint_count":2,"event_count":8,"updated_at":"2026-09-01T00:00:00Z"},"graph_impact":{"root":{"id":"node-1","kind":"function","label":"run_verification","path":"src/review.rs","trust":"extracted","sources":[]},"affected":[{"id":"node-2","kind":"module","label":"review_commands","path":"src/commands/review.rs","trust":"extracted","sources":[]}],"edges":[{"id":"edge-1","from":"node-2","to":"node-1","kind":"calls","evidence":"syntax","trust":"extracted","sources":[]}],"depth_reached":1,"truncated":false}}
    """
  let graphPathReceipt = """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"\(repository.resolvingSymlinksInPath().path)","query":"node-1","domain":"graph","mode":"path","target":"node-2","limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":12,"node_count":24,"edge_count":31,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","checkpoint_count":2,"event_count":8,"updated_at":"2026-09-01T00:00:00Z"},"graph_path":{"nodes":[{"id":"node-1","kind":"function","label":"run_verification","path":"src/review.rs","trust":"extracted","sources":[]},{"id":"node-2","kind":"module","label":"review_commands","path":"src/commands/review.rs","trust":"extracted","sources":[]}],"edges":[{"id":"edge-2","from":"node-1","to":"node-2","kind":"uses","evidence":"syntax","trust":"extracted","sources":[]}],"total_cost":1.002,"visited":2,"truncated":false}}
    """
  let historyTraceReceipt = """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"\(repository.resolvingSymlinksInPath().path)","query":"event-1","domain":"history","mode":"trace","history_selector":"event","limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":12,"node_count":24,"edge_count":31,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(headCommit)","indexed_head":"\(headCommit)","checkpoint_count":2,"event_count":8,"updated_at":"2026-09-01T00:00:00Z"},"history_trace":{"schema_version":1,"repo_path":"\(repository.resolvingSymlinksInPath().path)","selector":{"kind":"event","event_id":"event-1"},"episodes":[{"id":"episode-1","events":[{"id":"event-1","revision_sha":"\(headCommit)","event_kind":"verification_failed","stage":"regression","summary":"Regression evidence recorded","trust":"extracted","origin":"verification","source_id":"verification-ledger","recorded_at":"2026-09-01T00:00:00Z","sources":[]}],"links":[],"qualified_leads":[],"stages_present":["regression"],"gaps":["No implementation event is indexed."],"contradictions":[],"started_at":"2026-09-01T00:00:00Z","ended_at":"2026-09-01T00:00:00Z","truncated":false}],"indexed_head":"\(headCommit)","stale":false,"gaps":[],"scanned_events":1,"total_events":8,"truncated":false,"next_cursor":null}}
    """
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *"--operation query-worker"*)
        while IFS= read -r request; do
          printf '%s\n' "$request" >> '\(workerRequestsFile.path)'
          request_id=$(printf '%s\n' "$request" | sed -E 's/.*"request_id":"([^"]+)".*/\\1/')
          case "$request" in
            *'"mode":"explain"'*) receipt='\(graphExplainReceipt)' ;;
            *'"mode":"impact"'*) receipt='\(graphImpactReceipt)' ;;
            *'"mode":"path"'*) receipt='\(graphPathReceipt)' ;;
            *'"mode":"trace"'*) receipt='\(historyTraceReceipt)' ;;
            *'"domain":"history"'*) receipt='\(historyQueryReceipt)' ;;
            *) receipt='\(queryReceipt)' ;;
          esac
          printf '{"schema_version":"codevetter.repo-query-worker-response/v1","request_id":"%s","status":"ok","receipt":%s}\n' "$request_id" "$receipt"
        done
        ;;
      *"--operation compare"*) printf '%s\n' '\(comparison)' ;;
      *"--operation export"*) printf '%s\n' '\(export)' ;;
      *"--operation scan"*) printf '%s\n' '\(scan)' ;;
      *"--operation query"*"--query-domain history"*) printf '%s\n' '\(historyQueryReceipt)' ;;
      *"--operation query"*) printf '%s\n' '\(queryReceipt)' ;;
      *--report-id*) printf '%s\n' '\(record)' ;;
      *) printf '%s\n' '\(history)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let receipt = try await runner.listUnpackSnapshots(
    repositoryPath: "/fixture/repo",
    limit: 500
  )
  let inspected = try await runner.inspectUnpackSnapshot(id: "snapshot-0")
  let scanned = try await runner.scanUnpackRepository(repositoryPath: repository.path)
  let compared = try await runner.compareUnpackSnapshots(
    repositoryPath: repository.path,
    baseCommit: baseCommit,
    headCommit: headCommit
  )
  let exported = try await runner.exportUnpackSnapshot(
    id: "snapshot-0",
    format: .repositoryMemoryMarkdown
  )
  let queried = try await runner.queryRepositoryEvidence(
    repositoryPath: repository.path,
    domain: .graph,
    query: "verification service"
  )
  let historyQueried = try await runner.queryRepositoryEvidence(
    repositoryPath: repository.path,
    domain: .history,
    query: "regression"
  )
  let explained = try await runner.queryRepositoryEvidence(
    repositoryPath: repository.path,
    domain: .graph,
    query: "node-1",
    mode: .explain
  )
  let impacted = try await runner.queryRepositoryEvidence(
    repositoryPath: repository.path,
    domain: .graph,
    query: "node-1",
    mode: .impact,
    direction: .incoming,
    depth: 2
  )
  let pathed = try await runner.queryRepositoryEvidence(
    repositoryPath: repository.path,
    domain: .graph,
    query: "node-1",
    mode: .path,
    target: "node-2"
  )
  let traced = try await runner.queryRepositoryEvidence(
    repositoryPath: repository.path,
    domain: .history,
    query: "event-1",
    mode: .trace,
    historySelector: .event
  )
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .split(separator: "\n").map(String.init)
  let workerRequests = try String(contentsOf: workerRequestsFile, encoding: .utf8)

  #expect(receipt.schemaVersion == "codevetter.unpack-history/v1")
  #expect(receipt.reports.count == 2)
  #expect(inspected.id == "snapshot-0")
  #expect(scanned.schemaVersion == "codevetter.unpack-scan/v1")
  #expect(scanned.reportID == "scan-fixture")
  #expect(scanned.profiles.map(\.stage) == ["full_scan", "local_scan_persist"])
  #expect(compared.commitCount == 1)
  #expect(compared.commits.first?.subject == "Improve evidence desk")
  #expect(exported.schemaVersion == "codevetter.unpack-export/v1")
  #expect(exported.content == "# Repository memory")
  #expect(queried.schemaVersion == "codevetter.repo-query/v2")
  #expect(queried.graphResult?.hits.first?.node.label == "run_verification")
  #expect(queried.historyResult == nil)
  #expect(historyQueried.historyResult?.items.first?.summary == "Regression evidence recorded")
  #expect(historyQueried.graphResult == nil)
  #expect(explained.graphExplanation?.incomingCount == 3)
  #expect(impacted.graphImpact?.affected.first?.label == "review_commands")
  #expect(pathed.graphPath?.edges.first?.kind == "uses")
  #expect(traced.historyTrace?.episodes.first?.events.first?.stage == "regression")
  #expect(try inspected.decodeInventory()?.allFilesCapped == true)
  #expect(
    arguments == [
      "unpack --limit 100 --repo /fixture/repo --json",
      "unpack --report-id snapshot-0 --json",
      "unpack --operation scan --repo \(repository.path) --json",
      "unpack --operation compare --repo \(repository.path) --base-commit \(baseCommit) --head-commit \(headCommit) --json",
      "unpack --operation export --report-id snapshot-0 --format repo_memory_markdown --json",
      "unpack --operation query-worker --json",
    ])
  #expect(workerRequests.contains(#""domain":"graph""#))
  #expect(workerRequests.contains(#""query":"verification service""#))
  #expect(workerRequests.contains(#""domain":"history""#))
  #expect(workerRequests.contains(#""query":"regression""#))
  #expect(workerRequests.contains(#""mode":"explain""#))
  #expect(workerRequests.contains(#""mode":"impact""#))
  #expect(workerRequests.contains(#""mode":"path""#))
  #expect(workerRequests.contains(#""mode":"trace""#))
}

@Test
func repositoryQueryWorkerCancellationRejectsPartialOutputAndRestartsCleanly() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-query-worker-cancel-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }
  let executable = fixtureDirectory.appending(path: "codevetter")
  let marker = fixtureDirectory.appending(path: "first-worker-started")
  let repository = fixtureDirectory.appending(path: "repository", directoryHint: .isDirectory)
  try FileManager.default.createDirectory(at: repository, withIntermediateDirectories: true)
  let canonicalPath = repository.resolvingSymlinksInPath().path
  let receipt =
    #"{"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"\#(canonicalPath)","query":"verification","domain":"graph","mode":"search","limit":40,"status":"unavailable","issue":"Fixture has no graph index.","graph_status":{"indexed":false,"stale":false,"current_head":null,"indexed_head":null,"snapshot_id":null,"engine_id":null,"engine_version":null,"indexed_files":0,"node_count":0,"edge_count":0,"truncated":false},"history_status":{"indexed":false,"stale":false,"current_head":"unknown","indexed_head":null,"checkpoint_count":0,"event_count":0,"updated_at":null},"graph_result":null,"history_result":null}"#
  let script = """
    #!/bin/sh
    if [ ! -f '\(marker.path)' ]; then
      touch '\(marker.path)'
      IFS= read -r request
      IFS= read -r hold
      exit 0
    fi
    while IFS= read -r request; do
      request_id=$(printf '%s\n' "$request" | sed -E 's/.*"request_id":"([^"]+)".*/\\1/')
      printf '{"schema_version":"codevetter.repo-query-worker-response/v1","request_id":"%s","status":"ok","receipt":%s}\n' "$request_id" '\(receipt)'
    done
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let first = Task {
    try await runner.queryRepositoryEvidence(
      repositoryPath: repository.path,
      domain: .graph,
      query: "verification"
    )
  }
  var workerStarted = false
  for _ in 0..<200 {
    if FileManager.default.fileExists(atPath: marker.path) {
      workerStarted = true
      break
    }
    try await Task.sleep(for: .milliseconds(10))
  }
  try #require(workerStarted, "The worker fixture must start before cancellation")
  let cancellationStarted = Date()
  first.cancel()
  do {
    _ = try await first.value
    Issue.record("A cancelled query worker must not accept a partial receipt")
  } catch is CancellationError {
    // Expected supervised cancellation.
  }
  #expect(
    Date().timeIntervalSince(cancellationStarted) < 1,
    "A blocked query worker must settle cancellation within one second"
  )

  let restarted = try await runner.queryRepositoryEvidence(
    repositoryPath: repository.path,
    domain: .graph,
    query: "verification"
  )
  #expect(restarted.status == "unavailable")
  #expect(restarted.graphResult == nil)
}

@Test
func supervisedUnpackRunnerRejectsUnknownHistorySchemaAndMalformedRecords() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-unpack-invalid-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let invalidHistory =
    #"{"schema_version":"codevetter.unpack-history/v0","generated_at":"2026-08-31T00:00:00Z","database_available":true,"repo_path":null,"limit":50,"returned":0,"reports":[]}"#
  try "#!/bin/sh\nprintf '%s\\n' '\(invalidHistory)'\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let runner = CodeVetterProcessRunner(executableURL: executable)

  do {
    _ = try await runner.listUnpackSnapshots()
    Issue.record("An unknown Repo Unpack history schema must not enter the native client")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("Unsupported Repo Unpack history schema"))
  }

  try "#!/bin/sh\nprintf '%s\\n' '{}'\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  do {
    _ = try await runner.inspectUnpackSnapshot(id: "missing")
    Issue.record("A malformed Repo Unpack record must not enter the native client")
  } catch is VerificationRunnerError {
    // Expected: typed decoding rejects an incomplete record.
  }
}

@Test
func supervisedSettingsRunnerPreservesOneValidatedAssignmentAndSchema() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-settings-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let listJSON = String(decoding: try nativeSettingsFixtureReceipt(), as: UTF8.self)
  let savedJSON = String(
    decoding: try nativeSettingsFixtureReceipt(savedKey: "review_tone", reviewTone: "strict"),
    as: UTF8.self
  )
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *--set*) printf '%s\n' '\(savedJSON)' ;;
      *) printf '%s\n' '\(listJSON)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let listed = try await runner.loadNativeSettings()
  let saved = try await runner.saveNativeSetting(key: "review_tone", value: "strict")
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .split(separator: "\n").map(String.init)

  #expect(listed.schemaVersion == "codevetter.native-settings/v1")
  #expect(listed.settings.count == 28)
  #expect(listed.settings.filter { $0.section == "agent_island" }.count == 12)
  #expect(listed.settings.allSatisfy { $0.key != "github_token" })
  #expect(saved.savedKey == "review_tone")
  #expect(saved.settings.first(where: { $0.key == "review_tone" })?.value == "strict")
  #expect(
    arguments == [
      "settings --json",
      "settings --set review_tone=strict --json",
    ])
}

@Test
func supervisedSettingsRunnerRejectsUnknownSchemas() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-settings-schema-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let payload =
    #"{"schema_version":"codevetter.native-settings/v0","generated_at":"2026-09-01T00:00:00Z","database_available":true,"saved_key":null,"settings":[],"excluded_sensitive_keys":["github_token"]}"#
  try "#!/bin/sh\nprintf '%s\\n' '\(payload)'\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  do {
    _ = try await CodeVetterProcessRunner(executableURL: executable).loadNativeSettings()
    Issue.record("An unknown native settings schema must not enter the client")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("Unsupported native settings schema"))
  }
}

@Test
func supervisedSettingsRunnerRejectsPartialAgentIslandContracts() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-settings-island-contract-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  var payload = try #require(
    JSONSerialization.jsonObject(with: nativeSettingsFixtureReceipt()) as? [String: Any]
  )
  var settings = try #require(payload["settings"] as? [[String: Any]])
  settings.removeAll { $0["key"] as? String == "native_agent_island_claude_voice" }
  payload["settings"] = settings
  let payloadJSON = String(
    decoding: try JSONSerialization.data(withJSONObject: payload),
    as: UTF8.self
  )

  let executable = fixtureDirectory.appending(path: "codevetter")
  try "#!/bin/sh\nprintf '%s\\n' '\(payloadJSON)'\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  do {
    _ = try await CodeVetterProcessRunner(executableURL: executable).loadNativeSettings()
    Issue.record("A partial Agent Island settings contract must not enter the client")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("complete Agent Island preference contract"))
  }
}

@Test
func supervisedOpsRunnerPreservesAggregateReadOnlyBoundary() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-ops-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let payload = String(decoding: try opsStatusFixtureReceipt(windowDays: 90), as: UTF8.self)
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" > '\(argumentsFile.path)'
    printf '%s\n' '\(payload)'
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let receipt = try await CodeVetterProcessRunner(executableURL: executable)
    .loadOpsStatus(windowDays: 90)
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .trimmingCharacters(in: .whitespacesAndNewlines)

  #expect(receipt.schemaVersion == "codevetter.ops-status/v1")
  #expect(receipt.observability.count == 2)
  #expect(receipt.excludedSensitiveKeys.count == 3)
  #expect(arguments == "ops --window-days 90 --json")
}

@Test
func supervisedHistoryRootsRunnerPreservesBoundedReadAddAndRemoveContracts() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-history-roots-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let readJSON = String(decoding: try historyRootsFixtureReceipt(operation: "read"), as: UTF8.self)
  let addJSON = String(
    decoding: try historyRootsFixtureReceipt(operation: "add", changedRoot: "/fixture/codex"),
    as: UTF8.self
  )
  let removeJSON = String(
    decoding: try historyRootsFixtureReceipt(operation: "remove", changedRoot: "/fixture/codex"),
    as: UTF8.self
  )
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *--add*) printf '%s\n' '\(addJSON)' ;;
      *--remove*) printf '%s\n' '\(removeJSON)' ;;
      *) printf '%s\n' '\(readJSON)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let read = try await runner.loadHistoryRoots()
  let added = try await runner.addHistoryRoot(path: "/fixture/codex")
  let removed = try await runner.removeHistoryRoot(path: "/fixture/codex")
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .split(separator: "\n").map(String.init)

  #expect(read.schemaVersion == "codevetter.history-roots/v1")
  #expect(read.roots.count == 1)
  #expect(added.changedRoot == "/fixture/codex")
  #expect(removed.operation == .remove)
  #expect(
    arguments == [
      "history-roots --json",
      "history-roots --add /fixture/codex --json",
      "history-roots --remove /fixture/codex --json",
    ])
}

@Test
func supervisedMcpRunnerPreservesRepositoryScopeAndExplicitAuthorityFlags() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-mcp-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let readJSON = String(decoding: try mcpSettingsFixtureReceipt(operation: "read"), as: UTF8.self)
  let enabledJSON = String(
    decoding: try mcpSettingsFixtureReceipt(operation: "enable", enabled: true),
    as: UTF8.self
  )
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *--enable*) printf '%s\n' '\(enabledJSON)' ;;
      *) printf '%s\n' '\(readJSON)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let read = try await runner.runMcpSettings(repositoryPath: "/fixture/repo")
  let enabled = try await runner.runMcpSettings(
    repositoryPath: "/fixture/repo",
    operation: .enable
  )
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .split(separator: "\n").map(String.init)

  #expect(read.schemaVersion == "codevetter.mcp-settings/v1")
  #expect(read.settings.repoID == "opaque-repo-id")
  #expect(read.settings.clientConfigJSON?.contains("codevetter-history") == true)
  #expect(enabled.settings.enabled)
  #expect(
    arguments == [
      "mcp --repo /fixture/repo --json",
      "mcp --repo /fixture/repo --enable --json",
    ])
}

@Test
func supervisedMcpRunnerRejectsOperationMismatch() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-mcp-mismatch-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let readJSON = String(decoding: try mcpSettingsFixtureReceipt(operation: "read"), as: UTF8.self)
  try "#!/bin/sh\nprintf '%s\\n' '\(readJSON)'\n".write(
    to: executable,
    atomically: true,
    encoding: .utf8
  )
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  do {
    _ = try await CodeVetterProcessRunner(executableURL: executable).runMcpSettings(
      repositoryPath: "/fixture/repo",
      operation: .disable
    )
    Issue.record("An MCP authority receipt must match the requested operation")
  } catch let error as VerificationRunnerError {
    #expect(error.localizedDescription.contains("conflicts with the requested disable"))
  }
}

@Test
func supervisedRetentionRunnerPreservesExplicitAuthorityAndSchema() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-retention-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let planJSON = String(
    decoding: try sessionRetentionFixtureReceipt(operation: "plan"), as: UTF8.self)
  let applyJSON = String(
    decoding: try sessionRetentionFixtureReceipt(operation: "apply"), as: UTF8.self)
  let checkpointJSON = String(
    decoding: try sessionRetentionFixtureReceipt(operation: "checkpoint"), as: UTF8.self)
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *--apply*) printf '%s\n' '\(applyJSON)' ;;
      *--checkpoint*) printf '%s\n' '\(checkpointJSON)' ;;
      *) printf '%s\n' '\(planJSON)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let plan = try await runner.runSessionRetention(
    operation: .plan,
    maxAgeDays: 90,
    maxArchiveMiB: 2048
  )
  let applied = try await runner.runSessionRetention(
    operation: .apply,
    planID: plan.plan?.id
  )
  let checkpoint = try await runner.runSessionRetention(
    operation: .checkpoint,
    vacuum: true
  )
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .split(separator: "\n").map(String.init)

  #expect(plan.schemaVersion == "codevetter.session-retention/v1")
  #expect(plan.plan?.candidateRows == 120)
  #expect(applied.operation == .apply)
  #expect(checkpoint.operation == .checkpoint)
  #expect(
    arguments == [
      "retention --max-age-days 90 --max-archive-mib 2048 --json",
      "retention --apply retention-plan:fixture --json",
      "retention --checkpoint --vacuum --json",
    ])
}

@MainActor
@Test
func nativeRetentionSettingsRenderTheReviewedPlanAndProtectedReasons() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .usage
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )
  model.retentionReceipt = try JSONDecoder().decode(
    SessionRetentionReceipt.self,
    from: sessionRetentionFixtureReceipt(operation: "plan")
  )

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_RETENTION_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_RETENTION_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func nativeHistoryRootsRenderAvailabilityAndRemovalWithoutTranscriptContent() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .usage
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )
  model.historyRootsReceipt = try JSONDecoder().decode(
    HistoryRootsReceipt.self,
    from: historyRootsFixtureReceipt(operation: "read")
  )

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_HISTORY_ROOTS_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_HISTORY_ROOTS_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@Test
func supervisedMemoriesRunnerPreservesListReadAndDiffBoundaries() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-memories-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let listJSON = String(decoding: try memoryFixtureReceipt(operation: "list"), as: UTF8.self)
  let readJSON = String(decoding: try memoryFixtureReceipt(operation: "read"), as: UTF8.self)
  let diffJSON = String(decoding: try memoryFixtureReceipt(operation: "diff"), as: UTF8.self)
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *--diff*) printf '%s\n' '\(diffJSON)' ;;
      *--source*) printf '%s\n' '\(readJSON)' ;;
      *) printf '%s\n' '\(listJSON)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let listed = try await runner.runMemories()
  let read = try await runner.runMemories(
    operation: .read,
    sourceID: "memory:sha256:fixture"
  )
  let diff = try await runner.runMemories(
    operation: .diff,
    sourceID: "memory:sha256:fixture"
  )
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .split(separator: "\n").map(String.init)

  #expect(listed.sources.count == 1)
  #expect(listed.candidateLocationsChecked == 79)
  #expect(listed.document == nil)
  #expect(read.document?.content.contains("executable evidence") == true)
  #expect(read.sources.allSatisfy { !$0.displayPath.hasPrefix("/") })
  #expect(diff.diff?.hasChanges == true)
  #expect(
    arguments == [
      "memories --json",
      "memories --source memory:sha256:fixture --json",
      "memories --source memory:sha256:fixture --diff --json",
    ])
}

@MainActor
@Test
func nativeMemoriesRenderBoundedPrivateDocumentWithoutAbsolutePaths() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .memories
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )
  let receipt = try JSONDecoder().decode(
    MemoryReceipt.self,
    from: memoryFixtureReceipt(operation: "read")
  )
  model.memoryReceipt = receipt
  model.memoryDocument = receipt.document
  model.selectedMemorySourceID = receipt.selectedSourceID

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_MEMORIES_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_MEMORIES_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@Test
func supervisedRubricRunnerPreservesReadSelectAndUpsertContracts() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-rubrics-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let readJSON = String(decoding: try rubricFixtureReceipt(operation: "read"), as: UTF8.self)
  let selectJSON = String(
    decoding: try rubricFixtureReceipt(operation: "select", savedPackID: "security-boundary"),
    as: UTF8.self
  )
  let upsertJSON = String(
    decoding: try rubricFixtureReceipt(operation: "upsert", savedPackID: "performance-proof"),
    as: UTF8.self
  )
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *--select*) printf '%s\n' '\(selectJSON)' ;;
      *--id*) printf '%s\n' '\(upsertJSON)' ;;
      *) printf '%s\n' '\(readJSON)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

  let runner = CodeVetterProcessRunner(executableURL: executable)
  let read = try await runner.runRubricSettings()
  let selected = try await runner.runRubricSettings(
    operation: .select,
    packID: "security-boundary"
  )
  let upserted = try await runner.runRubricSettings(
    operation: .upsert,
    pack: RubricPackInput(
      id: "performance-proof",
      name: "Performance Proof",
      focus: "Measured regressions",
      checks: ["Require a baseline", "Reject unsupported claims"]
    )
  )
  let arguments = try String(contentsOf: argumentsFile, encoding: .utf8)
    .split(separator: "\n").map(String.init)

  #expect(read.schemaVersion == "codevetter.rubric-settings/v1")
  #expect(read.packs.count == 4)
  #expect(selected.savedPackID == "security-boundary")
  #expect(upserted.savedPackID == "performance-proof")
  #expect(
    arguments == [
      "rubrics --json",
      "rubrics --select security-boundary --json",
      "rubrics --id performance-proof --name Performance Proof --focus Measured regressions --check Require a baseline --check Reject unsupported claims --json",
    ])
}

@MainActor
@Test
func nativeRubricSettingsRenderPacksUsageAndExactPromptPreview() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .rubrics
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )
  model.rubricReceipt = try JSONDecoder().decode(
    RubricSettingsReceipt.self,
    from: rubricFixtureReceipt(operation: "read")
  )

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_RUBRICS_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_RUBRICS_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func nativeSettingsProjectionRendersInBothAppearances() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .notifications
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_SETTINGS_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_SETTINGS_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func nativeAgentIslandSettingsRenderSharedConfigurationWithoutRuntimeAuthority() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .agentIsland
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_AGENT_ISLAND_SETTINGS_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_AGENT_ISLAND_SETTINGS_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func nativeOpsSettingsRenderAggregateEvidenceWithoutCredentials() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .ops
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )
  model.opsReceipt = try JSONDecoder().decode(
    OpsStatusReceipt.self,
    from: opsStatusFixtureReceipt(windowDays: 30)
  )

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_OPS_SETTINGS_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_OPS_SETTINGS_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func nativeMcpSettingsRenderTheBoundedConnectionAndAudit() throws {
  let model = WorkbenchModel()
  model.section = .settings
  model.settingsSection = .mcp
  model.repositoryPath = "/fixture/repo"
  model.settingsReceipt = try JSONDecoder().decode(
    NativeSettingsReceipt.self,
    from: nativeSettingsFixtureReceipt()
  )
  model.mcpSettingsReceipt = try JSONDecoder().decode(
    McpSettingsReceipt.self,
    from: mcpSettingsFixtureReceipt(operation: "read", enabled: true)
  )

  for _ in 0..<5 { renderSettings(model) }

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_MCP_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_MCP_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureSettings(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func largeUnpackProjectionDecodesAndRendersWithinTheNativeGate() throws {
  let fixture = try unpackFixturePayload(snapshotCount: 100, nodeCount: 700, rootChildren: 1_000)

  for _ in 0..<10 {
    _ = try JSONDecoder().decode(UnpackHistoryReceipt.self, from: fixture.history)
    _ = try JSONDecoder().decode(UnpackSnapshotRecord.self, from: fixture.record)
  }
  var decodeSamples = [UInt64]()
  for _ in 0..<100 {
    let started = DispatchTime.now().uptimeNanoseconds
    _ = try JSONDecoder().decode(UnpackHistoryReceipt.self, from: fixture.history)
    let record = try JSONDecoder().decode(UnpackSnapshotRecord.self, from: fixture.record)
    _ = try record.decodeInventory()
    decodeSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let model = WorkbenchModel()
  model.section = .repository
  let history = try JSONDecoder().decode(UnpackHistoryReceipt.self, from: fixture.history)
  let record = try JSONDecoder().decode(UnpackSnapshotRecord.self, from: fixture.record)
  model.unpackSnapshots = history.reports
  model.selectedUnpackSnapshotID = record.id
  model.unpackSnapshot = record
  model.unpackInventory = try record.decodeInventory()

  for _ in 0..<3 { renderUnpack(model) }
  var renderSamples = [UInt64]()
  for _ in 0..<20 {
    let started = DispatchTime.now().uptimeNanoseconds
    renderUnpack(model)
    renderSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let decodeP95 = percentile95(decodeSamples)
  let renderP95 = percentile95(renderSamples)
  if nativePerformanceGateEnabled() {
    #expect(decodeP95 < 40_000, "Large Repo Unpack decoding must stay below 40 ms p95")
    #expect(renderP95 < 150_000, "Large Repo Unpack rendering must stay below 150 ms p95")
  }
  print(
    "NATIVE_UNPACK_BENCHMARK_JSON "
      + "{\"decode_p95_us\":\(decodeP95),\"render_p95_us\":\(renderP95),"
      + "\"snapshots\":100,\"graph_nodes\":700,\"tree_rows\":1000,"
      + "\"decode_samples\":100,\"render_samples\":20}"
  )

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_UNPACK_SCREENSHOT_PATH"
  ] {
    try captureUnpack(model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_UNPACK_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureUnpack(model, at: URL(fileURLWithPath: screenshotPath), appearance: .aqua)
  }
}

@MainActor
@Test
func repositoryQueryDeskRendersCanonicalFreshnessTrustAndSources() throws {
  let fixture = try unpackFixturePayload(snapshotCount: 2, nodeCount: 20, rootChildren: 20)
  let record = try JSONDecoder().decode(UnpackSnapshotRecord.self, from: fixture.record)
  let history = try JSONDecoder().decode(UnpackHistoryReceipt.self, from: fixture.history)
  let head = String(repeating: "a", count: 40)
  let receiptData = Data(
    """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"/fixture/repo","query":"verification service","domain":"graph","mode":"search","limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(head)","indexed_head":"\(head)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":128,"node_count":842,"edge_count":1304,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(head)","indexed_head":"\(head)","checkpoint_count":18,"event_count":96,"updated_at":"2026-09-01T00:00:00Z"},"graph_result":{"hits":[{"node":{"id":"node-1","kind":"function","label":"run_verification_command","qualified_name":"verification_service::run_verification_command","path":"src/application/verification_service.rs","detail":"Canonical verification application service","language":"rust","community_id":"verification","trust":"extracted","sources":[{"path":"src/application/verification_service.rs","start_line":91,"end_line":188}]},"score":998700,"matched_by":"qualified_name"},{"node":{"id":"node-2","kind":"module","label":"deterministic_review","qualified_name":"commands::deterministic_review","path":"src/commands/deterministic_review.rs","detail":"Evidence-backed review boundary","language":"rust","community_id":"verification","trust":"extracted","sources":[{"path":"src/commands/deterministic_review.rs","start_line":1,"end_line":240}]},"score":917200,"matched_by":"label"}],"truncated":false,"next_cursor":null},"history_result":null}
    """.utf8)
  let detailData = Data(
    """
    {"schema_version":"codevetter.repo-query/v2","authority":"read_only_projection","repo_path":"/fixture/repo","query":"node-1","domain":"graph","mode":"explain","limit":40,"status":"ready","issue":null,"graph_status":{"indexed":true,"stale":false,"current_head":"\(head)","indexed_head":"\(head)","snapshot_id":"graph-1","engine_id":"codevetter-tree-sitter","engine_version":"1","indexed_files":128,"node_count":842,"edge_count":1304,"truncated":false},"history_status":{"indexed":true,"stale":false,"current_head":"\(head)","indexed_head":"\(head)","checkpoint_count":18,"event_count":96,"updated_at":"2026-09-01T00:00:00Z"},"graph_explanation":{"node":{"id":"node-1","kind":"function","label":"run_verification_command","qualified_name":"verification_service::run_verification_command","path":"src/application/verification_service.rs","detail":"Canonical verification application service","language":"rust","community_id":"verification","trust":"extracted","sources":[{"path":"src/application/verification_service.rs","start_line":91,"end_line":188}]},"incoming_count":14,"outgoing_count":9,"incoming_kinds":["calls","references"],"outgoing_kinds":["calls","uses"],"truncated":false}}
    """.utf8)
  let model = WorkbenchModel()
  model.section = .repository
  model.repositoryPath = record.repoPath
  model.unpackSnapshots = history.reports
  model.selectedUnpackSnapshotID = record.id
  model.unpackSnapshot = record
  model.unpackInventory = try record.decodeInventory()
  model.repositoryQueryText = "verification service"
  model.repositoryQueryReceipt = try JSONDecoder().decode(
    RepositoryQueryReceipt.self, from: receiptData)
  renderUnpackQuery(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_UNPACK_QUERY_DESK_SCREENSHOT_PATH"
  ] {
    try captureUnpackQuery(
      model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }

  model.repositoryQueryDetailReceipt = try JSONDecoder().decode(
    RepositoryQueryReceipt.self, from: detailData)

  renderUnpackQuery(model)

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_UNPACK_QUERY_SCREENSHOT_PATH"
  ] {
    try captureUnpackQuery(
      model, at: URL(fileURLWithPath: screenshotPath), appearance: .darkAqua)
  }
}

@MainActor
@Test
func usageWindowsKeepChartTotalsModelsAndSessionsOnOneBoundary() throws {
  let reference = try #require(ISO8601DateFormatter().date(from: "2026-09-01T12:00:00Z"))
  let claude = "claude"
  let daily = [
    usagePeriod("2026-09-01", agent: claude, generated: 10, model: "sonnet"),
    usagePeriod("2026-08-26", agent: claude, generated: 20, model: "sonnet"),
    usagePeriod("2026-08-25", agent: claude, generated: 30, model: "opus"),
    usagePeriod("2026-07-15", agent: claude, generated: 40, model: "opus"),
  ]
  let report = LocalUsageReport(
    status: .ready,
    stale: false,
    error: nil,
    provenance: LocalUsageProvenance(
      engine: "ccusage",
      version: "20.0.20",
      generatedAt: "2026-09-01T12:00:00Z",
      timezone: "UTC",
      window: "all",
      detectedAgents: [claude],
      excludedAgents: ["devin"],
      codexRoots: [],
      sourceFingerprint: "sha256:fixture",
      pricingComplete: true,
      fallbackModels: [],
      unpricedModels: []
    ),
    daily: daily,
    weekly: [usagePeriod("2026-08-24", agent: claude, generated: 60, model: "sonnet")],
    monthly: [usagePeriod("2026-08", agent: claude, generated: 60, model: "sonnet")],
    sessions: [
      usageSession("current", agent: claude, activity: "2026-09-01T10:00:00Z"),
      usageSession("fraction", agent: claude, activity: "2026-09-01T11:59:59.999Z"),
      usageSession("offset", agent: claude, activity: "2026-09-01T17:29:59+05:30"),
      usageSession("future", agent: claude, activity: "2026-09-01T12:00:00.900Z"),
      usageSession("month", agent: claude, activity: "2026-08-10T10:00:00Z"),
      usageSession("old", agent: claude, activity: "2026-05-01T10:00:00Z"),
      usageSession("unknown", agent: claude, activity: nil),
    ],
    totals: daily.reduce(.zero) { $0.adding($1.totals) },
    devin: nil
  )
  let selected = Set([claude])

  #expect(report.periods(for: .day, window: .oneWeek, referenceDate: reference).count == 2)
  #expect(
    report.totals(for: selected, window: .oneWeek, referenceDate: reference).generatedTokens == 30)
  #expect(
    report.totals(for: selected, window: .thirtyDays, referenceDate: reference).generatedTokens
      == 60)
  #expect(
    report.totals(for: selected, window: .ninetyDays, referenceDate: reference).generatedTokens
      == 100)
  #expect(
    report.totals(for: selected, window: .allTime, referenceDate: reference).generatedTokens == 100)
  #expect(report.periods(for: .week, window: .oneWeek, referenceDate: reference).count == 1)
  #expect(report.periods(for: .month, window: .oneWeek, referenceDate: reference).count == 1)
  #expect(
    report.sessions(for: selected, window: .oneWeek, referenceDate: reference).map(\.sessionID) == [
      "current", "fraction", "offset",
    ])
  #expect(
    report.sessions(for: selected, window: .thirtyDays, referenceDate: reference).map(\.sessionID)
      == ["current", "fraction", "offset", "month"])
  #expect(report.sessions(for: selected, window: .allTime, referenceDate: reference).count == 7)
}

@Test
func devinUsageProjectsTheSelectedWindowWithoutJoiningCcusageTotals() throws {
  let payload = Data(
    """
    {
      "status":"ready",
      "source":"CodeVetter SQLite",
      "sessions":18,
      "generated_tokens":950000,
      "cache_read_tokens":310000,
      "output_tokens":80000,
      "cost_usd":3.84,
      "models":[],
      "windows":[
        {"window":"1w","since":"2026-08-26","sessions":3,"generated_tokens":120000,"cache_read_tokens":40000,"cost_usd":0.52,"models":[]},
        {"window":"30d","since":"2026-08-03","sessions":8,"generated_tokens":420000,"cache_read_tokens":140000,"cost_usd":1.71,"models":[]},
        {"window":"90d","since":"2026-06-04","sessions":14,"generated_tokens":760000,"cache_read_tokens":250000,"cost_usd":3.02,"models":[]},
        {"window":"all","since":null,"sessions":18,"generated_tokens":950000,"cache_read_tokens":310000,"cost_usd":3.84,"models":[]}
      ],
      "limitations":["Devin remains separate from ccusage totals."]
    }
    """.utf8
  )
  let summary = try JSONDecoder().decode(DevinUsageSummary.self, from: payload)

  #expect(summary.projection(for: .oneWeek).sessions == 3)
  #expect(summary.projection(for: .thirtyDays).generatedTokens == 420_000)
  #expect(summary.projection(for: .ninetyDays).cacheReadTokens == 250_000)
  #expect(summary.projection(for: .allTime).costUSD == 3.84)
}

@MainActor
@Test
func largeUsageReportDecodesAndRendersWithinTheNativeGate() throws {
  let agentNames = ["claude", "codex", "grok"]
  let sessionCount = 2_500
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0)!
  let today = calendar.startOfDay(for: Date())
  let dayFormatter = DateFormatter()
  dayFormatter.calendar = calendar
  dayFormatter.timeZone = calendar.timeZone
  dayFormatter.dateFormat = "yyyy-MM-dd"
  let monthFormatter = DateFormatter()
  monthFormatter.calendar = calendar
  monthFormatter.timeZone = calendar.timeZone
  monthFormatter.dateFormat = "yyyy-MM"
  let periods: [[String: Any]] = (0..<365).map { index in
    let agents: [[String: Any]] = agentNames.enumerated().map { offset, agent in
      let amount = UInt64((index + 1) * (offset + 1) * 100)
      return [
        "agent": agent,
        "totals": usageTotals(amount),
        "models": [
          [
            "model": "\(agent)-model-\(offset)",
            "totals": usageTotals(amount),
            "fallback": offset == 0,
            "priced": offset != 0,
          ]
        ],
      ]
    }
    return [
      "period": dayFormatter.string(
        from: calendar.date(byAdding: .day, value: index - 364, to: today)!
      ),
      "totals": usageTotals(UInt64((index + 1) * 600)),
      "agents": agents,
      "models": [],
    ]
  }
  let monthlyPeriods: [[String: Any]] = (0..<12).map { index in
    var period = periods[index * 30]
    period["period"] = monthFormatter.string(
      from: calendar.date(byAdding: .month, value: index - 11, to: today)!
    )
    return period
  }
  var sessions = [[String: Any]]()
  for index in 0..<sessionCount {
    let lastActivity = ISO8601DateFormatter().string(from: today)
    let session: [String: Any] = [
      "session_id": "session-\(index)",
      "agent": agentNames[index % agentNames.count],
      "last_activity": lastActivity,
      "reasoning_output_tokens": index,
      "totals": usageTotals(UInt64((index + 1) * 100)),
      "models": [],
    ]
    sessions.append(session)
  }
  let payload = try JSONSerialization.data(withJSONObject: [
    "status": "ready",
    "stale": false,
    "error": NSNull(),
    "provenance": [
      "engine": "ccusage",
      "version": "20.0.20",
      "generated_at": "2026-08-31T00:00:00Z",
      "timezone": "Asia/Kolkata",
      "window": "all",
      "detected_agents": agentNames,
      "excluded_agents": ["devin"],
      "codex_roots": ["/fixture/codex"],
      "source_fingerprint": "sha256:fixture",
      "pricing_complete": false,
      "fallback_models": ["claude-model-0"],
      "unpriced_models": ["claude-model-0"],
    ],
    "daily": periods,
    "weekly": Array(periods.suffix(52)),
    "monthly": monthlyPeriods,
    "sessions": sessions,
    "totals": usageTotals(39_718_066_020),
    "devin": [
      "status": "ready",
      "source": "CodeVetter SQLite · indexed Devin sessions.db",
      "sessions": 18,
      "generated_tokens": 950_000,
      "cache_read_tokens": 310_000,
      "output_tokens": 80_000,
      "cost_usd": 3.84,
      "models": [
        [
          "model": "glm-5.2",
          "sessions": 12,
          "generated_tokens": 720_000,
          "cache_read_tokens": 240_000,
          "cost_usd": 2.91,
        ],
        [
          "model": "devin-internal",
          "sessions": 6,
          "generated_tokens": 230_000,
          "cache_read_tokens": 70_000,
          "cost_usd": 0.93,
        ],
      ],
      "windows": [
        [
          "window": "1w",
          "since": "2026-08-26",
          "sessions": 4,
          "generated_tokens": 180_000,
          "cache_read_tokens": 62_000,
          "cost_usd": 0.71,
          "models": [],
        ],
        [
          "window": "30d",
          "since": "2026-08-03",
          "sessions": 9,
          "generated_tokens": 470_000,
          "cache_read_tokens": 155_000,
          "cost_usd": 1.92,
          "models": [
            [
              "model": "glm-5.2",
              "sessions": 7,
              "generated_tokens": 360_000,
              "cache_read_tokens": 118_000,
              "cost_usd": 1.47,
            ],
            [
              "model": "devin-internal",
              "sessions": 2,
              "generated_tokens": 110_000,
              "cache_read_tokens": 37_000,
              "cost_usd": 0.45,
            ],
          ],
        ],
        [
          "window": "90d",
          "since": "2026-06-04",
          "sessions": 15,
          "generated_tokens": 790_000,
          "cache_read_tokens": 260_000,
          "cost_usd": 3.21,
          "models": [],
        ],
        [
          "window": "all",
          "since": NSNull(),
          "sessions": 18,
          "generated_tokens": 950_000,
          "cache_read_tokens": 310_000,
          "cost_usd": 3.84,
          "models": [],
        ],
      ],
      "limitations": [
        "Devin remains separate from ccusage totals.",
        "This local history is not live quota telemetry.",
      ],
    ],
  ])

  for _ in 0..<10 {
    _ = try JSONDecoder().decode(LocalUsageReport.self, from: payload)
  }
  var decodeSamples = [UInt64]()
  for _ in 0..<100 {
    let started = DispatchTime.now().uptimeNanoseconds
    _ = try JSONDecoder().decode(LocalUsageReport.self, from: payload)
    decodeSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let model = WorkbenchModel()
  model.section = .usage
  model.usageReport = try JSONDecoder().decode(LocalUsageReport.self, from: payload)
  model.usageReportJSON = String(decoding: payload, as: UTF8.self)
  model.usageSelectedAgents = Set(agentNames)
  model.usageScale = .week
  model.providerQuotaReceipt = try JSONDecoder().decode(
    ProviderQuotaReceipt.self,
    from: Data(
      """
      {"schema_version":"codevetter.provider-quota/v1","generated_at":"2026-09-04T00:00:00Z","providers":[{"provider":"claude","status":"ready","source":"Claude Code /usage","checked_at":"2026-09-04T00:00:00Z","plan":"Claude Team","windows":[{"id":"current","label":"Current window","used_percent":12,"remaining_percent":88,"window_duration_minutes":null,"resets_at_unix":null,"reset_description":"2:20am"},{"id":"weekly","label":"Weekly window","used_percent":33,"remaining_percent":67,"window_duration_minutes":null,"resets_at_unix":null,"reset_description":"Sep 6 at 5:30pm"},{"id":"weekly_model_fable","label":"Fable weekly window","used_percent":4,"remaining_percent":96,"window_duration_minutes":null,"resets_at_unix":null,"reset_description":"Sep 6 at 5:30pm"}],"credits":{"used_percent":0,"remaining_percent":100,"used_amount":0,"limit_amount":150,"currency":"USD","reset_description":"Oct 1"},"reset_credits":null,"message":null},{"provider":"codex","status":"ready","source":"codex app-server account/rateLimits/read","checked_at":"2026-09-04T00:00:00Z","plan":"pro","windows":[{"id":"codex.primary","label":"Weekly window","used_percent":93,"remaining_percent":7,"window_duration_minutes":10080,"resets_at_unix":1788750854,"reset_description":null}],"credits":null,"reset_credits":null,"message":null}],"limitations":[]}
      """.utf8
    )
  )

  var projectionSamples = [UInt64]()
  for _ in 0..<20 {
    let started = DispatchTime.now().uptimeNanoseconds
    _ = UsageViewProjection(
      report: model.usageReport!,
      selectedAgents: model.usageSelectedAgents,
      window: model.usageWindow,
      scale: model.usageScale,
      referenceDate: today
    )
    projectionSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }
  _ = model.usageProjection(for: model.usageReport!)
  var cachedProjectionSamples = [UInt64]()
  for _ in 0..<500 {
    let started = DispatchTime.now().uptimeNanoseconds
    _ = model.usageProjection(for: model.usageReport!)
    cachedProjectionSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }
  let snapshotDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-usage-restore-benchmark-\(UUID().uuidString)")
  defer { try? FileManager.default.removeItem(at: snapshotDirectory) }
  let snapshotStore = UsageSnapshotStore(directory: snapshotDirectory)
  try snapshotStore.saveUsage(rawJSON: String(decoding: payload, as: UTF8.self))
  for _ in 0..<3 { _ = snapshotStore.restore() }
  var snapshotRestoreSamples = [UInt64]()
  for _ in 0..<20 {
    let started = DispatchTime.now().uptimeNanoseconds
    let restored = snapshotStore.restore()
    snapshotRestoreSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
    #expect(restored.usageReport?.sessions.count == sessionCount)
  }
  renderUsage(model)
  model.usageScale = .month
  renderUsage(model)
  model.usageScale = .day
  for _ in 0..<3 { renderUsage(model) }
  var renderSamples = [UInt64]()
  for _ in 0..<20 {
    let started = DispatchTime.now().uptimeNanoseconds
    renderUsage(model)
    renderSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let decodeP95 = percentile95(decodeSamples)
  let projectionP95 = percentile95(projectionSamples)
  let cachedProjectionP95 = percentile95(cachedProjectionSamples)
  let snapshotRestoreP95 = percentile95(snapshotRestoreSamples)
  let renderP95 = percentile95(renderSamples)
  if nativePerformanceGateEnabled() {
    #expect(decodeP95 < 30_000, "Large usage decoding must stay below 30 ms p95")
    #expect(projectionP95 < 50_000, "A cold Usage selection must stay below 50 ms p95")
    #expect(cachedProjectionP95 < 1_000, "A repeated Usage selection must stay below 1 ms p95")
    #expect(snapshotRestoreP95 < 50_000, "A saved Usage snapshot must restore below 50 ms p95")
    #expect(renderP95 < 50_000, "Large usage rendering must stay below 50 ms p95")
  }
  print(
    "NATIVE_USAGE_BENCHMARK_JSON "
      + "{\"decode_p95_us\":\(decodeP95),\"projection_p95_us\":\(projectionP95),"
      + "\"cached_projection_p95_us\":\(cachedProjectionP95),\"render_p95_us\":\(renderP95),"
      + "\"snapshot_restore_p95_us\":\(snapshotRestoreP95),"
      + "\"daily_periods\":365,\"sessions\":\(sessionCount),\"decode_samples\":100,\"render_samples\":20}"
  )

  if let screenshotPath = ProcessInfo.processInfo.environment["CODEVETTER_USAGE_SCREENSHOT_PATH"] {
    try captureUsage(
      model,
      at: URL(fileURLWithPath: screenshotPath),
      appearance: .darkAqua
    )
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_USAGE_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureUsage(
      model,
      at: URL(fileURLWithPath: screenshotPath),
      appearance: .aqua
    )
  }
}

@MainActor
@Test
func providerQuotaCollectionReturnsControlToTheUIImmediately() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-provider-quota-\(UUID().uuidString)", directoryHint: .isDirectory)
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }
  let executable = fixtureDirectory.appending(path: "codevetter")
  let receipt =
    #"{"schema_version":"codevetter.provider-quota/v1","generated_at":"2026-09-04T00:00:00Z","providers":[{"provider":"codex","status":"ready","source":"fixture","checked_at":"2026-09-04T00:00:00Z","plan":"pro","windows":[{"id":"codex.primary","label":"Weekly window","used_percent":25,"remaining_percent":75,"window_duration_minutes":10080,"resets_at_unix":null,"reset_description":null}],"credits":null,"reset_credits":null,"message":null}],"limitations":[]}"#
  try "#!/bin/sh\nsleep 0.25\nprintf '%s' '\(receipt)'\n".write(
    to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)

  let model = WorkbenchModel(runner: CodeVetterProcessRunner(executableURL: executable))
  let started = DispatchTime.now().uptimeNanoseconds
  model.loadProviderQuota()
  let returnLatencyMicroseconds = (DispatchTime.now().uptimeNanoseconds - started) / 1_000
  #expect(returnLatencyMicroseconds < 16_000, "Quota refresh must return within one frame")
  #expect(model.providerQuotaLoading)

  try await Task.sleep(for: .milliseconds(40))
  #expect(model.providerQuotaLoading, "The collector should still be running off the UI actor")
  while model.providerQuotaLoading {
    try await Task.sleep(for: .milliseconds(20))
  }
  #expect(model.providerQuotaReceipt?.providers.first?.windows.first?.remainingPercent == 75)
}

@MainActor
@Test
func everyTopLevelPageRendersInsideTheSharedWorkbenchGeometry() throws {
  let model = WorkbenchModel()
  let screenshotRoot = ProcessInfo.processInfo.environment["CODEVETTER_ALIGNED_PAGES_DIR"]
    .map { URL(fileURLWithPath: $0, isDirectory: true) }
  if let screenshotRoot {
    try FileManager.default.createDirectory(at: screenshotRoot, withIntermediateDirectories: true)
  }

  for section in WorkbenchSection.allCases {
    model.section = section
    renderUsage(model)
    if let screenshotRoot {
      let slug = section.rawValue.lowercased().replacingOccurrences(of: " ", with: "-")
      try captureWorkbench(
        model,
        at: screenshotRoot.appending(path: "\(slug)-1280.png"),
        appearance: .darkAqua
      )
      if section == .usage {
        for width in [390, 768, 1_440] {
          try captureWorkbench(
            model,
            at: screenshotRoot.appending(path: "usage-\(width).png"),
            appearance: .darkAqua,
            width: CGFloat(width),
            height: 900
          )
        }
      }
    }
  }
}

@MainActor
@Test
func performanceAdmissionInvalidatesWhenTheExactScopeChanges() throws {
  let model = WorkbenchModel()
  model.repositoryPath = "/fixture/repo"
  model.performanceTarget = "src/cart.test.ts"
  #expect(model.canPlanPerformance)
  #expect(!model.canDiagnosePerformance)

  let plan = try JSONDecoder().decode(
    PerformanceRunReceipt.self,
    from: Data(
      performanceFixtureReceipt(
        requestID: "perf-plan",
        operation: "plan",
        result:
          #"{"decision":{"status":"admitted","reason":"Admitted.","blockers":[]},"limitations":[]}"#
      ).utf8
    )
  )
  model.performancePlanReceipt = plan
  model.performancePlanScopeFingerprint = model.performanceScopeFingerprint
  #expect(model.canDiagnosePerformance)

  model.performanceSamples = 4
  #expect(!model.canDiagnosePerformance)
  model.performanceSamples = 3
  #expect(model.canDiagnosePerformance)

  let diagnosis = try JSONDecoder().decode(
    PerformanceRunReceipt.self,
    from: Data(
      performanceFixtureReceipt(
        requestID: "perf-diagnose",
        operation: "diagnose",
        result:
          #"{"diagnosis":{"summary":"Observed."},"verdict":{"status":"diagnosed"},"limitations":[]}"#
      ).utf8
    )
  )
  model.performanceResultReceipt = diagnosis
  #expect(!model.canVerifyPairedPerformance)
  model.performanceBaselineRepositoryPath = "/fixture/baseline"
  #expect(model.canVerifyPairedPerformance)
}

@MainActor
@Test
func recordedPerformanceRunInspectionIsClosedAndRendersCanonicalEvidence() throws {
  let model = WorkbenchModel()
  model.section = .performance
  model.repositoryPath = "/fixture/repo"
  #expect(model.performanceInspectionInputIssue != nil)
  model.performanceRecordedRunID = "Run_7"
  #expect(model.performanceInspectionInputIssue != nil)
  model.performanceRecordedRunID = "performance-run-7"
  #expect(model.canInspectPerformanceRun)
  #expect(PerformanceAdapter.allCases.contains(.goTest))

  let inspection = try JSONDecoder().decode(
    PerformanceRunReceipt.self,
    from: Data(
      performanceFixtureReceipt(
        requestID: "perf-inspect",
        operation: "inspect",
        result:
          #"{"receipt":{"schema_version":"runtime-performance-supervision/v1","run_id":"performance-run-7","state":"succeeded","subject":{"repository_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dirty":false},"scope":{"adapter":"go-test","target":"internal/checkout_test.go","name":"TestCheckout"},"policy":{"samples":5,"warmups":1,"timeout_ms":30000},"lifecycle":{"created_at":"2026-09-01T00:00:00Z","started_at":"2026-09-01T00:00:01Z","heartbeat_at":"2026-09-01T00:00:02Z","completed_at":"2026-09-01T00:00:03Z"},"child":{"pid":420,"exit_code":0,"signal":null},"result":{"path":".codevetter/performance-runs/performance-run-7/result.json","bytes":4096,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"failure":null,"capture":{"stdout_bytes":4096,"stderr_bytes":0,"truncated":false,"redaction_count":0},"limitations":["The receipt applies only to the recorded local workload."]},"result_summary":{"verdict":{"status":"measured"},"diagnosis":{"kind":"repository_cpu_candidate","summary":"Checkout allocation dominates the recorded workload."},"scope":{"adapter":"go-test","target":"internal/checkout_test.go","name":"TestCheckout"}}}"#
      ).utf8
    )
  )
  #expect(inspection.summary == "Recorded run performance-run-7 is succeeded.")
  model.performanceResultReceipt = inspection
  model.performanceResultReceiptJSON = "{\"fixture\":true}"
  renderPerformance(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_PERFORMANCE_INSPECTION_SCREENSHOT_PATH"
  ] {
    try capturePerformance(model, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test
func nativeScopeDiscoveryRendersAndAppliesTheCanonicalPerformanceCandidate() throws {
  let payload = Data(
    #"{"schema_version":1,"plan_id":"scope:fixture","repository_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dirty":false,"kind":"change","original_input":"main...HEAD","consumer":"performance","status":"ready","candidates":[{"id":"candidate:fixture","adapter":"vitest","target":"src/cart.test.ts","name":"updates totals","reason":"Changed source and runnable target overlap.","source_paths":["src/cart.ts"],"confidence_milli":875,"testing_supported":true,"performance_supported":true}],"uncovered_paths":["src/cart.ts"],"limitations":["Change scope is pinned."]}"#
      .utf8
  )
  let plan = try JSONDecoder().decode(EvidenceScopePlan.self, from: payload)
  let model = WorkbenchModel()
  model.section = .performance
  model.repositoryPath = "/fixture/repo"
  model.performanceScopeKind = .change
  model.performanceScopeValue = "main...HEAD"
  model.performanceDiscoveryPlan = plan
  let candidate = try #require(plan.candidates.first)
  model.applyPerformanceScopeCandidate(candidate)
  #expect(model.performanceAdapter == .vitest)
  #expect(model.performanceTarget == "src/cart.test.ts")
  #expect(model.performanceName == "updates totals")
  renderPerformance(model)
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_SCOPE_SCREENSHOT_PATH"
  ] {
    try capturePerformance(model, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test
func hundredRowPerformanceReceiptDecodesAndRendersWithinTheNativeGate() throws {
  let observed: [[String: Any]] = (0..<100).map { index in
    [
      "id": "evidence-\(index)",
      "kind": index.isMultiple(of: 2) ? "wall_time" : "runtime_source_context",
      "summary": "Observed evidence \(index)",
      "median_ms": Double(index) + 0.25,
      "samples": 3,
      "source": "src/flow-\(index).ts:\(index + 1)",
    ]
  }
  let planPayload = try JSONSerialization.data(withJSONObject: [
    "schema_version": 1,
    "request_id": "perf-render-plan",
    "operation": "plan",
    "state": "succeeded",
    "exit_code": 0,
    "duration_ms": 80,
    "result": [
      "schema_version": "performance-execution-plan/v1",
      "mode": "local_zero_egress",
      "limits": [
        "max_processes": 4,
        "max_external_requests": 0,
        "max_cost_microusd": 0,
      ],
      "decision": [
        "status": "admitted",
        "reason": "The exact workload is admitted.",
        "blockers": [],
      ],
      "limitations": ["Fixture admission only."],
    ],
    "stderr_summary": NSNull(),
    "cleanup": ["owned_process_reaped": true, "temporary_profiles_retained": false],
    "resources": [
      "sampler": "sysinfo_owned_process_tree",
      "sample_interval_ms": 75,
      "samples": 56,
      "peak_rss_bytes": 59_441_152,
      "peak_processes": 3,
      "limitations": [
        "RSS and process counts are periodic owned-process-tree samples; short-lived peaks between samples may be missed."
      ],
    ],
  ])
  let resultPayload = try JSONSerialization.data(withJSONObject: [
    "schema_version": 1,
    "request_id": "perf-render-diagnosis",
    "operation": "diagnose",
    "state": "succeeded",
    "exit_code": 0,
    "duration_ms": 4_200,
    "result": [
      "schema_version": "runtime-performance-diagnosis/v1",
      "diagnosis": ["summary": "Application work is concentrated in one bounded flow."],
      "observed": observed,
      "inferred": [["kind": "optimization_candidate", "summary": "Change one hotspot."]],
      "unverified": [["kind": "hypothesis", "summary": "Allocation pressure may fall."]],
      "verdict": ["status": "diagnosed"],
      "limitations": ["Fixture rendering only."],
    ],
    "stderr_summary": NSNull(),
    "cleanup": ["owned_process_reaped": true, "temporary_profiles_retained": false],
    "resources": [
      "sampler": "sysinfo_owned_process_tree",
      "sample_interval_ms": 75,
      "samples": 56,
      "peak_rss_bytes": 59_441_152,
      "peak_processes": 3,
      "limitations": [
        "RSS and process counts are periodic owned-process-tree samples; short-lived peaks between samples may be missed."
      ],
    ],
  ])

  for _ in 0..<10 {
    _ = try JSONDecoder().decode(PerformanceRunReceipt.self, from: resultPayload)
  }
  var decodeSamples = [UInt64]()
  for _ in 0..<100 {
    let started = DispatchTime.now().uptimeNanoseconds
    _ = try JSONDecoder().decode(PerformanceRunReceipt.self, from: resultPayload)
    decodeSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let model = WorkbenchModel()
  model.section = .performance
  model.repositoryPath = "/fixture/repo"
  model.performanceTarget = "src/flow.test.ts"
  model.performancePlanReceipt = try JSONDecoder().decode(
    PerformanceRunReceipt.self,
    from: planPayload
  )
  model.performancePlanReceiptJSON = String(decoding: planPayload, as: UTF8.self)
  model.performancePlanScopeFingerprint = model.performanceScopeFingerprint
  model.performanceResultReceipt = try JSONDecoder().decode(
    PerformanceRunReceipt.self,
    from: resultPayload
  )
  model.performanceResultReceiptJSON = String(decoding: resultPayload, as: UTF8.self)
  #expect(model.performanceResultReceipt?.resources?.peakRSSBytes == 59_441_152)
  #expect(model.performanceResultReceipt?.evidenceRows("observed").count == 100)
  #expect(percentile95((1...20).map { UInt64($0) }) == 19)
  model.performanceState = .completed

  for _ in 0..<3 { renderPerformance(model) }
  var renderSamples = [UInt64]()
  for _ in 0..<20 {
    let started = DispatchTime.now().uptimeNanoseconds
    renderPerformance(model)
    renderSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let decodeP95 = percentile95(decodeSamples)
  let renderP95 = percentile95(renderSamples)
  if nativePerformanceGateEnabled() {
    #expect(decodeP95 < 25_000, "100-row performance decoding must stay below 25 ms p95")
    #expect(renderP95 < 150_000, "100-row performance rendering must stay below 150 ms p95")
  }
  print(
    "NATIVE_PERFORMANCE_BENCHMARK_JSON "
      + "{\"decode_p95_us\":\(decodeP95),\"render_p95_us\":\(renderP95),"
      + "\"observed_rows\":100,\"decode_samples\":100,\"render_samples\":20}"
  )

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_PERFORMANCE_SCREENSHOT_PATH"
  ] {
    try capturePerformance(model, at: URL(fileURLWithPath: screenshotPath))
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_PERFORMANCE_LIGHT_SCREENSHOT_PATH"
  ] {
    try capturePerformance(
      model,
      at: URL(fileURLWithPath: screenshotPath),
      appearance: .aqua
    )
  }
}

@MainActor
@Test
func testingAdmissionRequiresARepositorySafePreviewAndExplicitConfirmation() {
  let model = WorkbenchModel()
  model.repositoryPath = "/fixture/repo"
  model.testingChange = "main...HEAD"
  model.testingPreviewURL = "https://preview.example.test"
  #expect(!model.canStartTesting)
  #expect(model.testingInputIssue?.contains("Confirm") == true)

  model.testingConfirmed = true
  #expect(model.canStartTesting)

  model.testingPreviewURL = "https://user:password@preview.example.test"
  #expect(!model.canStartTesting)
  #expect(model.testingInputIssue?.contains("without embedded credentials") == true)
}

@MainActor
@Test
func qaWorkspaceAppliesExactTargetWithoutCarryingNetworkConsent() throws {
  let payload = Data(
    """
    {
      "schema_version":"codevetter.qa-workspace/v1",
      "repo_path":"/fixture/repo",
      "preference_key":"native_testing_qa_workflows_v1_repo_fixture",
      "source":"native",
      "workflows":[{
        "id":"checkout","name":"Checkout confidence",
        "base_url":"https://preview.example.test","loop_id":"checkout",
        "runner_type":"repo_playwright","goal":"Complete checkout",
        "repo_spec_path":"tests/checkout.spec.ts","repo_trace_mode":"retain-on-failure",
        "target_route":"/checkout","allow_remote_target":true,
        "targets":[{"id":"guest","name":"Guest checkout","route":"/checkout/guest","goal":"Complete guest checkout"}],
        "updated_at":"2026-09-01T00:00:00Z","editable":true,"limitation":null
      }],
      "specs":[{"path":"tests/checkout.spec.ts","reason":"import"}],
      "post_fix":null,
      "limitations":["Preview consent remains explicit."]
    }
    """.utf8)
  let receipt = try JSONDecoder().decode(QaWorkspaceReceipt.self, from: payload)
  let model = WorkbenchModel()
  model.repositoryPath = "/fixture/repo"
  model.qaWorkspaceReceipt = receipt
  model.selectQaWorkflow("checkout")
  model.selectQaTarget("guest")
  model.testingConfirmed = true

  model.applyQaWorkflowToTesting()

  #expect(model.testingPreviewURL == "https://preview.example.test")
  #expect(model.testingTargetRoute == "/checkout/guest")
  #expect(model.testingTargetGoal == "Complete guest checkout")
  #expect(model.testingQaWorkflowName == "Checkout confidence")
  #expect(!model.testingConfirmed)

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_QA_WORKSPACE_SCREENSHOT_PATH"
  ] {
    model.showingQaWorkspace = true
    try captureQaWorkspace(model, at: URL(fileURLWithPath: screenshotPath))
  }
}

@MainActor
@Test
func postFixQaPreparationInvalidatesPriorProofAndConsent() throws {
  let payload = Data(
    """
    {
      "status":"needs_rerun","summary":"Run the prior journey again.",
      "before":{
        "id":"prior","created_at":"2026-09-01T00:00:00Z",
        "runner_type":"repo_playwright","base_url":"https://preview.example.test",
        "loop_id":"checkout","route":"/checkout/guest","goal":"Complete guest checkout",
        "pass":false,"duration_ms":920
      },
      "after":null
    }
    """.utf8)
  let preparation = try JSONDecoder().decode(QaPostFixPreparation.self, from: payload)
  let model = WorkbenchModel()
  model.testingConfirmed = true
  model.testingReceiptJSON = "stale proof"
  model.showingQaWorkspace = true

  model.applyPostFixQaPreparation(preparation)

  #expect(model.testingPreviewURL == "https://preview.example.test")
  #expect(model.testingTargetRoute == "/checkout/guest")
  #expect(model.testingTargetGoal == "Complete guest checkout")
  #expect(model.testingQaWorkflowName == "Post-fix rerun")
  #expect(!model.testingConfirmed)
  #expect(model.testingReceiptJSON.isEmpty)
  #expect(!model.showingQaWorkspace)
}

@Test
func supervisedOnboardingRunnerPreservesSecretSafeInspectAndCompletionAuthority() async throws {
  let fixtureDirectory = FileManager.default.temporaryDirectory
    .appending(path: "codevetter-onboarding-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: fixtureDirectory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: fixtureDirectory) }

  let executable = fixtureDirectory.appending(path: "codevetter")
  let argumentsFile = fixtureDirectory.appending(path: "arguments.txt")
  let inspect =
    #"{"schema_version":"codevetter.onboarding/v1","generated_at":"2026-09-01T00:00:00Z","operation":"inspect","completed":false,"completion_source":"shared_tauri_native_preference","default_adapter":"claude-code","tools":[{"id":"codex","label":"Codex CLI","available":true,"role":"Review work","authentication":"not_inspected"}],"limitations":["Credentials are not inspected."]}"#
  let complete =
    inspect
    .replacingOccurrences(of: #""operation":"inspect""#, with: #""operation":"complete""#)
    .replacingOccurrences(of: #""completed":false"#, with: #""completed":true"#)
    .replacingOccurrences(
      of: #""default_adapter":"claude-code""#, with: #""default_adapter":"codex""#)
  let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(argumentsFile.path)'
    case "$*" in
      *--complete*) printf '%s\n' '\(complete)' ;;
      *) printf '%s\n' '\(inspect)' ;;
    esac
    """
  try script.write(to: executable, atomically: true, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
  let runner = CodeVetterProcessRunner(executableURL: executable)

  let inspected = try await runner.loadOnboarding()
  let completed = try await runner.completeOnboarding(defaultAdapter: "codex")

  #expect(!inspected.completed)
  #expect(inspected.tools.allSatisfy { $0.authentication == "not_inspected" })
  #expect(completed.completed)
  #expect(completed.defaultAdapter == "codex")
  #expect(
    try String(contentsOf: argumentsFile, encoding: .utf8)
      == "onboarding --json\nonboarding --complete --default-adapter codex --json\n"
  )
}

@MainActor
@Test
func premiumOnboardingRendersEveryStepWithinItsNativeWindow() throws {
  let payload = Data(
    """
    {
      "schema_version":"codevetter.onboarding/v1",
      "generated_at":"2026-09-01T00:00:00Z","operation":"inspect",
      "completed":false,"completion_source":"shared_tauri_native_preference",
      "default_adapter":"codex",
      "tools":[
        {"id":"codex","label":"Codex CLI","available":true,"role":"Runs configured Codex review and fix work","authentication":"not_inspected"},
        {"id":"claude","label":"Claude Code CLI","available":false,"role":"Runs configured Claude review and fix work","authentication":"not_inspected"},
        {"id":"gh","label":"GitHub CLI","available":true,"role":"Supplies optional repository and pull-request access","authentication":"not_inspected"}
      ],
      "limitations":["Authentication and credentials are never inspected."]
    }
    """.utf8)
  let model = WorkbenchModel()
  model.onboardingReceipt = try JSONDecoder().decode(OnboardingReceipt.self, from: payload)
  model.onboardingDefaultAdapter = "codex"

  for step in 0..<4 {
    model.onboardingStep = step
    let host = NSHostingView(rootView: PremiumOnboardingView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 760, height: 600)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
    #expect(host.fittingSize.width <= 760)
    #expect(host.fittingSize.height <= 600)
    if step == 0,
      let path = ProcessInfo.processInfo.environment["CODEVETTER_ONBOARDING_SCREENSHOT_PATH"]
    {
      try captureHost(host, at: URL(fileURLWithPath: path))
    }
    if step == 2,
      let path = ProcessInfo.processInfo.environment["CODEVETTER_ONBOARDING_AGENT_SCREENSHOT_PATH"]
    {
      try captureHost(host, at: URL(fileURLWithPath: path))
    }
  }
}

@MainActor
@Test
func hundredJourneyTestingReceiptDecodesAndRendersWithinTheNativeGate() throws {
  let journeys: [[String: Any]] = (0..<100).map { index in
    [
      "loop_id": "journey-\(index)",
      "route": "/route-\(index)",
      "goal": "Verify route \(index)",
      "pass": !index.isMultiple(of: 9),
      "notes": "Bounded journey evidence \(index)",
      "screenshot_path": index.isMultiple(of: 9) ? "artifacts/failure-\(index).png" : NSNull(),
      "artifacts": index.isMultiple(of: 9) ? ["artifacts/trace-\(index).zip"] : [],
      "duration_ms": 20 + index,
      "trace": [
        "final_url": "https://preview.example.test/route-\(index)",
        "page_title": "Route \(index)",
        "console_errors": index.isMultiple(of: 9) ? ["Fixture console failure"] : [],
        "stage_timings_ms": ["load": Double(index) + 0.5],
        "runner_rss_bytes": 2_048 + index,
      ],
      "error": index.isMultiple(of: 9) ? "Fixture journey failed" : NSNull(),
      "runner_type": "chromiumoxide_builtin",
    ]
  }
  let routes: [[String: Any]] = (0..<6).map { index in
    ["route": "/route-\(index)", "reason": "Changed path \(index)"]
  }
  let payload = try JSONSerialization.data(withJSONObject: [
    "schema_version": 1,
    "run_id": "trex-performance-fixture",
    "repo_path": "/fixture/repo",
    "source": [
      "kind": "range",
      "input": "main...HEAD",
      "base_sha": String(repeating: "a", count: 40),
      "head_sha": String(repeating: "b", count: 40),
      "commits": [String(repeating: "b", count: 40)],
      "changed_paths": (0..<100).map { "src/route-\($0).tsx" },
    ],
    "preview": [
      "status": "verified",
      "requested_url": "https://preview.example.test",
      "final_url": "https://preview.example.test/",
      "revision": String(repeating: "b", count: 40),
      "evidence": "Revision header matched the resolved head.",
    ],
    "routes": routes,
    "journeys": journeys,
    "verdict": "failed",
    "summary": "Eighty-eight of one hundred bounded journeys passed.",
    "limitations": ["Fixture proves native decoding and rendering only."],
    "duration_ms": 2_500,
    "ran_at": "2026-08-31T00:00:00Z",
  ])

  for _ in 0..<10 {
    _ = try JSONDecoder().decode(TrexPreviewReceipt.self, from: payload)
  }
  var decodeSamples = [UInt64]()
  for _ in 0..<100 {
    let started = DispatchTime.now().uptimeNanoseconds
    _ = try JSONDecoder().decode(TrexPreviewReceipt.self, from: payload)
    decodeSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let receipt = try JSONDecoder().decode(TrexPreviewReceipt.self, from: payload)
  let model = WorkbenchModel()
  model.section = .testing
  model.testingReceipt = receipt
  model.testingReceiptJSON = String(decoding: payload, as: UTF8.self)
  model.testingState = .failed
  for _ in 0..<3 {
    renderTesting(model)
  }
  var renderSamples = [UInt64]()
  for _ in 0..<20 {
    let started = DispatchTime.now().uptimeNanoseconds
    renderTesting(model)
    renderSamples.append((DispatchTime.now().uptimeNanoseconds - started) / 1_000)
  }

  let decodeP95 = percentile95(decodeSamples)
  let renderP95 = percentile95(renderSamples)
  if nativePerformanceGateEnabled() {
    #expect(decodeP95 < 25_000, "100-journey receipt decoding must stay below 25 ms p95")
    #expect(renderP95 < 150_000, "100-journey receipt rendering must stay below 150 ms p95")
  }
  print(
    "NATIVE_TESTING_BENCHMARK_JSON "
      + "{\"decode_p95_us\":\(decodeP95),\"render_p95_us\":\(renderP95),"
      + "\"journeys\":100,\"changed_paths\":100,\"decode_samples\":100,\"render_samples\":20}"
  )

  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_TESTING_SCREENSHOT_PATH"
  ] {
    try captureTesting(model, at: URL(fileURLWithPath: screenshotPath))
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_TESTING_LIGHT_SCREENSHOT_PATH"
  ] {
    try captureTesting(
      model,
      at: URL(fileURLWithPath: screenshotPath),
      appearance: .aqua
    )
  }
  if let screenshotPath = ProcessInfo.processInfo.environment[
    "CODEVETTER_TESTING_SETUP_SCREENSHOT_PATH"
  ] {
    // The owner-review packet also captures the default low-density setup state
    // that precedes any receipt: source, exact change, preview, and consent.
    let setup = WorkbenchModel()
    setup.section = .testing
    setup.repositoryPath = "/fixture/repo"
    setup.testingChange = "main...HEAD"
    setup.testingPreviewURL = "https://preview.example.test"
    try captureTesting(setup, at: URL(fileURLWithPath: screenshotPath))
  }
}
