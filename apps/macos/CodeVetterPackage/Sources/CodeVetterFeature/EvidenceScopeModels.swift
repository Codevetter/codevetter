import Foundation

public enum EvidenceScopeConsumer: String, Codable, CaseIterable, Identifiable, Sendable {
  case testing
  case performance

  public var id: String { rawValue }
}

public enum EvidenceScopeKind: String, Codable, CaseIterable, Identifiable, Sendable {
  case flow
  case change
  case codebase

  public var id: String { rawValue }

  var cliFlag: String {
    switch self {
    case .flow: "--flow"
    case .change: "--change"
    case .codebase: "--codebase"
    }
  }
}

public struct EvidenceScopeRequest: Sendable {
  public let repositoryPath: String
  public let consumer: EvidenceScopeConsumer
  public let kind: EvidenceScopeKind
  public let value: String?

  public init(
    repositoryPath: String,
    consumer: EvidenceScopeConsumer,
    kind: EvidenceScopeKind,
    value: String? = nil
  ) {
    self.repositoryPath = repositoryPath
    self.consumer = consumer
    self.kind = kind
    self.value = value
  }
}

public struct EvidenceScopeCandidate: Codable, Identifiable, Sendable {
  public let id: String
  public let adapter: String
  public let target: String
  public let name: String?
  public let reason: String
  public let sourcePaths: [String]
  public let confidenceMilli: UInt16
  public let testingSupported: Bool
  public let performanceSupported: Bool

  public var confidenceLabel: String {
    String(format: "%.1f%%", Double(confidenceMilli) / 10.0)
  }

  enum CodingKeys: String, CodingKey {
    case id, adapter, target, name, reason
    case sourcePaths = "source_paths"
    case confidenceMilli = "confidence_milli"
    case testingSupported = "testing_supported"
    case performanceSupported = "performance_supported"
  }
}

public struct EvidenceScopePlan: Codable, Sendable {
  public let schemaVersion: UInt32
  public let planID: String
  public let repositoryRevision: String
  public let dirty: Bool
  public let kind: EvidenceScopeKind
  public let originalInput: String?
  public let consumer: EvidenceScopeConsumer
  public let status: String
  public let candidates: [EvidenceScopeCandidate]
  public let uncoveredPaths: [String]
  public let limitations: [String]

  public var ready: Bool { status == "ready" && !candidates.isEmpty }

  enum CodingKeys: String, CodingKey {
    case dirty, kind, consumer, status, candidates, limitations
    case schemaVersion = "schema_version"
    case planID = "plan_id"
    case repositoryRevision = "repository_revision"
    case originalInput = "original_input"
    case uncoveredPaths = "uncovered_paths"
  }
}

public struct EvidenceScopeRunResult: Sendable {
  public let plan: EvidenceScopePlan
  public let rawJSON: String
  public let processStatus: Int32
}
