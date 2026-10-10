import XCTest

extension XCUIElementQuery {
  /// The UI voice is lowercase; match identifiers and labels without regard to case.
  func ci(_ text: String) -> XCUIElement {
    matching(
      NSPredicate(
        format: "identifier ==[c] %@ OR label ==[c] %@ OR title ==[c] %@ OR placeholderValue ==[c] %@",
        text, text, text, text)
    ).firstMatch
  }
}
