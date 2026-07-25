## ADDED Requirements

### Requirement: Island promotion requires recorded repeated-use qualification
The project SHALL record versioned repeated-use evidence covering supported
provider events, every native action type, stale and duplicate actions, helper
crash/fallback, latency, idle CPU, RSS, false-action count, and session
continuity before considering default enablement.

#### Scenario: Automated and local soak gates pass
- **WHEN** the checked qualification meets every declared threshold across the required repeated-use window
- **THEN** the receipt marks the implementation eligible for a separate promotion decision
- **AND** the setting remains off by default until that decision is recorded

#### Scenario: Any false provider action occurs
- **WHEN** qualification records an unintended, duplicate, stale, or identity-mismatched provider action
- **THEN** promotion fails
- **AND** existing Work and notification fallback remains authoritative
