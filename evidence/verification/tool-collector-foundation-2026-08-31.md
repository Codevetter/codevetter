# Tool collector foundation qualification — 2026-08-31

## Scope

This receipt qualifies the unreleased `codevetter.tool-collection/v1` contract,
CLI wiring, and first Gitleaks adapter. It does not claim a sidecar is bundled or
that cargo-audit or Rust coverage executes in the product.

## Contract

- Input is one exact clean checked-out Git `base..head` range.
- Collector selection is explicit and duplicate selections are normalized.
- Product resolution accepts only an application-bundle sibling or an explicit
  debug/test qualification override; release builds exclude that override and
  arbitrary `PATH` discovery.
- Process launch uses no shell, a fixed minimal environment, null stdin,
  kill-on-drop, a 120-second timeout, a 256 KiB diagnostic limit, and an 8 MiB
  report limit. The JSON report is consumed from a private process pipe rather
  than written to a temporary file.
- Tool evidence records exact version, resolution source, and binary SHA-256.
- Gitleaks runs with 100% redaction. Only normalized rule, description,
  repository-relative file/line, commit, and fingerprint fields survive;
  upstream `Secret` and `Match` fields are not represented by the Rust type.
- Every normalized finding must map to a commit and changed path in the resolved
  source receipt or the collector returns an error.
- A finding exits 1, unavailable/error exits 2, and only fully clean collection
  exits 0. These are CLI collection outcomes, not the overall CodeVetter
  verification verdict.

## Automated evidence

Focused Rust tests prove that raw fixture secret and match values cannot enter
serialized receipts, missing product tools stay explicitly unavailable, and
CLI parsing requires a range plus supported explicit collectors.

The local 8.30.1 Gitleaks binary was then exercised through the compiled CLI on
a disposable clean Git repository:

| Trial | Observed result |
|---|---|
| Safe one-commit range | `clean`, zero findings, exit 0, 355 ms collector duration |
| Controlled custom-rule finding | `findings`, one normalized finding, exit 1, 383 ms collector duration |
| Missing cargo-audit and cargo-llvm-cov | both `unavailable`, exit 2 |

The Gitleaks receipt recorded SHA-256
`f414bc2fb952be6c9072b75cb411e3368614ef4b16d48dbd9ad238034afd2302`.
The controlled finding receipt contained the rule, relative path, line, commit,
and fingerprint, but not the matched fixture value or surrounding match.

## Remaining gates

- Pin, qualify, declare, sign, and smoke-test sidecar artifacts inside final app
  bundles before claiming shipment.
- Package an offline RustSec advisory database before cargo-audit execution.
- Require the Rust LLVM tools component and implement LCOV changed-executable-
  line accounting before cargo-llvm-cov execution.
- Compose collector evidence into CodeVetter's existing overall verdict policy;
  do not substitute scanner exit codes for that policy.

Issue #198 owns these gates.
