## 1. Contracts and Baselines

- [ ] 1.1 Record manual scenario-authoring time and quality for representative specs before adding generation.
- [ ] 1.2 Define bounded versioned compiler-input, intermediate-representation, candidate, provenance, validation, dry-run, cost, and acceptance contracts.
- [ ] 1.3 Add rejection fixtures for oversized input, secret-bearing context, raw executable output, unknown fields, duplicates, unsafe paths, and unsupported action/assertion kinds.
- [ ] 1.4 Define the ignored candidate directory, count/byte/age limits, atomic cleanup, and compatibility policy without changing accepted scenario storage.

## 2. Deterministic Compilation Pipeline

- [ ] 2.1 Build normalized spec/context packaging with content hashes and explicit capability, auth, state, route, request-policy, and example selection.
- [ ] 2.2 Add a short-lived provider boundary with free/local-first selection, explicit paid-provider approval, cancellation, timeouts, redaction, and usage metadata.
- [ ] 2.3 Parse provider output into the strict intermediate representation without evaluating or importing returned code.
- [ ] 2.4 Emit stable TypeScript scenario, named-state requirement, capability-map suggestion, negative-case, and provenance candidates through owned templates.
- [ ] 2.5 Cache candidates by compiler/input/target/config/manifest/provider/prompt identities without changing their unaccepted status.

## 3. Qualification and Acceptance

- [ ] 3.1 Validate candidate schema, imports, identifiers, paths, capabilities, auth/state references, request policies, budgets, and unresolved requirements.
- [ ] 3.2 Run candidates in an isolated bounded deterministic dry-run that cannot persist pass evidence or update visual baselines.
- [ ] 3.3 Add candidate diffs, unresolved requirements, validation results, dry-run evidence, provider/cost metadata, and accept/reject controls to T-Rex.
- [ ] 3.4 Atomically publish only explicitly accepted destinations, refuse drift or replacement without renewed approval, and record accepted file hashes.
- [ ] 3.5 Add CLI generation, inspect, validate, dry-run, accept, reject, and cleanup commands with stable bounded JSON/text outcomes.

## 4. Safety and Correctness Proof

- [ ] 4.1 Prove compiler/provider modules remain unreachable from daemon, selection, scenario loading, and normal execution, which retain zero call counts.
- [ ] 4.2 Add provider fixtures for valid, malformed, malicious, partial, cancelled, timed-out, over-budget, and cached responses.
- [ ] 4.3 Add acceptance tests for new files, existing-file conflicts, source/config/manifest drift, unresolved state, dry-run failure, and rollback after atomic-write failure.
- [ ] 4.4 Prove prompts, provenance, candidates, logs, and diagnostics never retain credentials, auth storage state, cookies, environment values, or unbounded repository content.

## 5. Performance, Cleanup, and Documentation

- [ ] 5.1 Benchmark generation latency, dry-run latency, cache hits, structured-output success, accepted-candidate quality, and local/free versus paid provider trade-offs.
- [ ] 5.2 Run a cleanup gate across compiler contracts, emitters, provider adapters, storage, CLI, and T-Rex; remove duplicate schemas/helpers and report production/test LOC.
- [ ] 5.3 Document spec authoring, context selection, providers/privacy/cost, candidate review, unresolved requirements, dry runs, acceptance, conflicts, cleanup, and rollback.
- [ ] 5.4 Run formatting, typecheck, lint, unit/integration/browser tests, security/license checks, OpenSpec strict validation, and production builds before sync/archive.
