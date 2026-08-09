## Why

CodeVetter can prove that a verification failed, but its machine interfaces do
not yet turn the common failure into a compact explanation tied to the current
change. The Fleet's deployed projects concentrate around Node/TypeScript,
React/browser behavior, Cloudflare Worker request handlers, and a narrow Go
HTTP lane, so a small evidence model and a few runtime adapters can cover the
high-frequency cases without becoming a universal debugger.

## What Changes

- Add a versioned, bounded Runtime Failure Capsule that separates captured
  observations, deterministic source/diff relationships, inferred hypotheses,
  and explicit limitations.
- Detect the supported runtime lanes present in a repository: Node tests,
  browser/Playwright evidence, Cloudflare Worker tests, and Go tests.
- Execute one exact Node or Go diagnostic test scope without a shell, retain
  bounded redacted output, and classify non-reproduction or incomplete capture
  as `no_confidence`.
- Normalize already-produced browser and Worker failure receipts into the same
  capsule instead of introducing another browser or Worker runtime.
- Rank original source frames and changed lines deterministically without
  claiming a root cause or asking a model to create evidence.
- Add a small cross-runtime fixture corpus and machine-readable CLI so the
  power-law coverage claim can be measured before desktop or MCP integration.

## Capabilities

### New Capabilities

- `runtime-failure-capsules`: Defines supported runtime lanes, bounded
  diagnostic execution, normalized evidence, source/diff correlation,
  redaction, confidence states, and machine-readable output.

### Modified Capabilities

None. Existing T-Rex, warm verification, differential verification, Synthetic
QA, review, CLI, and MCP contracts remain unchanged in this first slice.

## Impact

- Adds a dependency-free repository CLI and library under
  `scripts/runtime-failure-capsule/` plus focused Node and Go fixtures.
- Adds root package scripts for diagnosis and targeted tests.
- Reads repository manifests, Git diff metadata, and explicitly selected test
  files; it does not modify target repositories or read environment values.
- Reuses existing browser/Worker receipts as inputs and preserves their
  authoritative verdicts and limitations.
- Adds no production dependency, database migration, desktop route, hosted
  service, MCP mutation, deployment, or production observability ingestion.
