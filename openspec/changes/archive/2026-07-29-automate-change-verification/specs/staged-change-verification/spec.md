## MODIFIED Requirements

### Requirement: One staged verification outcome
CodeVetter SHALL represent verification of a code change as an ordered sequence of code review, executable testing, and audience validation, and SHALL expose one aggregate outcome with evidence from every completed stage. A completed warm local verification run MAY supply executable-testing evidence only when its exact change-set identity is current, its required selection completed, and its outcome is passed or regression rather than operational or selection `no_confidence`. A completed T-Rex change-preview receipt MAY contribute executable-testing evidence only when its exact repository, base, head, and plan identities are current, its preview identity is `verified`, and every required journey completed. A `claimed` or `mismatch` preview receipt MUST NOT satisfy change verification by itself.

#### Scenario: Full user-facing verification
- **WHEN** a user-facing change completes review, executable testing, and audience validation
- **THEN** CodeVetter shows the result of each stage and an aggregate outcome linked to the underlying findings, test artifacts, and audience evidence

#### Scenario: Backend-only change does not need audience validation
- **WHEN** the operator marks audience validation not applicable and records a reason
- **THEN** CodeVetter preserves the waiver and can complete the aggregate outcome from review and executable-test evidence without claiming audience validation occurred

#### Scenario: Warm verification has incomplete selection
- **WHEN** a warm local run skips a required scenario, uses a stale source identity, is cancelled, or ends with operational or selection `no_confidence`
- **THEN** the executable-testing stage remains not verified and identifies the missing or invalid evidence

#### Scenario: T-Rex preview linkage is unproven
- **WHEN** every selected preview journey passes but preview identity remains `claimed`
- **THEN** the executable-testing stage preserves the useful journey evidence but remains not verified

#### Scenario: T-Rex preview identity mismatches
- **WHEN** the preview exposes a revision different from the exact change head
- **THEN** the executable-testing stage remains not verified and preserves the mismatch evidence

### Requirement: Stage provenance and status
Each stage SHALL have an explicit status, timestamp, provenance, and evidence references. Persisted stage evidence MUST be structured enough to support a sanitized X-Ray export, and a stage MUST NOT be shown as passed solely because an earlier stage passed. Warm local verification provenance MUST include daemon/result schema, exact target and change-set identities, configuration and scenario-manifest hashes, selected and fallback scenarios, observation policy, warm/cold state, and limitations. T-Rex change-preview provenance MUST include its receipt schema, target kind, exact base and head, bounded changed paths, preview URL and identity evidence, selected routes, journey evidence, aggregate verdict, timings, and limitations.

#### Scenario: Review passes but browser QA fails
- **WHEN** review completes without blocking findings and executable browser QA fails
- **THEN** the aggregate outcome remains unverified or blocked and identifies the failed QA evidence

#### Scenario: Stage is included in an X-Ray
- **WHEN** a completed verification is selected for public X-Ray export
- **THEN** each exported stage retains its status, timestamp, provenance kind, and approved evidence references
- **AND** missing or non-public evidence is represented as unavailable rather than silently dropped

#### Scenario: Warm verification supplies executable evidence
- **WHEN** every required scenario for the exact current change set executes and the warm result passes
- **THEN** the executable-testing stage links the run, selection explanation, automatic observations, timings, and artifacts as executable provenance

#### Scenario: T-Rex supplies verified preview evidence
- **WHEN** the preview identity exactly matches the current change head and every required route journey passes
- **THEN** the executable-testing stage links the source, preview, route plan, journey outcomes, timings, limitations, and artifacts as executable provenance
