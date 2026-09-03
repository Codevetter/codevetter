# Native verification application-service qualification

Date: 2026-09-01
Scope: Review plan, execute, progress, cancellation, and terminal receipt transport

## Result

Native Review and `codevetter check` now enter one Tauri-independent Rust
application service instead of independently assembling the verification
lifecycle. One bounded request id correlates:

- `codevetter.verification-command/v1` input;
- monotonic `codevetter.progress/v2` events;
- request-scoped `codevetter.verification-cancel/v1` termination; and
- the distinct canonical preflight or final local-check receipt.

The Rust service still delegates source identity, target discovery, execution,
persistence, verdicts, and limitations to the existing authoritative engines.
Swift owns process supervision and rendering only.

## Executable proof

- a real clean-clone `codevetter check --preflight --request-id
  native-service-live-smoke --json` returned `ready`, preserved the exact
  request id, and resolved immutable base/head SHAs;
- the same command against the dirty migration worktree failed closed before
  producing a receipt;
- Rust service tests cover bounded/generated request ids, progress ordering,
  cancellation identity, and a real two-commit Git preflight through the
  service;
- all 28 CLI tests cover parsing, progress-v2 serialization, shared-fixture
  receipt/exit parity, and existing
  output/exit semantics;
- Swift tests prove exact CLI arguments, matching progress and receipt
  decoding, foreign-progress rejection, foreign-cancellation refusal,
  matching cancellation without a receipt, mismatched-receipt rejection,
  1,000-event throughput, and worker crash recovery;
- the final native background gate passed 61 Swift tests and the macOS Debug
  application build;
- the final all-target Rust regression passed 1,077 tests with 31 intentional
  ignores and no failures; and
- the fresh Release host and package qualifier passed at
  `artifacts/native-package/qualification-XrpqmY/CodeVetter.app`.

No test failure is waived by this receipt.

## Authority boundary

MCP remains read-only and does not gain Review execution or cancellation
authority. It can now retrieve one already-persisted canonical local-check
receipt by bounded run id inside its authorized repository scope. Cancellation
is a supervised transport terminal action rather than a persisted engine
event. This contract does not imply a daemon, concurrent multi-run scheduler,
release authorization, or Tauri retirement.
