# Native Review intent diagnostic receipt

Date: 2026-09-01
Scope: deterministic Review intent and recorded synthetic-QA projection

## Result

Completed Review evidence now includes
`codevetter.review-intent-diagnostic/v1`. The Rust core owns the projection;
native SwiftUI renders it without recomputing closure or changing the canonical
local-check JSON returned through the CLI and local-agent path.

The receipt records:

- the operator-supplied task intent and its source;
- deterministic changed-surface classifications;
- finding, high-risk finding, QA run, QA outcome, artifact, and review-coverage
  counts;
- explicit evidence gaps and an ordered intent-to-disposition chronology;
- `evidence_conflict`, `insufficient_evidence`, or
  `ready_for_human_disposition` rather than an automatic success claim; and
- the invariant that intent closure always requires a human disposition.

Native Review adds a dedicated Intent desk and safe Finder reveal actions for
recorded QA artifacts. Repository-relative artifact paths must remain inside
the recorded checkout; absolute paths must still exist. Revealing an artifact
is an explicit user action and does not execute it.

The Intent and proof-map desks also hand the exact repository and range or pull
request to native Testing. The handoff clears stale Testing proof and prior
network confirmation while preserving the operator's preview field. Testing
continues to own browser execution through the existing `codevetter trex`
contract; Review remains an evidence consumer.

## Verification

- 3 focused Rust diagnostic contract tests pass.
- The focused Swift proof-map/intent host-render test passes.
- The focused exact-change Review-to-Testing handoff test passes and proves
  that execution consent is not carried across the boundary.
- The serialized 65-test background Swift package gate and macOS Debug build
  pass; serial execution prevents AppKit and process-pipe performance gates
  from measuring contention created by the test runner itself.
- The full Rust all-target suite passes 1,081 tests with 31 explicitly ignored.
- Strict Swift formatting passes.
- Offscreen true-black render:
  `evidence/design/native-acceptance-2026-09-01/review-intent.png`
  (`1520x1600`, SHA-256
  `0af6c8f18cb5d25f0649765624a458170a9104e5fbc9f9013c0d01785ba1f67a`).

## Remaining boundary

Saved presets/targets, spec discovery, and post-fix rerun setup are now
consolidated into native Testing through `codevetter.qa-workspace/v1`; Review
still only hands over exact change identity. A real saved-flow post-fix rerun,
complete interaction/accessibility qualification, and owner acceptance remain
open. A recorded legacy pass is evidence context, not revision-exact proof, and
cannot close intent by itself.
