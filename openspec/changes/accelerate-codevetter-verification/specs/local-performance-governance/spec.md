## ADDED Requirements

### Requirement: Verification workflow cost is reproducibly measured
CodeVetter SHALL measure selected and exhaustive verification with versioned machine, revision, change, profile, cache, browser, and test identities and SHALL report wall time, CPU time, peak RSS, target bytes, process and context peaks, queue time, click-to-settle stages, executed checks, and verdict.

#### Scenario: CodeVetter verification benchmark runs
- **WHEN** the checked change corpus runs under a declared profile
- **THEN** the report separates cold, warm, cache-hit, queued, and executing costs
- **AND** fails qualification if any receipt is incomplete or selected and exhaustive verdicts disagree

#### Scenario: Browser dispatch is not the bottleneck
- **WHEN** click-to-settle profiling shows application, network, selection, or setup cost dominates input dispatch
- **THEN** CodeVetter records no browser-driver rewrite recommendation
- **AND** optimizes only a measured dominant stage

#### Scenario: Tenfold target is evaluated
- **WHEN** a candidate interactive profile is qualified for representative UI leaf changes
- **THEN** CodeVetter compares warm p50 and p95 wall time against the checked 16.3-second focused Playwright baseline
- **AND** reports the result as experimental until p95 is at most 1.5 seconds with complete equivalent verdicts
