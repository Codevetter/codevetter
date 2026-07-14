## Why

CodeVetter’s native `RepoGraph` is a capped metadata map built mostly from manifests, paths, and regex markers. It can identify packages, routes, commands, tables, tests, and decisions, but it does not provide the symbol-level structure, cross-file resolution, graph analysis, or query quality expected from a serious repository graph. Graphify establishes the minimum useful product bar: deterministic AST extraction, source-backed confidence, communities, hub/bridge analysis, incremental updates, and query/path/explain over a persisted graph.

## What Changes

- Replace the current “repo memory graph” claim with a versioned structural graph built from deterministic syntax-aware extractors, while retaining the fast metadata map only as an explicitly labeled fallback.
- Add symbol-level nodes and cross-file relationships for modules, files, functions, methods, classes/types, imports/exports, calls, inheritance/implementation, fields/types, routes, commands, database/schema objects, tests, configuration, infrastructure, analytics events, docs, and decision/rationale markers.
- Resolve cross-file references in a second pass and attach trust, origin, source locations, ambiguity, and extractor coverage to every relationship.
- Add incremental changed-file indexing, stale/deleted-node repair, deterministic IDs, graph snapshots, JSON import/export, and explicit Graphify interoperability.
- Add graph intelligence at least equivalent to Graphify’s useful code workflow: communities/subsystems, highest-degree hubs, bridge/cross-community relationships, surprising connections, neighborhood, impact, query, explain, and trust-weighted path.
- Replace the current small static visualization with a scalable interactive graph supporting search, filtering, community focus, node inspection, path highlighting, and large-graph bounded rendering.
- Feed qualified graph neighborhoods and paths into Review, release-history snapshots, exports, and later MCP access without allowing topology alone to create findings.
- Keep broad media ingestion, generated wikis, assistant hooks, PR dashboards, hosted graph databases, and remote graph serving out of this change.

## Capabilities

### New Capabilities

- `structural-repo-graph`: Build, maintain, analyze, query, visualize, import, and export a Graphify-grade local repository graph with trustworthy source evidence.

### Modified Capabilities

- None.

## Impact

- Replaces and migrates the persisted `RepoGraph` contract and the Repo graph experience.
- Adds a syntax-extractor/engine boundary, symbol-resolution pipeline, indexed graph storage, analysis/query services, Tauri IPC, Review context, and benchmark fixtures.
- Requires justified production dependencies for deterministic parsing and graph algorithms, or a bundled engine that provides equivalent capability without requiring user-installed Python/Node.
- Aligns the structural graph with `add-release-history-graph`, which will reference structural snapshots and topology deltas by release.
- Remains local-first, secret-safe, and non-mutating toward the selected repository.
