## MODIFIED Requirements

### Requirement: Run receipts preserve exact bounded evidence

Every attempted execution SHALL return a closed v2 receipt tied to the plan,
task, manifest, fixture, acceptance contract, adapter, environment, public
workspace policy, ordered lifecycle, agent termination, redacted output
identities, checks, cleanup, and limitations. An adapter MAY declare one
workspace-relative closed diagnostics document. Valid token, cost, tool-name,
inspected-file, and modified-file observations from that document SHALL be
copied into the receipt after adapter termination. Undeclared or unavailable
fields MUST remain absent rather than being fabricated as zero. Diagnostics
remain activity metadata and MUST NOT replace executable checks.

#### Scenario: Cleanup succeeds

- **WHEN** the attempt reaches its terminal state and the workspace is removed
- **THEN** the receipt records complete cleanup and contains no temporary path or credential value

#### Scenario: Cleanup fails

- **WHEN** workspace removal fails
- **THEN** the receipt preserves `cleanup_failure` and cannot record success

#### Scenario: Declared diagnostics are valid

- **WHEN** a terminated adapter writes a bounded valid document at its declared workspace-relative path
- **THEN** the receipt preserves exactly the available redacted observations and hidden checks remain authoritative

#### Scenario: Declared diagnostics are invalid after a clean exit

- **WHEN** a zero-exit adapter declares diagnostics that are missing, unsafe, malformed, unknown, empty, secret-bearing, or out of bounds
- **THEN** hidden checks do not start and the receipt cannot record success
