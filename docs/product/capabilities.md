---
title: Capability glossary
description: What CodeVetter uses today, where each capability is available, and what is intentionally future work.
---

# Capability glossary

The canonical machine-readable inventory is generated from
`crates/codevetter-core/src/capabilities.rs`. Run
`pnpm capabilities:sync` after changing it; native Settings renders the same
registry and `codevetter capabilities --json` exposes it to machine users.

Every entry declares:

- stage: current, building, or future;
- UI, CLI, and agent/MCP availability;
- read, execute, or no authority;
- underlying tools and whether they are bundled, optional, or development-only;
- data boundary, qualification state, limitations, and next step.

## Product surfaces

| Capability | Native UI | CLI | Agent or MCP |
| --- | --- | --- | --- |
| Local verification and review | Read and execute | Read and execute | Persisted receipts read-only; local fix requires explicit CLI consent |
| Runtime preview and QA | Read and execute | Read and execute | Scope and saved-workflow inspection only |
| Performance verification | Read and execute | Read and execute | Scope inspection only |
| Local Claude, Codex, Grok, and Devin usage evidence | Read | Read | Not exposed |
| Additional Codex history roots | Read and configure | Read and configure | Not exposed |
| Repository snapshot and exports | Read and execute | Read and execute | Stored-index queries only |
| Structural graph and history | Read | Read | Repository-scoped read-only tools |
| Rubric packs | Read and configure | Read and configure | Used by explicit local agent invocation |
| Agent MCP configuration | Read and configure | Read and configure | Server remains read-only |
| Runs ledger, memories, retention, and local ops status | Bounded by each receipt | Bounded by each command | No authority unless explicitly declared |

## Underlying tools

| Tool | Role | Boundary |
| --- | --- | --- |
| Rust and rusqlite | Verification policy, receipts, persistence | Bundled core authority |
| SwiftUI and AppKit | Native macOS presentation and interaction | No independent verdict or database logic |
| Git | Exact revision, diff, history, and isolated worktrees | Selected repository only |
| Tree-sitter | Syntax-aware repository graph | Navigation evidence, not runtime proof |
| Claude and Codex CLIs | Independent model review or explicit fix attempt | Optional local provider tools |
| ccusage 20.0.20 | Offline Claude, Codex, and Grok accounting | Bundled and pinned; not cloud quota |
| Playwright | Explicit browser journey evidence | Admitted project or bundled runtime |
| Gitleaks 8.30.1 | Secret-pattern evidence | Bounded selected change; raw secrets are not retained |
| cargo-audit 0.22.2 | Offline Rust advisory evidence | Pinned RustSec snapshot |
| cargo-llvm-cov 0.9.0 | Changed Rust coverage evidence | Explicit target and local toolchain component |
| Sparkle 2.9.6 | Signed native updates | Disabled unless production identity and appcast gates pass |
| XcodeBuildMCP 2.7.0 | Reproducible Apple build and test automation | Development and qualification only |

## Future candidates

Future entries are not shipped claims. They remain in the registry so product
decisions, prerequisites, and qualification criteria stay visible.

- Hardened execution isolation with Apple container tooling, after read-only
  mount planning, no-network attestation, cancellation, bounded output, and
  real-workload regression evidence pass.
- Credential-safe live provider quota telemetry, separate from local token and
  cost accounting.
- Bounded external-collector receipt inspection in native UI and MCP without
  granting collector execution to agents.
- A live Agent Island helper only as a separately scoped side quest; it has no
  authority in the core verification roadmap.

Do not mark a future capability available because a dependency exists. The
declared qualification and exact surface authority must pass first.
