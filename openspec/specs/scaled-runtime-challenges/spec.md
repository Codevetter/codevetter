# scaled-runtime-challenges Specification

## Purpose
TBD - created by archiving change add-scaled-parsing-challenge. Update Purpose after archive.
## Requirements
### Requirement: Deterministic parsing challenge

CodeVetter SHALL provide a repository-owned parsing challenge with fixed input
identity, exact row counts, and no external dependencies.

#### Scenario: Challenge runs locally
- **WHEN** an agent executes the temperature aggregation challenge
- **THEN** every input row is generated deterministically in memory and no network, database, cloud service, or persistent generated dataset is used

#### Scenario: Challenge spans representative scales
- **WHEN** the scale workload completes
- **THEN** it emits at least three positive `ms/op` measurements whose largest row count is at least 40 times the smallest

### Requirement: Correctness before performance

Every measured parser result MUST match count, minimum, maximum, sum, and a
stable complete aggregate digest.

#### Scenario: Candidate parser drops or changes data
- **WHEN** any aggregate differs from the independently derived expected result
- **THEN** the test fails before emitting a successful benchmark metric line and CodeVetter cannot confirm the optimization

### Requirement: Official task compatibility

The artifact MUST preserve the official 1BRC row and output semantics while
identifying its Node and bounded-execution differences.

#### Scenario: Valid challenge rows are aggregated
- **WHEN** rows contain variable UTF-8 station names and signed one-decimal temperatures within the official bounds
- **THEN** the artifact emits stations alphabetically with minimum, round-toward-positive mean, and maximum values to one decimal place

#### Scenario: An agent inspects artifact provenance
- **WHEN** the benchmark is used as CodeVetter evidence
- **THEN** the repository identifies the upstream challenge and license and does not claim an official submission or unexecuted billion-row result

### Requirement: Evidence-led iteration

The initial parser SHALL be captured before optimization, and each candidate
change SHALL be evaluated against the identical adapter, target, exact test
name, input sizes, units, and correctness contract.

#### Scenario: Runtime evidence selects a parser candidate
- **WHEN** the baseline produces a scale curve and repository-owned CPU evidence
- **THEN** CodeVetter reports observed measurements separately from its inferred candidate and supplies an identical-scope verification action

#### Scenario: Candidate is faster at representative scale
- **WHEN** the same workload reruns after one implementation change
- **THEN** CodeVetter reports the measured per-size deltas and confirms only when the largest-input improvement crosses policy without a material smaller-input regression

### Requirement: Bounded claims

The challenge MUST distinguish measured local evidence from extrapolation to
billion-row datasets.

#### Scenario: Local benchmark completes
- **WHEN** CodeVetter records bounded row counts and durations
- **THEN** the qualification identifies those exact counts and MUST NOT claim an unexecuted nine-billion-row completion time, memory bound, or production throughput
