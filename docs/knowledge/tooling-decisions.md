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

## Adopt

| Tool | License | Surface | Category detail |
|---|---|---|---|
| `cargo-audit` (via `rustsec` crate) | MIT OR Apache-2.0 | In-process in `src-tauri/` | [supply chain](./tooling-secrets-and-supply-chain.md) |
| `gitleaks` | MIT | Sidecar binary | [supply chain](./tooling-secrets-and-supply-chain.md) |
| `cargo-llvm-cov` | MIT OR Apache-2.0 | Sidecar binary | [coverage](./tooling-coverage.md) |
| `lcov` crate | MIT OR Apache-2.0 | In-process parser | [coverage](./tooling-coverage.md) |
| τ³-bench (tau2-bench) | MIT | Corpus under `benchmarks/` | [agent benchmarks](./tooling-agent-benchmarks.md) |
| Terminal-Bench 4.0 (Harbor) | Apache-2.0 | Corpus under `benchmarks/` | [agent benchmarks](./tooling-agent-benchmarks.md) |

`cargo-audit` is the highest-leverage item: the `rustsec` crate runs inside the
existing Rust backend with no new process boundary, no sidecar to codesign, and
no subprocess. Its SARIF 2.1.0 output is real but undocumented in the README and
absent from the changelog — pin `>= 0.22.0` and trust the source, not the docs.

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
| DeepWiki | Hosted; private repos need a paid Devin account — see [documentation tooling](./tooling-documentation.md) |
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
