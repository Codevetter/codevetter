## Why

CodeVetter is verified after increasingly frequent agent-authored changes, but its normal local commands still choose between broad, resource-intensive suites and a warm changed verifier configured for only one shell scenario. The repository needs to dogfood a cheaper verification loop that shortens feedback while proving that blast-radius selection and parallel execution do not hide regressions.

## What Changes

- Add one repository-owned CodeVetter changed-verification entrypoint that classifies the exact Git change, selects the smallest safe frontend, browser, and Rust verification lanes, and retains an explicit exhaustive override.
- Feed current blast-radius, import, coverage, and capability evidence into selection as bounded additive hints while preserving mandatory smoke, explicit mappings, and broad fallback.
- Replace fixed local concurrency assumptions with a resource-aware schedule bounded by CPU, memory, browser-context, target-origin bandwidth, and shared-state isolation budgets.
- Measure browser interactions as click-to-settle stages so locator, actionability, dispatch, application, network, assertion, and cleanup costs can be distinguished before behavior is optimized.
- Add a CodeVetter qualification corpus that compares selected verification with the exhaustive suite and records selection recall, wall time, CPU time, peak RSS, target bytes, cache state, and failure evidence.
- Require the representative warm UI changed path to reach at least a 10x wall-time improvement over the checked 16.3-second focused Playwright baseline (target p95 at or below 1.5 seconds) while retaining exhaustive verdict agreement; treat smaller worker-count improvements as diagnostics, not the product result.
- Keep an explicit experimental lane for measured alternatives such as dependency-aware scenario slicing, persistent page-state checkpoints, protocol-level observation, and response virtualization, but admit an idea only when it preserves actionability, isolation, and failure fidelity.
- Keep release and CI confidence fail-closed: untrusted, incomplete, stale, or mismatched selection evidence widens verification rather than skipping required checks.
- Keep a new browser driver, cross-repository productization, cloud execution, AI-authoritative selection, and cross-browser expansion out of this first CodeVetter-only slice.

## Capabilities

### New Capabilities

- `codevetter-verification-acceleration`: Defines the CodeVetter-specific changed-verification command, resource profiles, exhaustive comparison, and performance/correctness receipts used to dogfood faster testing.

### Modified Capabilities

- `changed-capability-verification`: Allows qualified blast-radius and test-impact evidence to add or rank verification work while keeping explicit capability mappings and safe fallback authoritative.
- `warm-local-verification-runtime`: Adds resource-aware browser scheduling and click-to-settle stage measurement to the existing warm server and Chromium runtime.
- `local-performance-governance`: Extends reproducible performance governance from dashboard/cache measurements to CodeVetter verification workflows and selection-versus-exhaustive comparisons.

## Impact

- Affected surfaces: repository package scripts, `.codevetter/verify.yaml`, warm-verification selection/scheduling/observation, blast-radius evidence adapters, Playwright configuration, qualification fixtures, CI wiring, and verification documentation.
- Existing Playwright, Node test, Cargo, and OpenSpec commands remain available as explicit full or targeted lanes.
- No production dependency, remote service, database migration, browser-engine replacement, or public cross-project contract is introduced in this slice.
- The current UI cleanup remains a separate dirty-worktree change and is not part of this proposal.
