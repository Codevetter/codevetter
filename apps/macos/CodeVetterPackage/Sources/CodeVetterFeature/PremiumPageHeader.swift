import SwiftUI
import SaaSMakerUI

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
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 18) {
        identity
        HStack(spacing: 10) { trailing }
          .fixedSize(horizontal: true, vertical: false)
      }
      VStack(alignment: .leading, spacing: 12) {
        identity
        HStack(spacing: 10) { trailing }
      }
    }
    .controlSize(.large)
    .padding(.horizontal, PremiumPageLayout.horizontalInset)
    .padding(.vertical, PremiumPageLayout.verticalInset)
    .frame(minHeight: 68)
    .background(EvidenceStyle.chrome)
  }

  private var identity: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(eyebrow.lowercased())
        .font(EvidenceStyle.labelFont(10))
        .foregroundStyle(EvidenceStyle.amberForeground)
      SMSectionHeader(title.lowercased(), size: 22)
      Text(subtitle)
        .font(EvidenceStyle.labelFont(11))
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
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
