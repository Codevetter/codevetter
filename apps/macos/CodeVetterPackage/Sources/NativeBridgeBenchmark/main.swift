import Darwin
import Foundation

struct Statistics: Codable {
  let iterations: Int
  let minimumMicroseconds: Double
  let medianMicroseconds: Double
  let p95Microseconds: Double
  let averageMicroseconds: Double

  enum CodingKeys: String, CodingKey {
    case iterations
    case minimumMicroseconds = "minimum_us"
    case medianMicroseconds = "median_us"
    case p95Microseconds = "p95_us"
    case averageMicroseconds = "average_us"
  }
}

struct BridgeBenchmarkReceipt: Codable {
  let schemaVersion = "codevetter.native-bridge-benchmark/v1"
  let payloadBytes: Int
  let ffiTransfer: Statistics
  let ffiTransferAndDecode: Statistics
  let workerRoundTrip: Statistics
  let semanticParity: Bool
  let selectedBoundary: String
  let limitations: [String]

  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version"
    case payloadBytes = "payload_bytes"
    case ffiTransfer = "ffi_transfer"
    case ffiTransferAndDecode = "ffi_transfer_and_decode"
    case workerRoundTrip = "worker_round_trip"
    case semanticParity = "semantic_parity"
    case selectedBoundary = "selected_boundary"
    case limitations
  }
}

typealias PointerFunction = @convention(c) () -> UnsafePointer<UInt8>?
typealias LengthFunction = @convention(c) () -> Int

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  FileHandle.standardError.write(
    Data("usage: NativeBridgeBenchmark <bridge.dylib> <codevetter-cli>\n".utf8))
  exit(2)
}

let dynamicLibraryPath = arguments[1]
let cliPath = arguments[2]
guard let handle = dlopen(dynamicLibraryPath, RTLD_NOW | RTLD_LOCAL) else {
  let message = dlerror().map { String(cString: $0) } ?? "unknown dynamic loader error"
  FileHandle.standardError.write(Data("load bridge: \(message)\n".utf8))
  exit(2)
}
defer { dlclose(handle) }

guard let pointerSymbol = dlsym(handle, "codevetter_capabilities_pointer"),
  let lengthSymbol = dlsym(handle, "codevetter_capabilities_length")
else {
  FileHandle.standardError.write(Data("bridge symbols are unavailable\n".utf8))
  exit(2)
}

let capabilityPointer = unsafeBitCast(pointerSymbol, to: PointerFunction.self)
let capabilityLength = unsafeBitCast(lengthSymbol, to: LengthFunction.self)
guard let bytes = capabilityPointer(), capabilityLength() > 0 else {
  FileHandle.standardError.write(Data("bridge returned an empty payload\n".utf8))
  exit(2)
}

let payloadLength = capabilityLength()
let ffiPayload = Data(bytes: bytes, count: payloadLength)
let ffiObject = try JSONSerialization.jsonObject(with: ffiPayload)
guard JSONSerialization.isValidJSONObject(ffiObject) else {
  FileHandle.standardError.write(Data("bridge payload is not canonical JSON\n".utf8))
  exit(2)
}

for _ in 0..<100 {
  _ = Data(bytes: bytes, count: payloadLength)
}

let transfer = measure(iterations: 10_000) {
  _ = Data(bytes: bytes, count: payloadLength)
}
let transferAndDecode = measure(iterations: 1_000) {
  let data = Data(bytes: bytes, count: payloadLength)
  _ = try! JSONSerialization.jsonObject(with: data)
}

for _ in 0..<3 {
  _ = try runWorker(at: cliPath)
}
var latestWorkerPayload = Data()
let worker = measure(iterations: 20) {
  latestWorkerPayload = try! runWorker(at: cliPath)
}

let workerObject = try JSONSerialization.jsonObject(with: latestWorkerPayload)
let ffiCanonical = try JSONSerialization.data(withJSONObject: ffiObject, options: [.sortedKeys])
let workerCanonical = try JSONSerialization.data(
  withJSONObject: workerObject,
  options: [.sortedKeys]
)
let parity = ffiCanonical == workerCanonical
guard parity else {
  FileHandle.standardError.write(Data("worker and FFI payloads differ semantically\n".utf8))
  exit(1)
}

let receipt = BridgeBenchmarkReceipt(
  payloadBytes: payloadLength,
  ffiTransfer: transfer,
  ffiTransferAndDecode: transferAndDecode,
  workerRoundTrip: worker,
  semanticParity: parity,
  selectedBoundary:
    "hybrid: in-process for bounded read-only projections; supervised worker for verification execution",
  limitations: [
    "The FFI probe measures a deterministic read-only projection, not long-running verification.",
    "Debug and release application integration overhead is not included.",
    "Process startup is intentionally included in the worker round trip.",
  ]
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(receipt))
FileHandle.standardOutput.write(Data("\n".utf8))

func measure(iterations: Int, operation: () -> Void) -> Statistics {
  var samples: [Double] = []
  samples.reserveCapacity(iterations)
  for _ in 0..<iterations {
    let started = DispatchTime.now().uptimeNanoseconds
    operation()
    let elapsed = DispatchTime.now().uptimeNanoseconds - started
    samples.append(Double(elapsed) / 1_000)
  }
  samples.sort()
  let average = samples.reduce(0, +) / Double(samples.count)
  return Statistics(
    iterations: iterations,
    minimumMicroseconds: samples[0],
    medianMicroseconds: percentile(samples, 0.5),
    p95Microseconds: percentile(samples, 0.95),
    averageMicroseconds: average
  )
}

func percentile(_ sorted: [Double], _ value: Double) -> Double {
  let index = min(sorted.count - 1, Int((Double(sorted.count - 1) * value).rounded(.up)))
  return sorted[index]
}

func runWorker(at path: String) throws -> Data {
  let process = Process()
  let output = Pipe()
  let errors = Pipe()
  process.executableURL = URL(fileURLWithPath: path)
  process.arguments = ["capabilities", "--json"]
  process.standardOutput = output
  process.standardError = errors
  try process.run()
  let data = output.fileHandleForReading.readDataToEndOfFile()
  let errorData = errors.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  guard process.terminationStatus == 0 else {
    throw NSError(
      domain: "CodeVetterBridgeBenchmark",
      code: Int(process.terminationStatus),
      userInfo: [
        NSLocalizedDescriptionKey: String(data: errorData, encoding: .utf8) ?? "worker failed"
      ]
    )
  }
  return data
}
