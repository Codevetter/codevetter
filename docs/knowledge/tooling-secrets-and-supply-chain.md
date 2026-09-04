---
title: Secret scanning and supply-chain tooling
description: Evaluation of secret scanners and dependency/vulnerability scanners against CodeVetter's offline and privacy constraints.
sidebar:
  order: 11
---

# Secret scanning and supply-chain tooling

Verified **2026-08-30**. See [tooling-decisions.md](./tooling-decisions.md) for
the cross-category summary and the constraints that drive these calls.

The headline: a common assumption going in was that several core scanners had
relicensed to something restrictive. Checked against LICENSE files at HEAD, that
is **wrong** — Trivy, Grype, Syft, osv-scanner, cdxgen, Dependency-Track,
detect-secrets, Titus, and Kingfisher are all Apache-2.0, and Gitleaks is still
MIT. TruffleHog is AGPL-3.0, but has been since v3.0 in 2021.

What actually matters is different and less obvious: **default network
behaviour**. Several tools phone home or validate credentials against live
provider APIs unless told not to.

## Recommended

### `cargo-audit` — package under the Rust backend

Dual **MIT OR Apache-2.0**. The highest-leverage item in this category because
the official CLI can consume a pinned local advisory snapshot with fetching
disabled. The underlying `rustsec` crate remains a viable future in-process
path, but the first product slice deliberately uses the exact official CLI so
all three commodity collectors share one supervised process contract and the
scanner can be replaced without adding a production Rust dependency.

- **SARIF 2.1.0 output exists but is undocumented.** It is absent from the
  README and the CHANGELOG stops before it landed (~Sept 2025). Verified in
  `cargo-audit/src/sarif.rs`. Pin `>= 0.22.0`.
- Offline: `--no-fetch --stale`, or `database.fetch = false` in `audit.toml`.
- The advisory DB is a git clone of
  [RustSec/advisory-db](https://github.com/RustSec/advisory-db) at
  `~/.cargo/advisory-db` — trivially vendorable and shippable.
- Pair with **cargo-deny** (`--offline`) for SPDX license-policy enforcement,
  which nothing else here does for Rust. Version 0.20.2 emits native SARIF
  2.1.0; the repository now verifies that output instead of relying on the
  earlier, stale JSON-only assessment.

### `cargo-deny` — wired repository policy

The tracked `crates/codevetter-core/deny.toml` evaluates the shipped Apple
Silicon target, permits only the license families present in the qualified
graph, denies wildcard requirements, denies unknown registries and all Git
dependencies, and reports duplicate versions without failing on Tauri-owned
convergence. `pnpm quality:rust-policy` runs the locked offline check locally.

`repository-security.yml` downloads the exact 0.20.2 Linux musl binary,
verifies its publisher digest, uploads native license/source SARIF, and enforces
the bans lane separately. The qualified baseline has clean licenses and sources
plus 14 non-blocking duplicate-version warnings. Exact artifact identities and
limitations are in the [tracked evidence](https://github.com/Codevetter/codevetter/blob/main/evidence/security/cargo-deny-baseline-2026-08-31.md).

### `gitleaks` and `cargo-audit` — repository gate plus product collectors

**MIT**, and the core scanner's license is unchanged. Fully offline: no DB, no
network, rules embedded or from `.gitleaks.toml`. Emits SARIF. Static Go binary,
same integration shape as the existing `ccusage` sidecar.

One licensing nuance worth stating precisely, because it is widely misreported:
the commercial relicensing applies **only to `gitleaks/gitleaks-action` v2.0.0+**
(MIT → proprietary EULA). Invoking the MIT Go binary directly is unencumbered.

Caution: v8.30.1 shipped 2026-03-21 and recent commits are largely Dependabot.
Not stale, but feature velocity has slowed.

The repository integration invokes the binary directly rather than the
commercially relicensed action:

- `.husky/pre-commit` scans staged changes when Gitleaks is installed;
- `.husky/pre-push` scans complete Git history, with the previous pattern scan
  retained only as a limited fallback;
- `pnpm quality:secrets` is the reproducible local command;
- `repository-security.yml` downloads v8.30.1, verifies its embedded SHA-256,
  emits redacted SARIF, uploads the result, and fails on a finding.

`.gitleaksignore` contains four exact historical fingerprints. It does not
allowlist whole paths or rules, so later findings in those files remain visible.
The unreleased Rust backend and `codevetter collect` CLI expose the bounded,
versioned `codevetter.tool-collection/v1` contract. It resolves one clean
checked-out Git range, accepts only exact application resources or explicit
debug/test overrides, records binary/config/database identities, and invokes
without a shell under time, output, environment, and process-tree bounds. Raw
Gitleaks `Secret` and `Match` values are not representable in the normalized
receipt.

cargo-audit 0.22.2 receives the exact Cargo.lock and a pinned local RustSec
snapshot. Verification always supplies `--no-fetch`, clears the environment,
sets `CARGO_NET_OFFLINE=true`, and persists only bounded advisory/package
identity and remediation versions—not raw advisory descriptions or package
source strings. Preparation verifies official archive and license digests for
both macOS targets, enforces a 128 MiB download ceiling, and validates the
normalized RustSec tree hash before replacing the prepared resource. Tauri
declares all three collector executables plus the advisory snapshot as
resources, and release qualification checks exact versions and paths in the
final app. These are unreleased package receipts, not evidence that a signed or
notarized collector bundle has shipped. See the
[qualification receipt](../../evidence/verification/tool-collector-qualification-2026-09-03.md)
and issue #198.

### `osv-scanner` — offline repository runner wired, remediation required

`pnpm quality:vulnerabilities` invokes the repository-owned 2.5.1 runner with
`--offline --offline-vulnerabilities`. It hashes the preseeded ecosystem
databases and writes SARIF plus a versioned receipt under ignored `artifacts/`.
Database refresh remains an explicit, separate network operation. The qualified
warm scan took 8.942 seconds and found 35 affected locked package versions and
52 advisory/package matches: 18 Rust packages and 17 docs-site npm packages.
The remainder is dominated by unmaintained GTK3 and Unicode Rust crates that
need platform/reachability classification rather than a blind allowlist. See
the [tracked baseline evidence](https://github.com/Codevetter/codevetter/blob/main/evidence/security/osv-baseline-2026-08-31.md).

This explains why the root `pnpm audit` result was insufficient: it did not
cover the independent docs-site lockfile or RustSec. The trial is not yet a
gate because the current baseline would fail and each finding still needs
scope/reachability review. Integration and remediation are tracked in issue
#195. Database refresh must stay separate from the offline scan so a product
run cannot turn a transient network path into an implicit manifest upload.

The approved Blume 1.5.3 and event-listener 5.4.2 maintenance reduced the same
offline result from 52 matches to 39 result instances (36 normalized rules) at
revision `855202998b56c1658b9decda22298a1b63fb5caf`. It did not make the graph
clean: the docs-site production audit still reports 12 high, 7 moderate, and 1
low advisory in current transitive build/documentation paths. The
[baseline receipt](https://github.com/Codevetter/codevetter/blob/main/evidence/security/osv-baseline-2026-08-31.md)
keeps both the improvement and remaining exposure explicit.

## Rejected

### TruffleHog — two independent blockers

**AGPL-3.0** (LICENSE at `main` verified). Bundling an AGPL binary in a
distributed proprietary desktop app is a genuine legal question — subprocessing
an unmodified binary is the lowest-risk posture, but redistribution still
carries source-offer obligations. Get counsel before shipping.

The second blocker is worse and is about defaults: "verified" in TruffleHog
means it **tested the candidate credential against the live provider API** — the
AWS detector performs a real `GetCallerIdentity` call. In practice, strings from
the user's private source are transmitted to AWS, GitHub, Slack and hundreds of
others **by default**. Mitigable with `--no-verification`, but it is opt-out, and
one missing flag is a privacy incident.

### ggshield and socket.dev — hosted engines

`ggshield`'s MIT license covers **the client only**; detection runs server-side
and requires a GitGuardian API key. Their docs are precisely worded — "your
files and secrets won't be stored" is a statement about *retention*, not
transmission. File content necessarily crosses the wire. No offline mode.

socket.dev uploads manifests and lockfiles (not full source, per their docs).
Also note: `SocketDev/socket-cli` has **no LICENSE file at repo root** while the
published npm packages declare MIT — do not rely on the MIT claim.
Pricing is **UNVERIFIED** (`socket.dev/pricing` returns 403 to automated fetch).

### npm / pnpm audit — the fallback is the hazard

The default bulk path sends package names and versions, which is acceptable. But
npm's **Quick Audit fallback**, triggered automatically when bulk fails, submits
*"the full package tree as found in `package-lock.json`"* plus `npm_version`,
`node_version`, `platform`, `arch`, `node_env`. A complete dependency graph and
machine fingerprint, triggered by a transient failure outside your control.

**No offline mode exists for either.** For an offline story, read the lockfile
locally with osv-scanner or grype instead.

### Others

- **detect-secrets** — Apache-2.0 and fully offline, but last release
  2024-05-06, 178 open issues, no SARIF, and it is Python (a runtime to bundle).
- **Nosey Parker** — **archived 2026-04-24**; README directs users to Titus.
- **Dependency-Track** — Apache-2.0 and active, but it is a **JVM API server
  plus separate frontend** needing 8GB RAM and external Postgres. A non-starter
  inside a Tauri app. Plausible only as an optional external SBOM sink.

## Viable alternatives, with eyes open

- **Grype + Syft** (Apache-2.0) have the cleanest offline story in the vuln set:
  single static Go binaries, no daemon, `GRYPE_DB_AUTO_UPDATE=false` for
  air-gap, and Syft needs no DB at all. Grype emits SARIF.
  **UNVERIFIED:** whether either has telemetry. None was found, but their source
  was not audited the way Trivy's was — confirm before making any "zero outbound
  connections" claim.
- **Kingfisher** (MongoDB, Apache-2.0) is **written in Rust and exposes library
  crates**, so it could scan in-process like `cargo-audit`. Uniquely, its
  network validators are behind optional cargo features, meaning they can be
  **compiled out entirely** — a compile-time guarantee stronger than any runtime
  flag. Two caveats: validation is **on by default** (opt out via
  `--no-validate`), and it is **not on crates.io** — use a git dependency; the
  unrelated `kingfisher` crate on crates.io is a different package.
- **Titus** (Praetorian, Apache-2.0) is the Nosey Parker successor with the best
  defaults in the category — **validation is opt-in**. Risk: created 2026-01-25,
  ~7 months old.

## Trivy — usable, but not as-is

Apache-2.0, no relicensing, excellent format support including SARIF. Two
corrections to common belief:

1. **Telemetry is on by default**, sending an install identifier (one-way hash
   of a machine fingerprint), version, and OS to `check.trivy.dev`. No scan
   results or file paths. Not a code leak — but an unsolicited outbound
   connection from a privacy-positioned app is a positioning problem regardless
   of payload. Disable with `--skip-version-check --disable-telemetry`.
2. **`--offline-scan` does not mean offline.** Its actual usage string is *"do
   not issue API requests to identify dependencies"*. True air-gap additionally
   needs `--download-db-only` once to seed, then `--skip-db-update
   --skip-java-db-update`.

Useful detail: the misconfiguration checks bundle is **embedded in the binary at
build time**, so that scanning survives with zero network.

A bounded 0.74.0 repository trial confirmed that
`--disable-telemetry --skip-version-check --skip-check-update` suppresses the
notification request and uses the embedded checks. It also showed why this is
not yet a useful maintained lane: the unbounded scan reported against a
dependency-owned Dockerfile, while the dependency-excluded scan misclassified a
warm-verification JSON fixture as CloudFormation and found no supported
first-party IaC surface. Trivy config scanning is therefore **trialled, not
wired** until such a surface exists. See the
[tracked receipt](https://github.com/Codevetter/codevetter/blob/main/evidence/security/trivy-config-qualification-2026-08-31.md).

## SBOM formats

Target **CycloneDX 1.7** (ECMA-424 2nd Edition, patch 1.7.1 2026-06-02) and
**SPDX 3.0.1** (3.1 is still RC). Prefer **Syft** as the generator — bigger, Go
binary, no Node floor. Reach for cdxgen only where Syft's ecosystem coverage
falls short, and pin `@cyclonedx/cdxgen@12.x`: v13 moved npm scope and requires
`node >= 24` / `pnpm >= 11`.
