## 1. Oracle and Corpus

- [x] 1.1 Record the pinned CodexBar revision, MIT attribution, CLI schema, and exact retained-corpus baseline without transcript content
- [x] 1.2 Import or recreate upstream-derived fork, subagent, replay, interleaving, reset, duplicate, and incremental-boundary fixtures with provenance
- [x] 1.3 Add a read-only parity runner that compares exact token classes and local-day buckets with CodexBar aggregate JSON
- [x] 1.4 Add a sanitized fixed corpus whose internal expected result and CodexBar result agree exactly

## 2. Lineage-Aware Scanner

- [x] 2.1 Model explicit parent identity, fork timestamp, source identity, and scanner state in the Codex adapter
- [x] 2.2 Implement parent snapshot checkpoints and dependency-ordered child baseline resolution
- [x] 2.3 Implement bounded seen-total suppression, monotonic component watermarks, and permanent interleaving latch
- [x] 2.4 Cap post-latch accepted deltas by contained growth and per-event usage and classify unresolved ownership as ambiguous
- [x] 2.5 Prove full-file, chunked, restart, appended-tail, and reordered dependency scans produce identical results

## 3. Durable Evidence Ledger

- [x] 3.1 Add revisioned source, lineage-checkpoint, observation, pricing-provenance, and coverage schema with migration tests
- [x] 3.2 Commit observations, lineage state, and completed source cursor atomically before acknowledging ingestion
- [x] 3.3 Make observation identities deterministic and prove replay after transaction failure or restart is idempotent
- [x] 3.4 Rebuild session and model summaries exclusively from accepted observations for the active scanner revision
- [x] 3.5 Preserve verified observations when their original transcript later disappears

## 4. Historical Recovery and Coverage

- [x] 4.1 Discover primary, archived, additional configured, JetBrains, and explicit imported Codex homes with stable source fingerprints
- [x] 4.2 Match recovered sources by stable session identity and prevent cross-root duplicates
- [x] 4.3 Classify every session snapshot into exactly one of verified, legacy estimated, ambiguous, missing unestimated, or stale
- [x] 4.4 Preserve unrecovered historical summary rows in the legacy estimated tier without daily fabrication
- [x] 4.5 Add a reconciliation command that reports coverage counts, tier totals, pending bytes, scanner revision, and observation watermark

## 5. Pricing Semantics

- [x] 5.1 Persist model, recorded service tier, and pricing revision with accepted observations
- [x] 5.2 Separate token completeness from `priced_exact`, `priced_range`, and `unpriced` completeness
- [x] 5.3 Report unknown GPT-5.6 service-tier pricing as a labeled range and test every supported model/tier boundary
- [x] 5.4 Keep quota-window data out of transcript compute aggregates and add regression coverage for quota resets

## 6. Product Surface

- [x] 6.1 Extend typed IPC with evidence-tier totals, coverage state, pricing state, and diagnostics
- [x] 6.2 Replace the naked usage headline with verified totals plus an unavoidable coverage badge and observation timestamp
- [x] 6.3 Show legacy estimated totals, ambiguous/missing session counts, and recovery/import actions separately
- [x] 6.4 Label every dollar value API-equivalent and render ranges or unpriced states without false precision
- [x] 6.5 Add accessible loading, stale, partial, complete, and reconciliation-failure states with responsive tests

## 7. Qualification and Migration

- [x] 7.1 Run the new scanner beside the released scanner without changing reads and capture exact deltas by session class
- [x] 7.2 Require internal corpus, CodexBar parity, frozen-database double-run, and live retained-corpus reconciliation gates
- [x] 7.3 Switch reads atomically only after every coverage and parity invariant passes; retain the previous read revision for rollback
- [x] 7.4 Run focused Rust tests, frontend unit tests, typecheck, lint, build, docs validation, and strict OpenSpec validation
- [x] 7.5 Update telemetry documentation and PROJECT_STATUS with the shipped evidence contract and known irrecoverable-history limitation
