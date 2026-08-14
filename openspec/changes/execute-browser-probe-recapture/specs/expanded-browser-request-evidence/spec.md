## Purpose

Provides a probe-scoped, fixed-cap expansion of browser-server async and
framework evidence so CodeVetter can resolve common presentation truncation
without treating missing data as zero.

## ADDED Requirements

### Requirement: Use a closed probe evidence profile

CodeVetter SHALL support a closed expanded async/framework presentation profile
only when executing the matching durable inventory-completion probe.

#### Scenario: Expanded inventory probe

- **WHEN** CodeVetter executes `complete_async_and_framework_inventories`
- **THEN** the new capture retains up to 32 representative async resources and 32 framework phases per request

#### Scenario: Ordinary capture

- **WHEN** no probe evidence profile is selected
- **THEN** the existing ordinary inventory limits remain unchanged

### Requirement: Preserve complete and incomplete semantics

The expanded profile SHALL set an inventory complete only when its total count
equals its retained count and all underlying capture evidence is complete.

#### Scenario: Inventory exceeds expanded cap

- **WHEN** more than 32 compatible observations exist for the exact request
- **THEN** CodeVetter retains a bounded representative inventory and reports it incomplete

### Requirement: Preserve timing accounting

Expanded presentation SHALL NOT change raw request timing, child accounting,
interval union, process CPU, Worker CPU, or native-activity semantics.

#### Scenario: Expanded async presentation

- **WHEN** additional async observations are retained
- **THEN** overlap remains computed from the full captured inventory without summing overlapping intervals or assigning causality

### Requirement: Report exact requested-evidence outcome

CodeVetter SHALL compare the exact new request at the retained ordinal against
the requested async and framework completeness condition.

#### Scenario: Probe satisfied

- **WHEN** both exact-request inventories are complete in the new capture
- **THEN** the recapture outcome is `evidence_completed`

#### Scenario: Probe remains incomplete

- **WHEN** either exact-request inventory remains incomplete
- **THEN** the recapture outcome is `evidence_incomplete` with the retained inventory counts
