## Context

The current native graph has schema-v1 nodes with `kind`, `label`, optional path/detail, and sources; edges contain `from`, `to`, `kind`, free-text evidence, and sources. Its fast builder caps at 1,024 nodes/2,048 edges and uses walk metadata. The enriched builder scans a bounded subset of source text for routes, Tauri commands, tables, system markers, and decisions. The UI then reduces graphs above 46 nodes before rendering. An optional GitNexus integration provides deeper symbol context but requires a separately available Node engine and is presented as a secondary lookup rather than the repository’s canonical graph.

Graphify’s relevant floor is materially stronger: deterministic tree-sitter AST extraction across many languages; functions/classes/methods and `calls`/`imports`/`inherits` relationships; cross-file resolution; `EXTRACTED`/`INFERRED`/`AMBIGUOUS` trust; communities, hubs, and surprising connections; incremental changed-file updates; persisted JSON; and query/path/explain plus MCP. CodeVetter should match that structural usefulness and then differentiate through verification evidence and release-wise topology history.

## Goals / Non-Goals

**Goals:**

- Make one canonical structural graph good enough for repository understanding, review context, release comparison, and agent retrieval.
- Build code structure deterministically without LLM calls and report exact language/extractor coverage.
- Provide symbol-level, source-located, cross-file relationships with honest trust and ambiguity.
- Support Graphify-grade query, explain, path, neighborhood, impact, community, hub, and bridge workflows.
- Scale persistence/query independently from the bounded visualization.
- Preserve fast metadata results as early feedback and as an honest fallback, not as the deep graph.

**Non-Goals:**

- Matching Graphify’s PDF/image/video ingestion, wiki generation, assistant hooks, PR dashboard, learning overlay, or remote HTTP server.
- Requiring users to install Graphify, Python, Node, or another CLI for the shipped canonical graph.
- Replacing Git or the release-history graph with one timeless snapshot.
- Treating an inferred path, centrality score, or community assignment as proof of runtime behavior or a defect.

## Decisions

### Introduce an engine boundary with a bundled deterministic baseline

Define a `StructuralGraphEngine` contract that accepts a canonical repository root, changed/deleted file set, ignore policy, cancellation/progress handle, and previous cursor, and returns versioned nodes, edges, coverage, diagnostics, and a new cursor. Ship a bundled deterministic engine for the common CodeVetter matrix at minimum: TypeScript/TSX, JavaScript/JSX, Rust, Python, Go, Java, C/C++, C#, Ruby, PHP, Kotlin, and Swift. Unsupported languages still contribute file/manifest/doc nodes and explicit coverage gaps.

Use tree-sitter or another syntax-aware parser with pinned grammars after dependency/license/size review. Keep optional Graphify and GitNexus adapters for interoperability and comparison, but do not make the product-quality path depend on a user-installed runtime.

Alternative: invoke Graphify directly. Rejected as the only shipped path because it adds a Python/runtime/install boundary and makes core CodeVetter behavior externally versioned. Its MIT implementation and graph contract remain a reference and optional adapter.

### Separate fast metadata, canonical structure, and temporal snapshots

The fast map remains available immediately and is labeled “metadata map.” The canonical structural graph is persisted in normalized SQLite node/edge/source tables with indexed identity, path, symbol, kind, community, and adjacency fields. JSON remains an interchange/export format, not the primary query store.

Each successful build records schema version, engine/version, repository HEAD, ignore fingerprint, extractor coverage, truncation, diagnostics, and a stable snapshot ID. Release history stores references/deltas against these snapshots rather than duplicating graph blobs.

Alternative: keep the graph only inside Repo Unpacked `inventory_json`. Rejected because incremental updates, large-graph queries, release diffs, and MCP pagination need indexed storage.

### Extract first, resolve second, analyze third

Per-file extraction emits source-located file/module/symbol/schema/config/doc/decision/event nodes and directly observed edges. A deterministic second pass resolves imports, exports, calls, inheritance/implementation, types, test targets, route-command-persistence paths, doc links, config references, and analytics event emission. Exact source relationships are `extracted`; unique deterministic resolution can be `inferred`; collisions remain `ambiguous` with candidates.

The analysis pass assigns communities/subsystems, degree/centrality summaries, bridge edges, cross-community connections, and bounded “surprising” relationships. Algorithms, tie-breaking, and IDs must be deterministic for the same inputs. Community assignments are navigation metadata, not architectural truth.

### Provide one query service over persisted graph data

Expose typed operations for search/resolve, node explanation, neighbors, context-filtered subgraph query, trust-weighted path, upstream/downstream impact, community inspection, hub/bridge lists, and snapshot comparison. Natural-language query is deterministic lexical/entity retrieval plus graph expansion with stop-word handling and explicit seed resolution; optional AI may summarize returned evidence but cannot change the graph.

Every result is bounded and includes source locations, trust, ambiguity, coverage, freshness, and truncation. Query limits are independent from UI limits, and large results use stable pagination/projections.

### Make the UI a graph workbench, not a 46-node illustration

Repo opens with summary cards for coverage, communities, hubs, bridges, and gaps, followed by a searchable/filterable graph. Rendering uses bounded neighborhood/community virtualization, not deletion of graph data. Selecting a node opens its evidence, incoming/outgoing relationships, community, release history, tests, decisions, and available impact/path actions. Users can focus a community, expand neighbors, trace two endpoints, compare snapshots, and open cited source locations.

### Preserve Graphify interoperability without outsourcing correctness

Import current Graphify node-link JSON (`nodes` and `links`/`edges`) with source locations, communities, relation types, and confidence. Export CodeVetter’s graph as versioned JSON plus Markdown context. Optional engine adapters may run only through explicit user action and never mutate the repository or install hooks.

## Risks / Trade-offs

- [Parser breadth inflates binary size and maintenance] → Pin a documented core grammar matrix, measure per-grammar cost, keep the engine boundary modular, and report unsupported coverage honestly.
- [Cross-file resolution overstates certainty] → Separate direct extraction from resolution, retain candidates, and test ambiguous symbols/import aliases.
- [Large repositories overwhelm SQLite or UI] → Incremental per-file replacement, indexed adjacency, paginated queries, community/neighborhood views, cancellation, and measured caps.
- [Graph algorithms produce unstable output] → Deterministic seeds/tie-breaking and golden snapshot tests.
- [Old snapshots cannot satisfy new trust semantics] → Load schema-v1 as `legacy`, keep metadata-map labeling, and rebuild explicitly rather than silently upgrading claims.
- [Graphify parity becomes a moving target] → Maintain a checked capability matrix and fixture benchmark against a pinned upstream release; match the useful code graph contract, not every adjacent feature.

## Migration Plan

1. Add normalized storage and schema-v3 types while preserving schema-v1 inventory reads as legacy metadata maps.
2. Implement core extractors and golden fixtures, then cross-file resolution and graph analysis.
3. Add incremental refresh and the shared query service before replacing the UI.
4. Add Graphify import/export and parity fixtures.
5. Replace the Repo graph label/UI, then integrate bounded graph context with Review and release history.
6. Roll back by retaining the old metadata-map renderer and ignoring rebuildable canonical graph tables; no repository files are changed.

## Open Questions

- Choose the parsing/graph crates after measuring grammar coverage, signed-bundle size, build time, and license compatibility.
- Calibrate the initial language matrix and large-repo acceptance corpus during the implementation spike; expansion must not block correctness for supported languages.
- Decide whether optional local embeddings materially improve broad natural-language graph query after lexical-plus-graph retrieval is benchmarked.
