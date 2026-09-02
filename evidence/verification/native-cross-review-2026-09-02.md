# Native independent cross-review qualification — 2026-09-02

## Claim

Unreleased CodeVetter source can request independent sequential Claude and
Codex review through native Review or `codevetter check --agent cross`, persist
one deterministic composite receipt, and inspect it through repository-scoped
read-only MCP. Agreement remains review coverage and never executable proof.

## Contract evidence

- `codevetter.cross-review/v1` binds both passes to the same immutable target.
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
- Hosted XCUITest includes the strategy picker but remains pending on the next
  isolated macOS run.

## Open measurement gate

No provider-backed caught-bug corpus run was performed because authenticated
Claude and Codex execution is not available in the protected workflow. Recall,
false-positive burden, end-to-end latency, and observed usage/cost therefore
remain unmeasured. Cross-review stays optional and cannot become the default on
this evidence alone.
