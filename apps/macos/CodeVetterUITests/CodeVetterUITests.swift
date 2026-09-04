import XCTest

final class CodeVetterUITests: XCTestCase {
  private var testingRepository: URL!

  override func setUpWithError() throws {
    // Put setup code here. This method is called before the invocation of each test method in the class.

    // In UI tests it is usually best to stop immediately when a failure occurs.
    continueAfterFailure = false
    testingRepository = FileManager.default.temporaryDirectory
      .appending(path: "codevetter-ui-repository-\(UUID().uuidString)")
    try FileManager.default.createDirectory(
      at: testingRepository.appending(path: ".git"),
      withIntermediateDirectories: true
    )
    // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
  }

  override func tearDownWithError() throws {
    if let testingRepository {
      try? FileManager.default.removeItem(at: testingRepository)
    }
    // Put teardown code here. This method is called after the invocation of each test method in the class.
  }

  @MainActor
  func testPrimaryWorkbenchIsVisible() throws {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["Usage available"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Usage refresh"].exists)
    for destination in [
      "Usage", "Repo Unpack", "Review", "Testing", "Performance", "Runs", "Capabilities",
      "Settings",
    ] {
      XCTAssertTrue(app.buttons[destination].exists, "Missing retained surface: \(destination)")
    }

    app.menuBars.menuBarItems["View"].click()
    XCTAssertTrue(app.menuItems["Usage"].exists)
    app.typeKey(.escape, modifierFlags: [])
    app.typeKey("1", modifierFlags: .command)
    XCTAssertTrue(app.staticTexts["Usage available"].waitForExistence(timeout: 5))

    app.buttons["Runs"].click()
    assertSelected(app.buttons["Runs"])
    XCTAssertTrue(app.staticTexts["EVIDENCE LEDGER"].waitForExistence(timeout: 5))
  }

  @MainActor
  func testCommandPaletteSearchesAndOpensAWorkspaceFromTheKeyboard() throws {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["Usage available"].waitForExistence(timeout: 5))
    app.activate()

    let palette = app.descendants(matching: .any)["command-palette"]
    openCommandPaletteWithKeyboard(app, palette: palette)
    let search = app.textFields["command-palette-search"]
    XCTAssertTrue(search.waitForExistence(timeout: 2))
    search.typeText("Performance")
    search.typeKey(.return, modifierFlags: [])

    XCTAssertTrue(palette.waitForNonExistence(timeout: 3))
    assertSelected(app.buttons["workbench-section-performance"])
    XCTAssertTrue(
      app.descendants(matching: .any)["performance-workspace"].waitForExistence(timeout: 2))

    openCommandPaletteWithKeyboard(app, palette: palette)
    let reopenedSearch = app.textFields["command-palette-search"]
    XCTAssertTrue(reopenedSearch.waitForExistence(timeout: 2))
    reopenedSearch.typeKey(.downArrow, modifierFlags: [])
    reopenedSearch.typeKey(.downArrow, modifierFlags: [])
    reopenedSearch.typeKey(.return, modifierFlags: [])
    XCTAssertTrue(palette.waitForNonExistence(timeout: 3))
    assertSelected(app.buttons["workbench-section-review"])

    openCommandPaletteWithKeyboard(app, palette: palette)
    app.typeKey(.escape, modifierFlags: [])
    XCTAssertTrue(palette.waitForNonExistence(timeout: 3))
    assertSelected(app.buttons["workbench-section-review"])
  }

  @MainActor
  func testTestingWorkspaceExposesTheDirectPreviewContract() throws {
    let app = XCUIApplication()
    app.launch()

    app.buttons["Testing"].click()

    assertSelected(app.buttons["Testing"])
    XCTAssertTrue(
      app.descendants(matching: .any)["testing-workspace"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["Choose testing repository"].exists)
    XCTAssertTrue(app.radioButtons["Git range"].exists)
    XCTAssertTrue(app.radioButtons["GitHub pull request"].exists)
    app.descendants(matching: .any)["advanced-testing-setup"].click()
    XCTAssertTrue(
      app.descendants(matching: .any)["testing-scope-planner"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["testing-scope-planner-resolve"].exists)
    XCTAssertTrue(app.checkBoxes["Allow this bounded preview verification"].exists)
    XCTAssertTrue(app.buttons["Run preview proof"].exists)
    XCTAssertFalse(app.buttons["Run preview proof"].isEnabled)
    XCTAssertTrue(app.staticTexts["RUST EXECUTION CONTRACT"].exists)
    XCTAssertTrue(app.staticTexts["codevetter trex"].exists)
  }

  @MainActor
  func testTestingWorkspaceExposesEveryMigratedForegroundWorkbench() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "--ui-test-repository", testingRepository.path,
      "--ui-test-section", "Testing",
    ]
    app.launch()

    assertSelected(app.buttons["Testing"])
    for workspace in [
      ("Warm changed proof", "warm-verification-workspace"),
      ("Differential", "differential-verification-workspace"),
      ("Scenarios", "scenario-compiler-workspace"),
      ("PR watcher", "trex-watcher-workspace"),
    ] {
      app.menuButtons["Testing tools"].click()
      let trigger = app.menuItems[workspace.0]
      XCTAssertTrue(trigger.waitForExistence(timeout: 3), "Missing \(workspace.0) trigger")
      XCTAssertTrue(trigger.isEnabled, "\(workspace.0) should be reachable with a repository")
      trigger.click()
      let surface = app.descendants(matching: .any)[workspace.1]
      XCTAssertTrue(surface.waitForExistence(timeout: 5), "Missing \(workspace.1)")
      XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 2))
      app.buttons["Done"].click()
      XCTAssertTrue(surface.waitForNonExistence(timeout: 3), "\(workspace.0) did not dismiss")
    }
  }

  @MainActor
  func testUsageWorkspacePreservesLocalAndLiveProviderBoundaries() throws {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["Usage available"].waitForExistence(timeout: 5))

    let usageSection = app.buttons["workbench-section-usage"]
    XCTAssertTrue(usageSection.waitForExistence(timeout: 2))
    usageSection.click()

    assertSelected(app.buttons["workbench-section-usage"])
    XCTAssertTrue(app.staticTexts["Usage available"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["Live remaining allowance from Claude and Codex"].exists)
    XCTAssertTrue(app.buttons["Usage refresh"].exists)
  }

  @MainActor
  func testRepoUnpackWorkspacePreservesRustScanAndInspectionAuthority() throws {
    let app = XCUIApplication()
    app.launch()

    app.buttons["Repo Unpack"].click()

    assertSelected(app.buttons["Repo Unpack"])
    XCTAssertTrue(
      app.descendants(matching: .any)["repo-unpack-workspace"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["REPOSITORY MEMORY"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["SNAPSHOT LEDGER"].exists)
    XCTAssertTrue(
      app.descendants(matching: .any)["repo-unpack-read-only-status"].waitForExistence(timeout: 2)
    )
    XCTAssertTrue(app.buttons["Refresh Repo Unpack snapshots"].exists)
    XCTAssertTrue(app.staticTexts["Rust-owned local history"].exists)
    XCTAssertTrue(
      app.descendants(matching: .any)["repo-unpack-choose-repository"].exists
    )
    let scan = app.descendants(matching: .any)["repo-unpack-scan"]
    XCTAssertTrue(scan.exists)
    XCTAssertFalse(scan.isEnabled, "A scan requires an explicitly selected repository")
    XCTAssertTrue(app.descendants(matching: .any)["repo-unpack-export"].exists)
  }

  @MainActor
  func testReviewWorkspaceExposesIndependentClaudeAndCodexStrategy() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "--ui-test-repository", testingRepository.path,
      "--ui-test-section", "Review",
    ]
    app.launch()

    assertSelected(app.buttons["Review"])
    let strategy = app.descendants(matching: .any)["review-strategy"]
    XCTAssertTrue(strategy.waitForExistence(timeout: 3))
    XCTAssertTrue(app.radioButtons["Claude"].exists)
    XCTAssertTrue(app.radioButtons["Codex"].exists)
    let cross = app.radioButtons["Claude + Codex"]
    XCTAssertTrue(cross.exists)
    cross.click()
    XCTAssertTrue(
      app.staticTexts[
        "Runs independent Claude then Codex passes against the same immutable change. Agreement is coverage, not proof."
      ].waitForExistence(timeout: 4),
      "The selected strategy did not update the review contract"
    )
  }

  @MainActor
  func testSettingsWorkspaceExcludesSecretsAndPreservesEverySection() throws {
    let app = XCUIApplication()
    app.launch()

    app.buttons["Settings"].click()

    assertSelected(app.buttons["Settings"])
    XCTAssertTrue(app.staticTexts["LOCAL CONTROL PLANE"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["SETTINGS SECTIONS"].exists)
    XCTAssertTrue(app.buttons["Refresh native settings"].exists)
    XCTAssertTrue(app.staticTexts["Rust owns persistence"].exists)
    for section in [
      "General", "Appearance", "Integrations", "Agents", "Agent MCP", "Notifications", "Usage",
      "Rubrics", "Ops", "Memories", "About",
    ] {
      XCTAssertTrue(app.buttons[section].exists, "Missing settings section: \(section)")
    }

    let mcpSection = app.buttons["Agent MCP"]
    mcpSection.click()
    assertSelected(mcpSection)

    let usageSection = app.buttons["settings-section-usage"]
    usageSection.click()
    XCTAssertTrue(
      app.staticTexts["History recovery and guarded local archive retention."]
        .waitForExistence(timeout: 2))

    let rubricsSection = app.buttons["settings-section-rubrics"]
    rubricsSection.click()
    XCTAssertTrue(
      app.descendants(matching: .any)["rubric-settings-workspace"].waitForExistence(timeout: 5),
      "Rubrics workspace did not open"
    )
  }

  @MainActor
  func testPerformanceWorkspaceExposesTheRustAdmissionContract() throws {
    let app = XCUIApplication()
    app.launch()

    app.buttons["Performance"].click()

    assertSelected(app.buttons["Performance"])
    XCTAssertTrue(
      app.descendants(matching: .any)["performance-workspace"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["Choose performance repository"].exists)
    XCTAssertTrue(app.popUpButtons["Performance adapter"].exists)
    app.descendants(matching: .any)["advanced-performance-source-options"].click()
    XCTAssertTrue(
      app.descendants(matching: .any)["performance-scope-planner"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["performance-scope-planner-resolve"].exists)
    XCTAssertTrue(app.buttons["Plan"].exists)
    XCTAssertFalse(app.buttons["Plan"].isEnabled)
    XCTAssertTrue(app.buttons["Capture evidence"].exists)
    XCTAssertFalse(app.buttons["Capture evidence"].isEnabled)
    XCTAssertTrue(app.staticTexts["No performance claim without admission."].exists)
    XCTAssertTrue(app.staticTexts["Authority: codevetter performance"].exists)
  }

  @MainActor
  func testLaunchPerformance() {
    measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)]) {
      XCUIApplication().launch()
    }
  }

  @MainActor
  private func assertSelected(
    _ element: XCUIElement,
    timeout: TimeInterval = 3,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    XCTAssertTrue(
      waitUntilSelected(element, timeout: timeout),
      "Selection did not settle",
      file: file,
      line: line
    )
  }

  @MainActor
  private func waitUntilSelected(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
    let expectation = XCTNSPredicateExpectation(
      predicate: NSPredicate { object, _ in
        (object as? XCUIElement)?.isSelected == true
      },
      object: element
    )
    return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
  }

  @MainActor
  private func openCommandPaletteWithKeyboard(_ app: XCUIApplication, palette: XCUIElement) {
    app.menuBars.menuBarItems["View"].click()
    XCTAssertTrue(app.menuItems["Command Palette…"].waitForExistence(timeout: 2))
    app.typeKey("k", modifierFlags: .command)
    XCTAssertTrue(palette.waitForExistence(timeout: 3))
  }
}
