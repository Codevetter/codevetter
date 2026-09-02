# Native independent cross-review qualification — 2026-09-02

## Claim

Unreleased CodeVetter source can request independent sequential Claude and
Codex review through native Review or `codevetter check --agent cross`, persist
one deterministic composite receipt, and inspect it through repository-scoped
read-only MCP. Agreement remains review coverage and never executable proof.

## Contract evidence

- `codevetter.cross-review/v1` binds both passes to the same immutable target.
- A separate SHA-256 coordinator policy binding covers the repository, exact
  range, task, and original runtime context. A second SHA-256 identity covers
  the ordered unit plan while deliberately excluding executor-specific unit
  fingerprints. Any mismatch fails before a composite is persisted.
- Codex receives the original repository/task/runtime context, never Claude
  output.
- Reconciliation keys only on exact path, positive line, and source anchor.
  Similar titles at different sources remain separate.
- Unique, corroborated, and severity-conflicting qualified findings remain
  explicit. Missing identity, target mismatch, missing executor, interruption,
  or incomplete readiness discards every composite finding and reports an
  incomplete receipt.
- Per-pass evidence retains reviewer identity, review identifier, duration,
  qualified findings, readiness, manifest qualification diagnostics, and any
  available usage. The current review contract does not expose provider raw
  candidates or measured usage, and the receipt states that limit rather than
  manufacturing values.
- MCP returns the persisted canonical receipt without review-start,
  cancellation, provider, or credential authority.

## Checks

- Four Rust reconciliation tests cover corroborated/unique/conflicting output,
  title non-merging, fail-closed missing anchors and partial execution, and
  immutable-target mismatch.
- The CLI parser test preserves `--agent cross`; existing single-review
  defaults remain Claude.
- The MCP lifecycle fixture preserves cross-review strategy and both reviewer
  identities through the read-only projection.
- 83 Swift package tests pass, including exact cross-review command projection
  and dark/light evidence rendering.
- The 35-state owner packet includes `review-cross-review.png` and
  `review-cross-review-light.png`, with manifest-bound hashes and dimensions.
- Hosted XCUITest includes the strategy picker. The first isolated run exposed
  an unreliable segmented-control `isSelected` assertion after the strategy
  contract had already updated; the test now waits on the resulting contract
  text and remains pending on the final-head draft-PR run.

## Provider smoke

One isolated current-binary smoke used the public `ts-sql-injection` synthetic
case with a clean temporary Git repository and separate temporary app data.
Claude and Codex both independently source-qualified the labeled injection at
line 13. The final receipt was `needs_attention`, carried policy binding
`4f8414c0ce6a19cd56ae15a0730087b047edf1ee69a6606b2982b77c95bb6fb3`, and
unit-plan identity
`a797e10aa0307e225585939f472eb94860f50e0d85376957a4102fa0e9f86fc5`.

Claude completed in 64,891 ms with three qualified findings. Codex completed in
47,315 ms with one. Sequential cross-review completed in 112,209 ms and
reconciled one corroborated labeled issue plus one Claude-only missing-module
finding. Under the benchmark's strict one-label accounting, this single case is
100% recall and 50% precision for the composite, versus 100%/33% for Claude and
100%/100% for Codex. Provider usage was not reported, so cost is unavailable.
The source-only fixture had no executable correctness or performance target;
the overall receipt preserved those limitations rather than converting review
agreement into a pass.

## Provider-backed corpus comparison

The full 27-case public caught-bug corpus ran through the real `--agent cross`
path. Every case used a fresh temporary Git repository, separate app data, the
same generic task, and the exact `HEAD^..HEAD` change. Claude and Codex received
the original context independently. Temporary repositories were removed after
their canonical receipt was saved; the ignored raw run is 1.1 MiB.

| Strategy | Labels caught | Findings | Strict precision | F1 | Mean review time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude | 29/29 (100%) | 134 | 21.6% | 35.6% | 88.4 s |
| Codex | 28/29 (96.6%) | 46 | 60.9% | 74.7% | 99.1 s |
| Claude + Codex | 29/29 (100%) | 99 | 29.3% | 45.3% | 187.5 s |

The deterministic mapper initially proposed two Codex misses. Human review
confirmed that `py-path-traversal` was caught by the finding “Untrusted report
name permits arbitrary local file disclosure”; its wording omitted the
mapper's narrow keyword despite matching the source and core claim. The one
confirmed Codex miss was the low-severity unused helper in `ts-dead-code`.
Claude and the union caught it. Thus cross-review adds one of 29 labels over
Codex, but adds 53 findings and about 88 seconds per case. All findings beyond
the unique labeled defects count against strict defect-only precision,
including process findings and additional plausible defects not represented in
the intentionally narrow ground truth.

One `py-insecure-deserialization` attempt returned an incomplete two-pass
receipt and was not scored. A fresh isolated retry completed; the runner now
retains incomplete receipts, checkpoints after every case, retries once, and
can resume or rescore without repeating completed provider calls. Provider
usage was absent in all 54 completed pass summaries, so observed cost remains
unavailable. The committed summary is
[`cross-review-benchmark-2026-09-02.json`](./cross-review-benchmark-2026-09-02.json).

Decision: preserve the existing Claude single-review default for compatibility;
the corpus identifies Codex as the stronger efficiency candidate for a separate
default-policy decision. Keep cross-review optional when an operator explicitly
values maximum recall over latency and review burden. This corpus does not
justify automatic dual review, and agreement still does not replace executable
correctness or performance evidence.
