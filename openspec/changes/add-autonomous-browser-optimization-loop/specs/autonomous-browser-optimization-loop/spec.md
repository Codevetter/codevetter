## Purpose

Defines how CodeVetter turns one exact local browser flow into a bounded,
evidence-governed queue of optimization experiments and automatically advances
that queue with an external coding agent.

## ADDED Requirements

### Requirement: Flow-first evidence collection
CodeVetter SHALL collect every enabled bounded evidence family for the selected
exact browser flow before returning a source-edit action. The evidence families
MUST include browser timing, loading, memory, React activity when applicable,
initial-route dependency attribution when a supported artifact is present, and
the existing review-evidence selector for the current source snapshot.

#### Scenario: Runtime hotspot appears before dependency analysis
- **WHEN** an exact flow contains an eligible runtime hotspot and also has a supported initial-route artifact
- **THEN** CodeVetter records both evidence families before ranking experiments and does not stop at the runtime hotspot alone

#### Scenario: Evidence family is unavailable
- **WHEN** one enabled evidence family cannot run safely or completely
- **THEN** CodeVetter records the unavailable family and reason while continuing with the remaining safe families

#### Scenario: Review owns a candidate source
- **WHEN** review evidence binds a candidate source to one repository-owned correctness scope
- **THEN** CodeVetter attaches that evidence and scope to the matching experiment while leaving runtime evidence authoritative for performance ranking and promotion

#### Scenario: Historical review evidence is stale
- **WHEN** review finds an accepted result from another source snapshot
- **THEN** CodeVetter may request current correctness reverification but MUST NOT use the historical result to confirm the new optimization

### Requirement: Initial-route dependency attribution
CodeVetter SHALL map each retained initial-route JavaScript chunk to bounded
source and package contributors and SHALL identify the import or supported
bundler-rule relationship that placed each contributor in the route graph when
that relationship can be proven statically.

#### Scenario: Unrelated package is placed in a framework chunk
- **WHEN** a supported Vite artifact maps a non-framework package into a framework-labelled initial chunk and a static bundler rule matches that package path
- **THEN** CodeVetter reports the observed package, chunk, bytes, matching rule location, and initial-route membership

#### Scenario: Artifact provenance is not exact
- **WHEN** an existing production artifact cannot be cryptographically bound to the current source snapshot
- **THEN** CodeVetter labels its graph as unverified and prevents it from independently confirming an optimization

#### Scenario: Deferred package is forced into an initial manual chunk
- **WHEN** a deferred route package matches a supported raw-ID chunk rule through its package-manager peer path and that chunk is in the initial artifact closure
- **THEN** CodeVetter reports deferred reachability, the effective first-return rule, matching package path, chunk, and bounded affected bytes

#### Scenario: Multiline and deferred importers share a package
- **WHEN** a captured package is imported by multiline declarations in the selected static closure and by separately deferred routes
- **THEN** CodeVetter parses the multiline imports, seals only the static initial-flow importers for that experiment, and retains deferred importers as non-initial evidence

#### Scenario: Later diagnostic requests are incomplete
- **WHEN** the selected navigation action has a complete zero-failure response cohort but later evaluation or analytics actions contain failed requests
- **THEN** CodeVetter compares the navigation cohort and does not let later request noise invalidate or inflate the navigation transfer metric

#### Scenario: Source-attested artifact materially improves
- **WHEN** independently trusted baseline and candidate initial-route artifacts are bound to their exact source snapshots and gzip bytes clear both materiality floors
- **THEN** CodeVetter may use the artifact as the primary performance metric only when correctness passes and paired browser evidence is stable and non-regressing

### Requirement: Evidence and hypotheses remain separate
CodeVetter SHALL separate observed graph and runtime facts from inferred
optimization hypotheses, and each hypothesis MUST name its required observation
and rejection condition.

#### Scenario: Large dependency is observed
- **WHEN** a large initial-route dependency is captured without proof that it is unnecessary
- **THEN** CodeVetter reports its bytes as observed and any removal or deferral suggestion as unverified inference

### Requirement: Ranked experiment queue
CodeVetter SHALL produce a deterministic, bounded, deduplicated queue of
experiments for the selected flow. Each entry MUST contain a stable identity,
source boundary, predicted metric and direction, confidence basis, correctness
scope, performance verifier, and rejection condition.

#### Scenario: Multiple detectors identify the same cause
- **WHEN** loading, React, and dependency evidence point to the same source relationship
- **THEN** CodeVetter merges them into one experiment while retaining every supporting evidence reference

#### Scenario: Higher-impact evidence exists
- **WHEN** one eligible experiment affects measured initial-route bytes and another affects only a low-share runtime hotspot
- **THEN** deterministic ranking places the measured larger-impact experiment first unless its evidence or verification quality is weaker

### Requirement: Agent-driven automatic iteration
CodeVetter SHALL expose one next-experiment operation and one evaluation
operation so a connected coding agent can repeatedly apply a bounded patch,
submit the resulting snapshot, and receive a keep, reject, retry, or stop
decision without manually reconstructing campaign state.

#### Scenario: Candidate is rejected
- **WHEN** correctness fails, the predicted metric does not improve materially, or a protected resource regresses
- **THEN** CodeVetter records the rejection, directs the host to restore the recorded incumbent through recoverable isolation, and advances to the next untried experiment

#### Scenario: Candidate is kept
- **WHEN** paired verification confirms a material correctness-preserving improvement
- **THEN** CodeVetter advances the incumbent, invalidates stale queue entries, replans the remaining flow evidence, and returns the next experiment

### Requirement: CodeVetter retains verifier authority
The CodeVetter process MUST NOT accept arbitrary shell commands or source
patches and MUST NOT weaken correctness, performance, or resource policy in
response to the connected agent. Source edits and checkout restoration MUST
remain host-agent operations constrained by the returned source boundary.

#### Scenario: Agent requests an out-of-bound edit
- **WHEN** the candidate changes a protected evaluator file or a file outside the experiment boundary
- **THEN** CodeVetter returns no confidence, records the boundary violation, and does not run promotion

### Requirement: Bounded local execution
The loop MUST declare limits for evidence passes, experiments, elapsed local
time, consecutive failures, and retained artifacts. It MUST deny non-loopback
browser traffic and MUST NOT invoke production, cloud, paid-model, installation,
migration, deployment, or release operations.

#### Scenario: Plateau or budget is reached
- **WHEN** the declared experiment, time, failure, or non-improvement limit is reached
- **THEN** CodeVetter stops deterministically and reports the incumbent, rejected experiments, untested queue entries, coverage gaps, and local resource cost

### Requirement: Final optimization report
CodeVetter SHALL return a machine-readable final report that distinguishes
verified improvements, rejected hypotheses, exhausted evidence areas, untested
work, and limitations for the selected flow.

#### Scenario: No optimization is confirmed
- **WHEN** every eligible experiment is rejected or exhausted
- **THEN** CodeVetter reports a verified no-win result for the tested queue without claiming that the application or route is globally optimal
