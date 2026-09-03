# cargo-deny policy qualification — 2026-08-31

## Scope

This receipt qualifies cargo-deny as a repository policy gate for the Rust
desktop dependency graph. It does not add cargo-deny to the shipped desktop
binary and does not fetch an advisory database during the check.

## Tool identity

| Tool | Version | License | Qualified artifacts |
|---|---:|---|---|
| cargo-deny | 0.20.2 | MIT OR Apache-2.0 | macOS arm64 SHA-256 `fe67d82a10d8597a3549364cb733a3f9cc1bfff9031b7ae46384a9f2a72090c3`; CI Linux x86-64 musl SHA-256 `9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f` |

Both digests match the release assets published for cargo-deny 0.20.2. The
macOS archive digest was reproduced after download before executing the binary.

## Policy

The tracked `apps/desktop/src-tauri/deny.toml` policy:

- evaluates the shipped `aarch64-apple-darwin` graph;
- allows the 15 permissive or file-level-copyleft SPDX families currently
  present in the graph;
- ignores unpublished workspace packages and marks the desktop crate
  `publish = false` so it cannot be published accidentally;
- denies wildcard dependency requirements;
- denies unknown registries and all Git dependencies;
- reports duplicate transitive versions as warnings rather than pretending
  Tauri-owned convergence is immediately actionable.

## Baseline result

The offline, locked policy run exits zero:

```text
bans ok, licenses ok, sources ok
```

The graph contains 14 duplicate-version warnings. They are visible in command
output but are not uploaded as code-scanning alerts. The SARIF lane covers
license and source-policy violations, while the bans lane remains an enforced
human-readable check. cargo-deny 0.20.2 emits native SARIF 2.1.0; this corrects
the earlier documentation claim that only JSON output was available.

## Maintained path

- `pnpm quality:rust-policy` runs the full offline policy when the pinned tool
  is installed locally.
- `repository-security.yml` downloads the exact Linux archive, verifies its
  SHA-256, uploads license/source SARIF, and separately enforces bans.
- RustSec advisory scanning remains in the OSV lane until the existing
  vulnerability baseline is remediated; this policy gate does not duplicate
  or suppress those findings.
