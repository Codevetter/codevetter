import Foundation
import Testing
@testable import CodeVetterFeature

private func totalsJSON(_ input: String = "42") -> String {
  #"{"input_tokens":\#(input),"cache_creation_tokens":2,"cache_read_tokens":3,"output_tokens":4,"total_tokens":51,"cost_usd":0.30000000000000004}"#
}

private func parentJSON(_ totals: String?) -> Data {
  let field = totals.map { ",\"totals\":\($0)" } ?? ""
  return Data(#"{"session_id":"s","agent":"claude","reasoning_output_tokens":0,"model":"m","fallback":false,"priced":true,"period":"2026-09-01","models":[],"agents":[],"project":"p"\#(field)}"#.utf8)
}

private func decodedTotals(_ data: Data) throws -> [LocalUsageTotals] {
  let decoder = JSONDecoder()
  return [
    try decoder.decode(LocalUsageSession.self, from: data).totals,
    try decoder.decode(LocalUsageModel.self, from: data).totals,
    try decoder.decode(LocalUsageAgent.self, from: data).totals,
    try decoder.decode(LocalUsagePeriod.self, from: data).totals,
    try decoder.decode(LocalUsageProject.self, from: data).totals,
  ]
}

@Test func nestedUsageTotalsPreserveUInt64AndCostPrecision() throws {
  let data = parentJSON(totalsJSON("18446744073709551615"))
  for totals in try decodedTotals(data) {
    #expect(totals.inputTokens == UInt64.max)
    #expect(totals.cacheCreationTokens == 2)
    #expect(totals.cacheReadTokens == 3)
    #expect(totals.outputTokens == 4)
    #expect(totals.totalTokens == 51)
    #expect(totals.costUSD.bitPattern == Double(0.30000000000000004).bitPattern)
  }
  let session = try JSONDecoder().decode(LocalUsageSession.self, from: data)
  let roundTrip = try JSONDecoder().decode(LocalUsageSession.self, from: JSONEncoder().encode(session))
  #expect(roundTrip.totals == session.totals)
  #expect(roundTrip.sessionID == session.sessionID)
  #expect(roundTrip.project == session.project)
  #expect(roundTrip.lastActivity == nil)
}

@Test(arguments: ["-1", "18446744073709551616", "null", "true", "\"42\"", "1.5"])
func nestedUsageTotalsRejectInvalidTokenCounts(_ value: String) {
  let data = parentJSON(totalsJSON(value))
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageSession.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageModel.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageAgent.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsagePeriod.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageProject.self, from: data) }
}

@Test(arguments: [nil, "null", "5", "[]", "{}"] as [String?])
func nestedUsageTotalsRequireCompleteObject(_ totals: String?) {
  let data = parentJSON(totals)
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageSession.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageModel.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageAgent.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsagePeriod.self, from: data) }
  #expect(throws: DecodingError.self) { try JSONDecoder().decode(LocalUsageProject.self, from: data) }
}

@Test func nestedUsageDecodingPreservesOptionalFields() throws {
  let decoder = JSONDecoder()
  let base = String(decoding: parentJSON(totalsJSON()), as: UTF8.self)
  let absentProject = base.replacingOccurrences(of: ",\"project\":\"p\"", with: "")
  for optionalFields in ["", ",\"project\":null,\"last_activity\":null", ",\"project\":\"p\",\"last_activity\":\"2026-09-01T00:00:00Z\""] {
    let json = String(absentProject.dropLast()) + optionalFields + "}"
    let session = try decoder.decode(LocalUsageSession.self, from: Data(json.utf8))
    #expect(session.project == (optionalFields.contains("\"p\"") ? "p" : nil))
    #expect(session.lastActivity == (optionalFields.contains("2026") ? "2026-09-01T00:00:00Z" : nil))
  }
  for projects in ["", ",\"projects\":null", ",\"projects\":[]"] {
    let json = String(base.dropLast()) + projects + "}"
    let period = try decoder.decode(LocalUsagePeriod.self, from: Data(json.utf8))
    #expect(projects.contains("[]") ? period.projects?.isEmpty == true : period.projects == nil)
  }
}

private func reportJSON(sessions: String?) -> Data {
  let field = sessions.map { ",\"sessions\":\($0)" } ?? ""
  return Data(#"{"status":"ready","stale":false,"provenance":{"engine":"ccusage","version":"20.0.20","generated_at":"2026-09-01T00:00:00Z","timezone":"UTC","window":"all","detected_agents":["claude"],"excluded_agents":[],"codex_roots":[],"source_fingerprint":"fixture","pricing_complete":true,"fallback_models":[],"unpriced_models":[]},"daily":[],"weekly":[],"monthly":[],"totals":\#(totalsJSON())\#(field)}"#.utf8)
}

@Test(arguments: [nil, "null", "{}", "[null]", "[true]"] as [String?])
func nestedUsageReportRequiresSessionObjects(_ sessions: String?) {
  #expect(throws: DecodingError.self) {
    try JSONDecoder().decode(LocalUsageReport.self, from: reportJSON(sessions: sessions))
  }
}

@Test func nestedUsageReportPreservesSessionOrderAndRoundTrip() throws {
  let first = String(decoding: parentJSON(totalsJSON("18446744073709551615")), as: UTF8.self)
  let second = first.replacingOccurrences(of: "\"session_id\":\"s\"", with: "\"session_id\":\"second\"")
  let decoder = JSONDecoder()
  let report = try decoder.decode(LocalUsageReport.self, from: reportJSON(sessions: "[\(first),\(second)]"))
  let restored = try decoder.decode(LocalUsageReport.self, from: JSONEncoder().encode(report))
  #expect(restored.sessions.map(\.sessionID) == ["s", "second"])
  #expect(restored.sessions.allSatisfy { $0.totals.inputTokens == UInt64.max })
  #expect(restored.totals == report.totals)
  #expect(restored.error == nil)
  #expect(restored.devin == nil)
  #expect(try decoder.decode(LocalUsageReport.self, from: reportJSON(sessions: "[]")).sessions.isEmpty)
  #expect(throws: DecodingError.self) {
    try decoder.decode(LocalUsageReport.self, from: reportJSON(sessions: "[\(first),null]"))
  }
}
