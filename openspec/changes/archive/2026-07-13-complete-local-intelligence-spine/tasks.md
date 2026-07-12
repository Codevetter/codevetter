## 1. Live Session Evidence Contract

- [x] 1.1 Add a versioned Tauri policy/status contract for the existing incremental transcript tail cadence, supported adapters, local-only event path, recovery mode, and last indexed time.
- [x] 1.2 Add regression coverage for complete-line incremental appends, partial-tail preservation, lock-skip recovery, exact-once archive rows, and update summaries.
- [x] 1.3 Surface the live evidence policy/freshness in the existing local session source-health UI without adding another watcher or dependency.

## 2. Archived Conversation Windows

- [x] 2.1 Add a bounded SQLite query that resolves the archive row nearest a session/source-line anchor and returns ordered before/target/after message rows with bound metadata.
- [x] 2.2 Enrich raw-session command signals with redacted, capped non-command conversation items while retaining session, message-index, source-path, and source-line anchors.
- [x] 2.3 Add Rust tests for chronological windows, missing anchors, cap enforcement, source-line matching, and secret-like excerpt redaction.

## 3. Verification Timeline Reconstruction

- [x] 3.1 Extend typed Review history/timeline contracts so command anchors and replay packets retain structured conversation items and explicitly label them as intent context.
- [x] 3.2 Render bounded conversation reconstruction in timeline expansion, segment fix packets, and reviewer-proof Markdown with source jumps and executable-evidence separation.
- [x] 3.3 Add frontend regression tests for non-command ordering, absent archive context, collapsed long windows, proof qualification, and preservation of command outcomes.

## 4. Persisted Local History Graph

- [x] 4.1 Extend `RepoHistoryBrief` to schema v2 with backward-compatible graph and commit-file fields; harvest bounded recent commit file lists while preserving secret-path exclusions.
- [x] 4.2 Deterministically build file, commit, decision, test, and co-change nodes/edges with citations, trust qualification, stable ordering, and explicit caps.
- [x] 4.3 Add Rust regression tests for deterministic graph output, file/decision/commit/test relationships, large-repo bounds, secret-path omission, and schema-v1 loading without rewrite.

## 5. History Graph Query Experience

- [x] 5.1 Add a bounded Tauri history-graph query with exact ID/path/label precedence, token ranking, one-hop expansion, confidence/lead metadata, and no-match/truncation results.
- [x] 5.2 Add Repo history query controls and accessible result relationships/citations; keep Review's recurring-finding, session, and command evidence connected to file explanations without creating findings.
- [x] 5.3 Add focused frontend/backend tests for exact-file queries, multi-match ranking, no-match language, thin-evidence qualification, and non-mutating saved snapshots.

## 6. Verification, Documentation, And Archive

- [x] 6.1 Run focused Rust archive/tail/history graph tests, desktop unit/proof tests, typecheck, lint, production build, and a local Tauri command-boundary smoke.
- [x] 6.2 Update the three archived PRD statuses and remove Planned Next items 2–4 only after all acceptance evidence passes; update the root `PROJECT_STATUS.md` timeline/features.
- [x] 6.3 Sync the three delta specs, strict-validate OpenSpec, archive the completed change, commit, push `main`, and confirm GitHub CI for the pushed SHA.
