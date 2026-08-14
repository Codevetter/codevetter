## Purpose

Defines deterministic routing that reconciles process, exact main-thread,
Worker-thread, and sampled source-scope evidence before asking an agent for the
next local performance observation.

## ADDED Requirements

### Requirement: Prefer exact thread CPU over sampled-time ratios

The router SHALL use a complete compatible current-thread CPU partition to decide
whether pre-commit process CPU is main-thread or other-thread dominated, while
using V8 samples only to describe a retained source scope.

#### Scenario: Main-thread dominated interval with sampled scope

- **WHEN** exact main-thread CPU crosses the fixed share and materiality thresholds and a compatible V8 scope crosses its sample floor
- **THEN** the router selects that main-thread scope without authorizing a source edit

#### Scenario: Main-thread dominated interval without sampled scope

- **WHEN** exact main-thread CPU is material but compatible source-scope samples do not cross the floor
- **THEN** the router requests a better main-thread source profile instead of naming a scope

### Requirement: Reconcile Worker CPU only against same-process other-thread CPU

The router SHALL compare compatible Worker CPU with the exact other-thread
residual rather than total process CPU and SHALL refuse Worker attribution when
the intervals or totals cannot reconcile.

#### Scenario: Material Worker contribution

- **WHEN** Worker CPU crosses the fixed absolute and other-thread-share thresholds and compatible Worker samples identify a scope
- **THEN** the router selects the corresponding Worker scope

#### Scenario: Complete zero-Worker contribution

- **WHEN** other-thread CPU is material and the compatible Worker inventory is complete with zero Worker CPU
- **THEN** the router requests native, V8-background, or libuv-thread evidence

### Requirement: Exclude child processes from parent-process residual diagnosis

The router SHALL NOT present child-process CPU as a possible explanation for a
residual derived from Node current-process CPU counters.

#### Scenario: Unexplained same-process CPU

- **WHEN** exact main-thread and Worker evidence do not explain material current-process CPU
- **THEN** the classification and next probe refer only to native or background threads, libuv work, V8 background work, or a sampling gap

### Requirement: Preserve diagnostic authority boundaries

Every thread reconciliation route SHALL remain source-null, low-confidence,
edit-ineligible, and incapable of overriding failed correctness.

#### Scenario: Failed exact browser flow

- **WHEN** a failed browser flow retains a complete thread reconciliation
- **THEN** the compact diagnosis preserves the next probe and explicitly requires correctness before any optimization

