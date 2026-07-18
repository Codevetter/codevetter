## 1. Shared Contracts and Temporal Storage

- [x] 1.1 Reconcile trust, origin, source-anchor, stable-node, relation, community, and snapshot contracts with `add-graph-trust-paths` so structural and historical queries share one identity system.
- [x] 1.2 Define a versioned append-only history event ledger for commits, releases, structural deltas, evidence, annotations, adapter cursors, coverage, and invalidation records.
- [x] 1.3 Add additive SQLite migrations and materialized query indexes for repository, release, commit, entity, lineage, relation, time, evidence, and traversal lookups.
- [x] 1.4 Define bounded Rust contracts for temporal references, as-of/between selectors, lineage, causal traces, comparisons, explanations, freshness, coverage, and pagination.
- [x] 1.5 Add migration, serialization, schema-version, deterministic-ID, and legacy-default tests for fresh and existing databases.

## 2. Git Object History and Release Spine

- [x] 2.1 Extract the existing DORA release-tag recognition and Git parsing into reusable helpers without changing current DORA results.
- [x] 2.2 Implement a read-only Git object reader using `ls-tree`, `diff-tree`, and `cat-file --batch` so historical states can be reconstructed without checkout or worktree mutation.
- [x] 2.3 Implement deterministic tag ordering, ancestry/range assignment, release nodes, commit-parent topology, and the explicit unreleased HEAD range.
- [x] 2.4 Capture bounded commit metadata, changed paths, rename/copy leads, merge parents, tag anchors, repository fingerprint, and shallow/incomplete-history coverage.
- [x] 2.5 Add temporary-repository tests for linear and divergent tags, work after the newest tag, no tags, merge commits, renames, copies, deletions, reintroductions, shallow history, and rewritten tags.

## 3. Structural Checkpoints, Deltas, and Lineage

- [x] 3.1 Build a mandatory canonical structural checkpoint for every reachable release and unreleased HEAD using the shared syntax-aware graph engine and its engine/schema identity.
- [x] 3.2 Compute deterministic commit-level structural deltas between checkpoints, including node/relation/community/hub/bridge/path additions, removals, and changes with explicit coverage gaps.
- [x] 3.3 Implement as-of reconstruction for a release, commit, or date by combining the nearest compatible checkpoint with ordered commit deltas.
- [x] 3.4 Implement conservative entity lineage across rename, move, signature change, split, merge, deletion, and reintroduction using `same_as`, `renamed_to`, `moved_to`, `evolved_from`, `split_into`, `merged_from`, `removed_in`, and `reintroduced_in` edges.
- [x] 3.5 Preserve ambiguous lineage candidates rather than collapsing them, and expose first-seen, last-changed, last-present, and confidence/source metadata.
- [x] 3.6 Add fixture tests for stable identity, cross-language moves, symbol renames, split/merge ambiguity, topology evolution, checkpoint compatibility, and exact as-of reconstruction.

## 4. Evidence Adapters and Change Episodes

- [x] 4.1 Define a local-first `HistoryEvidenceAdapter` contract with deterministic event IDs, source cursors, availability, redaction, consent/configuration, and freshness metadata.
- [x] 4.2 Implement built-in adapters for Git/PR exports, changelogs/ADRs/decision markers, indexed agent sessions, reviews/fix attempts, synthetic QA, deploy/release records, and locally available analytics/log/incident exports.
- [x] 4.3 Keep task/chat/hosted-provider integrations behind separately configured adapters; core history construction MUST make no unconfigured network calls.
- [x] 4.4 Assemble conservative change episodes from explicit identifiers and source-backed relationships, retaining temporal/path correlations only as qualified leads.
- [x] 4.5 Derive causal threads that connect intent, implementation, verification, release, observed outcome, regression, and follow-up while preserving missing or contradictory facets.
- [x] 4.6 Add fixture tests for fully linked episodes, conflicting accounts, unlinked evidence, rotated artifacts, ambiguous correlations, provider-side unknowns, adapter failures, and stable deterministic IDs.

## 5. Refresh, Backfill, and Query Service

- [x] 5.1 Implement resumable progressive backfill that makes recent releases and HEAD useful first, reports phase/progress/ETA/coverage, and checkpoints work for cancellation or restart.
- [x] 5.2 Implement transactional incremental refresh using Git/tag fingerprints and per-adapter cursors, plus affected-range invalidation and repair for rewritten history or incompatible graph engines.
- [x] 5.3 Implement reusable Rust queries for release/commit/date as-of state, between-state diff, release summaries, episode inspection, entity resolution, first-seen, last-changed, lineage, and evolution.
- [x] 5.4 Implement bounded causal traversal and regression queries across structural, temporal, evidence, verification, deploy, outcome, and annotation relationships.
- [x] 5.5 Implement cited `what`, `why`, `when`, `how`, `verification`, and `outcome` facet packets with trust summaries, contradictions, gaps, freshness, and pagination metadata.
- [x] 5.6 Add query tests for ambiguous entities, historical paths, removed symbols, topology changes, analytics event emission versus provider ingestion, stale graphs, canceled refreshes, and partial adapter coverage.

## 6. History Workbench and User Knowledge

- [x] 6.1 Add thin Tauri commands and typed IPC wrappers for backfill/refresh/cancel/status, time travel, release listing, entity lineage, causal traversal, comparison, and evidence lookup.
- [x] 6.2 Add a history workbench with release spine, commit drill-down, time slider, unreleased state, search, filters, freshness/coverage, and keyboard-accessible navigation.
- [x] 6.3 Add synchronized as-of topology and topology-diff views showing entity evolution, communities, hubs, bridges, structural surprises, and bounded impact/path changes over time; preserve stable visible-node positions while scrubbing, animate added/removed/changed topology, prefetch adjacent states, and coalesce slider input to animation frames.
- [x] 6.4 Add a selected release/change/causal-thread inspector with six-facet summary, evidence drawer, trust labels, contradictions, source links, gaps, truncation, and adapter freshness.
- [x] 6.5 Add local user annotations and corrections as append-only evidence with author/time/source metadata; never silently overwrite extracted history or upgrade inferred facts.
- [x] 6.6 Add focused frontend tests for time travel, lineage ambiguity, no-tag repositories, stale/partial indexes, missing evidence, large-history bounds, annotations, and accessible inspection.

## 7. Review, Export, and Agent-Ready Context

- [x] 7.1 Derive a compact as-of history slice for changed files using the shared query service and inject only cited constraints, prior episodes, failures, regressions, and verification leads into Review.
- [x] 7.2 Render the same qualified slice in Review and reviewer-proof Markdown without creating findings, changing severity, or upgrading evidence state.
- [x] 7.3 Extend local Repo/agent-context exports with bounded temporal graph summaries, entity lineage, causal threads, stable IDs, and graph/query schema versions.
- [x] 7.4 Add regression tests proving inferred history remains a lead, external provider status remains unknown without evidence, and current Review behavior works when no history graph exists.

## 8. Validation and Product Handoff

- [x] 8.1 Run targeted Rust migration, Git-object, checkpoint/delta, lineage, adapter, backfill, refresh, and query tests, then affected desktop unit tests.
- [x] 8.2 Run typecheck, Biome/lint, Playwright coverage for history/Review flows, and a production desktop build.
- [x] 8.3 Runtime-verify tagged and untagged repositories, commit/release/date time travel, incremental refresh, rewritten-history repair, entity lineage, annotation persistence, and an analytics-event causal query.
- [x] 8.4 Benchmark backfill, incremental update, as-of reconstruction, causal query latency, and database growth on small and long-lived repositories; calibrate bounds and document coverage limits.
- [x] 8.5 Update the archived Codebase History Explainer status and `PROJECT_STATUS.md` only after implementation and runtime verification; do not claim MCP availability from this change.
- [x] 8.6 Measure slider scrub p50/p95, checkpoint-cache hit rate, background CPU/I/O, memory, and frame responsiveness while backfill runs; optimize until history navigation stays interactive on the long-lived acceptance repository.

## 9. Release-Qualification Remediation

- [x] 9.1 Replace ordinal-adjacent history materialization with explicit parent-to-child DAG deltas, including correct first-parent merge diffs and merge/branch reconstruction tests.
- [x] 9.2 Make bounded-window refresh replace stale revision projections, persist every release checkpoint as a discoverable revision, and test a rolling fast-forward window.
- [x] 9.3 Stage refresh metadata so cancellation, failure, rewrite repair, or engine repair cannot advance freshness or destroy the last successful readable graph.
- [x] 9.4 Preserve file-limit truncation and coverage gaps from Git tree enumeration through checkpoints, deltas, UI, and queries.
- [x] 9.5 Qualify same-revision/entity episode associations without presenting association alone as extracted causality.
- [x] 9.6 Bound history-slider in-flight work, clear repository/backfill caches, prevent stale response errors, and make event listener cleanup race-safe.
- [x] 9.7 Add tag-aware freshness, bounded snapshot retention, merge/window/cancel/truncation regression tests, and rerun the complete history verification matrix.
