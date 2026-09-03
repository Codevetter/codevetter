import AppKit
import CodeVetterFeature
import SwiftUI

@main
@MainActor
final class CodeVetterAppDelegate: NSObject, NSApplicationDelegate {
  private static let retainedDelegate = CodeVetterAppDelegate()
  private let model = WorkbenchModel(repositoryAccessStore: RepositoryAccessStore.standard)
  private let updater = NativeUpdaterController()
  private var windowController: NSWindowController?

  static func main() {
    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    application.appearance = requestedAppearance
    application.delegate = retainedDelegate
    _ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
  }

  private static var requestedAppearance: NSAppearance? {
    guard
      let flagIndex = CommandLine.arguments.firstIndex(of: "--appearance"),
      CommandLine.arguments.indices.contains(flagIndex + 1)
    else { return nil }

    return switch CommandLine.arguments[flagIndex + 1].lowercased() {
    case "light": NSAppearance(named: .aqua)
    case "dark": NSAppearance(named: .darkAqua)
    default: nil
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    applyRequestedInitialState()
    showMainWindowIfNeeded()
  }

  private func applyRequestedInitialState() {
    if let repository = launchValue(after: "--ui-test-repository") {
      model.selectRepository(
        URL(fileURLWithPath: repository, isDirectory: true),
        persist: false
      )
    }
    if let sectionName = launchValue(after: "--ui-test-section"),
      let section = WorkbenchSection.allCases.first(where: { $0.rawValue == sectionName })
    {
      model.section = section
    }
  }

  private func launchValue(after flag: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: flag),
      CommandLine.arguments.indices.contains(index + 1)
    else { return nil }
    let value = CommandLine.arguments[index + 1]
    return value.isEmpty ? nil : value
  }

  private func showMainWindowIfNeeded() {
    guard windowController == nil else { return }
    installMainMenu()
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_280, height: 800),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.title = "CodeVetter"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.toolbarStyle = .unified
    window.minSize = NSSize(width: 980, height: 640)
    window.center()
    window.contentViewController = NSHostingController(
      rootView: PremiumWorkbenchRootView(model: model))
    window.isReleasedWhenClosed = false
    window.tabbingMode = .preferred

    let controller = NSWindowController(window: window)
    windowController = controller
    controller.showWindow(nil)
    DispatchQueue.main.async { [weak window] in
      window?.makeKeyAndOrderFront(nil)
      NSApp.activate()
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    guard !flag, let window = windowController?.window else { return true }
    window.makeKeyAndOrderFront(nil)
    sender.activate()
    return true
  }

  private func installMainMenu() {
    let mainMenu = NSMenu()

    let appItem = NSMenuItem()
    let appMenu = NSMenu(title: "CodeVetter")
    appMenu.addItem(
      withTitle: "About CodeVetter",
      action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
      keyEquivalent: ""
    )
    let updates = appMenu.addItem(
      withTitle: "Check for Updates…",
      action: #selector(NativeUpdaterController.checkForUpdates(_:)),
      keyEquivalent: ""
    )
    updates.target = updater
    updates.toolTip = updater.configuration.status
    appMenu.addItem(.separator())
    appMenu.addItem(makeMenuItem("Settings…", action: #selector(showSettings), key: ","))
    appMenu.addItem(.separator())
    appMenu.addItem(
      withTitle: "Hide CodeVetter", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let hideOthers = appMenu.addItem(
      withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)),
      keyEquivalent: "h")
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(
      withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)),
      keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(
      withTitle: "Quit CodeVetter", action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q")
    appItem.submenu = appMenu
    mainMenu.addItem(appItem)

    let fileItem = NSMenuItem()
    let fileMenu = NSMenu(title: "File")
    fileMenu.addItem(
      makeMenuItem("Open Repository…", action: #selector(openRepository), key: "o"))
    fileMenu.addItem(.separator())
    fileMenu.addItem(
      withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    fileItem.submenu = fileMenu
    mainMenu.addItem(fileItem)

    let editItem = NSMenuItem()
    let editMenu = NSMenu(title: "Edit")
    editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(
      withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = editMenu
    mainMenu.addItem(editItem)

    let viewItem = NSMenuItem()
    let viewMenu = NSMenu(title: "View")
    viewMenu.addItem(
      makeMenuItem("Command Palette…", action: #selector(showCommandPalette), key: "k"))
    viewMenu.addItem(.separator())
    for (index, section) in WorkbenchSection.allCases.enumerated() {
      let item = makeMenuItem(
        section.rawValue, action: #selector(showSection(_:)), key: String(index + 1))
      item.tag = index
      viewMenu.addItem(item)
    }
    viewItem.submenu = viewMenu
    mainMenu.addItem(viewItem)

    let windowItem = NSMenuItem()
    let windowMenu = NSMenu(title: "Window")
    windowMenu.addItem(
      withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(
      withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    windowItem.submenu = windowMenu
    mainMenu.addItem(windowItem)
    NSApp.windowsMenu = windowMenu
    NSApp.mainMenu = mainMenu
  }

  private func makeMenuItem(_ title: String, action: Selector, key: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    item.target = self
    return item
  }

  @objc private func openRepository() {
    model.section = .review
    model.choosingRepository = true
  }

  @objc private func showSettings() {
    model.section = .settings
  }

  @objc private func showCommandPalette() {
    model.commandPalettePresented = true
  }

  @objc private func showSection(_ sender: NSMenuItem) {
    guard WorkbenchSection.allCases.indices.contains(sender.tag) else { return }
    model.section = WorkbenchSection.allCases[sender.tag]
  }
}
