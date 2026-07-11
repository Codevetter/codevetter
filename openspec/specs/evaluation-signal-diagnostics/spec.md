# evaluation-signal-diagnostics Specification

## Purpose
TBD - created by archiving change consolidate-taste-into-codevetter. Update Purpose after archive.
## Requirements
### Requirement: Structured comparable judgments
CodeVetter SHALL normalize judgments about the same candidates and criteria so agreement and disagreement are computed only across comparable evaluations.

#### Scenario: Specialist outputs use different criteria
- **WHEN** two reviewers evaluated different criteria or candidate sets
- **THEN** CodeVetter does not present their outputs as direct consensus and identifies the incomparable scope

### Requirement: Order-sensitivity checks
For pairwise judgments used in a decision, CodeVetter SHALL support presenting both candidate orders and SHALL treat inconsistent preferred candidates as an order-sensitive, low-confidence result.

#### Scenario: Reversing candidates changes the winner
- **WHEN** the forward and reversed pairwise judgments select different candidates
- **THEN** CodeVetter records no decisive winner for that pair and surfaces an order-sensitivity warning

### Requirement: Signal-quality summary
CodeVetter SHALL calculate and expose criterion-level agreement, majority strength, low-confidence counts, order-inconsistent counts, and preference cycles when sufficient comparable judgments exist.

#### Scenario: Evaluators form a preference cycle
- **WHEN** majority judgments prefer A over B, B over C, and C over A
- **THEN** CodeVetter marks the affected criterion as cyclic and does not present its top candidate as an unqualified winner

### Requirement: Calibrated confidence
The aggregate verification confidence SHALL be downgraded when judgments are weak, order-sensitive, cyclic, unsupported by executable evidence, or contradicted by known outcomes.

#### Scenario: Strong vote with failed executable test
- **WHEN** an evaluator majority prefers a change but the required executable test fails
- **THEN** CodeVetter does not report high verification confidence and cites the failed test as a limiting signal

