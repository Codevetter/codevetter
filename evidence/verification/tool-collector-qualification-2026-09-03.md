# Tool collector qualification — 2026-09-03

## Scope

This receipt qualifies the unreleased `codevetter.tool-collection/v1` contract,
the packaged CLI path, and the Gitleaks, cargo-audit/RustSec, and
cargo-llvm-cov adapters. The collectors remain optional subordinate evidence:
CodeVetter owns source resolution, normalization, limitations, and any later
verdict policy.

This is source and local-package evidence. It does not claim that a signed,
notarized release containing these resources has shipped.

## Contract

- Input is one exact clean checked-out Git `base..head` range at the recorded
  head SHA. Collector selection is explicit and duplicate selections collapse.
- Release resolution accepts only an application-bundle executable/resource;
  explicit binary overrides exist only in debug/test builds. Arbitrary `PATH`
  discovery is never release evidence.
- Processes launch without a shell or stdin, in a contained working directory,
  with a minimal environment, process-group timeout cleanup, bounded stdout and
  stderr, and no update, database fetch, or toolchain installation.
- Every receipt records exact version, resolution source, binary SHA-256,
  duration, status, normalized findings, and limitations. A finding exits 1,
  unavailable/error exits 2, and only a fully clean collection exits 0; those
  are collection outcomes, not the overall CodeVetter verdict.
- Gitleaks retains rule and repository-relative location metadata but its Rust
  type cannot represent upstream `Secret` or `Match` fields.
- cargo-audit receives a pinned local RustSec database with `--no-fetch` and
  `CARGO_NET_OFFLINE=true`; descriptions and package source strings are not
  persisted.
- cargo-llvm-cov requires one explicit Cargo test target and an existing
  `llvm-tools-preview` component. It runs `--offline --frozen`, places all
  instrumentation under a private temporary target, intersects LCOV with
  changed executable Rust lines, treats an absent changed file as uncovered,
  and retains only changed LLVM region rows. Branch coverage is not a verdict.

## Artifact identity and footprint

Preparation supports both `aarch64-apple-darwin` and
`x86_64-apple-darwin`. It downloads immutable publisher archives, verifies
pinned archive SHA-256 values before extraction, checks exact versions and
permissive license files (including digest-pinned cargo-llvm-cov license texts
from the exact source tag), caps every download at 128 MiB, removes stale
atomic-copy files, and prepares the pinned RustSec advisory snapshot at
commit `5a0ebedfe8bdd2e295b171f4162f8c977bcad9a5` (archive SHA-256
`b139452940da08da4428041130c80a30303a8b838901da7ab764972dc8350fe0`).
Verified archives are reused from a content-addressed cache under the ignored
Rust `target/` tree rather than the user's Downloads folder. A repeat arm64
preparation with the added license and tree-identity checks completed in 2.22
seconds without another download. The x86_64 preparation path also completed
against its three distinct pinned publisher archives and exact version probes;
the arm64 resources were then restored for the current host build.

The prepared arm64 payload was 39,036,821 bytes (37.2 MiB):

| Resource | Version | Bytes | Prepared binary SHA-256 |
|---|---:|---:|---|
| Gitleaks | 8.30.1 | 21,324,882 | `ba52fb1bfabbcde42f032afad3d6e0b19dff8ed105229a16e7caa338bbc0e84f` |
| cargo-audit | 0.22.2 | 12,598,016 | `33fbe81adca1b794f4ffe98574d59b0ebe6fcfdb310976fafed98a094c795111` |
| cargo-llvm-cov | 0.9.0 | 3,749,600 | `977d5f36554b21d64a03929a4f71e6a2ac585c7d0cee08059bce5b2bbf4eed20` |
| RustSec snapshot | pinned commit | 1,364,323 | normalized tree SHA-256 `902b61e08debfdd10f65807dfebc5d5603daf14879562189ff9033de758036e7` |

Publisher archive digests, not the extracted-binary digests in the table, are
the preparation trust anchors. Local GitHub attestation verification was not
available consistently for these publishers, so no attestation claim is made.

## Runtime evidence

The compiled product CLI exercised all three prepared arm64 executables against
clean detached CodeVetter ranges:

| Trial | Observed result |
|---|---|
| Gitleaks | `clean`, zero findings, 1,017 ms |
| cargo-audit cold | `findings`, 17 normalized findings, 571 ms |
| cargo-audit warm | same 17 findings, 435 ms |
| cargo-llvm-cov | `findings`, 89 uncovered changed executable lines, 82,439 ms |

The audit receipt recorded Cargo.lock SHA-256
`9ab926c28c877c7364a6e132680468a9efcbdbcf91fc1b0687da7b8abb381e88`,
the 1,259-file local database identity above, and no raw advisory body or source
string. The coverage run completed both subprocesses with exit code 0, bounded
its raw LLVM region report to 15,146,745 bytes (SHA-256
`5e1be9c8c61f80bfd9ad92a4d5ddf3ffb154bfbd60f53b82db6ef7da4b1ccb1a`),
retained only changed paths, and left no private `codevetter-cargo-llvm-cov-*`
target behind.

## Automated evidence

- Seventeen focused Rust tests cover receipt normalization, exact-range
  Gitleaks attribution, secret removal, offline cargo-audit execution,
  deterministic cross-language database identity, metadata mismatch and
  manifest/report symlink rejection, changed-line/LCOV intersection, diff
  parser edge cases, missing-file handling, diagnostic redaction, bundle
  resource resolution, timeout process-tree reaping, and cancellation cleanup.
- CLI parser tests cover the explicit Rust manifest, test target, and advisory
  database options.
- Six Node preparation tests cover both macOS target manifests, fail-closed
  archive and streamed-size bounds, cache reuse, stale temporary cleanup, and
  the same RustSec tree identity used by Rust. Fifteen native-package tests
  require exact target architecture, all three version smokes, the final
  resource paths, and signed companion identities.
- Tauri declares the collector and database resource directories. Release CI
  checks paths and versions in the final generated app before publication.

## Remaining release gate

The hosted native package workflow must still prove the new resources are
present and nested-signed in its staged app. Developer ID signing, notarization,
release publication, and product rollout remain explicit owner-approved gates.
Issue #198 remains open until this stack lands.
