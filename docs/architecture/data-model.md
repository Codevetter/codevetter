---
title: Data model
description: SQLite tables, persistence boundaries, and what lives where.
sidebar:
  order: 3
---

# Data model

All product state lives in a single local SQLite database managed by
`rusqlite` inside the Tauri backend. No server, no sync, no cloud DB.

- **Schema + migrations**: `apps/desktop/src-tauri/src/db/schema.rs`
- **Queries**: `apps/desktop/src-tauri/src/db/queries.rs`
- **DB file location**: the Tauri app data directory (platform-managed).

The webview never touches SQLite directly. It goes through Tauri commands →
`queries.rs`.

The additive verification-workbench identity and stale-state map is documented
in [verification-workbench.md](./verification-workbench.md).

## Table groups

Schema is created with `CREATE TABLE IF NOT EXISTS` on startup; one-time
repairs run as idempotent migrations guarded by feature flags. The groups:

| Group | Tables | Purpose |
|---|---|---|
| Sessions / telemetry | `cc_projects`, `cc_sessions`, `cc_session_days`, `cc_messages`, `session_model_usage`, `codex_usage_observations`, `codex_usage_repair_audit`, `codex_usage_sources`, `codex_lineage_checkpoints`, `codex_usage_ledger`, `codex_usage_coverage`, `session_adapter_runs`, `session_message_archive` | Indexed agent transcripts, legacy summaries, revisioned Codex evidence and coverage, repair diagnostics, per-day attribution, per-model usage splits, FTS archive. |
| Reviews | `local_reviews`, `local_review_findings`, `review_procedure_events` | Review runs, findings (with `disposition` accept/dismiss), staged-verification events. |
| Synthetic QA | `synthetic_qa_runs` | QA runs persisted as first-class records; fed as `qa_evidence` into review prompts. |
| Audience validation | `audience_validation_runs`, `audience_validation_responses` | Privacy-minimizing audience runs + agent/human/imported responses; ShipRank diagnostics derive from these. |
| Repo / unpack | `repo_projects`, `repo_project_mapping`, `repo_intel_reports`, `repo_unpacked_reports` | Repo projects, fleet linking, intel, unpacked briefs (inventory + report JSON). |
| Structural graph | (structural_graph tables, managed by `structural_graph/`) | Canonical syntax-aware graph: nodes, edges, communities, trust, source anchors. |
| History graph | (history_graph tables, managed by `history_graph.rs`) | Immutable release/HEAD checkpoints, commit deltas, annotations. |
| T-Rex | `trex_watchers`, `trex_pr_runs` | PR watchers and per-PR review runs. |
| Agent processes | `agent_processes` | Spawned CLI agent subprocesses. |
| SaaS Maker sync | `saas_maker_sync` | Fleet project link sync state. |

## Persistence invariants

- **Telemetry is additive and idempotent.** The indexer dedups Claude usage by
  `(message.id, requestId)` (last key persisted per session in
  `cc_sessions.last_usage_key`) because Claude Code writes one JSONL line per
  content block and repeats the final usage. Don't re-add raw usage without
  the dedup gate — see
  [knowledge/learnings/telemetry-and-indexing.md](../knowledge/learnings/telemetry-and-indexing.md).
- **Codex accounting is revisioned and observation-backed.** `token_count`
  events are normalized into the append-only `codex_usage_ledger`; source byte
  cursors, lineage checkpoints, pricing provenance, and coverage are committed
  before ingestion is acknowledged. Exact cumulative repeats and copied
  prefixes are excluded, while compact subagent counter resets remain owned
  usage. Verified totals use accepted rows only. Legacy summaries are a
  separate evidence tier and never become fabricated daily ledger rows.
- **Token coverage and price coverage are independent.** A token-complete event
  can be `priced_exact`, `priced_range`, or `unpriced`. Unknown standard versus
  priority service tier produces a bounded API-equivalent range, not a made-up
  point estimate and never a claim about subscription spend.
- **Revision 4 has a one-release projection rollback.** Before its first write
  to legacy session, model, or v1 observation projections, it captures those
  rows exactly once in the `codex_*_projection_backup` tables. Starting with
  `CODEVETTER_CODEX_ACCOUNTING=legacy` restores that snapshot transactionally
  without deleting the immutable v2 ledger.
- **Migrations are guarded and idempotent.** Each one-time repair carries a
  feature-flag gate and is safe to run on a fresh DB. Re-running on an
  already-repaired DB is a no-op.
- **Unpack reports store both inventory and report JSON** in
  `repo_unpacked_reports` so a brief can be re-rendered without re-scanning.
- **Findings carry `disposition`** (accept/dismiss) — dismissed findings are
  excluded from bulk fix selection and feed the Home acceptance-rate strip.

## What is not persisted

- **LLM API keys** — stored in user settings via Tauri preferences, not in
  SQLite review tables.
- **Raw CLI agent transcripts** — read from disk on demand; only parsed
  summaries land in SQLite.
- **Structural graph for unopened repos** — built on demand and persisted per
  repo; not pre-built.
