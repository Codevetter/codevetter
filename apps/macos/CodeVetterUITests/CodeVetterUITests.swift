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
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)
    XCTAssertTrue(app.textFields.ci("navigator-github-url").waitForExistence(timeout: 5))
    for destination in [
      "Explore", "Review", "Testing", "Performance", "Runs", "Settings",
    ] {
      XCTAssertTrue(app.buttons.ci(destination).exists, "Missing retained surface: \(destination)")
    }

    XCTAssertFalse(app.buttons.ci("Usage").exists)

    app.buttons.ci("Runs").click()
    assertSelected(app.buttons.ci("Runs"))
    XCTAssertTrue(app.staticTexts.ci("INVOCATION LEDGER").waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons.ci("Choose ledger…").exists)
    let verificationResults = app.radioButtons.ci("Verification results")
    XCTAssertTrue(verificationResults.exists)
    verificationResults.click()
    XCTAssertTrue(app.staticTexts.ci("EVIDENCE LEDGER").waitForExistence(timeout: 5))
  }

  @MainActor
  func testCommandPaletteSearchesAndOpensAWorkspaceFromTheKeyboard() throws {
    let app = XCUIApplication()
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)
    XCTAssertTrue(app.textFields.ci("navigator-github-url").waitForExistence(timeout: 5))

    let palette = app.descendants(matching: .any)["command-palette"]
    openCommandPaletteWithKeyboard(app, palette: palette)
    let search = app.textFields.ci("command-palette-search")
    XCTAssertTrue(search.waitForExistence(timeout: 2))
    search.typeText("Performance")
    search.typeKey(.return, modifierFlags: [])

    XCTAssertTrue(palette.waitForNonExistence(timeout: 3))
    assertSelected(app.buttons.ci("workbench-section-performance"))
    XCTAssertTrue(
      app.descendants(matching: .any)["performance-workspace"].waitForExistence(timeout: 2))

    openCommandPaletteWithKeyboard(app, palette: palette)
    let reopenedSearch = app.textFields.ci("command-palette-search")
    XCTAssertTrue(reopenedSearch.waitForExistence(timeout: 2))
    reopenedSearch.typeKey(.downArrow, modifierFlags: [])
    reopenedSearch.typeKey(.return, modifierFlags: [])
    XCTAssertTrue(palette.waitForNonExistence(timeout: 3))
    assertSelected(app.buttons.ci("workbench-section-review"))

    openCommandPaletteWithKeyboard(app, palette: palette)
    app.typeKey(.escape, modifierFlags: [])
    XCTAssertTrue(palette.waitForNonExistence(timeout: 3))
    assertSelected(app.buttons.ci("workbench-section-review"))
  }

  @MainActor
  func testTestingWorkspaceExposesTheDirectPreviewContract() throws {
    let app = XCUIApplication()
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)

    app.buttons.ci("Testing").click()

    assertSelected(app.buttons.ci("Testing"))
    XCTAssertTrue(
      app.descendants(matching: .any)["testing-workspace"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons.ci("Choose testing repository").exists)
    XCTAssertTrue(app.radioButtons.ci("Git range").exists)
    XCTAssertTrue(app.radioButtons.ci("GitHub pull request").exists)
    let advancedSetup = app.descendants(matching: .any)["advanced-testing-setup"]
    XCTAssertTrue(advancedSetup.exists)
    advancedSetup.click()
    XCTAssertTrue(app.checkBoxes["Allow this bounded preview verification"].exists)
    XCTAssertTrue(app.buttons.ci("Run preview proof").exists)
    XCTAssertFalse(app.buttons.ci("Run preview proof").isEnabled)
    XCTAssertTrue(app.staticTexts.ci("WHAT HAPPENS NEXT").exists)
    XCTAssertTrue(app.buttons.ci("Use Review comparison").exists)
    XCTAssertFalse(app.buttons.ci("Use Review comparison").isEnabled)
  }

  @MainActor
  func testTestingWorkspaceExposesEveryMigratedForegroundWorkbench() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "--ui-test-repository", testingRepository.path,
      "--ui-test-section", "Testing",
    ]
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)

    assertSelected(app.buttons.ci("Testing"))
    for workspace in [
      ("Warm changed proof", "warm-verification-workspace"),
      ("Differential", "differential-verification-workspace"),
      ("Scenarios", "scenario-compiler-workspace"),
      ("PR watcher", "trex-watcher-workspace"),
    ] {
      app.menuButtons["Testing tools"].click()
      retainNativeRuntimeEvidence(testCase: self, app: app, name: "testing-tools-\(workspace.0)")
      let trigger = app.menuItems[workspace.0]
      XCTAssertTrue(trigger.waitForExistence(timeout: 3), "Missing \(workspace.0) trigger")
      XCTAssertTrue(trigger.isEnabled, "\(workspace.0) should be reachable with a repository")
      trigger.click()
      let surface = app.descendants(matching: .any)[workspace.1]
      XCTAssertTrue(surface.waitForExistence(timeout: 5), "Missing \(workspace.1)")
      XCTAssertTrue(app.buttons.ci("Done").waitForExistence(timeout: 2))
      app.buttons.ci("Done").click()
      XCTAssertTrue(surface.waitForNonExistence(timeout: 3), "\(workspace.0) did not dismiss")
    }
  }

  @MainActor
  func testRetiredUsageLaunchRouteOpensExplore() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--ui-test-section", "Usage"]
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)
    assertSelected(app.buttons.ci("Explore"))
    XCTAssertFalse(app.buttons.ci("Usage").exists)
  }

  @MainActor
  func testExploreStartsWithReadOnlyGitHubImport() throws {
    let app = XCUIApplication()
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)

    app.buttons.ci("Explore").click()
    assertSelected(app.buttons.ci("Explore"))
    XCTAssertTrue(
      app.textFields.ci("navigator-github-url").waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons.ci("Open local repository…").exists)
    XCTAssertTrue(app.buttons.ci("Verify a local change").isHittable)
    XCTAssertTrue(
      app.staticTexts.ci("Read-only by design. Repository code does not run when you open it.").exists)
    app.menuBars.menuBarItems["File"].click()
    app.menuItems["Open Repository…"].click()
    XCTAssertTrue(app.sheets.firstMatch.waitForExistence(timeout: 3))
    app.typeKey(.escape, modifierFlags: [])
  }

  @MainActor
  func testReviewWorkspaceExposesIndependentClaudeAndCodexStrategy() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "--ui-test-repository", testingRepository.path,
      "--ui-test-section", "Review",
    ]
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)

    assertSelected(app.buttons.ci("Review"))
    app.buttons.ci("Verify a local change").click()
    retainNativeRuntimeEvidence(testCase: self, app: app, name: "review-strategy-after-click")
    let strategy = app.descendants(matching: .any)["review-strategy"]
    XCTAssertTrue(strategy.waitForExistence(timeout: 3))
    XCTAssertTrue(app.radioButtons.ci("Claude").exists)
    XCTAssertTrue(app.radioButtons.ci("Codex").exists)
    let cross = app.radioButtons.ci("Claude + Codex")
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
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)

    app.buttons.ci("Settings").click()

    assertSelected(app.buttons.ci("Settings"))
    XCTAssertTrue(app.staticTexts.ci("PREFERENCES AND CONNECTIONS").waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts.ci("SETTINGS SECTIONS").exists)
    XCTAssertTrue(app.buttons.ci("Refresh general settings").exists)
    XCTAssertTrue(app.staticTexts.ci("Saved on this Mac").exists)
    for section in [
      "General", "Appearance", "Integrations", "Agents", "Agent MCP", "Notifications", "History",
      "Rubrics", "Ops", "Memories", "About",
    ] {
      XCTAssertTrue(app.buttons.ci(section).exists, "Missing settings section: \(section)")
    }

    selectSettingsSection("mcp", in: app)
    XCTAssertTrue(app.buttons.ci("Refresh mcp settings").exists)

    selectSettingsSection("usage", in: app)
    XCTAssertTrue(app.buttons.ci("Refresh usage settings").waitForExistence(timeout: 5))

    selectSettingsSection("rubrics", in: app)
    XCTAssertTrue(
      app.descendants(matching: .any)["rubric-settings-workspace"].waitForExistence(timeout: 5),
      "Rubrics workspace did not open"
    )

    // Exercise both ends of the rail after content changes, not just rows that
    // happen to be visible at launch. Selection must follow one real click.
    selectSettingsSection("about", in: app)
    XCTAssertTrue(app.buttons.ci("Refresh about settings").exists)
    selectSettingsSection("general", in: app)
    XCTAssertTrue(app.buttons.ci("Refresh general settings").exists)
  }

  @MainActor
  func testPerformanceWorkspaceExposesTheRustAdmissionContract() throws {
    let app = XCUIApplication()
    app.launch()
    app.activate()
    dismissNativeFirstRunIfPresented(testCase: self, app: app)

    app.buttons.ci("Performance").click()

    assertSelected(app.buttons.ci("Performance"))
    XCTAssertTrue(
      app.descendants(matching: .any)["performance-workspace"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons.ci("Choose performance repository").exists)
    XCTAssertTrue(app.popUpButtons["Performance adapter"].exists)
    XCTAssertTrue(app.buttons.ci("performance-scope-planner-resolve").exists)
    let advancedSource = app.descendants(matching: .any)["advanced-performance-source-options"]
    XCTAssertTrue(advancedSource.exists)
    advancedSource.click()
    XCTAssertTrue(app.buttons.ci("Plan").exists)
    XCTAssertFalse(app.buttons.ci("Plan").isEnabled)
    XCTAssertTrue(app.buttons.ci("Capture evidence").exists)
    XCTAssertFalse(app.buttons.ci("Capture evidence").isEnabled)
    XCTAssertTrue(app.staticTexts.ci("Choose a workload, then plan the measurement.").exists)
    XCTAssertTrue(app.staticTexts.ci("Planning does not execute project code").exists)
  }

  @MainActor
  func testLaunchPerformance() {
    measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)]) {
      XCUIApplication().launch()
    }
  }

  @MainActor
  private func selectSettingsSection(
    _ section: String,
    in app: XCUIApplication,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let rail = app.scrollViews["settings-section-rail"]
    let button = app.buttons.ci("settings-section-\(section)")
    guard rail.waitForExistence(timeout: 2), button.waitForExistence(timeout: 2) else {
      XCTFail("Missing settings rail or section: \(section)", file: file, line: line)
      return
    }

    // A row above this viewport can still have a screen coordinate inside the
    // window header. Hosted XCTest clicked that point without auto-scrolling.
    // Use real, bounded rail scrolling before a single click; never force state
    // or retry a click that did not select its target.
    for _ in 0..<8 {
      let viewport = rail.frame
      let target = button.frame
      guard !viewport.isEmpty, !target.isEmpty else { break }
      if viewport.contains(target) { break }
      let distance = max(50, viewport.height * 0.7)
      if target.minY < viewport.minY {
        rail.scroll(byDeltaX: 0, deltaY: distance)
      } else if target.maxY > viewport.maxY {
        rail.scroll(byDeltaX: 0, deltaY: -distance)
      } else {
        break
      }
    }
    guard !button.frame.isEmpty, rail.frame.contains(button.frame), button.isHittable else {
      XCTFail(
        "Settings section \(section) is not visible/hittable: button=\(button.frame), rail=\(rail.frame)",
        file: file, line: line)
      return
    }
    print("SETTINGS_RAIL_CLICK section=\(section) button=\(button.frame) rail=\(rail.frame)")
    button.click()
    assertSelected(button, file: file, line: line)
    XCTAssertTrue(
      button.isHittable, "Selected section is not hittable: \(section)", file: file, line: line)
    XCTAssertTrue(
      !button.frame.isEmpty && rail.frame.intersects(button.frame),
      "Selected section \(section) remains clipped: button=\(button.frame), rail=\(rail.frame)",
      file: file, line: line
    )
    print("SETTINGS_RAIL_SELECTED section=\(section) button=\(button.frame) rail=\(rail.frame)")
  }

  @MainActor
  private func assertSelected(
    _ element: XCUIElement,
    timeout: TimeInterval = 3,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    retainNativeRuntimeEvidence(
      testCase: self, app: XCUIApplication(), name: "\(name)-selection-\(element.identifier)")
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
