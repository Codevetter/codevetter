import SwiftUI

enum PremiumPageLayout {
  static let horizontalInset: CGFloat = 22
  static let verticalInset: CGFloat = 13
  static let minimumControlHeight: CGFloat = 36
  static let navigationControlHeight: CGFloat = 40
}

/// The shared visual contract for top-level workbench pages.
/// Feature-specific controls remain in `trailing`; page identity does not.
struct PremiumPageHeader<Trailing: View>: View {
  let eyebrow: String
  let title: String
  let subtitle: String
  private let trailing: Trailing

  init(
    eyebrow: String,
    title: String,
    subtitle: String,
    @ViewBuilder trailing: () -> Trailing
  ) {
    self.eyebrow = eyebrow
    self.title = title
    self.subtitle = subtitle
    self.trailing = trailing()
  }

  var body: some View {
    HStack(alignment: .top, spacing: 18) {
      VStack(alignment: .leading, spacing: 5) {
        Text(eyebrow.uppercased())
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.1)
          .foregroundStyle(EvidenceStyle.amberForeground)
        Text(title)
          .font(.system(size: 22, weight: .semibold))
          .tracking(-0.3)
        Text(subtitle)
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 18)
      HStack(spacing: 10) {
        trailing
      }
      .controlSize(.large)
    }
    .padding(.horizontal, PremiumPageLayout.horizontalInset)
    .padding(.vertical, PremiumPageLayout.verticalInset)
    .frame(minHeight: 68)
    .background(EvidenceStyle.chrome)
  }
}

extension PremiumPageHeader where Trailing == EmptyView {
  init(eyebrow: String, title: String, subtitle: String) {
    self.init(eyebrow: eyebrow, title: title, subtitle: subtitle) { EmptyView() }
  }
}

extension View {
  /// Makes custom native controls forgiving to click without changing their visual geometry.
  func premiumHitTarget(
    minWidth: CGFloat = PremiumPageLayout.minimumControlHeight,
    minHeight: CGFloat = PremiumPageLayout.minimumControlHeight
  ) -> some View {
    frame(minWidth: minWidth, minHeight: minHeight)
      .contentShape(Rectangle())
  }
}
