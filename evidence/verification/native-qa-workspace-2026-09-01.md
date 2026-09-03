# Native QA workspace receipt

Date: 2026-09-01
Scope: saved journey parity, Playwright spec discovery, and post-fix setup

## Result

Native Testing, `codevetter qa`, and the repository-scoped MCP server now
consume one Rust-owned `codevetter.qa-workspace/v1` receipt. The same service:

- reads repository-scoped saved workflows and targets;
- projects legacy data into a separate native preference without rewriting the
  incumbent keys;
- omits credential-bearing storage-state paths and scrubs invalid or embedded-
  credential preview URLs;
- leaves arbitrary external-command workflows read-only and refuses to execute
  them from native Testing;
- discovers at most 60 repository Playwright specs without running project
  code;
- prepares the same pre-fix flow for a deterministic post-fix comparison; and
- never restores preview network consent or starts browser execution.

Selecting a saved target passes its exact route and goal to `codevetter trex`.
The Rust T-REX core deduplicates that route against changed-path discovery,
keeps the required root smoke, bounds the route portfolio, and records the
selected goal in the executable journey receipt.

The MCP `qa_workspace_inspect` tool is read-only. Workflow and target mutations
remain explicit native/CLI actions; browser execution remains an explicit
Testing action.

## Verification

- 4 focused Rust QA-workspace safety and compatibility tests pass.
- The selected-target route/goal contract test passes.
- The `codevetter qa` parser test passes.
- 6 focused MCP server tests and all 3 stdio boundary tests pass with 28 strict
  read-only tools.
- 65 serialized Swift package tests pass, including exact target handoff,
  post-fix stale-proof invalidation, and consent reset; the macOS Debug app
  build passes.
- Strict recursive Swift formatting passes.
- Offscreen true-black render:
  `evidence/design/native-acceptance-2026-09-01/qa-journey-workspace.png`
  (`2360x1520`, SHA-256
  `dcb8f5d1ff4669af79e4685ec04c378e446f5f9f95beb478642ab128902574e6`).

## Remaining boundary

This receipt does not prove a real application post-fix rerun, authorize a
remote preview, qualify arbitrary external commands or credential migration,
approve the visual design, retire Tauri, or authorize release.
