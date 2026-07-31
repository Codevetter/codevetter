## 1. Verification MCP design

- [x] 1.1 Document the separate verification MCP process, fixed repository
  scope, exact tool inputs, canonical receipt output, and local-write boundary.
- [x] 1.2 Update T-Rex product docs so the current read-only MCP and future
  execution projection are not conflated.

## 2. CLI artifact qualification

- [x] 2.1 Add a reusable shell-free script that validates prepared or bundled
  CLI executables, version/help contracts, and Tauri bundle declarations.
- [x] 2.2 Run the check after CLI preparation in CI and against the final
  macOS app bundle during release qualification.
- [x] 2.3 Add focused script tests for success and contract drift.

## 3. Delivery

- [x] 3.1 Update project status and issue #52 with the completed design and
  automated qualification boundary.
- [x] 3.2 Run focused tests, lint, typecheck, docs, workflow checks, and strict
  OpenSpec validation.
- [x] 3.3 Archive the change and deliver the scoped progress through a linked
  pull request without claiming the operator-owned release/live smoke.
