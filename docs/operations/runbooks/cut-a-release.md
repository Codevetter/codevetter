---
title: Cut a desktop release
description: Runbook for shipping a new CodeVetter desktop version.
sidebar:
  order: 1
---

# Runbook: cut a desktop release

Releases are triggered by a version bump in
`apps/desktop/src-tauri/tauri.conf.json` on `main`. The rest is automated by
`auto-release.yml` → `release.yml`.

## Steps

1. **Verify the working tree is clean and on `main`.**
   ```bash
   git status
   git checkout main
   git pull --ff-only
   ```

2. **Bump the version** in `apps/desktop/src-tauri/tauri.conf.json`:
   ```json
   "version": "1.2.21"
   ```
   Use semver: patch for fixes, minor for features, major for breaking changes.

3. **Runtime-verify in the dev app** before pushing (the release workflow runs
   graph + MCP budget qualification, but a local sanity check avoids wasted
   release runs):
   ```bash
   cd apps/desktop
   pnpm tauri:dev          # open the app, exercise the changed surfaces
   pnpm test:unit
   pnpm lint
   pnpm exec tsc --noEmit
   ```
   For graph/MCP-touching changes, also run:
   ```bash
   pnpm qualify:graph
   cargo test --release --manifest-path src-tauri/Cargo.toml --test mcp_stdio
   ```

4. **Commit and push** the version bump:
   ```bash
   git add apps/desktop/src-tauri/tauri.conf.json
   git commit -m "Release v1.2.21"
   git push origin main
   ```

5. **Watch `auto-release.yml`.** It will:
   - Read the version, tag `v1.2.21`.
   - Skip if the release already exists (idempotent).
   - Create the GitHub release with generated notes.
   - Dispatch `release.yml` with `tag=v1.2.21`.

6. **Watch `release.yml`.** It will:
   - Checkout the tag (not main head).
   - Build + sign + notarize the macOS binary.
   - Upload the DMG, the signed updater archive, and `latest.json`.

7. **Verify auto-update.** Installed apps poll `latest.json` and self-update
   (no dialog). Confirm the release assets are present at
   `https://github.com/Codevetter/codevetter/releases/latest`.

## Abort / re-run

- If `release.yml` fails after the release was created, re-run it with
  `gh workflow run release.yml -f tag=v1.2.21` (it is idempotent on assets
  that already uploaded, but check for partial uploads).
- If you need to **cancel** a bad release, delete the GitHub release and tag
  **before** re-pushing; `auto-release.yml` will then re-create it. Deleting
  a release is a destructive operation — confirm with the owner first.

## Do not

- Do not push a version bump without runtime-verifying the changed surfaces.
- Do not edit `latest.json` by hand — it is a build artifact.
- Do not re-add `package-lock.json` or change the package manager.
- Do not skip the graph/MCP qualification for changes that touch
  `structural_graph/`, `history_graph.rs`, or `mcp/`.
