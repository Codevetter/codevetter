import Foundation

extension WorkbenchModel {
  func openNavigatorSource(path: String, line: Int?, receipt: VerificationReceipt) {
    let head = receipt.source.headSha
    guard [40, 64].contains(head.count), head.allSatisfy(\.isHexDigit) else {
      navigator.issue =
        "This receipt has no immutable source revision. Its location cannot be safely attached to current source."
      return
    }
    section = .repository
    navigator.showVerification = false
    navigator.inspector = .evidence
    if navigator.snapshot?.root == receipt.repoPath, navigator.snapshot?.head == head,
      navigator.snapshot?.kind != "local"
    {
      navigator.presentation = "Source"
      navigator.select(path, line: line ?? 1)
    } else {
      navigator.open(
        receipt.repoPath, revision: head,
        base: receipt.source.baseSha.isEmpty ? nil : receipt.source.baseSha,
        path: path, line: line ?? 1)
    }
  }
}

/// Extract only repository-contained, line-qualified locations from recorded runtime evidence.
/// The receipt's immutable source revision remains the authority when the user follows one.
func navigatorRuntimeLocations(_ receipt: VerificationReceipt) -> [NavigatorLocation] {
  guard let stage = receipt.stages?.correctness,
    let bytes = try? JSONEncoder().encode(stage.evidence),
    let object = try? JSONSerialization.jsonObject(with: bytes)
  else { return [] }
  var strings: [String] = []
  func collect(_ value: Any) {
    if let value = value as? String {
      strings.append(value)
    } else if let values = value as? [String: Any] {
      for (key, value) in values
      where [
        "stderr", "stdout", "stack", "trace", "error", "output", "message", "stderr_summary",
        "stdout_summary",
      ].contains(key) || value is [String: Any] || value is [Any] { collect(value) }
    } else if let values = value as? [Any] {
      values.forEach(collect)
    }
  }
  collect(object)
  return navigatorRuntimeLocations(in: strings, repository: receipt.repoPath)
}

func navigatorRuntimeLocations(in strings: [String], repository: String) -> [NavigatorLocation] {
  // The path character class already includes '/'. Repeating a slash-delimited
  // group around it creates ambiguous partitions and exponential backtracking.
  guard let pattern = try? NSRegularExpression(
    pattern: #"(?:^|[\s(])([^\s():]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?"#)
  else { return [] }
  var locations: [NavigatorLocation] = []
  var seen: Set<String> = []
  for text in strings {
    let ns = text as NSString
    for match in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
      var path = ns.substring(with: match.range(at: 1))
      if path.hasPrefix(repository + "/") {
        path = String(path.dropFirst(repository.count + 1))
      }
      if path.hasPrefix("./") { path = String(path.dropFirst(2)) }
      guard !path.hasPrefix("/"), !path.split(separator: "/").contains(".."),
        let line = Int(ns.substring(with: match.range(at: 2))), line > 0
      else { continue }
      let key = "\(path):\(line)"
      if seen.insert(key).inserted {
        locations.append(
          NavigatorLocation(path: path, line: line, text: key, kind: "Recorded runtime location"))
      }
      if locations.count >= 100 { return locations }
    }
  }
  return locations
}
