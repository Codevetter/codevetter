import Foundation

public struct NativeUpdaterConfiguration: Equatable, Sendable {
  public let feedURL: URL?
  public let publicEdKey: String?
  public let productionBundle: Bool

  public var ready: Bool {
    feedURL?.scheme?.lowercased() == "https"
      && !(publicEdKey?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
      && productionBundle
  }

  public var status: String {
    if !productionBundle { return "Preview builds never install production updates." }
    if feedURL?.scheme?.lowercased() != "https" {
      return "A secure Sparkle appcast is not configured."
    }
    if publicEdKey?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true {
      return "The Sparkle EdDSA public key is not configured."
    }
    return "Signed Sparkle updates are available."
  }

  public init(bundle: Bundle = .main) {
    let feed = bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String
    feedURL = feed.flatMap(URL.init(string:))
    publicEdKey = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String
    productionBundle = bundle.bundleIdentifier == "com.codevetter.desktop"
  }

  public init(feedURL: URL?, publicEdKey: String?, productionBundle: Bool) {
    self.feedURL = feedURL
    self.publicEdKey = publicEdKey
    self.productionBundle = productionBundle
  }
}
