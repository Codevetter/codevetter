## Why

Current `main` detects Playwright repositories but intentionally excludes their
flows from performance profiling and paired verification. A fresh Chess Coach
trial therefore found two exact browser tests yet stopped with “no
representative workload,” leaving React applications outside the compact
post-cleanup product.

## What Changes

- Accept one explicitly selected, repository-owned Playwright test as a local
  performance scope without treating every browser test as representative.
- Record the test-reported Playwright duration separately from process wall
  time, with repeated samples, exact test identity, and failure state.
- Compare two independently runnable checkouts with an alternating schedule and
  require the identical Playwright test to pass on every sample before reporting
  a timing improvement.
- Inspect an optional existing Vite build directory and report the bounded
  initial JavaScript closure and gzip bytes as unverified artifact evidence.
- Make the same Playwright scope available to the existing optimization
  campaign so CodeVetter—not an agent-authored spreadsheet—owns baseline,
  correctness, paired evidence, keep/reject policy, and receipts.
- Preserve explicit gaps for browser memory, render attribution, stale build
  artifacts, production impact, and automatic source mutation.

## Capabilities

### New Capabilities

- `compact-browser-performance-evidence`: Exact Playwright duration evidence,
  optional bounded Vite artifact evidence, and correctness-first paired browser
  verification on the compact current-main runtime.

### Modified Capabilities

None.

## Impact

- Extends the existing dependency-free runtime capsule, paired verifier,
  campaign, CLI/MCP contracts, and focused fixtures under
  `scripts/runtime-failure-capsule/`.
- Adds no production dependency, browser installation, package installation,
  cloud execution, application build, source mutation, or deployment.
- The implementation is constrained to fewer than 1,000 net new production
  lines; exceeding that bound requires stopping and redesigning rather than
  restoring the retired browser runtime.
