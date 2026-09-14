import AppKit
import SwiftUI

/// A read-only document plane. Drawing and highlighting are bounded to the viewport;
/// the full file remains in Rust and crosses the boundary in 512-line windows.
struct NavigatorSourceView: NSViewRepresentable {
  let file: NavigatorFile?
  let diff: NavigatorDiff?
  let split: Bool
  let selectedLine: Int
  let documentIdentity: String
  let refreshToken: UUID
  let findings: [VerificationFinding]
  var onWindow: (Int) -> Void
  var onSymbol: (String, String, Int, Int) -> Void
  var onLine: (Int) -> Void

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSScrollView, context: Context) -> CGSize?
  {
    CGSize(width: proposal.width ?? 400, height: proposal.height ?? 500)
  }

  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.hasVerticalScroller = true
    scroll.hasHorizontalScroller = true
    scroll.drawsBackground = false
    let canvas = NavigatorCanvas()
    scroll.documentView = canvas
    canvas.scroll = scroll
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    guard let canvas = scroll.documentView as? NavigatorCanvas else { return }
    canvas.onWindow = onWindow
    canvas.onSymbol = onSymbol
    canvas.onLine = onLine
    canvas.findings = findings
    let diffIdentity = diff.map {
      "\(documentIdentity):\($0.rows.count):\($0.rows.first?.text ?? "")"
    }
    let sourceIdentity = file.map { "\($0.blob):\($0.start)" }
    if canvas.sourceIdentity != sourceIdentity || canvas.diffIdentity != diffIdentity
      || canvas.split != split
    {
      canvas.sourceIdentity = sourceIdentity
      canvas.diffIdentity = diffIdentity
      canvas.file = file
      canvas.diff = diff
      canvas.split = split
      canvas.buildRows()
      canvas.highlightCache.removeAll()
    }
    let count = diff == nil ? file?.totalLines ?? 1 : canvas.rows.count
    let width = split ? max(scroll.contentSize.width, 400) : max(scroll.contentSize.width, 1000)
    canvas.setFrameSize(
      NSSize(
        width: width, height: max(scroll.contentSize.height, CGFloat(count) * canvas.rowHeight + 20)
      ))
    if canvas.refreshToken != refreshToken {
      canvas.refreshToken = refreshToken
      canvas.selectedSymbol = ""
      canvas.selectedColumn = 0
      canvas.selectedLine = selectedLine
      let row =
        diff == nil
        ? selectedLine - 1
        : canvas.rows.firstIndex { $0.left?.new == selectedLine || $0.right?.new == selectedLine }
          ?? 0
      canvas.scrollToVisible(
        NSRect(x: 0, y: CGFloat(row) * canvas.rowHeight, width: 1, height: canvas.rowHeight))
      canvas.selectedRow = row
    }
    canvas.updateAccessibleSelection()
    canvas.needsDisplay = true
  }
}

@MainActor
final class NavigatorCanvas: NSView {
  struct Row {
    var left: NavigatorDiffLine?
    var right: NavigatorDiffLine?
  }
  weak var scroll: NSScrollView?
  var file: NavigatorFile?
  var diff: NavigatorDiff?
  var sourceIdentity: String?
  var diffIdentity: String?
  var refreshToken: UUID?
  var split = false
  var selectedLine = 1
  var findings: [VerificationFinding] = []
  var rows: [Row] = []
  var onWindow: ((Int) -> Void)?
  var onSymbol: ((String, String, Int, Int) -> Void)?
  var onLine: ((Int) -> Void)?
  var requestedStart: Int?
  var selectedSymbol = ""
  var selectedColumn = 0
  var selectedRow = 0
  var selectedRight = false
  var highlightCache: [String: NSAttributedString] = [:]
  let rowHeight: CGFloat = 21
  private let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }

  override init(frame: NSRect) {
    super.init(frame: frame)
    setAccessibilityElement(true)
    setAccessibilityRole(.textArea)
    setAccessibilityLabel(
      "Read-only source. Arrow keys move lines; Command C copies the selected line.")
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func buildRows() {
    rows = []
    requestedStart = nil
    guard let diff else { return }
    guard split else {
      rows = diff.rows.map { Row(left: $0, right: nil) }
      return
    }
    var i = 0
    while i < diff.rows.count {
      let line = diff.rows[i]
      if line.kind == "delete" || line.kind == "add" {
        var removed: [NavigatorDiffLine] = []
        var added: [NavigatorDiffLine] = []
        while i < diff.rows.count, diff.rows[i].kind == "delete" {
          removed.append(diff.rows[i])
          i += 1
        }
        while i < diff.rows.count, diff.rows[i].kind == "add" {
          added.append(diff.rows[i])
          i += 1
        }
        for offset in 0..<max(removed.count, added.count) {
          rows.append(
            Row(
              left: offset < removed.count ? removed[offset] : nil,
              right: offset < added.count ? added[offset] : nil))
        }
      } else {
        rows.append(Row(left: line, right: line))
        i += 1
      }
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    (dark ? NSColor(calibratedWhite: 0.02, alpha: 1) : NSColor.white).setFill()
    dirtyRect.fill()
    let visible = visibleRect
    let first = max(0, Int(visible.minY / rowHeight))
    let last = max(first, Int(visible.maxY / rowHeight) + 1)
    if diff != nil {
      for index in first..<min(last, rows.count) {
        let y = CGFloat(index) * rowHeight
        if split {
          drawLine(rows[index].left, y: y, x: 0, width: bounds.width / 2, side: "base")
          drawLine(
            rows[index].right, y: y, x: bounds.width / 2, width: bounds.width / 2, side: "head")
        } else {
          drawLine(rows[index].left, y: y, x: 0, width: bounds.width, side: "head")
        }
      }
    } else if let file {
      let firstNeeded = first + 1
      if firstNeeded < file.start || min(last, file.totalLines) > file.start + file.lines.count {
        let block = max(0, first / 256) * 256 + 1
        if requestedStart != block {
          requestedStart = block
          DispatchQueue.main.async { [weak self] in self?.onWindow?(block) }
        }
      }
      for index in first..<min(last, file.totalLines) {
        let offset = index + 1 - file.start
        let text = file.lines.indices.contains(offset) ? file.lines[offset] : "Loading source…"
        drawLine(
          NavigatorDiffLine(old: nil, new: index + 1, kind: "source", text: text),
          y: CGFloat(index) * rowHeight, x: 0, width: bounds.width, side: "head")
      }
    }
    if split {
      NSColor.separatorColor.setFill()
      NSRect(x: bounds.width / 2, y: visible.minY, width: 1, height: visible.height).fill()
    }
  }

  private func drawLine(
    _ line: NavigatorDiffLine?, y: CGFloat, x: CGFloat, width: CGFloat, side: String
  ) {
    guard let line else { return }
    let number = side == "base" ? line.old : line.new ?? line.old
    let rect = NSRect(x: x, y: y, width: width, height: rowHeight)
    let color: NSColor? =
      line.kind == "add"
      ? .systemGreen : line.kind == "delete" ? .systemRed : line.kind == "hunk" ? .systemBlue : nil
    if let color {
      color.withAlphaComponent(0.09).setFill()
      rect.fill()
    }
    if number == selectedLine {
      NSColor.systemOrange.withAlphaComponent(0.10).setFill()
      rect.fill()
    }
    let numberText = line.kind == "hunk" ? "···" : number.map(String.init) ?? ""
    (numberText as NSString).draw(
      at: NSPoint(x: x + 9, y: y + 3),
      withAttributes: [.font: font, .foregroundColor: NSColor.secondaryLabelColor])
    if let number, findings.contains(where: { $0.line == number }) {
      NSColor.systemOrange.setFill()
      NSRect(x: x + 53, y: y + 7, width: 4, height: 7).fill()
    }
    let marker = line.kind == "add" ? "+" : line.kind == "delete" ? "−" : ""
    (marker as NSString).draw(
      at: NSPoint(x: x + 62, y: y + 3),
      withAttributes: [.font: font, .foregroundColor: color ?? NSColor.labelColor])
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(rect: NSRect(x: x + 78, y: y, width: max(0, width - 82), height: rowHeight))
      .addClip()
    highlighted(line.text).draw(at: NSPoint(x: x + 78, y: y + 3))
    NSGraphicsContext.restoreGraphicsState()
  }

  private func highlighted(_ text: String) -> NSAttributedString {
    if let cached = highlightCache[text] { return cached }
    let value = NSMutableAttributedString(
      string: text, attributes: [.font: font, .foregroundColor: NSColor.labelColor])
    let ns = text as NSString
    // Token color is a viewport-only reading aid, not a parser or semantic claim.
    let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    let keyword =
      dark
      ? NSColor(calibratedRed: 0.77, green: 0.62, blue: 0.89, alpha: 1)
      : NSColor(calibratedRed: 0.40, green: 0.18, blue: 0.60, alpha: 1)
    let string =
      dark
      ? NSColor(calibratedRed: 0.61, green: 0.79, blue: 0.57, alpha: 1)
      : NSColor(calibratedRed: 0.10, green: 0.40, blue: 0.22, alpha: 1)
    let patterns: [(String, NSColor)] = [
      (
        "\\b(import|export|from|const|let|var|function|return|if|else|class|struct|enum|func|pub|fn|async|await|throw|try|interface|type)\\b",
        keyword
      ), ("[\"'][^\"']*[\"']", string), ("//.*$", .secondaryLabelColor),
    ]
    for (pattern, color) in patterns {
      guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
      for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        value.addAttribute(.foregroundColor, value: color, range: match.range)
      }
    }
    if highlightCache.count > 600 { highlightCache.removeAll() }
    highlightCache[text] = value
    return value
  }

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    let point = convert(event.locationInWindow, from: nil)
    let row = max(0, Int(point.y / rowHeight))
    let line: NavigatorDiffLine?
    if diff != nil {
      line =
        rows.indices.contains(row)
        ? (split && point.x > bounds.width / 2 ? rows[row].right : rows[row].left) : nil
    } else {
      let offset = row + 1 - (file?.start ?? 1)
      line =
        file?.lines.indices.contains(offset) == true
        ? NavigatorDiffLine(old: nil, new: row + 1, kind: "source", text: file!.lines[offset]) : nil
    }
    guard let line else { return }
    selectedRow = row
    selectedRight = split && point.x > bounds.width / 2
    selectedLine = line.new ?? line.old ?? selectedLine
    onLine?(selectedLine)
    let localX = split && point.x > bounds.width / 2 ? point.x - bounds.width / 2 : point.x
    let chars = Array(line.text)
    var advance: CGFloat = 0
    let column =
      chars.firstIndex { character in
        advance += (String(character) as NSString).size(withAttributes: [.font: font]).width
        return advance > max(0, localX - 78)
      } ?? chars.count
    selectedSymbol = ""
    if chars.indices.contains(column) {
      let identifier: (Character) -> Bool = { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "$" }
      var lower = column
      var upper = column
      while lower > 0 && identifier(chars[lower - 1]) { lower -= 1 }
      while upper < chars.count && identifier(chars[upper]) { upper += 1 }
      selectedSymbol = String(chars[lower..<upper])
      selectedColumn = String(chars.prefix(column)).utf16.count
      if event.clickCount == 2, !selectedSymbol.isEmpty {
        onSymbol?(selectedSymbol, "definition", selectedLine, selectedColumn)
      }
    }
    updateAccessibleSelection()
    needsDisplay = true
  }

  override func keyDown(with event: NSEvent) {
    if event.keyCode == 126 || event.keyCode == 125 {
      moveSelection(by: event.keyCode == 126 ? -1 : 1)
    } else if event.keyCode == 123 || event.keyCode == 124 {
      moveColumn(by: event.keyCode == 123 ? -1 : 1)
    } else if event.keyCode == 111, !selectedSymbol.isEmpty {
      onSymbol?(
        selectedSymbol, event.modifierFlags.contains(.shift) ? "references" : "definition",
        selectedLine, selectedColumn)
    } else {
      super.keyDown(with: event)
    }
  }

  func moveColumn(by delta: Int) {
    guard diff == nil, let file, file.lines.indices.contains(selectedLine - file.start) else {
      return
    }
    let chars = Array(file.lines[selectedLine - file.start])
    var utf16Offset = 0
    var index = 0
    while index < chars.count, utf16Offset < selectedColumn {
      utf16Offset += String(chars[index]).utf16.count
      index += 1
    }
    index = max(0, min(chars.count, index + delta))
    selectedColumn = String(chars.prefix(index)).utf16.count
    selectedSymbol = ""
    let identifier: (Character) -> Bool = { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "$" }
    if index < chars.count, identifier(chars[index]) {
      var lower = index
      var upper = index
      while lower > 0, identifier(chars[lower - 1]) { lower -= 1 }
      while upper < chars.count, identifier(chars[upper]) { upper += 1 }
      selectedSymbol = String(chars[lower..<upper])
    }
    setAccessibilityValue(
      "Line \(selectedLine), column \(selectedColumn + 1): \(file.lines[selectedLine - file.start])"
    )
    NSAccessibility.post(element: self, notification: .valueChanged)
  }

  func moveSelection(by delta: Int) {
    selectedSymbol = ""
    if diff != nil {
      selectedRow = max(0, min(max(0, rows.count - 1), selectedRow + delta))
      if let line = selectedDiffLine { selectedLine = line.new ?? line.old ?? selectedLine }
    } else {
      selectedLine = max(1, min(file?.totalLines ?? 1, selectedLine + delta))
      selectedRow = selectedLine - 1
    }
    onLine?(selectedLine)
    scrollToVisible(NSRect(x: 0, y: CGFloat(selectedRow) * rowHeight, width: 1, height: rowHeight))
    updateAccessibleSelection()
    needsDisplay = true
  }

  private var selectedDiffLine: NavigatorDiffLine? {
    guard rows.indices.contains(selectedRow) else { return nil }
    let row = rows[selectedRow]
    return selectedRight ? row.right ?? row.left : row.left ?? row.right
  }

  func updateAccessibleSelection() {
    let value: String
    if diff != nil, let line = selectedDiffLine {
      value =
        "\(line.kind), base line \(line.old.map(String.init) ?? "none"), head line \(line.new.map(String.init) ?? "none"): \(line.text)"
    } else if let file, file.lines.indices.contains(selectedLine - file.start) {
      value = "Line \(selectedLine): \(file.lines[selectedLine - file.start])"
    } else {
      value = "Line \(selectedLine): loading source"
    }
    guard accessibilityValue() as? String != value else { return }
    setAccessibilityValue(value)
    NSAccessibility.post(element: self, notification: .valueChanged)
  }

  @objc func copy(_ sender: Any?) {
    if diff != nil, let line = selectedDiffLine {
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(line.text, forType: .string)
      return
    }
    let offset = selectedLine - (file?.start ?? 1)
    guard let file, file.lines.indices.contains(offset) else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(file.lines[offset], forType: .string)
  }

  override func menu(for event: NSEvent) -> NSMenu? {
    mouseDown(with: event)
    let menu = NSMenu()
    for (title, action) in [
      ("Find declaration", #selector(definition)),
      ("Find references", #selector(references)), ("Copy line", #selector(copy(_:))),
    ] {
      let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
      item.target = self
      menu.addItem(item)
    }
    return menu
  }
  @objc private func definition() {
    if !selectedSymbol.isEmpty {
      onSymbol?(selectedSymbol, "definition", selectedLine, selectedColumn)
    }
  }
  @objc private func references() {
    if !selectedSymbol.isEmpty {
      onSymbol?(selectedSymbol, "references", selectedLine, selectedColumn)
    }
  }
}
