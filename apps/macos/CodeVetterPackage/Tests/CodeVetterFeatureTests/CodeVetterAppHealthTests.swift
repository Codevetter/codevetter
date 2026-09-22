import AppHealth
@testable import CodeVetterFeature
import Foundation
import Testing

private actor RejectingAppHealthTransport: AppHealthTransport {
  private(set) var requests = 0

  func send(_: URLRequest) async throws -> AppHealthResponse {
    requests += 1
    return AppHealthResponse(statusCode: 503)
  }
}

@Suite("CodeVetter App Health")
struct CodeVetterAppHealthTests {
  @Test("missing or invalid configuration stays inert")
  func missingConfigurationStaysInert() async {
    let telemetry = CodeVetterAppHealth(configuration: nil)

    await telemetry.applicationLaunched()
    await telemetry.setActive(true)
    await telemetry.setActive(false)
    await telemetry.close()

    #expect(await telemetry.configured == false)
    #expect(await telemetry.diagnostics() == nil)
  }

  @Test("collector rejection never escapes the telemetry boundary")
  func collectorRejectionIsContained() async throws {
    let transport = RejectingAppHealthTransport()
    let configuration = try #require(CodeVetterAppHealthConfiguration(
      endpoint: URL(string: "https://collector.example")!,
      publicKey: "ahk_native_" + String(repeating: "a", count: 64)
    ))
    let telemetry = CodeVetterAppHealth(
      configuration: configuration,
      transport: transport
    )

    await telemetry.applicationLaunched()
    await telemetry.close()

    let diagnostics = try #require(await telemetry.diagnostics())
    #expect(diagnostics.accepted == 0)
    #expect(diagnostics.dropped == 1)
    #expect(diagnostics.retries == 2)
    #expect(await transport.requests == 3)
  }
}
