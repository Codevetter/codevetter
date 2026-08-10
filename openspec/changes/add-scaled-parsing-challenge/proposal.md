# Proposal: Add a scaled parsing challenge

## Why

CodeVetter can now identify repeated local work, CPU candidates, and input-scale
curves, but the iteration loop needs a durable challenge whose application work
is large enough to profile and whose correct result cannot be optimized away.
Tiny unit tests mostly measure runner startup. Production databases and network
services add data and environment variables that make early product learning
hard to reproduce.

A bounded Node adaptation of the official 1BRC temperature aggregation task
exercises the same
parsing, allocation, map-update, and scaling behavior as billion-row workloads
without writing a giant fixture or requiring production infrastructure.

## What Changes

- Add a deterministic local `station;temperature` dataset generator and parser
  challenge under `benchmarks/runtime-challenges/`.
- Preserve the official sorted min/mean/max output contract, UTF-8 station
  semantics, and round-toward-positive mean behavior.
- Record upstream attribution and explicit differences from the official Java
  submission and billion-row execution rules.
- Lock correctness with exact aggregate summaries and a stable digest.
- Measure fixed row counts spanning at least 40x and emit CodeVetter's existing
  `size<N>=<duration>ms/op` metric contract.
- Capture the initial implementation with CodeVetter before inspecting or
  optimizing the selected source candidate.
- Apply one parser optimization at a time and use identical-scope verification
  to distinguish implementation effects, material speedups, and noise.
- Record practical throughput and memory limits without extrapolating a local
  result into an unsupported nine-billion-row claim.

## Scope

In scope: Node.js, deterministic generated text, CPU/allocation-sensitive
parsing, bounded local execution, exact correctness, scale diagnosis, and
before/after verification.

Out of scope: allocating or storing billions of rows, production databases,
network calls, cloud execution, distributed parsing, worker-thread scaling,
automatic patch generation, and universal benchmark claims.

## Impact

- Adds only repository-owned benchmark fixtures, tests, documentation, and
  package scripts.
- Uses existing Node and CodeVetter runtime primitives; no production or
  development dependency is added.
- Does not change the desktop application, database, deployment, or release
  behavior.
