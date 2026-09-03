# Native repository query parity receipt

Date: 2026-09-01
Scope: read-only structural and temporal exploration in Repo Unpack
Schema: `codevetter.repo-query/v2`

## Result

The native Repo Unpack Graph desk and `codevetter unpack --operation query`
now call the canonical Rust structural-graph and history read services already
used by Tauri and MCP. Structural search, node explanation, bounded impact,
directed path, temporal search, and causal trace are available through the same
receipt. Swift owns input and presentation only. Ranking, traversal, causal
selection, freshness, trust, source identity, bounds, and unavailable coverage
remain Rust-owned.

The native client now keeps one supervised, read-only JSON-lines worker after a
snapshot opens. Rust retains one canonical search projection and its existing
query index. The first rich graph query upgrades that snapshot in place with
compact traversal edges; only bounded result edges regain full evidence and
source anchors from SQLite. Every request rechecks the latest stored snapshot
identity and live Git freshness, and cancellation drops the process. A CLI
without the worker protocol falls back to the exact supervised one-shot query;
there is no alternate ranking or traversal implementation.

The receipt carries one canonical repository path, query domain, normalized
query, mode-specific target/direction/depth or history selector, applied limit,
graph and history index status, and exactly one typed result. Both domains fail
closed with `status: unavailable` when their
canonical index is absent. A valid unavailable receipt exits successfully so
the native viewer can render the coverage state instead of replacing it with
a process error.

## Cross-surface authority

| Surface | Authority | Qualified behavior |
| --- | --- | --- |
| Rust core | Authoritative read | Reuses `StructuralGraphReadService` and `HistoryReadService`; validates domain/mode fields, one-line identities, depth, and a 1–100 result limit |
| CLI | Read-only projection | Emits JSON or a human summary through `unpack --operation query --query-domain graph|history --query-mode ...` |
| Native | Read-only projection | Validates schema, repository identity, domain, authority, status, and typed result before rendering |
| MCP | Read-only projection | Continues to expose the richer canonical graph and history tools over an explicitly enabled repository scope |

Native exploration does not add build, backfill, mutation, cleanup, or network
authority. An unindexed repository is not silently queried through a weaker
fallback. Graph topology and qualified causal leads remain navigation evidence,
not executable proof.

## Executable proof

- Rust boundary tests cover normalized bounds and the unindexed temporal
  fail-closed state.
- CLI parser tests cover the explicit operation, graph/history domain, five
  modes, path target, impact direction/depth, causal selector, and rejected
  argument combinations.
- Live read-only CLI smoke against the indexed incumbent repository returned
  12 bounded graph matches and one history match. Both receipts reported their
  stored indexes as stale relative to the live checkout rather than presenting
  the results as current.
- Five independent Release-sidecar runs established the cold-process baseline:
  2,170 ms median graph latency and 820 ms median history latency. The scoped
  worker then measured 50.5 ms median graph latency and 36.55 ms median history
  latency after preparation, reductions of 97.7% and 95.5%. Background graph
  preparation measured 2.49 s. The search-only projection reduced retained
  worker RSS from an observed 549.8 MiB full-snapshot prototype to 242.4 MiB.
  The [cold benchmark](../performance/native-repository-query-benchmark.json)
  and [worker benchmark](../performance/native-repository-query-worker-benchmark.json)
  record every sample, method, lifecycle, fallback, and limitation.
- The exact-tree rich-worker qualification measured 36.07 ms graph search,
  35.15 ms explain, 116.55 ms impact, 68.38 ms one-hop path, 32.46 ms history
  search, and 32.21 ms causal trace medians after preparation. Search-only RSS
  measured 242.6 MiB; compact traversal settled at 307.6 MiB, 39.9% below the
  rejected 511.9 MiB full interactive snapshot. Search preparation took 2.45 s
  and first traversal upgrade 0.99 s. The
  [rich benchmark](../performance/native-repository-query-rich-worker-benchmark.json)
  preserves every sample and the empty populated-trace limitation.
- Live read-only CLI smoke against the unindexed migration worktree returned
  explicit unavailable receipts for both domains and ran no fallback query.
- The full browser-feature Rust matrix passed: 1,092 tests passed and 31
  intentionally ignored; the two example contract tests also passed.
- The previously load-sensitive review-executor fixture now gives non-timeout
  assertions a five-second process-start budget. Its production timeout path
  is unchanged and remains covered separately.
- Swift supervised-runner coverage checks all six typed results, exact rich-mode
  arguments, persistent reuse, cancellation without partial receipt acceptance,
  and clean worker restart.
- Final background qualification exposed a cancellation fixture whose shell
  remained blocked on stdin after `SIGTERM`. The supervisor now closes the
  scoped worker input before termination; the focused regression passed in
  7.1 s and the complete package rerun left no fixture worker behind.
- XcodeBuildMCP 2.7.0 passed 69 Swift package tests and the native macOS Debug
  build with preview bundle identifier `com.codevetter.desktop.native-preview`.
  The final post-fix rerun completed the tests in 22.1 s and the build in 8.5 s.
- Repository lint, Knip, changed-file complexity, import cycles, duplication
  regression, high-severity dependency audit, capability sync, and docs
  validation passed. Two newly reported high-severity transitive Browserslist
  advisories were resolved by pinning the existing dependency to patched
  4.28.7; dependency audit now reports one low-severity advisory below the
  configured high-severity gate.

## Visual evidence

`evidence/design/native-acceptance-2026-09-01/repository-query-evidence-workbench.png`
is a 3040×1960 offscreen dark render from the current tree. Its SHA-256 is
`297d8dbe40f6455cd40b875d42903816bcfecd0eda8455687d853685bd58b442`.

Visual inspection confirmed the true-black hierarchy, populated snapshot
ledger, amber-only selected domain and Query action, canonical freshness
status, result trust and source identity, node relationship counts, bounded
impact controls, path affordances, and retained snapshot topology. The generic
Fleet web-viewport detector remains inapplicable to this fixed-minimum macOS
surface; no mobile evidence was fabricated.

## Storage observation

The final read-only post-qualification measurement reports 162 GiB available
on the 926 GiB data volume (82% used). The Rust target is 39,644,076 KiB
(about 37.8 GiB), artifacts are 3,514,976 KiB (about 3.35 GiB), node_modules
is 655,956 KiB (about 641 MiB), the native Swift package build cache is
674,356 KiB (about 659 MiB), and the shared XcodeBuildMCP cache is 18,547,212
KiB (about 17.7 GiB). Final Debug/Release qualification increased the Rust
target by about 0.83 GiB relative to the preceding recorded observation.
macOS/APFS reported 145 GiB available in the immediately preceding sample and
162 GiB in this final sample without a cleanup command, so free capacity is a
point-in-time value rather than an attributed product saving. No CodeVetter
app, repository-query worker, or cancellation fixture remained active, and no
manual cleanup or deletion was performed.

## Remaining boundary

This receipt does not qualify a populated causal trace against the stale live
index, native source lineage, model synthesis, cleanup, foreground owner
acceptance, signing/notarization, installed update/rollback, release, or Tauri
retirement.
