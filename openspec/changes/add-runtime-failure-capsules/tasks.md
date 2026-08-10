## 1. Failure capsule foundation

- [x] 1.1 Add the versioned Runtime Failure Capsule contract, bounded redaction, and deterministic source-frame normalization
- [x] 1.2 Detect Node test, Vitest, Playwright, Cloudflare Worker, and Go test lanes from repository-owned files
- [x] 1.3 Parse Git diffs and rank exact changed frames ahead of same-file proximity without asserting root cause

## 2. Runtime adapters and CLI

- [x] 2.1 Implement shell-free bounded process execution for the closed Node test, Vitest, Playwright, and Go test adapters
- [x] 2.2 Normalize adapter failures and existing browser or Worker receipts into observed, inferred, and unverified capsule sections
- [x] 2.3 Add stable detect, run, and import CLI operations with fail-closed exit codes and root package scripts

## 3. Qualification

- [x] 3.1 Add hermetic tests for lane detection, redaction, diff correlation, and imported evidence
- [x] 3.2 Add real failing Node and Go adapter fixtures with capsule assertions and safe conditional runner availability
- [x] 3.3 Run focused unit tests, CLI smoke tests, lint, documentation validation, OpenSpec strict validation, and diff checks
