# Qualification — compact browser performance

Date: 2026-08-15 (Asia/Kolkata)

Target: clean Chess Coach revision `31cb24eb6eb8b2f9ddf0e509810ff93ff5d7d73b`
at `/Users/sarthak/Desktop/fleet/chess`.

## Observed

- Bounded qualification discovered both repository Playwright tests and returned
  `needs_selection`; it did not auto-select a representative browser flow.
- The owner-selected `tests/example.spec.ts` test `loads the chess coach`
  completed in three samples with 248 ms median exact-test duration and 1,146 ms
  median process wall time. A repeated artifact-enabled pass measured 236 ms
  exact-test median.
- The existing Vite initial closure contained six files, 557,375 raw bytes, and
  177,059 summed gzip bytes. The receipt labelled this evidence unverified.
- After one warmup, unchanged checkouts measured 227 ms versus 225 ms exact-test
  median and 1,118 ms versus 1,114 ms process wall. CodeVetter returned
  `inconclusive`, correctly refusing a false improvement.
- A trial that deferred analytics reduced the unverified existing-artifact
  closure from 177,059 to 103,554 gzip bytes, but ten alternating exact-flow
  samples moved only 235 ms to 231 ms (−1.7%, −4 ms) with flat process wall.
  CodeVetter returned `inconclusive`; the source trial was discarded and Chess
  remained clean.

## Failure found during qualification

The first real run found zero tests because Playwright applies `--grep` to a
composite title, so an anchored leaf-title expression did not match. The runner
now uses grep only to narrow candidates; the reporter parser remains the exact
identity authority and rejects zero, multiple, failed, or retried results.

## Coverage boundary

This evidence covers one local Chromium Playwright flow and one existing build
artifact. It does not establish production impact, representative-device
rendering, browser memory, React component attribution, network-scale behavior,
artifact freshness, or global application optimality. No project dependency,
cloud execution, source commit, or Chess pull request was created.
