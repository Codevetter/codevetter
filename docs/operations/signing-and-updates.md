---
title: Signing keys and auto-update
description: Developer ID signing, notarization, and Sparkle appcast inputs for the native macOS app.
sidebar:
  order: 4
---

# Signing keys and auto-update

For the step-by-step release flow (version bump → CI qualification → publish),
see [runbooks/cut-a-release.md](./runbooks/cut-a-release.md) and
[release-pipeline.md](./release-pipeline.md). This page covers the protected
signing inputs and how the Sparkle auto-updater behaves.

## Protected inputs

The production-candidate workflow
(`.github/workflows/native-production-qualification.yml`) requires eight
repository secrets and fails closed at its preflight when any is missing:

| Secret | Purpose |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 PKCS#12 export of the Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting that PKCS#12 export |
| `APPLE_SIGNING_IDENTITY` | The exact `Developer ID Application: …` identity name |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarytool credentials (app-specific password) |
| `SPARKLE_EDDSA_PRIVATE_KEY` | Sparkle EdDSA private key used by `sign_update` |
| `SPARKLE_EDDSA_PUBLIC_KEY` | The matching canonical 32-byte public key baked into `SUPublicEDKey` |

Never place secret values in repository files, commands, receipts, or logs. The
workflow imports the certificate into an ephemeral keychain, signs every nested
executable, notarizes and staples the exact archive, generates and verifies the
appcast, and runs the isolated installed-upgrade proof. It cannot publish.

### One-time key generation

1. Export the Developer ID Application certificate and private key from
   Keychain Access as a password-protected `.p12`, then base64-encode it for
   `APPLE_CERTIFICATE`.
2. Generate the Sparkle EdDSA key pair with Sparkle 2.9.6's `generate_keys`.
   Store the private key only as `SPARKLE_EDDSA_PRIVATE_KEY`; the public key is
   safe to commit as `SPARKLE_EDDSA_PUBLIC_KEY` input and lands in the Release
   `Info.plist`.
3. Create an app-specific password for the notarizing Apple ID.

Rotating either key invalidates in-place updates for installed copies signed
with the previous key, so rotate only with a documented migration release.

## How the production build binds updates

`scripts/run-native-checks.mjs` refuses a production build unless
`CODEVETTER_NATIVE_BUNDLE_IDENTIFIER` is `com.codevetter.desktop`,
`CODEVETTER_NATIVE_SPARKLE_FEED_URL` is HTTPS, and
`CODEVETTER_NATIVE_SPARKLE_PUBLIC_KEY` is a canonical 32-byte EdDSA key. It
then injects `SUFeedURL` and `SUPublicEDKey` into the Release `Info.plist`. The
feed is the latest-release asset
`https://github.com/Codevetter/codevetter/releases/latest/download/appcast.xml`.

Debug and preview builds keep the `com.codevetter.desktop.native-preview`
identifier and no feed or key, so development copies never install production
updates or replace the installed app.

## How auto-update works

- `NativeUpdaterController` (in `apps/macos/CodeVetter/`) hosts Sparkle's
  `SPUStandardUpdaterController` and starts it only when
  `NativeUpdaterConfiguration.ready` is true: HTTPS feed, non-empty public key,
  and the production bundle identifier.
- Sparkle checks the appcast on its standard schedule and on
  **CodeVetter → Check for Updates…**. The menu item is disabled, with a
  tooltip explaining why, when the configuration is not ready.
- Each appcast item is bound to the exact qualified ZIP by EdDSA signature,
  length, version, and build. `pnpm native:appcast:inspect` verifies that
  binding offline before publication.
- Preview builds show "Preview builds never install production updates." and
  never contact the feed.

## Release assets

The release workflow uploads `CodeVetter-<version>-arm64.dmg`,
`CodeVetter-<version>-arm64.zip`, and `appcast.xml` to the `v<version>`
GitHub Release. Prefer the DMG for manual installs; the ZIP is the Sparkle
update archive.

## Historical note

Releases up to v1.11.1 used the retired Tauri updater (`latest.json` plus
minisign-style `.sig` files). That mechanism is no longer built. Installed
Tauri copies do not auto-migrate; the native replacement is installed once from
the published DMG, after which Sparkle owns updates.
