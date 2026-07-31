## Purpose

Compose immutable provider-neutral agent-task receipts into deterministic
structural-context evaluation evidence without weakening scorer authority or
mixing raw observations with derived conclusions.

## ADDED Requirements

### Requirement: Evaluation bundles are closed and identity-bound
The system SHALL accept only a versioned closed evaluation bundle that names an
immutable local corpus, task revisions, adapter artifacts, structural-context
metadata, and raw v2 run receipts by safe relative path and exact SHA-256
identity. It MUST reject unknown fields, unsafe paths, non-regular files,
unsupported receipt or adapter versions, duplicate run identities, and any
declared artifact whose bytes do not match its identity.

#### Scenario: Every declared artifact is immutable
- **WHEN** a valid local bundle references corpus, adapter, and receipt files whose bytes match their declared SHA-256 identities
- **THEN** the system may load those artifacts for deterministic composition

#### Scenario: A receipt changes after the bundle is declared
- **WHEN** a referenced receipt no longer matches the bundle identity
- **THEN** the system rejects the bundle before projecting or scoring evidence

### Requirement: Receipt projection fails closed on invalid evidence
The system SHALL project outcomes and available diagnostics from raw receipts
without copying agent-visible ground truth into those receipts. It MUST reject
export when a pair is incomplete or duplicated, task or common identities
drift, execution order is invalid, required checks are missing, the treatment
graph snapshot is stale, an A/B control is contaminated by structural context,
or equivalent A/A arms use different context policies.

#### Scenario: A complete isolated pair is supplied
- **WHEN** both arms bind the same task, corpus, adapter, environment, trial, and ground-truth identities while satisfying their declared context policy
- **THEN** the system projects the pair into the existing evaluator manifest

#### Scenario: A required check is absent
- **WHEN** either raw receipt completes a check-execution lifecycle but omits a check declared by the immutable acceptance contract
- **THEN** the system refuses to export a derived score artifact

#### Scenario: Agent terminates before checks
- **WHEN** a setup, agent, timeout, or cancellation outcome correctly withholds hidden checks
- **THEN** the projection records the immutable acceptance inventory as skipped while preserving the distinct terminal outcome

#### Scenario: Control evidence is contaminated
- **WHEN** an A/B control enables structural context, retains graph identity, or records a graph-tool call
- **THEN** the system refuses to export the experiment

### Requirement: Raw receipts and derived scores remain separate
The system SHALL leave raw receipts byte-for-byte unchanged and SHALL emit any
score as a separate bounded artifact. Every derived score MUST include a scorer
version and SHA-256 identity, bundle identity, corpus identity, ground-truth
identity, projected-manifest identity, and sorted raw receipt identities.
Unavailable provider diagnostics MUST remain absent rather than being
fabricated as zero values.

#### Scenario: A score is derived from valid receipts
- **WHEN** composition and the existing evaluator both succeed
- **THEN** the derived artifact identifies the exact scorer, corpus, ground truth, projection, and raw receipt set used

#### Scenario: Optional diagnostics were not captured
- **WHEN** a raw receipt omits tokens, cost, tools, or file observations
- **THEN** the projection and score omit those observations instead of inventing values

### Requirement: Rescoring is deterministic and execution-free
The system SHALL support repeated local scoring from the same bundle and raw
receipts without launching an agent, executing acceptance checks, calling a
model provider, making a network request, or mutating source artifacts.
Equivalent inputs and scorer bytes MUST produce byte-equivalent derived JSON.

#### Scenario: The same evidence is rescored
- **WHEN** the same immutable bundle, receipts, corpus, ground truth, and scorer are supplied again
- **THEN** the system emits the same derived score and identities without rerunning the agent

#### Scenario: Ground truth is revised
- **WHEN** an acceptance contract changes and its corpus and bundle identities are updated
- **THEN** rescoring emits a different ground-truth and derived-score identity without claiming the original score applies
