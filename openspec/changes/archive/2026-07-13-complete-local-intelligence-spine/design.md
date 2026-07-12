## Context

CodeVetter already has a normalized `session_message_archive`, FTS search, a 10-second incremental Claude/Codex tail loop with scheduled and manual full-index recovery, raw-session command extraction, a Review verification timeline, file-level history explanations, and a persisted Repo Unpacked `history_brief`. The missing pieces are not new ingestion systems: they are bounded joins across the evidence already stored.

The three archived PRDs converge on one local evidence spine. Active transcript messages must become visible promptly; a command anchor must retain enough surrounding human/assistant conversation to explain intent; and file-level commit/decision/test/finding signals must be queryable as relationships rather than only rendered as prose. All raw data remains local, source paths and message indexes remain evidence anchors, and primary UI surfaces stay compact.

## Goals / Non-Goals

**Goals:**

- Preserve the existing incremental watcher as the single live-ingestion mechanism and make its cadence/recovery contract observable and regression-tested.
- Query bounded non-command message windows from the normalized archive around a command's session/source line.
- Carry structured conversation windows through Review history, timeline replay packets, segment handoffs, and proof export.
- Persist a versioned, deterministic history graph inside Repo Unpacked history briefs and expose bounded exact-path/token queries.
- Include files, commits, decisions, tests, co-change relationships, and available Review finding/session/command context without requiring network access.

**Non-Goals:**

- Adding `notify`, FSEvents, another watcher thread, local HTTP/SSE, or a new production dependency without measured evidence that the shipped 10-second loop is inadequate.
- Storing or displaying complete transcripts in timeline rows.
- Hosted/team sync, GitHub-app/ticket/Slack ingestion, generic code search, semantic embeddings, or changing repository history.
- Treating commit messages, agent conversation, or graph topology as verified truth.

## Decisions

### Keep one best-effort ingestion loop and expose its policy

The existing tail loop incrementally reads complete appended JSONL lines every ten seconds, skips when the full-index lock is held, discovers new Codex files directly, emits `session_archive_updated`, and is repaired by the next full index. This already satisfies the PRD's latency/recovery requirement. Add a small serializable policy/status contract plus deterministic recovery tests instead of a second filesystem watcher.

Alternative considered: add the `notify` crate and platform-specific watchers. Rejected because it creates another event/coalescing/rotation path, a production dependency, and duplicate concurrency against the proven byte-offset indexer without a measured latency problem.

### Reconstruct conversation from normalized archive rows

Add a SQLite window query that resolves the archive row nearest a command's `source_line`, then returns a capped number of rows before/after in `message_index` order. Enrich raw-session command signals with role/kind/text/source-line/message-index items, excluding the command row itself from the non-command excerpt list. Use bounded secret-like redaction and character caps before data reaches UI/proof contracts.

Alternative considered: reread raw JSONL around every command on each Review load. Rejected because the archive already normalizes adapter differences and is incrementally current; repeated raw parsing scales poorly and makes UI behavior adapter-specific.

### Derive replay packets without persisting a second timeline table

Timeline items remain recomputed from Review/history evidence. Structured conversation windows are attached to command anchors and folded into replay packets in chronological order. The primary timeline shows only the first bounded excerpts; source/session/message anchors remain available for jump and proof packets.

Alternative considered: persist a new verification-event spine. Rejected for this slice because existing review IDs, session IDs, source lines, command events, QA records, and fix records already provide stable joins; a migration would duplicate derived state.

### Persist a versioned history graph within `history_brief`

Move new Repo Unpacked history briefs to schema v2 and add a backward-compatible defaulted graph field. Recent commits gain defaulted changed-file lists harvested from a bounded `git log --name-only` pass. Graph nodes cover repo/file/commit/decision/test; edges cover touches/explains/verifies/co-changes. Review-only recurring findings, agent notes, and command anchors remain derived in Review history explanations and can be projected into the same frontend graph contract when available.

Alternative considered: a new SQLite history-graph store. Rejected because Repo Unpacked snapshots already own the durable, commit-keyed local artifact; recomputing a bounded graph during scan avoids migrations and stale cross-snapshot rows.

### Query deterministically with exact path precedence

The Tauri query accepts the active graph, optional file path, and optional text. Exact node ID/path/label matches rank before token matches. Results include the selected nodes, one-hop relationships, citations, confidence/lead qualification, and explicit node/edge/truncation bounds. No LLM or network call is used.

## Risks / Trade-offs

- [Ten-second polling can miss an immediate UI moment] → UI already listens for archive-update events; document the best-effort latency and retain full-index recovery. Add a direct manual index path rather than a duplicate watcher.
- [Archive source lines may be absent for some adapters] → fall back to the closest message index only when a session/message anchor is supplied; otherwise preserve existing command excerpts without claiming reconstructed context.
- [Conversation excerpts can contain sensitive values] → cap text, redact secret-like assignments/authorization strings, exclude secret-bearing file paths, and never expose raw payload JSON in derived packets.
- [History graph grows on large repos] → cap commits, changed files per commit, decisions, tests, nodes, edges, query matches, and one-hop expansion; expose truncation.
- [Commit subjects or conversation overstate intent] → label them as leads, retain citations, and keep confidence thin unless multiple independent evidence kinds support the answer.

## Migration Plan

1. Add default-compatible conversation and history-graph fields/types; old history briefs continue loading as schema v1 with an empty graph.
2. Add archive-window and watcher-policy backend tests before UI integration.
3. Emit schema-v2 history briefs and graph queries for new scans; do not rewrite old snapshots.
4. Add Review timeline/proof and Repo query UI behind empty-state-safe contracts.
5. Roll back by removing the new UI/commands; defaulted serialized fields remain harmless to tolerant readers.

## Open Questions

- Measure actual tail-to-UI latency in normal use before considering platform filesystem notifications.
- A later change may project tickets/owners/releases into the graph, but only with explicit local connectors and evidence provenance.
