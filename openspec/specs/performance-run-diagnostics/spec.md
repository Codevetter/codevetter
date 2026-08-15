# performance-run-diagnostics Specification

## Purpose
Ensure incomplete performance runs contain enough bounded runtime evidence for an agent to distinguish a broken workload from a profiler or runner compatibility problem.
## Requirements
### Requirement: Failed passes retain bounded redacted evidence
Each unsuccessful warmup, measurement, metrics, profile, or coverage execution SHALL report its phase, index, terminal state, duration, workload-selection state, and bounded redacted operational error, stdout, and stderr. Successful executions SHALL omit failure output.

#### Scenario: Profiler option is unsupported
- **WHEN** a profiling pass exits non-zero because the installed runner rejects an option
- **THEN** the performance capsule includes the bounded redacted runner error on that exact pass
- **AND** the diagnosis remains `no_confidence`

#### Scenario: Failure output contains a credential-shaped value
- **WHEN** failed process output contains a token or repository path
- **THEN** retained failure evidence contains redaction markers and no raw sensitive value

### Requirement: Bounded output does not erase confirmed selection
Every execution summary SHALL record whether bounded output directly confirms that the requested workload ran. For repeated successful Vitest passes, CodeVetter MAY accept one exact passed-selection confirmation for the fixed command when another successful JSON report was truncated, but MUST NOT accept a zero-match or failed execution as complete.

#### Scenario: Exact Vitest JSON is truncated
- **WHEN** measurement JSON exceeds the output bound but a successful metrics or profile pass confirms the exact test identity
- **THEN** CodeVetter treats selection as confirmed while disclosing output truncation

#### Scenario: No pass confirms the exact identity
- **WHEN** every bounded report lacks evidence that the selected test ran
- **THEN** the performance capsule remains `no_confidence` even if processes exited zero
