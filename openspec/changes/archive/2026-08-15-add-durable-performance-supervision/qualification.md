# Qualification

## Scope

Qualified the outer supervisor against contract fixtures and CodeVetter's
checked-in temperature-aggregation runtime challenge. No dependency install,
network service, database, browser, cloud resource, or production configuration
was involved.

## Contract evidence

The focused supervision suite covers validated success, the real diagnosis
child, CLI start and inspection, non-zero exit, signal death, deadline expiry,
spawn failure, malformed JSON, unsafe and duplicate run IDs, secret and path
redaction, result digest tampering, and atomic receipt inspection.

The first real run exposed an evidence-accounting defect: a successful 11.9 KB
result was fully preserved, but the receipt's `capture.truncated` flag was true
because a bounded failure preview had been prepared unnecessarily. The flag now
describes only retained successful evidence on success, and the focused suite
asserts that behavior.

## Real workload

The corrected retry used:

```text
run_id: one-brc-supervisor-20260809-v2
adapter: node-test
target: benchmarks/runtime-challenges/temperature-aggregation/temperature-aggregation.test.mjs
name: temperature aggregation scales across deterministic row counts
samples: 2
warmups: 0
per-execution timeout: 30000 ms
derived supervisor deadline: 210000 ms
```

The supervisor completed in about 3.6 seconds with terminal state `succeeded`,
child exit code `0`, no signal, no stderr, no truncation, and one validated
12,167-byte diagnosis whose SHA-256 is recorded in the receipt. The artifacts
are:

```text
.codevetter/performance-runs/one-brc-supervisor-20260809-v2/receipt.json
.codevetter/performance-runs/one-brc-supervisor-20260809-v2/result.json
```

The preserved diagnosis classified the input curve as approximately linear
(40x rows, 36.274x median time, exponent 0.973) and identified
`aggregateTemperatures` as the leading repository CPU candidate with 82.89% of
captured CPU samples. This is an optimization hypothesis, not proof that a code
change will improve the workload.

## Limits

- Signal and timeout survival are proven for the profiling child, not for death
  of the supervisor or machine.
- The real workload completed normally; failure terminal states use isolated
  deterministic fixtures.
- The repository was already dirty, so the receipt records `dirty: true` and is
  not a clean-baseline claim.
- OS-level memory and CPU quotas, stale-heartbeat reconciliation, partial-run
  resume, and inner phase progress remain future work.
