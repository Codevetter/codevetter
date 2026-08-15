# local-node-script-profiling Specification

## Purpose
Define how CodeVetter profiles a repository-owned standalone JavaScript benchmark when the workload is an executable script rather than a test-runner test.
## Requirements
### Requirement: Standalone Node profiling is closed and exact
CodeVetter SHALL accept `node-script` only for one repository-contained `.js`, `.mjs`, or `.cjs` target. It MUST invoke the current Node executable with that target and no caller-supplied arguments, shell, package script, install step, or inherited application environment.

#### Scenario: Local JavaScript benchmark is selected
- **WHEN** an agent explicitly profiles a repository-relative `.mjs` benchmark through `node-script`
- **THEN** CodeVetter executes only that file with the bounded sample, warmup, timeout, environment, and process-cleanup policy

#### Scenario: Non-JavaScript target is supplied
- **WHEN** a `node-script` target has an unsupported extension or escapes the repository
- **THEN** CodeVetter rejects it before starting a process

### Requirement: Node script evidence uses the existing performance contract
A successful standalone script profile SHALL emit the existing versioned performance capsule with `node-script` adapter identity, wall-time samples, bounded console benchmark metrics, V8 source profiles, limitations, and disposable artifact guarantees. CodeVetter MUST NOT describe the script as a test or infer correctness from exit success alone.

#### Scenario: Script emits benchmark metrics
- **WHEN** a successful script emits bounded `[benchmark]` metrics and repository-owned V8 samples
- **THEN** the capsule reports median unprofiled metrics and source attribution separately
- **AND** labels the scope as a Node script rather than a test-runner test
