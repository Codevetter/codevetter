## Why

CodeVetter currently reconstructs Codex usage as a session total and then prorates that total across days by message count. This can misstate recent usage for long-running sessions, double-count re-emitted or interleaved cumulative snapshots, and leave the dashboard unable to explain which source events were accepted or excluded.

Established local trackers such as CodexBar and ccusage instead treat timestamped token events as the accounting evidence, retain cumulative-counter state for deduplication and fork handling, and aggregate accepted deltas directly into calendar buckets. CodeVetter should adopt those proven invariants and verify them against the user's current Codex 0.147 transcript shape.

## What Changes

- Normalize each Codex `token_count` event into an accepted usage delta with its timestamp, model, and cumulative-counter evidence.
- Deduplicate unchanged `total_token_usage` snapshots so rate-limit-only re-emissions cannot repeat `last_token_usage`.
- Replace the first-second fork heuristic with cumulative-baseline and monotonic-watermark accounting for forked and interleaved lineages.
- Persist accepted Codex deltas into local-day usage buckets instead of prorating whole-session totals by message counts.
- Preserve exact session totals while making period totals equal the sum of accepted timestamped deltas.
- Add an idempotent repair that rebuilds existing Codex totals and daily buckets from available transcripts without changing Claude or other providers.
- Expose compact accounting diagnostics: accepted events, duplicate/replayed events, unsupported rows, pending bytes, and last successful observation.

## Capabilities

### New Capabilities

- `codex-usage-accounting`: Deterministic, timestamped, deduplicated Codex token accounting across ordinary, forked, incremental, and interleaved session logs.

### Modified Capabilities

- `live-session-evidence`: Live Codex transcript tailing must advance usage evidence independently of archival maintenance and report observable freshness/pending state.

## Impact

- Rust session adapter, incremental indexer, usage schema/migrations, repair logic, and usage queries.
- Typed Tauri usage payloads and the existing Usage dashboard diagnostics; no new navigation surface.
- Existing local SQLite data receives an idempotent Codex-only rebuild from source JSONL where source evidence remains available.
- No new production dependencies and no provider API or credential changes.
