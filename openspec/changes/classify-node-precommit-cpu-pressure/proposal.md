# Change: Classify Node pre-commit process CPU pressure

## Why

Response boundaries can localize most of a slow request before its first
commitment, but elapsed time alone cannot tell an agent whether the next probe
belongs in CPU/framework work or asynchronous waiting. The unchanged High
Signal replay left 954.632 ms in that interval with no repository CPU sample.

## What Changes

- Measure bounded process CPU deltas at request start, first response
  commitment, and request finish.
- Reject per-request classification when another admitted server request
  overlaps the measurement.
- Project a closed CPU-to-wall comparison for the pre-commit and whole-request
  intervals.
- Classify CPU-heavy, low-observed-CPU, mixed, and insufficient evidence using
  fixed thresholds without assigning a source or cause.

## Impact

- Affected specs: `node-precommit-cpu-pressure`
- Affected code: Node flow preload, flow normalization, browser-server
  projection, Playwright diagnosis, deterministic performance findings, and
  runtime tests
- No dependency, database, deployment, production, or secret changes
