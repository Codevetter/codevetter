## ADDED Requirements

### Requirement: Resource-aware warm scenario scheduling
The warm runtime SHALL schedule independent scenarios within checked CPU, memory, browser-context, target-origin, and shared-state budgets and MUST preserve deterministic result ordering regardless of completion order.

#### Scenario: One scenario waits on the target application
- **WHEN** remaining profile resources permit another independent scenario to execute
- **THEN** the runtime may execute that scenario in a fresh context while the first waits
- **AND** neither scenario shares mutable browser or application state

#### Scenario: Target-origin bandwidth budget is exhausted
- **WHEN** starting another scenario would exceed the configured concurrent request budget for its target origin
- **THEN** the scenario remains queued and the receipt attributes the delay to the origin budget

### Requirement: Click-to-settle timing evidence
The warm runtime SHALL report bounded per-interaction timings that distinguish Playwright actionability-and-dispatch, application or declared-network completion, assertion, and cleanup without bypassing Playwright actionability or fresh-context isolation. The runtime MUST NOT claim a narrower dispatch measurement when the public browser API exposes actionability and dispatch as one operation.

#### Scenario: Application response dominates a click
- **WHEN** input dispatch completes quickly but the declared post-click condition exceeds its interaction budget
- **THEN** the result attributes the slow interaction to application or network settlement rather than the click dispatch

#### Scenario: Faster input would weaken reliability
- **WHEN** an optimization would dispatch against a non-actionable target or reuse incompletely reset state
- **THEN** qualification rejects the optimization even if its wall time is lower
