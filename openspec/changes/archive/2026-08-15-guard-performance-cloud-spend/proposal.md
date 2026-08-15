## Why

CodeVetter's autonomous performance loop can execute project-owned test and
benchmark code, so a seemingly local profile can still contact deployed
applications or paid services. The profiler needs a machine-readable,
fail-closed execution policy before it can safely iterate without an operator
watching every run.

## What Changes

- Add an immutable performance-execution plan and receipt with exact duration,
  process concurrency, retry, external-request, external-service, and monetary
  bounds.
- Default autonomous profiling to a local zero-egress policy: one owned process,
  no retries, no remote requests, no paid services, and a bounded wall clock.
- Add a dry-run operation that reports whether the exact workload is admitted
  before project code executes.
- Reject browser flows without an explicit loopback-only target, workloads with
  remote or unknown-cost signals, and runtimes for which zero-egress enforcement
  is unavailable.
- Enforce Node-family zero-egress at runtime and emit a blocked/no-confidence
  receipt when the workload attempts remote network access.
- Keep hosted, load, soak, stress, and production profiling unsupported by the
  autonomous loop; this change does not modify Cloudflare or other production
  configuration.

## Capabilities

### New Capabilities

- `performance-execution-governance`: Defines immutable dry-run admission,
  local zero-egress execution, bounded receipts, and fail-closed treatment of
  hosted or unknown-cost workloads.

### Modified Capabilities

- `autonomous-optimization-campaigns`: Requires every campaign execution to be
  admitted by the local performance-execution policy before correctness or
  performance code runs.

## Impact

- Affects the repository-owned runtime profiler, campaign service, CLI/MCP
  contracts, focused tests, and local performance documentation.
- Adds no production dependency, hosted service, credential, database change,
  or production configuration.
- Existing explicitly invoked local profiles become stricter when their target
  has remote-network or unknown-cost evidence.
