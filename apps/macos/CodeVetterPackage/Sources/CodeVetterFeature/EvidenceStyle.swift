import SwiftUI

enum EvidenceStyle {
  static let ink = Color(red: 0.035, green: 0.038, blue: 0.044)
  static let amber = Color(red: 0.95, green: 0.64, blue: 0.19)
  static let amberForegroundNSColor = dynamicNSColor(dark: 0xF2A330, light: 0x8A4C00)
  static let amberForeground = Color(nsColor: amberForegroundNSColor)
  static let amberSoft = Color(red: 1.0, green: 0.76, blue: 0.35)
  static let successNSColor = dynamicNSColor(dark: 0x4DC77A, light: 0x1E6B3E)
  static let success = Color(nsColor: successNSColor)
  static let warningNSColor = dynamicNSColor(dark: 0xF2B040, light: 0x7A4A00)
  static let warning = Color(nsColor: warningNSColor)
  static let failureNSColor = dynamicNSColor(dark: 0xF05C70, light: 0xB4233B)
  static let failure = Color(nsColor: failureNSColor)
  static let panel = dynamicColor(dark: 0x030304, light: 0xFFFFFF)
  static let canvas = dynamicColor(dark: 0x000000, light: 0xF7F6F3)
  static let chrome = dynamicColor(dark: 0x000000, light: 0xF1F0ED)
  static let surface = dynamicColor(dark: 0x050506, light: 0xFFFFFF)
  static let inspector = dynamicColor(dark: 0x09090B, light: 0xF3F2EF)
  static let separator = Color.primary.opacity(0.09)

  private static func dynamicColor(dark: UInt32, light: UInt32) -> Color {
    Color(nsColor: dynamicNSColor(dark: dark, light: light))
  }

  private static func dynamicNSColor(dark: UInt32, light: UInt32) -> NSColor {
    NSColor(name: nil) { appearance in
      let value = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
      return NSColor(
        srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
        green: CGFloat((value >> 8) & 0xFF) / 255,
        blue: CGFloat(value & 0xFF) / 255,
        alpha: 1
      )
    }
  }
}

struct EvidencePanel<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .padding(18)
      .background(EvidenceStyle.panel.opacity(0.78), in: RoundedRectangle(cornerRadius: 12))
      .overlay {
        RoundedRectangle(cornerRadius: 12)
          .stroke(EvidenceStyle.separator, lineWidth: 1)
      }
  }
}

struct StatusPill: View {
  let label: String
  let color: Color

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(color).frame(width: 6, height: 6)
      Text(evidenceStatusLabel(label))
    }
    .font(.caption.weight(.medium))
    .padding(.horizontal, 9)
    .padding(.vertical, 5)
    .background(color.opacity(0.12), in: Capsule())
    .overlay { Capsule().stroke(color.opacity(0.22), lineWidth: 1) }
    .accessibilityLabel(evidenceStatusLabel(label))
  }
}

func evidenceStatusLabel(_ label: String) -> String {
  label.replacingOccurrences(of: "_", with: " ")
}
