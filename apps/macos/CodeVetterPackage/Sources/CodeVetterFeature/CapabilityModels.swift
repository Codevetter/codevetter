import Foundation

public struct CapabilityRegistry: Codable, Sendable {
  public let schemaVersion: String
  public let authority: String
  public let capabilities: [Capability]

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case authority
    case capabilities
  }

  public static func bundled() throws -> CapabilityRegistry {
    guard let url = Bundle.module.url(forResource: "capabilities.v1", withExtension: "json") else {
      throw CapabilityLoadingError.missingResource
    }
    return try JSONDecoder().decode(CapabilityRegistry.self, from: Data(contentsOf: url))
  }
}

public enum CapabilityLoadingError: LocalizedError {
  case missingResource

  public var errorDescription: String? {
    "The Rust-generated capability registry is missing from the app bundle."
  }
}

public struct Capability: Codable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let purpose: String
  public let stage: CapabilityStage
  public let surfaces: SurfaceMatrix
  public let underlyingTools: [UnderlyingTool]
  public let dataBoundary: String
  public let qualification: Qualification
  public let limitations: [String]
  public let nextStep: String

  enum CodingKeys: String, CodingKey {
    case id, name, purpose, stage, surfaces, limitations, qualification
    case underlyingTools = "underlying_tools"
    case dataBoundary = "data_boundary"
    case nextStep = "next_step"
  }
}

public enum CapabilityStage: String, Codable, Sendable {
  case current
  case building
  case future
}

public enum Availability: String, Codable, Sendable {
  case available
  case building
  case planned
  case unavailable
}

public enum Authority: String, Codable, Sendable {
  case none
  case read
  case execute
  case readExecute = "read_execute"
}

public enum Qualification: String, Codable, Sendable {
  case qualified
  case partial
  case unqualified
}

public struct SurfaceProjection: Codable, Sendable {
  public let availability: Availability
  public let authority: Authority
  public let entrypoints: [String]
}

public struct SurfaceMatrix: Codable, Sendable {
  public let ui: SurfaceProjection
  public let cli: SurfaceProjection
  public let agent: SurfaceProjection
}

public struct UnderlyingTool: Codable, Sendable, Identifiable {
  public let name: String
  public let role: String
  public let requirement: String

  public var id: String { name }
}
