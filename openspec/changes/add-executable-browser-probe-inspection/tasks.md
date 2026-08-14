## 1. Durable Probe Identity

- [x] 1.1 Add exact server-request ordinal to the pre-commit route finding and compact next-probe contract
- [x] 1.2 Increment the Playwright diagnosis schema and cover missing, invalid, and duplicate request identities

## 2. Probe Inspection

- [x] 2.1 Add a contained capture-identity loader that validates receipt, result digest, compact diagnosis, and source snapshot
- [x] 2.2 Implement the closed probe-family to request-evidence and source-candidate projection
- [x] 2.3 Preserve stale, unsupported, empty-candidate, failed-correctness, privacy, and authority boundaries
- [x] 2.4 Cover main-thread, Worker, libuv, response-linked async, contextual-route, mismatch, tamper, and source-drift cases

## 3. Agent-Facing Operations

- [x] 3.1 Add a read-only `inspect-browser-probe` repository CLI operation
- [x] 3.2 Add the equivalent `inspect_browser_probe` runtime MCP operation and closed schema
- [x] 3.3 Prove CLI/MCP parity, argument rejection, and no application execution during inspection

## 4. Product Proof

- [x] 4.1 Replay and inspect an unchanged real browser capture through the product operation
- [x] 4.2 Document the operation, correlation boundaries, and remaining unsupported probe families
- [x] 4.3 Run focused tests, full runtime tests, lint, docs validation, diff checks, and strict OpenSpec validation
