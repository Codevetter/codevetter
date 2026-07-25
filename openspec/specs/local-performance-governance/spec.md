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
