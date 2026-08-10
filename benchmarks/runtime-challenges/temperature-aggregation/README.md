# One Billion Row Challenge laboratory

This CodeVetter artifact exercises one bounded-memory parsing problem through
independent Node.js and Go implementations. The laboratory generates one local
fixture, requires exact result parity, alternates the measured lanes, and keeps
observations separate from projections and public results.

The [artifact record](./ARTIFACT.md) documents upstream attribution and the
remaining comparability limits. The first durable cross-runtime result is in
[results/2026-08-10-100m.json](./results/2026-08-10-100m.json).

## Run the bounded campaign

```bash
pnpm bench:1brc:campaign -- --rows 5000000 --workers 1,2,4,8 --samples 5
```

The default fixture ceiling is ten million rows. A 100-million or one-billion
row run requires explicit local authorization and is never part of normal tests
or CI:

```bash
CODEVETTER_1BRC_ALLOW_LARGE=1 pnpm bench:1brc:campaign -- \
  --rows 100000000 --workers 12,16 --samples 5 --output /tmp/codevetter-1brc.json
```

The campaign checks available disk before generation, applies a generation
deadline and per-process timeout, verifies every result digest, and removes its
temporary fixture and Go binary. It does not call cloud services.

## Run either implementation

```bash
go run ./benchmarks/runtime-challenges/temperature-aggregation/go \
  -workers 8 measurements.txt

node benchmarks/runtime-challenges/temperature-aggregation/node/run.mjs \
  measurements.txt 8
```

Both implementations align file partitions at newlines, retain incomplete
rows between chunks, aggregate integer tenths, and merge worker-local results
deterministically.

## Profile an iteration through CodeVetter

```bash
node scripts/runtime-failure-capsule/cli.mjs supervise-performance \
  --repo . \
  --run-id 1brc-node-baseline \
  --adapter node-script \
  --target benchmarks/runtime-challenges/temperature-aggregation/node/file-parser.benchmark.mjs \
  --samples 3 \
  --warmups 1 \
  --timeout-ms 120000 \
  --json
```

The older in-memory Node parser remains as a reference lane via `pnpm
bench:1brc`; it is not the bounded-memory campaign implementation.
