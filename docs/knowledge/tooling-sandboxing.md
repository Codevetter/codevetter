---
title: Sandboxed execution and static analysis
description: Isolation options for running untrusted agent code on Apple Silicon, determinism controls, SARIF-emitting analyzers, and the CodeQL licensing blocker.
sidebar:
  order: 15
---

# Sandboxed execution and static analysis

Verified **2026-08-30**. See [tooling-decisions.md](./tooling-decisions.md) for
the cross-category summary.

Sandboxed execution is the mechanism CodeVetter's verdicts rest on: if the
isolation is not reproducible, the evidence is not either. This page covers
isolation on Apple Silicon, the determinism controls that make runs comparable,
and static analyzers that emit SARIF.

## Recommended: `libkrun`, with a VZ upgrade path

**`libkrun`** (Apache-2.0, `containers/libkrun`, 2,643★) is a small VMM
**library** written in Rust and built on Apple's `Hypervisor.framework`. It is
not Docker, not a daemon, and not a subprocess — it links into the existing Rust
backend via its C API, boots a minimal Linux microVM per verification run, and
tears it down after. That matches the local-first, no-server constraint without
requiring the user to install and license a GUI application.

**`apple/containerization`** (Apache-2.0, Swift, 8.9k★) is the follow-on once a
Swift sidecar is acceptable. It claims **sub-second** boot and is the only
option here with **native VM state save/restore** — the actual warm-start
mechanism. It requires **macOS 26** and Apple Silicon.

**Colima + Lima** (MIT / Apache-2.0) is the pragmatic fallback for pre-macOS-26
or Intel machines: a one-time Homebrew install rather than a bundled component.

## Comparison

| Option | License | Daemon? | Bundleable? | macOS ARM? |
|---|---|---|---|---|
| **libkrun** | Apache-2.0 | No — in-process C API | Yes, as a Rust dependency | Yes, explicit HVF backend |
| **apple/containerization** | Apache-2.0 | No (the `container` CLI wrapping it does) | Via a Swift sidecar | Apple Silicon, **macOS 26 only** |
| **Colima + Lima** | MIT / Apache-2.0 | CLI-managed VM, no GUI daemon | Prerequisite only | Yes (`vz` driver, default since Lima v1.0) |
| **Podman** | Apache-2.0 | `podman machine` VM | Prerequisite only | Yes |
| **Docker Desktop** | Engine Apache-2.0; **Desktop app proprietary** | Yes, GUI app + background VM | No | Yes, but license-gated |
| **Firecracker** | Apache-2.0 | — | — | **No — KVM only** |
| **gVisor** | Apache-2.0 | — | — | **No — Linux platforms only** |
| **Wasmtime / WasmEdge** | Apache-2.0 | No | Yes, trivially | Yes |

### Three findings that overturn common assumptions

1. **Firecracker and gVisor do not run on macOS at all.** Firecracker's own
   production-host docs state it relies on KVM, which is Linux-only. gVisor's
   platform docs list KVM, Systrap and Ptrace — all Linux-specific. There is no
   ARM-macOS host mode for either. Any plan built around them is dead on
   arrival.
2. **Docker Desktop is a licensing gate, not just an install burden.** The
   engine (moby) is Apache-2.0, but the Desktop app is proprietary and metered:
   free only under 250 employees **and** under $10M revenue. That becomes a
   legal problem the moment the company crosses either threshold.
3. **WASM cannot be the primary sandbox.** It is fast and trivially embeddable,
   but only runs workloads compiled to WASI. CodeVetter's actual core workload
   is TypeScript/Node web tasks with real browser and API behaviour. Keep WASM
   for pure-computation graders only.

## Determinism controls

These are mostly **guest/application-layer** concerns, so they transfer across
whichever isolation option is chosen:

| Control | Mechanism |
|---|---|
| Frozen clock | `libfaketime` via `LD_PRELOAD` inside the guest |
| Seeded RNG | Runtime-level shims, not a hypervisor feature |
| Network isolation | `--network none` or equivalent on all container/VM options |
| Filesystem rollback | Copy-on-write layers (recreate per run, not a memory snapshot) |
| CPU/memory limits | cgroups-equivalent flags; WASM adds fuel/instruction limits |
| **VM state save/restore** | **VZ/HVF family only** — see below |

**Warm start is the strongest argument for the VZ/HVF family.** True memory-state
snapshotting is confirmed only for `Virtualization.framework`-based options.
Lima's `vz: implement auto save/restore` ([PR #2900](https://github.com/lima-vm/lima/pull/2900))
measured **37s → 13s** boot-to-ready, and notes `saveOnStop` requires macOS 14+
and is arm64-only. Docker's and containerd's copy-on-write layer model does not
give you this.

## Rust crates for driving isolation in-process

- **`libkrun`** — the VMM itself, Rust, Apache-2.0, consumable via `bindgen`
  FFI. The most direct no-shell-out path.
- **`bollard`** — async Docker Engine API client, Apache-2.0, v0.21.1
  (2026-08-16). Avoids shelling out to the `docker` CLI but still needs a
  running daemon.
- **`testcontainers`** (Rust) — MIT/Apache-2.0, v0.28.0. Higher-level, same
  daemon prerequisite.
- Direct Rust bindings to `Virtualization.framework` exist
  (`virtualization-rs`, `apple-virtualization`, `virt-fwk`) but are all
  low-star, thinly maintained side projects. **Do not depend on them.**

## Static analysis with SARIF

| Tool | License | Offline | Native SARIF | Verdict |
|---|---|---|---|---|
| **Biome** | Apache-2.0 | Yes | Present, fidelity **UNVERIFIED** | **Check first** — already the repo's linter |
| **ast-grep** | MIT | Yes | Present, fidelity **UNVERIFIED** | Rust-native, good stack fit |
| **Ruff** | MIT | Yes | Yes (`--output-format=sarif`) | Python scope only |
| **Semgrep** | CLI is LGPL-2.1 | Yes | Yes | Engine fine; **rules are the problem** |
| **Clippy** | Apache-2.0 | Yes | **No** | Needs `clippy-sarif` converter |
| **ESLint** | MIT | Yes | No | Third-party formatter |
| **CodeQL** | Custom | Yes | Yes | 🚫 **Legally disqualified** |

### 🚫 CodeQL is a hard blocker for this product

The CLI license prohibits use *"in connection with any codebase that is not an
Open Source Codebase"* and prohibits automated analysis, CI or CD on such code,
absent a paid GitHub Advanced Security agreement.

CodeVetter's entire purpose is running against users' **private** repositories.
CodeQL therefore cannot be a default engine unless every user separately holds a
commercial GHAS license. This is a legal blocker, not a preference.

### ⚠️ Semgrep — the engine and the rules have different licenses

The CLI is LGPL-2.1 and runs offline. But the **registry rulesets** (`p/default`,
`p/security-audit`, …) are under a separate *Semgrep Rules License v1.0*:
*"You may use the rules only for your own internal business purposes. This
license does not allow you to distribute the rules, or to make them available to
others as a service."*

Running Semgrep against a user's own code is internal use and fine.
**Bundling a vendored copy of the registry rules into every install is the gray
area** — that needs counsel before shipping, and is not cleared by the engine's
LGPL alone.

**Lowest-friction path: verify Biome's own SARIF fidelity first.** The repo
already runs Biome for `pnpm lint`, so if its SARIF output is adequate, no
second linter is needed at all.

## Observability — do not add a dependency

**Use the existing SQLite database.** Cost, latency and tokens per run are a
handful of columns on the existing run/verification tables: `cost_usd`,
`latency_ms`, `tokens_in`, `tokens_out`, `provider`, `model`.

- **OpenTelemetry Rust** (Apache-2.0) is well-maintained but built for exporting
  to a collector. Running it in-process purely to write rows you could write
  directly is dependency accumulation.
- **Langfuse** core is MIT and self-hostable, but it is a server product
  (Postgres + web app) — a flat mismatch with "Tauri desktop binary, no server."

Revisit OTel only if CodeVetter grows a genuine multi-process or remote-agent
topology needing distributed tracing.

## Open questions

Flagged UNVERIFIED and worth closing before committing engineering time:

- **The `Virtualization.framework` entitlement question.** Apple's docs are
  JS-rendered and could not be fetched. Circumstantial evidence is strong —
  Lima, Colima and `apple/container` all ship as notarized, non-App-Store
  binaries using `vz` without incident, supporting the common understanding that
  `com.apple.security.virtualization` is required only for **sandboxed Mac App
  Store** apps, not Developer-ID-signed builds. Confirm directly against Apple
  before relying on it.
- **`libkrun` cold-boot time on Apple Silicon.** "Smallest possible boot time"
  is a stated design goal; no published benchmark was found.
- **Biome and ast-grep SARIF fidelity.** Both have SARIF code in-repo; neither
  was validated against real output.
- **Podman's default macOS backend** (applehv vs libkrun vs QEMU) and its exact
  network/CPU/memory flags.
