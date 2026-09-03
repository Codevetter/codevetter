import Foundation

/// Retains the repository chosen through the native folder picker across app launches.
///
/// The bookmark is the authority when it can be resolved. The path is only a recovery
/// fallback for non-sandboxed builds and for older bookmarks that macOS can no longer
/// resolve. Access remains active for the lifetime of this store so bundled CLI
/// processes inherit the selected-folder grant.
@MainActor
public final class RepositoryAccessStore {
  public static let standard = RepositoryAccessStore(defaults: .standard)

  private enum Key {
    static let bookmark = "native.lastRepositoryBookmark"
    static let path = "native.lastRepositoryPath"
  }

  private let defaults: UserDefaults
  private var activeURL: URL?
  private var activeSecurityScope = false

  public init(defaults: UserDefaults) {
    self.defaults = defaults
  }

  public func restore() -> URL? {
    if let data = defaults.data(forKey: Key.bookmark),
      let restored = resolveBookmark(data),
      isDirectory(restored.url)
    {
      activate(restored.url)
      if restored.isStale {
        persistBookmark(for: restored.url)
      }
      return restored.url
    }

    guard let path = defaults.string(forKey: Key.path), !path.isEmpty else { return nil }
    let url = canonicalURL(URL(fileURLWithPath: path, isDirectory: true))
    guard isDirectory(url) else {
      forget()
      return nil
    }
    activate(url)
    persistBookmark(for: url)
    return url
  }

  @discardableResult
  public func remember(_ url: URL) -> URL? {
    let resolved = canonicalURL(url)
    guard isDirectory(resolved) else { return nil }
    activate(resolved)
    defaults.set(resolved.path(percentEncoded: false), forKey: Key.path)
    persistBookmark(for: resolved)
    return resolved
  }

  public func forget() {
    releaseActiveAccess()
    defaults.removeObject(forKey: Key.bookmark)
    defaults.removeObject(forKey: Key.path)
  }

  private func resolveBookmark(_ data: Data) -> (url: URL, isStale: Bool)? {
    var isStale = false
    if let url = try? URL(
      resolvingBookmarkData: data,
      options: [.withSecurityScope, .withoutUI],
      relativeTo: nil,
      bookmarkDataIsStale: &isStale
    ) {
      return (canonicalURL(url), isStale)
    }

    isStale = false
    guard
      let url = try? URL(
        resolvingBookmarkData: data,
        options: [.withoutUI],
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
      )
    else { return nil }
    return (canonicalURL(url), isStale)
  }

  private func persistBookmark(for url: URL) {
    let data =
      (try? url.bookmarkData(
        options: [.withSecurityScope],
        includingResourceValuesForKeys: [.isDirectoryKey],
        relativeTo: nil
      ))
      ?? (try? url.bookmarkData(
        options: [.minimalBookmark],
        includingResourceValuesForKeys: [.isDirectoryKey],
        relativeTo: nil
      ))
    if let data {
      defaults.set(data, forKey: Key.bookmark)
    }
  }

  private func activate(_ url: URL) {
    if activeURL == url { return }
    releaseActiveAccess()
    activeSecurityScope = url.startAccessingSecurityScopedResource()
    activeURL = url
  }

  private func releaseActiveAccess() {
    if activeSecurityScope {
      activeURL?.stopAccessingSecurityScopedResource()
    }
    activeURL = nil
    activeSecurityScope = false
  }

  private func canonicalURL(_ url: URL) -> URL {
    url.resolvingSymlinksInPath().standardizedFileURL
  }

  private func isDirectory(_ url: URL) -> Bool {
    (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
  }
}
