import SwiftUI

/// Comparison controls stay beside the source they describe, not behind Evidence.
struct NavigatorReviewScopeBar: View {
  @Bindable var model: WorkbenchModel
  private var nav: NavigatorModel { model.navigator }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 12) { controls }.frame(minWidth: 760)
        VStack(alignment: .leading, spacing: 10) { controls }
      }.controlSize(.small)
      Text(scopeDescription).font(.system(size: 10, design: .monospaced))
        .foregroundStyle(nav.comparisonPending ? EvidenceStyle.warning : .secondary)
        .textSelection(.enabled)
      if let issue = nav.branchesIssue {
        Text(issue).font(.caption).foregroundStyle(EvidenceStyle.warning)
      }
      if nav.branches?.truncated == true {
        Text("Showing the first 2,000 available branch refs.").font(.caption).foregroundStyle(
          .secondary)
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 10)
    .background(EvidenceStyle.chrome)
  }

  @ViewBuilder private var controls: some View {
    @Bindable var nav = nav
    if !nav.input.hasPrefix("https:") {
      Picker("Review branch", selection: $nav.reviewHead) {
        Text("Local changes · \(currentBranch)").tag("local")
        if let snapshot = nav.snapshot {
          Text("Pinned \(snapshot.head.prefix(8))").tag(snapshot.head)
        }
        ForEach(nav.branches?.branches ?? []) { branch in
          Text(branch.name).tag(branch.reference)
        }
      }.frame(maxWidth: 290)
      if nav.reviewHead == "local" {
        Picker("Compare against", selection: .constant("HEAD")) {
          Text("HEAD · \(currentBranch)").tag("HEAD")
        }.frame(maxWidth: 290).disabled(true)
      } else {
        Picker("Compare against", selection: $nav.reviewBase) {
          if nav.reviewBase.isEmpty { Text("Choose base…").tag("") }
          if !nav.reviewBase.isEmpty
            && !(nav.branches?.branches.contains { $0.reference == nav.reviewBase } ?? false)
          {
            Text(String(nav.reviewBase.prefix(12))).tag(nav.reviewBase)
          }
          ForEach(nav.branches?.branches ?? []) { branch in
            Text(branch.name).tag(branch.reference)
          }
        }.frame(maxWidth: 290)
      }
      Button(nav.opening ? "Opening…" : "Show diff") { nav.applyComparison() }
        .disabled(
          nav.opening || nav.branchesLoading
            || nav.reviewHead != "local" && nav.reviewBase.isEmpty)
    } else {
      Text("Pinned GitHub comparison").font(.system(size: 11, weight: .medium))
    }
    Spacer(minLength: 0)
    Button("Review change…", systemImage: "checkmark.shield") {
      Task { await model.prepareNavigatorReview() }
    }
    .disabled(!nav.canPrepareReview || nav.preparingUnpack)
    .help("Describe the task and choose a reviewer before planning or running checks")
  }

  private var currentBranch: String {
    nav.branches?.current?.replacingOccurrences(of: "refs/heads/", with: "") ?? "detached HEAD"
  }

  private var scopeDescription: String {
    if nav.opening { return "Resolving comparison · no checkout or code execution" }
    if nav.comparisonPending {
      return "Selection changed · Show diff to apply before starting a review"
    }
    guard let snapshot = nav.snapshot else { return "Choose a repository" }
    if snapshot.kind == "local" {
      return
        "Uncommitted changes vs \(snapshot.head.prefix(12)) · executable review requires a committed, clean checkout"
    }
    guard let base = snapshot.base else {
      return
        "Source-only revision · open a PR/commit URL or choose branches in a local repository to review changes"
    }
    return
      "Applied \(base.prefix(12)) → \(snapshot.head.prefix(12)) · \(nav.changedFiles.count) changed files · execution requires a clean checkout at this head"
  }
}
