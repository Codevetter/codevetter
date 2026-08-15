# Local performance governance Specification

## Purpose

Define reproducible local IPC and disk measurements plus reversible,
evidence-gated cache consolidation.
## Requirements
### Requirement: Dashboard and cache performance is reproducibly measured
CodeVetter SHALL provide a repository-owned qualification that measures bounded
p50, p95, maximum latency, result bytes, and error state for dashboard IPC paths
against a versioned redacted fixture, plus disk usage for relevant Cargo,
Playwright, package-manager, worktree, and CodeVetter caches.

#### Scenario: Performance qualification runs
- **WHEN** the checked fixture exercises every declared dashboard IPC path
- **THEN** the receipt records machine, revision, fixture, repetitions, timings, bytes, and failures
- **AND** separates cold, warm, and cache-hit observations

### Requirement: Cache consolidation requires measured duplication
CodeVetter MUST NOT change cache ownership merely because multiple cache
directories exist. Consolidation SHALL require byte-level or tool-authoritative
duplicate evidence, a reversible plan, and before/after receipts.

#### Scenario: Two worktrees share identical package inputs
- **WHEN** measurement proves their package cache content is safely reusable through the package manager's supported cache
- **THEN** the plan may point both at that supported cache
- **AND** preserves worktree-local build outputs whose reuse is unsafe

#### Scenario: Boundary is not the bottleneck
- **WHEN** profiling does not show a dashboard IPC or TypeScript/Rust boundary exceeding its budget
- **THEN** CodeVetter records no service rewrite recommendation
- **AND** does not add another runtime

### Requirement: External-frontier comparisons are qualified
CodeVetter SHALL NOT express proximity to an external performance frontier as a
direct measured gap unless the local and external results share compatible
input, correctness, timing, resource, and machine conditions. Otherwise it MUST
identify the arithmetic as an extrapolation and enumerate the incompatible
conditions.

#### Scenario: Local bounded parser is compared with the 1BRC leaderboard
- **WHEN** the local result excludes file I/O, uses fewer rows, or runs on different hardware
- **THEN** CodeVetter labels any projected multiplier as non-comparable
- **AND** reports the missing end-to-end evidence needed for a direct claim

### Requirement: Large local campaigns require resource qualification
Before a performance campaign generates or retains a materially large fixture,
CodeVetter SHALL calculate the requested bytes, confirm available local space,
record the retention policy, and require explicit authorization above the
documented default bound.

#### Scenario: Requested fixture is approximately 12 GB
- **WHEN** an agent requests a full one-billion-row challenge
- **THEN** CodeVetter does not generate the fixture under default settings
- **AND** reports the expected local storage and authorization requirement
