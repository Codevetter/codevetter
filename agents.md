# agents.md — CodeVetter

## Purpose
AI desktop code review tool for agent-generated code — runs offline as a Tauri binary, reviews diffs with pluggable LLM providers.

## Stack
- Framework: Tauri 2 (Rust backend) + React 19 + Vite (desktop frontend)
- Language: TypeScript (frontend), Rust (backend)
- Styling: Tailwind CSS v3 + shadcn/ui (Radix + CVA), warm amber accent (#d4a039)
- DB: SQLite via `@tauri-apps/plugin-sql` (local only, no server)
- Auth: None (local desktop app; LLM API keys stored in user settings)
- Testing: Playwright (e2e)
- Deploy: GitHub Releases (Tauri build + `@tauri-apps/plugin-updater` auto-updater)
- Package manager: npm workspaces (root) — NOT pnpm

## Repo structure
```
apps/
  desktop/              # Tauri 2 + React 19 desktop app (the active product)
    src/                # React frontend: components/, lib/, pages/, App.tsx
    src-tauri/          # Rust backend: src/main.rs, commands/, db/, talk.rs
    src/lib/tauri-ipc.ts  # Typed invoke() wrappers for all Tauri commands
    vite.config.ts      # Vite config
    playwright.config.ts # e2e test config
    tests/              # Playwright e2e tests
docs/                   # Architecture, testing, development docs
.github/workflows/
  ci.yml                # Lint + Playwright tests
  release.yml           # Tauri platform binaries → GitHub Releases
.planning/codebase/     # Architecture, conventions, integrations
```

## Key commands
```bash
# From apps/desktop/
npm run dev           # Vite dev server (port 1420)
npm run tauri:dev     # Full Tauri app in dev mode (requires Rust toolchain)
npm run tauri:build   # Production Tauri binary
npm run test          # Playwright e2e tests
npm run lint          # ESLint

# From repo root
npm install           # Install all workspace deps
```

## Architecture notes
- **Desktop binary, no server.** Review engine runs entirely in the webview (TypeScript). Works offline.
- **Multi-LLM provider**: Anthropic, OpenAI, OpenRouter. Keys stored in user settings.
- **Tauri IPC**: all Rust commands called via typed wrappers in `src/lib/tauri-ipc.ts` → `invoke()` → `src-tauri/src/commands/`.
- **`isTauriAvailable()` guard**: all IPC calls wrapped so React code also works in plain browser.
- **FIXED**: Dead `@code-reviewer/*` workspace deps removed — `packages/` dir no longer exists and is no longer referenced. Build passes.
- **Active screens**: Dashboard (usage/token analytics), History (session search), Review (`/review` — AI code review with diff + fix). Other tabs (Board, Workspaces) are legacy — do not invest in them.
- **GH Actions**: `ci.yml` runs lint + Playwright; `release.yml` builds platform binaries and uploads to GitHub Releases.
- Husky pre-commit runs lint-staged on `apps/desktop/src/**/*.{ts,tsx}`; pre-push hook also configured.

<!-- FLEET-GUIDANCE:START -->

## Fleet Guidance

### Adding Tasks
- Add durable work items in SaaS Maker Cockpit Tasks when the task affects product behavior, deployment, user feedback, or fleet maintenance.
- Include the project slug, a concise title, acceptance criteria, priority/status, and links to relevant code, issues, traces, or dashboards.
- If task discovery starts locally in an editor or agent session, mirror the durable next step back into SaaS Maker before handoff.

### Using SaaS Maker
- Treat SaaS Maker as the system of record for project metadata, feedback, tasks, analytics, testimonials, changelog, and fleet visibility.
- Prefer API-first workflows through `fnd api`, the SDK, or widgets instead of one-off scripts when interacting with SaaS Maker features.
- Keep this agent file aligned with the project record when operating rules, integrations, or deployment conventions change.

### Free AI First
- Prefer free/local AI paths for routine development and analysis: the `free-ai` gateway, local models, provider free tiers, and cached context.
- Escalate to paid models only when complexity, correctness risk, or missing capability justifies the cost.
- Note any paid-AI use in the task or handoff when it materially affects cost, reproducibility, or future maintenance.

<!-- FLEET-GUIDANCE:END -->

## Active context


<claude-mem-context>
# Memory Context

# [CodeVetter] recent context, 2026-05-02 3:00pm GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (14,452t read) | 307,979t work | 95% savings

### Apr 25, 2026
S76 CodeVetter token consumption not updating in real-time — fix real-time stats display + unblock pre-commit hook (Apr 25 at 11:40 AM)
S73 CodeVetter WIP branch — modified files in token stats fix attempt (Apr 25 at 11:40 AM)
S78 CodeVetter — ESLint downgrade trade-off question: repo vs sass-maker standard (Apr 25 at 11:41 AM)
S83 Fix CodeVetter token stats real-time update bug + unblock broken ESLint pre-commit hook (Apr 25 at 11:42 AM)
S90 CodeVetter — does git push trigger auto-release and auto-update? Version bump to 1.1.3 initiated. (Apr 25 at 11:44 AM)
S91 CodeVetter token consumption display bug — stats frozen until app restart, fix shipped as v1.1.3 (Apr 25 at 11:48 AM)
S328 CodeVetter CI now passing — fleet failure resolved (Apr 25 at 3:27 PM)
### May 2, 2026
452 1:43p 🔵 CodeVetter CI failure root — Lint job failing, all downstream jobs skipped
453 1:44p 🔵 CodeVetter CI run 24970083824 failed due to workflow file issue, not lint
455 " 🔵 saas-maker repo has v1 tag — workflow action reference can resolve
461 1:45p 🔵 CodeVetter CI failure root cause — missing package-lock.json
462 " 🔴 CodeVetter CI — switched from npm ci to pnpm to fix missing package-lock.json failure
463 " 🔴 CodeVetter CI fix committed and pushed — awaiting new run verification
464 " 🔴 CodeVetter CI now passing — run 25044218143 completed with success
465 1:47p ✅ CodeVetter root package.json — added @saas-maker/eslint-config devDependency
466 1:48p ✅ CodeVetter — @saas-maker/eslint-config confirmed in package-lock.json after npm install
470 " 🔵 CodeVetter CI lint errors — simple-import-sort violations across multiple files
473 1:49p 🔵 CodeVetter desktop — ESLint errors blocking CI
475 " 🔵 CodeVetter desktop — exact ESLint error locations mapped
478 1:50p 🔵 CodeVetter desktop — lint error code patterns inspected, fixes identified
488 1:52p 🔴 CodeVetter CI TypeScript lint fixes — 4 files patched
489 " 🔴 CodeVetter CI — floating promise fixes in QuickReview and Settings
490 " 🔵 CodeVetter lint — 3 errors remain after initial floating-promise sweep
504 1:54p 🔴 CodeVetter CI failure — Settings.tsx lint fix
505 " 🔵 CodeVetter — LinearUser type missing from tauri-ipc.ts exports
506 1:55p 🔴 CodeVetter — added missing type exports to tauri-ipc.ts
508 " 🔴 CodeVetter — saveReview cast to satisfy safeInvoke signature
516 1:57p 🔴 CodeVetter finding-card.tsx — type mismatch fixed: ReviewFinding → CliReviewFinding
517 " 🔴 CodeVetter tauri-ipc.ts — double-cast fix for saveReview input arg
518 " 🔵 CodeVetter CI workflow — uses npm ci + workspace lint + tsc --noEmit
520 " 🔵 CodeVetter — 28 files changed in working tree ahead of CI fix commit
521 " 🔴 CodeVetter CI fix committed — inline workflow, ESLint config, type fixes
526 1:59p 🔵 CodeVetter CI failure root cause — unsorted imports in Home.tsx
527 " 🔴 CodeVetter CI lint fixed — sorted imports in Home.tsx
528 2:00p 🔴 CodeVetter CI now passing — fleet failure resolved
535 2:02p 🔵 CodeVetter monorepo has apps/landing-page/ directory
537 " 🔵 CodeVetter Cloudflare Pages build failing on feat/landing-page-overhaul despite GitHub CI passing
539 2:03p 🔵 CodeVetter Cloudflare Pages — widespread deployment failures across both main and preview branches
541 " 🔵 wrangler 4.85.0 has no `api` subcommand — CF REST API must be called via curl/fetch directly
542 " 🔵 Wrangler auth via CLOUDFLARE_API_TOKEN env var — curl to CF API viable
544 " 🔵 rtk proxy strips actual CF API response values — replaces with type hints (string, int, date?)
545 2:04p 🔵 CodeVetter — GitHub CI passes but Cloudflare Pages build fails on feat/landing-page-overhaul
547 " 🔵 CodeVetter CF Pages root cause — pnpm-lock.yaml out of sync with root package.json
548 " 🔵 CodeVetter root package.json structure confirmed — @saas-maker/eslint-config absent from lockfile
549 " 🔴 CodeVetter pnpm-lock.yaml regenerated — @saas-maker/eslint-config 1.0.5 now in lockfile
550 2:05p 🔵 CodeVetter — uncommitted Tauri/desktop changes present alongside lockfile fix
551 " 🔴 CodeVetter — pnpm-lock.yaml staged in isolation on feat/landing-page-overhaul
552 " 🔴 CodeVetter lockfile fix committed as f248b85, push needs --set-upstream
553 " 🔴 CodeVetter lockfile fix pushed — CF Pages rebuild triggered on feat/landing-page-overhaul
554 " 🔴 CodeVetter CF Pages fix confirmed — deployment 014d7453 for f248b85 shows Active
555 2:07p 🔵 CodeVetter CF Pages root cause — wrong output directory config
556 " 🔵 CodeVetter desktop vite.config.ts sets outDir to "out" not "dist"
557 " 🔵 CodeVetter CF Pages build_config confirmed — root_dir apps/desktop, destination_dir dist
558 2:08p 🔴 CodeVetter CF Pages reconfigured — root_dir changed from apps/desktop to apps/landing-page
559 2:09p 🔴 CodeVetter landing page CF Pages build failure — TypeScript type error in Footer.tsx
560 2:10p 🔴 CodeVetter landing page build fixed and staged for CF Pages deploy
561 " 🔴 CodeVetter landing page fix committed and pushed — commit e245cd6
S337 Fix CodeVetter fleet failure — Cloudflare Pages build/deploy failure on feat/landing-page-overhaul (May 2 at 2:10 PM)
**Investigated**: - CF Pages deployment list for codevetter project on branch feat/landing-page-overhaul
    - Root causes of build failures across multiple deployment attempts
    - TypeScript and import sort errors in landing page files
    - CF Pages project configuration (root_dir, dest_dir, build_command)
    - pnpm-lock.yaml freshness vs package.json dependencies

**Learned**: - CF Pages project was misconfigured to build apps/desktop instead of apps/landing-page
    - Stale pnpm-lock.yaml (missing @saas-maker/eslint-config) caused ERR_PNPM_OUTDATED_LOCKFILE in frozen CI installs
    - Footer.tsx had union type missing icon? field causing TypeScript error
    - 12 files violated simple-import-sort rule blocking ESLint CI gate
    - Deployment 45d9b4f5 (commit e245cd6) is now Active — first successful preview on this branch
    - Previous deployments f248b85 (two attempts: 014d7453 and edc838eb) both show Failure

**Completed**: - pnpm-lock.yaml regenerated and committed (fixes frozen-lockfile CI failure)
    - CF Pages project reconfigured via API: root_dir→apps/landing-page, dest_dir→out, build_command updated
    - Footer.tsx ColItem type fixed to include optional icon field
    - 12 landing page files auto-fixed for import sort violations via eslint --fix
    - All fixes landed across 2 commits; desktop/Tauri uncommitted changes left untouched
    - Latest deployment 45d9b4f5 shows Active status on branch feat/landing-page-overhaul

**Next Steps**: Background poll running to confirm deployment 45d9b4f5 remains Active (not transitioning to failure). Once confirmed stable, task can be marked complete.


Access 308k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
