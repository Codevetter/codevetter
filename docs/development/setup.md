---
title: Local setup
description: Prerequisites, install, and how to run the desktop app and landing page.
sidebar:
  order: 1
---

# Local setup

## Prerequisites

- **Node.js 22** (matches CI).
- **Rust + Cargo** (stable) — required for the Tauri desktop app. See
  [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).
- **pnpm 10.33.2** — the repo pins `packageManager: pnpm@10.33.2` in the root
  `package.json`. Use `corepack enable` if you don't have it.
- **Playwright chromium** (first time only): `cd apps/desktop && npx playwright install chromium`.

## Install

From the repo root:

```bash
pnpm install
```

There is a single workspace (`apps/*`). Do not introduce `package-lock.json`
— the May-2026 Cloudflare Pages failure was caused by dual npm+pnpm lockfile
drift (see [knowledge/failed-approaches.md](../knowledge/failed-approaches.md)).

## Run the desktop app

```bash
cd apps/desktop
pnpm tauri:dev      # builds MCP sidecar + opens native Tauri window (Vite on :1420)
```

- Hot-reload works for the React frontend.
- Rust changes require a full rebuild.
- `pnpm dev` runs only the Vite dev server (no Tauri shell) — useful for UI
  work where IPC calls fall back to the `TAURI_NOT_AVAILABLE` path.

## Build a production binary

```bash
cd apps/desktop
pnpm tauri:build    # production Tauri app + DMG + updater archive
```

`tauri.conf.json`'s `beforeBuildCommand` runs `prepare:mcp-sidecar:release`
then `vite build`, so the MCP sidecar binary is bundled beside the app.

## Run the landing page

```bash
cd apps/landing-page-astro
pnpm install
pnpm dev            # Astro dev server
pnpm build          # static export → apps/landing-page-astro/dist
```

Deploy is via `deploy-landing.yml` to Cloudflare Pages — see
[operations/landing-deploy.md](../operations/landing-deploy.md).

## Environment

The desktop app reads only `DEBUG_TAURI_DRIVER` (see `.env.example`). All
other config (LLM provider keys, model, tone, standards packs) is entered in
the Settings tab and persisted via Tauri preferences — see
[configuration.md](./configuration.md).

## Common commands (root)

```bash
pnpm install              # install all workspace deps
pnpm lint                 # biome check . (root)
pnpm format               # biome format --write .
pnpm bench:public         # public 27-case catch-rate benchmark
pnpm bench:catch-rate     # local catch-rate benchmark
pnpm deploy               # manual deploy helper (scripts/manual-deploy.mjs)
```

## Common commands (apps/desktop)

```bash
pnpm dev                  # Vite only (port 1420)
pnpm tauri:dev            # full Tauri app
pnpm tauri:build          # production binary
pnpm test                 # Playwright e2e
pnpm test:unit            # node --test over src/**/*.test.ts
pnpm lint                 # biome check .
pnpm build                # vite build
pnpm prepare:mcp-sidecar  # build MCP sidecar binary
pnpm bench                # build + bundle budget + Rust benches
pnpm qualify:graph        # enforced graph + UI data-path budgets
```

See [testing.md](./testing.md), [performance.md](./performance.md), and
[benchmark.md](./benchmark.md) for the test/perf surfaces.
