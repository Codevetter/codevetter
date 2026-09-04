---
title: Local evidence MCP
description: Opt-in, read-only, stdio-only MCP server exposing one repository's qualified graph, history, review, and business-rule evidence.
---

CodeVetter can expose one repository's persisted structural graph, Git history,
deterministic review manifests, and evidence-traced business rules to local
agents through a packaged, read-only MCP server. The server uses stdio, opens
no network listener, requires no credentials, and cannot modify the repository
or refresh its indexes.

## Setup

1. Open the repository in **Repo Unpacked**.
2. In **Git history playback**, select **Index history**. Re-run it whenever the
   panel reports that the index is stale.
3. Open **Settings → Agent MCP** and select the repository.
4. Review the freshness, exposed surface, limits, and redaction summary, then
   select **Enable**.
5. Select **Copy config** and paste the exact JSON into the local MCP client.
   Reload the client if it does not detect configuration changes automatically.
6. For review work, ask the client to call `prepare_review` with the task and
   exact worktree, staged, commit, or range selector shown in Review.

Opening Agent MCP prepares a disabled opaque scope so CodeVetter can preview
the exact configuration; it does not enable access. The generated entry has
this shape, with machine-specific values supplied by the app:

```json
{
  "mcpServers": {
    "codevetter-history": {
      "command": "<packaged sidecar path shown in Settings>",
      "args": [
        "--database",
        "<local CodeVetter database path>",
        "--repo-id",
        "<opaque repository id>"
      ]
    }
  }
}
```

The `command` resolves to the packaged `codevetter-mcp` sidecar. Its supported
invocation is `codevetter-mcp --database <database> --repo-id <opaque-id>`;
Settings supplies both machine-local values.

Do not substitute a repository path for `--repo-id` or hand-edit the generated
arguments. For more than one repository, copy each repository's entry and give
the client-side entry a unique name while preserving its command and arguments.

### Revoke access

In **Settings → Agent MCP**, select the repository and choose **Disable**.
Running MCP processes recheck the scope, so subsequent requests are rejected
without requiring a client restart. Remove the entry from the MCP client as a
separate cleanup step. Clearing the access audit does not disable access, and
removing only the client entry does not revoke the scope in CodeVetter.

## Tools

All tools are read-only, idempotent, repository-scoped, and reject unknown
arguments. Responses use a versioned envelope containing freshness, applied
limits, stable links, and structured data.

| Tool | Purpose |
|---|---|
| `prepare_review` | Compose a bounded `codevetter.review-packet/v1` for one exact change from existing graph, history, prior-review, and verification-candidate evidence. It does not run a reviewer or execute a check. |
| `resolve_evidence_scope` | Resolve a bounded flow, exact change, or codebase portfolio into canonical testing or performance candidates. It never executes the candidates and therefore returns planning evidence, not runtime proof. |
| `verification_get_receipt` | Read one persisted canonical local-check receipt by bounded run ID inside the authorized repository scope. It cannot start, cancel, or mutate verification. |
| `graph_query` | Search the structural graph or return a compact overview. |
| `graph_get_node` | Explain one stable node and its source-backed relationships. |
| `graph_get_neighbors` | Read bounded incoming, outgoing, or bidirectional neighbors. |
| `graph_path` | Find a trust-weighted path between two nodes. |
| `graph_impact` | Find bounded upstream or downstream impact leads. |
| `history_list_releases` | List indexed release summaries. |
| `history_list_landmarks` | List bounded release and candidate-inflection landmarks. |
| `history_list_contributors` | Summarize bounded ancestry-aware contributor participation for one interval. |
| `history_search` | Search releases, commits, entities, events, and annotations. |
| `history_get_state` | Reconstruct an indexed state at a release, revision, or date. |
| `history_lineage` | Follow an entity through moves, renames, splits, merges, and removal. |
| `history_explain` | Explain what, why, when, how, verification, outcome, and known gaps. |
| `history_trace` | Trace bounded evidence from intent through verification and outcome. |
| `history_compare` | Compare two persisted states without inventing causation. |
| `history_get_evidence` | Hydrate an explicit batch of stable evidence IDs. |
| `review_list_manifests` | List redacted deterministic review coverage and qualification manifests. |
| `archaeology_list_rules` | List or search bounded evidence-traced business rules. |
| `archaeology_list_domains` | List bounded business-rule domain summaries. |
| `archaeology_get_rule` | Explain one exact evidence-traced business rule. |
| `archaeology_reverse_source` | Find rules linked to one opaque source identity. |
| `archaeology_list_relations` | List rule dependencies, conflicts, aliases, and supersession. |
| `archaeology_compare_temporal` | Compare two persisted archaeology generations, revisions, or releases. |
| `archaeology_hydrate_evidence` | Hydrate explicitly selected evidence owned by one rule. |

Start with graph overview, release listing, history search, review manifests,
or the business-rule catalog. Follow stable IDs into explanation, lineage,
trace, or hydration calls, and request only citations the agent actually needs.
Normal execution never makes a model or provider call.

### Resolve verification evidence

`resolve_evidence_scope` is the direct agent projection of the same Rust planner
used by native Testing/Performance and `codevetter scope`. Choose `testing` or
`performance`, then provide a `flow`, `change`, or `codebase` scope. Flow and
change scopes require `scope_value`; codebase scope omits it.

```json
{
  "consumer": "performance",
  "scope_kind": "change",
  "scope_value": "main...feature"
}
```

The response preserves candidate confidence, source leads, uncovered paths,
dirty state, and limitations. MCP remains read-only: use the UI or CLI to admit
and execute a selected workload.

### Read a verification receipt

`verification_get_receipt` is the read-only agent projection of a local check
that already ran through native Review, the CLI, or another explicit local CLI
consent boundary. It requires the exact persisted `run_id`, verifies that the
receipt belongs to the MCP server's authorized repository, decodes the
canonical `codevetter.local-check/v1` contract, and applies the normal MCP
redaction and response-size policy.

```json
{
  "run_id": "local-check-01234567-89ab-cdef-0123-456789abcdef"
}
```

The tool never executes verification. Agents that need execution must use the
separate local CLI consent boundary; enabling MCP does not grant that authority.

### Prepare a review

`prepare_review` is the task-level entry point for a review agent. Use the
exact selector CodeVetter shows for the selected change:

```json
{
  "task": "Review this change against its task and acceptance criteria.",
  "change": "main...feature"
}
```

The packet binds itself to the resolved Git identity and changed paths. It
keeps graph impact as qualified leads, preserves stale or missing-source
limitations, includes prior deterministic review manifests where available,
and suggests testing or performance targets through the existing deterministic
scope resolver. Suggested targets are not executed and are not proof. Invalid
or option-shaped selectors fail closed, and the fixed MCP repository scope
cannot be overridden by arguments.

## Resources

Resources use opaque `codevetter-history://` URIs; repository paths do not
appear in those URIs. Repository and graph overviews, recent structural
snapshots, and indexed releases are discoverable through resource listing.
Parameterized templates expose the remaining kinds. The versioned landmark
catalog and release-scoped contributor summaries are also discoverable directly.

| Resource kind | Contents |
|---|---|
| `repository` | Structural and history status for the scoped repository. |
| `graph` | Compact current structural overview. |
| `snapshot` | Metadata, analysis, and projection for one structural snapshot. |
| `community` | One bounded structural community. |
| `release` | State at an indexed release tag. |
| `landmark-catalog` | Versioned bounded release and candidate-inflection catalog. |
| `contributor-summary` | Versioned bounded release-cycle participation summary. |
| `commit` | State at an indexed Git revision. |
| `episode` | One causal episode. |
| `entity-lineage` | Head-relative lineage for one stable entity. |
| `causal-thread` | A causal trace rooted at an event. |
| `annotation` | One persisted history annotation. |
| `evidence` | One explicitly selected evidence record. |

Resource IDs are encoded by CodeVetter. Use URIs returned by tool or resource
results rather than constructing them from local paths.

## Freshness, bounds, and evidence

Every successful tool or resource response reports structural and history
freshness. CodeVetter checks the repository's current Git HEAD and tags during
scoped reads. A stale index remains readable and is labeled stale; MCP never
silently rebuilds it. Return to **Repo Unpacked → Git history playback** and
select **Index history** to update it.

The server applies these hard bounds:

- 25 items by default and at most 100 items per page
- 240 graph nodes, 480 graph edges, and 8 traversal hops
- 32 explicit evidence IDs per hydration request
- 2,048 bytes per returned excerpt and 256 KiB per response
- 5 seconds per query and at most 4 concurrent query workers

Use filters and opaque continuation cursors when a response is truncated.
Explanations preserve trust, citations, and known gaps; absence of evidence is
reported as a gap rather than converted into inferred fact.

## Privacy and access audit

The MCP server reads the CodeVetter SQLite database in query-only mode. It does
not expose arbitrary files, raw transcripts, credentials, environment values,
authorization material, raw provider payloads, or unrestricted database access.
Sensitive references and secret-shaped values are redacted, absolute local
paths are removed from responses, and oversized output is rejected rather than
leaked partially.

CodeVetter records bounded operational metadata in its own local database:
opaque repository and server-session IDs, operation, status, duration, result
count, response size, and timestamp. It does not record arguments, prompts,
query text, or returned evidence. At most 1,000 rows are retained per repository.
Recent entries can be inspected or cleared in **Settings → Agent MCP**.

## Troubleshooting

- **Enable is unavailable:** select **Index history** in Repo Unpacked first.
- **History is stale:** re-index history. Stale responses are still bounded and
  readable, but they do not describe unindexed commits or tags.
- **The packaged server is unavailable:** use the installed desktop app. For a
  source build, run `pnpm core:prepare-mcp` from the repository root;
  both prepare the target-specific sidecar before starting Tauri.
- **The client reports disabled or unavailable scope:** verify the selected
  repository is enabled, then copy its configuration again. Do not reuse another
  repository's opaque ID.
- **A resource or evidence ID is unavailable:** search or explain again and use
  IDs returned by the current index. MCP does not fall back to arbitrary file
  reads.
- **A response is too large or times out:** reduce the limit, add graph/history
  filters, narrow the date range, follow the cursor, or request fewer evidence
  IDs.
- **A copied configuration stops working after reinstalling or moving the app:**
  copy the current configuration again so the sidecar path matches the install.

## Local-only limits

This surface is intentionally for one machine and the current OS user. It is not
a hosted endpoint, remote collaboration service, browser embed, write API,
indexer, or provider gateway. The MCP client and CodeVetter must be able to read
the same local database and repository. Publishing a live graph or README embed
requires a separate privacy-aware hosted surface.
