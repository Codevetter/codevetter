---
title: Local Graph and Release History MCP
description: Opt-in, read-only, stdio-only MCP server exposing one repo's structural graph and release history to local coding agents.
---

CodeVetter can expose one repository's persisted structural graph and release
history to local coding agents over MCP. The server is a native binary bundled
beside the desktop app. It uses stdio only: there is no HTTP endpoint, account,
daemon, or provider call.

## Enable a repository

1. Open the repository in CodeVetter and build its release history from Repo.
2. Open **Settings → Agent MCP**.
3. Review freshness, resource/tool kinds, redaction rules, limits, and the exact
   packaged server path.
4. Choose **Enable**, then **Copy config**.
5. Paste the JSON into the MCP client you control. CodeVetter never edits an
   external agent configuration.

Enablement is repository-specific and disabled by default. The copied command is
bound to an opaque repository ID and the local CodeVetter database. Disabling the
repository makes both new and already-running servers reject subsequent reads.

## Progressive retrieval

Agents should start with compact tools and hydrate detail only when needed:

- `graph_query` finds ranked structural seeds; `graph_get_node`,
  `graph_get_neighbors`, `graph_path`, and `graph_impact` deepen one question.
- `history_list_releases` and `history_search` orient an agent in time.
- `history_get_state`, `history_lineage`, `history_explain`, `history_trace`, and
  `history_compare` reconstruct and explain bounded history.
- `history_get_evidence` hydrates only explicitly selected evidence IDs.

Every tool has an input/output schema and read-only, idempotent, closed-world
annotations. Results include structured content plus a short text fallback,
stable IDs, freshness, engine/schema identity, trust, gaps, applied limits, and
resource links. Pagination cursors are opaque and request/repository-bound.

## The analytics-event boundary

For an analytics event, CodeVetter can prove local facts such as the definition,
call sites, release that changed it, and linked tests. That proves code-side
emission—not provider ingestion, delivery, dashboard processing, or visibility.
Unless imported provider evidence exists, the outcome facet explicitly remains
unknown and supplies evidence IDs that can be hydrated separately.

## Safety and privacy

- History and graph connections are opened read-only with bounded busy/query
  timeouts. The only write is the separate metadata-only access audit.
- No mutation, refresh, shell, filesystem-write, arbitrary SQL, transcript-read,
  external-provider, or network tool exists.
- Repository paths do not appear in URIs, cursors, or audit rows. Sensitive paths,
  secret-looking values, raw transcripts, credentials, and oversized excerpts are
  removed again at the serialization boundary.
- Every response is bounded by page, node, edge, hop, evidence, excerpt, duration,
  and 256 KiB serialized-response limits.
- The audit records only repository ID, server session, operation, status,
  timestamp, duration, result count, and response bytes. Settings can inspect and
  clear it. Arguments, query text, prompts, resource content, and evidence payloads
  are never recorded.

The server remains usable when the desktop window is closed, provided the local
database and repository still exist. A one-second HEAD cache avoids spawning Git
for every agent query; repository scope/disable authorization is still checked on
every request.

## Development and verification

From `apps/desktop`:

```bash
pnpm prepare:mcp-sidecar
pnpm bench:mcp
cargo test --manifest-path src-tauri/Cargo.toml mcp::
cargo test --manifest-path src-tauri/Cargo.toml --test mcp_stdio
```

`prepare:mcp-sidecar:release` builds the target-suffixed binary Tauri expects in
`src-tauri/binaries/`; that generated binary is ignored by Git. Release builds
package it through `bundle.externalBin`, so the installed config needs no Node,
Python, download, or service endpoint.

Compatibility was rechecked on 2026-07-14 with isolated client homes and a fixture
database: Claude Code 2.1.197 reported the release binary connected; Cursor Agent
2026.07.01 reported it ready and listed all 13 tools. Codex CLI 0.144.1 also
accepted the generated stdio configuration; the protocol-level claim is based on
the two clients that actually launched and interrogated the server.
