import SwiftUI

struct CodeVetterBrandMark: View {
  let size: CGFloat

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.219, style: .continuous)
        .fill(Color(red: 5 / 255, green: 5 / 255, blue: 6 / 255))
        .frame(width: size * 0.875, height: size * 0.875)
      ScopeBracket(side: .left)
        .stroke(
          Color(red: 243 / 255, green: 173 / 255, blue: 61 / 255),
          style: StrokeStyle(
            lineWidth: size * 0.07,
            lineCap: .round,
            lineJoin: .round
          )
        )
      ScopeBracket(side: .right)
        .stroke(
          Color(red: 243 / 255, green: 173 / 255, blue: 61 / 255),
          style: StrokeStyle(
            lineWidth: size * 0.07,
            lineCap: .round,
            lineJoin: .round
          )
        )
      EvidenceVerdict()
        .stroke(
          Color(red: 244 / 255, green: 244 / 255, blue: 245 / 255),
          style: StrokeStyle(
            lineWidth: size * 0.094,
            lineCap: .round,
            lineJoin: .round
          )
        )
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

private struct ScopeBracket: Shape {
  enum Side {
    case left
    case right
  }

  let side: Side

  func path(in rect: CGRect) -> Path {
    var path = Path()
    switch side {
    case .left:
      path.move(to: point(0.35, 0.307, in: rect))
      path.addLine(to: point(0.219, 0.5, in: rect))
      path.addLine(to: point(0.35, 0.693, in: rect))
    case .right:
      path.move(to: point(0.65, 0.307, in: rect))
      path.addLine(to: point(0.781, 0.5, in: rect))
      path.addLine(to: point(0.65, 0.693, in: rect))
    }
    return path
  }
}

private struct EvidenceVerdict: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: point(0.354, 0.404, in: rect))
    path.addLine(to: point(0.488, 0.639, in: rect))
    path.addLine(to: point(0.658, 0.33, in: rect))
    return path
  }
}

private func point(_ x: CGFloat, _ y: CGFloat, in rect: CGRect) -> CGPoint {
  CGPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
}
