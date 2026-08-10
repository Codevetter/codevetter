# Codex accounting oracle

CodeVetter pins CodexBar's local Codex cost scanner as an independent
qualification oracle for lineage-aware token accounting.

- Upstream: <https://github.com/steipete/CodexBar>
- Revision: `4f0ac0680cd2f3cce36ed02b8a1e1fbc20bfee76`
- Tested CLI: CodexBar `0.46.0`
- License: MIT; see [LICENSE-CodexBar.txt](LICENSE-CodexBar.txt)
- Command schema: `codexbar cost --provider codex --json --refresh`
- Compared fields: provider/source, history window, total input/cache/output/total
  tokens, API-equivalent total cost, and per-local-day token/cost buckets.

`retained-corpus-baseline.json` records aggregate-only evidence from the
operator's live retained corpus. It contains no prompts, responses, session
identifiers, or project paths. Because that corpus is live, the baseline is an
audit receipt for its stated observation time, not a checked-in replay corpus.
The fixed parity corpus added by the following tasks is the reproducible gate.

`retained-corpus-qualification.json` records the release-candidate shadow gate.
It compares only byte prefixes committed by CodexBar, includes dependency-only
parents for lineage resolution, and separately records a database-and-transcript
frozen two-pass backfill. A CodexBar `--refresh` is not sufficient proof of full
coverage: its cache can retain `scan_complete=0` files or stale completed sizes.

`fixed-corpus-codexbar.json` is the normalized CodexBar 0.46.0 output captured
at the pinned revision after placing every JSONL under `cases/` into one
`CODEX_HOME/sessions/2026/07/16` tree. `fixed-corpus-codevetter.json` is the
matching internal scanner result. Both are sanitized aggregate fixtures; the
checked-in JSONL contains only synthetic token events and `/fixture` paths.
Fork cases include a leaf session followed by embedded ancestor metadata, the
rollout shape Codex uses to identify a copied prefix. Compact independent
subagent rollouts are a separate accounting shape and must not be used as a
fork-replay oracle.
Run the gate with:

```bash
node scripts/qualify-codex-accounting-oracle.mjs \
  --oracle-json apps/desktop/src-tauri/tests/fixtures/codex-accounting-oracle/fixed-corpus-codexbar.json \
  --codevetter-json apps/desktop/src-tauri/tests/fixtures/codex-accounting-oracle/fixed-corpus-codevetter.json
```

CodexBar distinguishes forked and interleaved lineages by resolving parent
snapshots at fork timestamps, retaining monotonic component watermarks, and
capping post-interleaving deltas. A cumulative-difference-only scanner is not
an acceptable oracle because it recounts inherited history.
