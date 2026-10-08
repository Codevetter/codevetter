import AppKit
import Foundation
import SwiftUI
import Testing

@testable import CodeVetterFeature

@MainActor @Suite struct InvocationLedgerTests {
  private func fixture(count: Int = 2, offset: Int = 0, total: Int? = nil) throws -> Data {
    let rows = (0..<count).map { index -> [String: Any] in
      [
        "invocation_id": String(format: "00000000-0000-4000-8000-%012d", index + offset),
        "skill": "codevetter-testing", "repo_path": "/fixture/repository",
        "task_id": "11111111-1111-4111-8111-111111111111",
        "parent_invocation_id": NSNull(), "command": "qa", "operation": "run",
        "agent": "codex", "provider": NSNull(),
        "started_at": "2026-10-08T07:00:00Z", "finished_at": "2026-10-08T07:00:01Z",
        "duration_ms": 1000, "context_capture_ms": NSNull(), "state": "completed",
        "exit_code": 0, "cli_exit_code": 0,
        "receipt_path": "/informational/receipt.json",
        "receipt_sha256": String(repeating: "a", count: 64),
        "receipt_integrity": "hash_matched", "assessment": "helped",
        "independently_verified_benefit": NSNull(),
        "usefulness": [
          "outcome": "helped", "provenance": "agent_reported",
          "independently_verified": false, "measured_cost_usd": NSNull(),
        ],
      ]
    }
    return try JSONSerialization.data(withJSONObject: [
      "schema_version": "codevetter.invocation-events/v1", "total": total ?? count,
      "offset": offset, "limit": 100, "invocations": rows,
      "unreadable_records": 1, "unattributed_records": 2, "unreadable_assessments": 3,
      "evidence_origin": "synthetic_fixture", "ingestion_issues": [],
      "unattributed_ingestion_issues": [],
      "limitations": ["Synthetic contract fixture; no independently measured benefit."],
    ])
  }

  private func model() -> InvocationRunsModel {
    InvocationRunsModel(
      runner: CodeVetterProcessRunner(executableURL: URL(fileURLWithPath: "/usr/bin/false")))
  }

  @Test func unknownProviderAndBenefitRemainUnknownDespiteHelpedAndMatchedHash() throws {
    let receipt = try InvocationLedgerReceipt.decode(fixture())
    let row = try #require(receipt.invocations.first)
    #expect(row.assessment == "helped")
    #expect(row.receiptIntegrity == "hash_matched")
    #expect(row.provider == nil)
    #expect(row.independentlyVerifiedBenefit == nil)
    #expect(row.usefulness?.independentlyVerified == false)
    #expect(receipt.unattributedRecords == 2)
  }

  @Test func truncatedDuplicateAndUnknownSchemaReceiptsAreRejected() throws {
    let data = try fixture()
    for mutation in ["schema", "duplicate", "truncated", "negative"] {
      var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
      if mutation == "schema" { object["schema_version"] = "codevetter.invocation-events/v999" }
      if mutation == "negative" { object["total"] = -1 }
      if mutation == "truncated" { object["total"] = 101 }
      if mutation == "duplicate" {
        let rows = try #require(object["invocations"] as? [[String: Any]])
        object["invocations"] = [rows[0], rows[0]]
      }
      let altered = try JSONSerialization.data(withJSONObject: object)
      #expect(throws: (any Error).self) { try InvocationLedgerReceipt.decode(altered) }
    }
  }

  @Test func filtersAndPaginationAreSentToRustAsLiteralArguments() throws {
    var query = InvocationLedgerQuery(ledgerPath: "/explicit ledger/$(literal)")
    query.repositoryPath = "/fixture/repository"
    query.taskID = "11111111-1111-4111-8111-111111111111"
    query.skill = "codevetter-testing"
    query.state = "completed"
    query.assessment = "helped"
    query.offset = 200
    #expect(
      try query.arguments() == [
        "runs", "--ledger", "/explicit ledger/$(literal)", "--json",
        "--offset", "200", "--limit", "100", "--repo", "/fixture/repository",
        "--task-id", query.taskID, "--skill", "codevetter-testing", "--state", "completed",
        "--assessment", "helped",
      ])
    query.taskID = "not-a-uuid"
    #expect(throws: (any Error).self) { try query.arguments() }
    query.taskID = ""
    query.repositoryPath = ""
    #expect(throws: (any Error).self) { try query.arguments() }
  }

  @Test func mismatchedRepositoryTaskFilterAndPageNeverEnterTheModel() throws {
    for field in ["repository", "task", "skill", "state", "assessment", "offset"] {
      let model = model()
      var query = InvocationLedgerQuery(ledgerPath: "/fixture/ledger")
      switch field {
      case "repository": query.repositoryPath = "/different"
      case "task": query.taskID = "22222222-2222-4222-8222-222222222222"
      case "skill": query.skill = "codevetter-review"
      case "state": query.state = "failed"
      case "assessment": query.assessment = "blocked"
      default: query.offset = 100
      }
      #expect(throws: (any Error).self) { try model.apply(fixture(), query: query) }
      #expect(model.receipt == nil)
    }
  }

  @Test func laterPageAndKeyboardSelectionPreserveExactIdentity() throws {
    let model = model()
    var query = InvocationLedgerQuery(ledgerPath: "/fixture/ledger")
    query.offset = 200
    try model.apply(fixture(count: 2, offset: 200, total: 202), query: query)
    #expect(model.receipt?.offset == 200)
    #expect(model.selectedID?.hasSuffix("000000000200") == true)
    model.moveSelection(by: 1)
    #expect(model.selectedID?.hasSuffix("000000000201") == true)
    model.moveSelection(by: 1)
    #expect(model.selectedID?.hasSuffix("000000000201") == true)
    model.selectedID = "missing"
    #expect(model.selectedInvocation == nil)
  }

  @Test func reloadClearsOldEvidenceBeforeAChangedScopeCanBeDisplayed() throws {
    let model = model()
    try model.apply(fixture(), query: model.query)
    #expect(model.receipt != nil)
    model.query.ledgerPath = ""
    model.load()
    #expect(model.receipt == nil)
    #expect(model.receiptData == nil)
    #expect(model.selectedID == nil)
    #expect(!model.loading)
  }

  @Test func editingATaskDoesNotPageAnUnappliedFilter() throws {
    let model = model()
    try model.apply(fixture(count: 100, total: 200), query: model.query)
    model.query.taskID = "22222222-2222-4222-8222-222222222222"
    #expect(model.hasUnappliedTask)
    model.page(by: 1)
    #expect(model.query.offset == 0)
    #expect(model.receipt?.invocations.count == 100)
  }

  @Test func receiptFieldViewRetainsFalseAndRejectsChangedIdentityHashOrPointer() throws {
    let event = try #require(InvocationLedgerReceipt.decode(fixture()).invocations.first)
    var object: [String: Any] = [
      "schema_version": "codevetter.invocation-receipt/v1",
      "invocation_id": event.id, "repo_path": event.repoPath,
      "receipt_sha256": try #require(event.receiptSHA256), "json_pointer": "/passed",
      "value": false, "evidence_origin": "synthetic_fixture", "limitations": ["Integrity only"],
    ]
    let data = try JSONSerialization.data(withJSONObject: object)
    #expect(
      try InvocationReceiptInspection.decode(data, event: event, pointer: "/passed").valueText
        == "false")
    for key in ["invocation_id", "repo_path", "receipt_sha256", "json_pointer"] {
      var changed = object
      changed[key] = "changed"
      #expect(throws: (any Error).self) {
        try InvocationReceiptInspection.decode(
          JSONSerialization.data(withJSONObject: changed), event: event, pointer: "/passed")
      }
    }
    object["json_pointer"] = true
    #expect(throws: (any Error).self) {
      try InvocationReceiptInspection.decode(
        JSONSerialization.data(withJSONObject: object), event: event, pointer: nil)
    }
  }

  @Test func largeReceiptFieldIsExplicitlyClippedForDisplay() throws {
    let event = try #require(InvocationLedgerReceipt.decode(fixture()).invocations.first)
    let object: [String: Any] = [
      "schema_version": "codevetter.invocation-receipt/v1",
      "invocation_id": event.id, "repo_path": event.repoPath,
      "receipt_sha256": try #require(event.receiptSHA256), "json_pointer": NSNull(),
      "value": String(repeating: "x", count: 32 * 1024), "evidence_origin": "synthetic_fixture",
      "limitations": [],
    ]
    let view = try InvocationReceiptInspection.decode(
      JSONSerialization.data(withJSONObject: object), event: event, pointer: nil)
    #expect(view.displayTruncated)
    #expect(view.valueText.utf8.count == 16 * 1024)
  }

  @Test func invocationLedgerRendersOffscreenAtThreeWindowWidthsAndBothAppearances() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("../../../../../artifacts/invocation-runs-review").standardizedFileURL
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    for dark in [true, false] {
      for width in [980, 1180, 1380] {
        let model = model()
        model.query.ledgerPath = "/fixture/explicit-recorder"
        try model.apply(fixture(), query: model.query)
        let host = NSHostingView(
          rootView:
            PremiumInvocationRunsView(ledger: model, repositoryPath: "/fixture/repository")
            .preferredColorScheme(dark ? .dark : .light))
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        host.frame = NSRect(x: 0, y: 0, width: width, height: 640)
        host.layoutSubtreeIfNeeded()
        host.displayIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let data = try #require(bitmap.representation(using: .png, properties: [:]))
        try data.write(
          to: root.appendingPathComponent("ledger-\(width)-\(dark ? "dark" : "light").png"))
        #expect(host.window == nil)
      }
    }
  }
}
