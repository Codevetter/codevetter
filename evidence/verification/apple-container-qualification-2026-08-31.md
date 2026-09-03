# Apple Container qualification — 2026-08-31

## Scope

This receipt qualifies Apple's `container` CLI as an external-prerequisite
sandbox candidate on one supported development host. It does not add a product
dependency, bundle the runtime, or approve a release architecture.

## Identity

| Item | Observed identity |
|---|---|
| Host | macOS 27.0 build 26A5421a, arm64 |
| Installer | `container-1.3.1-installer-signed.pkg` |
| Publisher SHA-256 | `a7c1b9d7927d30875f2f6c7bd1d0cb06c2daa6ca57ce9e90a5144e898fdf54a8` |
| Signature | Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM); trusted, notarized, timestamped |
| CLI | 1.3.1, release commit `a9a62e2` |
| API server | 1.3.1, release commit `a9a62e28f6beb88940122a3d7b286f2d5ae8053a` |
| Default kernel | Official Kata kernel 3.32.0 |
| Trial image | `alpine:3.22`, observed Alpine 3.22.5, local digest prefix `14358309a308` |

The package digest matched the release publisher value before installation.
`pkgutil --check-signature` and `spctl` both accepted the downloaded package.
Installation required the owner's administrator authorization. The first
service start separately downloaded and verified the 664.3 MB default kernel.

## Measured trial

- First image/init-image run: 20.56 seconds wall time, including registry fetch
  and unpack; the kernel had already been provisioned.
- Warm cached no-op run: 0.61 seconds wall time.
- Limits exercised: 1 CPU and 256 MB memory.
- Isolation exercised: an internal network plus `--no-dns`, read-only root,
  read-only bind mount, and all Linux capabilities dropped.
- The controlled network probe failed, host-only environment marker was absent,
  `/Users` and `/root/.ssh` were absent, and writes to both the mounted workspace
  and `/root` failed with a read-only-filesystem error.
- `--rm` teardown left zero containers and zero local volumes. The cached image
  and init image occupied 1.45 GB and were intentionally retained.
- With no containers running, three two-second samples measured the external
  service processes at 17,568 KiB resident in total and 0.0% CPU: 7,424 KiB
  API server, 7,920 KiB core-image plugin, and 2,224 KiB network plugin.

The trial network was deleted after use. No host credential, home, SSH, cloud,
or production path was mounted or inspected.

## Failed requirement: caller-owned path containment

The CLI accepted a controlled bind source containing `..` when that source
resolved to an existing sibling fixture. Apple Container therefore provides
mount mechanics, but it does not enforce CodeVetter's workspace-root policy.
Any adapter must canonicalize both the allowed root and requested source,
reject sources outside the allowed root before process launch, pass the
canonical source to the CLI, and cover symlink and time-of-check/time-of-use
cases. The product must not treat the CLI's mount validation as containment.

## Adapter policy and decision

Use the Apple CLI as the first external-prerequisite adapter on supported Macs.
It already provides the measured isolation contract with a 0.61-second cached
start and about 17.2 MiB of idle resident service memory, while adding no app
bundle, nested-code-signing, or Rust FFI dependency. Do not bundle it or start
its system service silently; installation remains an explicit owner action.

`commands/apple_container.rs` now owns a pure mount-policy boundary. It
canonicalizes the allowed root and source, rejects component-level escapes,
symlink escapes, unsupported mount-string characters, and non-normalized guest
targets, records the source filesystem identity, and revalidates identity and
containment immediately before returning the read-only CLI argument. Five
fixture tests cover the accepted path and each observed or anticipated failure.

The CLI string interface still has an irreducible final time-of-check/time-of-use
window after revalidation. That is acceptable only for an app-owned, immutable
worktree whose host permissions exclude the untrusted guest before launch. If
CodeVetter later permits concurrently mutable host roots, move to Apple's
Containerization library with an audited descriptor-based mount path; do not
pretend another string check removes the race. `libkrun` remains a fallback only
if real workloads disprove the first-party CLI's performance or compatibility.

This receipt qualifies the architecture and mount boundary, not a shipped
runtime-isolation claim. A product runner still needs an exact CLI/version and
local-image preflight, attested internal network, minimal environment,
timeout/cancellation, bounded output, teardown, and real-workload regression
evidence before the capability can become available.
