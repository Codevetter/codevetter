## 1. Define the T-Rex direct-run contract

- [x] 1.1 Add typed PR/range source, preview identity, route plan, journey result, verdict, and receipt contracts in Rust and TypeScript.
- [x] 1.2 Validate canonical GitHub PR URLs, bounded Git ranges, HTTP(S) preview URLs, and stable receipt fields.
- [x] 1.3 Add contract tests for invalid targets, unsafe revisions, preview credentials, and verdict aggregation.

## 2. Resolve exact source and preview identity

- [x] 2.1 Resolve a matching GitHub PR through read-only `gh api` calls into exact base/head identities and bounded changed paths.
- [x] 2.2 Resolve local `base..head` and `base...head` ranges through shell-free Git commands without changing the checkout.
- [x] 2.3 Derive a bounded route plan from conventional TypeScript/Node route paths and record unmapped or dynamic limitations.
- [x] 2.4 Probe explicit preview revision headers and classify `verified`, `claimed`, or `mismatch`.
- [x] 2.5 Add focused resolver, route-planner, and preview-identity tests.

## 3. Execute and persist one T-Rex receipt

- [x] 3.1 Reuse the built-in `generic-page-smoke` Synthetic QA loop for each selected preview route with remote read-only execution.
- [x] 3.2 Aggregate journey evidence into `passed_with_limits`, `failed`, or `no_confidence` without a model verdict.
- [x] 3.3 Persist canonical receipt JSON and summary columns in an additive `trex_preview_runs` table.
- [x] 3.4 Add Tauri commands to run verification and list recent direct runs.
- [x] 3.5 Add Rust tests for aggregation, persistence mapping, output bounds, and failure preservation.

## 4. Add the preserve-lane T-Rex direct-run UI

- [x] 4.1 Add typed IPC wrappers for execution and recent-run retrieval.
- [x] 4.2 Add a compact direct-run card above existing T-Rex expert panels with PR/range selection, source input, preview URL, and one primary action.
- [x] 4.3 Render running, passed-with-limits, failed, no-confidence, preview-identity, route, limitation, artifact, and error states without color-only meaning.
- [x] 4.4 Preserve watcher, warm verification, differential verification, scenario compilation, refresh, and narrow-screen behavior.
- [x] 4.5 Add focused Playwright coverage for input validation, invocation shape, success limitations, mismatch, failure evidence, and existing-panel compatibility.

## 5. Document and qualify the first slice

- [x] 5.1 Document the T-Rex change-plus-preview workflow, supported targets, preview identity, verdict semantics, and deferred boundaries.
- [x] 5.2 Add the new page to the canonical docs navigation without duplicating implementation facts.
- [x] 5.3 Run focused Rust and Playwright tests, TypeScript, touched-file Biome, docs validation, strict OpenSpec validation, and `git diff --check`.
- [x] 5.4 Capture preserve-lane screenshots at 390, 768, and 1440 pixels; complete critique, polish, audit, detector, and design-workflow receipt.
- [x] 5.5 Record unsupported standalone applications, arbitrary repository cloning, installs, authenticated mutation, base-preview comparison, MCP, and richer autonomous journeys as deferred work.

## 6. Add one shared CLI verification path

- [x] 6.1 Refactor direct T-Rex execution into a transport-neutral Rust service shared by Tauri and the CLI.
- [x] 6.2 Add a native-Chrome generic smoke adapter for release UI/CLI builds with bounded text, console, screenshot, timing, and cleanup evidence.
- [x] 6.3 Add the dependency-free `codevetter trex` binary with exclusive PR/range parsing, current-directory default, human and JSON output, and deterministic exit codes.
- [x] 6.4 Persist CLI receipts to the same local CodeVetter database and add focused parser, output, exit-code, and shared-receipt tests.

## 7. Package, register, and qualify the CLI

- [x] 7.1 Prepare and bundle the target-triple `codevetter` sidecar through existing release scripts without adding a production dependency.
- [x] 7.2 Register `~/.local/bin/codevetter` atomically on installed macOS app launch while skipping development launches and preserving collisions.
- [x] 7.3 Add installer/link tests plus release-bundle assertions for both `codevetter` and `codevetter-mcp`.
- [x] 7.4 Update canonical workflow, development, and release docs with command examples, PATH qualification, prerequisites, and uninstall behavior.
- [x] 7.5 Run focused Rust/default and browser-feature tests, CLI smoke, TypeScript/Biome, docs validation, strict OpenSpec validation, design-review check, and `git diff --check`.
