---
title: Native macOS development
description: Reproducible tooling and ownership boundaries for the AppKit and SwiftUI Evidence Workbench.
---

# Native macOS development

The native client lives in `apps/macos`. It is a macOS-only projection of the
Rust verification engine: AppKit owns application lifecycle, windows, menus,
split views, and dense desktop behavior; SwiftUI composes bounded feature and
evidence views. Verification policy, execution, verdicts, and receipt identity
remain Rust-owned.

The existing Tauri application remains operational while the native client is
qualified. Native scaffolding or feature presence is not replacement proof.
The candidate therefore uses `com.codevetter.desktop.native-preview`, separate
from the shipped Tauri identifier. Transfer `com.codevetter.desktop` only after
every migration row passes and the owner makes the retirement decision.

## Pinned baseline

| Layer | Repository contract |
| --- | --- |
| Xcode project automation | `xcodebuildmcp@2.7.0`, invoked through `npx -y` and `.xcodebuildmcp/config.yaml` |
| Xcode project | `apps/macos/CodeVetter.xcworkspace`, shared `CodeVetter` scheme |
| Swift | Apple Swift toolchain selected by Xcode; package manifest requires Swift 6.1 or newer |
| Swift formatting | `swift format` from the selected Apple toolchain |
| Swift tests | Swift Testing for package behavior; XCTest/XCUITest for application behavior |
| Rust | Repository Cargo lockfile plus the selected Rust toolchain; `rustfmt`, Clippy, and Cargo tests are the minimum gates |
| Updater | Exact Sparkle 2.9.6 package on the app target; fail-closed preview configuration |
| Dependency policy | Existing `cargo-deny` policy; no new runtime or bridge dependency without qualification |

The bounded seven-family Runs projection and native host rendering have checked
benchmarks at `evidence/performance/native-run-history-benchmark.json`. The Rust
projection covers 700 stored runs plus 100 audience responses and returns the
newest 100 in 1.077 ms p95. Swift decodes 100 rows in 2.741 ms p95 and creates,
lays out, and displays the 1280x800 ledger with 100 selected response rows in
26.826 ms p95. The claims exclude CLI startup, window-server frame pacing, and
interactive scrolling.

The native direct-preview Testing slice has a separate checked gate at
`evidence/performance/native-testing-benchmark.json`. A canonical fixture with
100 browser journeys and 100 changed paths decodes in 0.510 ms p95 and creates,
lays out, and displays the 980x640 receipt desk in 19.271 ms p95. This measures
receipt decoding and native host rendering, not Rust execution, preview network
latency, browser runtime, window-server frame pacing, or interactive scrolling.

The native exact-workload Performance slice is checked at
`evidence/performance/native-performance-benchmark.json`. A canonical diagnosis
with 100 observed evidence rows was repeated through three independent focused
gates. Decode p95s were 1.502, 1.792, and 1.551 ms; render p95s were 41.867,
46.009, and 35.226 ms. Qualification conservatively uses the 1.792 ms decode
and 46.009 ms render worst runs, both well inside the unchanged 25 ms/150 ms
gates. This measures receipt decoding and native host rendering, not CLI
startup, Node or workload execution, window-server frame pacing, or
interactive scrolling.

The native local-usage slice is checked at
`evidence/performance/native-usage-benchmark.json`. A canonical fixture with
365 daily periods, 52 weekly periods, 12 monthly periods, and 100 sessions
decodes in 7.727 ms p95 and creates, lays out, and displays the 980x640 Usage
workspace in 18.346 ms p95. The Swift view bounds day/week/month chart rows and
visible model/session rows. This measures canonical JSON decoding and native
host rendering, not ccusage process startup, filesystem scanning,
window-server frame pacing, or interactive scrolling.

Additional Codex history recovery is checked at
`evidence/verification/native-history-roots-2026-09-02.md`. Native Usage
settings and `codevetter history-roots` share one Rust-owned bounded receipt.
Selected `sessions` or `archived_sessions` directories normalize to their
canonical Codex home; unrelated directories, malformed paths, duplicates, and
more than 16 roots fail closed. Configuration reports availability but never
reads or deletes transcript content, and reconciliation remains a separate
explicit Usage action.

Native memory inspection is checked at
`evidence/verification/native-memories-2026-09-02.md`. Native Settings and
`codevetter memories` share `codevetter.memories/v1` for bounded list, read,
and Git-diff operations. Rust discovers known locations but emits only existing
sources, addresses them with opaque SHA-256 identities, replaces absolute paths
with display paths, caps source and content volume, and applies heuristic
secret-line redaction. The contract is intentionally read-only and private:
Swift does not open arbitrary paths, and agent/MCP projections cannot read or
modify memory content.

Read-only Ops status is checked at
`evidence/verification/native-ops-status-2026-09-02.md`. Native Settings and
`codevetter ops` share `codevetter.ops-status/v1` for fixed 7, 30, and 90
day windows. Rust exposes only configuration-presence booleans, a normalized
webhook flavor, and bounded aggregate observability rows. Credentials, webhook
URLs, provider responses, absolute paths, live billing refreshes, webhook
sends, configuration writes, and agent/MCP authority remain outside this
contract.

The first native Repo Unpack slice is checked at
`evidence/performance/native-unpack-benchmark.json`. A canonical fixture with
100 stored snapshots, 700 graph nodes, and 1,000 root tree rows decodes in
5.179 ms p95 and creates, lays out, and displays the 1280x800 workspace in
22.921 ms p95. The client receives a Rust-bounded projection and never opens
SQLite or receives the raw file inventory. This measures canonical JSON
decoding and native host rendering, not repository scanning, graph queries,
window-server frame pacing, or interactive scrolling.

The aggregate runtime qualification is checked at
`evidence/performance/native-runtime-qualification.json`. The release client
reaches a responsive first frame in 0.580 seconds on average and settles at
117,424 KiB median RSS on the populated Performance workspace. The supervised worker
delivers 1,000 typed progress events in 342.278 ms, settles cancellation in
0.326 ms, rejects a deliberately crashed worker, and accepts a fresh worker in
3.739 ms. All five retained large-fixture decode/render gates remain below
25 ms/150 ms p95.

The historical matched Release launch and settled-memory comparison is checked at
`evidence/performance/native-tauri-comparison.json`. Five alternating launches
per application reached an accessibility-confirmed Performance workspace. The
native and Tauri first-visible-window medians were 435.120 ms and 419.018 ms,
which qualifies startup parity rather than a speed claim. Native settled at
117,424 KiB process-tree RSS versus 169,024 KiB for Tauri, a 30.5% reduction,
for that qualified build. The current read-only package receipt at
`evidence/performance/native-current-package-footprint.json` binds the exact
`qualification-5r7JG4` candidate without launching either app: its 62,060 KiB
bundle is 62.4% smaller and its host executable is 92.4% smaller than the
retained 165,144 KiB Tauri Release bundle. These claims exclude
responsive-frame timing, current-tree startup or RSS, scrolling, workload
execution, energy, and long-session behavior.

XcodeBuildMCP is deliberately a development tool rather than an application
dependency. Its project-local configuration exposes only the macOS, package,
coverage, discovery, scaffolding, diagnostic, and cleanup workflows required by
this migration. Sparkle 2.9.6 is the one exact third-party Swift package on the
native app target. The independently tested feature package remains free of the
binary framework so policy and receipt tests do not depend on app embedding.

The Review handoff can execute one explicitly confirmed isolated fix through
the bundled Rust CLI. The selected receipt head is materialized under app data,
the selected coding agent can edit only that detached worktree, and Rust owns
the bounded diff, correctness rerun, source-qualified re-review, and
`codevetter.fix-attempt/v1` result. The native UI can reveal the retained
worktree or separately confirm its discard; it cannot commit, merge, or push.
Read-only MCP retains no execution authority.

## Local package qualification

`pnpm native:package:qualify` consumes an XcodeBuildMCP-produced Release app;
it does not invoke Xcode itself. The qualifier reuses the existing release
sidecar builders, stages a new bundle under `artifacts/native-package`, embeds
`codevetter`, `codevetter-mcp`, `ccusage`, the runtime performance capsule, and
Sparkle, then verifies hardened signatures and emits ZIP/DMG archives plus a
machine-readable receipt. The visible app remains `CodeVetter.app`, while its
host executable is `CodeVetterNative` so the lowercase `codevetter` CLI remains
distinct on the default case-insensitive filesystem.

The current checked local run is recorded in
[Native package qualification](../../evidence/verification/native-package-qualification-2026-09-01.md).
The current package-only candidate is 62,060 KiB with a 17,427,235-byte ZIP
and 20,034,510-byte DMG. It embeds Sparkle 2.9.6, passes three executable
companion smokes, preserves framework symlinks, requires rich repository-query
CLI parity, and passes a signed packaged-sidecar smoke with 28 strict read-only
MCP tools and no listener. It was deliberately not launched on the operator's
active desktop. The earlier 80,116 KiB candidate remains the five-launch
Performance-workspace evidence at 117,424 KiB median settled RSS; the current
package-only check does not silently inherit a new launch or memory claim.

### Release optimization boundary

The exact current package uses Rust fat LTO with one codegen unit while
retaining unwind panic semantics. The native Release host disables coverage
instrumentation, enables dead-code stripping and deployment postprocessing,
and preserves external debug symbols in an adjacent dSYM. The package
qualifier fails closed if the source host contains LLVM coverage or profile
sections. Relative to the immediately prior package, these changes reduce the
bundle by 31.6%, host by 77.0%, CLI by 14.6%, MCP by 27.5%, ZIP by 18.8%, and
DMG by 21.9%. The exact package and fully sampled MCP receipt is
`evidence/performance/native-release-optimization.json`.

The tradeoff is Release build throughput: the observed native clean Release
build took 34.0 seconds, and the latest two optimized Rust sidecar links took
200 and 159 seconds. Debug and test profiles are unaffected. This receipt does not
claim a new foreground launch, current-package RSS, scrolling, energy, or
long-session result, and production must archive the matching dSYM separately.

This is deliberately not a
shipping claim: the preview bundle has no update feed or key and is ad-hoc
signed. Because ad-hoc components have no shared Team ID, local staged and
Debug previews disable Library Validation; the checked-in Release entitlement
stays empty and the production Developer ID build must prove Library Validation.

## Release-readiness inspection

`pnpm native:release:inspect` is the read-only gate between local packaging and
release operations. It binds the exact inspected app to its package receipt,
checks bundle/version/companion identity, signatures, Hardened Runtime,
Library Validation, execution authority, Sparkle configuration, Gatekeeper,
and optional notarization and installed-upgrade proofs. It emits
`codevetter.native-release-readiness/v1` and fails closed by setting
`shipping_ready` to `false`; it never signs, notarizes, installs, publishes,
enumerates identities, or reads credentials.

The current preview result is recorded in
[Native release-readiness inspection](../../evidence/verification/native-release-readiness-2026-09-02.md).
Seven of 16 local checks pass and nine production gates remain blocked.
The exact current-source candidate is
`artifacts/native-package/qualification-5r7JG4/CodeVetter.app`; its package
receipt, archive hashes, and exact bundled-MCP smoke are recorded in
[Native macOS package qualification](../../evidence/verification/native-package-qualification-2026-09-01.md).

Installed migration evidence uses `pnpm native:data-continuity`. With every
CodeVetter process fully quit, `capture` reads only durable record identities
from the resolved `com.codevetter.desktop/codevetter.db`, hashes them with a
per-run nonce, and never reads messages or preference values. Capture the
baseline before installation, then capture against that same baseline after
the native relaunch and again after rollback. `compare` refuses empty evidence,
any missing incumbent identity, the wrong Application Support root, database
integrity failure, or a changed baseline fingerprint; legitimate new rows do
not fail continuity. The resulting `codevetter.native-data-continuity/v1`
projection is nested in the separately provenance-qualified installed-upgrade
proof. Running the probe does not authorize installation, launch, rollback, or
production-identity transfer.

## Commands

Run these from the repository root:

```bash
npx -y xcodebuildmcp@2.7.0 project-discovery discover-projects --scan-path apps/macos
pnpm test:native
pnpm test:native:ui -- --foreground --desktop-idle
pnpm test:native:full -- --foreground --desktop-idle
pnpm native:build:release
pnpm native:package:qualify
pnpm test:native-package
pnpm test:native-review-gallery
pnpm native:data-continuity -- capture --database <production-app-data>/codevetter.db --phase before --out <before.json>
pnpm native:data-continuity -- capture --database <production-app-data>/codevetter.db --phase after_upgrade --baseline <before.json> --out <after-upgrade.json>
pnpm native:data-continuity -- capture --database <production-app-data>/codevetter.db --phase after_rollback --baseline <before.json> --out <after-rollback.json>
pnpm native:data-continuity -- compare --before <before.json> --after-upgrade <after-upgrade.json> --after-rollback <after-rollback.json> --out <continuity.json>
pnpm test:native-data-continuity
pnpm native:release:inspect -- --app <qualified-native-app> --qualification <qualification.json> --out <readiness.json>
pnpm test:native-release
pnpm native:runtime:compare -- --native-app <qualified-native-app> --tauri-app <worktree-tauri-release-app> --runs 5 --settle-ms 5000 --out <artifact-path> --foreground
pnpm test:native-runtime-compare
swift format lint --recursive apps/macos/CodeVetter apps/macos/CodeVetterPackage/Sources apps/macos/CodeVetterPackage/Tests apps/macos/CodeVetterUITests
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

`pnpm test:native` is the default automation lane. It lowers scheduling
priority, runs all Swift package behavior and offscreen render gates, and
compiles the macOS application without launching CodeVetter or taking focus.
`pnpm test:native:background` is an explicit alias for the same lane.

`pnpm test:native:ui` is deliberately foreground-only. It runs only the nine
XCUITest interaction cases and can activate CodeVetter, move focus, or open
menus while it is running. `pnpm test:native:full` runs the quiet lane first and
then the foreground lane. Neither package script grants foreground access.
Both fail closed unless the operator adds the just-in-time
`--foreground --desktop-idle` flags for that invocation. Run interaction
automation only while the local Mac is idle or on a dedicated graphical
session. A Space on the same active login is not an isolation boundary because
XCUITest can switch focus or Spaces.

For zero-disruption interaction qualification, use a dedicated remote Mac (or
a separate graphical login on that Mac) and keep the session unlocked for
XCUITest. Offscreen host-render tests remain the local visual regression gate;
they do not need a visible application window.

The manual-only `native-qualification.yml` workflow is the repository-owned
hosted path. It runs on GitHub's arm64 `xcode-27` image, grants no release or
signing authority, and uploads only the unsigned preview package, dSYM, local
qualification, current-tree 33-state owner-review packet, and release-readiness
evidence for seven days. Interaction tests remain opt-in through the dispatch
input; ordinary pushes and pull requests do not start this workflow. This is
the preferred way to qualify XCUITest without borrowing the operator's active
desktop.

The XcodeBuildMCP CLI and MCP server use the same tool implementations and the
same project-local defaults. If a current Codex session started before the MCP
registration, the pinned CLI is the supported in-session path; later sessions
receive the scoped MCP tools automatically.

The native executable accepts `--appearance light` or `--appearance dark` for
repeatable visual qualification. This affects only the launched process; it
does not write a system or application preference.

## Qualification boundary

- Development builds use a supervised local Rust process until the bridge
  admits a specific read-only projection. The selected hybrid ownership rule is
  documented in [Native Rust boundary](../architecture/native-rust-boundary.md).
- Review checks enter `codevetter.verification-command/v1` with a bounded
  `--request-id`. They keep the correlated canonical receipt alone on stdout
  and opt into ordered `codevetter.progress/v2` JSON lines on stderr with
  `--json --progress-json`. Preflight receipts remain distinct from final
  receipts; native ignores progress for another request, rejects a mismatched
  receipt, and scopes `codevetter.verification-cancel/v1` to the active request.
  Cancellation cannot produce or preserve a success claim.
- Direct preview verification invokes the existing `codevetter trex` contract.
  Swift performs form admission and receipt rendering only; Rust still owns Git
  identity, preview validation, route derivation, browser execution, persistence,
  verdicts, and limitations. Failed and no-confidence exit codes remain valid
  inspectable receipts when they agree with the canonical verdict.
- Exact-workload performance verification invokes `codevetter performance`.
  Planning is read-only and fingerprints the exact local workload before
  execution; Swift cannot enable capture after the scope changes. Rust and the
  existing local performance capsule retain authority over zero-egress
  admission, execution, diagnosis, paired comparison, cleanup, and receipt
  semantics. Exit states 0, 1, and 2 remain inspectable only when the outer
  receipt state agrees.
- Isolated Review fixes invoke `codevetter fix`. Swift only supplies the exact
  persisted run/finding identities, selected agent, and explicit confirmation,
  then validates the canonical receipt against CLI exit state. Rust creates and
  retains the detached worktree, supervises the agent, reruns the recorded
  correctness target, re-reviews `WORKTREE`, and requires a separate confirmed
  discard. No native or CLI merge path exists.
- Local usage invokes `codevetter usage`, which reuses the Tauri Rust service
  and opens the existing SQLite database read-only only when it is present.
  Ready, stale, and unavailable reports remain inspectable only when exit 0, 1,
  or 2 agrees. ccusage accounts for Claude, Codex, and Grok; Devin and live
  provider quotas remain explicitly separate and are not inferred by Swift.
- Repo Unpack history invokes `codevetter unpack`, which opens the existing
  SQLite database read-only and projects stored snapshot identities plus a
  Rust-trimmed inventory. Swift does not query SQLite, recompute graph/history
  semantics, or treat deterministic topology and health leads as runtime proof.
- Native Settings invokes `codevetter settings`. Rust owns an explicit
  non-secret key allowlist, value validation, and SQLite persistence; Swift
  renders only `codevetter.native-settings/v1`. Unknown keys and options are
  rejected, only one declared value is saved per receipt, and credential keys
  such as `github_token` never enter the native projection.
- Agent Island configuration is one bounded slice of that receipt. The 12
  opt-in, speech, quiet-hour, and voice preferences use the same keys, defaults,
  and options as the retained supervised helper and are editable from native UI
  or `codevetter settings`. The Evidence Workbench does not yet launch the
  helper, read live sessions, speak updates, or action provider requests; the
  preview is non-activating and agent/MCP authority remains unavailable.
- Native memory inspection invokes `codevetter memories`. Rust owns bounded
  source discovery, opaque source identity, canonical path admission, output
  limits, heuristic redaction, and Git-diff extraction. Swift receives only the
  versioned read-only receipt; there is no edit, delete, agent, or MCP authority.
- Agent MCP invokes `codevetter mcp` and renders
  `codevetter.mcp-settings/v1`. Rust retains repository canonicalization,
  indexed/stale state, enablement, tool/resource catalogs, redaction limits,
  client configuration, and bounded access metadata. Native audit clearing is
  explicitly confirmed; its rows never include arguments, prompts, query text,
  credentials, or evidence content.
- Debug and Release builds are intentionally outside App Sandbox because the
  product must execute user-selected repository tools and supervised helpers.
  Release retains Hardened Runtime and Library Validation; notarized production
  signing must prove the same authority without adding ambient credentials.
- The app may read and execute within repositories selected by the user; it
  receives no ambient credential authority. Each Rust contract remains
  responsible for repository containment, egress, and subprocess limits.
- Shipping requires contract parity across native, CLI, and MCP plus measured
  launch, memory, cancellation, large-receipt, accessibility, and visual gates.
- Local packaging and disabled-preview updater wiring are qualified. Developer
  ID signing, notarization, production appcast/EdDSA inputs, installed upgrade,
  rollback, identifier transfer, and Tauri retirement remain separate gates.
