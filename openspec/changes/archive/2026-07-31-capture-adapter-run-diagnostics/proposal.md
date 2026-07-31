## Why

V2 adapters may declare `diagnostics_path`, and v2 receipts may contain token,
cost, tool, and file diagnostics, but the runner never reads the declared
file. A real provider adapter therefore cannot populate the final remaining
evidence field in issue #53.

## What Changes

- Add a closed versioned adapter-diagnostics document contract.
- Load a declared diagnostics file from the disposable public workspace only
  after adapter termination and before hidden checks.
- Preserve valid bounded diagnostics in the immutable run receipt while
  leaving undeclared or unavailable fields absent.
- Fail closed before hidden checks when a cleanly exited adapter declares
  diagnostics that are missing, unsafe, malformed, unknown, or out of bounds.
- Add focused contract, runner, redaction, failure, and evaluator-composition
  tests plus operator documentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-task-corpus-contracts`: Define the closed adapter-diagnostics document.
- `agent-task-runner`: Ingest declared diagnostics into bounded receipts.

## Impact

This changes local benchmark contracts, runner logic, focused tests,
documentation, OpenSpec, and project status. It adds no dependency, provider
SDK, built-in provider adapter, credential handling, UI, hosted service,
deployment, release, or production configuration.
