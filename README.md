<!-- generated-by: gsd-doc-writer -->
# CodeVetter

AI software quality workbench for agent-generated code — desktop-first, local-first, and focused on finding bugs that normal AI review misses.

## Product Direction

CodeVetter should end as a personal verification layer for AI-built software. The durable scope is:

- code review
- bug finding
- agent-written code verification
- debugging and replay
- synthetic user QA for software quality
- target-audience validation after executable testing
- AI step-through debugging
- codebase history explanation

The near-term wedge is not beating Claude, Codex, or hosted PR bots at generic review. It is a self-first workflow that makes agent output trustworthy: inspect the diff, understand the repo and prior intent, exercise the changed behavior, preserve evidence, fix one finding at a time, and re-check that the issue is gone.

## Current Coverage And Gaps

| Capability | Current state | Main gap |
|---|---|---|
| Code review | Review tab runs local diffs through CLI agents and persists findings. | Needs multi-pass specialist review, better AGENTS.md/project-context ingestion, and benchmarked catch-rate evidence. |
| Bug finding | Findings, severity, code viewer, and re-review loop exist. | Needs runtime evidence from tests/browser sessions/logs, not only static diff judgment. |
| Agent-written code verification | Aimed at agent output; fixes/re-reviews selected findings and emits a full verification handoff proof (`review-proof` + `agent-fix-packet`: per-finding evidence, fixed/reproduced/unchecked tallies, and a copyable reviewer handoff). | Needs to close the intent loop: did the fix actually resolve the original user goal, and which agent/prompt produced the change. |
| Debugging/replay | History indexes Claude/Codex sessions and can replay conversations. | Replay is not connected to files, diffs, failures, screenshots, tests, or review findings. |
| Synthetic user QA | Prototype — `QaReplay` (`/qa-replay`, linked from Roadmap) runs fixture-backed synthetic-QA loops with a live agent-runner track. | Needs real browser/app automation that drives the actual product, captures screenshots/traces, and converts failures into review findings. |
| Audience validation | Review can define a target audience and task, record agent-simulated/human/imported responses, diagnose agreement/order bias/cycles, and include the result in verification proof. | Human recruitment and hosted share links remain outside the local-first product; structured human evidence is entered or imported locally. |
| AI step-through debugger | Commit-intent debugger (`/intent-debugger`, linked from Roadmap) now runs over **real** recent commits — pick a repo, and it infers intent, risks, verification gaps, and agent-vs-human authorship per commit. | Still per-commit static analysis; needs a full execution timeline across agent actions, file edits, commands, test failures, and UI observations. |
| Codebase history explainer | Repo Unpacked generates repo briefs; History indexes agent sessions. | Needs commit/decision mining tied to touched files so reviews can catch intent regressions. |

The product should prefer narrow, evidence-backed loops over broad "code intelligence" surfaces. A feature is on-strategy when it helps answer: "What changed, why did the agent change it, what could break, can we reproduce it, did the fix actually work, and did the affected audience succeed with it?"

## Deployment & External Services

| Concern | Service |
|---------|---------|
| Desktop app | GitHub Releases — signed and notarized native macOS app with Sparkle updates (`appcast.xml`) |
| Landing page | Cloudflare Pages (`codevetter`, codevetter.com) — static Astro export |
| Database | Local SQLite via Rust `rusqlite` (desktop only, no server) |
| Auth | None — LLM provider API keys stored in user settings |
| AI | User-supplied keys (Anthropic / OpenAI / OpenRouter) |
| CI/CD | GitHub Actions — `auto-release.yml` cuts a `v<version>` release when the native version changes on `main`; `release.yml` signs, notarizes, qualifies, and uploads the macOS app; `deploy-landing.yml` deploys the landing page |

## Installation

### Ask Your Agent To Install

Give your coding agent this prompt:

```text
Install CodeVetter from the latest GitHub release:
https://github.com/Codevetter/codevetter/releases/latest

Confirm this is an Apple-silicon Mac on macOS 14 or newer, download CodeVetter-<version>-arm64.dmg, verify the release asset hash when available, install CodeVetter.app into /Applications, and launch it once to verify it starts. The app is Developer ID signed and notarized, so no quarantine workaround is needed; later releases arrive through the in-app updater.
```

Use the signed, notarized DMG for a first install; the matching ZIP is the Sparkle update archive.

### Development Install

```bash
# Clone and install dependencies
git clone https://github.com/Codevetter/codevetter.git
cd CodeVetter
pnpm install
```

Development requires Xcode, Swift, Rust, Node.js, and pnpm.

## Quick Start

1. Install dependencies (see above)
2. Build the Rust CLI and open the native workspace:
   ```bash
   pnpm core:build
   open apps/macos/CodeVetter.xcworkspace
   ```
3. Open the Review tab, pick a local repository, and run your first review through an installed CLI agent.

## Common Tasks

**Qualify the native desktop app**
```bash
pnpm test:native
```

**Test the Rust verification core, CLI, and MCP server**
```bash
pnpm core:test
```

**Build the landing page**
```bash
pnpm build:landing
```

## Monorepo Structure

```
apps/
  macos/               SwiftUI/AppKit desktop app — the sole product UI
  landing-page-astro/  Astro marketing site (static export, deployed to Cloudflare Pages — codevetter.com)
crates/
  codevetter-core/     Rust verification engine, CLI, MCP server, and SQLite persistence
docs/                  Canonical knowledge system — see docs/index.md
docs-site/             Blume presentation layer for docs/ (generated output is gitignored)
benchmarks/            Evaluation corpora (public catch-rate, agent PRs, runtime challenges)
evidence/              Committed run evidence (design, performance, reviews)
scripts/               Benchmark + corpus + deploy + doc-validation scripts
```

> The legacy Next.js `apps/landing-page/` was removed on 2026-07-03. The
> `packages/`, `workers/`, and `apps/dashboard/` surfaces referenced in older
> docs were removed in the 2026-07-11 desloppification sweep — see
> `docs/architecture/overview.md`.

## Tech Stack

| Layer | Technologies |
|---|---|
| Desktop app | SwiftUI + AppKit, macOS only |
| Verification core | Rust, SQLite, bundled CLI and MCP sidecar |
| Product boundary | Versioned JSON receipts shared by native UI, CLI, and MCP |
| Landing page | Astro 5 (static export → Cloudflare Pages) |
| Testing | Swift Testing, XCUITest, Rust tests, Node contract tests |
| Package manager | pnpm workspaces |

## License

ISC — see the root `package.json`.

<!-- ACTIVE-AI-TASK-LOG:START -->
## Active AI Task Log

This historical section records completed Active-AI product/design work so
future agents do not reopen duplicate UI tasks.

- Business lane: Core/status context
- Rule: do not create another broad "improve the UI" task unless the acceptance criteria differ materially from the tasks listed here.
- Source of truth for new task status: this repository's GitHub issues or
  OpenSpec changes. README entries are durable historical context only.

| Task ID | Title | Status |
|---|---|---|
| d6d19901 | CodeVetter: add verification summary handoff proof | done — compact verification summary panel added to QuickReview sidebar with fixed/reproduced/unchecked counts and copy-proof button |
| a59acaa7 | CodeVetter: add unchecked finding risk summary | done — QuickReview sidebar now lists unchecked findings grouped by severity with per-bucket risk copy explaining why each unchecked item still matters (above the verification handoff proof) |
| 79eff0b9 | CodeVetter: add revalidation checklist after fixes | done — when a finding's re-check status is "fixed", QuickReview renders a checklist derived from the finding's evidence fields (file/line, artifact, level, notes) so the user can tick off concrete revalidation steps; checklist state persists per finding alongside other evidence |
| 2b9ac8d9 | CodeVetter: add copyable reviewer handoff template | done — QuickReview's "Copy proof" button now emits a full markdown reviewer handoff (heading, score/agent/finding tallies, per-finding evidence with status icons, and a `### Next actions` checkbox list derived from unchecked findings, reproduced findings, and unticked revalidation items for fixed findings) so reviewers can paste proof directly into PRs/Slack |
<!-- ACTIVE-AI-TASK-LOG:END -->
