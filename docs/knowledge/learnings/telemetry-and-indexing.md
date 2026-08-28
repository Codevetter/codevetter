---
title: "Learnings: telemetry and indexing"
description: "How CodeVetter parses agent transcripts, deduplicates usage, tracks incremental cursors, calculates costs and quotas, and indexes history in the background."
---

The pipeline that turns raw agent transcripts into the Home usage numbers.
Format matches [new-things.md](new-things.md); roadmap in [README.md](README.md).

## Claude JSONL transcript format (and duplicate usage lines)
- What: Claude Code logs each session as JSONL; an assistant message is written as one line PER CONTENT BLOCK, each repeating the same final `usage` object.
- Why here: the indexer summed every line — 50%+ of usage lines are byte-identical repeats, so ALL Claude token/cost numbers ran ~2.2× inflated until v1.2.17.
- Gotcha (from code): dedup key is `(message.id, requestId)`; duplicates are always adjacent among usage lines but flush up to ~40s apart, so the last key persists per session (`cc_sessions.last_usage_key`) to survive incremental-read boundaries. (`session_adapters.rs` claude parse; `history.rs::fix_claude_usage_dedup`)
- Source: https://github.com/ccusage/ccusage (dedups the same way)

## Cumulative vs delta token counters
- What: some CLIs report per-message token deltas (Claude), others a session-cumulative running total in every event (Codex `total_token_usage`).
- Why here: adding a cumulative total on each incremental pass compounds — one Codex session reached 61.5B tokens / $35k before the v1.1.99 fix.
- Gotcha (from code): a rate-limit-only Codex event can repeat an unchanged
  `total_token_usage` alongside the previous non-zero `last_token_usage`.
  Blindly summing `last` double-counts it. Codex now persists cumulative
  watermarks and exact seen totals, emits accepted/excluded observations, and
  reconciles canonical totals from accepted rows. (`session_adapters.rs`;
  `db/queries.rs::reconcile_codex_usage_totals`)
- Source: https://github.com/openai/codex/issues/14489

## Historical Codex accounting repair
- What: revisioned streaming replay of readable Codex JSONL sources into
  `codex_usage_observations`, followed by session/model reconciliation.
- Why here: old rows can contain both missed live tails and duplicate snapshots;
  changing only the display query cannot recover or safely correct either.
- Gotcha (from code): the repair reads bounded chunks, writes each session in a
  transaction, and is idempotent for a fixed transcript. Missing/unreadable
  sources retain their previous totals and receive an `unrepaired` audit row;
  they are never silently zeroed. A transcript that grows between repair passes
  can legitimately produce a larger second result. (`history.rs::fix_codex_token_totals`)
- Privacy: observation and audit tables contain timestamps, token counts, model,
  disposition, and aggregate diagnostics only—never prompts or responses.
- Qualification: run the repair twice on a frozen database/transcript copy,
  require byte-for-byte-stable aggregates on pass two, and compare readable
  sessions with an independent event scanner. Treat a standalone fork scanner's
  inherited cumulative prefix as replay, not paid child usage. Missing sources
  remain explicitly unrepaired; they cannot be truthfully reconstructed from
  the summary row alone.
- Completion is fail-closed: canonical session/model totals are derived from
  the persisted accepted observations and checked against the streaming parse
  inside each transaction. Any mismatch, failed write, or missing audit keeps
  the accounting revision pending so it retries instead of claiming success.
- A nested subagent parent marker proves lineage, not counter ownership. Compact
  subagent rollouts whose first cumulative total equals their first per-event
  usage have independently reset counters and must be counted. Embedded
  ancestor metadata proves a copied prefix; a later counter reset can still
  establish a trustworthy child-owned suffix even when the parent file is gone.
- Compare independent scanners at the same committed byte cursor. CodexBar
  0.46.0 can retain `scan_complete=0` large files and stale completed sizes
  after `--refresh`; comparing its partial cache with a complete CodeVetter scan
  creates a false disagreement. CodeVetter must publish pending bytes and never
  label partial coverage complete.

## Incremental indexing with byte-offset cursors
- What: re-reading only the appended tail of a growing file, from a persisted byte offset, instead of re-parsing the whole file.
- Why here: transcripts reach 200+ MB and are tailed every ~15s; whole-file re-parsing pegged a core at ~95% (v1.1.98 incident).
- Gotcha (from code): the skip decision must key on byte offset == file size, never mtime strings — mtime nanoseconds drift between reads of the same inode and silently disable the skip. Cursors only advance past complete lines (`complete_lines_prefix`). (`history.rs`; regression test `eval_skip_keys_on_byte_offset_not_mtime`)
- Source: https://man7.org/linux/man-pages/man2/lseek.2.html (concept) + `docs/development/performance.md`

## Local-day bucketing and window boundaries
- What: attributing usage to calendar days in the user's timezone, and converting local midnight to UTC instants for window queries.
- Why here: "today/this week" panels; comparing local-date strings with `Z`-suffix timestamps started weeks 5.5h early in IST (fixed v1.2.9).
- Gotcha (from code): Codex uses accepted observation timestamps directly.
  Other adapters still use `cc_session_days` message-share proration, so a
  midnight-spanning non-Codex session can smear. `timeutil::local_day_start_utc`
  is the one boundary helper. (`db/queries.rs` day-map query)
- Source: https://docs.rs/chrono/latest/chrono/

## API-equivalent pricing tables (pricing revs)
- What: pricing subscription usage at per-token list prices to get a comparable workload measure, versioned so stored costs refresh when prices change.
- Why here: all $ figures are API-equivalents, not bills; a stale or mis-matched table silently distorts everything (o3-priced Codex, sonnet-priced Fable, GPT-5.6-sol at 1/4 price — all real incidents).
- Gotcha (from code): `estimate_cost` match arms are ORDER-SENSITIVE (specific ids before family fallbacks); bump `PRICING_REV` on any change or already-indexed sessions keep old costs. (`history.rs::estimate_cost`)
- Source: https://platform.claude.com/docs/en/about-claude/pricing + https://developers.openai.com/api/docs/pricing

## Rolling quota windows (provider quota APIs)
- What: providers meter subscription usage in trailing windows (5h/7d) that re-anchor with activity; used% falls as bursts age out.
- Why here: the Codex/Claude cards mirror the provider's own endpoints — a dropping percentage and re-arming countdown is correct behavior, not a telemetry bug ("codex keeps resetting").
- Gotcha (from code): ChatGPT's `wham/usage` also carries manual rate-limit reset credits and per-model quota pools (`additional_rate_limits`) that the main window numbers don't include. (`accounts.rs::check_live_usage_openai`)
- Source: https://developers.openai.com/api/docs/guides/rate-limits (concept)

## macOS background QoS for indexer threads
- What: dropping a thread to `QOS_CLASS_BACKGROUND` so the OS schedules it on efficiency cores and throttles it whenever the user is active.
- Why here: the multi-GB catch-up index must "feel like it isn't running" on a daily-driver laptop.
- Gotcha (from code): set per-thread via `pthread_set_qos_class_self_np(0x09, 0)` at the top of the indexer thread; no-op off macOS. (`main.rs::set_thread_background_qos`)
- Source: https://developer.apple.com/documentation/dispatch/dispatchqos
