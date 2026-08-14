## Purpose

Prevents agents from following a noisy single-run browser diagnosis by requiring
compatible, integrity-checked repeated evidence before a next probe is treated
as stable.

## ADDED Requirements

### Requirement: Assess bounded compatible recaptures

CodeVetter SHALL accept two to five unique durable browser-probe recapture IDs
and SHALL validate each probe receipt and linked Playwright receipt/result before
comparison.

#### Scenario: Compatible repetitions

- **WHEN** all recaptures share source snapshot, source probe, exact flow, browser project, request identity, presentation profile, and completed evidence
- **THEN** CodeVetter compares their retained next-probe routes and bounded CPU-ratio observations

#### Scenario: Tampered linked result

- **WHEN** any linked Playwright result fails its byte count, digest, compact diagnosis, or receipt binding
- **THEN** CodeVetter rejects the assessment and returns no stability decision

### Requirement: Require unanimity across three repetitions for stability

CodeVetter SHALL call a next probe stable only when at least three compatible
recaptures unanimously select the same non-null next probe and classification.

#### Scenario: Three unanimous routes

- **WHEN** three or more compatible recaptures select the same next probe and classification
- **THEN** the assessment reports `stable` while retaining low confidence and no edit authority

#### Scenario: Only two matching routes

- **WHEN** two compatible recaptures agree but no third repetition exists
- **THEN** the assessment reports `insufficient_repetitions`

### Requirement: Treat any route disagreement as instability

CodeVetter SHALL report instability as soon as compatible recaptures disagree
and SHALL NOT use majority voting to erase a contradictory run.

#### Scenario: Threshold crossing changes route

- **WHEN** compatible recaptures select different next probes or classifications
- **THEN** the assessment reports `unstable` and withholds follow-up eligibility

### Requirement: Preserve correctness and source authority boundaries

The assessment SHALL report correctness outcomes separately and SHALL never
authorize source editing, optimization, or shipping.

#### Scenario: Stable diagnosis on failed flows

- **WHEN** the next probe is stable but any included Playwright flow failed
- **THEN** follow-up execution remains ineligible until correctness passes

### Requirement: Remain read-only and bounded

The assessment SHALL read only fixed local durable artifact locations, return at
most five compact run observations, and execute no application or browser code.

#### Scenario: CLI or MCP assessment

- **WHEN** an agent invokes either product surface with valid recapture IDs
- **THEN** both return the same normalized assessment without starting a local runtime

#### Scenario: Extra argument

- **WHEN** a caller supplies a command, path, environment, network, or execution argument
- **THEN** CodeVetter rejects it before reading unrelated data or executing code
