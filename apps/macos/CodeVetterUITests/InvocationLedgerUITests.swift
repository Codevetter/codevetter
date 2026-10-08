import CryptoKit
import XCTest

final class InvocationLedgerUITests: XCTestCase {
  private var ledgerDirectory: URL!
  private var repositoryRoot: URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("../../..").standardizedFileURL
  }

  override func setUpWithError() throws {
    continueAfterFailure = false
    let parent = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
    ledgerDirectory = parent.appendingPathComponent("codevetter-ledger-ui-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: ledgerDirectory, withIntermediateDirectories: true)
    let receipt = try JSONSerialization.data(
      withJSONObject: [
        "schema_version": "codevetter.ui-fixture/v1", "allowed": false,
      ], options: [.sortedKeys])
    let hash = SHA256.hash(data: receipt).map { String(format: "%02x", $0) }.joined()
    for index in 0..<130 {
      let identity = String(format: "00000000-0000-4000-8000-%012d", index)
      let session = ledgerDirectory.appendingPathComponent(identity)
      try FileManager.default.createDirectory(at: session, withIntermediateDirectories: true)
      let metadata: [String: Any] = [
        "schema_version": "codevetter.skill-invocation/v1", "invocation_id": identity,
        "repo_path": "/synthetic/ui-repository", "skill": "codevetter-testing",
        "command": "scope", "agent": "codex", "state": "completed", "exit_code": 0,
        "started_at": "2026-10-08T11:00:00Z", "receipt_sha256": hash,
        "receipt_schema_version": "codevetter.ui-fixture/v1",
        "receipt_path": "/informational/path-not-followed.json",
      ]
      try JSONSerialization.data(withJSONObject: metadata).write(
        to: session.appendingPathComponent("invocation.json"))
      try receipt.write(to: session.appendingPathComponent("receipt.json"))
    }
  }

  override func tearDownWithError() throws {
    // Only the disposable test-owned ledger; no personal recorder is consulted.
    if let ledgerDirectory { try FileManager.default.removeItem(at: ledgerDirectory) }
  }

  @MainActor
  func testExplicitLedgerPaginationReceiptFieldAndExactExport() throws {
    let app = try launchLedger()
    XCTAssertTrue(app.staticTexts["1–100 of 130 invocations"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Unknown"].firstMatch.exists)
    app.buttons["Next"].click()
    XCTAssertTrue(app.staticTexts["101–130 of 130 invocations"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Next"].isEnabled)
    app.buttons["Previous"].click()
    XCTAssertTrue(app.staticTexts["1–100 of 130 invocations"].waitForExistence(timeout: 10))

    let export = ledgerDirectory.appendingPathComponent("page-export.json")
    app.buttons["Export page…"].click()
    try finishSavePanel(app, destination: export)
    let page = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: export)) as? [String: Any])
    XCTAssertEqual(page["schema_version"] as? String, "codevetter.invocation-events/v1")
    XCTAssertEqual(page["total"] as? Int, 130)
    XCTAssertEqual((page["invocations"] as? [[String: Any]])?.count, 100)

    let inspector = app.scrollViews["invocation-receipt-inspector"]
    let pointer = app.textFields["Captured receipt JSON pointer"]
    for _ in 0..<10 where !pointer.isHittable { inspector.swipeUp() }
    XCTAssertTrue(pointer.isHittable)
    pointer.click()
    pointer.typeText("/allowed")
    app.buttons["Read captured receipt"].click()
    XCTAssertTrue(app.staticTexts["false"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["/allowed"].exists)
    let fieldExport = ledgerDirectory.appendingPathComponent("field-export.json")
    app.buttons["Export receipt view…"].click()
    try finishSavePanel(app, destination: fieldExport)
    let field = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: fieldExport)) as? [String: Any])
    XCTAssertEqual(field["json_pointer"] as? String, "/allowed")
    XCTAssertEqual(field["value"] as? Bool, false)
    capture(app, name: "receipt-field")
  }

  @MainActor
  func testRuntimeLedgerWindowsAtThreeLogicalWidths() throws {
    for appearance in ["dark", "light"] {
      let app = try launchLedger(appearance: appearance)
      XCTAssertTrue(app.staticTexts["1–100 of 130 invocations"].waitForExistence(timeout: 10))
      let window = app.windows.firstMatch
      for width in [980.0, 1180.0, 1380.0] {
        let before = window.frame
        // Rounded corners fall outside the actual window's hit region. Resize
        // along the straight native edges, retaining real mouse interaction.
        let bottom = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1))
          .withOffset(CGVector(dx: 0, dy: -1))
        bottom.press(
          forDuration: 0.1,
          thenDragTo: bottom.withOffset(CGVector(dx: 0, dy: 700 - before.height)))
        let right = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5))
          .withOffset(CGVector(dx: -1, dy: 0))
        right.press(
          forDuration: 0.1,
          thenDragTo: right.withOffset(CGVector(dx: width - window.frame.width, dy: 0)))
        capture(app, name: "resize-attempt-\(Int(width))-\(appearance)", window: window)
        let resized = NSPredicate { _, _ in abs(window.frame.width - width) <= 1 }
        XCTAssertEqual(
          XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: resized, object: nil)], timeout: 3),
          .completed
        )
        XCTAssertEqual(window.frame.width, width, accuracy: 1)
        capture(app, name: "ledger-\(Int(width))-\(appearance)", window: window)
      }
      app.terminate()
    }
  }

  @MainActor
  private func launchLedger(appearance: String = "dark") throws -> XCUIApplication {
    let app = XCUIApplication()
    let executable = repositoryRoot.appendingPathComponent(
      "crates/codevetter-core/target/debug/codevetter")
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw NSError(
        domain: "InvocationLedgerUITests", code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Build the current Rust CLI before invocation UI qualification."
        ])
    }
    app.launchEnvironment["CODEVETTER_CLI_PATH"] = executable.path
    app.launchArguments = ["--ui-test-section", "Runs", "--appearance", appearance]
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)
    XCTAssertTrue(app.buttons["Choose ledger…"].waitForExistence(timeout: 10))
    capture(app, name: "before-chooser-\(appearance)")
    app.buttons["Choose ledger…"].click()
    app.typeKey("g", modifierFlags: [.command, .shift])
    capture(app, name: "go-to-ledger-\(appearance)")
    let pathField = app.sheets["GoToWindow"].textFields["PathTextField"]
    XCTAssertTrue(pathField.waitForExistence(timeout: 5))
    pathField.typeText(ledgerDirectory.path)
    app.typeKey(.return, modifierFlags: [])
    let open = app.dialogs["open-panel"].buttons["OKButton"]
    XCTAssertTrue(open.waitForExistence(timeout: 5))
    open.click()
    return app
  }

  @MainActor
  private func finishSavePanel(_ app: XCUIApplication, destination: URL) throws {
    capture(app, name: "before-save-\(destination.lastPathComponent)")
    app.typeKey("g", modifierFlags: [.command, .shift])
    let pathField = app.sheets["GoToWindow"].textFields["PathTextField"]
    XCTAssertTrue(pathField.waitForExistence(timeout: 5))
    pathField.typeText(destination.deletingLastPathComponent().path)
    app.typeKey(.return, modifierFlags: [])
    let filename = app.dialogs.textFields.matching(
      NSPredicate(format: "value BEGINSWITH %@", "codevetter-invocation")
    ).firstMatch
    XCTAssertTrue(filename.waitForExistence(timeout: 5))
    filename.click()
    filename.typeKey("a", modifierFlags: .command)
    filename.typeText(destination.lastPathComponent)
    capture(app, name: "ready-save-\(destination.lastPathComponent)")
    let save = app.dialogs.buttons["Save"]
    XCTAssertTrue(save.waitForExistence(timeout: 5))
    save.click()
    let written = NSPredicate { _, _ in FileManager.default.fileExists(atPath: destination.path) }
    XCTAssertEqual(
      XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: written, object: nil)], timeout: 5),
      .completed)
  }

  @MainActor
  private func capture(_ app: XCUIApplication, name: String, window: XCUIElement? = nil) {
    retainNativeRuntimeEvidence(testCase: self, app: app, name: name, window: window)
  }
}

@MainActor
func dismissNativeFirstRunIfPresented(testCase: XCTestCase, app: XCUIApplication) {
  // With the actual CLI present, its incomplete onboarding receipt opens the
  // real first-run sheet. Use the product's dismissal action before testing
  // workbench controls underneath; do not force model state or hide the sheet.
  let onboarding = app.descendants(matching: .any)["native-onboarding"]
  guard onboarding.waitForExistence(timeout: 5) else { return }
  retainNativeRuntimeEvidence(testCase: testCase, app: app, name: "first-run-onboarding")
  let notNow = app.buttons["Not now"]
  XCTAssertTrue(notNow.isHittable, "First-run dismissal must be reachable")
  notNow.click()
  XCTAssertTrue(onboarding.waitForNonExistence(timeout: 5), "First-run sheet did not dismiss")
}

@MainActor
func retainNativeRuntimeEvidence(
  testCase: XCTestCase, app: XCUIApplication, name: String, window: XCUIElement? = nil
) {
  let window = window ?? app.windows.firstMatch
  let screenshot = window.screenshot()
  let attachment = XCTAttachment(screenshot: screenshot)
  attachment.name = name
  attachment.lifetime = .keepAlways
  testCase.add(attachment)
  let tree = XCTAttachment(string: app.debugDescription)
  tree.name = name + " accessibility"
  tree.lifetime = .keepAlways
  testCase.add(tree)
  // The hosted UI-test runner cannot write into the source checkout. Keep its
  // own permitted temporary directory and collect these files after the test.
  let output = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
    .appendingPathComponent(
      "codevetter-runtime-invocations-\(ProcessInfo.processInfo.processIdentifier)")
  let safeName = name.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" }
  let stem = String(safeName)
  do {
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    print("CODEVETTER_RUNTIME_CAPTURE_ROOT=\(output.path)")
    try screenshot.pngRepresentation.write(to: output.appendingPathComponent(stem + ".png"))
    try app.debugDescription.write(
      to: output.appendingPathComponent(stem + ".accessibility.txt"),
      atomically: true, encoding: .utf8)
    let dimensions: [String: Any] = [
      "width": window.frame.width, "height": window.frame.height,
      "method": "XCUIApplication actual window capture on dedicated CI desktop",
      "content": "synthetic recorder fixture; independent benefit remains unknown",
    ]
    try JSONSerialization.data(withJSONObject: dimensions, options: [.sortedKeys])
      .write(to: output.appendingPathComponent(stem + ".json"))
  } catch { XCTFail("Could not retain runtime capture: \(error)") }
}
