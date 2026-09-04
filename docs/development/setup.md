---
title: Local setup
description: Prerequisites, install, and how to build CodeVetter's native app, Rust core, and landing page.
sidebar:
  order: 1
---

# Local setup

CodeVetter has three synchronized product surfaces: the native macOS app, the
`codevetter` CLI, and the repository-scoped read-only MCP server. Rust owns
the receipts and persistence; SwiftUI/AppKit presents them.

## Prerequisites

- macOS 14 or newer with current Xcode command-line tools.
- Node.js 22, matching CI.
- pnpm 10.33.2, pinned in the root `package.json`.
- Stable Rust and Cargo.

No Tauri, WebView, Playwright browser download, container runtime, or server is
required to build the desktop product.

## Install dependencies

```bash
pnpm install --frozen-lockfile
```

## Build and test the native app

Run from the repository root:

```bash
pnpm test:native:background
```

This is the normal local lane. It runs Swift package tests, isolated
performance gates, and a Debug build without launching or focusing CodeVetter.
Foreground XCUITest is intentionally separate:

```bash
pnpm test:native:ui
```

Only use the UI lane on an idle graphical desktop with current operator
approval. CI runs it on an isolated hosted macOS desktop for pull requests.

Open `apps/macos/CodeVetter.xcworkspace` in Xcode for interactive
development. Most app code lives under
`apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/`.

## Build the Rust authority and companions

```bash
pnpm core:build
pnpm core:test
pnpm core:prepare-cli
pnpm core:prepare-mcp
pnpm core:prepare-ccusage
pnpm core:qualify-cli
```

Generated local companions live under
`crates/codevetter-core/binaries/` and are ignored. The native package embeds
the exact companions during qualification.

## Build the public site and docs

```bash
pnpm build:landing
```

Astro owns the public site. Markdown under `docs/` remains the source of
truth; Blume supplies the presentation layer.

## Data and identity

Debug uses `com.codevetter.desktop.native-preview` and must not touch the
installed production app's data. Release uses `com.codevetter.desktop` so the
native replacement retains the existing Application Support location.

Do not delete, rewrite, or copy user data during local development. Release
qualification performs upgrade and rollback checks in a temporary hosted
environment.

## Common checks

```bash
pnpm lint
pnpm knip:strict
pnpm core:fmt
pnpm core:clippy
node scripts/check-docs.mjs
```

Use the smallest relevant check first, then expand to the full lane before a
pull request.
