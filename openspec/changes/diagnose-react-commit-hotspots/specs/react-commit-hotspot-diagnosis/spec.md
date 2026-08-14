## Purpose

Provide agents with bounded, deterministic React component hotspot candidates
from exact local browser flows without mislabeling repeated commits as proven
redundant rendering or production impact.

## ADDED Requirements

### Requirement: Material repeated React activity becomes a source candidate
CodeVetter SHALL produce at most one React commit-hotspot finding for an exact
Playwright flow when profiled derived component self-work crosses fixed
repetition, absolute-duration, and duration-share floors and the selected
component maps to one unique repository declaration through a complete bounded
source scan.

#### Scenario: One repository component crosses every floor
- **WHEN** a successful React diagnostic reports at least three profiled commits and one component from a complete unique-source scan is present in at least three commits, contributes at least five milliseconds of derived self-render duration, and contributes at least one tenth of total React actual duration
- **THEN** CodeVetter emits one source-linked React commit-hotspot finding eligible for a bounded optimization experiment

#### Scenario: Several components cross every floor
- **WHEN** multiple uniquely attributed repository components satisfy the fixed policy
- **THEN** CodeVetter deterministically selects the component with the greatest derived self-render duration, then commit presence, then stable source identity

### Requirement: Weak React evidence cannot authorize an experiment
CodeVetter MUST withhold a React source candidate when the diagnostic pass does
not establish complete, material, repeatable, and uniquely owned component
activity.

#### Scenario: React evidence is absent or unavailable
- **WHEN** React is undeclared, instrumentation is unavailable, or no commit is observed
- **THEN** the detector returns closed coverage explaining the missing evidence and emits no finding

#### Scenario: Self-duration evidence is unavailable
- **WHEN** legacy evidence or the active renderer provides no derived component self-render duration, or fewer than three commits are profiled
- **THEN** the detector emits no source candidate and records the incomplete profiling boundary

#### Scenario: Activity is immaterial
- **WHEN** a component misses the repetition, absolute-duration, or duration-share floor
- **THEN** the detector runs without producing a finding

#### Scenario: Source ownership is ambiguous
- **WHEN** a component name maps to zero or more than one repository declaration
- **THEN** the activity remains observable in React evidence but cannot become an experiment candidate

#### Scenario: Source attribution scan is incomplete
- **WHEN** repository source attribution reaches its file or byte bound before scanning the admitted tree
- **THEN** no component from that partial scan receives unique-source experiment authority

#### Scenario: Presentation inventory is truncated
- **WHEN** the bounded report omits lower-ranked components but the retained component's self-work is complete and its source scan is complete
- **THEN** CodeVetter may retain that observed candidate with an explicit limitation that a stronger omitted component may exist

### Requirement: React findings separate observation from inference
Every React commit-hotspot finding SHALL state that commit presence and a
derived self-render duration were observed, while redundancy, causality, exact
exclusive CPU cost, user impact, and production frequency remain unverified.

#### Scenario: A hotspot finding is returned
- **WHEN** an agent inspects the finding through an existing diagnosis surface
- **THEN** the finding includes the component name, source, commit presence, derived self-render duration and provenance, total React duration, duration share, fixed thresholds, limitations, and paired verification required before acceptance

#### Scenario: Repetition is semantically necessary
- **WHEN** later correctness or paired-flow evidence shows that repeated commits are required or the proposed change regresses behavior
- **THEN** CodeVetter rejects the optimization without weakening the original observation

### Requirement: Existing agent surfaces expose the detector
The React commit-hotspot detector SHALL participate in existing Playwright
diagnosis and autonomous performance-lab paths without adding a new public MCP
or CLI operation.

#### Scenario: Existing exact browser capture contains a hotspot
- **WHEN** the current capture, diagnosis, or laboratory operation loads compatible React evidence
- **THEN** its ordinary finding inventory and detector coverage include the React detector result

#### Scenario: Authoritative browser timing remains separate
- **WHEN** the React diagnostic rerun records observer-influenced duration
- **THEN** CodeVetter does not replace authoritative browser timing with that duration and paired verification retains correctness, latency, memory, loading, and React regression gates
