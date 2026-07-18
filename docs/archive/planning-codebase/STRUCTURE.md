# Codebase Structure

**Analysis Date:** 2026-04-05

## Directory Layout

```
/Users/sarthakagrawal/Desktop/CodeVetter/
├── apps/                          # Applications
│   ├── desktop/                   # Tauri + React desktop app (PRIMARY PRODUCT)
│   │   ├── src/                   # React source (components, pages, hooks, lib)
│   │   ├── src-tauri/             # Rust backend (Tauri commands)
│   │   ├── tests/                 # Playwright end-to-end tests
│   │   ├── public/                # Static assets
│   │   ├── vite.config.ts         # Vite configuration
│   │   ├── tauri.conf.json        # Tauri window, app settings
│   │   └── package.json           # Dependencies
│   ├── landing-page/              # Next.js 15 marketing site (Vercel)
│   └── dashboard/                 # Next.js 15 web dashboard (on hold, legacy)
├── packages/                      # Shared libraries
│   ├── review-core/               # Review engine (scoring, parsing, GitHub API)
│   ├── ai-gateway-client/         # OpenAI-compatible LLM client
│   ├── db/                        # Database abstraction (D1, Postgres, in-memory)
│   └── shared-types/              # TypeScript type contracts
├── workers/                       # Cloudflare Workers
│   ├── api/                       # REST API (Hono) — auth, workspaces, webhooks
│   └── review/                    # Async review queue + GitHub webhook handler
├── .planning/                     # GSD planning artifacts
│   └── codebase/                  # Architecture documentation
├── docs/                          # Deployment, architecture docs
├── .husky/                        # Git hooks (pre-commit linting)
├── .github/                       # GitHub workflows (CI/CD)
├── agents.md                      # Agent context (key conventions, stack, current focus)
├── package.json                   # Monorepo root (npm workspaces)
├── tsconfig.json                  # Shared TypeScript config
├── eslint.config.js               # Shared ESLint config
└── README.md                      # Quick start guide
```

## Directory Purposes

**apps/desktop/:**
- Purpose: Core product — desktop app for code review
- Contains: React components, TypeScript services, Rust Tauri backend, E2E tests
- Key files: `src/main.tsx` (entry), `src/App.tsx` (routing), `src-tauri/src/main.rs` (Tauri init), `src-tauri/src/commands/mod.rs` (all IPC handlers)

**apps/desktop/src/:**
- Purpose: React application source
- Contains: Components, pages, hooks, utilities, Tauri IPC bridge
- Structure:
  - `components/` — shadcn/ui wrappers, feature components (DiffViewer, FindingCard, etc.)
  - `pages/` — route pages (QuickReview, Sessions, Agents, Settings)
  - `hooks/` — custom hooks (useReview, useChatStream)
  - `lib/` — business logic (review-service, orchestrator, review-loop, tauri-ipc)

**apps/desktop/src-tauri/src/:**
- Purpose: Rust Tauri backend
- Contains: Command handlers, database queries, git operations
- Structure:
  - `commands/` — command modules (review.rs, files.rs, sessions.rs, git.rs, etc.)
  - `main.rs` — Tauri app initialization, window setup

**apps/desktop/tests/:**
- Purpose: Playwright end-to-end tests
- Contains: Test suites for UI flows
- Pattern: `*.spec.ts` files, run via `npm test`

**packages/review-core/src/:**
- Purpose: Shared review logic (pure functions, no I/O except GitHub API reads)
- Contains:
  - `scoring.ts` — compute score, find fingerprints, determine actions
  - `prompt.ts` — build LLM prompts, parse responses, coerce findings
  - `semantic.ts` — extract symbols, find duplicates, semantic analysis
  - `github.ts` — GitHub API functions (read PRs, post reviews)
  - `formatting.ts` — markdown formatting for output
  - `language.ts` — language detection, file type checks

**packages/ai-gateway-client/src/:**
- Purpose: LLM API abstraction
- Contains: OpenAI-compatible client with streaming, token counting, retry logic

**packages/db/src/:**
- Purpose: Database abstraction layer
- Contains:
  - `controlPlane.ts` — Interface: UpsertSession, GetWorkspace, etc. (pure functions, in-memory)
  - `d1ControlPlane.ts` — D1/Postgres implementation
  - `schema.ts` — Database schema definitions
  - `migrations.ts` — Migration runner
  - `queryHelpers.ts` — SQL helpers

**packages/shared-types/src/:**
- Purpose: TypeScript type contracts
- Contains:
  - `review.ts` — ReviewFinding, ReviewRunRecord, ReviewComment
  - `gateway.ts` — LLM request/response types
  - `v1.ts` — Worker job types (IndexingJob, ReviewJob, WorkerJob)
  - `agent.ts` — Agent persona types

**workers/api/src/:**
- Purpose: Cloudflare Worker REST API
- Contains: Hono routes, session validation, workspace CRUD, GitHub OAuth, webhook handling
- Entry: `index.ts` (exports `app` or Hono handler)

**workers/review/src/:**
- Purpose: Cloudflare Worker async review queue
- Contains:
  - `index.ts` — Job polling loop
  - `handlers.ts` — Job handler (indexing/review logic)
  - `queue.ts` — D1 queue adapter
  - `indexing.ts` — Tree-sitter chunking
  - `github.ts` — GitHub API (fetch PR files, post reviews)
  - `config.ts` — Environment config

## Key File Locations

**Entry Points:**
- Desktop React: `apps/desktop/src/main.tsx` (ReactDOM.createRoot, ErrorBoundary)
- Desktop Router: `apps/desktop/src/App.tsx` (Routes, navigation)
- Desktop Tauri: `apps/desktop/src-tauri/src/main.rs` (window init)
- API Worker: `workers/api/src/index.ts` (Hono app)
- Review Worker: `workers/review/src/index.ts` (scheduled handler)

**Core Business Logic:**
- Review pipeline: `apps/desktop/src/lib/review-service.ts` (orchestrates review flow)
- Feedback loop: `apps/desktop/src/lib/review-loop.ts` (auto-fixes via retry)
- Orchestrator: `apps/desktop/src/lib/orchestrator.ts` (multi-step workflows)
- IPC bridge: `apps/desktop/src/lib/tauri-ipc.ts` (typed Rust↔JS calls)

**Review Engine (Pure Functions):**
- Scoring: `packages/review-core/src/scoring.ts`
- Prompts: `packages/review-core/src/prompt.ts`
- Semantic: `packages/review-core/src/semantic.ts`
- GitHub: `packages/review-core/src/github.ts`

**Database:**
- Interface: `packages/db/src/controlPlane.ts`
- Implementation: `packages/db/src/d1ControlPlane.ts`
- Schema: `packages/db/src/schema.ts`
- Migrations: `packages/db/src/migrations.ts`

**Configuration:**
- Tauri config: `apps/desktop/tauri.conf.json`
- Vite config: `apps/desktop/vite.config.ts`
- TypeScript: `tsconfig.json` (root), `apps/desktop/tsconfig.json`
- ESLint: `eslint.config.js`
- Tailwind: `apps/desktop/tailwind.config.js`

**Testing:**
- E2E: `apps/desktop/tests/*.spec.ts` (Playwright)
- Unit: `packages/review-core/src/*.test.ts` (Vitest)
- Config: `apps/desktop/playwright.config.ts`

## Naming Conventions

**Files:**
- React components: PascalCase (`.tsx`) — `QuickReview.tsx`, `FindingCard.tsx`
- Utilities/services: camelCase (`.ts`) — `review-service.ts`, `tauri-ipc.ts`
- Hooks: `use*` pattern — `use-review.ts`, `use-chat-stream.ts`
- Tests: `*.test.ts` or `*.spec.ts` — `agentDetection.test.ts`, `control-plane.test.ts`
- Rust modules: snake_case (`.rs`) — `review.rs`, `files.rs`, `git.rs`

**Directories:**
- Feature directories: kebab-case or plural — `components/`, `pages/`, `hooks/`, `commands/`
- Workspace directories: descriptor-case — `apps/`, `packages/`, `workers/`

**Code Style:**
- Components: Default exports, `export default function ComponentName(props: Props) { ... }`
- Utilities: Named exports, `export function utilName(arg: Type): ReturnType { ... }`
- Types: Exported inline or in type files — `export type ReviewFinding = { ... }`
- Constants: UPPER_SNAKE_CASE for module-level — `const PASS_THRESHOLD = 80`

## Where to Add New Code

**New Feature in Desktop App:**
- Primary code: `apps/desktop/src/lib/` (service/hook) or `apps/desktop/src/pages/` (new page)
- Components: `apps/desktop/src/components/` (reusable) or within page file (if page-specific)
- Tauri command: `apps/desktop/src-tauri/src/commands/{feature}.rs`
- Tests: `apps/desktop/tests/{feature}.spec.ts` (E2E) or `src-tauri/tests/` (Rust unit tests)
- Exports: If shared, add to `apps/desktop/src/lib/tauri-ipc.ts` (IPC bridge)

**New Review-Core Logic:**
- Implementation: `packages/review-core/src/{feature}.ts` (e.g., `packages/review-core/src/custom-rules.ts`)
- Type contract: Add to `packages/shared-types/src/review.ts` if needed
- Tests: `packages/review-core/src/{feature}.test.ts` (Vitest)
- Export: Add to `packages/review-core/src/index.ts`

**New Database Query:**
- Interface method: Add to `packages/db/src/controlPlane.ts` (abstract interface)
- Implementation: Add to `packages/db/src/d1ControlPlane.ts` (SQL implementation)
- Type: Define in `packages/shared-types/src/v1.ts` (if record type) or inline
- Migration: Add to `packages/db/src/migrations.ts` if schema changes

**New Cloudflare Worker Endpoint:**
- Route: Add to `workers/api/src/index.ts` (e.g., `app.post('/api/reviews', async (c) => { ... })`)
- Handler: Extract to `workers/api/src/handlers/` if complex
- Type: Import from `packages/shared-types/src/`

**New Shared Type:**
- File: `packages/shared-types/src/{domain}.ts` (e.g., `custom-rules.ts`)
- Export: Add to `packages/shared-types/src/index.ts`
- Usage: Import directly: `import { CustomRule } from '@code-reviewer/shared-types'`

## Special Directories

**apps/desktop/public/:**
- Purpose: Static assets (icons, images, fonts)
- Generated: No
- Committed: Yes
- Content: Favicon, app icons, example files

**apps/desktop/.next/:**
- Purpose: Build output (deprecated, from Next.js era)
- Generated: Yes
- Committed: No (in .gitignore)

**apps/desktop/out/:**
- Purpose: Static export output (Vite builds here as `dist/`)
- Generated: Yes
- Committed: No (in .gitignore)

**apps/desktop/src-tauri/target/:**
- Purpose: Rust compilation output
- Generated: Yes
- Committed: No (in .gitignore)

**node_modules/:**
- Purpose: Package dependencies (npm workspaces)
- Generated: Yes
- Committed: No (in .gitignore)

**docs/:**
- Purpose: Deployment guides, architecture decision records
- Generated: No (manually maintained)
- Committed: Yes
- Content: Setup docs, architecture notes

**.planning/codebase/:**
- Purpose: GSD-generated architecture documentation
- Generated: Yes (by gsd-map-codebase)
- Committed: Yes (reference docs)
- Content: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md

---

*Structure analysis: 2026-04-05*
