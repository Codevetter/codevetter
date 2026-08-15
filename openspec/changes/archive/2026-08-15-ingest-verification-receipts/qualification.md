# Verification Receipt Qualification

## Contract fixture

The focused suite uses hermetic complete-inventory receipts to qualify closed
validation, deterministic source and bundle identities, independent
correctness/performance/safety verdicts, stable and transient failures,
selection narrowing, blast-radius edges, compatibility classes, metric deltas,
repository containment, explicit output writes, and CLI/MCP parity.

## Real project-runner projection

The first real projection is CodeVetter's local Playwright fast-run receipt:

- Source receipt:
  `scripts/codevetter-verification/fixtures/exhaustive-local-runtime-initial-2026-08-07.json`
- Source SHA-256:
  `9d9d1e71faf54640b70f17c522a1ddba4e4d368f0a5384363915ac7a3b947c96`
- Repository revision:
  `worktree:0f117ff9cea1ed5cd48825d0d951efdf1ffe96312ee7ef7c6147b4a49eebc721`
- Environment: Apple M5 Pro, macOS, arm64, Node 24, Playwright Chromium
- Outcome: 79 passed, 0 failed
- Candidate samples: 13,290 / 13,370 / 13,800 ms wall; 77,300 /
  77,380 / 78,150 ms CPU
- Largest recorded command RSS: 831,094,784 bytes

The canonical projection is
`scripts/verification-receipts/fixtures/codevetter-local-fast-2026-08-07.json`.
It preserves aggregate outcomes and the source receipt identity. Inventory and
selection coverage remain incomplete because the source receipt does not list
individual tests or selection reasons. RSS remains partial because it does not
sum every descendant process. The normalized bundle therefore refuses an
inventory-qualified overall pass.

## Vault receipt boundary

GitHub issue #97 records a prior Vault webapp pilot summary, but no matching raw
receipt containing the named 272-test measurements was present in the current
Vault checkout or CodeVetter artifacts during qualification. Those numbers were
not reconstructed from prose and are not claimed by this change.

On 2026-08-09 the historical Vault runner at revision
`a46a25c7282523606e11caf354a65c7cbfbb3e4d` was exercised in an isolated
worktree with offline package resolution, four workers, and an additional
non-loopback browser-request deny rule. It stopped before Playwright execution
because the required `expo-image` dependency was absent. No dependency was
installed and no hosted application was contacted.

The resulting native Vault E2E v1 receipt was ingested directly. Its raw source
SHA-256 is
`44cbdd97a1458c3550ec1cfd5ca7db7709dffb2c1baa54a76e5f1573abd64177`.
The normalized bundle records one operational failure, 2,021 ms observed wall
time, missing test inventory, and missing CPU, RSS, process-tree, network, and
fixed-wait evidence. Every verdict component is `no_confidence`; the adapter
does not upgrade the failed export into test or performance evidence.

## Result

- Focused verification-receipt tests: 16 passed
- Touched-file Biome check: passed
- Documentation validation: passed
- Strict OpenSpec validation: passed
- No dependency, desktop runtime, database, target-project, or deployment
  change
