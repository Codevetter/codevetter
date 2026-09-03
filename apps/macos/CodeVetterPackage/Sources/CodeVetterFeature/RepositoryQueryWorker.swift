import Darwin
import Foundation

private let repositoryQueryWorkerRequestSchema =
  "codevetter.repo-query-worker-request/v2"
private let repositoryQueryWorkerResponseSchema =
  "codevetter.repo-query-worker-response/v1"
private let repositoryQueryPreparationSchema =
  "codevetter.repo-query-preparation/v1"
private let maximumRepositoryQueryWorkerResponseBytes = 2 * 1_024 * 1_024

private enum RepositoryQueryWorkerOperation: String, Encodable {
  case prepare
  case query
}

private struct RepositoryQueryWorkerRequest: Encodable {
  let schemaVersion: String
  let requestID: String
  let operation: RepositoryQueryWorkerOperation
  let repoPath: String
  let domain: RepositoryQueryDomain
  let mode: RepositoryQueryMode
  let query: String?
  let target: String?
  let direction: RepositoryGraphDirection?
  let depth: Int?
  let historySelector: RepositoryHistorySelectorKind?
  let limit: Int?

  enum CodingKeys: String, CodingKey {
    case operation, domain, mode, query, target, direction, depth, limit
    case schemaVersion = "schema_version"
    case requestID = "request_id"
    case repoPath = "repo_path"
    case historySelector = "history_selector"
  }
}

private struct RepositoryQueryPreparation: Decodable {
  let schemaVersion: String
  let authority: String
  let repoPath: String
  let domain: RepositoryQueryDomain
  let status: String

  enum CodingKeys: String, CodingKey {
    case authority, domain, status
    case schemaVersion = "schema_version"
    case repoPath = "repo_path"
  }
}

private struct RepositoryQueryWorkerResponse: Decodable {
  let schemaVersion: String
  let requestID: String
  let status: String
  let receipt: RepositoryQueryReceipt?
  let preparation: RepositoryQueryPreparation?
  let error: String?

  enum CodingKeys: String, CodingKey {
    case status, receipt, preparation, error
    case schemaVersion = "schema_version"
    case requestID = "request_id"
  }
}

enum RepositoryQueryWorkerFailure: Error {
  case transport(String)
  case remote(String)
}

/// Owns one read-only Rust query process for the native app lifetime.
///
/// Requests are serialized so stdout remains a bounded JSON-lines protocol.
/// Cancellation terminates only this scoped worker; the next request starts a
/// fresh process and never accepts a partial receipt.
final class RepositoryQueryWorker: @unchecked Sendable {
  private let executableURL: URL
  private let queue = DispatchQueue(label: "com.codevetter.repository-query-worker")
  private let lock = NSLock()
  private var process: Process?
  private var inputHandle: FileHandle?
  private var outputHandle: FileHandle?
  private var errorPipe: Pipe?
  private var errorData = Data()
  private var outputBuffer = Data()
  private var activeRequestID: String?
  private var cancelledRequestIDs: Set<String> = []

  init(executableURL: URL) {
    self.executableURL = executableURL
  }

  deinit {
    stopWorker()
  }

  func prepare(repositoryPath: String, domain: RepositoryQueryDomain) async throws -> Bool {
    let requestID = UUID().uuidString.lowercased()
    let request = RepositoryQueryWorkerRequest(
      schemaVersion: repositoryQueryWorkerRequestSchema,
      requestID: requestID,
      operation: .prepare,
      repoPath: repositoryPath,
      domain: domain,
      mode: .search,
      query: nil,
      target: nil,
      direction: nil,
      depth: nil,
      historySelector: nil,
      limit: nil
    )
    let response = try await execute(request, requestID: requestID)
    guard let preparation = response.preparation,
      response.receipt == nil,
      preparation.schemaVersion == repositoryQueryPreparationSchema,
      preparation.authority == "read_only_projection",
      preparation.repoPath
        == URL(fileURLWithPath: repositoryPath).resolvingSymlinksInPath().path,
      preparation.domain == domain,
      ["ready", "unavailable"].contains(preparation.status)
    else {
      throw RepositoryQueryWorkerFailure.transport(
        "The Rust worker returned an inconsistent preparation receipt.")
    }
    return preparation.status == "ready"
  }

  func query(
    repositoryPath: String,
    domain: RepositoryQueryDomain,
    mode: RepositoryQueryMode,
    query: String,
    target: String?,
    direction: RepositoryGraphDirection?,
    depth: Int?,
    historySelector: RepositoryHistorySelectorKind?,
    limit: Int
  ) async throws -> RepositoryQueryReceipt {
    let requestID = UUID().uuidString.lowercased()
    let request = RepositoryQueryWorkerRequest(
      schemaVersion: repositoryQueryWorkerRequestSchema,
      requestID: requestID,
      operation: .query,
      repoPath: repositoryPath,
      domain: domain,
      mode: mode,
      query: query,
      target: target,
      direction: direction,
      depth: depth,
      historySelector: historySelector,
      limit: limit
    )
    let response = try await execute(request, requestID: requestID)
    guard let receipt = response.receipt, response.preparation == nil else {
      throw RepositoryQueryWorkerFailure.transport(
        "The Rust worker omitted the canonical repository query receipt.")
    }
    return receipt
  }

  func cancelAll() {
    lock.lock()
    if let activeRequestID {
      cancelledRequestIDs.insert(activeRequestID)
    }
    let activeProcess = process
    let activeInput = inputHandle
    lock.unlock()
    interruptWorker(process: activeProcess, input: activeInput)
  }

  private func execute(
    _ request: RepositoryQueryWorkerRequest,
    requestID: String
  ) async throws -> RepositoryQueryWorkerResponse {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        queue.async { [self] in
          guard begin(requestID) else {
            finish(requestID)
            continuation.resume(throwing: CancellationError())
            return
          }
          do {
            let response = try executeSynchronously(request)
            let wasCancelled = isCancelled(requestID)
            finish(requestID)
            if wasCancelled {
              throw CancellationError()
            }
            continuation.resume(returning: response)
          } catch {
            let wasCancelled = isCancelled(requestID)
            finish(requestID)
            if wasCancelled || error is CancellationError {
              resetWorker(terminate: true)
              continuation.resume(throwing: CancellationError())
            } else {
              continuation.resume(throwing: error)
            }
          }
        }
      }
    } onCancel: {
      self.cancel(requestID)
    }
  }

  private func executeSynchronously(
    _ request: RepositoryQueryWorkerRequest
  ) throws -> RepositoryQueryWorkerResponse {
    let handles = try ensureWorker()
    do {
      var encoded = try JSONEncoder().encode(request)
      encoded.append(0x0A)
      try handles.input.write(contentsOf: encoded)
      let line = try readResponseLine(from: handles.output)
      let response = try JSONDecoder().decode(RepositoryQueryWorkerResponse.self, from: line)
      guard response.schemaVersion == repositoryQueryWorkerResponseSchema,
        response.requestID == request.requestID
      else {
        throw RepositoryQueryWorkerFailure.transport(
          "The Rust worker response did not match the supervised request.")
      }
      guard response.status == "ok" else {
        throw RepositoryQueryWorkerFailure.remote(
          response.error ?? "The Rust query worker rejected the request.")
      }
      return response
    } catch let error as RepositoryQueryWorkerFailure {
      if case .transport = error {
        resetWorker(terminate: true)
      }
      throw error
    } catch {
      resetWorker(terminate: true)
      throw RepositoryQueryWorkerFailure.transport(error.localizedDescription)
    }
  }

  private func ensureWorker() throws -> (input: FileHandle, output: FileHandle) {
    lock.lock()
    if let process, process.isRunning, let inputHandle, let outputHandle {
      lock.unlock()
      return (inputHandle, outputHandle)
    }
    lock.unlock()

    resetWorker(terminate: false)
    let process = Process()
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.executableURL = executableURL
    process.arguments = ["unpack", "--operation", "query-worker", "--json"]
    process.standardInput = inputPipe
    process.standardOutput = outputPipe
    process.standardError = errorPipe
    errorPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty, let self else { return }
      self.lock.lock()
      self.errorData.append(data)
      self.lock.unlock()
    }
    do {
      try process.run()
    } catch {
      errorPipe.fileHandleForReading.readabilityHandler = nil
      throw RepositoryQueryWorkerFailure.transport(error.localizedDescription)
    }
    lock.lock()
    self.process = process
    inputHandle = inputPipe.fileHandleForWriting
    outputHandle = outputPipe.fileHandleForReading
    self.errorPipe = errorPipe
    errorData.removeAll(keepingCapacity: true)
    lock.unlock()
    return (inputPipe.fileHandleForWriting, outputPipe.fileHandleForReading)
  }

  private func readResponseLine(from handle: FileHandle) throws -> Data {
    while true {
      if let newline = outputBuffer.firstIndex(of: 0x0A) {
        let line = outputBuffer[..<newline]
        outputBuffer.removeSubrange(...newline)
        guard !line.isEmpty else {
          throw RepositoryQueryWorkerFailure.transport("The Rust worker returned an empty line.")
        }
        return Data(line)
      }
      guard outputBuffer.count <= maximumRepositoryQueryWorkerResponseBytes else {
        throw RepositoryQueryWorkerFailure.transport(
          "The Rust worker response exceeded the bounded receipt size.")
      }
      let chunk = handle.availableData
      guard !chunk.isEmpty else {
        throw RepositoryQueryWorkerFailure.transport(workerExitMessage())
      }
      outputBuffer.append(chunk)
    }
  }

  private func workerExitMessage() -> String {
    lock.lock()
    let message = String(decoding: errorData, as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    lock.unlock()
    return message.isEmpty
      ? "The Rust query worker closed before returning a receipt."
      : message
  }

  private func begin(_ requestID: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard !cancelledRequestIDs.contains(requestID) else { return false }
    activeRequestID = requestID
    return true
  }

  private func finish(_ requestID: String) {
    lock.lock()
    cancelledRequestIDs.remove(requestID)
    if activeRequestID == requestID {
      activeRequestID = nil
    }
    lock.unlock()
  }

  private func isCancelled(_ requestID: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelledRequestIDs.contains(requestID)
  }

  private func cancel(_ requestID: String) {
    lock.lock()
    cancelledRequestIDs.insert(requestID)
    let activeProcess = activeRequestID == requestID ? process : nil
    let activeInput = activeRequestID == requestID ? inputHandle : nil
    lock.unlock()
    interruptWorker(process: activeProcess, input: activeInput)
  }

  private func interruptWorker(process: Process?, input: FileHandle?) {
    // Closing stdin releases workers blocked in a read even when their shell
    // does not act on Foundation's SIGTERM until that read returns.
    try? input?.close()
    terminateWorker(process)
  }

  private func stopWorker() {
    resetWorker(terminate: true)
  }

  private func resetWorker(terminate: Bool) {
    lock.lock()
    let currentProcess = process
    let currentInput = inputHandle
    let currentErrorPipe = errorPipe
    process = nil
    inputHandle = nil
    outputHandle = nil
    errorPipe = nil
    lock.unlock()
    currentErrorPipe?.fileHandleForReading.readabilityHandler = nil
    try? currentInput?.close()
    if terminate {
      terminateWorker(currentProcess)
    }
    outputBuffer.removeAll(keepingCapacity: true)
  }

  private func terminateWorker(_ process: Process?) {
    guard let process, process.isRunning else { return }
    process.terminate()

    // A shell blocked in a pipe read can defer SIGTERM indefinitely. Give the
    // exclusively owned read-only worker a short graceful window, then bound
    // cancellation with SIGKILL so the UI and the next request cannot hang.
    let deadline = Date().addingTimeInterval(0.2)
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.01)
    }
    if process.isRunning {
      _ = Darwin.kill(process.processIdentifier, SIGKILL)
    }
  }
}
