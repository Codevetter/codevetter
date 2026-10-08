import Foundation
import Observation

public struct InvocationEvent: Decodable, Identifiable, Sendable {
  public let invocationID: String
  public let skill: String
  public let repoPath: String
  public let taskID: String?
  public let parentInvocationID: String?
  public let command: String
  public let operation: String?
  public let agent: String?
  public let provider: String?
  public let startedAt: String
  public let finishedAt: String?
  public let durationMS: UInt64?
  public let contextCaptureMS: UInt64?
  public let state: String
  public let exitCode: Int?
  public let cliExitCode: Int?
  public let receiptPath: String?
  public let receiptSHA256: String?
  public let receiptIntegrity: String
  public let assessment: String
  public let independentlyVerifiedBenefit: Bool?
  public let usefulness: InvocationUsefulness?
  public var id: String { invocationID }

  enum CodingKeys: String, CodingKey {
    case invocationID = "invocation_id"
    case skill
    case repoPath = "repo_path"
    case taskID = "task_id"
    case parentInvocationID = "parent_invocation_id"
    case command, operation
    case agent, provider
    case startedAt = "started_at"
    case finishedAt = "finished_at"
    case durationMS = "duration_ms"
    case contextCaptureMS = "context_capture_ms"
    case state
    case exitCode = "exit_code"
    case cliExitCode = "cli_exit_code"
    case receiptPath = "receipt_path"
    case receiptSHA256 = "receipt_sha256"
    case receiptIntegrity = "receipt_integrity"
    case assessment, usefulness
    case independentlyVerifiedBenefit = "independently_verified_benefit"
  }
}

public struct InvocationUsefulness: Decodable, Sendable {
  public let outcome: String
  public let provenance: String
  public let independentlyVerified: Bool
  public let measuredCostUSD: Double?
  enum CodingKeys: String, CodingKey {
    case outcome, provenance
    case independentlyVerified = "independently_verified"
    case measuredCostUSD = "measured_cost_usd"
  }
}

public struct InvocationIngestionIssue: Decodable, Sendable {
  public let invocationID: String?
  public let code: String
  enum CodingKeys: String, CodingKey {
    case invocationID = "invocation_id"
    case code
  }
}

public struct InvocationLedgerReceipt: Decodable, Sendable {
  public let schemaVersion: String
  public let total: Int
  public let offset: Int
  public let limit: Int
  public let invocations: [InvocationEvent]
  public let unreadableRecords: Int
  public let unattributedRecords: Int
  public let unreadableAssessments: Int
  public let limitations: [String]
  public let evidenceOrigin: String
  public let ingestionIssues: [InvocationIngestionIssue]
  public let unattributedIngestionIssues: [InvocationIngestionIssue]

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case total, offset, limit, invocations, limitations
    case unreadableRecords = "unreadable_records"
    case unattributedRecords = "unattributed_records"
    case unreadableAssessments = "unreadable_assessments"
    case evidenceOrigin = "evidence_origin"
    case ingestionIssues = "ingestion_issues"
    case unattributedIngestionIssues = "unattributed_ingestion_issues"
  }

  static func decode(_ data: Data) throws -> Self {
    let receipt = try JSONDecoder().decode(Self.self, from: data)
    guard receipt.schemaVersion == "codevetter.invocation-events/v1",
      receipt.total >= 0, receipt.offset >= 0, (1...100).contains(receipt.limit),
      receipt.invocations.count <= receipt.limit,
      receipt.invocations.count == min(receipt.limit, max(0, receipt.total - receipt.offset)),
      receipt.unreadableRecords >= 0, receipt.unattributedRecords >= 0,
      receipt.unreadableAssessments >= 0,
      Set(receipt.invocations.map(\.id)).count == receipt.invocations.count,
      ["synthetic_fixture", "unqualified_local_ledger"].contains(receipt.evidenceOrigin)
    else {
      throw VerificationRunnerError.invalidReceipt("Unsupported or inconsistent invocation ledger.")
    }
    return receipt
  }
}

public struct InvocationLedgerQuery: Equatable, Sendable {
  public var ledgerPath: String
  public var repositoryPath: String?
  public var taskID = ""
  public var skill = ""
  public var state = ""
  public var assessment = ""
  public var offset = 0
  public let limit = 100

  func arguments() throws -> [String] {
    guard !ledgerPath.isEmpty, offset >= 0, repositoryPath != "",
      taskID.isEmpty || UUID(uuidString: taskID)?.uuidString.lowercased() == taskID
    else {
      throw VerificationRunnerError.invalidReceipt("Select a ledger and use a canonical task UUID.")
    }
    var arguments = [
      "runs", "--ledger", ledgerPath, "--json", "--offset", String(offset),
      "--limit", String(limit),
    ]
    for (flag, value) in [
      ("--repo", repositoryPath ?? ""), ("--task-id", taskID),
      ("--skill", skill), ("--state", state), ("--assessment", assessment),
    ] where !value.isEmpty {
      arguments += [flag, value]
    }
    return arguments
  }
}

public struct InvocationReceiptInspection: Sendable {
  public let jsonPointer: String?
  public let valueText: String
  public let displayTruncated: Bool
  public let limitations: [String]

  static func decode(_ data: Data, event: InvocationEvent, pointer: String?) throws -> Self {
    guard data.count <= 2 * 1024 * 1024 + 64 * 1024,
      let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      root["schema_version"] as? String == "codevetter.invocation-receipt/v1",
      root["invocation_id"] as? String == event.id,
      root["repo_path"] as? String == event.repoPath,
      let expectedHash = event.receiptSHA256,
      root["receipt_sha256"] as? String == expectedHash,
      root.keys.contains("json_pointer"),
      pointer == nil ? root["json_pointer"] is NSNull : root["json_pointer"] as? String == pointer,
      let origin = root["evidence_origin"] as? String,
      ["synthetic_fixture", "unqualified_local_ledger"].contains(origin),
      let value = root["value"], let limitations = root["limitations"] as? [String]
    else {
      throw VerificationRunnerError.invalidReceipt(
        "Receipt identity, scope, pointer or hash changed. Refresh the ledger before inspecting it."
      )
    }
    // Compact rendering avoids pathological pretty-print indentation. Preserve the
    // full canonical response bytes separately for export, even when display clips.
    let text = try JSONSerialization.data(
      withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    return Self(
      jsonPointer: pointer, valueText: String(decoding: text.prefix(16 * 1024), as: UTF8.self),
      displayTruncated: text.count > 16 * 1024, limitations: limitations)
  }
}

@MainActor @Observable
public final class InvocationRunsModel {
  public var query = InvocationLedgerQuery(ledgerPath: "")
  public private(set) var receipt: InvocationLedgerReceipt?
  public private(set) var receiptData: Data?
  public private(set) var appliedQuery: InvocationLedgerQuery?
  public private(set) var loading = false
  public private(set) var issue: String?
  public var selectedID: String? {
    didSet { if selectedID != oldValue { clearInspection() } }
  }
  public private(set) var inspection: InvocationReceiptInspection?
  public private(set) var inspectionData: Data?
  public private(set) var inspectionIssue: String?
  public private(set) var inspecting = false
  private let runner: CodeVetterProcessRunner
  private var requestID = UUID()
  private var loadTask: Task<Void, Never>?
  private var inspectionRequestID = UUID()
  private var inspectionTask: Task<Void, Never>?

  public init(runner: CodeVetterProcessRunner = CodeVetterProcessRunner()) {
    self.runner = runner
  }

  public var hasUnappliedTask: Bool {
    appliedQuery != nil && appliedQuery?.taskID != query.taskID
  }

  public var selectedInvocation: InvocationEvent? {
    receipt?.invocations.first { $0.id == selectedID }
  }

  public func load(resetPage: Bool = true) {
    clearInspection()
    loadTask?.cancel()
    let identity = UUID()
    requestID = identity
    if resetPage { query.offset = 0 }
    let requestedQuery = query
    receipt = nil
    receiptData = nil
    appliedQuery = nil
    selectedID = nil
    issue = nil
    loading = false
    guard !query.ledgerPath.isEmpty else { return }
    loading = true
    loadTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if requestID == identity {
          loading = false
          loadTask = nil
        }
      }
      do {
        let data = try await runner.listInvocations(query: requestedQuery)
        guard requestID == identity, !Task.isCancelled else { return }
        try apply(data, query: requestedQuery)
      } catch {
        guard requestID == identity, !Task.isCancelled else { return }
        issue = error.localizedDescription
      }
    }
  }

  func apply(_ data: Data, query: InvocationLedgerQuery) throws {
    let decoded = try InvocationLedgerReceipt.decode(data)
    guard decoded.offset == query.offset, decoded.limit == query.limit,
      decoded.invocations.allSatisfy({ event in
        (query.repositoryPath == nil || event.repoPath == query.repositoryPath)
          && (query.taskID.isEmpty || event.taskID == query.taskID)
          && (query.skill.isEmpty || event.skill == query.skill)
          && (query.state.isEmpty || event.state == query.state)
          && (query.assessment.isEmpty || event.assessment == query.assessment)
      })
    else {
      throw VerificationRunnerError.invalidReceipt(
        "Invocation scope or page does not match the request.")
    }
    receipt = decoded
    receiptData = data
    appliedQuery = query
    selectedID = decoded.invocations.first?.id
  }

  public func page(by direction: Int) {
    guard let receipt, !loading, !hasUnappliedTask else { return }
    let offset = query.offset + direction * query.limit
    guard offset >= 0, offset < receipt.total else { return }
    query.offset = offset
    load(resetPage: false)
  }

  public func moveSelection(by direction: Int) {
    guard let rows = receipt?.invocations, !rows.isEmpty else { return }
    let current = rows.firstIndex { $0.id == selectedID } ?? 0
    selectedID = rows[min(max(current + direction, 0), rows.count - 1)].id
  }

  public func clearInspection() {
    inspectionTask?.cancel()
    inspectionRequestID = UUID()
    inspection = nil
    inspectionData = nil
    inspectionIssue = nil
    inspecting = false
  }

  public func inspectReceipt(pointer: String?) {
    clearInspection()
    guard let event = selectedInvocation, event.receiptIntegrity == "hash_matched",
      let requestedQuery = appliedQuery
    else { return }
    let identity = UUID()
    inspectionRequestID = identity
    inspecting = true
    inspectionTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if inspectionRequestID == identity {
          inspecting = false
          inspectionTask = nil
        }
      }
      do {
        let data = try await runner.inspectInvocation(
          query: requestedQuery, event: event, pointer: pointer)
        guard inspectionRequestID == identity, selectedID == event.id, !Task.isCancelled else {
          return
        }
        inspection = try InvocationReceiptInspection.decode(data, event: event, pointer: pointer)
        inspectionData = data
      } catch {
        guard inspectionRequestID == identity, selectedID == event.id, !Task.isCancelled else {
          return
        }
        inspectionIssue = error.localizedDescription
      }
    }
  }
}
