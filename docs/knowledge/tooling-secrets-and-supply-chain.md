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

### `cargo-audit` — embed in the Rust backend

Dual **MIT OR Apache-2.0**. The highest-leverage item in this category because
the underlying `rustsec` crate is a **library**: it runs in-process in
`src-tauri/` with no sidecar binary to codesign and notarize, and no subprocess.

- **SARIF 2.1.0 output exists but is undocumented.** It is absent from the
  README and the CHANGELOG stops before it landed (~Sept 2025). Verified in
  `cargo-audit/src/sarif.rs`. Pin `>= 0.22.0`.
- Offline: `--no-fetch --stale`, or `database.fetch = false` in `audit.toml`.
- The advisory DB is a git clone of
  [RustSec/advisory-db](https://github.com/RustSec/advisory-db) at
  `~/.cargo/advisory-db` — trivially vendorable and shippable.
- Pair with **cargo-deny** (`--offline`) for SPDX license-policy enforcement,
  which nothing else here does for Rust. Note its output is structured JSON log
  lines, **not SARIF** — the mapping would be yours to write.

### `gitleaks` — bundle as a sidecar

**MIT**, and the core scanner's license is unchanged. Fully offline: no DB, no
network, rules embedded or from `.gitleaks.toml`. Emits SARIF. Static Go binary,
same integration shape as the existing `ccusage` sidecar.

One licensing nuance worth stating precisely, because it is widely misreported:
the commercial relicensing applies **only to `gitleaks/gitleaks-action` v2.0.0+**
(MIT → proprietary EULA). Invoking the MIT Go binary directly is unencumbered.

Caution: v8.30.1 shipped 2026-03-21 and recent commits are largely Dependabot.
Not stale, but feature velocity has slowed.

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

## SBOM formats

Target **CycloneDX 1.7** (ECMA-424 2nd Edition, patch 1.7.1 2026-06-02) and
**SPDX 3.0.1** (3.1 is still RC). Prefer **Syft** as the generator — bigger, Go
binary, no Node floor. Reach for cdxgen only where Syft's ecosystem coverage
falls short, and pin `@cyclonedx/cdxgen@12.x`: v13 moved npm scope and requires
`node >= 24` / `pnpm >= 11`.
