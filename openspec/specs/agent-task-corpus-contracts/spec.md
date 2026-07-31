# agent-task-corpus-contracts Specification

## Purpose
Defines the bounded machine contracts and fail-closed validation required to
build a reproducible coding-agent task corpus without launching an agent.
## Requirements
### Requirement: Corpus documents use closed versioned contracts

The system SHALL define closed versioned contracts for corpus indexes, task
manifests, fixture bundles, acceptance contracts, known-good changes, check
results, qualification receipts, agent adapters, adapter diagnostics,
deterministic run plans, and run receipts. Adapter and receipt readers MUST
preserve supported v1 documents while new runner output uses v2 identities and
lifecycle evidence. Every contract MUST reject unknown fields, missing
required fields, invalid enum values, duplicate identifiers, unsafe
placeholders, and values outside declared bounds.

#### Scenario: A contract document is valid

- **WHEN** a document contains exactly the required and optional fields for its declared schema version and every value is within bounds
- **THEN** contract validation accepts it without adding inferred values

#### Scenario: An unknown field appears

- **WHEN** any contract object contains a field not declared by its schema
- **THEN** validation rejects the document and identifies the exact field path

### Requirement: Task artifacts have immutable safe identities

Each corpus index entry and task manifest SHALL bind semantic files to
lowercase SHA-256 identities. Artifact paths MUST remain relative to their
owning root, MUST NOT traverse directories or use platform-specific absolute
forms, and MUST resolve to bounded regular files. Task provenance and license
metadata MUST identify an owned source or an immutable external revision.

#### Scenario: Declared artifacts match

- **WHEN** every task artifact exists beneath its task directory and its bytes
  match the declared SHA-256 identity
- **THEN** structural validation accepts the artifact identities

#### Scenario: An artifact drifts

- **WHEN** a declared task manifest, fixture archive, task packet, acceptance
  contract, or known-good patch no longer matches its recorded SHA-256
- **THEN** validation fails and names the mismatched artifact

#### Scenario: A path escapes its root

- **WHEN** a document declares an absolute path, parent traversal, backslash
  traversal, symbolic link, directory, or other non-regular artifact
- **THEN** validation rejects it before reading outside the owning root

### Requirement: Structural validation is distinct from publishable readiness

The non-strict command SHALL accept a structurally valid in-progress corpus and
report its exact task, lane, category, and qualification counts. The strict
readiness command MUST fail unless 30–50 structurally valid qualified
TypeScript/Node tasks cover both browser and API lanes and at least six failure
categories. The owned corpus SHALL contain at least 30 independently qualified
tasks before strict readiness reports `publishable: true`.

#### Scenario: A small sample corpus is structurally valid

- **WHEN** all documents and identities are valid but fewer than 30 qualified tasks exist
- **THEN** non-strict validation exits successfully and reports `publishable: false` with the missing readiness gates

#### Scenario: Strict breadth is incomplete

- **WHEN** strict readiness is requested and task count, qualification count, lane coverage, or failure-category breadth is below the declared gate
- **THEN** the command exits non-zero with deterministic unmet-gate evidence

#### Scenario: Strict breadth reaches the minimum

- **WHEN** 30 structurally valid tasks have matching qualification evidence and satisfy lane, runtime, and category gates
- **THEN** strict readiness exits successfully with exact deterministic coverage evidence

### Requirement: Validation output is deterministic and inspectable

Both validation modes SHALL support human-readable and JSON output derived from
one canonical result. Task identities, counts, errors, warnings, and readiness
gates MUST have deterministic ordering, and invalid input MUST return a
non-zero exit code without suppressing the result.

#### Scenario: The same corpus is validated twice

- **WHEN** unchanged corpus bytes are validated repeatedly
- **THEN** the semantic JSON result and human ordering are identical

#### Scenario: Invalid JSON is encountered

- **WHEN** an index, manifest, or referenced machine document cannot be parsed
- **THEN** validation returns a bounded path-specific error and exits non-zero

### Requirement: Validation has no execution authority

Corpus validation and readiness SHALL only read local corpus files and compute
identities. They MUST NOT launch agents, execute task checks, apply patches,
make network requests, create qualification receipts, or mutate task content.

#### Scenario: An operator validates a corpus

- **WHEN** non-strict validation or strict readiness runs
- **THEN** no model call, subprocess-backed task check, network request, or
  corpus mutation occurs

### Requirement: The owned seed cohort spans realistic web-agent failure modes
Before full publication breadth, the in-progress corpus SHALL contain qualified
owned seed tasks for browser state, authorization, API contracts, validation,
async/concurrency, persistence, integration, and regression behavior. The
cohort MUST include both browser and API lanes and both Node and TypeScript
runtimes, with exact category and coverage counts reported by normal corpus
validation.

#### Scenario: Every seed category is present
- **WHEN** the owned seed corpus is validated
- **THEN** one or more structurally valid tasks cover each declared seed category and both required lanes and runtimes

#### Scenario: Seed breadth remains below publication count
- **WHEN** all eight seed categories qualify but fewer than 30 tasks exist
- **THEN** normal validation reports the exact coverage while strict readiness remains non-zero and `publishable: false`

### Requirement: Seed tasks prove task-defining behavior without regressions

Every owned task SHALL expose only a public task packet and baseline fixture to
the agent workspace, SHALL declare at least one task-defining acceptance check
and one separate regression check, and SHALL bind a minimal known-good change.
Qualification MUST repeat the intended baseline failure and complete
regression-free known-good pass before the task counts as qualified. Distinct
acceptable implementation locations for one observable outcome MUST remain one
task-defining check rather than being counted as multiple outcomes.

#### Scenario: An owned seed qualifies

- **WHEN** its baseline repeatedly fails only the task-defining behavior and its exact known-good change repeatedly passes all checks
- **THEN** the corpus records an immutable qualified receipt for that task

#### Scenario: A seed passes by weakening another behavior

- **WHEN** the task-defining check passes but any declared regression check fails
- **THEN** qualification classifies a regression and the seed does not count as qualified

#### Scenario: One outcome has multiple valid implementation locations

- **WHEN** the same observable defect can be corrected at either of two declared implementation boundaries
- **THEN** acceptance uses one task-defining outcome and does not inflate corpus breadth by counting each location separately

### Requirement: Intentional decoys measure unnecessary changes

The owned corpus SHALL include an intentional lookalike decoy when it
materially measures false-positive or unnecessary-change behavior. The decoy
MUST remain agent-visible, MUST NOT be required for the task-defining fix, and
MUST have a regression check that detects byte drift. The known-good change
MUST leave the decoy untouched.

#### Scenario: The real implementation changes without decoy drift

- **WHEN** the task-defining behavior is fixed in the intended implementation and the decoy remains byte-identical
- **THEN** task-defining and decoy regression checks pass

#### Scenario: A lookalike decoy is edited unnecessarily

- **WHEN** an agent changes the decoy while correcting the real behavior
- **THEN** the decoy regression check fails and the run cannot count as regression-free
