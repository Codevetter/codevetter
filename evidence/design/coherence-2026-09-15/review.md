# Cross-page coherence repair — 2026-09-15

## Scope and direction

Owner-approved bounded repairs following a source-level audit. Preserve the
existing native workbench, compact controls, dark/light appearances, and muted
amber. No new surface, dependency, editor capability, or release.

Product contract: CodeVetter helps developers verify agent-authored changes
using reproducible execution evidence. Source: `PRODUCT.md`. Each page should
identify its input, next action, and resulting evidence without leading with
backend implementation terminology.

The design-workflow preserve lane informed reuse of existing components and
offscreen appearance checks. The prescribed Fleet `design-workflow.mjs` script
is absent at `../scripts/design-workflow.mjs`; automated design receipt
validation is unavailable. Impeccable is not available in this session. No
automated design score or full design-workflow pass is claimed.

Historical style references, not fresh pixel baselines:

- `evidence/design/native-acceptance-2026-09-01/testing-setup.png`
- `evidence/design/native-acceptance-2026-09-01/performance.png`
- `DESIGN.md`

## Repairs

- Selecting another repository clears stale source, preview, scenario, QA,
  comparison, and performance setup. Reselecting the same folder preserves it.
- Navigator source opening updates the shared repository even without a visible
  page. Materializing that same source revision preserves its setup.
- Testing explicitly describes deployed-preview browser testing and can copy
  the applied Review comparison; pending or unrelated comparisons are rejected.
- Unpack details require matching repository and revision, like the inline map.
- Performance target discovery precedes manual fields. All discovered targets
  can be exposed instead of silently stopping after the first three or five.
- Preview, warm, and differential result handoffs select their saved run ID.
  Missing results outside the bounded history list are explained, not replaced.
- Settings refresh and loading/error status follow the visible section. MCP
  data reloads when the repository changes.

## Background-only evidence

`WorkbenchCoherenceTests` covers repository switching, same-folder preservation,
source adoption, comparison handoff, Unpack identity, Settings refresh routing,
and run selection. `NavigatorTests` adds a real two-repository Git/FFI switch
test. The existing Review-to-Testing test now distinguishes same-repository
preview preservation from cross-repository preview clearing.

Offscreen `NSHostingView` renders cover Testing, Performance, Runs, and Settings
at native-supported widths 980 and 1440, in light and dark appearances. Outputs
are local scratch evidence under `artifacts/coherence-review/`. They never
create or order a visible window. Testing and Performance retain their fixed
bottom actions; longer setup remains in the existing scroll containers.

Review limitations: no foreground clicks, VoiceOver, XCUITest, live GitHub
imports, or agent/browser execution were performed. Empty/loading render states
do not prove a completed runtime verification loop. Mobile widths do not apply
to this native app's 980-point minimum window.

## Verification

`pnpm test:native:background` passes:

- 118 Swift behavior tests.
- 15 Rust navigator tests; two explicitly live-network tests remain ignored.
- All five isolated Release performance gates: Runs, Unpack, Usage,
  Performance, and Testing.
- Native macOS Debug build, workspace `apps/macos/CodeVetter.xcworkspace`,
  scheme `CodeVetter`, preview bundle. The app was not launched or installed.

`node scripts/check-docs.mjs` passes (89 Markdown files); `git diff --check`
passes. Early tests caught a trailing-slash repository identity bug, now fixed.
Fixture corrections distinguish source-file loading from local diff loading
and same-repository preview reuse from unsafe cross-repository reuse.

No commit, push, release, install, or deployment was performed.
