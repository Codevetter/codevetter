## Purpose

Provide comparable, bounded-memory Node and Go parsing workloads that let an
agent distinguish algorithm, parallelism, runtime, and machine effects using
the same deterministic file and correctness contract.

## ADDED Requirements

### Requirement: File-backed workloads share one correctness contract
The challenge SHALL generate a deterministic file whose row grammar and output
semantics match the documented 1BRC contract. Every runtime and execution
variant MUST process the same identified file and produce the same exact result
digest before performance evidence is accepted.

#### Scenario: Runtime variants process a qualified input
- **WHEN** Node and Go variants execute a comparison campaign
- **THEN** every receipt identifies the same input bytes, row count, and digest
- **AND** any result mismatch invalidates that variant's performance result

### Requirement: Default execution uses bounded memory and storage
Every default challenge variant SHALL process input incrementally without
loading the complete file as a decoded string. The default campaign MUST enforce
documented row, byte, duration, and worker bounds and remove generated data after
the campaign unless retention was explicitly requested.

#### Scenario: Agent runs the default campaign
- **WHEN** no large-run opt-in is supplied
- **THEN** the campaign stays within its documented laptop-safe bounds
- **AND** does not invoke a network, cloud service, production database, or deployment

#### Scenario: Agent requests one billion rows
- **WHEN** the requested input exceeds the default storage or duration bound
- **THEN** the runner refuses before generation unless explicit large-run authorization and sufficient local capacity are recorded

### Requirement: Parallel variants preserve independent aggregation
The Node and Go parallel variants SHALL partition only at complete row
boundaries, maintain worker-local aggregates, and merge after parsing. Worker
count MUST be recorded and bounded independently of the host's reported logical
CPU count.

#### Scenario: Parallel and sequential results are compared
- **WHEN** the same qualified input is processed with one and multiple workers
- **THEN** both produce the identical result digest
- **AND** the receipt records worker count, wall time, throughput, and peak memory

### Requirement: Cross-runtime conclusions use paired evidence
The challenge SHALL report observed Node and Go results separately from inferred
language or leaderboard conclusions. A runtime comparison MUST use the same
machine, input identity, worker bound, cache-state policy, and timing boundary.

#### Scenario: Agent asks whether language caused a performance gap
- **WHEN** compatible Node and Go receipts exist from the same campaign
- **THEN** the report attributes only the measured paired difference to runtime and implementation together
- **AND** labels unmeasured language-ceiling or cross-machine claims as unverified

