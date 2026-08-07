## 1. Baseline and Receipt Contracts

- [x] 1.1 Define versioned CodeVetter verification plan and receipt contracts covering exact change identity, lanes, selection reasons, resource profile, timings, process/context peaks, cache state, and verdict.
- [x] 1.2 Add contract validation and redaction tests for complete, failed, cancelled, oversized, and malformed plan and receipt inputs.
- [x] 1.3 Add a resource-capped baseline harness that measures current focused and exhaustive Node, Playwright, and Rust lanes without running CPU-heavy lanes concurrently.
- [x] 1.4 Capture a checked initial CodeVetter baseline fixture with machine, revision, profile, cold/warm/cache state, wall time, CPU time, peak RSS, target bytes, and executed checks.

## 2. Exact Change and Blast-Radius Planning

- [x] 2.1 Add a checked CodeVetter lane map for frontend capabilities, browser spec files, Rust modules/targets, shared contracts, mandatory smoke, and broad fallbacks.
- [x] 2.2 Implement shell-free exact worktree, staged, commit, and range resolution by reusing the repository's existing bounded Git change-set contracts.
- [x] 2.3 Implement deterministic lane selection that combines authoritative mappings with bounded current graph, import, coverage, and blast-radius hints without allowing hints to narrow required work.
- [x] 2.4 Emit complete selection explanations for every selected, added, omitted, and fallback lane and return `no_confidence` for invalid or incomplete plans.
- [x] 2.5 Add planner tests for frontend leaves, shared shell, test/config, Rust leaves, IPC boundaries, lockfile changes, unmatched paths, and stale or truncated impact evidence.

## 3. Resource-Aware Execution

- [x] 3.1 Define checked interactive and exhaustive resource profiles with CPU-intensive slots, memory reservations, browser-context slots, target-origin tokens, and exclusive state identities.
- [x] 3.2 Implement a deterministic resource scheduler that preserves plan order, reports queue versus execution time, and releases every reservation after success, failure, timeout, or cancellation.
- [x] 3.3 Add scheduler tests proving independent waits overlap, CPU-heavy lanes do not overlap under the interactive profile, origin limits are enforced, exclusive state serializes, and cancellation leaves no reservation or process leak.
- [x] 3.4 Implement owned subprocess execution for existing Node, Playwright, Cargo, OpenSpec, and warm-verification commands with bounded output and stable lane verdicts.

## 4. Faster Warm Browser Verification

- [x] 4.1 Extend warm interaction evidence to separate Playwright actionability-and-dispatch, declared application or response settlement, assertion, and cleanup timings without claiming an unavailable public dispatch boundary.
- [ ] 4.2 Extend warm scenario scheduling with checked target-origin and exclusive-state resource declarations while retaining fresh contexts and deterministic result ordering.
- [x] 4.3 Expand CodeVetter's checked capability and scenario configuration beyond shell navigation to cover the representative UI surfaces needed by the change corpus.
- [ ] 4.4 Add browser-runtime tests for bandwidth throttling, independent context overlap, slow application attribution, actionability preservation, teardown, and bounded failure artifacts.
- [ ] 4.5 Replace fixed test waits only where the new measurements identify a deterministic visible-state or specific-response condition and verify equivalent failure behavior.

## 5. Selected-versus-Exhaustive Qualification

- [ ] 5.1 Create a versioned CodeVetter change corpus with exact source patches and expected invalidation boundaries for every planned change class.
- [ ] 5.2 Implement a qualification harness that runs selected and exhaustive verification serially under the same resource profile and compares complete verdicts and required coverage.
- [ ] 5.3 Fail qualification on any missed failing check, incomplete receipt, leaked process/context, source drift, or selected/exhaustive verdict mismatch and identify the missing impact edge.
- [ ] 5.4 Derive initial interactive concurrency and performance budgets from measured baselines; require representative warm UI leaf-change p95 at or below 1.5 seconds and at least 10x faster than the checked 16.3-second focused Playwright baseline; record wall-time, CPU-time, memory, target-byte, executed-check, and click-to-settle deltas without extrapolating beyond the corpus.
- [ ] 5.5 Run bounded research spikes for at least two materially different acceleration ideas under the same corpus and receipt contract, and retain only ideas that preserve required evidence and improve a measured dominant stage.

## 6. Repository Integration and Validation

- [x] 6.1 Add documented package commands for changed, exhaustive, baseline, and qualification modes while preserving every existing direct test command.
- [x] 6.2 Keep focused verification opt-in until the checked qualification corpus passes, then wire its qualification—not its focused shortcut—as a required CI safety gate.
- [x] 6.3 Document plan interpretation, resource profiles, exhaustive override, fallback reasons, troubleshooting, and rollback in the canonical verification documentation.
- [ ] 6.4 Run targeted contract, planner, scheduler, browser-runtime, and qualification tests under the interactive resource cap, followed by TypeScript, Biome, production build, docs validation, and strict OpenSpec validation.
- [x] 6.5 Record measured results, supported CodeVetter scope, remaining bottlenecks, and explicit cross-project non-claims before proposing any reusable external capability.
