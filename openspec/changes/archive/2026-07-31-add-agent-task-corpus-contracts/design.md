## Context

Issue #53 already has an archived full-runner blueprint, but current `main`
contains no corpus package or runner implementation. CodeVetter uses root-level
Node scripts and focused `node:test` suites for benchmark tooling, and this
slice cannot add a runtime dependency or gain agent-execution authority.

## Goals / Non-Goals

**Goals:**

- Establish one reusable contract vocabulary for later qualification and
  runner slices.
- Make path, identity, provenance, license, ordering, and breadth failures
  explicit before any executable task behavior exists.
- Keep validation deterministic, shell-free, local, and inexpensive.

**Non-Goals:**

- Prepare disposable workspaces or run setup/check commands.
- Apply known-good patches or emit authoritative qualification receipts.
- Launch an agent, read credentials, estimate spend, or project scorer inputs.
- Claim the included sample is realistic, qualified, or publishable.

## Decisions

### Keep machine-readable schemas beside one semantic validator

The six public contracts live as JSON Schema documents under
`benchmarks/agent-tasks/contracts/`. A dependency-free Node validator enforces
the same closed shapes plus filesystem and cross-document invariants that JSON
Schema alone cannot prove.

This is preferred over adding a schema package because the repository needs no
new production dependency for a bounded contract surface. It is preferred over
code-only shapes because future task authors and other tools need inspectable
machine contracts.

### Bind every semantic artifact through a two-level hash chain

The corpus index hashes each task manifest; each task manifest hashes its
fixture, public packet, acceptance contract, and known-good patch. Paths are
POSIX-style relative paths resolved beneath the owning directory after
rejecting traversal, absolute paths, and symbolic links.

This makes an unchanged corpus index a stable identity of its ordered task set
without hashing generated qualification receipts into the task definition.

### Treat qualification as referenced evidence, not structural input

An index entry may reference a qualification receipt by path and SHA-256.
Non-strict validation reports whether that evidence exists and is
contract-valid. Strict readiness counts only entries with valid qualification
evidence whose task and manifest identities match.

The sample omits qualification evidence, keeping this slice honest: validation
can pass while readiness must fail.

### Use one canonical result for terminal and JSON output

The validator returns a sorted result containing schema version, corpus
identity, tasks, counts, errors, warnings, gates, `valid`, and `publishable`.
The CLI only formats that result and selects the exit code.

This avoids human/JSON drift and makes deterministic tests straightforward.

### Expose separate validate and readiness commands

`pnpm corpus:validate` runs non-strict structural validation.
`pnpm corpus:readiness` applies the strict publishability gate. Both accept
`--json` and an optional corpus root.

Separate commands prevent a seed corpus from being mistaken for release-ready
while keeping authoring feedback available before task qualification exists.

## Risks / Trade-offs

- **Schema and semantic validator drift** → Test representative valid and
  invalid documents against both the declared contract vocabulary and
  cross-document rules.
- **Filesystem links bypass lexical path checks** → Reject symbolic links and
  require every artifact to resolve beneath the real owning root.
- **A sample looks like benchmark evidence** → Name it as an unqualified
  contract sample and make strict readiness fail with explicit counts.
- **Later runner needs new optional fields** → Add a new schema version rather
  than weakening the closed v1 contracts.

## Migration Plan

This is additive. Later issue #53 slices can consume the v1 contracts while
adding qualification and execution. Rollback removes the new scripts, corpus
sample, commands, docs, and spec; no production state or user data changes.
