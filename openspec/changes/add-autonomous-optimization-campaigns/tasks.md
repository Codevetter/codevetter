## 1. Campaign contracts and storage

- [x] 1.1 Add versioned manifest, experiment-record, status, and decision contracts with strict validation and bounded fields
- [x] 1.2 Implement contained campaign-directory resolution, canonical identities, atomic append-only ledger writes, and tamper detection
- [x] 1.3 Derive incumbent, remaining budgets, plateau/crash counters, and next action from durable records

## 2. Baseline and correctness composition

- [x] 2.1 Reuse closed adapters to execute every declared exact correctness scope and normalize authoritative outcomes
- [x] 2.2 Capture the exact performance baseline only after correctness passes and bind it to manifest, workload, revision, and diff identity
- [x] 2.3 Fail closed for unsupported adapters, skipped selections, incomplete evidence, changed manifests, or escaping targets

## 3. Candidate screening and promotion

- [x] 3.1 Implement correctness-first screening against the stored incumbent capsule with `promising`, `discard`, `crash`, and `no_confidence` decisions
- [x] 3.2 Implement paired promotion against independently runnable incumbent and candidate checkouts with exact workload identity and shipping sample policy
- [x] 3.3 Advance the incumbent only for correctness-preserving, materially useful, stable promotion evidence without protected regressions
- [x] 3.4 Record hypothesis, diff and evidence identities, measurements, complexity movement, decision basis, and limitations for every attempt

## 4. Machine and agent surfaces

- [x] 4.1 Add closed JSON CLI operations to initialize, baseline, screen, promote, inspect, and report campaign status
- [x] 4.2 Add repository-scoped MCP operations over the same campaign service without accepting shell commands or source patches
- [x] 4.3 Add a concise autonomous agent program that loops through inspect, one bounded hypothesis, external source edit, evaluation, and the recorded next action
- [x] 4.4 Document recovery, checkout isolation, local-compute budgeting, artifact cleanup, and the boundary between agent strategy and product evidence

## 5. Qualification

- [x] 5.1 Add hermetic tests for strict manifests, baseline gates, faster incorrect candidates, noisy screening, paired promotion, ledger immutability, resume, and stop conditions
- [x] 5.2 Run a complete multi-candidate campaign against a hermetic project and prove keep, discard, crash or no-confidence history without manual ledger edits
- [x] 5.3 Run the agent program against one dependency-light external local project, preserve only a verified improvement, and record negative attempts and resource cost
- [x] 5.4 Run the full runtime capsule tests, touched-file lint, docs validation, strict OpenSpec validation, package smoke, and diff checks
