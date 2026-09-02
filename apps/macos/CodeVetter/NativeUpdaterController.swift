import AppKit
import CodeVetterFeature
import Sparkle

@MainActor
final class NativeUpdaterController: NSObject, NSMenuItemValidation {
  static let frameworkVersion = "2.9.6"

  let configuration: NativeUpdaterConfiguration
  private let controller: SPUStandardUpdaterController

  override init() {
    configuration = NativeUpdaterConfiguration()
    controller = SPUStandardUpdaterController(
      startingUpdater: false,
      updaterDelegate: nil,
      userDriverDelegate: nil
    )
    super.init()
    if configuration.ready {
      controller.startUpdater()
    }
  }

  var canCheckForUpdates: Bool {
    configuration.ready && controller.updater.canCheckForUpdates
  }

  @objc func checkForUpdates(_ sender: Any?) {
    guard configuration.ready else { return }
    controller.checkForUpdates(sender)
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    menuItem.action == #selector(checkForUpdates(_:)) ? canCheckForUpdates : true
  }
}
