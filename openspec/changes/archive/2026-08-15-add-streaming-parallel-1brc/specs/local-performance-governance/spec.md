## ADDED Requirements

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

