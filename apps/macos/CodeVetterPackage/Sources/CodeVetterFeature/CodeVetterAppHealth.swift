import AppHealth
import Foundation

public struct CodeVetterAppHealthConfiguration: Equatable, Sendable {
  public static let endpointInfoKey = "AppHealthEndpoint"
  public static let publicKeyInfoKey = "AppHealthNativePublicKey"

  public let endpoint: URL
  public let publicKey: String

  public init?(bundle: Bundle = .main) {
    guard
      let endpointValue = bundle.object(forInfoDictionaryKey: Self.endpointInfoKey) as? String,
      let endpoint = URL(string: endpointValue),
      let publicKey = bundle.object(forInfoDictionaryKey: Self.publicKeyInfoKey) as? String
    else { return nil }
    self.init(endpoint: endpoint, publicKey: publicKey)
  }

  public init?(endpoint: URL, publicKey: String) {
    guard
      endpoint.scheme?.lowercased() == "https",
      endpoint.host != nil,
      publicKey.range(of: "^ahk_native_[a-f0-9]{64}$", options: .regularExpression) != nil
    else { return nil }
    self.endpoint = endpoint
    self.publicKey = publicKey
  }
}

public actor CodeVetterAppHealth {
  private let client: AppHealthClient?

  public init(bundle: Bundle = .main) {
    self.init(configuration: CodeVetterAppHealthConfiguration(bundle: bundle))
  }

  public init(configuration: CodeVetterAppHealthConfiguration?) {
    client = configuration.flatMap {
      try? AppHealthClient(endpoint: $0.endpoint, publicKey: $0.publicKey)
    }
  }

  init(
    configuration: CodeVetterAppHealthConfiguration?,
    transport: any AppHealthTransport,
    sleep: @escaping @Sendable (UInt64) async -> Void = { _ in }
  ) {
    client = configuration.flatMap {
      try? AppHealthClient(
        endpoint: $0.endpoint,
        publicKey: $0.publicKey,
        transport: transport,
        sleep: sleep
      )
    }
  }

  public var configured: Bool { client != nil }

  public func applicationLaunched() async {
    await client?.track("app.launch", screen: "native")
  }

  public func setActive(_ active: Bool) async {
    await client?.setActive(active)
  }

  public func close() async {
    await client?.close()
  }

  func diagnostics() async -> AppHealthDiagnostics? {
    await client?.diagnostics()
  }
}
