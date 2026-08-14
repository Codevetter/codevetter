## Purpose

Routes an agent from coarse Node pre-commit timing to the next supported local
probe by reconciling bounded runtime evidence without fabricating causation.

## ADDED Requirements

### Requirement: Request CPU evidence is sliced at response commitment

CodeVetter MUST partition the owned main-thread request CPU profile at the
observed response-commit boundary and retain bounded sample counts, sampled
time, and closed execution-scope categories for the pre-commit interval.

#### Scenario: Complete compatible profile and response boundary

- **WHEN** one non-contaminated request has an ordered response-commit boundary
  and a complete compatible CPU profile
- **THEN** CodeVetter reports bounded pre-commit total samples and sampled time
- **AND** the reported scope categories sum exactly to total pre-commit samples

#### Scenario: Boundary or profile is incompatible

- **WHEN** the response boundary is incomplete, the profile is contaminated or
  truncated, or its sampled interval cannot cover the boundary
- **THEN** CodeVetter reports pre-commit CPU evidence as insufficient
- **AND** it does not synthesize a partial classification

### Requirement: Next probe is selected by a closed evidence policy

CodeVetter MUST reconcile material process CPU, main-thread pre-commit CPU,
response-linked async delay, and complete framework-phase evidence using fixed
thresholds and a closed next-probe classification.

#### Scenario: Main-thread evidence explains material process CPU

- **WHEN** repository, dependency, generated, or runtime main-thread sampled
  time materially overlaps the pre-commit interval and clears the fixed share
  threshold against observed process CPU
- **THEN** CodeVetter routes the next probe to the dominant main-thread scope
- **AND** it does not call sampled time exclusive CPU or authorize a source edit

#### Scenario: Process CPU exceeds explained main-thread activity

- **WHEN** process CPU is material but retained non-idle main-thread sampled time
  does not clear the fixed explanatory threshold
- **THEN** CodeVetter routes the next probe to off-main-thread or background CPU
- **AND** it does not claim a worker thread as the cause

#### Scenario: Response-linked async delay dominates

- **WHEN** observed process CPU is low and complete response-linked async delay
  materially overlaps the pre-commit interval
- **THEN** CodeVetter routes the next probe to the dominant supported async
  resource kind
- **AND** it does not call overlapping delay exclusive waiting

#### Scenario: Framework phase dominates

- **WHEN** a complete closed framework phase materially dominates the
  pre-commit interval and stronger CPU or async evidence does not
- **THEN** CodeVetter routes the next probe to that framework phase
- **AND** it remains source-null and edit-ineligible

#### Scenario: Evidence remains mixed or incomplete

- **WHEN** no closed route clears its fixed threshold or required inventories
  are incomplete
- **THEN** CodeVetter reports mixed or insufficient routing evidence
- **AND** the route identifies the exact missing evidence rather than inventing
  a cause

### Requirement: The selected route is agent-queryable

CodeVetter MUST expose the selected next probe and its evidence references in
the structured browser diagnosis and autonomous laboratory receipt.

#### Scenario: Agent inspects an exact browser flow

- **WHEN** an exact capture produces a pre-commit route
- **THEN** the compact diagnosis identifies the selected probe, confidence,
  edit authority, and required next observation
- **AND** the laboratory records that route without requiring the agent to
  reconcile lower-level findings manually

