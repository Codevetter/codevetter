---
title: Cut a desktop release
description: Runbook for shipping the signed and notarized native CodeVetter app.
sidebar:
  order: 1
---

# Cut a desktop release

The release version is `MARKETING_VERSION` in
`apps/macos/Config/Shared.xcconfig`. A version change merged to `main`
triggers `auto-release.yml`, which creates the tag and a **draft** GitHub
release, dispatches `release.yml`, and waits for it. The draft is published
only after the asset manifest verifies — see
[release-pipeline.md](../release-pipeline.md#asset-gate).

## Before merge

1. Confirm the native version and build number are intentional.
2. Run the local Rust, CLI/MCP, native background, site, docs, and code-health
   gates.
3. Review the owner gallery and exact native states.
4. Open a pull request and wait for Linux CI plus hosted native interaction
   qualification.
5. Manually run the protected production-candidate workflow against the exact
   branch or commit.

Do not replace the installed app or close the migration issue from local build
evidence alone.

## Protected release

After merge, verify:

1. `auto-release.yml` created the expected `v<version>` tag and draft release.
2. `release.yml` qualified the same tag.
3. The release left draft state and contains exactly:
   - `CodeVetter-<version>-arm64.dmg`;
   - `CodeVetter-<version>-arm64.zip`;
   - `appcast.xml`.
4. The readiness receipt reports every check passing.
5. The `release-manifest-verification` artifact reports `qualified: true`.
6. The latest-release appcast URL resolves.

A release still sitting as a draft means the build failed; read the watched
`release.yml` run rather than re-running `auto-release.yml`.

The workflow must fail closed if signing, notarization, Sparkle inputs, archive
identity, Gatekeeper, upgrade, data continuity, or rollback evidence is absent.

## Install and verify

Install the exact published DMG only after checking no CodeVetter process is
running. Preserve the previous `/Applications/CodeVetter.app` recoverably
until the replacement is verified.

Confirm:

- bundle identifier `com.codevetter.desktop`;
- executable `CodeVetterNative`;
- expected short version and build;
- Developer ID signature;
- notarization staple and Gatekeeper acceptance;
- bundled `codevetter` and `codevetter-mcp` companions;
- existing stable records remain available.

Avoid foreground launch automation on the operator's active desktop. Hosted
qualification owns automated launch, interaction, upgrade, and rollback; the
operator performs final visual review.

## Closeout

Close the release issue only after source, CI, protected qualification,
published assets, installed-app verification, and owner acceptance are all
recorded separately.
