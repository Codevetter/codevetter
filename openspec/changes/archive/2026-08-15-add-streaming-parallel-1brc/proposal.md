## Why

The current temperature-aggregation artifact measures a single-threaded,
in-memory Node parser over at most 800,000 rows. It cannot process the official
approximately 12 GB input with bounded memory, and its projected comparison to
the official 1BRC leaderboard confounds runtime, parallelism, file I/O, and
machine differences. CodeVetter needs an end-to-end challenge that can reveal
which optimization boundary actually matters and distinguish Node limitations
from implementation limitations.

## What Changes

- Add a deterministic file-backed challenge lane with bounded generation,
  correctness digests, explicit resource budgets, and opt-in large scales.
- Add a Node byte parser that processes bounded chunks instead of loading the
  complete file as a UTF-8 string.
- Add a Node worker-thread lane that splits only at row boundaries, keeps
  worker-local aggregates, and merges them after parsing.
- Add a dependency-free Go lane over the identical generated input and output
  contract so runtime-language effects can be measured on the same machine.
- Record end-to-end wall time, parser throughput, peak memory, worker count,
  input identity, and machine identity in CodeVetter evidence.
- Require paired same-machine comparisons and correctness before making claims
  about language, parallelism, or proximity to the official result.
- Keep the approximately 12 GB / one-billion-row run opt-in; default validation
  must remain laptop-safe and must not use cloud resources.

## Capabilities

### New Capabilities

- `cross-runtime-scaled-parsing`: Reproducible, file-backed Node and Go parsing
  workloads with bounded-memory execution, parallel variants, shared
  correctness, and comparable performance evidence.

### Modified Capabilities

- `local-performance-governance`: Require end-to-end same-machine evidence and
  explicit resource qualification before CodeVetter compares a local challenge
  with an external performance frontier.

## Impact

- Affects the temperature-aggregation artifact under
  `benchmarks/runtime-challenges/`, its scripts and tests, CodeVetter performance
  receipts, and local performance documentation.
- Uses Node and Go standard libraries only; no production dependency is added.
- Default runs remain local, deterministic, bounded, and free of network,
  database, production, deployment, or cloud execution.
