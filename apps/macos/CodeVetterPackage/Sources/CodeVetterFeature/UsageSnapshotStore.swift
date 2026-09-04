import Foundation

struct RestoredUsageSnapshots: Sendable {
  let usageReport: LocalUsageReport?
  let usageReportJSON: String
  let usageSavedAt: Date?
  let providerQuota: ProviderQuotaReceipt?
  let providerQuotaSavedAt: Date?
}

public struct UsageSnapshotStore: Sendable {
  private static let maximumUsageBytes = 32 * 1_024 * 1_024
  private static let maximumProviderQuotaBytes = 1_024 * 1_024

  private let directory: URL

  public init(directory: URL? = nil) {
    self.directory = directory ?? Self.defaultDirectory()
  }

  func restore() -> RestoredUsageSnapshots {
    let usage = read(
      file: "local-usage.json",
      maximumBytes: Self.maximumUsageBytes,
      as: LocalUsageReport.self
    )
    let quota = read(
      file: "provider-quota.json",
      maximumBytes: Self.maximumProviderQuotaBytes,
      as: ProviderQuotaReceipt.self
    )
    return RestoredUsageSnapshots(
      usageReport: usage?.value,
      usageReportJSON: usage.map { String(decoding: $0.data, as: UTF8.self) } ?? "",
      usageSavedAt: usage?.savedAt,
      providerQuota: quota?.value,
      providerQuotaSavedAt: quota?.savedAt
    )
  }

  func saveUsage(rawJSON: String) throws {
    let data = Data(rawJSON.utf8)
    guard data.count <= Self.maximumUsageBytes else { return }
    _ = try JSONDecoder().decode(LocalUsageReport.self, from: data)
    try write(data, file: "local-usage.json")
  }

  func saveProviderQuota(_ receipt: ProviderQuotaReceipt) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(receipt)
    guard data.count <= Self.maximumProviderQuotaBytes else { return }
    try write(data, file: "provider-quota.json")
  }

  private func read<Value: Decodable>(
    file: String,
    maximumBytes: Int,
    as type: Value.Type
  ) -> (value: Value, data: Data, savedAt: Date)? {
    let url = directory.appending(path: file)
    guard
      let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
      let size = attributes[.size] as? NSNumber,
      size.intValue > 0,
      size.intValue <= maximumBytes,
      let data = try? Data(contentsOf: url, options: .mappedIfSafe),
      data.count <= maximumBytes,
      let value = try? JSONDecoder().decode(type, from: data)
    else { return nil }
    return (
      value,
      data,
      attributes[.modificationDate] as? Date ?? .distantPast
    )
  }

  private func write(_ data: Data, file: String) throws {
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let destination = directory.appending(path: file)
    try data.write(to: destination, options: .atomic)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600],
      ofItemAtPath: destination.path
    )
  }

  private static func defaultDirectory() -> URL {
    let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return root
      .appending(path: "com.codevetter.desktop", directoryHint: .isDirectory)
      .appending(path: "usage-snapshots", directoryHint: .isDirectory)
  }
}
