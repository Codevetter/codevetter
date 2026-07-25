# Intent closure evidence Specification

## Purpose

Define explicit, evidence-linked human closure of the original goal without
turning automated evidence into an inferred satisfaction decision.

## Requirements

### Requirement: Intent closure records the original goal and producing evidence
CodeVetter SHALL let a work item record its versioned original goal, acceptance
criteria, producing provider/session/managed run, exact change identity, linked
review and verification, and one human disposition: `satisfied`,
`partially_satisfied`, `not_satisfied`, or `waived`.

#### Scenario: User closes verified work
- **WHEN** the current change has linked review and exact-current verification
- **THEN** the user can record a disposition and bounded reason
- **AND** the receipt identifies the producing session and evidence without storing hidden reasoning

### Requirement: Intent satisfaction is never inferred as fact
CodeVetter MAY identify unmet criteria or stale evidence deterministically, but
MUST NOT automatically mark the original goal satisfied.

#### Scenario: Every acceptance checkbox appears complete
- **WHEN** automated evidence covers every structured acceptance criterion
- **THEN** CodeVetter presents a closure suggestion for review
- **AND** still requires an explicit human disposition

#### Scenario: Change identity advances after closure
- **WHEN** repository or diff identity no longer matches the closure receipt
- **THEN** CodeVetter marks intent closure stale
- **AND** preserves the prior decision as history
