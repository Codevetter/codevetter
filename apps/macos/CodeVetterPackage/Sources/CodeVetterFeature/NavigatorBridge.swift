import Darwin
import Foundation

struct NavigatorRequest: Encodable, Sendable {
  var version = 1
  var operation: String
  var session: UInt64?
  var input: String?
  var cache: String?
  var revision: String?
  var base: String?
  var path: String?
  var side: String?
  var start: Int?
  var count: Int?
  var context: Int?
  var query: String?
  var line: Int?
  var column: Int?
  var server: String?
  var mergeBase: Bool?
}

struct NavigatorBranch: Decodable, Identifiable, Sendable {
  let reference: String
  let name: String
  let sha: String
  var id: String { reference }
}

struct NavigatorBranches: Decodable, Sendable {
  let branches: [NavigatorBranch]
  let current: String?
  let defaultBase: String?
  let truncated: Bool
}

struct NavigatorEntry: Codable, Identifiable, Sendable {
  let path: String
  let blob: String
  let size: Int
  let mode: String
  let status: String
  let oldPath: String?
  var id: String { path }
}

struct NavigatorSnapshot: Codable, Sendable {
  let id: UInt64
  let root: String
  let label: String
  let head: String
  let base: String?
  let kind: String
  let initialPath: String?
  let initialLine: Int
  let files: [NavigatorEntry]
}

struct NavigatorFile: Decodable, Sendable {
  let path: String
  let side: String
  let revision: String
  let blob: String
  let totalLines: Int
  let start: Int
  let lines: [String]
  let binary: Bool
  let bytes: Int
}

struct NavigatorDiffLine: Codable, Sendable {
  let old: Int?
  let new: Int?
  let kind: String
  let text: String
}

struct NavigatorDiff: Decodable, Sendable {
  let rows: [NavigatorDiffLine]
  let truncated: Bool
  let binary: Bool
}

struct NavigatorLocation: Codable, Identifiable, Sendable {
  let path: String
  let line: Int
  let text: String
  let kind: String
  var id: String { "\(path):\(line):\(kind):\(text)" }
}

struct NavigatorLocations: Decodable, Sendable {
  var locations: [NavigatorLocation] = []
  var qualification: String?
  var complete: Bool?
  var truncated: Bool?
}

struct NavigatorOverview: Decodable, Sendable {
  let locations: [NavigatorLocation]
  let dependencies: [NavigatorLocation]
  let qualification: String
}

struct NavigatorStatus: Decodable, Sendable {
  let indexed: Int
  let total: Int
  let skipped: Int
  let done: Bool
  let bytes: Int
  let issue: String?
}

struct NavigatorHistory: Decodable, Sendable {
  let text: String
  let qualification: String
}

struct NavigatorPaths: Decodable, Sendable { let paths: [String] }
struct NavigatorMaterialization: Decodable, Sendable { let path: String }
struct NavigatorAcknowledgement: Decodable, Sendable {}

private struct NavigatorEnvelope<Value: Decodable>: Decodable {
  let version: Int
  let ok: Bool
  let value: Value?
  let error: String?
}

enum NavigatorError: LocalizedError {
  case unavailable(String)
  var errorDescription: String? {
    switch self {
    case .unavailable(let message): message
    }
  }
}

/// Rust owns source identity and interpretation. Swift owns presentation and warm view caches.
final class NavigatorBridge: @unchecked Sendable {
  static var semanticServerPath: String? {
    var paths = [Bundle.main.resourceURL?.appendingPathComponent("TypeScript/lib/tsc").path]
      .compactMap { $0 }
    #if DEBUG
      let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
      paths.append(root.appendingPathComponent("artifacts/navigator-typescript/lib/tsc").path)
    #endif
    return paths.first { FileManager.default.isExecutableFile(atPath: $0) }
  }
  private typealias RequestFunction =
    @convention(c) (UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?
  private typealias FreeFunction = @convention(c) (UnsafeMutablePointer<CChar>?) -> Void
  private let queue = DispatchQueue(
    label: "com.codevetter.navigator", qos: .userInitiated, attributes: .concurrent)
  private let lock = NSLock()
  private var library: UnsafeMutableRawPointer?
  private var requestFunction: RequestFunction?
  private var freeFunction: FreeFunction?
  private let libraryPath: String?

  init(libraryPath: String? = nil) { self.libraryPath = libraryPath }

  func call<Value: Decodable & Sendable>(_ request: NavigatorRequest, as: Value.Type = Value.self)
    async throws -> Value
  {
    let data = try JSONEncoder().encode(request)
    return try await withCheckedThrowingContinuation { continuation in
      queue.async {
        do {
          let (invoke, free) = try self.functions()
          let response = String(decoding: data, as: UTF8.self).withCString { invoke($0) }
          guard let response else {
            throw NavigatorError.unavailable("Navigator returned no response.")
          }
          defer { free(response) }
          let decoder = JSONDecoder()
          decoder.keyDecodingStrategy = .convertFromSnakeCase
          let envelope = try decoder.decode(
            NavigatorEnvelope<Value>.self, from: Data(String(cString: response).utf8))
          guard envelope.version == 1, envelope.ok, let value = envelope.value else {
            throw NavigatorError.unavailable(envelope.error ?? "Unsupported navigator response.")
          }
          continuation.resume(returning: value)
        } catch { continuation.resume(throwing: error) }
      }
    }
  }

  private func functions() throws -> (RequestFunction, FreeFunction) {
    lock.lock()
    defer { lock.unlock() }
    if let requestFunction, let freeFunction { return (requestFunction, freeFunction) }
    var paths = [
      libraryPath,
      Bundle.main.privateFrameworksURL?.appendingPathComponent("libcodevetter_navigator.dylib")
        .path,
      Bundle.main.resourceURL?.appendingPathComponent("libcodevetter_navigator.dylib").path,
    ].compactMap { $0 }
    #if DEBUG
      let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()
      paths.append(
        root.appendingPathComponent(
          "crates/codevetter-navigator/target/debug/libcodevetter_navigator.dylib"
        ).path)
    #endif
    for path in paths where FileManager.default.fileExists(atPath: path) {
      guard let handle = dlopen(path, RTLD_NOW | RTLD_LOCAL) else { continue }
      guard let call = dlsym(handle, "codevetter_navigator_request"),
        let release = dlsym(handle, "codevetter_navigator_free")
      else {
        dlclose(handle)
        continue
      }
      library = handle
      let invoke = unsafeBitCast(call, to: RequestFunction.self)
      let free = unsafeBitCast(release, to: FreeFunction.self)
      requestFunction = invoke
      freeFunction = free
      return (invoke, free)
    }
    throw NavigatorError.unavailable(
      "The native navigator library is missing. Build it with pnpm navigator:build and rebuild the app."
    )
  }
  // Keep the library loaded for process lifetime: background Rust indexing owns code in it.
}
