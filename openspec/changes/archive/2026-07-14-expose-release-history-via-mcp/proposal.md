## Why

CodeVetter’s canonical structural graph and release-history graph are useful only if coding agents can retrieve the same cited context while they plan, edit, review, and debug. Copying large reports or raw graph JSON into prompts is stale and token-heavy; CodeVetter should expose a small, read-only MCP surface that lets agents discover, query, traverse, compare, and hydrate only the repository intelligence needed for the current task.

## What Changes

- Add a separately packaged local MCP server backed by the shared structural and release-history query services from `add-graph-trust-paths` and `add-release-history-graph`; the MCP layer does not rebuild or reinterpret either graph.
- Scope each server process to one explicitly enabled repository and expose nothing by default.
- Provide compact MCP resources for repository/structural-snapshot/community/release/commit/episode/entity-lineage context and read-only `graph_*` plus `history_*` tools for search, node/neighborhood/impact, time travel, lineage, causal tracing, comparison, explanation, and evidence hydration.
- Return schema-validated structured content plus compact text fallbacks, stable IDs/resource links, opaque cursor pagination, byte/result limits, freshness, trust, contradictions, adapter coverage, gaps, annotations, and source citations.
- Add CodeVetter Settings controls for repository enablement, copied client configuration, exposure preview, and a bounded local access audit.
- Start with local stdio transport and no sampling, mutation tools, automatic client-config writes, remote HTTP transport, or external-provider credentials.

## Capabilities

### New Capabilities

- `release-history-mcp`: Securely and efficiently expose scoped structural and release-history resources and read-only query tools to local MCP-capable agents.

### Modified Capabilities

- None.

## Impact

- Depends on the typed Rust query contracts and persisted indexes defined by `add-graph-trust-paths` and `add-release-history-graph`.
- Adds a secondary Rust binary, MCP protocol adapter, resource/tool schemas, read-only SQLite access, packaging/release workflow changes, and Settings UI.
- Likely adds the official Rust MCP SDK as a production dependency after version/license/build review, avoiding a hand-rolled JSON-RPC lifecycle and schema implementation.
- No network listener, cloud service, target-repo mutation, agent sampling, or history refresh through MCP in this change.
