import SwiftUI

struct PremiumScopePlanner: View {
  let title: String
  let subtitle: String
  @Binding var kind: EvidenceScopeKind
  @Binding var value: String
  let plan: EvidenceScopePlan?
  let loading: Bool
  let issue: String?
  let canResolve: Bool
  let selectedCandidateID: String?
  let compact: Bool
  let accessibilityID: String
  let onResolve: () -> Void
  let onSelect: (EvidenceScopeCandidate) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 11 : 14) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          Text(title.uppercased())
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(0.9)
            .foregroundStyle(EvidenceStyle.amberForeground)
          Text(subtitle)
            .font(.system(size: compact ? 10 : 11))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 8)
        if loading {
          ProgressView().controlSize(.small).tint(EvidenceStyle.amber)
        }
      }

      Picker("Discovery scope", selection: $kind) {
        Text("Flow").tag(EvidenceScopeKind.flow)
        Text("Change").tag(EvidenceScopeKind.change)
        Text("Codebase").tag(EvidenceScopeKind.codebase)
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .tint(EvidenceStyle.amber)

      if kind != .codebase {
        HStack(spacing: 9) {
          Image(
            systemName: kind == .flow
              ? "point.3.connected.trianglepath.dotted" : "arrow.triangle.branch"
          )
          .font(.system(size: 11))
          .foregroundStyle(EvidenceStyle.amberForeground)
          TextField(
            kind == .flow ? "checkout, authentication, search…" : "main...HEAD or pull request URL",
            text: $value
          )
          .textFieldStyle(.plain)
          .font(.system(size: 11, design: kind == .change ? .monospaced : .default))
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .premiumField()
      }

      HStack(spacing: 10) {
        Button(plan == nil ? "Discover targets" : "Refresh targets", action: onResolve)
          .buttonStyle(.bordered)
          .disabled(!canResolve)
          .accessibilityIdentifier("\(accessibilityID)-resolve")
        if let plan {
          Text("\(plan.candidates.count) runnable · \(plan.uncoveredPaths.count) uncovered")
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }

      if let issue {
        Label(issue, systemImage: "exclamationmark.triangle.fill")
          .font(.system(size: 9, weight: .medium))
          .foregroundStyle(EvidenceStyle.failure)
          .fixedSize(horizontal: false, vertical: true)
      }

      if let plan {
        if plan.candidates.isEmpty {
          Text("No closed runnable target matched this scope. CodeVetter did not invent one.")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        } else {
          VStack(spacing: 7) {
            ForEach(plan.candidates.prefix(compact ? 3 : 5)) { candidate in
              Button {
                onSelect(candidate)
              } label: {
                HStack(alignment: .top, spacing: 9) {
                  Image(
                    systemName: selectedCandidateID == candidate.id
                      ? "checkmark.circle.fill" : "circle"
                  )
                  .font(.system(size: 12, weight: .semibold))
                  .foregroundStyle(
                    selectedCandidateID == candidate.id
                      ? EvidenceStyle.amberForeground : Color.secondary
                  )
                  VStack(alignment: .leading, spacing: 3) {
                    Text(candidate.name ?? candidate.target)
                      .font(.system(size: 10, weight: .semibold, design: .monospaced))
                      .foregroundStyle(.primary)
                      .lineLimit(1)
                      .truncationMode(.middle)
                    Text(
                      "\(candidate.adapter) · \(candidate.confidenceLabel) · \(candidate.reason)"
                    )
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(compact ? 1 : 2)
                  }
                  Spacer(minLength: 0)
                }
                .padding(9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                  selectedCandidateID == candidate.id
                    ? EvidenceStyle.amber.opacity(0.08) : EvidenceStyle.canvas.opacity(0.65),
                  in: RoundedRectangle(cornerRadius: 9)
                )
                .overlay {
                  RoundedRectangle(cornerRadius: 9).stroke(
                    selectedCandidateID == candidate.id
                      ? EvidenceStyle.amber.opacity(0.45) : EvidenceStyle.separator
                  )
                }
              }
              .buttonStyle(.plain)
            }
          }
        }

        if let limitation = plan.limitations.first {
          Text(limitation)
            .font(.system(size: 8.5))
            .foregroundStyle(.tertiary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(compact ? 13 : 15)
    .background(EvidenceStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    .overlay { RoundedRectangle(cornerRadius: 12).stroke(EvidenceStyle.separator) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier(accessibilityID)
  }
}
