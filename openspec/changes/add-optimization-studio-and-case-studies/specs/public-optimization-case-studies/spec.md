## Purpose

Show prospective users concrete optimization proof without overstating local,
synthetic, development-only, or otherwise limited benchmark evidence.

## ADDED Requirements

### Requirement: The public site shows evidence-backed optimization case studies
The landing page and benchmark route SHALL show at least one committed real
project trial with the measured baseline, candidate, decision process, and
tested scope.

#### Scenario: Visitor sees the case study summary
- **WHEN** a visitor opens the landing page
- **THEN** the site identifies the repository type, tested flow, retained result, rejected candidate, and local-only qualification in a compact summary

#### Scenario: Visitor inspects the benchmark route
- **WHEN** a visitor follows the case-study link
- **THEN** the site shows the evidence sequence, sample counts, correctness result, production-build qualification, limitations, and receipt access

#### Scenario: Visitor compares projects
- **WHEN** a visitor opens the optimization benchmark index
- **THEN** each project has a separate dated route and the code-review benchmark remains a distinct surface

### Requirement: Optimization has a dedicated public feature explanation
The public site SHALL explain the local optimization loop, supported frontend
and backend evidence, correctness gate, change-cost policy, and local-only
boundary separately from individual benchmark results.

#### Scenario: Visitor asks how the product works
- **WHEN** a visitor opens the optimization feature route
- **THEN** it explains discovery, measurement, diagnosis, bounded experimentation, verification, and links to the separate project evidence

### Requirement: Evidence and claims remain qualified
The public case study SHALL distinguish observed measurements from conclusions,
show rejected experiments, and SHALL NOT present a local development transfer
improvement as equivalent to shipped consumer performance.

#### Scenario: Local and production metrics differ
- **WHEN** the retained candidate materially improves the local development flow but not the production initial bundle
- **THEN** the site gives both results comparable prominence and labels the retained result as a local-development improvement

### Requirement: Public proof is machine-readable
The benchmark route SHALL expose the committed case-study receipt through a
stable, prerendered JSON response containing the same source evidence used by
the human presentation.

#### Scenario: Agent requests the proof endpoint
- **WHEN** a client requests the published performance proof JSON path
- **THEN** it receives the committed receipt with an application/json content type

### Requirement: Case studies disclose implementation cost and date
Each public optimization case study SHALL identify the observation date,
repository revision, files and lines changed, dependency impact, and tested
boundary alongside the measured result.

#### Scenario: Visitor evaluates whether a result was worth its patch
- **WHEN** a visitor inspects a retained optimization
- **THEN** the case study presents its dated performance evidence and change cost together, without describing an eligibility run as an optimization win

#### Scenario: A plausible candidate performs worse
- **WHEN** repeated paired verification rejects a bounded candidate
- **THEN** the public evidence may show the dated rejection and restoration without presenting it as a performance improvement
