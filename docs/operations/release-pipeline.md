---
title: Release pipeline
description: How a native version bump becomes a signed and notarized GitHub Release.
sidebar:
  order: 1
---

# Release pipeline

CodeVetter ships one native macOS application through GitHub Releases. Sparkle
consumes the release's signed `appcast.xml`.

## Chain

```text
apps/macos/Config/Shared.xcconfig version changes on main
  -> auto-release.yml creates v<version> and dispatches release.yml
  -> release.yml calls native-production-qualification.yml at that exact tag
  -> Xcode Release build + Rust/ccusage companions
  -> Developer ID signing + hardened runtime + notarization + stapling
  -> isolated incumbent-to-native upgrade, relaunch, data, and rollback proof
  -> Sparkle archive and EdDSA appcast verification
  -> DMG, ZIP, and appcast.xml uploaded to the existing GitHub Release
```

The explicit dispatch is required because a release created with GitHub's
workflow token does not recursively trigger another workflow. Both auto-release
and release jobs are idempotent for an existing tag.

## Required production gates

- the tag equals `MARKETING_VERSION` in `Shared.xcconfig`;
- the app and every executable companion use the production identity/version;
- Developer ID signatures, one Team ID, Hardened Runtime, and Library
  Validation pass;
- Apple's notarization accepts the final archive and the app carries a valid
  stapled ticket;
- the Sparkle appcast is HTTPS, EdDSA-signed, and bound to the exact qualified
  archive;
- the isolated installed-upgrade proof preserves durable local data across
  native relaunch and incumbent rollback;
- `release-readiness.json` reports every check passed and
  `shipping_ready: true`.

Credentials are required only inside the protected ephemeral runner. They are
never printed, persisted in artifacts, or used by local read-only preflight.

## Assets

- `CodeVetter-<version>-arm64.dmg`
- `CodeVetter-<version>-arm64.zip`
- `appcast.xml`

## Key files

- `.github/workflows/auto-release.yml`
- `.github/workflows/release.yml`
- `.github/workflows/native-production-qualification.yml`
- `apps/macos/Config/Shared.xcconfig`
- `scripts/qualify-native-package.mjs`
- `scripts/inspect-native-release-readiness.mjs`
- `scripts/verify-release-manifest.mjs`
- [runbooks/cut-a-release.md](./runbooks/cut-a-release.md)
