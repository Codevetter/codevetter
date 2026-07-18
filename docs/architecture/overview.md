---
title: Architecture overview
description: How the CodeVetter desktop app is layered and where each concern lives.
sidebar:
  order: 1
---

# Architecture overview

CodeVetter is a **local-first macOS desktop application** for evidence-backed
review of agent-generated code. There is no server. The review engine, session
indexer, structural graph, history workbench, and MCP sidecar all run on the
user's machine against a local SQLite database.

## Top-level shape

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri 2 native shell  (apps/desktop/src-tauri)             │
│   ├─ Rust backend: commands/, db/, mcp/, agent/, talk.rs    │
│   └─ SQLite via rusqlite (apps/desktop/src-tauri/codevetter) │
├─────────────────────────────────────────────────────────────┤
│  Tauri IPC bridge  (invoke() → typed wrappers)              │
├─────────────────────────────────────────────────────────────┤
│  React 19 + Vite webview  (apps/desktop/src)                │
│   ├─ pages/        route screens                            │
│   ├─ components/   feature panels + shadcn/ui primitives    │
│   └─ lib/          review-service, tauri-ipc, analytics, …  │
└─────────────────────────────────────────────────────────────┘
```

The webview is the *only* user surface. The Rust side does file I/O, git,
SQLite, subprocess spawning (CLI agents), the structural graph, history
reconstruction, and the optional MCP sidecar.

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| UI (React) | `apps/desktop/src/pages/`, `apps/desktop/src/components/` | Route screens, panels, shadcn/ui primitives. State is local; persistence goes through IPC. |
| Service (TS) | `apps/desktop/src/lib/` | Review pipeline orchestration, analytics, agent-fix packets, audience validation, synthetic QA, intent debugger, project workspace. Pure-ish; calls IPC for side effects. |
| IPC bridge | `apps/desktop/src/lib/tauri-ipc.ts` | Typed `invoke()` wrappers + `isTauriAvailable()` guard so the same TS runs in a plain browser with a distinguishable `TAURI_NOT_AVAILABLE` error. |
| Rust commands | `apps/desktop/src-tauri/src/commands/` | ~50 command modules: review, unpack, history, graph, mcp access, agent, sessions, taste, trex, audience, synthetic qa, accounts, intel, observability, perf bench. |
| DB | `apps/desktop/src-tauri/src/db/` (`schema.rs`, `queries.rs`) | SQLite schema + migrations + queries via `rusqlite`. Single file at the Tauri app data dir. |
| MCP sidecar | `apps/desktop/src-tauri/src/mcp/` | Opt-in, read-only, stdio-only MCP server binary bundled beside the app. See [mcp-sidecar.md](./mcp-sidecar.md). |
| Agent runner | `apps/desktop/src-tauri/src/agent/` | Spawns `claude-code` / `codex` / `gemini` CLI subprocesses, PTY terminals, optional browser agent (feature-gated `chromiumoxide`). |

## Critical invariants

- **No server, no cloud calls from the product.** The only network egress is
  the user-supplied LLM provider (Anthropic / OpenAI / OpenRouter) and GitHub
  `api.github.com` for PR reads. The CSP in `tauri.conf.json` pins exactly
  those origins.
- **`isTauriAvailable()` guard everywhere.** Every IPC call goes through
  `safeInvoke` so the same React code runs in `vite dev` (browser-only) with a
  fallback path. Do not bypass it.
- **rusqlite, not `@tauri-apps/plugin-sql`.** The DB layer is Rust-internal.
  The old `plugin-sql` dep was removed in the 2026-07-11 desloppification
  sweep — do not re-add it.
- **Single package manager: pnpm.** Root `packageManager: pnpm@10.33.2`. The
  May-2026 Cloudflare Pages failure was caused by dual npm+pnpm lockfile drift;
  do not reintroduce `package-lock.json`.
- **Review engine runs in the webview (TypeScript).** Rust shells out to git
  and CLI agents but does not score findings. Scoring/prompt/dedup live in
  `apps/desktop/src/lib/review-service.ts` and friends.
- **Structural graph + history are navigation context, not findings sources.**
  Trusted paths fed into Review/proof can orient a reviewer but cannot
  independently create findings, severities, or verified-runtime claims. See
  [graph-and-history.md](./graph-and-history.md).

## Deeper docs

- [ipc-and-commands.md](./ipc-and-commands.md) — the IPC bridge and the command map.
- [data-model.md](./data-model.md) — SQLite tables and persistence boundaries.
- [review-pipeline.md](./review-pipeline.md) — review → fix → re-review → proof flow.
- [graph-and-history.md](./graph-and-history.md) — canonical structural graph + release history workbench.
- [repo-unpacked.md](./repo-unpacked.md) — evidence-backed repo briefs.
- [mcp-sidecar.md](./mcp-sidecar.md) — opt-in local MCP server.
- [history-evidence-import.md](./history-evidence-import.md) — importing provider-side outcomes.
- [decisions/](./decisions/) — pinned technical decisions (MCP SDK, OSS integrations, Graphify parity).

## What was removed (do not resurrect)

The 2026-07-11 desloppification sweep removed ~3,600 lines of dead surface.
Stale architecture docs describing the pre-sweep world are archived under
[`../archive/`](../archive/) and [`../archive/planning-codebase/`](../archive/planning-codebase/).
Do not bring back:

- `packages/` workspace libs (`review-core`, `ai-gateway-client`, `db`, `shared-types`) — review logic now lives in `apps/desktop/src/lib/`.
- `workers/api`, `workers/review` Cloudflare Workers — no cloud review path exists.
- `apps/dashboard` Next.js dashboard — removed.
- `apps/landing-page` Next.js site — superseded by `apps/landing-page-astro`.
- GitHub OAuth / GitHub App / D1 / Postgres / session secrets — none of this is in the product. The only env var the desktop app reads is `DEBUG_TAURI_DRIVER` (see `.env.example`).
- `@tauri-apps/plugin-sql`, `tauri-driver` native e2e, `LiveAgentRunner`, `SaasMakerTasksPanel`, the `talks` / `session_intelligence` / `github_ops` Rust modules.
