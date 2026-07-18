## Why

CodeVetter can show recent commits, release metrics, decision markers, agent transcripts, reviews, and QA evidence, but it cannot reconstruct how a repository became its current shape or replay that shape at an earlier point. The primary product opportunity is a temporal software graph: releases are durable checkpoints, commits are deltas, entities retain lineage, and intent/implementation/verification/runtime outcomes form cited causal threads. The structural graph is the necessary floor; history is the differentiated workbench.

## What Changes

- Add a versioned temporal software graph whose primary spine is releases, whose intermediate history is commit-level deltas, and whose change episodes connect intent, code, verification, shipping, runtime outcomes, regressions, and fixes.
- Build canonical structural checkpoints for every reachable release and an unreleased HEAD, with reproducible commit deltas between them so users can time-travel to a release/commit/date and inspect added/removed/evolved symbols, relationships, communities, hubs/bridges, events, tests, and execution paths.
- Track entity lineage across rename, move, signature change, split, merge, deletion, and reintroduction using source-backed stable identity plus qualified `evolved_from` relationships.
- Derive release boundaries from Git tags while representing unreleased work explicitly, and preserve provenance, trust, timestamps, and missing-evidence states on every historical claim.
- Add deterministic as-of, between, first-seen, last-changed, lineage, regression, release comparison, and causal-trace queries answering what/why/when/how/verification/outcome with evidence and explicit uncertainty.
- Add opt-in evidence adapters for local Git/PR exports, changelogs/ADRs, agent sessions, review/QA, deploy/release records, analytics/log/incident exports, and later task/chat connectors. External facts are imported only with explicit user configuration and retain source/freshness boundaries.
- Add a Repo history workbench combining a release spine, time slider, topology diff, entity evolution, causal episode trace, evidence drawer, and user-supplied annotations for missing intent; expose compact relevant history beside Review.
- Backfill progressively—current state and release checkpoints first, commit detail on demand/background—while keeping indexing resumable, local-first, secret-safe, and honest about gaps.
- Keep MCP transport in the dependent MCP change, but make the temporal query contract complete enough that agents receive the same time-travel and causal capabilities.

## Capabilities

### New Capabilities

- `release-history-graph`: Build, persist, query, and render a release/commit-aware temporal software graph with structural time travel, entity lineage, causal evidence, runtime outcomes, annotations, and Review integration.

### Modified Capabilities

- None.

## Impact

- Rust temporal indexing/query services, Git object/tag scanning, canonical structural snapshot/delta generation, source adapters, and SQLite migrations.
- Tauri IPC contracts and TypeScript types for graph refresh, summaries, traversal, and evidence lookup.
- Repo history UI, Review history context, proof export, and focused frontend/backend tests.
- Depends on the canonical `structural-repo-graph` contract planned by `add-graph-trust-paths`; no new network requirement, target-repo write, or release/deploy behavior.
