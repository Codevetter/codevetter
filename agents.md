# agents.md — CodeVetter

## Repository operating rules

This repository is independently operable. Its tracked instructions and
commands are authoritative; no sibling Fleet checkout is required. Protect
production stability, keep changes scoped, verify work with repo-local checks,
and record durable follow-up in this repository's GitHub Issues.

## Purpose
CodeVetter is an execution-backed verification and evaluation system for coding
agents. It determines whether an agent completed a software task correctly
using reproducible runtime evidence, not another LLM opinion. CLI/MCP and the
machine-readable verification bundle are the primary product surfaces; the
desktop app is a local viewer.

## Product focus

- The core loop is: **task → agent change → executable verification → evidence
  → measurable verdict**.
- Enter **Core Mode** when the owner says `core`, `focus`, `verification`,
  `evals`, or asks for the next core priority. In Core Mode, only advance the
  benchmark corpus, evaluation harness, deterministic graders, sandbox/runtime
  evidence, failure taxonomy, regression comparisons, or reliability/cost/
  latency measurement.
- In Core Mode, actively redirect feature accumulation: no Agent Island,
  general agent chat/mission control, usage dashboards, audience simulation,
  generic history explanation, model-picker polish, new visual surfaces, or
  generic static-review work unless it is required by the verification loop.
- Enter **Side Quest Mode** when the owner explicitly says `side quest` or asks
  for non-core work. Side quests are allowed: keep them bounded, label them as
  side work, and do not let them silently change the core roadmap. Return to
  Core Mode only when the owner signals it.
- Prefer depth in TypeScript/Node web tasks with browser and API behavior before
  adding languages or domains.

## Stack
- Framework: Tauri 2 (Rust backend) + React 19 + Vite (desktop frontend)
- Language: TypeScript (frontend), Rust (backend)
- Styling: Tailwind CSS v3 + shadcn/ui (Radix + CVA), warm amber accent (#d4a039)
- DB: SQLite via `rusqlite` in the Rust backend (local only, no server)
- Auth: None (local desktop app; LLM API keys stored in user settings)
- Testing: Playwright (e2e)
- Deploy: GitHub Releases (Tauri build + `@tauri-apps/plugin-updater` auto-updater)
- Package manager: pnpm (workspaces root; `packageManager: pnpm@10.33.2` in package.json)

## Repo structure
```
apps/
  desktop/              # Tauri 2 + React 19 desktop app (the active product)
    src/                # React frontend: components/, lib/, pages/, App.tsx
    src-tauri/          # Rust backend: src/main.rs, commands/, db/, mcp/, agent/, talk.rs
    src/lib/tauri-ipc.ts  # Typed invoke() wrappers for all Tauri commands
    vite.config.ts      # Vite config (outDir: "out")
    playwright.config.ts # e2e test config
    tests/              # Playwright e2e tests
  landing-page-astro/   # Astro marketing site → Cloudflare Pages (codevetter.com)
docs/                   # Canonical knowledge system — see docs/index.md
benchmark/              # Public catch-rate benchmark cases + harness
scripts/                # Benchmark + deploy + doc-validation scripts
openspec/               # Spec-driven workflow (specs + changes/archive)
.github/workflows/      # ci, auto-release, release, deploy-landing, weekly, docs
blume.config.ts         # Blume presentation layer for docs/ (NOT the source of truth)
STATUS.md               # Compatibility pointer
PROJECT_STATUS.md       # Current/shipped product truth (fleet source of truth)
```

## Key commands
```bash
# From apps/desktop/
pnpm dev           # Vite dev server only (port 1420)
pnpm tauri:dev     # Full Tauri app in dev mode (requires Rust toolchain)
pnpm tauri:build   # Production Tauri binary
pnpm test          # Playwright e2e tests
pnpm test:unit     # Node test runner over src/**/*.test.ts
pnpm lint          # Biome check .

# From repo root
pnpm install           # Install all workspace deps
pnpm lint              # Biome check . (root)
pnpm knip:strict       # Unused code and dependency gate
pnpm quality:complexity # Changed-file cognitive-complexity gate
pnpm quality:cycles    # Runtime import-cycle gate
pnpm quality:duplication # Clone-regression gate
pnpm quality:dependencies # High/critical production advisory gate
node scripts/check-docs.mjs   # Validate docs (links, frontmatter, structure)
```

## Architecture notes
- **Desktop binary, no server.** The review pipeline runs in the Rust backend (`src-tauri/src/commands/review.rs`); the React webview is the UI. Works offline (calls the user's configured LLM providers directly).
- **Multi-LLM provider**: Anthropic, OpenAI, OpenRouter. Keys stored in user settings.
- **Tauri IPC**: all Rust commands called via typed wrappers in `src/lib/tauri-ipc.ts` → `invoke()` → `src-tauri/src/commands/`.
- **`isTauriAvailable()` guard**: all IPC calls wrapped so React code also works in plain browser.
- **DB is `rusqlite`, not `@tauri-apps/plugin-sql`.** Do not re-add `plugin-sql` (removed in the 2026-07-11 desloppification sweep). See `docs/architecture/data-model.md`.
- **Single package manager: pnpm.** Do not reintroduce `package-lock.json` — dual-lockfile drift broke Cloudflare Pages in May 2026. See `docs/knowledge/failed-approaches.md`.
- **Nav (7 tabs)**: Usage (`/`), Repo Unpack (`/unpack`), Work (`/agents`), Board (`/board`), Review (`/review`), Testing (`/trex`), Settings (`/settings`). Full surface map in `docs/product/surfaces.md`.
- **GH Actions**: `ci.yml` (lint + typecheck + unit + MCP + build), `auto-release.yml` → `release.yml` (Tauri binaries), `deploy-landing.yml` (Cloudflare Pages), `weekly.yml` (Mon cron canary), `docs.yml` (doc validation). See `docs/operations/`.
- Husky pre-commit runs lint-staged on `apps/desktop/src/**/*.{ts,tsx}`; pre-push runs lint + secret scan.

<!-- FLEET-GUIDANCE:START -->

## Fleet Guidance

### Adding Tasks
- Track CodeVetter work in this repository's GitHub issues or OpenSpec changes.
- Keep cross-project infrastructure work in Fleet Workspace, not SaaS Maker.

### Using SaaS Maker
- Do not use the retired SaaS Maker task queue or API as a system of record.
- Fleet Workspace owns shared project metadata and infrastructure; CodeVetter
  remains independently versioned and deployed.

### Free AI First
- Prefer free/local AI paths for routine development and analysis: the `free-ai` gateway, local models, provider free tiers, and cached context.
- Escalate to paid models only when complexity, correctness risk, or missing capability justifies the cost.
- Note any paid-AI use in the task or handoff when it materially affects cost, reproducibility, or future maintenance.

<!-- FLEET-GUIDANCE:END -->

## Documentation

The committed Markdown under `docs/` is the **source of truth** for product
knowledge, architecture, decisions, workflows, operations, learnings, and
failed approaches. Blume (`blume.config.ts`) is only the presentation/search
layer — generated output (`.blume/`) is gitignored.

- **Navigation hub**: `docs/index.md`
- **Current/shipped product truth**: `PROJECT_STATUS.md`
- **Open work**: GitHub Issues
- **Working on docs**: `docs/development/docs.md` (rules, validation, Blume rendering)

### Documentation maintenance rules

1. **One canonical home per fact.** Don't re-explain what a doc already covers — link to it.
2. **Markdown is the source of truth.** Code/config stays authoritative for implementation details and schedules.
3. **Don't duplicate code-discoverable facts.** Link to the file or command.
4. **Mark unresolved work explicitly** in GitHub Issues — do not invent information.
5. **Prefer `docs/archive/<name>.md` over deletion** (with a `stale-` prefix and a one-line supersession note) so git rename history survives.
6. **Keep pages 150–300 lines.** Split catch-all pages.
7. **Validate before commit**: `node scripts/check-docs.mjs` (CI runs it via `.github/workflows/docs.yml`).
8. **Use `git mv`** when reorganizing so history is preserved, then update inbound links.
