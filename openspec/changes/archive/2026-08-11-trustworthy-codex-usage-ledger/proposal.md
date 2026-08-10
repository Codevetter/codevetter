## Why

The released Codex usage surface presents a precise token and dollar total even when most historical sources are missing and the retained-corpus parser disagrees materially with a mature market implementation. Users need an accounting product whose number communicates its evidence coverage, lineage handling, and pricing uncertainty instead of converting partial evidence into false certainty.

## What Changes

- Replace the single blended Codex headline with evidence-tiered totals: verified, legacy estimated, and unavailable.
- Persist append-only, content-free Codex usage evidence during live ingestion so later transcript pruning cannot erase already observed usage.
- Adopt fork/subagent lineage accounting that resolves parent totals at the child fork timestamp and fails closed when ownership cannot be established.
- Add retained-corpus parity qualification against a pinned CodexBar scanner and adversarial lineage fixtures.
- Add explicit coverage diagnostics for discovered, token-bearing, verified, estimated, missing, stale, and ambiguous sessions.
- Label monetary values as API-equivalent estimates; report unpriced models or unknown service tiers instead of claiming exact spend.
- Keep provider quota windows separate from transcript-derived compute and cost.
- **BREAKING**: stop presenting unrepaired historical rows as part of a precise verified total and stop presenting incomplete verified history without a visible coverage state.

## Capabilities

### New Capabilities

- `usage-evidence-coverage`: Evidence tiers, coverage reconciliation, completeness states, and user-visible accounting provenance.
- `codex-lineage-accounting`: Parent/child lineage resolution, replay exclusion, interleaved counter handling, and external-oracle qualification.

### Modified Capabilities

- `codex-usage-accounting`: Replace transcript-only repair semantics with a durable observation ledger, evidence-tiered historical backfill, and bounded pricing claims.
- `live-session-evidence`: Require Codex usage observations to be durably captured during ingestion independently of retained transcript content.

## Impact

- Rust session ingestion, Codex adapter/accounting state, SQLite schema and migrations, usage queries, diagnostics IPC, and the Home usage surface.
- OpenSpec accounting and live-evidence contracts plus telemetry documentation.
- Test assets will include pinned upstream-derived lineage fixtures and a read-only real-corpus parity command. CodexBar is MIT-licensed; any copied or adapted substantial source will retain its license notice. No new production dependency is expected.
