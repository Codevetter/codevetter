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
    .appending(path: "apps/desktop/src-tauri/tests/fixtures/surface-parity/\(name).json")
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
  model.section = .capabilities
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

  #expect(WorkbenchSection.allCases.count == 8)
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
      == "check --repo /fixture/repo --range main...HEAD --task Preserve output --spec docs/output.md --requirement output-stable --preflight --json"
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
      == "check --request-id \(requestID) --repo \(repositoryPath) --range \(change) --task \(task) --progress-json --json"
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
  for _ in 0..<40 where !FileManager.default.fileExists(atPath: marker.path) {
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(FileManager.default.fileExists(atPath: marker.path))
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
  #expect(decodeP95 < 40_000, "Large Repo Unpack decoding must stay below 40 ms p95")
  #expect(renderP95 < 150_000, "Large Repo Unpack rendering must stay below 150 ms p95")
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
      "current"
    ])
  #expect(
    report.sessions(for: selected, window: .thirtyDays, referenceDate: reference).map(\.sessionID)
      == ["current", "month"])
  #expect(report.sessions(for: selected, window: .allTime, referenceDate: reference).count == 4)
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
  for index in 0..<100 {
    let lastActivity = String(
      format: "2026-08-31T00:%02d:%02dZ",
      index / 60,
      index % 60
    )
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
  let renderP95 = percentile95(renderSamples)
  #expect(decodeP95 < 25_000, "Large usage decoding must stay below 25 ms p95")
  #expect(renderP95 < 150_000, "Large usage rendering must stay below 150 ms p95")
  print(
    "NATIVE_USAGE_BENCHMARK_JSON "
      + "{\"decode_p95_us\":\(decodeP95),\"render_p95_us\":\(renderP95),"
      + "\"daily_periods\":365,\"sessions\":100,\"decode_samples\":100,\"render_samples\":20}"
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
  #expect(decodeP95 < 25_000, "100-row performance decoding must stay below 25 ms p95")
  #expect(renderP95 < 150_000, "100-row performance rendering must stay below 150 ms p95")
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
  #expect(decodeP95 < 25_000, "100-journey receipt decoding must stay below 25 ms p95")
  #expect(renderP95 < 150_000, "100-journey receipt rendering must stay below 150 ms p95")
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
}

private func resolveNativeColor(_ color: NSColor, in appearance: NSAppearance) -> NSColor? {
  var resolved: NSColor?
  appearance.performAsCurrentDrawingAppearance {
    resolved = color.usingColorSpace(.sRGB) ?? color
  }
  return resolved
}

private func nativeContrastRatio(_ foreground: NSColor, against backgroundHex: UInt32) -> Double {
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

private func nativeRelativeLuminance(_ color: NSColor) -> Double {
  func linearize(_ component: CGFloat) -> Double {
    let value = Double(component)
    return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linearize(color.redComponent)
    + 0.7152 * linearize(color.greenComponent)
    + 0.0722 * linearize(color.blueComponent)
}

private final class LockedProgress: @unchecked Sendable {
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
  #expect(decodeP95 < 25_000, "100-run decoding must stay below 25 ms p95")
  #expect(renderP95 < 150_000, "100-run/100-response host rendering must stay below 150 ms p95")
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
private func renderLedger(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderCapabilities(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func captureCapabilities(_ model: WorkbenchModel, at destination: URL) throws {
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
private func captureLedger(
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
private func renderReview(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    _ = host.fittingSize
  }
}

@MainActor
private func renderReviewProof(_ evidence: PerformanceJSONValue) {
  autoreleasepool {
    let host = NSHostingView(rootView: ReviewProofMapView(evidence: evidence))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 760, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderReviewIntent(_ evidence: PerformanceJSONValue) {
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
private func renderXray(_ model: WorkbenchModel, receipt: VerificationReceipt) {
  autoreleasepool {
    let host = NSHostingView(rootView: XrayExportView(model: model, receipt: receipt))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 860, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderFixPacket(_ model: WorkbenchModel, receipt: VerificationReceipt) {
  autoreleasepool {
    let host = NSHostingView(rootView: AgentFixPacketView(model: model, receipt: receipt))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 860, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderTesting(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderWarmVerification(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWarmVerificationView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_100, height: 720)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderDifferential(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumDifferentialVerificationView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_100, height: 720)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderScenarioCompiler(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumScenarioCompilerView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_180, height: 760)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderTrexWatcher(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumTrexWatcherView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_180, height: 760)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderPerformance(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderUsage(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 980, height: 640)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderUnpack(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func renderUnpackQuery(_ model: WorkbenchModel) {
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
private func renderSettings(_ model: WorkbenchModel) {
  autoreleasepool {
    let host = NSHostingView(rootView: PremiumWorkbenchRootView(model: model))
    host.appearance = NSAppearance(named: .darkAqua)
    host.frame = NSRect(x: 0, y: 0, width: 1_280, height: 800)
    host.layoutSubtreeIfNeeded()
    host.displayIfNeeded()
  }
}

@MainActor
private func captureSettings(
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
private func captureHost<Content: View>(_ host: NSHostingView<Content>, at destination: URL) throws
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
private func captureUnpack(
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
private func captureUnpackQuery(
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
private func captureUsage(
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
private func capturePerformance(
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
private func captureReview(
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
private func captureReviewProof(_ evidence: PerformanceJSONValue, at destination: URL) throws {
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
private func captureReviewIntent(_ evidence: PerformanceJSONValue, at destination: URL) throws {
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
private func captureXray(
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
private func captureFixPacket(
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
private func captureTesting(
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
private func captureQaWorkspace(_ model: WorkbenchModel, at destination: URL) throws {
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
private func captureWarmVerification(_ model: WorkbenchModel, at destination: URL) throws {
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
private func captureDifferential(_ model: WorkbenchModel, at destination: URL) throws {
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
private func captureScenarioCompiler(_ model: WorkbenchModel, at destination: URL) throws {
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
private func captureTrexWatcher(_ model: WorkbenchModel, at destination: URL) throws {
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

private func percentile95(_ values: [UInt64]) -> UInt64 {
  let ordered = values.sorted()
  return ordered[min(ordered.count * 95 / 100, ordered.count - 1)]
}

private func unpackFixturePayload(
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

private func nativeSettingsFixtureReceipt(
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

private func opsStatusFixtureReceipt(windowDays: Int) throws -> Data {
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

private func mcpSettingsFixtureReceipt(
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

private func historyRootsFixtureReceipt(
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

private func sessionRetentionFixtureReceipt(operation: String) throws -> Data {
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

private func memoryFixtureReceipt(operation: String) throws -> Data {
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

private func rubricFixtureReceipt(
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

private func performanceFixtureReceipt(
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

private func warmVerificationFixture() -> String {
  let hashA = String(repeating: "a", count: 64)
  let hashB = String(repeating: "b", count: 64)
  let sha = String(repeating: "c", count: 40)
  return """
    {"id":"stored-warm-fixture","repo_path":"/fixture/repo","created_at":"2026-09-01T00:00:01Z","result":{"schema_version":1,"protocol_version":1,"run_id":"native-warm-fixture","outcome":"passed","started_at":"2026-09-01T00:00:00Z","finished_at":"2026-09-01T00:00:01Z","warm":true,"stale":false,"model_call_count":0,"source":{"target_sha":"\(sha)","change_set_kind":"worktree","change_set_identity":"\(hashA)","config_hash":"\(hashB)","manifest_hash":"\(hashA)","source_hash_before":"\(hashA)","source_hash_after":"\(hashA)"},"observation_policy":{"schema_version":1,"profile_id":"read-only-browser-v1"},"selection":{"changed_paths":["src/checkout.tsx"],"selected_scenario_ids":["checkout-smoke"],"mandatory_smoke_ids":["checkout-smoke"],"fallback_scenario_ids":[],"complete":true,"explanation":"The checkout path selected its declared smoke scenario."},"scenarios":[{"scenario_id":"checkout-smoke","outcome":"passed","duration_ms":184.5}],"timings":[{"stage":"total","duration_ms":212.0}],"observations":[{"id":"observation-1","scenario_id":"checkout-smoke","kind":"accessibility_smoke","disposition":"passed","policy_id":"read-only-browser-v1","message":"Checkout controls retained accessible labels.","occurred_at":"2026-09-01T00:00:00Z"}],"limitations":[{"code":"other","message":"Fixture proves native decoding and rendering only.","affects_confidence":false}],"artifacts":[{"id":"artifact-1","kind":"screenshot","relative_path":"artifacts/warm/checkout.png","sha256":"\(hashB)","bytes":2048,"redacted":true,"created_at":"2026-09-01T00:00:00Z","retained_until":"2026-09-08T00:00:00Z","scenario_id":"checkout-smoke"}],"cancellation":{"state":"not_requested"}}}
    """
}

private func differentialPreparedFixture() -> String {
  """
  {"schema_version":1,"run_id":"native-diff-fixture","status":"ready","reference_sha":"\(String(repeating: "a", count: 40))","candidate_kind":"range","candidate_identity":"\(String(repeating: "b", count: 64))","selection_identity":"\(String(repeating: "c", count: 64))","scenario_count":2,"source_cache_hits":1,"dependency_cache_hit":true,"prepared_bytes":4096,"reason_codes":[],"model_call_count":0,"cleanup_complete":false}
  """
}

private func differentialStoredFixture() -> String {
  """
  {"id":"stored-diff-fixture","repo_path":"/fixture/repo","created_at":"2026-09-01T00:00:01Z","summary":{"schema_version":1,"run_id":"native-diff-fixture","status":"complete","classification":"regressed","plan_identity":"\(String(repeating: "d", count: 64))","reference_sha":"\(String(repeating: "a", count: 40))","candidate_kind":"range","candidate_identity":"\(String(repeating: "b", count: 64))","scenario_count":2,"delta_count":1,"blocking_delta_count":1,"delta_previews":[{"id":"delta-1","scenario_id":"checkout-smoke","kind":"assertion","direction":"candidate_only","blocking":true,"policy_id":"paired-browser-v1"}],"delta_previews_truncated":false,"reason_codes":["candidate_regression"],"comparison_policy_identities":["paired-browser-v1"],"duration_ms":284.5,"cleanup_complete":true,"creates_pass_evidence":false,"model_call_count":0}}
  """
}

private func scenarioCompilerFixture(action: String) -> String {
  let hash = String(repeating: "a", count: 64)
  let sha = String(repeating: "b", count: 40)
  return """
    {"schema_version":1,"action":"\(action)","status":"ok","message":"Candidate validated and dry-run passed.","candidate":{"schema_version":1,"candidate_id":"candidate-fixture","candidate_hash":"\(hash)","cache_key":"\(hash)","status":"candidate","created_at":"2026-09-01T00:00:00Z","expires_at":"2026-09-02T00:00:00Z","spec_source_path":"docs/checkout.md","spec_section":"Checkout","spec_hash":"\(hash)","target_sha":"\(sha)","config_hash":"\(hash)","manifest_hash":"\(hash)","provider":{"kind":"local_command","provider":"local","model":"qwen2.5-coder:7b","cost_class":"free","paid_approved":false},"provider_duration_ms":240,"cache_hit":false,"usage":{"input_tokens":120,"output_tokens":80,"estimated_cost_usd":0,"actual_cost_usd":0},"unresolved_requirements":[],"validation":{"qualified":true,"issues":[]},"dry_run":{"status":"passed","duration_ms":180,"summary":"Scenario ran without writes.","diagnostics":[],"evidence_persisted":false,"baselines_updated":false},"files":[{"kind":"scenario","destination":".codevetter/scenarios/checkout.yaml","sha256":"\(hash)","replaces_existing":true,"diff":"+ id: checkout-smoke\\n+ route: /checkout"},{"kind":"provenance","destination":".codevetter/provenance/checkout.json","sha256":"\(hash)","replaces_existing":false,"diff":"+ {\\\"source\\\":\\\"docs/checkout.md\\\"}"}],"accepted_file_hashes":{}},"candidates":[],"cleanup":null}
    """
}

private func trexWatcherFixture(operation: String) -> String {
  let headA = String(repeating: "a", count: 40)
  let headB = String(repeating: "b", count: 40)
  return """
    {"schema_version":1,"operation":"\(operation)","watcher":{"repo_path":"/fixture/repo","interval_secs":300,"enabled":true,"base_branch":"main","last_polled_at":"2026-09-01 00:05:00","last_error":null,"created_at":"2026-09-01 00:00:00"},"watchers":[],"runs":[{"id":"watcher-run-fixture","repo_path":"/fixture/repo","pr_number":42,"head_sha":"\(headA)","verdict":"APPROVE","confidence":0.97,"summary":"Checkout and receipt journeys passed in the isolated PR worktree.","status_state":"success","status_error":null,"duration_ms":1842,"ran_at":"2026-09-01T00:05:02Z"},{"id":"watcher-run-limited","repo_path":"/fixture/repo","pr_number":39,"head_sha":"\(headB)","verdict":"NEEDS_REVIEW","confidence":0.61,"summary":"Runtime checks completed, but one browser observation needs maintainer review.","status_state":"pending","status_error":"GitHub status remained pending while evidence was retained.","duration_ms":2310,"ran_at":"2026-09-01T00:02:00Z"}],"inspected_prs":4,"skipped_unchanged":2,"message":"Inspected 4 open PR(s); completed 2 new run(s); skipped 2 unchanged."}
    """
}

private func usagePeriod(
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

private func usageSession(
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

private func localUsageTotals(_ generated: UInt64) -> LocalUsageTotals {
  LocalUsageTotals(
    inputTokens: generated / 2,
    cacheCreationTokens: generated / 4,
    cacheReadTokens: generated * 2,
    outputTokens: generated - generated / 2 - generated / 4,
    totalTokens: generated * 3,
    costUSD: Double(generated) / 100_000
  )
}

private func usageTotals(_ generated: UInt64) -> [String: Any] {
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
