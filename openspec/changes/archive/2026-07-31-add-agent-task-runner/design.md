## Context

Qualification now owns safe task-package loading, public workspace
materialization, immutable driver execution, and exact check-result contracts.
The runner should compose those authorities without exposing withheld material
to an adapter or coupling the corpus to Codex, Claude, or a hosted provider.

## Goals / Non-Goals

**Goals:**

- Produce a useful deterministic plan before any mutable or secret-reading
  action.
- Make launch and paid-cost approval explicit for one exact attempt.
- Bound and redact adapter execution while guaranteeing process termination and
  workspace cleanup.
- Preserve task, adapter, environment, lifecycle, check, and cleanup evidence
  in a closed receipt.

**Non-Goals:**

- Integrate a real provider, invoke a model, or perform a paid run.
- Claim OS-level sandboxing against a malicious adapter.
- Persist approvals, schedule concurrent runs, or add a desktop UI.
- Project receipts into the structural-context evaluator.

## Decisions

### Version adapters and receipts instead of mutating v1

V2 adapters add immutable executable artifacts and conservative planning
inputs. V2 receipts add plan, fixture, acceptance, lifecycle, termination, and
redacted-output identities. The dependency-free validator dispatches by
`schema_version`, preserving v1 readers.

### Treat the dry-run plan as the approval object

The plan identity hashes canonical task, adapter, environment-availability,
input-size, timeout, token, and cost fields. Execution requires that exact ID;
paid adapters require an additional flag. Each invocation represents one
attempt, so approval cannot silently authorize a retry.

Planning checks only membership in the supplied available-name set. It does not
read values, create a workspace, resolve temporary paths, or run either process.

### Use closed placeholders and immutable artifacts

V2 command arguments permit only `{node}`, `{adapter_root}`, `{workspace}`, and
`{task_packet}`. Every adapter-root file referenced by the command must be a
declared regular artifact with an exact SHA-256. Execution uses Node
`spawn(..., { shell: false, detached: true })`.

### Terminate before checking

The agent process and its owned process group reach a terminal exit, timeout,
or cancellation state before the check driver can start. Checks run only on
exit zero. Timeout, cancellation, setup failure, agent failure, and cleanup
failure never execute hidden checks.

### Retain hashes and redacted bounded text, not raw output

The runner caps stdout and stderr independently, replaces declared environment
values plus credential-like assignments, and returns only bounded redacted
text. The receipt keeps SHA-256 identities, byte counts, and truncation state;
it never stores raw output, environment values, temporary paths, or commands
after placeholder resolution.

## Risks / Trade-offs

- **Process groups vary by platform** → Use detached POSIX groups with a direct
  child fallback; keep the lifecycle logic injectable for focused tests.
- **A trusted adapter can escape the directory** → State the boundary honestly;
  OS sandboxing is a later runner-hardening slice.
- **Token estimation is approximate** → Label it conservative and use declared
  overhead/output reserves plus a hard maximum-cost gate.
- **Synthetic proof is not provider proof** → Keep the sample named synthetic
  and do not check real-provider or corpus-breadth criteria.

## Migration Plan

Add v2 schemas and readers alongside v1, add one synthetic adapter under the
owned sample, and exercise it only in focused tests/explicit CLI commands.
Rollback removes v2 planning/execution while leaving qualification and v1
contracts intact. No database, production, or external state changes.
