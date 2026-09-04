---
title: Testing
description: Test, qualification, and code-health surfaces for the native app and shared Rust core.
sidebar:
  order: 2
---

# Testing

Tests are grouped by the boundary they prove. Passing one boundary never
substitutes for another.

## Native app

```bash
pnpm test:native:background
```

The background lane runs Swift package behavior tests, isolated native
performance contracts, and a Debug Xcode build without app activation.

```bash
pnpm test:native:ui
```

The UI lane runs only XCUITest interaction targets. It requires a dedicated
graphical desktop and explicit approval because it can move focus.

```bash
pnpm test:native:full
```

The full lane keeps background checks before UI automation. Pull requests use a
hosted macOS runner so local work is not disturbed.

## Rust core, CLI, and MCP

```bash
pnpm core:test
pnpm core:clippy
pnpm core:fmt
cargo test --manifest-path crates/codevetter-core/Cargo.toml --bin codevetter-mcp
cargo test --manifest-path crates/codevetter-core/Cargo.toml --test mcp_stdio
cargo test --manifest-path crates/codevetter-core/Cargo.toml --features browser-agent --bin codevetter
```

The CLI and MCP tests prove parsing, receipt semantics, repository scope, JSON
stdio behavior, cancellation, pagination, and the read-only agent boundary.

## Package and release contracts

```bash
pnpm test:native-runner
pnpm test:native-package
pnpm test:native-package-finalize
pnpm test:native-appcast
pnpm test:native-notarization
pnpm test:native-data-continuity
pnpm test:native-installed-upgrade
pnpm test:native-release
```

These are deterministic contract tests. The protected production workflow is
still required for real Developer ID signing, Apple notarization, Sparkle
signing, Gatekeeper, installed upgrade, data continuity, and rollback.

## Repository automation

```bash
pnpm test:automation
pnpm test:corpus-contracts
pnpm test:retrieval
pnpm test:core-tools
pnpm capabilities:check
```

## Code health and docs

```bash
pnpm lint
pnpm knip:strict
pnpm quality:complexity
pnpm quality:cycles
pnpm quality:duplication
pnpm quality:dependencies
node scripts/check-docs.mjs
```

The change-size and complexity gates compare against a base revision. CI fetches
that exact base before running them.

## Evidence interpretation

- A unit test proves its contract, not a production release.
- A local package may be ad-hoc signed; shipping requires Developer ID and
  notarization receipts.
- A successful build does not prove launch, interaction, upgrade, or rollback.
- MCP remains read-only even when the native app and CLI can execute.
- Missing provider or runtime evidence is unavailable, never zero or passing.
