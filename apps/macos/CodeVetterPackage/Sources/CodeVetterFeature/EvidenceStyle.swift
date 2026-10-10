import SwiftUI
import SaaSMakerUI

enum EvidenceStyle {
  static let ink = Color(red: 0.035, green: 0.038, blue: 0.044)
  static let amber = Color(red: 0.72, green: 0.47, blue: 0.14)
  static let amberForegroundNSColor = dynamicNSColor(dark: 0xC9903C, light: 0x744100)
  static let amberForeground = Color(nsColor: amberForegroundNSColor)
  static let amberSoft = Color(red: 0.82, green: 0.59, blue: 0.27)
  static let successNSColor = dynamicNSColor(dark: 0x4DC77A, light: 0x1E6B3E)
  static let success = Color(nsColor: successNSColor)
  static let warningNSColor = dynamicNSColor(dark: 0xF2B040, light: 0x7A4A00)
  static let warning = Color(nsColor: warningNSColor)
  static let failureNSColor = dynamicNSColor(dark: 0xF05C70, light: 0xB4233B)
  static let failure = Color(nsColor: failureNSColor)
  static let panel = dynamicColor(dark: 0x000000, light: 0xFFFFFF)
  static let canvas = dynamicColor(dark: 0x000000, light: 0xF7F6F3)
  static let chrome = dynamicColor(dark: 0x000000, light: 0xF1F0ED)
  static let surface = dynamicColor(dark: 0x020203, light: 0xFFFFFF)
  static let inspector = dynamicColor(dark: 0x050506, light: 0xF3F2EF)
  static let separator = Color.primary.opacity(0.14)

  /// One product palette, resolved for the native appearance rather than forcing dark mode.
  static func palette(for scheme: ColorScheme) -> SMPalette {
    var palette = SMPalette.ink.brand(amber, foreground: .black, soft: amber.opacity(0.12))
    palette.isDark = scheme == .dark
    palette.background = canvas
    palette.foreground = .primary
    palette.surface = surface
    palette.card = panel
    palette.secondary = inspector
    palette.muted = inspector
    palette.mutedForeground = .secondary
    palette.border = separator
    palette.hairline = separator
    palette.input = surface
    palette.primary = surface
    palette.primaryForeground = .primary
    palette.accent = amberForeground
    palette.accentInk = amberForeground
    palette.toneInk = ink
    palette.success = success
    palette.warning = warning
    palette.destructive = failure
    // SMCard adds four points to the theme radius.
    palette.radius = 2
    palette.displayWeight = 600
    palette.displayTracking = -0.014
    palette.accentItalic = false
    palette.accentSerif = false
    palette.accentFont = palette.displayFont
    return palette
  }

  static func headingFont(_ size: CGFloat) -> Font {
    .custom(SMPalette.ink.displayFont, size: size).weight(.semibold)
  }

  static func labelFont(_ size: CGFloat) -> Font {
    .custom(SMPalette.ink.sansFont, size: size).weight(.medium)
  }

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
    SMCard(padding: 18) { content }
      // Clip the library's decorative shadow: evidence planes stay flat.
      .clipShape(RoundedRectangle(cornerRadius: 6))
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
    .font(.custom(SMPalette.ink.monoFont, size: 11).weight(.medium))
    .foregroundStyle(color)
    .padding(.vertical, 3)
    .accessibilityLabel(evidenceStatusLabel(label))
  }
}

func evidenceStatusLabel(_ label: String) -> String {
  label.replacingOccurrences(of: "_", with: " ")
}

/// Apply the library style through SwiftUI so its palette environment is resolved.
private struct PremiumButtonChrome: ViewModifier {
  let primary: Bool
  @Environment(\.smPalette) private var palette
  @Environment(\.isEnabled) private var isEnabled

  func body(content: Content) -> some View {
    content
      .buttonStyle(SMButtonStyle(.link))
      .padding(.horizontal, primary ? 14 : 10)
      .frame(minHeight: primary ? 40 : 36)
      .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 6))
      .overlay {
        RoundedRectangle(cornerRadius: 6)
          .stroke(primary && isEnabled ? EvidenceStyle.amberForeground.opacity(0.65) : EvidenceStyle.separator)
      }
      .opacity(isEnabled ? 1 : 0.5)
      .environment(\.smPalette, buttonPalette)
  }

  private var buttonPalette: SMPalette {
    var palette = palette
    palette.brand = primary ? EvidenceStyle.amberForeground : .primary
    return palette
  }
}

extension View {
  func premiumPrimaryButton() -> some View {
    modifier(PremiumButtonChrome(primary: true))
  }

  func premiumSecondaryButton() -> some View {
    modifier(PremiumButtonChrome(primary: false))
  }
}
