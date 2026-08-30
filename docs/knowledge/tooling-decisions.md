---
title: Third-party tooling decisions
description: What CodeVetter embeds instead of building, what it refuses, and why — the hub page for per-category evaluations.
sidebar:
  order: 10
---

# Third-party tooling decisions

CodeVetter should embed proven tools rather than reimplement them, but the
product's positioning narrows the field hard. Two constraints disqualify most
of the market before features are even considered:

1. **Privacy is the product.** CodeVetter verifies code on the user's machine.
   Any tool that transmits source, manifests, or lockfiles to a third party is
   rejected regardless of quality.
2. **Local-first and offline.** The desktop app works without a network. Tools
   requiring a hosted engine, an account, or a live API are rejected.

A third constraint governs licensing: this is a commercial desktop product that
**redistributes** what it bundles. AGPL, SSPL, and non-commercial licenses are
blockers. MPL and GPL are subprocess-only at best.

Research verified **2026-08-30**. Licensing, pricing, and maintenance facts
decay — re-check before acting on anything here. Items the research could not
confirm are marked UNVERIFIED on the detail pages and should be treated as open
questions, not findings.

## Status vocabulary

- **Approved** — qualified for a bounded lane, but not executable there yet.
- **Trialled** — exercised against this repository with measured output, but not
  part of a maintained path.
- **Wired** — invoked by a tracked local command, hook, workflow, or product
  adapter.
- **Rejected** — disqualified for the named lane. Rejection in the private
  customer-code product lane does not automatically reject a public-repository
  maintainer aid.

## Product adoption

| Tool | License | Surface | Category detail |
|---|---|---|---|
| `cargo-audit` (via `rustsec` crate) | MIT OR Apache-2.0 | In-process in `src-tauri/` | [supply chain](./tooling-secrets-and-supply-chain.md) |
| `gitleaks` | MIT | Sidecar binary | [supply chain](./tooling-secrets-and-supply-chain.md) |
| `cargo-llvm-cov` | MIT OR Apache-2.0 | Sidecar binary | [coverage](./tooling-coverage.md) |
| `lcov` crate | MIT OR Apache-2.0 | In-process parser | [coverage](./tooling-coverage.md) |
| τ³-bench (tau2-bench) | MIT | Corpus under `benchmarks/` | [agent benchmarks](./tooling-agent-benchmarks.md) |
| Terminal-Bench 4.0 (Harbor) | Apache-2.0 | Corpus under `benchmarks/` | [agent benchmarks](./tooling-agent-benchmarks.md) |
| `libkrun` | Apache-2.0 | In-process VMM in `src-tauri/` | [sandboxing](./tooling-sandboxing.md) |

These are product-lane decisions, not implementation receipts. In particular,
Gitleaks is now **wired** for this repository's hooks and CI, while bundling it
as a signed desktop sidecar remains **approved** work.

## Repository and maintainer tooling

| Tool | Status | Bounded use |
|---|---|---|
| DeepWiki MCP | Wired | Maintainer questions about this public repository; a new Codex session is required after MCP configuration changes |
| GitHub CodeQL default setup | Wired | GitHub-hosted scanning of this public repository only |
| Biome SARIF | Wired | Local artifact generation plus code-scanning upload |
| Gitleaks 8.30.1 | Wired | Staged-change hook, full-history local check, and checksum-pinned CI binary |
| zizmor 1.29 / action 0.6.2 | Wired | Offline local workflow audit plus GitHub code-scanning upload |
| actionlint 1.7.12 + ShellCheck 0.11.0 | Wired | Workflow syntax/semantics and embedded-shell validation; checksum-pinned CI binaries and local `pnpm quality:workflows` command |
| cargo-deny 0.20.2 | Wired | Offline Rust license, source, wildcard-requirement, and duplicate-version policy; native SARIF for actionable policy violations |
| ast-grep 0.45.2 | Trialled, not wired | Structural locations were correct, but native `--format sarif` emits an invalid root format version; no missing-rule case justifies a converter yet |
| Trivy 0.74.0 config scan | Trialled, not wired | Embedded checks found no supported first-party IaC surface; the unbounded scan targeted a dependency Dockerfile and the bounded scan misclassified a JSON fixture |
| OSV-Scanner 2.5.1 | Repository runner wired | `pnpm quality:vulnerabilities` produces offline SARIF plus a database-identity receipt; the 35-package baseline and remediation are tracked in issue #195 |
| StrykerJS 10.0.0 | Bounded local command wired | Accounting oracle: 218 mutants, 185 killed, 33 survived, 84.86% score; `pnpm quality:mutation:accounting`, tracked in issue #196 |
| Schemathesis 4.25.2 | Rejected for current surface | CLI availability verified, but CodeVetter has no OpenAPI/Swagger contract or HTTP server to exercise |
| Apple `container` CLI | Approved for measured trial | Host qualifies (arm64, macOS 27), but the signed admin-installed system service is absent; tracked in issue #197 |

These tools subsidize discovery and evidence collection. CodeVetter still owns
receipt qualification, taxonomy, budgets, and the final measurable verdict.

The first CodeQL run also exposed a cleartext localStorage API-key field. Source
tracing showed that the old browser gateway execution path had already been
removed and only its non-functional Settings panel remained. The remediation
removes that panel and allowlist-migrates the shared record to rubric fields
instead of adding a credential dependency to preserve dead behavior; issue
#194 remains open until pushed CodeQL evidence confirms the alert is closed.

The OSV baseline changes the order of operations for repository dependency work:
fix or classify the measured lockfile baseline before adding another scanner.
The tracked [baseline evidence](https://github.com/Codevetter/codevetter/blob/main/evidence/security/osv-baseline-2026-08-31.md)
records 52 advisory/package matches and the exact database hashes; generated
SARIF and receipts remain ignored scratch.
`cargo-audit` remains the highest-leverage product embedding candidate because
the `rustsec` crate runs inside the existing Rust backend with no process
boundary or sidecar to codesign. Its SARIF 2.1.0 output is real but undocumented
in the README and absent from the changelog — pin `>= 0.22.0` and trust the
source, not the docs.

## Reject

| Tool | Reason |
|---|---|
| TruffleHog | AGPL-3.0, **and** verifies secrets against live provider APIs by default |
| ggshield | Hosted detection engine; file content necessarily transmitted |
| socket.dev | Hosted; uploads manifests and lockfiles |
| Codecov / Coveralls | Exist to upload coverage data off-machine |
| npm / pnpm audit | No offline mode; npm's fallback path uploads the full dependency tree plus machine metadata |
| `lcov` / `genhtml` Perl tooling | GPL-2.0 — do not bundle (the *format* is unencumbered) |
| Meta OpenApps | CC-BY-NC-4.0, commercial use prohibited |
| DeepWiki as product/docs authority | Hosted; private repos need a paid Devin account — see [documentation tooling](./tooling-documentation.md) |
| CodeQL on customer repositories | License forbids use on non-open-source codebases without paid GHAS — see [sandboxing](./tooling-sandboxing.md) |
| Firecracker, gVisor | Linux-kernel only; no macOS host mode exists |
| Docker Desktop | Proprietary GUI app, license-gated at 250 employees / $10M revenue |
| WorkArena, WebVoyager | Require live third-party websites or hosted SaaS |
| detect-secrets | Dormant since 2024; no SARIF |
| Nosey Parker | Archived 2026-04-24, superseded by Titus |

## Adopt only with explicit configuration

- **Trivy** ships telemetry **on by default**, contacting `check.trivy.dev`.
  Requires `--skip-version-check --disable-telemetry`. Separately,
  `--offline-scan` does *not* mean offline — it only suppresses
  dependency-identification API calls, not DB downloads or telemetry.
- **Terminal-Bench** needs network access **at verification time**. Its task
  template sets `network_mode = "public"`, all 89 TB-2.0 tasks set
  `allow_internet = true`, and the verifier's own `test.sh` runs `apt-get
  update` and curls `astral.sh`. These are package-registry dependencies rather
  than live websites, so pre-baking images is tractable — but it is real work,
  not a flag.
- **cdxgen v13** requires `pnpm >= 11` and `node >= 24`, which conflicts with
  this repo's `pnpm@10.33.2`. Pin `@cyclonedx/cdxgen@12.x`, or prefer Syft.

## What not to outsource

Changed-line coverage — the metric that answers "did the agent's change
actually get exercised?" — should be computed in the Rust backend, not
delegated. It is a small deterministic join: `git diff -U0` yields changed
lines, LCOV yields hit counts, intersect them. It is the core verdict input, it
must be reproducible and explainable inside the evidence bundle, and it must not
depend on a Python install existing on the user's machine. Use `diff-cover`
(Apache-2.0) as a cross-check oracle in the test suite instead of a runtime
dependency.

Two traps that produce false verdicts if ignored are documented in
[coverage](./tooling-coverage.md): V8's loaded-files-only blind spot, and
LCOV's line-granularity loss on dense lines.

## Related

- [codebase-context-tools-landscape.md](./codebase-context-tools-landscape.md)
  — April 2026 survey of codebase indexing and context tooling. Its DeepWiki
  assessment was independently reconfirmed in August 2026.
- [failed-approaches.md](./failed-approaches.md) — constraints left behind by
  things that broke. Check before adopting anything that touches the package
  manager or the data layer.
