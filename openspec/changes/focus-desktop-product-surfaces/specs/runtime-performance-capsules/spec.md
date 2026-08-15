## ADDED Requirements

### Requirement: Desktop invokes performance operations through a closed local bridge

CodeVetter SHALL expose planning, profiling, diagnosis, inspection, and paired-verification operations to the desktop through typed closed inputs. The bridge MUST reuse the existing runtime contracts, enforce repository containment and zero-egress policy before execution, stream bounded progress, and return versioned receipts without accepting arbitrary commands.

#### Scenario: Desktop requests a bounded profile

- **WHEN** Performance submits a qualified exact scope
- **THEN** the local bridge invokes the existing profiler with separated arguments and returns the same validated capsule shape available through CLI and MCP

#### Scenario: Required runtime is unavailable

- **WHEN** the selected adapter's local runtime or packaged CodeVetter operation is unavailable
- **THEN** the bridge returns `no_confidence` diagnostics without starting a partial workload or fabricating measurements

