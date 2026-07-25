# Managed work harness Specification

## Purpose

Define isolated, recoverable local provider execution with bounded hooks,
collision-safe resources, and explicit publish and cleanup boundaries.

## Requirements

### Requirement: Managed runs own an isolated recoverable execution identity
CodeVetter SHALL persist a managed run with work-item identity, provider and
profile, repository and base revision, isolated worktree/environment, owner
token, reserved ports, process identity, hooks, state, and checkpoints.

#### Scenario: Managed build starts
- **WHEN** the user explicitly starts a managed run from a prepared Work or Board item
- **THEN** CodeVetter creates one isolated worktree and bounded environment
- **AND** launches the selected installed provider under a durable run identity

#### Scenario: Application restarts during a run
- **WHEN** CodeVetter restarts while the recorded process and worktree still match their owner identities
- **THEN** the run is reattached with its checkpoints and current state
- **AND** ambiguous or mismatched resources fail closed as disconnected

### Requirement: Hooks and ports are bounded and visible
Setup, run, check, and archive hooks SHALL use displayed exact argument vectors,
bounded time and output, repository-owned working directories, and per-run port
reservations. They MUST NOT imply shell interpolation, credential access, or
publish actions.

#### Scenario: Two managed runs need the same development port
- **WHEN** a requested port is already reserved by another live run
- **THEN** CodeVetter assigns or requests a distinct allowed port
- **AND** persists the resolved mapping in both run environments

#### Scenario: Hook exceeds its bound
- **WHEN** a hook exceeds its time or output ceiling
- **THEN** CodeVetter terminates the owned hook process group
- **AND** records a bounded failed checkpoint without advancing evidence state

### Requirement: Publish and cleanup actions remain explicit
Commit, push, PR creation, archive, and worktree removal MUST require distinct
user actions with current diff/check evidence. A workflow stage transition
MUST NOT perform them implicitly.

#### Scenario: Checks pass in an isolated worktree
- **WHEN** the managed run reaches a current passing check checkpoint
- **THEN** Board exposes the available diff and explicit next actions
- **AND** does not commit, push, open a PR, or remove the worktree automatically
