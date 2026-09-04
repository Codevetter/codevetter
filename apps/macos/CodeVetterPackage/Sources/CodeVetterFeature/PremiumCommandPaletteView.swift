import SwiftUI

struct PremiumCommandPaletteView: View {
  @Bindable var model: WorkbenchModel
  @Environment(\.dismiss) private var dismiss
  @FocusState private var searchFocused: Bool
  @State private var query = ""
  @State private var selectedIndex = 0

  private var matches: [WorkbenchSection] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !needle.isEmpty else { return WorkbenchSection.allCases }
    return WorkbenchSection.allCases.filter {
      $0.rawValue.localizedCaseInsensitiveContains(needle)
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 11) {
        Image(systemName: "command")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(EvidenceStyle.amberForeground)
        TextField("Search workspaces", text: $query)
          .textFieldStyle(.plain)
          .font(.system(size: 15, weight: .medium))
          .focused($searchFocused)
          .accessibilityLabel("Search CodeVetter workspaces")
          .accessibilityIdentifier("command-palette-search")
          .onSubmit { activateSelection() }
          .onKeyPress(.downArrow) {
            moveSelection(by: 1)
            return .handled
          }
          .onKeyPress(.upArrow) {
            moveSelection(by: -1)
            return .handled
          }
        Text("ESC")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundStyle(.tertiary)
          .padding(.horizontal, 7)
          .padding(.vertical, 5)
          .background(EvidenceStyle.inspector, in: RoundedRectangle(cornerRadius: 6))
          .accessibilityHidden(true)
      }
      .padding(.horizontal, 18)
      .frame(height: 58)

      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)

      ScrollView {
        LazyVStack(spacing: 4) {
          if matches.isEmpty {
            ContentUnavailableView(
              "No matching workspace",
              systemImage: "magnifyingglass",
              description: Text("Try Usage, Review, Testing, Performance, Runs, or Settings.")
            )
            .frame(minHeight: 220)
          } else {
            ForEach(Array(matches.enumerated()), id: \.element.id) { index, section in
              Button {
                activate(section)
              } label: {
                HStack(spacing: 12) {
                  Image(systemName: section.systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(
                      index == selectedIndex
                        ? EvidenceStyle.amberForeground
                        : .secondary
                    )
                    .frame(width: 20)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(section.rawValue).font(.system(size: 13, weight: .semibold))
                    Text(sectionPurpose(section))
                      .font(.system(size: 10))
                      .foregroundStyle(.secondary)
                  }
                  Spacer()
                  Text("⌘\(index + 1)")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 13)
                .premiumHitTarget(minHeight: 46)
                .background(
                  index == selectedIndex ? EvidenceStyle.amber.opacity(0.09) : Color.clear,
                  in: RoundedRectangle(cornerRadius: 9)
                )
                .overlay {
                  RoundedRectangle(cornerRadius: 9).stroke(
                    index == selectedIndex ? EvidenceStyle.amber.opacity(0.3) : Color.clear)
                }
              }
              .buttonStyle(.plain)
              .accessibilityLabel("Open \(section.rawValue)")
              .accessibilityValue(index == selectedIndex ? "Selected suggestion" : "")
              .onHover { hovering in
                if hovering { selectedIndex = index }
              }
            }
          }
        }
        .padding(10)
      }

      Rectangle().fill(EvidenceStyle.separator).frame(height: 1)
      HStack {
        Label("Navigate", systemImage: "arrow.up.arrow.down")
        Label("Open", systemImage: "return")
        Spacer()
        Text("One workbench · one Rust evidence model")
      }
      .font(.system(size: 10, weight: .medium))
      .foregroundStyle(.tertiary)
      .padding(.horizontal, 18)
      .frame(height: 38)
    }
    .frame(width: 520, height: 520)
    .background(EvidenceStyle.canvas)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("command-palette")
    .onAppear { searchFocused = true }
    .onChange(of: query) { _, _ in selectedIndex = 0 }
    .onExitCommand { dismiss() }
  }

  private func moveSelection(by offset: Int) {
    guard !matches.isEmpty else { return }
    selectedIndex = min(max(selectedIndex + offset, 0), matches.count - 1)
  }

  private func activateSelection() {
    guard matches.indices.contains(selectedIndex) else { return }
    activate(matches[selectedIndex])
  }

  private func activate(_ section: WorkbenchSection) {
    model.section = section
    dismiss()
  }

  private func sectionPurpose(_ section: WorkbenchSection) -> String {
    switch section {
    case .usage: "Inspect local provider usage without inventing quota truth"
    case .repository: "Read bounded repository structure and stored snapshots"
    case .review: "Plan and inspect execution-backed change verification"
    case .testing: "Exercise changed behavior and preserve runtime evidence"
    case .performance: "Measure one exact workload and compare one change"
    case .runs: "Inspect canonical Rust-persisted verification receipts"
    case .settings: "Manage local behavior without exposing credentials"
    }
  }
}
