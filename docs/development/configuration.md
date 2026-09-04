---
title: Configuration
description: Native build identity, local settings, data ownership, and release-only protected inputs.
sidebar:
  order: 3
---

# Configuration

CodeVetter is a local macOS application with no product server. Swift never
opens SQLite directly: the Rust core validates settings, reads and writes the
database, and returns versioned receipts to the app and CLI.

## Build configuration

| File | Authority |
| --- | --- |
| `apps/macos/Config/Shared.xcconfig` | Product name, executable, bundle identifiers, version, deployment target |
| `apps/macos/Config/Debug.xcconfig` | Preview-only build behavior |
| `apps/macos/Config/Release.xcconfig` | Production hardening and updater policy |
| `apps/macos/Config/CodeVetter.entitlements` | App sandbox and user-selected repository access |
| `apps/macos/CodeVetterPackage/Package.swift` | Exact Swift package dependencies |
| `crates/codevetter-core/Cargo.toml` | Rust core, CLI, MCP, and collector dependencies |

Release uses `com.codevetter.desktop` and executable
`CodeVetterNative`. Debug uses
`com.codevetter.desktop.native-preview` to isolate development state.

## User settings

Non-secret settings use the allowlisted
`codevetter.native-settings/v1` Rust contract. Unknown keys and invalid
options fail closed. Agent history roots, retention, rubrics, MCP scope,
onboarding, and operations status each have their own bounded receipt.

Provider credentials are not part of the non-secret settings receipt and must
not be written into source, environment files, logs, or generated evidence.

## Data

The Rust core owns the existing CodeVetter Application Support database. The
native app retains the production bundle identity so installed replacement
does not create a second data root. Release qualification fingerprints stable
records before upgrade, after native launch, and after rollback.

## Updater

Sparkle is present but fail-closed unless the production app has:

- an HTTPS appcast;
- a valid EdDSA public key;
- a Developer ID signed and notarized archive;
- an exact appcast/archive identity match.

The release workflow supplies protected inputs through GitHub Actions secrets.
Do not add secret values to repository configuration or local command history.

## Public site

The landing page reads the current native version from
`apps/macos/Config/Shared.xcconfig`. Its download links target the GitHub
release DMG, ZIP, and appcast published by the protected release workflow.
