## Purpose

Define how a proven local optimization becomes a revision-bound, review-aware
contribution without conflating runtime improvement, correctness, patch quality,
T-Rex flow evidence, or upstream acceptance.

## Requirements

### Requirement: Candidate quality is challenged before contribution readiness
The system SHALL require a bounded candidate-quality challenge for the selected
promotion record before it can report an optimization contribution as ready.
The challenge MUST identify the selected candidate, record deterministic diff
complexity, and contain either a comparison with another qualified candidate or
an explicit bounded reason that a simpler-candidate attempt is not applicable.

#### Scenario: Simpler qualified candidate is available
- **WHEN** two correctness-preserving promotion records address the same
  optimization scope and the simpler candidate remains inside the declared
  performance tolerance
- **THEN** the challenge withholds readiness until the simpler candidate is
  selected and records the performance and complexity basis

#### Scenario: Candidate adds defensive complexity
- **WHEN** the selected diff adds mutable state, caching, fallback, or cleanup
  signals without a simpler comparison or explicit invariant
- **THEN** patch quality remains `no_confidence` and contribution readiness is
  withheld

#### Scenario: Simplification is not applicable
- **WHEN** the selected candidate adds no flagged defensive complexity and the
  caller supplies a bounded not-applicable reason
- **THEN** the challenge may report `retained_with_justification` without
  fabricating an alternative candidate

### Requirement: Contribution receipts keep evidence gates independent
The system SHALL emit a closed, versioned contribution receipt bound to the
repository, pull request, baseline revision, candidate revision, selected
campaign record, and challenge evidence. Performance, correctness, patch
quality, T-Rex, checks, reviews, approvals, merge authority, pull-request state,
and artifact freshness MUST remain independent fields.

#### Scenario: Performance is confirmed while review is actionable
- **WHEN** the selected candidate has qualified performance and correctness but
  a current maintainer thread requires action
- **THEN** the receipt preserves `performance_confirmed` and reports
  `review_action_required` without describing the contribution as ready

#### Scenario: Repository checks require approval
- **WHEN** a current-head workflow reports approval-required and no repository
  test has failed
- **THEN** checks report `approval_required` rather than `failed`

### Requirement: GitHub inspection is thread-aware and read-only
The system SHALL inspect one canonical GitHub pull request through bounded
read-only operations and capture exact head identity, state, mergeability,
checks, reviews, and inline review threads. It MUST distinguish current,
outdated, and resolved threads and MUST NOT post comments, resolve threads,
approve, merge, deploy, or change repository settings.

#### Scenario: Submitted review body is empty
- **WHEN** a maintainer review has an empty top-level body but contains current
  unresolved inline comments
- **THEN** the comments are retained as actionable thread evidence

#### Scenario: Feedback becomes outdated after revision
- **WHEN** the pull-request head changes and prior unresolved comments no longer
  anchor to the current diff
- **THEN** the comments remain in history as outdated and do not independently
  block the revised head

### Requirement: Contribution evidence is invalidated by head drift
The system MUST compare the inspected pull-request head with the candidate SHA
bound to local evidence. A mismatch SHALL mark the receipt stale, preserve the
observed new head, and prevent a ready verdict until the new candidate is
locally reverified.

#### Scenario: Pull request advances after verification
- **WHEN** the current pull-request head differs from the candidate SHA in the
  challenge and performance evidence
- **THEN** artifact freshness reports `stale` and identifies the exact expected
  and observed revisions

#### Scenario: Reinspection is idempotent
- **WHEN** the same current pull-request evidence is inspected again
- **THEN** normalized receipt content remains stable apart from its explicit
  observation timestamp

### Requirement: Existing T-Rex receipts compose without losing authority
The system SHALL optionally ingest one repository-contained canonical T-Rex
receipt under an explicit `optional`, `required`, or `not_applicable` policy.
When present, its source head MUST equal the optimization candidate SHA. T-Rex
failure, no-confidence, preview mismatch, and limitations MUST remain visible
and MUST NOT be overridden by performance evidence.

#### Scenario: Matching T-Rex flow verification passes
- **WHEN** a required T-Rex receipt identifies the candidate head and reports
  `passed_with_limits`
- **THEN** the contribution receipt records the pass and retains every T-Rex
  limitation beside the other gates

#### Scenario: T-Rex receipt belongs to an older head
- **WHEN** the T-Rex source head differs from the optimization candidate
- **THEN** T-Rex status and artifact freshness report `stale` and contribution
  readiness is withheld

#### Scenario: Required T-Rex evidence is absent
- **WHEN** policy is `required` and no receipt is supplied
- **THEN** T-Rex status reports `missing` and contribution readiness is withheld

### Requirement: Contribution readiness is deterministic and conservative
The system SHALL derive one contribution status from the independent gates
using fail-closed precedence. `stale`, correctness failure, T-Rex failure,
actionable review, failing checks, approval-required checks, and pending checks
MUST prevent `ready`. Only a current open pull request with qualified local
evidence, acceptable patch quality, no current actionable review, passing
checks, satisfied configured T-Rex policy, and known merge authority MAY report
`ready`.

#### Scenario: External maintainer owns merge
- **WHEN** every evidence gate passes but the contributor cannot merge the
  upstream repository
- **THEN** the receipt reports `waiting_for_maintainer` rather than `complete`

#### Scenario: Pull request is merged
- **WHEN** GitHub reports the current candidate head merged and all local
  evidence remains current
- **THEN** the receipt may report terminal `merged`

### Requirement: Machine operations remain bounded and local-first
The system SHALL expose candidate challenge, contribution inspection, and
receipt refresh through closed JSON CLI and repository-scoped MCP operations.
Inputs MUST use repository-contained paths and bounded strings. The first
implementation MUST NOT execute target workloads, launch T-Rex, install
dependencies, start background polling, contact non-GitHub services, or accept
arbitrary commands.

#### Scenario: Unknown contribution argument is supplied
- **WHEN** a CLI or MCP caller supplies an unknown field, escaping path, or
  unsupported policy
- **THEN** the operation fails before inspecting GitHub or writing evidence

#### Scenario: No T-Rex receipt is configured
- **WHEN** policy is optional and no receipt path is supplied
- **THEN** the operation performs no preview or browser request and records the
  missing optional evidence as a limitation

### Requirement: Maintainer workflow does not expand by default
The system SHALL operate from the contributor's local checkout and existing
read-only pull-request evidence without requiring upstream maintainers to
install CodeVetter, grant an app permission, add configuration, inspect a raw
receipt, resolve a CodeVetter-owned check, or respond to automated messages. It
MUST NOT post comments, request review, send reminders, create required checks,
or modify pull-request metadata unless a future separately authorized operation
explicitly adds that mutation.

#### Scenario: Contributor refreshes upstream evidence
- **WHEN** the contributor runs contribution inspection after a maintainer
  review
- **THEN** CodeVetter reads and classifies the existing feedback locally without
  notifying or assigning work to the maintainer

#### Scenario: Contribution waits on upstream ownership
- **WHEN** every local gate passes and an upstream maintainer owns merge
  authority
- **THEN** CodeVetter records `waiting_for_maintainer` without posting a reminder
  or requesting another review

#### Scenario: Author chooses to share evidence
- **WHEN** the contributor wants to update the pull request
- **THEN** CodeVetter may produce a concise copyable summary while keeping raw
  receipts local, but this read-only MVP does not publish it automatically
