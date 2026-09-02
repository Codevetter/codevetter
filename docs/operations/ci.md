---
title: CI
description: What the GitHub Actions CI workflow checks and in what order.
sidebar:
  order: 3
---

# CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request.

## Job: `lint-and-typecheck` (ubuntu-latest)

Steps, in order (a failure stops the job):

1. SHA-pinned `actions/checkout` with persisted credentials disabled
2. SHA-pinned `pnpm/action-setup` + `actions/setup-node` (Node 22, pnpm cache)
3. SHA-pinned `dtolnay/rust-toolchain`
4. Install Tauri Linux deps (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`)
5. `pnpm install --frozen-lockfile`
6. **Lint** — `pnpm run lint` in `apps/desktop` (Biome)
7. **Type check** — `pnpm exec tsc --noEmit` in `apps/desktop`
8. **Unit tests** — `pnpm run test:unit` in `apps/desktop`
9. **Automation readiness tests** — `pnpm run test:automation` and
   `pnpm run test:corpus-contracts` at root (hermetic Foundry receipt
   sanitization plus agent-task contract, qualification, dry-run/approval,
   disposable runner, timeout/cancellation, output-redaction, cleanup, and
   deterministic receipt-composition/rescoring tests; the live manifest
   verifier runs in `release.yml` as a post-upload check, not here)
10. **MCP sidecar build smoke** — `pnpm run prepare:mcp-sidecar`
11. **CLI sidecar build smoke** — `pnpm run prepare:cli-sidecar`
12. **CLI artifact qualification** — focused script tests plus
    `pnpm run qualify:cli` execute the prepared binary and verify its exact
    version/help surface and both Tauri bundle declarations
13. **Desktop build** — `pnpm run build` (Vite production build)
14. **MCP protocol and safety tests** — Rust library, binary, and stdio integration tests
15. **T-Rex CLI contract tests** — browser-feature parser, output, and exit-code tests
16. **MCP and history browser tests** — Settings and Repo Unpack Playwright coverage

## Other workflows

| Workflow | Trigger | Purpose | Doc |
|---|---|---|---|
| `auto-release.yml` | push to `main` on `tauri.conf.json` version bump | cut `v<version>` release + dispatch `release.yml` | [release-pipeline.md](./release-pipeline.md) |
| `release.yml` | `release.created` or `workflow_dispatch` | build/sign/upload Tauri binaries + `latest.json` | [release-pipeline.md](./release-pipeline.md) |
| `native-qualification.yml` | `workflow_dispatch` (manual) | qualify the unsigned native macOS preview and optionally run XCUITest on an isolated hosted desktop | [../development/native-macos.md](../development/native-macos.md) |
| `deploy-landing.yml` | `workflow_dispatch` (manual) | deploy Astro site to Cloudflare Pages | [landing-deploy.md](./landing-deploy.md) |
| `weekly.yml` | cron `0 9 * * 1` (Mon 09:00 UTC) + `workflow_dispatch` | lockfile-agnostic quality check (lint/typecheck/test/build if defined) | [jobs/weekly-quality.md](./jobs/weekly-quality.md) |
| `docs.yml` | push/PR | doc link + structure validation | [../development/docs.md](../development/docs.md) |
| `repository-security.yml` | push to `main`/PR/manual | actionlint + ShellCheck, Biome SARIF, cargo-deny Rust policy, full-history Gitleaks, and zizmor code-scanning uploads | [../knowledge/tooling-decisions.md](../knowledge/tooling-decisions.md) |
| `osv-offline.yml` | manual | explicit OSV database refresh followed by a separate offline lockfile scan and evidence upload | [../knowledge/tooling-secrets-and-supply-chain.md](../knowledge/tooling-secrets-and-supply-chain.md) |

`repository-security.yml` uses no application dependency. Gitleaks, actionlint,
ShellCheck, and cargo-deny are checksum-pinned binaries; every third-party
action is pinned to a commit; and job permissions are declared narrowly.
Publish jobs do not use dependency or toolchain caches, so an offline pedantic
zizmor review has no unsuppressed security findings. Its two remaining
informational suggestions prefer runner shell commands over the pinned Rust
toolchain setup action; the maintained, commit-pinned action is retained
deliberately.

Run `pnpm quality:workflows` when actionlint is installed. It parses every
workflow, validates GitHub expression and event semantics, and delegates shell
fragments to ShellCheck. The first qualified audit and exact artifact identities
are recorded in [the tracked evidence](https://github.com/Codevetter/codevetter/blob/main/evidence/security/actionlint-baseline-2026-08-31.md).

## Local pre-commit / pre-push

- **pre-commit** (`.husky/pre-commit`): `lint-staged` → `biome check --write` on staged `apps/desktop/src/**/*.{ts,tsx}`, then Gitleaks staged-diff scanning when the binary is installed.
- **pre-push** (`.husky/pre-push`): `pnpm run lint`, then full-history Gitleaks. A limited tracked-file pattern scan remains as a fallback for contributors without the binary; CI always uses Gitleaks.

Generate a local Biome SARIF 2.1.0 artifact at
`artifacts/tooling/biome.sarif` with `pnpm quality:sarif`. Generated artifacts
remain ignored scratch; the workflow uploads them to GitHub code scanning.

Run `pnpm quality:vulnerabilities` after explicitly refreshing the OSV databases.
The scan itself is offline and produces `artifacts/tooling/osv/results.sarif`
plus a receipt containing scanner, source, and database identities. Exit `1`
means findings; exit `2` means the scanner or evidence path failed. This is not
yet a push/PR gate because the measured baseline must be remediated rather than
silently accepted. The manual workflow remains red while findings exist.
