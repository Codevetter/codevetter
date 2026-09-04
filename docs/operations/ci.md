---
title: CI
description: GitHub Actions checks for the native app, Rust core, CLI, MCP, site, and protected release.
sidebar:
  order: 3
---

# CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
Permissions default to none and checkout credentials are not persisted.

## Linux verification

The `verify` job installs locked pnpm dependencies and stable Rust, then runs:

1. Biome lint.
2. Changed-file size, Knip, complexity, cycle, duplication, and dependency
   health gates.
3. Astro public-indexing build and agent-surface verification.
4. Hermetic automation, corpus, retrieval, and core-tool contracts.
5. CLI, MCP, and pinned ccusage companion preparation.
6. Rust library MCP tests, MCP binary and stdio tests, and CLI tests.

The Rust dependency graph contains no Tauri, Wry, WebKit, GTK, or windowing
runtime, so Linux CI verifies only the portable core and machine surfaces.

## Hosted native qualification

Pull requests call `.github/workflows/native-qualification.yml` on an
isolated macOS runner. The reusable workflow builds and tests the SwiftUI/AppKit
app and can run foreground XCUITest without interrupting the operator's Mac.

Manual dispatch inputs can select:

- background native qualification;
- foreground interaction qualification;
- protected production-candidate qualification.

## Protected production qualification

`.github/workflows/native-production-qualification.yml` fails closed unless
it can prove the exact source and archive through:

- Release build and companion packaging;
- Developer ID signing;
- Apple notarization and staple validation;
- Sparkle EdDSA signing and appcast identity;
- Gatekeeper validation;
- isolated upgrade from the previous signed application;
- native relaunch, stable-record continuity, and rollback.

Secrets are consumed only by GitHub Actions and are not printed or committed.

## Release automation

A version change in `apps/macos/Config/Shared.xcconfig` on `main` causes
`auto-release.yml` to create `v<version>` and dispatch `release.yml`.
The release workflow re-runs protected qualification and uploads only the exact
qualified DMG, ZIP, and appcast.

## Local parity

Run the smallest relevant command first. Before merging a release change, the
local baseline is:

```bash
pnpm lint
pnpm knip:strict
pnpm core:test
pnpm test:native:background
pnpm build:landing
node scripts/check-docs.mjs
```

Local success is source/build evidence. Hosted protected jobs remain the
authority for signing, notarization, interaction, upgrade, and publication.
