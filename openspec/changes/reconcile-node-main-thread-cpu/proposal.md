## Why

CodeVetter currently compares process-wide CPU with sampled main-thread time and
Worker CPU, then labels the unexplained remainder as possibly child-process
work. Node's process CPU counters exclude child processes, while sampled V8 time
is not an exact thread CPU counter, so that reconciliation can send an agent to
an impossible next probe. Node 22.19 and newer expose exact current-thread CPU
deltas, allowing the local Node/React lane to distinguish main-thread CPU from
other CPU inside the same process before requesting deeper evidence.

## What Changes

- Capture current-thread CPU at request admission, first response commitment,
  and request finish beside the existing process-wide counters.
- Normalize a closed main-thread and same-process residual CPU partition without
  exposing absolute counters or machine identity.
- Prefer exact thread accounting over sampled-time ratios when routing the next
  local probe, while preserving the V8 sample scope as descriptive evidence.
- Replace the invalid child-process residual route with native/background-thread
  or sampling-gap routes; keep child-process cost as a separate future flow
  capability rather than part of parent-process CPU reconciliation.
- Preserve unsupported, incomplete, overlapping, inconsistent, and failed-flow
  authority boundaries.

## Capabilities

### New Capabilities

- `node-main-thread-cpu-evidence`: Request-correlated current-thread CPU evidence
  and a closed same-process residual partition.
- `node-process-cpu-reconciliation`: Deterministic next-probe routing from exact
  process, main-thread, Worker, and sampled-source evidence.

### Modified Capabilities

None.

## Impact

The change affects the owned Node preload, Node flow normalization, browser-server
evidence contracts, deterministic performance diagnosis, Playwright diagnosis
schema, focused runtime tests, performance guidance, and bounded proof artifacts.
It adds no dependency, network access, production behavior, UI, or source-edit
authority.
