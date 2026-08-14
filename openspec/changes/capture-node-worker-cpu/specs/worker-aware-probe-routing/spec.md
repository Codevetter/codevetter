## Purpose

Use compatible Worker evidence to refine an off-main-thread CPU gap into the next supported observation while preserving zero source-edit authority.

## ADDED Requirements

### Requirement: Reconcile Worker, process, and main-thread CPU under fixed thresholds
CodeVetter SHALL consider Worker CPU only when the request, process CPU, main-thread sample slice, Worker interval, Worker inventory, and overlap evidence are complete and compatible. It SHALL use fixed absolute and relative thresholds and SHALL retain the compared values in observed evidence.

#### Scenario: Material Worker CPU with a dominant sampled scope
- **WHEN** compatible Workers account for material observed process CPU and one closed Worker sampled scope dominates retained non-idle Worker samples
- **THEN** CodeVetter selects that Worker scope as the next inspection route without claiming exclusive causation or authorizing an edit

#### Scenario: Material Worker CPU without sampled source confidence
- **WHEN** compatible Worker CPU is material but its sampled profile is unavailable or insufficient
- **THEN** CodeVetter selects a narrower Worker source-profile observation rather than naming a source scope

#### Scenario: Complete low Worker CPU
- **WHEN** the compatible Worker inventory is complete and retained Worker CPU is below the fixed thresholds
- **THEN** CodeVetter routes remaining CPU toward child-process, native-thread, background, or sampling-gap evidence and does not call Worker activity the cause

### Requirement: Missing or contaminated Worker evidence cannot narrow the route
Unsupported, incomplete, late, malformed, or contaminated Worker evidence SHALL preserve a Worker-capture or isolated-recapture next step rather than being interpreted as zero Worker CPU.

#### Scenario: Unsupported Worker capture
- **WHEN** the Node runtime lacks supported Worker observations
- **THEN** the existing off-main/background result requests supported Worker evidence or reports the runtime limitation

#### Scenario: Contaminated Worker capture
- **WHEN** selected dynamic requests overlap during Worker observation
- **THEN** CodeVetter requests an isolated recapture and grants no Worker attribution

### Requirement: Worker routing is diagnosis-only
Every Worker-aware route SHALL remain source-null at the routing layer, low-confidence, edit-ineligible, and conditional on a correctness-passing exact flow before any optimization experiment.

#### Scenario: Failed browser assertion with Worker evidence
- **WHEN** a failed exact browser flow retains otherwise compatible Worker evidence
- **THEN** CodeVetter preserves the diagnosis and next probe but does not authorize a source edit, optimization, or correctness claim
