# Native PR watcher live qualification

Date: 2026-09-01
Repository: `Codevetter/codevetter`
Pull request: `#190`
Head: `170fae78e9a16953f5c622cbdcfd219420959543`

## Result

An explicitly approved, one-PR `codevetter watcher` poll completed through the
shared Rust boundary with an isolated qualification database. It fetched the
exact GitHub PR head, created a detached sandbox worktree, installed the pnpm
workspace from its frozen lockfile, ran the strongest zero-argument-safe
repository check it could discover, persisted the canonical watcher receipt,
and posted the `codevetter/t-rex` commit status.

The final verdict was `NEEDS_REVIEW` at `0.6` confidence. `pnpm run lint`
completed successfully over 870 files, but no unit/e2e tests or browser steps
ran. The watcher therefore did not upgrade static evidence into runtime proof.

## Qualified boundaries

- GitHub's 40-character head identity is validated before it reaches Git.
- `refs/pull/190/head` is fetched with `--no-tags --no-write-fetch-head`.
- The user's branch, index, worktree, `FETCH_HEAD`, and durable refs are not
  changed by materialization.
- The exact head SHA, rather than a mutable remote branch name, is passed to
  `git worktree add --detach`.
- Existing `gh auth` can supply status authority in memory; no newly discovered
  token is written to evidence, logs, source, or the qualification database.
- Node installation follows the declared package manager and lockfile instead
  of unconditionally creating npm state.
- Only closed, zero-argument-safe script names are auto-selected: `test`,
  `test:unit`, `check`, `lint`, or `typecheck`.
- GitHub accepted the final `pending` status and the receipt retained
  `status_error: null`.
- A separately confirmed `watcher --operation retry --pr-number 190` reran the
  same unchanged head in 17,235 ms, retained a second attempt, and posted the
  corrected conservative status without weakening automatic deduplication.

## Executable proof

Focused Rust tests cover exact SHA validation, token-source selection, pnpm
command discovery, and a real local bare remote whose PR ref is absent from the
checkout until the watcher fetches it. The focused watcher and sandbox suites
passed with 24 tests and one intentionally ignored sandbox e2e test.

The clean full all-target Rust rerun passed 1,072 tests with no failures:
1,034 library tests, 27 CLI tests, five app tests, one MCP binary test, three
MCP stdio integration tests, and two additional binary-target tests. Thirty-one
library tests remain intentionally ignored. An earlier run had correctly found
one stale MCP stdio assertion expecting 24 tools after `capability_catalog` and
`resolve_evidence_scope` raised the canonical total to 26; the clean rerun
proves the corrected contract across the full suite.

## Remaining limits

- This PR changed a dependency and yielded static lint evidence only; it is not
  runtime proof for Tailwind 4 compatibility.
- Automatic polls skip an unchanged head after any persisted receipt. Recovery
  requires the explicit CLI/native Retry action and current-open-PR validation.
- The app-lifetime scheduler, owner interaction acceptance, signing,
  notarization, updater cutover, and Tauri retirement remain separate gates.
